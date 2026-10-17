import {run} from "@demlik/tea/effect";
import {Effect, Schema, Stream} from "effect";
import {defineProgram, type Watch} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {nameOf} from "../outcome.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "./handlers.ts";
import {Look, look} from "./look.ts";
import {ship} from "./machine.ts";
import {SHIP_NAMES, ShipOutcome} from "./outcome.ts";

// The ship program: the thing you start to ship pull requests. It is started
// once, with its mode as a flag, and then told pull requests on its input `pr`
// for as long as it runs, one after another, the way `review | ship` would
// feed it. Each pull request gets a fresh run of the ship machine
// (./machine.ts): the machine takes one pull request from start to end, so the
// program, not the machine, is what keeps running. They go one at a time,
// never side by side: two enqueues on one base branch would race. When its
// starter closes `pr` (or the program piped into it ends), it finishes every
// pull request already told, and ends.
//
//   read   read, gate, say what it would send. The machine is stepped as far
//          as its first write or wait (./look.ts), and nothing is sent.
//   write  the machine runs to its end on tea's Effect engine, with the
//          handlers that write and the two Listens. Its state shows on the
//          run's handle as the machine `ship`, the newest run's.
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

type ShipMachines = {readonly ship: typeof ship};

/** The machine to its end, with the handlers that write and the two Listens, shown on the handle while it runs. */
const toTheEnd = (pr: string, machine: typeof ship, watch: Watch<ShipMachines>) =>
	Effect.gen(function* () {
		const handle = yield* run(machine, {
			ctx: undefined,
			// A run alone holds no working copy, so the tidy-up has nothing of its own to remove.
			interpret: {...shipReadInterpret, ...shipWriteInterpret()},
			subscribe: shipSubscribe,
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* watch("ship", runtime);
		yield* runtime.dispatch({type: "start", pr});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

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
		},
		outputs: {
			found: output(
				Look,
				"Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. Nothing was sent.",
			),
			outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
		},
		machines: {ship: machine},
		main: ({flags, inputs, send, watch}) =>
			inputs.pr.pipe(
				Stream.runForEach((pr) =>
					flags.mode === "write"
						? toTheEnd(pr, machine, watch).pipe(
								Effect.flatMap((outcome) => send("outcome", {pr, outcome, name: nameOf(outcome)})),
							)
						: look(pr).pipe(Effect.flatMap((found) => send("found", found))),
				),
			),
	});

/** The ship program, on a ship machine with every setting at its default. */
export const shipProgram = createShipProgram();
