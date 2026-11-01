// Experiment 124: can the verify writer kill every mutant that lives, about a promise or not, and
// at what cost? The three kamp-us/demlik tickets of experiments 122 and 123 (#483, #367, #355), on
// copies of 123's trees: the merge commit, 122's agent check in place, Stryker 10.1.1 with its
// vitest runner and per-test coverage.
//
//   FROM=<123's WORK> WORK=<scratch folder outside the repo> node experiments/124-kill-every-survivor.ts setup 355
//   WORK=<dir> node experiments/124-kill-every-survivor.ts loop 355      # Stryker, then up to 3 writer rounds
//   WORK=<dir> node experiments/124-kill-every-survivor.ts rewrite 483   # 123's equal rewrite, then the loop again
//   WORK=<dir> node experiments/124-kill-every-survivor.ts report        # writes the results file
//
// The skip list (fixed before any agent ran): a Stryker ignorer plugin, `arid`, that skips every
// mutant inside the text of an error or a log line. That is an argument of `new <Name>Error(...)`,
// `<Name>Error(...)`, `super(...)` in a class that extends `<Name>Error`, or `console.<any>(...)`.
//
// Every child runs with TYPESAFE_API_KEY and Claude Code's own session variables removed, every test
// and Stryker run under nice -n 15, one Stryker at a time. Network: the writer's model calls only.

import {spawnSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join, relative} from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORK = process.env.WORK ?? "";
const FROM = process.env.FROM ?? "";
const RESULTS = join(ROOT, "experiments/results/124-kill-every-survivor.json");
const MODEL = "claude-opus-5-5";
const BUDGET_USD = "4";
/** The whole experiment stops before a writer call once the writers have spent this much. */
const STOP_USD = 13;
const ROUNDS = 3;
const CONCURRENCY = 4;
const WRITER_MS = 30 * 60_000;
const INCREMENTAL = "reports/stryker-incremental-124.json";
const REPORT = "reports/mutation124.json";

interface Ticket {
	readonly promise: string;
	/** The writer's own test file: 122's agent check, from the repository root. */
	readonly test: string;
	readonly pkg: string;
	readonly tsconfig: string;
	/** The vitest config Stryker's runner starts, from the tree's root. */
	readonly vitest: string;
	/** The test file 123 appended a test to; it goes back to its merged text. */
	readonly restore: string;
}

const TICKETS: Record<string, Ticket> = {
	"483": {
		promise: "A Jev client error never carries the API key.",
		test: "packages/structure-sweep/test/jev-key.promise.test.ts",
		pkg: "packages/structure-sweep",
		tsconfig: "packages/structure-sweep/tsconfig.stryker122.json",
		vitest: "vitest.config.ts",
		restore: "packages/structure-sweep/test/jev.test.ts",
	},
	"367": {
		promise:
			"A span's start and end are the run clock's instant, however long the process has been up.",
		test: "packages/tea/src/otel/span-time.promise.test.ts",
		pkg: "packages/tea",
		tsconfig: "packages/tea/tsconfig.json",
		vitest: "packages/tea/vitest.stryker123.config.ts",
		restore: "packages/tea/src/otel/otel.test.ts",
	},
	"355": {
		promise: "Every note an agent makes is reported exactly once.",
		test: "packages/tea/src/agent/notes-once.promise.test.ts",
		pkg: "packages/tea",
		tsconfig: "packages/tea/tsconfig.json",
		vitest: "packages/tea/vitest.stryker123.config.ts",
		restore: "packages/tea/src/agent/agent-tool.test.ts",
	},
};

/** 123's equal rewrite on #483: the same behaviour, one new mutant. */
const REWRITE = {
	file: "packages/structure-sweep/src/jev.ts",
	from: "if (reply.status >= 400) detail = jevErrorDetail(reply.body);",
	to: "if (reply.status > 399) detail = jevErrorDetail(reply.body);",
};

// ---------------------------------------------------------------- the skip list

/** Stryker's ignorer plugin, written into each tree. A value plugin needs no import of Stryker's api. */
const ARID_PLUGIN = `// Experiment 124's skip list: the text of an error or a log line.
const endsError = (node) => node != null && node.type === "Identifier" && /Error$/.test(node.name);
const why = (call) => {
  const callee = call.node.callee;
  if (call.isNewExpression() && endsError(callee)) return "error text";
  if (!call.isCallExpression()) return undefined;
  if (endsError(callee)) return "error text";
  if (callee.type === "Super") {
    const owner = call.findParent((p) => p.isClassDeclaration() || p.isClassExpression());
    if (owner != null && endsError(owner.node.superClass)) return "error text";
  }
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "console")
    return "log text";
  return undefined;
};
export const strykerPlugins = [
  {
    kind: "Ignore",
    name: "arid",
    value: {
      shouldIgnore(path) {
        const parent = path.parentPath;
        if (parent == null || path.listKey !== "arguments") return undefined;
        if (!parent.isCallExpression() && !parent.isNewExpression()) return undefined;
        const found = why(parent);
        return found === undefined ? undefined : \`arid: \${found}\`;
      },
    },
  },
];
`;

// ---------------------------------------------------------------- running things

const ENV: NodeJS.ProcessEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => k !== "TYPESAFE_API_KEY" && !k.startsWith("CLAUDE")),
);

interface Ran {
	readonly code: number | null;
	readonly stdout: string;
	readonly out: string;
	readonly ms: number;
}
const run = (
	cmd: string,
	args: readonly string[],
	cwd: string,
	more: {readonly input?: string; readonly timeoutMs?: number} = {},
): Ran => {
	const started = performance.now();
	const r = spawnSync(cmd, [...args], {
		cwd,
		env: ENV,
		encoding: "utf8",
		maxBuffer: 512 * 1024 * 1024,
		input: more.input,
		timeout: more.timeoutMs ?? 60 * 60_000,
	});
	return {
		code: r.status,
		stdout: r.stdout ?? "",
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
	run("nice", ["-n", "15", cmd, ...args], cwd, {timeoutMs});

/** No absolute path of this machine leaves the script. */
const tidy = (s: string): string =>
	s
		.replaceAll(WORK, "<work>")
		.replaceAll(FROM === "" ? "\u0000" : FROM, "<work123>")
		.replaceAll(homedir(), "~")
		// oxlint-disable-next-line eslint/no-control-regex -- strips the colour codes of a terminal
		.replace(/\u001b\[[0-9;]*m/g, "");

const ticketOf = (n: string): Ticket => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	return t;
};
const treeOf = (n: string) => join(WORK, n, "tree");
const writerOf = (n: string) => join(WORK, n, "writer");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8"));
const saveJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const mutateOf = (n: string): readonly string[] =>
	readJson<{mutate: string[]}>(join(WORK, n, "mutate122.json")).mutate;

// ---------------------------------------------------------------- setup

const commitAll = (dir: string, message: string) => {
	must("git", ["add", "-A"], dir);
	must(
		"git",
		[
			"-c",
			"user.name=replay",
			"-c",
			"user.email=replay@example.invalid",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			message,
		],
		dir,
	);
};

/** A copy-on-write clone of 123's vitest-runner tree, put back to the merge commit plus the check. */
const setup = (n: string) => {
	if (FROM === "") throw new Error("FROM must name 123's WORK");
	const t = ticketOf(n);
	const tree = treeOf(n);
	if (!existsSync(tree)) must("cp", ["-Rc", join(FROM, n, "probe"), tree], WORK);
	for (const leftover of ["reports", ".stryker-tmp", "stryker123-runner.config.json"])
		rmSync(join(tree, leftover), {recursive: true, force: true});
	copyFileSync(join(FROM, n, "mutate122.json"), join(WORK, n, "mutate122.json"));
	// 123 appended one test here; the merge commit's own text comes from 122's merge tree.
	copyFileSync(join(FROM, "..", "e122", n, "merge", t.restore), join(tree, t.restore));
	// 122's copies of the PR's tests as they were at the base commit are not part of the merge.
	for (const copy of readJson<{copies?: string[]}>(join(WORK, n, "mutate122.json")).copies ?? [])
		rmSync(join(tree, copy), {force: true});
	writeFileSync(join(tree, "stryker-arid.mjs"), ARID_PLUGIN);
	// The writer works in its own copy, with fresh history, so code can see every file it touched.
	const writer = writerOf(n);
	if (!existsSync(writer)) {
		must("cp", ["-Rc", tree, writer], WORK);
		must("git", ["init", "-q"], writer);
		commitAll(writer, "the code after the build, with the promise's check");
	}
	const check = runCheck(n, tree);
	console.log(`${n}: tree ready; the check alone exits ${check.code}`);
};

/** The writer's test file alone, in a tree. */
const runCheck = (n: string, dir: string): Ran => {
	const t = ticketOf(n);
	return niced(
		join(dir, t.pkg, "node_modules/.bin/vitest"),
		["run", t.test.slice(t.pkg.length + 1)],
		join(dir, t.pkg),
		10 * 60_000,
	);
};

// ---------------------------------------------------------------- Stryker

interface ReportMutant {
	readonly id: string;
	readonly mutatorName: string;
	readonly replacement?: string;
	readonly status: string;
	readonly statusReason?: string;
	readonly location: {
		readonly start: {readonly line: number; readonly column: number};
		readonly end: {readonly line: number; readonly column: number};
	};
}
interface Report {
	readonly files: Record<
		string,
		{readonly source: string; readonly mutants: readonly ReportMutant[]}
	>;
}
interface Mutant {
	readonly key: string;
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly mutator: string;
	readonly original: string;
	readonly replacement: string;
	readonly status: string;
	readonly reason: string | null;
	/** The whole source line, as context for the writer. */
	readonly context: string;
}
interface StrykerRun {
	readonly label: string;
	readonly ms: number;
	readonly code: number | null;
	readonly statuses: Record<string, number>;
	readonly reused: string | null;
	readonly mutants: readonly Mutant[];
	readonly tail: string | null;
}

const isUncaught = (m: Mutant) => m.status === "Survived" || m.status === "NoCoverage";

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

const mutantsOf = (report: Report, tree: string): Mutant[] =>
	Object.entries(report.files).flatMap(([f, x]) => {
		const file = f.startsWith(tree) ? f.slice(tree.length + 1) : f;
		const lines = x.source.split("\n");
		return x.mutants.map((m) => {
			const {start, end} = m.location;
			const original =
				start.line === end.line
					? (lines[start.line - 1] ?? "").slice(start.column - 1, end.column - 1)
					: [
							(lines[start.line - 1] ?? "").slice(start.column - 1),
							...lines.slice(start.line, end.line - 1),
							(lines[end.line - 1] ?? "").slice(0, end.column - 1),
						].join("\n");
			return {
				key: `${file}:${start.line}:${start.column}:${m.mutatorName}:${m.replacement ?? ""}`,
				file,
				line: start.line,
				column: start.column,
				mutator: m.mutatorName,
				original,
				replacement: m.replacement ?? "",
				status: m.status,
				reason: m.statusReason ?? null,
				context: (lines[start.line - 1] ?? "").trim(),
			};
		});
	});

const stryker = (n: string, label: string, force = false): StrykerRun => {
	const busy = run("pgrep", ["-f", "stryker.js run"], WORK);
	if (busy.out.trim() !== "") throw new Error(`another Stryker is running: ${busy.out.trim()}`);
	const t = ticketOf(n);
	const tree = treeOf(n);
	const config = {
		$schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
		packageManager: "pnpm",
		plugins: [
			"@stryker-mutator/typescript-checker",
			"@stryker-mutator/vitest-runner",
			"./stryker-arid.mjs",
		],
		ignorers: ["arid"],
		testRunner: "vitest",
		vitest: {configFile: t.vitest},
		checkers: ["typescript"],
		tsconfigFile: t.tsconfig,
		typescriptChecker: {prioritizePerformanceOverAccuracy: false},
		coverageAnalysis: "perTest",
		inPlace: true,
		concurrency: CONCURRENCY,
		mutate: mutateOf(n),
		incremental: true,
		incrementalFile: INCREMENTAL,
		reporters: ["json", "clear-text"],
		jsonReporter: {fileName: REPORT},
		clearTextReporter: {allowColor: false, logTests: false, reportMutants: false},
		tempDirName: ".stryker-tmp",
		cleanTempDir: true,
		timeoutMS: 120_000,
	};
	saveJson(join(tree, "stryker124.config.json"), config);
	rmSync(join(tree, REPORT), {force: true});
	const s = niced(
		"node",
		[
			join(tree, "node_modules/@stryker-mutator/core/bin/stryker.js"),
			"run",
			"stryker124.config.json",
			...(force ? ["--force"] : []),
		],
		tree,
		60 * 60_000,
	);
	writeFileSync(join(WORK, n, `stryker-${label}.log`), tidy(s.out));
	const file = join(tree, REPORT);
	const report: Report | null = existsSync(file) ? readJson(file) : null;
	if (report !== null) copyFileSync(file, join(WORK, n, `mutation-${label}.json`));
	const mutants = report === null ? [] : mutantsOf(report, tree);
	const statuses: Record<string, number> = {};
	for (const m of mutants) statuses[m.status] = (statuses[m.status] ?? 0) + 1;
	const r: StrykerRun = {
		label,
		ms: s.ms,
		code: s.code,
		statuses,
		reused: reusedOf(s.out),
		mutants,
		tail: s.code === 0 ? null : tidy(s.out).slice(-2000),
	};
	saveJson(join(WORK, n, `run-${label}.json`), r);
	console.log(
		`${n} ${label}: ${Math.round(r.ms / 1000)} s, exit ${r.code}, ${JSON.stringify(statuses)}, ${r.reused ?? "no incremental line"}`,
	);
	if (s.code !== 0) console.error(r.tail);
	return r;
};

// ---------------------------------------------------------------- the writer

/** One answer per mutant: a test that kills it, or a reason no test can. */
type Answer =
	| {readonly id: string; readonly answer: "test"; readonly test: string}
	| {readonly id: string; readonly answer: "cannot"; readonly why: string};

const promptOf = (n: string, list: readonly (Mutant & {id: string})[], note: string): string => {
	const t = ticketOf(n);
	const rel = t.test.slice(t.pkg.length + 1);
	return [
		"You are the verify writer for one ticket. You are not the builder. The code in this folder is built.",
		"",
		`Earlier you wrote a check for this promise: "${t.promise}"`,
		`Your test file is ${t.test}. It is the only file you own.`,
		"",
		"Mutation testing (StrykerJS) ran on the lines the pull request changed. A mutant is one small change to the source. A test kills a mutant when it passes on the real code and fails with the mutant in place. The mutants below lived: no test in the repository kills them.",
		"",
		"Every mutant below must be answered, whether or not it is about the promise. For each one, do one of two things:",
		"- add or change a test in your test file that passes on this code and would fail with the mutant in place; or",
		"- if you believe no test can tell the mutant apart from the real code, say so, with the reason. A person will read the reason.",
		"",
		"Rules:",
		"- Change only your test file. Do not change source files, other tests or configs, not even for a moment to try a mutant. Reason from the code.",
		"- Keep the promise's check. You may make it stronger; do not make it weaker.",
		"- Every test in your file must pass on this code.",
		`- Run your file with: cd ${t.pkg} && node_modules/.bin/vitest run ${rel}`,
		"- There is no network. Work only inside this folder.",
		...(note === "" ? [] : [`- ${note}`]),
		"",
		"When you are done, end your reply with one JSON block, one entry per mutant, in this shape:",
		"```json",
		'[{"id": "M1", "answer": "test", "test": "<the full name of the test that kills it>"},',
		' {"id": "M2", "answer": "cannot", "why": "<why no test can tell it apart>"}]',
		"```",
		"",
		"The mutants:",
		"",
		...list.flatMap((m) => [
			`${m.id}. ${m.file}:${m.line}:${m.column}, ${m.mutator}, ${m.status === "NoCoverage" ? "no test runs this line" : "survived"}`,
			`    line:        ${m.context}`,
			`    original:    ${m.original.replaceAll("\n", "\n                 ")}`,
			`    replacement: ${m.replacement.replaceAll("\n", "\n                 ")}`,
		]),
	].join("\n");
};

const TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];
const DENIED = [
	"WebFetch",
	"WebSearch",
	"Bash(gh:*)",
	"Bash(curl:*)",
	"Bash(git fetch:*)",
	"Bash(git pull:*)",
];

interface Usage {
	readonly input_tokens?: number;
	readonly output_tokens?: number;
	readonly cache_read_input_tokens?: number;
	readonly cache_creation_input_tokens?: number;
}
interface Result {
	readonly total_cost_usd?: number;
	readonly usage?: Usage;
	readonly num_turns?: number;
	readonly duration_ms?: number;
	readonly result?: string;
	readonly is_error?: boolean;
	readonly subtype?: string;
	readonly session_id?: string;
	readonly permission_denials?: readonly unknown[];
}

const spentFile = () => join(WORK, "spent.json");
const spent = (): number =>
	existsSync(spentFile()) ? readJson<{usd: number}>(spentFile()).usd : 0;

const answersOf = (text: string): Answer[] => {
	const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
	const last = blocks.at(-1)?.[1];
	if (last === undefined) return [];
	try {
		return JSON.parse(last);
	} catch {
		return [];
	}
};

interface WriterRound {
	readonly round: number;
	readonly asked: readonly (Mutant & {id: string})[];
	readonly answers: readonly Answer[];
	readonly usd: number;
	readonly usage: Usage;
	readonly turns: number;
	readonly ms: number;
	readonly isError: boolean;
	readonly denials: number;
	/** Files the writer changed besides its own test file, by `git status`, then put back. */
	readonly touched: readonly string[];
	readonly checkExit: number | null;
	readonly checkTail: string | null;
	readonly testBefore: string;
	readonly testAfter: string;
	readonly reply: string;
}

const writer = (n: string, label: string, round: number, list: readonly Mutant[], note: string) => {
	const t = ticketOf(n);
	const dir = writerOf(n);
	if (spent() >= STOP_USD)
		throw new Error(`the writers spent $${spent()}; the stop is $${STOP_USD}`);
	const asked = list.map((m, i) => ({...m, id: `M${i + 1}`}));
	const prompt = promptOf(n, asked, note);
	writeFileSync(join(WORK, n, `prompt-${label}-${round}.txt`), tidy(prompt));
	const testBefore = readFileSync(join(dir, t.test), "utf8");
	const args = [
		"-p",
		"--model",
		MODEL,
		"--tools",
		TOOLS.join(","),
		"--allowedTools",
		...TOOLS,
		"--disallowedTools",
		...DENIED,
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--disable-slash-commands",
		"--max-budget-usd",
		BUDGET_USD,
		"--output-format",
		"json",
	];
	console.log(`${n} ${label} round ${round}: writer started on ${asked.length} mutants`);
	const r = run("claude", args, dir, {input: prompt, timeoutMs: WRITER_MS});
	writeFileSync(join(WORK, n, `writer-${label}-${round}.json`), tidy(r.stdout));
	const parsed: unknown = r.stdout.trim() === "" ? {} : JSON.parse(r.stdout);
	const result: Result = Array.isArray(parsed)
		? (parsed.findLast((e: {type?: string}) => e.type === "result") ?? {})
		: (parsed as Result);
	const usd = result.total_cost_usd ?? 0;
	saveJson(spentFile(), {usd: spent() + usd});
	// Every change outside the writer's own file is recorded and put back.
	const status = must("git", ["status", "--porcelain", "--untracked-files=all"], dir)
		.out.split("\n")
		.map((l) => l.slice(3).trim())
		.filter((p) => p !== "" && p !== t.test);
	for (const p of status) {
		const tracked = run("git", ["ls-files", "--error-unmatch", p], dir).code === 0;
		if (tracked) must("git", ["checkout", "--", p], dir);
		else rmSync(join(dir, p), {recursive: true, force: true});
	}
	const testAfter = readFileSync(join(dir, t.test), "utf8");
	commitAll(dir, `${label} round ${round}`);
	copyFileSync(join(dir, t.test), join(treeOf(n), t.test));
	const check = runCheck(n, treeOf(n));
	const w: WriterRound = {
		round,
		asked,
		answers: answersOf(result.result ?? ""),
		usd,
		usage: result.usage ?? {},
		turns: result.num_turns ?? 0,
		ms: r.ms,
		isError: result.is_error === true || r.code !== 0,
		denials: result.permission_denials?.length ?? 0,
		touched: status,
		checkExit: check.code,
		checkTail: check.code === 0 ? null : tidy(check.out).slice(-3000),
		testBefore,
		testAfter,
		reply: tidy(result.result ?? ""),
	};
	saveJson(join(WORK, n, `round-${label}-${round}.json`), w);
	console.log(
		`${n} ${label} round ${round}: exit ${r.code}, ${Math.round(r.ms / 1000)} s, $${usd.toFixed(2)}, ${w.answers.length} answers, touched ${JSON.stringify(status)}, check exit ${check.code}; spent $${spent().toFixed(2)}`,
	);
	return w;
};

// ---------------------------------------------------------------- the loop

/** Stryker, then writer rounds until no mutant lives that the writer has not called untellable. */
const loop = (n: string, label: string, fresh: boolean) => {
	if (fresh) rmSync(join(treeOf(n), INCREMENTAL), {force: true});
	const runs: StrykerRun[] = [stryker(n, `${label}-0`)];
	const claimed = new Set<string>();
	let note = "";
	for (let round = 1; round <= ROUNDS; round++) {
		const last = runs.at(-1);
		if (last === undefined || last.code !== 0) break;
		const open = last.mutants.filter((m) => isUncaught(m) && !claimed.has(m.key));
		if (open.length === 0) break;
		const w = writer(n, label, round, open, note);
		for (const a of w.answers) {
			const m = w.asked.find((x) => x.id === a.id);
			if (a.answer === "cannot" && m !== undefined) claimed.add(m.key);
		}
		note =
			w.checkExit === 0
				? ""
				: `Your test file fails on this code. Make it pass first. The failure:\n${w.checkTail ?? ""}`;
		if (w.checkExit !== 0) {
			console.error(`${n} ${label} round ${round}: the writer's file fails clean; Stryker skipped`);
			continue;
		}
		runs.push(stryker(n, `${label}-${round}`));
	}
	// The truth: every mutant tested again, so a stale incremental answer cannot pass for zero.
	const truth = stryker(n, `${label}-force`, true);
	const runCheck3 = [1, 2, 3].map(() => runCheck(n, treeOf(n)).code);
	saveJson(join(WORK, n, `loop-${label}.json`), {
		label,
		claimed: [...claimed],
		runs: runs.map((r) => r.label),
		truth: truth.label,
		checkThrice: runCheck3,
	});
};

const rewrite = (n: string) => {
	if (n !== "483") throw new Error("the rewrite case is #483's");
	for (const dir of [treeOf(n), writerOf(n)]) {
		const file = join(dir, REWRITE.file);
		const text = readFileSync(file, "utf8");
		if (text.includes(REWRITE.to)) continue;
		if (!text.includes(REWRITE.from)) throw new Error(`no line ${REWRITE.from}`);
		writeFileSync(file, text.replace(REWRITE.from, REWRITE.to));
	}
	commitAll(writerOf(n), "the equal rewrite: >= 400 written as > 399");
	loop(n, "rewrite", false);
};

// ---------------------------------------------------------------- the report

interface Row122 {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly status: string;
	readonly mutator: string;
	readonly replacement: string;
	readonly a: boolean;
	readonly b: boolean;
	readonly c: boolean;
}

/** 122's mutants with their column, from 122's own Stryker report, keyed like this run's. */
const rows122 = (n: string) => {
	const rows = readJson<{tickets: {ticket: string; mutants: {rows: Row122[]}}[]}>(
		join(ROOT, "experiments/results/122-verify-writer-replay.json"),
	).tickets.find((x) => x.ticket === `kamp-us/demlik#${n}`)?.mutants.rows;
	const file122 = join(
		FROM === "" ? join(WORK, "..", "e123") : FROM,
		"..",
		"e122",
		n,
		"mutation.json",
	);
	if (rows === undefined || !existsSync(file122)) return null;
	const report: Report = readJson(file122);
	const byId = new Map(rows.map((r) => [r.id, r]));
	return Object.entries(report.files).flatMap(([f, x]) =>
		x.mutants.map((m) => {
			const file = f.slice(f.indexOf("packages/"));
			const r = byId.get(m.id);
			return {
				key: `${file}:${m.location.start.line}:${m.location.start.column}:${m.mutatorName}:${m.replacement ?? ""}`,
				mutator: m.mutatorName,
				status: m.status,
				groups: r === undefined ? "" : `${r.a ? "a" : ""}${r.b ? "b" : ""}${r.c ? "c" : ""}`,
			};
		}),
	);
};

/** What the skip list removes, against 122's results: uncaught mutants, and kills by one group only. */
const skipOf = (n: string, first: StrykerRun | null) => {
	const old = rows122(n);
	if (old === null || first === null) return null;
	const ignored = first.mutants.filter((m) => m.status === "Ignored");
	const hit = old.filter((o) => ignored.some((m) => m.key === o.key));
	const counts = (xs: typeof old) => ({
		mutants: xs.filter((o) => o.status !== "CompileError").length,
		uncaught: xs.filter((o) => o.status === "Survived" || o.status === "NoCoverage").length,
		killedByOneGroup: xs.filter(
			(o) => (o.status === "Killed" || o.status === "Timeout") && o.groups.length === 1,
		).length,
	});
	return {
		ignored: ignored.map((m) => `${m.file}:${m.line}:${m.column} ${m.mutator} ${m.reason ?? ""}`),
		ignoredNotIn122: ignored.filter((m) => !old.some((o) => o.key === m.key)).map((m) => m.key),
		of122: {all: counts(old), skipped: counts(hit)},
		// The blunt way, for contrast: `mutator.excludedMutations: ["StringLiteral"]`.
		stringLiteral122: counts(old.filter((o) => o.mutator === "StringLiteral")),
		skippedRows: hit,
	};
};

/** String literals in the lines the writer added that also stand as literals in the mutated source. */
const gradeTests = (n: string, before: string, after: string) => {
	const t = ticketOf(n);
	const src = [...new Set(mutateOf(n).map((m) => m.split(":")[0] ?? ""))].map((f) =>
		readFileSync(join(treeOf(n), f), "utf8"),
	);
	const beforeLines = new Set(before.split("\n").map((l) => l.trim()));
	const added = after.split("\n").filter((l) => l.trim() !== "" && !beforeLines.has(l.trim()));
	const literals = [
		...new Set(added.flatMap((l) => [...l.matchAll(/"([^"\\]{2,})"/g)].map((m) => m[1] ?? ""))),
	];
	// A name in quotes or in backticks; a backtick name keeps its `${...}` as written.
	const names = (s: string) =>
		[...s.matchAll(/\b(?:it|test)(?:\.prop\([^)]*\))?\(\s*(["`])((?:(?!\1).)+)\1/g)].map(
			(m) => m[2],
		);
	return {
		addedLines: added.length,
		removedLines: before.split("\n").filter((l) => !after.includes(l)).length,
		testsBefore: names(before),
		testsAfter: names(after),
		testsDropped: names(before).filter((x) => !names(after).includes(x)),
		sourceLiterals: literals.filter((s) => src.some((x) => x.includes(`"${s}"`))),
		sourceLinesCopied: added
			.map((l) => l.trim())
			.filter((l) => l.length > 20 && src.some((x) => x.includes(l))),
		file: t.test,
	};
};

const report = () => {
	const read = <T>(n: string, name: string): T | null => {
		const f = join(WORK, n, name);
		return existsSync(f) ? JSON.parse(tidy(readFileSync(f, "utf8"))) : null;
	};
	const loops = (n: string) =>
		["loop", "rewrite"]
			.map((label) => {
				const l = read<{claimed: string[]; runs: string[]; truth: string; checkThrice: number[]}>(
					n,
					`loop-${label}.json`,
				);
				if (l === null) return null;
				const runs = l.runs.map((r) => read<StrykerRun>(n, `run-${r}.json`));
				const truth = read<StrykerRun>(n, `run-${l.truth}.json`);
				const rounds = [1, 2, 3]
					.map((i) => read<WriterRound>(n, `round-${label}-${i}.json`))
					.filter((r) => r !== null);
				const claimed = new Set(l.claimed);
				const first = rounds[0]?.testBefore ?? "";
				const lastTest = rounds.at(-1)?.testAfter ?? first;
				return {
					label,
					stryker: runs.map((r) =>
						r === null
							? null
							: {
									label: r.label,
									seconds: Math.round(r.ms / 1000),
									statuses: r.statuses,
									reused: r.reused,
									uncaught: r.mutants.filter(isUncaught).map((m) => m.key),
								},
					),
					truth:
						truth === null
							? null
							: {
									seconds: Math.round(truth.ms / 1000),
									statuses: truth.statuses,
									uncaught: truth.mutants.filter(isUncaught).map((m) => ({
										key: m.key,
										claimed: claimed.has(m.key),
									})),
								},
					rounds: rounds.map((r) => ({
						round: r.round,
						asked: r.asked.length,
						usd: r.usd,
						usage: r.usage,
						turns: r.turns,
						seconds: Math.round(r.ms / 1000),
						isError: r.isError,
						denials: r.denials,
						touched: r.touched,
						checkExit: r.checkExit,
						answers: r.answers.map((a) => {
							const m = r.asked.find((x) => x.id === a.id);
							return {
								...a,
								mutant:
									m === undefined
										? null
										: `${m.file}:${m.line}:${m.column} ${m.mutator}: ${m.original} => ${m.replacement}`,
							};
						}),
						reply: r.reply,
						grade: gradeTests(n, r.testBefore, r.testAfter),
					})),
					overall: gradeTests(n, first, lastTest),
					claimed: l.claimed,
					checkThrice: l.checkThrice,
				};
			})
			.filter((x) => x !== null);
	const tickets = Object.keys(TICKETS)
		.filter((n) => existsSync(join(WORK, n, "loop-loop.json")))
		.map((n) => ({
			ticket: `kamp-us/demlik#${n}`,
			promise: ticketOf(n).promise,
			test: ticketOf(n).test,
			skip: skipOf(n, read<StrykerRun>(n, "run-loop-0.json")),
			loops: loops(n),
		}));
	const out = {
		experiment: 124,
		date: new Date().toISOString().slice(0, 10),
		node: process.version,
		stryker: "10.1.1, vitest runner, perTest coverage, TypeScript checker",
		model: MODEL,
		claudeCode: run("claude", ["--version"], WORK).stdout.trim(),
		budgetPerCallUsd: Number(BUDGET_USD),
		spentUsd: spent(),
		skipList: ARID_PLUGIN,
		tickets,
	};
	writeFileSync(RESULTS, `${tidy(JSON.stringify(out, null, "\t"))}\n`);
	console.log(`wrote ${relative(ROOT, RESULTS)}`);
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
	loop: (x) => loop(x, "loop", true),
	rewrite,
	report,
};
const chosen = steps[step ?? ""];
if (chosen === undefined)
	console.error(`unknown step ${step}; one of ${Object.keys(steps).join(", ")}`);
else chosen(n);
