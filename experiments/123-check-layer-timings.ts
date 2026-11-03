// Experiment 123: how long does each check layer take on real tickets, and which repeat runs can
// be made cheap? The three kamp-us/demlik tickets of experiment 122 (#483, #367, #355), on copies
// of 122's Stryker trees (the merge commit, the agent's check and the base copies of the PR's
// changed tests already in place).
//
//   FROM=<122's WORK> WORK=<scratch folder outside the repo> node experiments/123-check-layer-timings.ts setup 483
//   WORK=<dir> node experiments/123-check-layer-timings.ts fast 483     # typecheck, vitest related, the check: 3 runs each
//   WORK=<dir> node experiments/123-check-layer-timings.ts full 483     # a fresh Stryker run, incremental file written
//   WORK=<dir> node experiments/123-check-layer-timings.ts again 483    # repair (a): nothing changed
//   WORK=<dir> node experiments/123-check-layer-timings.ts cover 483    # coverage of the check alone, Stryker on those lines
//   WORK=<dir> node experiments/123-check-layer-timings.ts test 483     # repair (b): one new test, incremental
//   WORK=<dir> node experiments/123-check-layer-timings.ts force 483    # (b) again with --force: the true answer
//   WORK=<dir> node experiments/123-check-layer-timings.ts line 483     # repair (c): one source line changed, incremental
//   WORK=<dir> node experiments/123-check-layer-timings.ts runner 367   # Stryker 10.1.1's vitest runner, per-test coverage
//   WORK=<dir> node experiments/123-check-layer-timings.ts report       # writes the results file
//
// Stryker calls `mutant <n>` once per mutant (its command runner), as in 119 and 122. Every child
// runs with TYPESAFE_API_KEY removed, and every test and Stryker run under nice -n 15. Network:
// pnpm installs only. No agent, no model, no Jev.

import {spawnSync} from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {basename, join, relative} from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORK = process.env.WORK ?? "";
const FROM = process.env.FROM ?? "";
const RESULTS = join(ROOT, "experiments/results/123-check-layer-timings.json");
const RESULTS_122 = join(ROOT, "experiments/results/122-verify-writer-replay.json");
const CONCURRENCY = 4;
const RUNS = 3;
const INCREMENTAL = "reports/stryker-incremental-123.json";
const NEWER = "10.1.1";

interface Ticket {
	/** The agent's check from 122, from the repository root. */
	readonly test: string;
	readonly pkg: string;
	/** The packages whose typecheck and tests run. */
	readonly projects: readonly string[];
	readonly tsconfig: string;
	/** Repair (b): one test, added at the end of an existing test file. */
	readonly add: {readonly file: string; readonly text: string; readonly kills: string};
	/** Repair (c): one source line, changed to an equal line. */
	readonly edit: {readonly file: string; readonly from: string; readonly to: string};
}

const TICKETS: Record<string, Ticket> = {
	"483": {
		test: "packages/structure-sweep/test/jev-key.promise.test.ts",
		pkg: "packages/structure-sweep",
		projects: ["packages/structure-sweep", "packages/backlog-sweep"],
		tsconfig: "packages/structure-sweep/tsconfig.stryker122.json",
		add: {
			file: "packages/structure-sweep/test/jev.test.ts",
			kills: "124: `reply.status >= 400` made `> 400` (structure-sweep)",
			text: `
describe("httpJevClient at exactly 400 (123)", () => {
  it("surfaces a 400's account error detail", async () => {
    const { post } = scripted([
      { status: 400, body: { error: { message: "Bad input", code: "invalid" } } },
    ]);
    const ask = httpJevClient({ questions: pairQuestions, model: "jev-1", post, sleep: noWait });
    const error = await ask({}).catch((caught: unknown) => caught);
    expect((error as JevAskError).detail).toBe("Bad input; invalid");
  });
});
`,
		},
		edit: {
			file: "packages/structure-sweep/src/jev.ts",
			from: "if (reply.status >= 400) detail = jevErrorDetail(reply.body);",
			to: "if (reply.status > 399) detail = jevErrorDetail(reply.body);",
		},
	},
	"367": {
		test: "packages/tea/src/otel/span-time.promise.test.ts",
		pkg: "packages/tea",
		projects: ["packages/tea"],
		tsconfig: "packages/tea/tsconfig.json",
		add: {
			file: "packages/tea/src/otel/otel.test.ts",
			kills: "7 and 10: the carry for a nanosecond count that rounds up to a whole second",
			text: `
describe("agentSpans — a fraction of a millisecond that rounds up (123)", () => {
  it("carries into the next second", () => {
    const { exporter, tracer } = exporterAndTracer();
    const spans = agentSpans<string>({ tracer });
    spans.onEvent({ runId: "run-c", at: 1, type: "BrainStarted", turn: 0, purpose: "act", model: null, payload: null });
    spans.onEvent({ runId: "run-c", at: 1_999.999_999_9, type: "RunDone", status: { kind: "cancelled", at: 1_999.999_999_9 } });
    expect(one(exporter.getFinishedSpans(), "invoke_agent agent").endTime).toEqual([2, 0]);
  });
});
`,
		},
		edit: {
			file: "packages/tea/src/otel/index.ts",
			from: "const nanos = Math.round((at - seconds * 1_000) * 1_000_000);",
			to: "const nanos = Math.round((at - seconds * 1000) * 1e6);",
		},
	},
	"355": {
		test: "packages/tea/src/agent/notes-once.promise.test.ts",
		pkg: "packages/tea",
		projects: ["packages/tea"],
		tsconfig: "packages/tea/tsconfig.json",
		add: {
			file: "packages/tea/src/agent/agent-tool.test.ts",
			kills:
				"none: both survivors of 122 change nothing a test can see; the new test checks a known value",
			text: `
describe("a repair round's new test (123)", () => {
  it("runs", () => {
    expect([1, 2, 3].length).toBe(3);
  });
});
`,
		},
		edit: {
			file: "packages/tea/src/agent/machine.ts",
			from: "if (outbox.length === 0 || projected.has(outbox)) return events;",
			to: "if (projected.has(outbox) || outbox.length === 0) return events;",
		},
	},
};

// ---------------------------------------------------------------- running things

const ENV: NodeJS.ProcessEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => k !== "TYPESAFE_API_KEY"),
);

interface Ran {
	readonly code: number | null;
	readonly out: string;
	readonly ms: number;
}
const run = (cmd: string, args: readonly string[], cwd: string, timeoutMs = 60 * 60_000): Ran => {
	const started = performance.now();
	const r = spawnSync(cmd, [...args], {
		cwd,
		env: ENV,
		encoding: "utf8",
		maxBuffer: 512 * 1024 * 1024,
		timeout: timeoutMs,
	});
	return {
		code: r.status,
		out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
		ms: Math.round(performance.now() - started),
	};
};
const must = (cmd: string, args: readonly string[], cwd: string): Ran => {
	const r = run(cmd, args, cwd);
	if (r.code !== 0) {
		console.error(`${cmd} ${args.join(" ")} exited ${r.code}\n${tidy(r.out).slice(-4000)}`);
		process.exit(1);
	}
	return r;
};
const niced = (cmd: string, args: readonly string[], cwd: string, timeoutMs?: number) =>
	run("nice", ["-n", "15", cmd, ...args], cwd, timeoutMs);

/** No absolute path of this machine leaves the script. */
const tidy = (s: string): string =>
	s
		.replaceAll(WORK, "<work>")
		.replaceAll(FROM === "" ? "\u0000" : FROM, "<work122>")
		.replaceAll(homedir(), "~")
		// oxlint-disable-next-line eslint/no-control-regex -- strips the colour codes of a terminal
		.replace(/\u001b\[[0-9;]*m/g, "");

const ticketOf = (n: string): Ticket => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	return t;
};
const treeOf = (n: string) => join(WORK, n, "tree");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8"));
const saveJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const median = (xs: readonly number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

interface Mutate122 {
	readonly mutate: readonly string[];
	readonly related: Record<string, readonly string[]>;
}
const mutateOf = (n: string): Mutate122 => readJson(join(WORK, n, "mutate122.json"));
const srcFiles = (n: string) => [...new Set(mutateOf(n).mutate.map((m) => m.split(":")[0] ?? ""))];

// ---------------------------------------------------------------- setup

/** A copy-on-write clone of 122's Stryker tree, so 122's stays as it was, plus v8 coverage. */
const setup = (n: string) => {
	if (FROM === "") throw new Error("FROM must name 122's WORK");
	const tree = treeOf(n);
	if (!existsSync(tree)) must("cp", ["-Rc", join(FROM, n, "mutate"), tree], WORK);
	for (const leftover of ["reports", ".stryker-tmp", "stryker122.config.json"])
		rmSync(join(tree, leftover), {recursive: true, force: true});
	copyFileSync(join(FROM, n, "mutate.json"), join(WORK, n, "mutate122.json"));
	// The bin shims name the folder pnpm installed into; installing again in the copy points them here.
	must("pnpm", ["add", "-w", "-D", "--prefer-offline", "@vitest/coverage-v8@5.0.1"], tree);
	const vitest = must(join(tree, ticketOf(n).pkg, "node_modules/.bin/vitest"), ["--version"], tree);
	console.log(`${n}: tree ready, ${vitest.out.trim()}`);
};

// ---------------------------------------------------------------- every commit: the fast layer

const fast = (n: string) => {
	const t = ticketOf(n);
	const tree = treeOf(n);
	const vitest = (pkg: string) => join(tree, pkg, "node_modules/.bin/vitest");
	const src = srcFiles(n);
	const layers: Record<string, () => Ran[]> = {
		typecheck: () =>
			t.projects.map((pkg) =>
				niced(join(tree, pkg, "node_modules/.bin/tsc"), ["--noEmit"], join(tree, pkg)),
			),
		related: () =>
			t.projects.map((pkg) =>
				niced(
					vitest(pkg),
					["related", ...src.map((p) => relative(join(tree, pkg), join(tree, p))), "--run"],
					join(tree, pkg),
				),
			),
		check: () => [niced(vitest(t.pkg), ["run", t.test.slice(t.pkg.length + 1)], join(tree, t.pkg))],
	};
	const out: Record<string, {runs: number[]; median: number; codes: (number | null)[]}> = {};
	for (const [layer, once] of Object.entries(layers)) {
		const runs: number[] = [];
		const codes: (number | null)[] = [];
		for (let i = 0; i < RUNS; i++) {
			const parts = once();
			runs.push(parts.reduce((s, p) => s + p.ms, 0));
			codes.push(parts.find((p) => p.code !== 0)?.code ?? 0);
			if (i === 0)
				writeFileSync(join(WORK, n, `fast-${layer}.log`), tidy(parts.map((p) => p.out).join("\n")));
		}
		out[layer] = {runs, median: median(runs), codes};
		console.log(`${n} ${layer}: ${runs.join(", ")} ms, exit ${codes.join(",")}`);
	}
	saveJson(join(WORK, n, "fast.json"), out);
};

// ---------------------------------------------------------------- Stryker

interface StrykerRun {
	readonly label: string;
	readonly ms: number;
	readonly code: number | null;
	/** Mutants whose tests the command runner actually ran: one call each. */
	readonly ran: number;
	readonly reused: string | null;
	readonly statuses: Record<string, number>;
	readonly mutants: number;
	readonly survivors: readonly string[];
}

const configOf = (n: string, mutate: readonly string[], incremental: boolean) => ({
	$schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
	packageManager: "pnpm",
	plugins: ["@stryker-mutator/typescript-checker"],
	testRunner: "command",
	commandRunner: {
		command: `node ${join(ROOT, "experiments/123-check-layer-timings.ts")} mutant ${n}`,
	},
	checkers: ["typescript"],
	tsconfigFile: ticketOf(n).tsconfig,
	typescriptChecker: {prioritizePerformanceOverAccuracy: false},
	coverageAnalysis: "off",
	inPlace: true,
	concurrency: CONCURRENCY,
	mutate,
	incremental,
	incrementalFile: INCREMENTAL,
	reporters: ["json", "clear-text"],
	jsonReporter: {fileName: "reports/mutation123.json"},
	clearTextReporter: {allowColor: false, logTests: false, reportMutants: false},
	tempDirName: ".stryker-tmp",
	cleanTempDir: true,
	timeoutMS: 120_000,
});

interface ReportMutant {
	readonly id: string;
	readonly mutatorName: string;
	readonly replacement?: string;
	readonly status: string;
	readonly location: {readonly start: {readonly line: number; readonly column: number}};
}
interface Report {
	readonly files: Record<string, {readonly mutants: readonly ReportMutant[]}>;
}
/** Stryker's own incremental report, its "Mutants" and "Result" lines, or null when it made none. */
const reusedOf = (out: string): string | null => {
	const block = tidy(out).match(/Incremental report:\n((?:\t[^\n]*\n)+)/)?.[1];
	return block === undefined
		? null
		: block
				.split("\n")
				.map((l) => l.replace(/\s+/g, " ").trim())
				.filter((l) => l !== "")
				.join("; ");
};
const keyOf = (file: string, m: ReportMutant) =>
	`${file}:${m.location.start.line}:${m.location.start.column}:${m.mutatorName}:${m.replacement ?? ""}`;

const stryker = (
	n: string,
	label: string,
	o: {mutate?: readonly string[]; incremental: boolean; force?: boolean},
): StrykerRun => {
	const busy = run("pgrep", ["-f", "stryker"], WORK);
	if (busy.out.trim() !== "") throw new Error(`another Stryker is running: ${busy.out.trim()}`);
	const tree = treeOf(n);
	const rows = join(WORK, n, `rows-${label}`);
	rmSync(rows, {recursive: true, force: true});
	mkdirSync(rows, {recursive: true});
	writeFileSync(join(WORK, n, "label.txt"), label);
	const config = `stryker123-${label}.config.json`;
	saveJson(join(tree, config), configOf(n, o.mutate ?? mutateOf(n).mutate, o.incremental));
	const s = niced(
		join(tree, "node_modules/.bin/stryker"),
		["run", config, ...(o.force === true ? ["--force"] : [])],
		tree,
		90 * 60_000,
	);
	writeFileSync(join(WORK, n, `stryker-${label}.log`), tidy(s.out));
	if (s.code !== 0) console.error(tidy(s.out).slice(-4000));
	const report: Report = readJson(join(tree, "reports/mutation123.json"));
	copyFileSync(join(tree, "reports/mutation123.json"), join(WORK, n, `mutation-${label}.json`));
	const all = Object.entries(report.files).flatMap(([f, x]) =>
		x.mutants.map((m) => ({...m, file: f.startsWith(tree) ? f.slice(tree.length + 1) : f})),
	);
	const statuses: Record<string, number> = {};
	for (const m of all) statuses[m.status] = (statuses[m.status] ?? 0) + 1;
	const r: StrykerRun = {
		label,
		ms: s.ms,
		code: s.code,
		ran: new Set(
			readdirSync(rows)
				.map((f) => f.split("-")[0])
				.filter((id) => id !== "none"),
		).size,
		reused: reusedOf(s.out),
		statuses,
		mutants: all.length,
		survivors: all
			.filter((m) => m.status === "Survived" || m.status === "NoCoverage")
			.map((m) => keyOf(m.file, m)),
	};
	saveJson(join(WORK, n, `run-${label}.json`), r);
	console.log(
		`${n} ${label}: ${Math.round(r.ms / 1000)} s, exit ${r.code}, ran ${r.ran} of ${r.mutants}, ${JSON.stringify(statuses)}, ${r.reused ?? "no incremental line"}`,
	);
	return r;
};

/** One mutant, as Stryker's command runner calls it: the related tests of each package, once. */
const mutant = (n: string) => {
	const id = process.env.__STRYKER_ACTIVE_MUTANT__ ?? "none";
	const tree = treeOf(n);
	const label = readFileSync(join(WORK, n, "label.txt"), "utf8").trim();
	let failed = false;
	for (const [pkg, files] of Object.entries(mutateOf(n).related)) {
		if (files.length === 0) continue;
		const x = run(
			join(tree, pkg, "node_modules/.bin/vitest"),
			[
				"run",
				...files,
				"--reporter=json",
				`--outputFile=${join(WORK, n, `rows-${label}`, `${id}-${basename(pkg)}.json`)}`,
			],
			join(tree, pkg),
			110_000,
		);
		if (x.code !== 0) failed = true;
	}
	process.exit(failed ? 1 : 0);
};

// ---------------------------------------------------------------- the repair round

const full = (n: string) => {
	rmSync(join(treeOf(n), INCREMENTAL), {force: true});
	stryker(n, "full", {incremental: true});
	copyFileSync(join(treeOf(n), INCREMENTAL), join(WORK, n, "incremental-after-full.json"));
};
const again = (n: string) => stryker(n, "again", {incremental: true});
const addTest = (n: string) => {
	const t = ticketOf(n);
	const file = join(treeOf(n), t.add.file);
	const text = readFileSync(file, "utf8");
	if (!text.includes("(123)")) writeFileSync(file, `${text}${t.add.text}`);
	// The new test must pass on the unmutated code, or Stryker's first run fails.
	const pkg = join(treeOf(n), t.pkg);
	const x = niced(
		join(pkg, "node_modules/.bin/vitest"),
		["run", relative(pkg, file), "-t", "(123)"],
		pkg,
	);
	if (x.code !== 0) throw new Error(`the new test fails clean:\n${tidy(x.out).slice(-3000)}`);
	stryker(n, "test", {incremental: true});
};
const force = (n: string) => stryker(n, "force", {incremental: true, force: true});
const editLine = (n: string) => {
	const t = ticketOf(n);
	const file = join(treeOf(n), t.edit.file);
	const text = readFileSync(file, "utf8");
	if (!text.includes(t.edit.to)) {
		if (!text.includes(t.edit.from)) throw new Error(`no line ${t.edit.from}`);
		writeFileSync(file, text.replace(t.edit.from, t.edit.to));
	}
	stryker(n, "line", {incremental: true});
};

// ---------------------------------------------------------------- the lines the check runs

interface Istanbul {
	readonly statementMap: Record<string, {start: {line: number}; end: {line: number}}>;
	readonly s: Record<string, number>;
}

/** Changed lines of each file, from 122's mutate ranges (`file:a-b`). */
const changedOf = (n: string): Map<string, Set<number>> => {
	const out = new Map<string, Set<number>>();
	for (const m of mutateOf(n).mutate) {
		const [file = "", range = ""] = m.split(":");
		const [a, b] = range.split("-").map(Number);
		const lines = out.get(file) ?? new Set<number>();
		for (let l = a ?? 0; l <= (b ?? 0); l++) lines.add(l);
		out.set(file, lines);
	}
	return out;
};

/** A line runs when the smallest statement holding it ran, istanbul's line coverage read finer. */
const ranLines = (cov: Istanbul): Set<number> => {
	const st = Object.entries(cov.statementMap).map(([k, v]) => ({
		a: v.start.line,
		b: v.end.line,
		hit: (cov.s[k] ?? 0) > 0,
	}));
	const out = new Set<number>();
	const last = Math.max(0, ...st.map((x) => x.b));
	for (let l = 1; l <= last; l++) {
		const holding = st.filter((x) => x.a <= l && l <= x.b).sort((x, y) => x.b - x.a - (y.b - y.a));
		if (holding[0]?.hit === true) out.add(l);
	}
	return out;
};

const rangesOf = (file: string, lines: ReadonlySet<number>): string[] => {
	const xs = [...lines].sort((a, b) => a - b);
	const out: string[] = [];
	let start = xs[0];
	for (let i = 0; i < xs.length; i++) {
		const l = xs[i] ?? 0;
		const next = xs[i + 1];
		if (next !== l + 1) {
			out.push(`${file}:${start}-${l}`);
			start = next;
		}
	}
	return out;
};

interface Row122 {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly status: string;
	readonly mutator: string;
	readonly replacement: string;
}
const rows122 = (n: string): readonly Row122[] =>
	readJson<{tickets: {ticket: string; mutants: {rows: Row122[]}}[]}>(RESULTS_122).tickets.find(
		(x) => x.ticket === `kamp-us/demlik#${n}`,
	)?.mutants.rows ?? [];

const cover = (n: string) => {
	const t = ticketOf(n);
	const tree = treeOf(n);
	const pkg = join(tree, t.pkg);
	const dir = join(WORK, n, "coverage");
	rmSync(dir, {recursive: true, force: true});
	const x = niced(
		join(pkg, "node_modules/.bin/vitest"),
		[
			"run",
			t.test.slice(t.pkg.length + 1),
			"--coverage.enabled=true",
			"--coverage.provider=v8",
			"--coverage.reporter=json",
			// No include glob: one never matched the other package's file (#483), so every file the
			// check loads is reported, and the changed files are picked from the report below.
			"--coverage.allowExternal=true",
			`--coverage.reportsDirectory=${dir}`,
		],
		pkg,
	);
	writeFileSync(join(WORK, n, "coverage.log"), tidy(x.out));
	const final: Record<string, Istanbul> = readJson(join(dir, "coverage-final.json"));
	const changed = changedOf(n);
	const inside = new Map<string, Set<number>>();
	const perFile: Record<string, {changed: number; ran: number; both: number}> = {};
	for (const [file, lines] of changed) {
		const cov = final[join(tree, file)];
		const ran = cov === undefined ? new Set<number>() : ranLines(cov);
		const both = new Set([...lines].filter((l) => ran.has(l)));
		inside.set(file, both);
		perFile[file] = {changed: lines.size, ran: ran.size, both: both.size};
	}
	const mutate = [...inside].flatMap(([file, lines]) => rangesOf(file, lines));
	const r = mutate.length === 0 ? null : stryker(n, "cover", {mutate, incremental: false});
	const rows = rows122(n);
	const isIn = (x: Row122) => inside.get(x.file)?.has(x.line) === true;
	const survived = rows.filter((x) => x.status === "Survived" || x.status === "NoCoverage");
	const killed = rows.filter((x) => x.status === "Killed" || x.status === "Timeout");
	const out = {
		coverageMs: x.ms,
		coverageExit: x.code,
		perFile,
		mutate,
		run: r,
		survivors122: {
			inside: survived.filter(isIn).map((x) => `${x.id} ${x.file}:${x.line} ${x.mutator}`),
			outside: survived
				.filter((x) => !isIn(x))
				.map((x) => `${x.id} ${x.file}:${x.line} ${x.mutator}`),
		},
		killed122: {inside: killed.filter(isIn).length, outside: killed.filter((x) => !isIn(x)).length},
	};
	saveJson(join(WORK, n, "cover.json"), out);
	console.log(
		`${n} cover: ${mutate.length} ranges, survivors of 122 inside ${out.survivors122.inside.length}, outside ${out.survivors122.outside.length}`,
	);
};

// ---------------------------------------------------------------- Stryker's own vitest runner

/** Stryker 10.1.1 ("support vitest v5"), its vitest runner with per-test coverage, in a second copy. */
const runner = (n: string) => {
	const t = ticketOf(n);
	const probe = join(WORK, n, "probe");
	if (!existsSync(probe)) must("cp", ["-Rc", join(FROM, n, "mutate"), probe], WORK);
	for (const leftover of ["reports", ".stryker-tmp", "stryker122.config.json"])
		rmSync(join(probe, leftover), {recursive: true, force: true});
	must(
		"pnpm",
		[
			"add",
			"-w",
			"-D",
			"--prefer-offline",
			`@stryker-mutator/core@${NEWER}`,
			`@stryker-mutator/vitest-runner@${NEWER}`,
			`@stryker-mutator/typescript-checker@${NEWER}`,
		],
		probe,
	);
	// The runner starts vitest from the tree's root, so the package's relative setup files are not
	// found; this wrapper keeps the package's own config and sets its root back to the package.
	const wrapper = `${t.pkg}/vitest.stryker123.config.ts`;
	writeFileSync(
		join(probe, wrapper),
		[
			'import { fileURLToPath } from "node:url";',
			'import { mergeConfig } from "vitest/config";',
			'import base from "./vitest.config.ts";',
			'export default mergeConfig(base, { root: fileURLToPath(new URL(".", import.meta.url)) });',
			"",
		].join("\n"),
	);
	const config = {
		...configOf(n, mutateOf(n).mutate, true),
		plugins: ["@stryker-mutator/typescript-checker", "@stryker-mutator/vitest-runner"],
		testRunner: "vitest",
		commandRunner: undefined,
		// Two packages' tests (#483): the workspace's root config, every package as a vitest project.
		vitest: {configFile: t.projects.length > 1 ? "vitest.config.ts" : wrapper},
		coverageAnalysis: "perTest",
		jsonReporter: {fileName: "reports/mutation123-runner.json"},
	};
	const runs: Record<string, unknown>[] = [];
	const once = (label: string, extra: readonly string[]) => {
		saveJson(join(probe, "stryker123-runner.config.json"), config);
		const s = niced(
			join(probe, "node_modules/.bin/stryker"),
			["run", "stryker123-runner.config.json", ...extra],
			probe,
			30 * 60_000,
		);
		writeFileSync(join(WORK, n, `runner-${label}.log`), tidy(s.out));
		const file = join(probe, "reports/mutation123-runner.json");
		const report: Report | null = existsSync(file) ? readJson(file) : null;
		const all = Object.entries(report?.files ?? {}).flatMap(([f, x]) =>
			x.mutants.map((m) => ({...m, file: f.startsWith(probe) ? f.slice(probe.length + 1) : f})),
		);
		const statuses: Record<string, number> = {};
		for (const m of all) statuses[m.status] = (statuses[m.status] ?? 0) + 1;
		const r = {
			label,
			ms: s.ms,
			code: s.code,
			statuses,
			reused: reusedOf(s.out),
			testsPerMutant: tidy(s.out).match(/Ran [\d.]+ tests per mutant on average\./)?.[0] ?? null,
			survivors: all
				.filter((m) => m.status === "Survived" || m.status === "NoCoverage")
				.map((m) => keyOf(m.file, m)),
			tail: s.code === 0 ? null : tidy(s.out).slice(-1500),
		};
		runs.push(r);
		console.log(
			`${n} runner ${label}: ${Math.round(s.ms / 1000)} s, exit ${s.code}, ${JSON.stringify(statuses)}, ${r.reused}`,
		);
		return r;
	};
	rmSync(join(probe, INCREMENTAL), {force: true});
	const first = once("full", []);
	if (first.code === 0) {
		const file = join(probe, t.add.file);
		const text = readFileSync(file, "utf8");
		if (!text.includes("(123)")) writeFileSync(file, `${text}${t.add.text}`);
		once("test", []);
	}
	saveJson(join(WORK, n, "runner.json"), {version: NEWER, config, runs});
};

// ---------------------------------------------------------------- the report

const report = () => {
	const tickets = Object.keys(TICKETS)
		.filter((n) => existsSync(join(WORK, n)))
		.map((n) => {
			const read = (name: string) => {
				const f = join(WORK, n, name);
				return existsSync(f) ? JSON.parse(tidy(readFileSync(f, "utf8"))) : null;
			};
			const runs = Object.fromEntries(
				["full", "again", "test", "force", "line"].map((l) => [l, read(`run-${l}.json`)]),
			);
			// Each run's survivors against the full run's: what the repair round kept, and what it lost.
			const fullSurv = new Set<string>(runs.full?.survivors ?? []);
			const vs = Object.fromEntries(
				Object.entries(runs)
					.filter(([, r]) => r !== null)
					.map(([l, r]) => [
						l,
						{
							gone: [...fullSurv].filter((k) => !r.survivors.includes(k)),
							new: r.survivors.filter((k: string) => !fullSurv.has(k)),
						},
					]),
			);
			const rows = rows122(n);
			return {
				ticket: `kamp-us/demlik#${n}`,
				add: TICKETS[n]?.add,
				edit: TICKETS[n]?.edit,
				fast: read("fast.json"),
				runs,
				survivorsAgainstFull: vs,
				matches122: {
					survived122: rows.filter((x) => x.status === "Survived" || x.status === "NoCoverage")
						.length,
					survivedNow: runs.full?.survivors.length ?? null,
				},
				cover: read("cover.json"),
				runner: read("runner.json"),
			};
		});
	const out = {
		experiment: 123,
		date: new Date().toISOString().slice(0, 10),
		node: process.version,
		cpus: run("sysctl", ["-n", "hw.ncpu"], WORK).out.trim(),
		concurrency: CONCURRENCY,
		tickets,
	};
	writeFileSync(RESULTS, `${tidy(JSON.stringify(out, null, "\t"))}\n`);
	console.log(`wrote ${RESULTS.replace(ROOT, "")}`);
};

// ---------------------------------------------------------------- main

if (WORK === "" || WORK.startsWith(ROOT)) {
	console.error("WORK must name a scratch folder outside this repository");
	process.exit(1);
}
const [step, n = ""] = process.argv.slice(2);
mkdirSync(join(WORK, n), {recursive: true});
const steps: Record<string, (n: string) => unknown> = {
	setup,
	fast,
	full,
	again,
	cover,
	test: addTest,
	force,
	line: editLine,
	runner,
	mutant,
	report,
};
const chosen = steps[step ?? ""];
if (chosen === undefined)
	console.error(`unknown step ${step}; one of ${Object.keys(steps).join(", ")}`);
else chosen(n);
