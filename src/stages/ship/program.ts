import {randomUUID} from "node:crypto";
import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Keep, type Send} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import type {Key} from "../../program/storage.ts";
import {nameOf} from "../outcome.ts";
import {prName, shipDrawing} from "../traced.ts";
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
// In write mode each machine run keeps its state in the run's storage, under
// its ask's id (a fresh one for a bare `pr`). So a run started again with the
// same id and storage, after a crash, does two things a fresh one cannot:
//
//   - it first takes each machine run it left unfinished to its end, from
//     where it stood: a pull request in the merge queue is not queued twice,
//     and a re-run of red checks already made is not made again;
//   - an ask under an id it has already answered is answered again from what
//     was kept, and the machine does not run a second time. An asker that
//     crashed before it heard the answer asks again and hears it, and nothing
//     on GitHub happens twice.
//
// How long each is kept: an asked run until its asker tells `forget` under
// its id (it has the answer in its own saved state), or the whole run is
// removed; never by time, since a dropped answer asked again would run the
// machine again. A bare run, which nobody can ask about again, is dropped
// once it is over.
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

/** An asker that has the answer to its ask in its own saved state: what ship kept to answer it again may go. */
export const Forget = Schema.Struct({id: Schema.String});
export type Forget = typeof Forget.Type;

type ShipMachines = {readonly ship: typeof ship};

/** A ship machine run is over: a bare one is dropped then. */
const isOver = (s: Ship) => s.phase === "over";

/** A pull request ship is told, in order, to run under a key. */
interface Told {
	readonly key: Key<Ship>;
	readonly pr: string;
}

/**
 * The machine to its end, under `key`, with the handlers that write and the
 * two Listens, shown on the handle while it runs. Its state is kept in the
 * storage under `key`: a run found there goes on from where it stood.
 */
const toTheEnd = (key: Key<Ship>, pr: string, keep: Keep<ShipMachines>) =>
	Effect.gen(function* () {
		const runtime = yield* keep.run(
			"ship",
			key,
			{
				ctx: undefined,
				// A run alone holds no working copy, so the tidy-up has nothing of its own to remove.
				interpret: {...shipReadInterpret, ...shipWriteInterpret()},
				subscribe: shipSubscribe,
				terminal: (s) => s.phase === "over",
			},
			// Fresh: start it. Found mid-way: send again what was in flight; its Listens open after.
			(kept) => (kept === null || kept.phase === "idle" ? {type: "start", pr} : {type: "resume"}),
			shipDrawing(prName(pr), pr),
		);
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

/** The pull request a kept run is on. `null`: it never started. */
const prOf = (s: Ship): string | null => (s.phase === "idle" ? null : s.pr);

const OUTPUTS = {
	found: output(
		Look,
		"Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. Nothing was sent.",
	),
	outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
	answer: output(
		Answer,
		"Write mode, once per ask, and again for each ask again: how its pull request ended, under the ask's id.",
	),
	forgot: output(
		Forget,
		"Write mode, once per forget: what was kept under that id is gone, and the drop is kept.",
	),
};

/** One machine run to its end, and both words about it. */
const shipped = (
	key: Key<Ship>,
	pr: string,
	keep: Keep<ShipMachines>,
	send: Send<typeof OUTPUTS>,
) =>
	toTheEnd(key, pr, keep).pipe(
		Effect.flatMap((outcome) => {
			const said = {pr, outcome, name: nameOf(outcome)};
			return send("outcome", said).pipe(Effect.andThen(send("answer", {id: key.id, ...said})));
		}),
	);

/**
 * The ship program over a given ship machine. `machine`: one with other
 * limits, for a test. `pullRequest`: the shape a pull request must have, told
 * on `pr` or on `ask`. A narrower one (`SandboxPullRequest`) makes any other
 * url a `bad_shape` before a run starts.
 */
export const createShipProgram = (
	machine = ship,
	pullRequest: typeof PullRequestUrl = PullRequestUrl,
) =>
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
				pullRequest,
				"A pull request to ship. Tell it any time, as many as you like: each gets a fresh run of the ship machine once the one before has ended.",
			),
			ask: input(
				Schema.Struct({...Ask.fields, pr: pullRequest}),
				"A pull request to ship, with the id its answer comes back under on `answer`. Asked again under an id already answered, it answers again from what it kept, and ships nothing twice.",
			),
			forget: input(
				Forget,
				"An id whose answer the asker now keeps itself: what ship kept to answer that ask again is dropped. Tell it once the answer is in the asker's own saved state. Until then the answer is kept, however long.",
			),
		},
		outputs: OUTPUTS,
		machines: {ship: machine},
		left: {
			// First, each machine run an earlier start left unfinished, taken to its end from where it
			// stood. A bare run that never started has nothing to take on, and nobody to ask for it. A
			// finished asked run stays, to answer its ask again. Read mode keeps nothing.
			ship: ({id, until, state}, {flags, send, keep}) => {
				if (flags.mode === "read") return Effect.void;
				const pr = prOf(state);
				if (state.phase !== "over" && pr !== null)
					return shipped({id, until: until === "over" ? isOver : "forgotten"}, pr, keep, send);
				return pr === null && until === "over" ? keep.forget("ship", id) : Effect.void;
			},
		},
		main: ({flags, inputs, send, keep}) => {
			// `pr` is the run's lifeline, as stdin is: when it closes, the run finishes what it holds and ends,
			// and an ask not yet read goes unanswered. Its asker hears the run end.
			const told: Stream.Stream<Told> = Stream.merge(
				inputs.pr.pipe(
					// Nobody can ask under a fresh id again, so its run is dropped once it is over.
					Stream.map((pr): Told => ({key: {id: randomUUID(), until: isOver}, pr})),
				),
				inputs.ask.pipe(Stream.map(({id, pr}): Told => ({key: {id, until: "forgotten"}, pr}))),
				{haltStrategy: "left"},
			);
			// Read mode keeps nothing, so it has nothing to forget.
			if (flags.mode === "read")
				return told.pipe(
					Stream.runForEach((t) =>
						look(t.pr).pipe(Effect.flatMap((found) => send("found", found))),
					),
				);

			/** An ask: answered from the storage when its run is over, run to its end when not. A bare pull request: run. */
			const one = (t: Told) =>
				Effect.gen(function* () {
					const found = t.key.until === "forgotten" ? yield* keep.find("ship", t.key.id) : null;
					if (found?.phase === "over")
						return yield* send("answer", {
							id: t.key.id,
							pr: found.pr,
							outcome: found.outcome,
							name: nameOf(found.outcome),
						});
					return yield* shipped(t.key, t.pr, keep, send);
				});

			const asked = told.pipe(Stream.mapEffect(one));
			// A forget is done beside the runs, not after them: an asker waits on its `forgot`, and must not
			// wait behind another asker's pull request in the merge queue. Only an answered ask is forgotten,
			// so no run still going is dropped.
			const forgotten = inputs.forget.pipe(
				Stream.mapEffect(({id}) =>
					keep.forget("ship", id).pipe(Effect.andThen(send("forgot", {id}))),
				),
			);
			return Stream.merge(asked, forgotten, {haltStrategy: "left"}).pipe(Stream.runDrain);
		},
	});

/** The ship program, on a ship machine with every setting at its default. */
export const shipProgram = createShipProgram();
