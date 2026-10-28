import {run as runMachine} from "@demlik/tea/effect";
import {type Cause, Deferred, Effect, Fiber, PubSub, Queue, Schema, Stream} from "effect";
import type {AnyRunning} from "../program/listed.ts";
import {kind} from "../program/program.ts";
import {flag, output} from "../program/shape.ts";
import * as Program from "../program/spike-serve.ts";
import {describe, runBuiltin, type Said} from "./builtins.ts";
import {check} from "./check.ts";
import {runLine, type Shell, type Watcher} from "./execute.ts";
import {parse} from "./grammar.ts";
import {Jobs, jobsMachine, tableLine} from "./jobs.ts";
import {JobStorage, Programs} from "./programs.ts";
import {Printed, Ready, refusalLines, TABLE, TABLE_REFUSED} from "./shell.ts";

// Experiment 164's spike: tsh (./shell.ts) on one mailbox. A copy of its
// `main`, with one change: its two inputs are served, `line` in order and
// `signal` forked, in place of a forked reader of `signal` beside a loop over
// `line`. Everything else is the same code. Nothing starts this but its test.

type Spoken =
	| {readonly kind: "printed"; readonly printed: Printed}
	| {readonly kind: "ready"; readonly ready: Ready};

export const spikeTsh = Program.make("tsh", {
	description:
		"A shell for tea programs: told lines, it starts programs by name, wires them by their shapes, and says what they send. Its jobs are kept.",
	flags: {
		show: flag(
			Schema.Literals(["short", "json"]),
			"How a value a program sends is printed. short: one line a person reads. json: the value whole, one JSON line, for a script. Pipes carry the value itself either way.",
		),
	},
	inputs: {
		line: Program.input(
			Schema.String,
			"One line, typed or read from a script: statements parted by ; or &. Closing it is Ctrl-D: tsh ends.",
		),
		signal: Program.input(
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
			const storage = yield* JobStorage;
			const scope = yield* Effect.scope;
			const home = yield* storage.open(TABLE.run, null).pipe(Effect.orDie);
			const kept = yield* home.read(TABLE.machine, TABLE.key, Jobs).pipe(
				Effect.as(true),
				Effect.catchTag("StateRefused", () => Effect.succeed(false)),
				Effect.orDie,
			);
			const table = yield* (yield* runMachine(jobsMachine, {
				ctx: undefined,
				...(kept ? {store: home.store(TABLE.machine, TABLE.key, Jobs)} : {}),
			})).ready;
			if (!kept) yield* send("printed", {to: "err", text: TABLE_REFUSED});
			yield* watch("jobs", TABLE.key, table);
			yield* table.dispatch({type: "detached", n: null}).pipe(Effect.orDie);
			const waiting = table.getState().jobs;
			if (waiting.length > 0)
				yield* send("printed", {
					to: "err",
					text: `tsh: ${waiting.length} job${waiting.length === 1 ? "" : "s"} from an earlier tsh, not running: ${waiting.map((j) => `%${j.n}`).join(" ")}. attach %n starts one again; jobs lists them.`,
				});

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

			// The one change: `line` in order, `signal` beside it. `line` is the lifeline, as stdin is.
			yield* serve(
				{
					line: (text) =>
						oneLine(text).pipe(
							Effect.flatMap((said) => {
								Queue.offerUnsafe(spoken, {kind: "ready", ready: {status: said.status}});
								return said.exit ? Program.end : Effect.void;
							}),
						),
					signal: Program.fork((s) => PubSub.publish(signals, s)),
				},
				{until: ["line"]},
			);

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
