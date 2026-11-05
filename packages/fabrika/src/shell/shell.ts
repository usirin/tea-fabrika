import {type Cause, Deferred, Effect, Fiber, PubSub, Queue, Schema, Stream} from "effect";
import {HostJobs, TABLE} from "../host/host-jobs.ts";
import {earlierFor, Jobs, jobsMachine, tableLine} from "../host/jobs.ts";
import type {AnyRunning} from "../program/listed.ts";
import {defineProgram, end, fork, kind} from "../program/program.ts";
import {flag, input, output} from "../program/shape.ts";
import {runBuiltin, type Said} from "./builtins.ts";
import {check} from "./check.ts";
import {type JobStop, runLine, type Shell, stopJob, type Watcher} from "./execute.ts";
import {parse, type Refused} from "./grammar.ts";
import {helpOf, partsHelp} from "./help.ts";
import {Programs} from "./programs.ts";
import {Table} from "./table.ts";

// tsh: a shell that is itself a tea program. Lines in, lines out, and a view
// on its host's job table. Like bash is a program that runs programs, and psql
// one that runs only SQL, tsh runs only tea programs: typed flags, typed
// values, typed pipes with the fit check, all refused before anything runs
// when they do not fit.
//
//   const jobs = yield* openJobs(memoryStorage());   // the host's, in the host's scope
//   const started = yield* start(tsh, {show: "short"}, {printed: draw, ready: prompt}, {id: yield* runIdOf("tsh"), storage: memoryStorage()}).pipe(Effect.provideService(HostJobs, jobs));
//   yield* tell(started.run, "line", "seq --to 3 | double");   // printed 2, 4, 6; then ready {status: 0}
//   yield* tell(started.run, "line", "tally &");               // printed [1] tally:…; ready {status: 0}
//   yield* tell(started.run, "line", "experiments");           // table {title: "Experiments", total: 171, rows: [20 rows]}
//   yield* tell(started.run, "signal", "interrupt");           // Ctrl-C: stops the foreground job, if any
//   yield* tell(started.run, "stop", 1);                       // the host's word: stop %1, as `stop %1` does
//   yield* tell(started.run, "background", "tally &");         // beside a foreground line: printed [2] tally:…; backgrounded {status: 0}
//   started.close("line");                              // Ctrl-D: tsh ends; its jobs stay in the table, detached
//
// It has no terminal in it. A launcher (./main.ts) connects it to one with
// Node's readline, and does completion there, from the pure parser.
//
// It asks for two services: `Programs`, the list it starts programs from by
// name, and `HostJobs`, its host's jobs (../host/host-jobs.ts): the table every
// line becomes a job in, and the storage the jobs' runs keep what must outlive
// them in. The job table is the host's, not tsh's: tsh shows it and sends it
// Msgs, as a shell shows the kernel's process groups.
//
// Each tsh is a fresh run, under a fresh id. Storage keeps a closed input
// closed, as it must for a program that resumes: so a tsh started again under
// the last one's id would be born with `line` closed by the last Ctrl-D, and
// end at once. What outlives one tsh is the host's table, not the run.

export const Printed = Schema.Struct({
	to: Schema.Literals(["out", "err"]),
	text: Schema.String,
	/** The job it was printed for, `%n`: its program's values and tsh's `[n] ...` lines of it. None for tsh's own. */
	n: Schema.optionalKey(Schema.Int),
});
export type Printed = typeof Printed.Type;

export const Ready = Schema.Struct({
	status: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 255})),
});
export type Ready = typeof Ready.Type;

/** What tsh says when the host's job table was saved by older code. */
export const TABLE_REFUSED =
	"tsh: the job table was saved by older code, can't open it. Jobs started now are not kept.";

/** What tsh says, in the order it says it: a line, a table, or that a line is done. */
type Spoken =
	| {readonly kind: "printed"; readonly printed: Printed}
	| {readonly kind: "table"; readonly table: Table; readonly n: number}
	| {readonly kind: "ready"; readonly ready: Ready}
	| {readonly kind: "backgrounded"; readonly ready: Ready};

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
		// A control input: lines waiting behind a slow one never hold it up, and a full mailbox never refuses it.
		signal: input(
			Schema.Literals(["interrupt"]),
			"Ctrl-C: stops what runs in the foreground, with its starter's stop. With nothing there, nothing happens.",
			{control: true},
		),
		// Told by the host, for whoever asked it first (its `stopping` in the table): only the tsh that
		// started a job holds its runs. A control input too, so a line queued behind the job never
		// holds it up.
		stop: input(
			Schema.Int,
			"Stop job n, as `stop %n` does: told by the host for whoever asked. A job not in the table changes nothing.",
			{control: true},
		),
		// A control input: a line that runs beside the one in the foreground, as a person's second
		// line would if a shell took one while a job held the prompt. So only jobs: every statement
		// a program's line ending with &, and nothing that waits, writes the table or ends tsh.
		background: input(
			Schema.String,
			"A line whose every statement is a program's line ending with &: its jobs begin at once, beside what runs in the foreground. Any other line is refused, with status 2.",
			{control: true},
		),
	},
	outputs: {
		printed: output(Printed, "A line to show, on out or err."),
		table: output(
			Table,
			"A table to show a person, on out: laid out by the terminal that shows it, at its own width (./table.ts).",
		),
		// `table`'s value stays the table alone, for whoever only shows it; this one says whose it is.
		jobTable: output(
			Schema.Struct({n: Schema.Int, table: Table}),
			"Each table as `table` sends it, right after, with n: the job that printed it, so a host keeps it in that job's lines.",
		),
		ready: output(
			Ready,
			"Once a line is done: the prompt comes back. status: how its last statement ended, as an exit status (0 ended, 1 failed, 130 stopped, 2 refused, 127 no such program).",
		),
		backgrounded: output(
			Ready,
			"Once a line told on background is done: its jobs began, or it was refused. status: as ready's. The prompt is not the line's.",
		),
	},
	// The table is the host's, not this run's: main only shows it here. No ref of this run ever
	// starts it.
	machines: {
		jobs: kind({
			machine: jobsMachine,
			state: Jobs,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "jobs", steps: {}}),
			status: tableLine,
		}),
	},
	main: ({flags, serve, send, watch}) =>
		Effect.gen(function* () {
			const list = yield* Programs;
			// The host's jobs: its table, opened by the host, and the storage their runs keep in.
			const {table, storage, kept, owner, by} = yield* HostJobs;
			const scope = yield* Effect.scope;
			if (!kept) yield* send("printed", {to: "err", text: TABLE_REFUSED});
			yield* watch("jobs", TABLE.key, table);
			// What the host found from before it started runs nowhere now: it waits to be attached.
			// Only this tsh's own are said; `jobs` lists every one.
			const waiting = earlierFor(table.getState(), owner);
			if (waiting.length > 0)
				yield* send("printed", {
					to: "err",
					text: `tsh: ${waiting.length} job${waiting.length === 1 ? "" : "s"} from an earlier tsh, not running: ${waiting.map((j) => `%${j.n}`).join(" ")}. attach %n starts one again; jobs lists them.`,
				});

			// Everything tsh says goes through one line, so a line's output is never passed by its `ready`.
			const spoken = yield* Queue.unbounded<Spoken, Cause.Done>();
			const speaker = yield* Stream.fromQueue(spoken).pipe(
				Stream.runForEach((s) =>
					s.kind === "printed"
						? send("printed", s.printed)
						: s.kind === "table"
							? send("table", s.table).pipe(
									Effect.andThen(send("jobTable", {n: s.n, table: s.table})),
								)
							: s.kind === "ready"
								? send("ready", s.ready)
								: send("backgrounded", s.ready),
				),
				Effect.forkScoped,
			);
			const print = (to: "out" | "err", text: string, n?: number) => {
				Queue.offerUnsafe(spoken, {
					kind: "printed",
					printed: n === undefined ? {to, text} : {to, text, n},
				});
			};
			const printTable = (table: Table, n: number) => {
				Queue.offerUnsafe(spoken, {kind: "table", table, n});
			};

			const signals = yield* PubSub.unbounded<"interrupt">();

			const shell: Shell = {
				list,
				storage,
				table,
				owner,
				by,
				print,
				printTable,
				show: flags.show,
				signals,
				live: new Map<string, AnyRunning>(),
				stops: new Map<string, JobStop>(),
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
							} else if (checked.kind === "help") {
								const page =
									checked.parts === null
										? helpOf(checked.entry, list)
										: partsHelp(checked.entry, checked.parts);
								for (const l of page) print("out", l);
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

			/**
			 * A line told on `background`: run as a typed one, if each statement is a program's line
			 * with &. A built-in is refused, `jobs &` too: one may wait, write the table or end tsh, and
			 * the foreground line is the one that does.
			 */
			const besideLine = (text: string): Effect.Effect<Said> => {
				const parsed = parse(text);
				if (parsed.kind === "refused") return oneLine(text);
				const first = parsed.statements.find((st) => st.kind !== "run" || !st.background);
				if (first === undefined) return oneLine(text);
				print(
					"err",
					`tsh: ${first.text.trim()} must run in the foreground: a line told beside one runs only programs, each ending with &`,
				);
				return Effect.succeed({status: 2, exit: false});
			};

			/** The host's word: stop job n, if the table holds it. */
			const stopTold = (n: number) =>
				Effect.suspend(() => {
					const job = shell.table.getState().jobs.find((j) => j.n === n);
					return job === undefined ? Effect.void : stopJob(shell, job);
				});

			// `line` in order, `signal`, `stop` and `background` beside it. `line` is the lifeline, as stdin is: its
			// close is Ctrl-D.
			yield* serve(
				{
					line: (text) =>
						oneLine(text).pipe(
							Effect.flatMap((said) => {
								Queue.offerUnsafe(spoken, {kind: "ready", ready: {status: said.status}});
								return said.exit ? end : Effect.void;
							}),
						),
					signal: fork((s) => PubSub.publish(signals, s)),
					stop: fork(stopTold),
					background: fork((text) =>
						besideLine(text).pipe(
							Effect.flatMap((said) =>
								Queue.offer(spoken, {kind: "backgrounded", ready: {status: said.status}}),
							),
						),
					),
				},
				{until: ["line"]},
			);

			// A job whose last program just ended may still be saying so: let it finish, so its end is
			// printed before tsh stops speaking. Its watcher is done once it has said it.
			const still = new Set(
				table
					.getState()
					.jobs.filter((job) => job.state === "running")
					.map((job) => job.stages[0].run),
			);
			yield* Effect.forEach(
				[...shell.watched].filter(([run]) => !still.has(run)),
				([, watcher]) => Deferred.await(watcher),
				{concurrency: "unbounded"},
			);
			// tsh is leaving: the jobs it runs stop with it, and stay in the host's table to be attached
			// by the next one. Only its own: a job another client of the host runs goes on.
			const left = table
				.getState()
				.jobs.filter((job) => job.state === "running" && shell.watched.has(job.stages[0].run));
			if (left.length > 0)
				print(
					"err",
					`tsh: ${left.length} job${left.length === 1 ? "" : "s"} stop with tsh and stay in its table: ${left.map((j) => `%${j.n}`).join(" ")}. Start tsh again and attach them.`,
				);
			for (const job of left)
				yield* table.dispatch({type: "detached", n: job.n}).pipe(Effect.ignore);
			Queue.endUnsafe(spoken);
			yield* Fiber.join(speaker);
		}).pipe(Effect.scoped),
});
