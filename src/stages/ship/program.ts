import {randomUUID} from "node:crypto";
import {run} from "@demlik/tea/effect";
import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Keep, type Watch} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {nameOf} from "../outcome.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "./handlers.ts";
import {Look, look} from "./look.ts";
import {type Ship, ship} from "./machine.ts";
import {SHIP_NAMES, ShipOutcome} from "./outcome.ts";

// The ship program: the thing you start to ship pull requests. It is started
// once, with its mode as a flag, and then told pull requests for as long as it
// runs, one after another, the way `review | ship` would feed it. Each pull
// request gets a run of the ship machine (./machine.ts) of its own: the
// machine takes one pull request from start to end, so the program, not the
// machine, is what keeps running. They go one at a time, never side by side:
// two enqueues on one base branch would race. When its starter closes `pr`
// (or the programs piped into it end), it finishes every pull request already
// told there, and ends.
//
// Two ways in. `pr` takes a pull request and nothing else, as a pipe gives it.
// `ask` takes one with an id the asker picked, and the answer comes back on
// `answer` under that id: Elm's request and its answer Msg, over a pipe.
//
//   read   read, gate, say what it would send. The machine is stepped as far
//          as its first write or wait (./look.ts), and nothing is sent.
//   write  the machine runs to its end on tea's Effect engine, with the
//          handlers that write and the two Listens. Its state shows on the
//          run's handle as the machine `ship`, the newest run's.
//
// In write mode each machine run keeps its state on the run's shelf, under
// its ask's id (a fresh one for a bare `pr`). So a run started again with the
// same id and shelf, after a crash, does two things a fresh one cannot:
//
//   - it first takes each machine run it left unfinished to its end, from
//     where it stood: a pull request in the merge queue is not queued twice,
//     and a re-run of red checks already made is not made again;
//   - an ask under an id it has already answered is answered again from what
//     was kept, and the machine does not run a second time. An asker that
//     crashed before it heard the answer asks again and hears it, and nothing
//     on GitHub happens twice.
//
// It asks for `CodeHost` and `CodeHostWrites` through Effect's context and
// makes no connection itself. Whoever starts it provides them: GitHub for
// `run.ts` (./launch.ts), fakes for a test. A read-mode run never asks for
// `CodeHostWrites`; the launcher gives it one that cannot write all the same.

/** A pull request's address. The same pattern the command line took before it was a program. */
export const PullRequestUrl = Schema.String.check(
	Schema.isPattern(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/, {
		message:
			"not a pull request url: it looks like https://github.com/<owner>/<repo>/pull/<number>",
	}),
).annotate({description: "https://github.com/<owner>/<repo>/pull/<number>"});

/** How one pull request ended, in write mode. `name`: how the outcome is spelled, beside the data it is made from. */
export const Shipped = Schema.Struct({
	pr: Schema.String,
	outcome: ShipOutcome,
	name: Schema.Literals(SHIP_NAMES),
});
export type Shipped = typeof Shipped.Type;

/** One ask: a pull request, and the id its answer comes back under. The asker picks the id and asks again under it after a restart. */
export const Ask = Schema.Struct({id: Schema.String, pr: PullRequestUrl});
export type Ask = typeof Ask.Type;

/** The answer to one ask: how its pull request ended, under the ask's id. */
export const Answer = Schema.Struct({
	id: Schema.String,
	pr: Schema.String,
	outcome: ShipOutcome,
	name: Schema.Literals(SHIP_NAMES),
});
export type Answer = typeof Answer.Type;

type ShipMachines = {readonly ship: typeof ship};

/**
 * The machine to its end, under `key`, with the handlers that write and the
 * two Listens, shown on the handle while it runs. Its state is kept on the
 * shelf under `key`: a run found there goes on from where it stood.
 */
const toTheEnd = (
	key: string,
	pr: string,
	machine: typeof ship,
	watch: Watch<ShipMachines>,
	keep: Keep<ShipMachines>,
) =>
	Effect.gen(function* () {
		const handle = yield* run(machine, {
			ctx: undefined,
			// A run alone holds no working copy, so the tidy-up has nothing of its own to remove.
			interpret: {...shipReadInterpret, ...shipWriteInterpret()},
			subscribe: shipSubscribe,
			store: keep.store("ship", key),
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* watch("ship", runtime);
		// Fresh: start it. Found mid-way: send again what was in flight; its Listens open again by themselves.
		yield* runtime.dispatch(
			runtime.getState().phase === "idle" ? {type: "start", pr} : {type: "resume"},
		);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

/** The pull request a kept run is on. `null`: it never started. */
const prOf = (s: Ship): string | null => (s.phase === "idle" ? null : s.pr);

/** The ship program over a given ship machine. `machine`: one with other limits, for a test. */
export const createShipProgram = (machine = ship) =>
	defineProgram({
		name: "ship",
		description:
			"Puts pull requests in the merge queue, one after another, as it is told them, and says how each one ended. In read mode it changes nothing, and says what it would do.",
		flags: {
			mode: flag(
				Schema.Literals(["read", "write"]),
				"read: change nothing, say what the machine would send. write: run it to its end; it may put each pull request in the merge queue and start its red checks again.",
			),
		},
		inputs: {
			pr: input(
				PullRequestUrl,
				"A pull request to ship. Tell it any time, as many as you like: each gets a fresh run of the ship machine once the one before has ended.",
			),
			ask: input(
				Ask,
				"A pull request to ship, with the id its answer comes back under on `answer`. Asked again under an id already answered, it answers again from what it kept, and ships nothing twice.",
			),
		},
		outputs: {
			found: output(
				Look,
				"Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. Nothing was sent.",
			),
			outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
			answer: output(
				Answer,
				"Write mode, once per ask, and again for each ask again: how its pull request ended, under the ask's id.",
			),
		},
		machines: {ship: machine},
		main: ({flags, inputs, send, watch, keep}) => {
			// `pr` is the run's lifeline, as stdin is: when it closes, the run finishes what it holds and ends,
			// and an ask not yet read goes unanswered. Its asker hears the run end.
			const told = Stream.merge(
				inputs.pr.pipe(Stream.map((pr): Ask => ({id: randomUUID(), pr}))),
				inputs.ask,
				{haltStrategy: "left"},
			);
			if (flags.mode === "read")
				return told.pipe(
					Stream.runForEach(({pr}) =>
						look(pr).pipe(Effect.flatMap((found) => send("found", found))),
					),
				);

			/** One machine run to its end, and both words about it. */
			const shipped = (id: string, pr: string) =>
				toTheEnd(id, pr, machine, watch, keep).pipe(
					Effect.flatMap((outcome) => {
						const said = {pr, outcome, name: nameOf(outcome)};
						return send("outcome", said).pipe(Effect.andThen(send("answer", {id, ...said})));
					}),
				);

			/** An ask, or a bare pull request: answered from the shelf when its run is over, run to its end when not. */
			const one = ({id, pr}: Ask) =>
				Effect.gen(function* () {
					const found = (yield* keep.kept("ship")).find((k) => k.key === id)?.state;
					if (found?.phase === "over")
						return yield* send("answer", {
							id,
							pr: found.pr,
							outcome: found.outcome,
							name: nameOf(found.outcome),
						});
					return yield* shipped(id, pr);
				});

			return Effect.gen(function* () {
				// First, what an earlier life of this run left unfinished, each from where it stood.
				for (const {key, state} of yield* keep.kept("ship")) {
					const pr = prOf(state);
					if (state.phase !== "over" && pr !== null) yield* shipped(key, pr);
				}
				yield* told.pipe(Stream.runForEach(one));
			});
		},
	});

/** The ship program, on a ship machine with every setting at its default. */
export const shipProgram = createShipProgram();
