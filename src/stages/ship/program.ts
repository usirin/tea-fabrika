import {run} from "@demlik/tea/effect";
import {Effect, Schema} from "effect";
import {defineProgram} from "../../program/program.ts";
import {input, output} from "../../program/shape.ts";
import {nameOf} from "../outcome.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "./handlers.ts";
import {Look, look} from "./look.ts";
import {ship} from "./machine.ts";
import {SHIP_NAMES, ShipOutcome} from "./outcome.ts";

// The ship program: the thing you start to ship pull requests. It uses the
// ship machine (./machine.ts), one run of it per pull request, in one of two
// modes:
//
//   read   read, gate, say what it would send. The machine is stepped as far
//          as its first write or wait (./look.ts), and nothing is sent.
//   write  the machine runs to its end on tea's Effect engine, with the
//          handlers that write and the two Listens.
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

/** The machine to its end, with the handlers that write and the two Listens. */
const toTheEnd = (pr: string, machine: typeof ship) =>
	Effect.gen(function* () {
		const handle = yield* run(machine, {
			ctx: undefined,
			// A run alone holds no working copy, so the tidy-up has nothing of its own to remove.
			interpret: {...shipReadInterpret, ...shipWriteInterpret()},
			subscribe: shipSubscribe,
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
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
			"Puts pull requests in the merge queue, one after another, and says how each one ended. In read mode it changes nothing, and says what it would do.",
		inputs: {
			prs: input(
				Schema.NonEmptyArray(PullRequestUrl),
				"The pull requests, in order. Each gets a run of the ship machine of its own.",
			),
			mode: input(
				Schema.Literals(["read", "write"]),
				"read: change nothing, say what the machine would send. write: run it to its end; it may put each pull request in the merge queue and start its red checks again.",
			),
		},
		outputs: {
			found: output(
				Look,
				"Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. Nothing was sent.",
			),
			outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
		},
		main: ({prs, mode}, send) =>
			Effect.forEach(
				prs,
				(pr) =>
					mode === "write"
						? toTheEnd(pr, machine).pipe(
								Effect.flatMap((outcome) => send("outcome", {pr, outcome, name: nameOf(outcome)})),
							)
						: look(pr).pipe(Effect.flatMap((found) => send("found", found))),
				// One after another, never side by side: two enqueues on one base branch would race.
				{concurrency: 1, discard: true},
			),
	});

/** The ship program, on a ship machine with every setting at its default. */
export const shipProgram = createShipProgram();
