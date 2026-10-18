import {run as runMachine} from "@demlik/tea/effect";
import {type Cause, Effect, Fiber, PubSub, Queue, Schema, Stream} from "effect";
import {defineProgram} from "../program/program.ts";
import {flag, input, output} from "../program/shape.ts";
import {describe, runBuiltin, type Said} from "./builtins.ts";
import {check} from "./check.ts";
import {runLine, type Shell, type Watcher} from "./execute.ts";
import {parse, type Refused} from "./grammar.ts";
import {type Jobs, jobsMachine} from "./jobs.ts";
import {type AnyRunning, JobStorage, Programs} from "./programs.ts";

// tsh: a shell that is itself a tea program. Lines in, lines out, and a job
// table as its one machine, kept in its storage. Like bash is a program that
// runs programs, and psql one that runs only SQL, tsh runs only tea programs:
// typed flags, typed values, typed pipes with the fit check, all refused
// before anything runs when they do not fit.
//
//   const started = yield* start(tsh, {show: "short"}, {printed: draw, ready: prompt}, {id: yield* runIdOf("tsh"), storage: memoryStorage()});
//   tell(started.run, "line", "seq --to 3 | double");   // printed 2, 4, 6; then ready {status: 0}
//   tell(started.run, "line", "tally &");               // printed [1] tally:…; ready {status: 0}
//   tell(started.run, "signal", "interrupt");           // Ctrl-C: stops the foreground job, if any
//   started.close("line");                              // Ctrl-D: tsh ends; its jobs stay in the table, detached
//
// It has no terminal in it. A launcher (./main.ts) connects it to one with
// Node's readline, and does completion there, from the pure parser.
//
// It asks for two services: `Programs`, the list it starts programs from by
// name, and `JobStorage`, where its jobs keep what must outlive it, and where
// its job table is kept (at `TABLE`), for the next tsh on the same storage.
//
// Each tsh is a fresh run, under a fresh id. Storage keeps a closed input
// closed, as it must for a program that resumes: so a tsh started again under
// the last one's id would be born with `line` closed by the last Ctrl-D, and
// end at once. What outlives one tsh is the table, not the run.

export const Printed = Schema.Struct({
	to: Schema.Literals(["out", "err"]),
	text: Schema.String,
});
export type Printed = typeof Printed.Type;

export const Ready = Schema.Struct({
	status: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 255})),
});
export type Ready = typeof Ready.Type;

/**
 * Where the job table is kept in the job storage: one run for every tsh that
 * uses the storage. Not under tsh's run id: each tsh is a run of its own. Each
 * tsh opens this run anew, so a tsh still running on the same storage has its
 * next table write fail `Stale`: two tsh never both write the table.
 */
export const TABLE = {run: "tsh", machine: "jobs", key: "table"} as const;

/** What tsh says, in the order it says it: a line, or that a line is done. */
type Spoken =
	| {readonly kind: "printed"; readonly printed: Printed}
	| {readonly kind: "ready"; readonly ready: Ready};

/** A refusal as a shell shows it: why, the guess, and a caret under where. */
export function refusalLines(line: string, refused: Refused): readonly string[] {
	const guess = refused.didYouMean === undefined ? "" : `. Did you mean ${refused.didYouMean}?`;
	const head = `tsh: ${refused.why}${guess}`;
	if (line.includes("\n") || line.length > 160) return [head];
	return [head, `  ${line}`, `  ${" ".repeat(refused.at)}^`];
}

export const tsh = defineProgram({
	name: "tsh",
	description:
		"A shell for tea programs: told lines, it starts programs by name, wires them by their shapes, and says what they send. Its jobs are kept.",
	flags: {
		show: flag(
			Schema.Literals(["short", "json"]),
			"How a value a program sends is printed. short: one line a person reads. json: the value whole, one JSON line, for a script. Pipes carry the value itself either way.",
		),
	},
	inputs: {
		line: input(
			Schema.String,
			"One line, typed or read from a script: statements parted by ; or &. Closing it is Ctrl-D: tsh ends.",
		),
		signal: input(
			Schema.Literals(["interrupt"]),
			"Ctrl-C: stops what runs in the foreground, with its starter's stop. With nothing there, nothing happens.",
		),
	},
	outputs: {
		printed: output(Printed, "A line to show, on out or err."),
		ready: output(
			Ready,
			"Once a line is done: the prompt comes back. status: how its last statement ended, as an exit status (0 ended, 1 failed, 130 stopped, 2 refused, 127 no such program).",
		),
	},
	machines: {jobs: jobsMachine},
	// The table is kept in the home's own run, not this one's: main loads it from there at every start.
	left: {jobs: {by: "main"}},
	main: ({flags, inputs, send, watch}) =>
		Effect.gen(function* () {
			const list = yield* Programs;
			const storage = yield* JobStorage;
			const scope = yield* Effect.scope;
			// The table is the home's, not this run's: kept in one run of the job storage that every
			// tsh on it finds. Not with `keep`, which keeps by run id: each tsh is a new run, because
			// storage keeps a closed input closed, and Ctrl-D closed the last one's `line` for good.
			const home = yield* storage.open(TABLE.run, null).pipe(Effect.orDie);
			const table = yield* (yield* runMachine(jobsMachine, {
				ctx: undefined,
				store: home.store<Jobs>(TABLE.machine, {id: TABLE.key, until: "forgotten"}),
			})).ready;
			yield* watch("jobs", table);
			// Whatever ran in an earlier tsh does not run in this one: it waits to be attached.
			yield* table.dispatch({type: "detached", n: null}).pipe(Effect.orDie);
			const waiting = table.getState().jobs;
			if (waiting.length > 0)
				yield* send("printed", {
					to: "err",
					text: `tsh: ${waiting.length} job${waiting.length === 1 ? "" : "s"} from an earlier tsh, not running: ${waiting.map((j) => `%${j.n}`).join(" ")}. attach %n starts one again; jobs lists them.`,
				});

			// Everything tsh says goes through one line, so a line's output is never passed by its `ready`.
			const spoken = yield* Queue.unbounded<Spoken, Cause.Done>();
			const speaker = yield* Stream.fromQueue(spoken).pipe(
				Stream.runForEach((s) =>
					s.kind === "printed" ? send("printed", s.printed) : send("ready", s.ready),
				),
				Effect.forkScoped,
			);
			const print = (to: "out" | "err", text: string) => {
				Queue.offerUnsafe(spoken, {kind: "printed", printed: {to, text}});
			};

			const signals = yield* PubSub.unbounded<"interrupt">();
			yield* inputs.signal.pipe(
				Stream.runForEach((s) => PubSub.publish(signals, s)),
				Effect.forkScoped,
			);

			const shell: Shell = {
				list,
				storage,
				table,
				print,
				show: flags.show,
				signals,
				live: new Map<string, AnyRunning>(),
				watched: new Map<string, Watcher>(),
				scope,
			};

			const oneLine = (text: string): Effect.Effect<Said> =>
				Effect.gen(function* () {
					const parsed = parse(text);
					if (parsed.kind === "refused") {
						for (const l of refusalLines(text, parsed)) print("err", l);
						return {status: 2, exit: false};
					}
					let said: Said = {status: 0, exit: false};
					for (const st of parsed.statements) {
						// `a && b`: b only if a ended well; `a || b`: b only if it did not. The status stays a's.
						if (st.after === "&&" && said.status !== 0) continue;
						if (st.after === "||" && said.status === 0) continue;
						if (st.kind === "builtin") said = yield* runBuiltin(shell, st, text);
						else {
							const checked = check(st.pipeline, list, text);
							if (checked.kind === "refused") {
								for (const l of refusalLines(text, checked)) print("err", l);
								said = {status: checked.status, exit: false};
							} else if (checked.kind === "describe") {
								for (const l of describe(checked.entry, checked.parts)) print("out", l);
								said = {status: 0, exit: false};
							} else {
								const done = yield* runLine(
									shell,
									checked.line,
									st.background
										? {kind: "background", typed: text}
										: {kind: "foreground", typed: text},
								);
								said = {status: done.status, exit: false};
							}
						}
						if (said.exit) break;
					}
					return said;
				});

			yield* Stream.runForEachWhile(inputs.line, (text) =>
				oneLine(text).pipe(
					Effect.map((said) => {
						Queue.offerUnsafe(spoken, {kind: "ready", ready: {status: said.status}});
						return !said.exit;
					}),
				),
			);

			// tsh is leaving: its jobs stop with it, and stay in the table to be attached by the next one.
			const left = table.getState().jobs.filter((job) => job.state === "running");
			if (left.length > 0)
				print(
					"err",
					`tsh: ${left.length} job${left.length === 1 ? "" : "s"} stop with tsh and stay in its table: ${left.map((j) => `%${j.n}`).join(" ")}. Start tsh again and attach them.`,
				);
			yield* table.dispatch({type: "detached", n: null}).pipe(Effect.ignore);
			Queue.endUnsafe(spoken);
			yield* Fiber.join(speaker);
		}).pipe(Effect.scoped),
});
