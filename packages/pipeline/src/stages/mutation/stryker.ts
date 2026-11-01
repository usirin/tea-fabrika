import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Instrumenter} from "@stryker-mutator/instrumenter";
import {Effect, FileSystem, Layer, Path, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild} from "../../child.ts";
import {IGNORER, shouldIgnore} from "./ignorer.ts";
import {idOf, type Survived} from "./mutant.ts";
import type {Span} from "./scope.ts";
import {type CouldNotRun, MutationRunner, type Ran, type RunAsk} from "./services.ts";

// `MutationRunner` on StrykerJS (10.1.1, experiment 124's), its vitest
// runner with per-test coverage, and ./ignorer.ts as its ignorer plugin.
// One run:
//
//   list       Stryker's own instrumenter makes every mutant on the lines,
//              the ignorer taking some out. Nothing runs yet
//   sample     at most `most` of them, drawn with `seed`: the same on every
//              run (experiments 121 and 139 drew 150 the same way)
//   run        Stryker, on those mutants only, against the repo's own tests
//   typecheck  each mutant no test killed, put in alone, then the repo's own
//              typecheck. One it rejects is a compile error, not counted: no
//              build could ship it. A killed one is not typechecked, so the
//              killed count may hold a few the typecheck would reject
//
// Stryker's own TypeScript checker reads TypeScript's JavaScript API, which
// TypeScript 7 does not have, so the typecheck is the repo's own command.
// Each command runs under `nice -n 15`, with `runEnv`: no login in reach.
// A command that never starts, such as a typecheck tool that is not there,
// fails the whole run: it is never read as a compile error.
// The folder is the run's own copy of the head: Stryker works in a sandbox
// copy of it, and the typecheck step puts each file back as it found it.

/** How to run a repo. Each command runs in the head's folder; the first word is the program. */
export interface StrykerSetup {
	/** Where `head` is checked out: the run's own copy. */
	readonly folder: (head: string) => string;
	readonly tests: readonly [string, ...string[]];
	readonly typecheck: readonly [string, ...string[]];
	/** Stryker's test runners at once. Default 2: other work shares the machine. */
	readonly concurrency?: number;
	/** The vitest config, from the folder. Default: vitest's own search. */
	readonly vitest?: string;
	/** Where the ignorer plugin is, when a bundle moved it. Default: beside this file. */
	readonly ignorer?: string;
}

/** One mutant, as the instrumenter makes it: lines and columns counted from 0. */
interface Made {
	readonly fileName: string;
	readonly mutatorName: string;
	readonly replacement: string;
	readonly status?: string | undefined;
	readonly location: {
		readonly start: {readonly line: number; readonly column: number};
		readonly end: {readonly line: number; readonly column: number};
	};
}

/** A tiny seeded generator (mulberry32), so a sample is the same on every run. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** At most `most` of `items`, drawn with `seed`, in their first order. All of them when they fit. Pure. */
export function sampleOf<T>(items: readonly T[], seed: number, most: number): readonly T[] {
	if (items.length <= most) return items;
	const at = items.map((_, i) => i);
	const next = seeded(seed);
	for (let i = at.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[at[i], at[j]] = [at[j] ?? 0, at[i] ?? 0];
	}
	return at
		.slice(0, most)
		.sort((a, b) => a - b)
		.flatMap((i) => {
			const item = items[i];
			return item === undefined ? [] : [item];
		});
}

/** A made mutant's id. The instrumenter and the report agree on it. */
const madeId = (folder: string, m: Made) =>
	idOf({
		file: relative(folder, m.fileName),
		line: m.location.start.line + 1,
		column: m.location.start.column + 1,
		mutator: m.mutatorName,
		replacement: m.replacement,
	});

const relative = (folder: string, file: string) =>
	file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : file;

/** Stryker's `mutate` pattern for one mutant exactly: lines from 1, columns from 0. */
const exactly = (folder: string, m: Made) =>
	`${relative(folder, m.fileName)}:${m.location.start.line + 1}:${m.location.start.column}-${m.location.end.line + 1}:${m.location.end.column}`;

const Position = Schema.Struct({line: Schema.Int, column: Schema.Int});

/** As much of Stryker's JSON report (mutation-testing-report-schema) as is read: lines and columns from 1. */
const Report = Schema.Struct({
	files: Schema.Record(
		Schema.String,
		Schema.Struct({
			source: Schema.String,
			mutants: Schema.Array(
				Schema.Struct({
					mutatorName: Schema.String,
					replacement: Schema.optional(Schema.String),
					status: Schema.String,
					location: Schema.Struct({start: Position, end: Position}),
				}),
			),
		}),
	),
});
type Reported = (typeof Report.Type)["files"][string]["mutants"][number];

/** What Stryker says, and exits 1 on, when the repo's tests never reach the code it mutates. */
const NO_TESTS = "No tests were executed";

/**
 * The report of a run with no test to run: every mutant uncaught, as a report says one no test
 * covers. A new file no test imports is a gap in the tests, never a broken run. Pure.
 */
const untested = (picked: readonly Made[]): typeof Report.Type => ({
	files: Object.fromEntries(
		[...new Set(picked.map((m) => m.fileName))].map((fileName) => [
			fileName,
			{
				source: "",
				mutants: picked
					.filter((m) => m.fileName === fileName)
					.map((m) => ({
						mutatorName: m.mutatorName,
						replacement: m.replacement,
						status: "NoCoverage",
						location: {
							start: {line: m.location.start.line + 1, column: m.location.start.column + 1},
							end: {line: m.location.end.line + 1, column: m.location.end.column + 1},
						},
					})),
			},
		]),
	),
});

const KILLED = new Set(["Killed", "Timeout"]);
const UNCAUGHT = new Set(["Survived", "NoCoverage"]);

/** The offset of a report position (from 1) in `text`. */
function offsetOf(text: string, at: {readonly line: number; readonly column: number}): number {
	let off = 0;
	for (let l = 1; l < at.line; l++) off = text.indexOf("\n", off) + 1;
	return off + at.column - 1;
}

/**
 * `text` with one mutant put in by hand, as Stryker's own code has it.
 * Stryker swaps a node of the tree, so a logical operator's new text goes in
 * brackets: `a && b || c` put in bare inside `... && d` would read another way.
 */
function withMutant(text: string, m: Reported): {readonly original: string; readonly text: string} {
	const a = offsetOf(text, m.location.start);
	const b = offsetOf(text, m.location.end);
	const put =
		m.mutatorName === "LogicalOperator" ? `(${m.replacement ?? ""})` : (m.replacement ?? "");
	return {original: text.slice(a, b), text: `${text.slice(0, a)}${put}${text.slice(b)}`};
}

const quiet = () => {};
/** The instrumenter's logger: warnings and errors only. */
const logger = {
	trace: quiet,
	debug: quiet,
	info: quiet,
	warn: quiet,
	error: quiet,
	fatal: quiet,
	isTraceEnabled: () => false,
	isDebugEnabled: () => false,
	isInfoEnabled: () => false,
	isWarnEnabled: () => false,
	isErrorEnabled: () => false,
	isFatalEnabled: () => false,
};

const notRun: CouldNotRun = {_tag: "could_not_run"};
const couldNotRun = Effect.fail(notRun);

/**
 * Exit codes that say the program never started: -1, the process could not
 * be made (../../child.ts); 126 and 127, `nice` found no program to run or
 * could not run it (POSIX `nice`). Such a run tells nothing about the code.
 */
const NOT_STARTED = new Set([-1, 126, 127]);

/** A command that ran. One that never started fails instead, so no caller can read it as an answer. */
const started = (r: Exited): Effect.Effect<Exited, CouldNotRun> =>
	NOT_STARTED.has(r.code) ? couldNotRun : Effect.succeed(r);

/** Where a package's file is, as a path Stryker can load. */
const pathOf = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));

const services = (setup: StrykerSetup) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const low = (
			command: readonly [string, ...string[]],
			cwd: string,
		): Effect.Effect<Exited, CouldNotRun> =>
			Effect.provideService(
				runChild("nice", ["-n", "15", ...command], {cwd, env: runEnv()}),
				ChildProcessSpawner.ChildProcessSpawner,
				spawner,
			).pipe(Effect.flatMap(started));
		// The bin is not among the package's exports; its package.json is.
		const stryker = path.join(
			path.dirname(pathOf("@stryker-mutator/core/package.json")),
			"bin",
			"stryker.js",
		);
		const runner = pathOf("@stryker-mutator/vitest-runner");
		const ignorer = setup.ignorer ?? fileURLToPath(new URL("./ignorer.ts", import.meta.url));

		/** Every mutant Stryker makes on `spans`, the ignorer's marked `Ignored`. */
		const list = (folder: string, spans: readonly Span[]) =>
			Effect.gen(function* () {
				const files = [...new Set(spans.map((s) => s.file))];
				const read = yield* Effect.forEach(
					files,
					(file) =>
						fs.readFileString(path.join(folder, file)).pipe(
							Effect.map((content) => ({
								name: path.join(folder, file),
								content,
								mutate: spans
									.filter((s) => s.file === file)
									.map((s) => ({
										start: {line: s.from - 1, column: 0},
										end: {line: s.to - 1, column: Number.MAX_SAFE_INTEGER},
									})),
							})),
						),
					{concurrency: "unbounded"},
				);
				const made = yield* Effect.tryPromise({
					try: () =>
						new Instrumenter(logger).instrument(read, {
							plugins: null,
							excludedMutations: [],
							ignorers: [{shouldIgnore}],
						}),
					catch: (): CouldNotRun => notRun,
				});
				const mutants: readonly Made[] = made.mutants;
				return mutants;
			});

		/** Stryker over `mutate`, its JSON report read back. `null`: there was no test to run. */
		const strykerRun = (folder: string, mutate: readonly string[]) =>
			Effect.scoped(
				Effect.gen(function* () {
					const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({prefix: "mutation-"}));
					const report = path.join(dir, "report.json");
					const config = path.join(dir, "stryker.json");
					yield* fs.writeFileString(
						config,
						JSON.stringify({
							testRunner: "vitest",
							...(setup.vitest === undefined ? {} : {vitest: {configFile: setup.vitest}}),
							plugins: [runner, ignorer],
							ignorers: [IGNORER],
							coverageAnalysis: "perTest",
							mutate,
							concurrency: setup.concurrency ?? 2,
							reporters: ["json"],
							jsonReporter: {fileName: report},
							tempDirName: path.join(dir, "sandbox"),
							// Stryker rewrites a tsconfig with TypeScript's JavaScript API, which TypeScript 7 has not.
							tsconfigFile: path.join(dir, "no-tsconfig.json"),
							timeoutMS: 60_000,
						}),
					);
					const ran = yield* low(["node", stryker, "run", config], folder);
					if (ran.code !== 0)
						return `${ran.out}${ran.err}`.includes(NO_TESTS) ? null : yield* couldNotRun;
					const text = yield* fs.readFileString(report);
					return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Report))(text);
				}),
			);

		/**
		 * Whether the typecheck takes `m`: put in alone, checked, then the file put back as it was. A
		 * refusal only counts if the code passes with no mutant in (`clean`): a typecheck that fails
		 * whatever the mutant, say on a test's import, says nothing about it, and must not read as
		 * every mutant being refused.
		 */
		const takes = (
			folder: string,
			file: string,
			m: Reported,
			clean: Effect.Effect<boolean, CouldNotRun>,
		) =>
			Effect.gen(function* () {
				const at = path.join(folder, file);
				const text = yield* fs.readFileString(at);
				const mutated = withMutant(text, m);
				yield* fs.writeFileString(at, mutated.text);
				const checked = yield* low(setup.typecheck, folder).pipe(
					Effect.ensuring(fs.writeFileString(at, text).pipe(Effect.orDie)),
				);
				const taken = checked.code === 0 || !(yield* clean);
				return {takes: taken, original: mutated.original};
			});

		const run = (ask: RunAsk) =>
			Effect.gen(function* () {
				// The real path: vitest finds the tests of a mutated file by it, and a temp folder is a link on macOS.
				const folder = yield* fs.realPath(setup.folder(ask.head));
				const made = yield* list(folder, ask.spans);
				const kept = made.filter((m) => m.status !== "Ignored");
				const ignored = made.length - kept.length;
				const picked = sampleOf(kept, ask.seed, ask.most);
				const none: Ran = {
					found: kept.length,
					ran: 0,
					ignored,
					compileErrors: 0,
					killed: 0,
					survived: [],
				};
				if (picked.length === 0) return none;
				const mutate =
					picked.length === kept.length
						? ask.spans.map((s) => `${s.file}:${s.from}-${s.to}`)
						: picked.map((m) => exactly(folder, m));
				const report = (yield* strykerRun(folder, mutate)) ?? untested(picked);
				const clean = yield* Effect.cached(
					low(setup.typecheck, folder).pipe(Effect.map((checked) => checked.code === 0)),
				);
				const wanted = new Set(picked.map((m) => madeId(folder, m)));
				let killed = 0;
				let compileErrors = 0;
				const survived: Survived[] = [];
				for (const [name, entry] of Object.entries(report.files)) {
					const file = relative(folder, name);
					for (const m of entry.mutants) {
						const {line, column} = m.location.start;
						const replacement = m.replacement ?? "";
						const id = idOf({file, line, column, mutator: m.mutatorName, replacement});
						if (!wanted.has(id)) continue;
						if (KILLED.has(m.status)) killed++;
						else if (!UNCAUGHT.has(m.status)) compileErrors++;
						else {
							const said = yield* takes(folder, file, m, clean);
							if (!said.takes) compileErrors++;
							else
								survived.push({
									mutant: id,
									mutator: m.mutatorName,
									original: said.original,
									replacement,
								});
						}
					}
				}
				return {...none, ran: picked.length, compileErrors, killed, survived};
			}).pipe(Effect.catch(() => couldNotRun));

		const tests = (head: string) =>
			low(setup.tests, setup.folder(head)).pipe(
				Effect.map((r) => (r.code === 0 ? ("green" as const) : ("red" as const))),
			);

		return {tests, run};
	});

/** `MutationRunner` on StrykerJS, with Effect's platform services as `@effect/platform-node` gives them. */
export const strykerRunner = (setup: StrykerSetup) =>
	Layer.effect(MutationRunner, services(setup)).pipe(Layer.provide(nodeServices));
