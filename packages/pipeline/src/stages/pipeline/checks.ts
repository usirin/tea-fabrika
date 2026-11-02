import {homedir} from "node:os";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Context, Effect, FileSystem, Layer, Path, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild} from "../../child.ts";
import type {Checked} from "../../tickets/ticket.ts";
import {NOT_STARTED, tidyPaths, whyRed} from "../mutation/stryker.ts";
import {failuresOf, Report} from "../test-writer/results.ts";

// Code runs the repository's `[build] checks` itself, at a head, after every build
// (docs/plan/pipeline-self-fix.md, PR 4). The builder's own report decides nothing.
//
//   every command exits 0                      green
//   one exits non-zero                         red: each failing test by name where `{out}` has
//                                              vitest write its JSON report, else its last 40 lines
//   one cannot start, and again on one more    not_run: nothing says whether the head holds, so it
//   try                                        is never green
//
// Each command runs in the head's own copy, under `nice -n 15`, with `runEnv`: no login in reach.
// `commands` keeps each as the settings say it, `{out}` and all, and `tail` has the copy's folder
// as `.` and the home as `~`: both go on a public ticket.

type Command = readonly [string, ...string[]];

/** One run of the checks at a head: what the ticket keeps, and `tail`, what a person reads of why. */
export type CheckRun = Checked & {readonly tail: string};

/** Runs `[build] checks` at a head. It never fails: a command that could not run is `not_run`. */
export class CheckRunner extends Context.Service<
	CheckRunner,
	{readonly run: (head: string) => Effect.Effect<CheckRun>}
>()("CheckRunner") {}

export interface CheckSetup {
	/** Where `head` is checked out: its own copy. */
	readonly folder: (head: string) => string;
	readonly commands: readonly Command[];
}

/** The last lines a red command with no test named shows. */
const TAIL_LINES = 40;

/** What one command did: as `Checked` reads it, with its failing tests and why. */
type Did = {
	readonly result: Checked["result"];
	readonly failed: readonly string[];
	readonly why: string;
};

/** Every command's result as one: any not run is not run, else any red is red. Pure. */
const worst = (did: readonly Did[]): Checked["result"] =>
	did.some((d) => d.result === "not_run")
		? "not_run"
		: did.some((d) => d.result === "red")
			? "red"
			: "green";

const checksAt = (setup: CheckSetup, head: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const commands = setup.commands.map((command) => command.join(" "));
		const ran = (did: readonly Did[]): CheckRun => ({
			head,
			commands,
			result: did.length === 0 ? "not_run" : worst(did),
			failed: did.flatMap((d) => d.failed),
			tail: did
				.map((d) => d.why)
				.filter((why) => why !== "")
				.join("\n"),
		});
		if (setup.commands.length === 0)
			return {
				...ran([]),
				tail: "[build] checks names no command, so nothing says whether this head holds.",
			};
		const asked = setup.folder(head);
		// The real path: vitest names a test file by it, and a temp folder is a link on macOS.
		const real = yield* Effect.result(fs.realPath(asked));
		if (real._tag === "Failure")
			return {
				...ran([]),
				tail: `The copy of ${head} could not be read, so no check ran there.`,
			};
		const folder = real.success;
		const low = (words: readonly string[]): Effect.Effect<Exited> =>
			Effect.provideService(
				runChild("nice", ["-n", "15", ...words], {cwd: folder, env: runEnv()}),
				ChildProcessSpawner.ChildProcessSpawner,
				spawner,
			);
		/** One command, and once more if it could not start (`once`, a guess: docs/direction/jidoka-and-andon.md#bounds). */
		const one = (command: Command, at: number) =>
			Effect.gen(function* () {
				const out = path.join(folder, `.checks-report-${at}.json`);
				yield* fs.remove(out, {force: true}).pipe(Effect.ignore);
				const words = command.map((word) => word.replaceAll("{out}", out));
				const first = yield* low(words);
				const exited = NOT_STARTED.has(first.code) ? yield* low(words) : first;
				const output = `${exited.out}${exited.err}`;
				if (NOT_STARTED.has(exited.code))
					return {
						result: "not_run",
						failed: [],
						why: `\`${command.join(" ")}\` could not start: ${output.trim().slice(0, 300)}`,
					} satisfies Did;
				if (exited.code === 0) return {result: "green", failed: [], why: ""} satisfies Did;
				// A report that is missing or does not read names none: it never turns red into green.
				const failures = command.some((word) => word.includes("{out}"))
					? yield* fs.readFileString(out).pipe(
							Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Report))),
							Effect.map((report) => failuresOf(report, folder)),
							Effect.orElseSucceed(() => []),
						)
					: [];
				return {
					result: "red",
					failed: failures.map((f) => f.name),
					why: whyRed(failures, output, TAIL_LINES),
				} satisfies Did;
			});
		// One at a time, in the order written: each runs the whole suite in the same copy.
		const did = yield* Effect.forEach(setup.commands, one, {concurrency: 1});
		const checked = ran(did);
		// The real folder and the one asked for: a temp folder is a link on macOS.
		return {
			...checked,
			tail: tidyPaths(tidyPaths(checked.tail, folder, ""), asked, homedir()),
		};
	});

/** `CheckRunner` on this machine, with Effect's platform services as `@effect/platform-node` gives them. */
export const checkRunner = (setup: CheckSetup) =>
	Layer.effect(
		CheckRunner,
		Effect.gen(function* () {
			const services = yield* Effect.context<
				FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
			>();
			return {run: (head: string) => checksAt(setup, head).pipe(Effect.provide(services))};
		}),
	).pipe(Layer.provide(nodeServices));
