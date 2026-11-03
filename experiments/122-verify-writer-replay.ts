// Experiment 122: can an agent write a check for a plain-sentence promise that catches what the
// repo's own tests miss? The verify writer of docs/direction/promises-in-the-pipeline.md, run on
// three closed kamp-us/demlik tickets from the replay set.
//
// For each ticket: a separate agent (claude -p, opus) gets the promise and the triaged ticket as
// the plan, in a copy of the code before the fix with fresh git history, and writes one fast-check
// property test. This script grades it:
//   1. red on base: the test fails at the PR's baseSha;
//   2. green on merge: the same file passes at its mergeSha;
//   3. mutants: Stryker 9.6.1 at mergeSha, on the source lines the PR changed, with the
//      TypeScript checker on and every killing test listed; each kill is sorted into the tests
//      that existed at baseSha, the tests the PR added or changed, and the agent's test.
//
//   WORK=<scratch folder outside the repo> node experiments/122-verify-writer-replay.ts setup 483
//   WORK=<dir> node experiments/122-verify-writer-replay.ts write 483    # the verify writer
//   WORK=<dir> node experiments/122-verify-writer-replay.ts grade 483    # steps 1 and 2
//   WORK=<dir> node experiments/122-verify-writer-replay.ts mutants 483  # step 3, under nice -n 15
//   WORK=<dir> node experiments/122-verify-writer-replay.ts report       # writes the results file
//
// Stryker itself calls `mutant 483` once per mutant: its command runner, since its vitest runner
// reports no coverage on vitest 5.0.1.
//
// Network: the clone of kamp-us/demlik, pnpm installs, and the agent's model calls. Every child
// runs with TYPESAFE_API_KEY and Claude Code's own session variables removed.

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
const RESULTS = join(ROOT, "experiments/results/122-verify-writer-replay.json");
const MODEL = "claude-opus-5-5";
const BUDGET_USD = "8";
const WRITER_MS = 40 * 60_000;
const STRYKER = "9.6.1";
const SAMPLE_SEED = 119120;
const SAMPLE_SIZE = 150;
const CONCURRENCY = "4";
/** A copy of a test file as it was at baseSha sits beside the merged one under this name. */
const BASE_COPY = ".base122.test.ts";

interface Ticket {
	readonly promise: string;
	/** Where the writer's one file goes, from the repository root. */
	readonly test: string;
	/** The package whose vitest runs that file. */
	readonly pkg: string;
	/** The harness adds fast-check to `pkg`'s dev dependencies, in every tree alike. */
	readonly fastCheck: boolean;
	/** The TypeScript the package pins: Stryker's checker uses it. */
	readonly typescript: string;
	/** The vitest projects Stryker runs. */
	readonly projects: readonly string[];
	/** The tsconfig Stryker's checker reads; `null`: write one with `include` below. */
	readonly tsconfig: string | null;
	readonly include?: readonly string[];
	/** One line for the writer about where the code lives, beyond the plan. */
	readonly note: string;
}

const TICKETS: Record<string, Ticket> = {
	"483": {
		promise: "A Jev client error never carries the API key.",
		test: "packages/structure-sweep/test/jev-key.promise.test.ts",
		pkg: "packages/structure-sweep",
		fastCheck: true,
		typescript: "5.8.3",
		projects: ["packages/structure-sweep", "packages/backlog-sweep"],
		tsconfig: null,
		include: ["src/**/*", "../backlog-sweep/src/**/*"],
		note: "The promise covers both Jev clients the plan names. Your file lives in structure-sweep's test folder; reach backlog-sweep's client by a relative import. Use a fake API key that the test makes up; never a real one.",
	},
	"367": {
		promise:
			"A span's start and end are the run clock's instant, however long the process has been up.",
		test: "packages/tea/src/otel/span-time.promise.test.ts",
		pkg: "packages/tea",
		fastCheck: false,
		typescript: "5.7.3",
		projects: ["packages/tea"],
		tsconfig: "packages/tea/tsconfig.json",
		note: "",
	},
	"355": {
		promise: "Every note an agent makes is reported exactly once.",
		test: "packages/tea/src/agent/notes-once.promise.test.ts",
		pkg: "packages/tea",
		fastCheck: false,
		typescript: "5.7.3",
		projects: ["packages/tea"],
		tsconfig: "packages/tea/tsconfig.json",
		note: "",
	},
};

// ---------------------------------------------------------------- the replay record

interface Changed {
	readonly path: string;
	readonly kind: string;
}
interface Replay {
	readonly enriched: string;
	readonly pr: {readonly number: number; readonly baseSha: string; readonly mergeSha: string};
	readonly filesChanged: readonly Changed[];
}
const replayOf = (n: string): Replay =>
	JSON.parse(readFileSync(join(ROOT, `replay/issues/${n}.json`), "utf8"));

// ---------------------------------------------------------------- running things

/** Every child gets this: no Jev key, and none of the parent Claude Code session's variables. */
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
	more: {
		readonly input?: string;
		readonly timeoutMs?: number;
		readonly env?: NodeJS.ProcessEnv;
	} = {},
): Ran => {
	const started = Date.now();
	const r = spawnSync(cmd, [...args], {
		cwd,
		env: {...ENV, ...more.env},
		encoding: "utf8",
		maxBuffer: 512 * 1024 * 1024,
		input: more.input,
		timeout: more.timeoutMs,
	});
	return {
		code: r.status,
		stdout: r.stdout ?? "",
		out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
		ms: Date.now() - started,
	};
};
const must = (cmd: string, args: readonly string[], cwd: string): Ran => {
	const r = run(cmd, args, cwd);
	if (r.code !== 0) {
		console.error(`${cmd} ${args.join(" ")} (in ${cwd}) exited ${r.code}\n${r.out.slice(-4000)}`);
		process.exit(1);
	}
	return r;
};

/** No absolute path of this machine leaves the script: the scratch folder and home are named. */
const tidy = (s: string): string =>
	s
		.replaceAll(WORK, "<work>")
		.replaceAll(homedir(), "~")
		// oxlint-disable-next-line eslint/no-control-regex -- strips the colour codes of a terminal
		.replace(/\u001b\[[0-9;]*m/g, "");

const dirOf = (n: string, kind: "base" | "merge" | "writer" | "mutate") => join(WORK, n, kind);
const timesFile = (n: string) => join(WORK, n, "times.json");
const noteTime = (n: string, step: string, ms: number) => {
	const t: Record<string, number> = existsSync(timesFile(n))
		? JSON.parse(readFileSync(timesFile(n), "utf8"))
		: {};
	t[step] = (t[step] ?? 0) + ms;
	writeFileSync(timesFile(n), JSON.stringify(t, null, 2));
};

// ---------------------------------------------------------------- setup

/** Each tree: the commit's files from `git archive`, the harness's one change, `pnpm install`. */
const setup = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const started = Date.now();
	const r = replayOf(n);
	const clone = join(WORK, "demlik");
	if (!existsSync(join(clone, ".git")))
		must("git", ["clone", "-q", "https://github.com/kamp-us/demlik.git", clone], WORK);
	for (const kind of ["base", "merge", "writer", "mutate"] as const) {
		const dir = dirOf(n, kind);
		if (existsSync(join(dir, "node_modules"))) continue;
		const sha = kind === "base" || kind === "writer" ? r.pr.baseSha : r.pr.mergeSha;
		const tar = join(WORK, n, `${kind}.tar`);
		mkdirSync(dir, {recursive: true});
		must("git", ["-C", clone, "archive", "--format=tar", "-o", tar, sha], WORK);
		must("tar", ["-xf", tar, "-C", dir], WORK);
		rmSync(tar);
		if (t.fastCheck) {
			// The package has no fast-check of its own; the same catalog pin tea uses.
			const file = join(dir, t.pkg, "package.json");
			const pkg = JSON.parse(readFileSync(file, "utf8"));
			pkg.devDependencies = {...pkg.devDependencies, "fast-check": "catalog:"};
			writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
		}
		must(
			"pnpm",
			["install", "--prefer-offline", t.fastCheck ? "--no-frozen-lockfile" : "--frozen-lockfile"],
			dir,
		);
		if (kind === "writer") {
			// Fresh history: one commit, so the fix cannot be found in it.
			must("git", ["init", "-q"], dir);
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
					"-m",
					"the code before the change",
				],
				dir,
			);
		}
		if (kind === "mutate")
			must(
				"pnpm",
				[
					"add",
					"-w",
					"-D",
					"--prefer-offline",
					`@stryker-mutator/core@${STRYKER}`,
					`@stryker-mutator/vitest-runner@${STRYKER}`,
					`@stryker-mutator/typescript-checker@${STRYKER}`,
					`typescript@${t.typescript}`,
				],
				dir,
			);
		console.log(`${n} ${kind}: ready at ${sha.slice(0, 8)}`);
	}
	noteTime(n, "setup", Date.now() - started);
};

// ---------------------------------------------------------------- the verify writer

const promptOf = (n: string): string => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const rel = t.test.slice(t.pkg.length + 1);
	return [
		"You are the verify writer for one ticket. You are not the builder. The plan below is approved, but nobody has built it yet: this folder is the code before the change.",
		"",
		"Write one property test, with fast-check, that checks this promise:",
		"",
		`  "${t.promise}"`,
		"",
		"The promise is new: the ticket adds this behaviour, so today's code should break it. Your test should fail on the code in this folder, and pass once the plan is built.",
		"",
		`- Write it at exactly this path: ${t.test}`,
		'- Use fast-check (`import fc from "fast-check"`, installed for this package) with generated inputs, and vitest, like the package\'s other tests.',
		"- The same file will run against the code after the build, so rely only on names that exist today or that the plan names exactly.",
		"- Create only that file. Do not change source files, configs, or any other file.",
		`- You may read anything in this folder and run tests, for example: cd ${t.pkg} && node_modules/.bin/vitest run ${rel}`,
		"- There is no network. Work only inside this folder.",
		...(t.note === "" ? [] : [`- ${t.note}`]),
		"",
		"When you are done, reply with the path, what the property says in one or two sentences, and the failure you saw when you ran it here.",
		"",
		"The plan:",
		"",
		"---",
		replayOf(n).enriched.trim(),
		"---",
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

const write = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const dir = dirOf(n, "writer");
	if (existsSync(join(WORK, n, "writer.json"))) {
		console.log(`${n}: the writer already ran; delete writer.json to run it again`);
		return;
	}
	const prompt = promptOf(n);
	writeFileSync(join(WORK, n, "prompt.txt"), prompt);
	const args = [
		"-p",
		"--model",
		MODEL,
		// --tools limits what the agent has; --allowedTools only pre-approves them.
		"--tools",
		TOOLS.join(","),
		"--allowedTools",
		...TOOLS,
		"--disallowedTools",
		...DENIED,
		// No settings, CLAUDE.md or plugins of this machine or of the repository.
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--disable-slash-commands",
		"--max-budget-usd",
		BUDGET_USD,
		"--output-format",
		"json",
	];
	console.log(`${n}: verify writer started (${MODEL}), at most $${BUDGET_USD}`);
	const r = run("claude", args, dir, {input: prompt, timeoutMs: WRITER_MS});
	noteTime(n, "write", r.ms);
	writeFileSync(join(WORK, n, "writer.json"), r.stdout);
	const events = parseEvents(r.stdout);
	const result = events.findLast((e) => e.type === "result");
	const init = events.find((e) => e.type === "system" && e.subtype === "init");
	console.log(
		`${n}: exit ${r.code}, ${Math.round(r.ms / 1000)} s, $${result?.total_cost_usd}, tools ${JSON.stringify(init?.tools)}`,
	);
	const session = typeof result?.session_id === "string" ? result.session_id : "";
	const projects = join(homedir(), ".claude/projects");
	for (const p of readdirSync(projects)) {
		const file = join(projects, p, `${session}.jsonl`);
		if (session !== "" && existsSync(file)) copyFileSync(file, join(WORK, n, "transcript.jsonl"));
	}
};

interface Event {
	readonly type?: string;
	readonly subtype?: string;
	readonly total_cost_usd?: number;
	readonly session_id?: string;
	readonly usage?: Usage;
	readonly num_turns?: number;
	readonly duration_ms?: number;
	readonly duration_api_ms?: number;
	readonly modelUsage?: Record<string, unknown>;
	readonly permission_denials?: readonly unknown[];
	readonly result?: string;
	readonly is_error?: boolean;
	readonly tools?: readonly string[];
	readonly message?: {readonly content?: readonly Block[]};
}
interface Block {
	readonly type?: string;
	readonly id?: string;
	readonly name?: string;
	readonly input?: Record<string, unknown>;
}
const parseEvents = (text: string): readonly Event[] => {
	if (text.trim() === "") return [];
	const parsed = JSON.parse(text);
	return Array.isArray(parsed) ? parsed : [parsed];
};

/** What the writer did, read from its transcript by code: every tool call, and any that left its folder or reached for the fix. */
const readTranscript = (n: string) => {
	const file = join(WORK, n, "transcript.jsonl");
	if (!existsSync(file)) return null;
	const dir = dirOf(n, "writer");
	const calls: {tool: string; what: string}[] = [];
	// The transcript can hold one assistant message more than once; a call counts once, by its id.
	const seen = new Set<string>();
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		const e: Event = JSON.parse(line);
		for (const b of e.message?.content ?? []) {
			if (b.type !== "tool_use" || seen.has(b.id ?? "")) continue;
			seen.add(b.id ?? "");
			const i = b.input ?? {};
			const what = String(i.command ?? i.file_path ?? i.pattern ?? i.path ?? "");
			calls.push({tool: b.name ?? "?", what: `${what}${i.path ? ` in ${i.path}` : ""}`});
		}
	}
	// Absolute paths a call names, outside the writer's folder (system tools aside).
	const outside = calls.filter((c) =>
		[...c.what.matchAll(/(?:^|[\s"'=(:])(\/[^\s"'`;|&)]+)/g)].some((m) => {
			const p = m[1] ?? "";
			return (
				!p.startsWith(dir) &&
				!/^\/(dev|tmp|private\/tmp\/(?!claude))|^\/(usr|bin|opt)\//.test(p) &&
				p.length > 1
			);
		}),
	);
	const fix =
		/\bgh\b|curl|wget|github\.com|kamp-us\/demlik|pull\/\d|git (log|show|fetch|pull|remote|reflog)|npm (view|pack|info)|\.pnpm\/@demlik|node_modules\/@demlik/;
	const reached = calls.filter((c) => fix.test(c.what));
	const written = calls
		.filter((c) => c.tool === "Write" || c.tool === "Edit")
		.map((c) => c.what.replace(`${dir}/`, ""));
	return {
		calls: calls.length,
		byTool: Object.fromEntries(
			TOOLS.map((tool) => [tool, calls.filter((c) => c.tool === tool).length]),
		),
		written: [...new Set(written)],
		outside: outside.map((c) => ({tool: c.tool, what: tidy(c.what).slice(0, 300)})),
		reached: reached.map((c) => ({tool: c.tool, what: tidy(c.what).slice(0, 300)})),
		commands: calls
			.filter((c) => c.tool === "Bash")
			.map((c) => tidy(c.what.replaceAll(`${dir}/`, "").replaceAll(dir, ".")).slice(0, 300)),
	};
};

// ---------------------------------------------------------------- grading: red on base, green on merge

const RUNS = 3;

/** One vitest run of the writer's file in a tree. */
const testIn = (n: string, tree: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const rel = t.test.slice(t.pkg.length + 1);
	const r = run(join(tree, t.pkg, "node_modules/.bin/vitest"), ["run", rel], join(tree, t.pkg), {
		timeoutMs: 10 * 60_000,
	});
	return {code: r.code, ms: r.ms, out: tidy(r.out).replaceAll(tree, "<tree>")};
};

/** The failure text, cut to what a person would read: from the first FAIL or error to the summary. */
const failureOf = (out: string): string => {
	const lines = out.split("\n").filter((l) => !/^\s+at |node_modules|^\s+❯ /.test(l));
	const from = lines.findIndex((l) => /FAIL|Error|AssertionError|Property failed/.test(l));
	return lines
		.slice(Math.max(0, from), Math.max(0, from) + 60)
		.join("\n")
		.trim();
};

const grade = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const started = Date.now();
	const writer = dirOf(n, "writer");
	const file = join(writer, t.test);
	if (!existsSync(file)) {
		writeFileSync(join(WORK, n, "grade.json"), JSON.stringify({written: false}, null, 2));
		console.log(`${n}: the writer wrote no file at ${t.test}`);
		return;
	}
	// Anything else the writer left in its folder: it was told to create one file only.
	const status = must("git", ["status", "--porcelain", "--untracked-files=all"], writer)
		.stdout.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => l.slice(3))
		.filter((p) => p !== t.test);
	const runsIn = (tree: string) => {
		copyFileSync(file, join(tree, t.test));
		return Array.from({length: RUNS}, () => testIn(n, tree));
	};
	const base = runsIn(dirOf(n, "base"));
	const merge = runsIn(dirOf(n, "merge"));
	const source = readFileSync(file, "utf8");
	const g = {
		written: true,
		otherFiles: status,
		lines: source.split("\n").length,
		fastCheck: {
			asserts: (source.match(/fc\.assert\(/g) ?? []).length,
			properties: (source.match(/fc\.(async)?[pP]roperty\(/g) ?? []).length,
			arbitraries: [
				...new Set([...source.matchAll(/fc\.([a-zA-Z]+)\(/g)].map((m) => m[1] ?? "")),
			].filter((a) => !["assert", "property", "asyncProperty", "pre"].includes(a)),
			numRuns: [...source.matchAll(/numRuns:\s*([\d_]+)/g)].map((m) => m[1]),
		},
		red: base.every((x) => x.code !== 0),
		redRuns: base.map((x) => x.code !== 0),
		green: merge.every((x) => x.code === 0),
		greenRuns: merge.map((x) => x.code === 0),
		baseFailure: failureOf(base[0]?.out ?? ""),
		mergeFailure: merge.every((x) => x.code === 0) ? null : failureOf(merge[0]?.out ?? ""),
		baseMs: base.map((x) => x.ms),
		mergeMs: merge.map((x) => x.ms),
		importChange: null,
	};
	writeFileSync(join(WORK, n, "grade.json"), JSON.stringify(g, null, 2));
	writeFileSync(join(WORK, n, "base-run.txt"), base[0]?.out ?? "");
	writeFileSync(join(WORK, n, "merge-run.txt"), merge[0]?.out ?? "");
	noteTime(n, "grade", Date.now() - started);
	console.log(
		`${n}: red on base ${g.red} (${g.redRuns}), green on merge ${g.green} (${g.greenRuns}), other files ${JSON.stringify(status)}`,
	);
};

// ---------------------------------------------------------------- grading: mutants

/** The new-side line ranges of `git diff -U0 base..merge` for one file. */
const changedLines = (clone: string, r: Replay, path: string): [number, number][] => {
	const d = must(
		"git",
		["-C", clone, "diff", "-U0", r.pr.baseSha, r.pr.mergeSha, "--", path],
		WORK,
	).stdout;
	const out: [number, number][] = [];
	for (const m of d.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(m[1]);
		const count = m[2] === undefined ? 1 : Number(m[2]);
		if (count > 0) out.push([start, start + count - 1]);
	}
	return out;
};

const existedAtBase = (clone: string, r: Replay, path: string): string | null => {
	const x = run("git", ["-C", clone, "show", `${r.pr.baseSha}:${path}`], WORK);
	return x.code === 0 ? x.stdout : null;
};

const mutants = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const busy = run("pgrep", ["-f", "stryker"], WORK);
	if (busy.stdout.trim() !== "") {
		console.error(`${n}: another Stryker is running (pids ${busy.stdout.trim()}); not starting`);
		process.exit(1);
	}
	const started = Date.now();
	const r = replayOf(n);
	const clone = join(WORK, "demlik");
	const tree = dirOf(n, "mutate");
	const g = JSON.parse(readFileSync(join(WORK, n, "grade.json"), "utf8"));
	// The writer's test goes in only when it is green on merge: Stryker's first run must pass.
	const withAgent = g.written === true && g.green === true;
	if (withAgent) copyFileSync(join(dirOf(n, "writer"), t.test), join(tree, t.test));
	// Each test file the PR changed also runs as it was at baseSha, beside the merged one.
	const testFiles = r.filesChanged.filter((f) => f.kind === "test").map((f) => f.path);
	const copies: string[] = [];
	for (const p of testFiles) {
		const old = existedAtBase(clone, r, p);
		if (old === null) continue;
		const copy = p.replace(/\.test\.ts$/, BASE_COPY);
		writeFileSync(join(tree, copy), old);
		copies.push(copy);
	}
	const src = r.filesChanged.filter((f) => f.kind === "src").map((f) => f.path);
	const mutate = src.flatMap((p) => changedLines(clone, r, p).map(([a, b]) => `${p}:${a}-${b}`));
	let tsconfig = t.tsconfig;
	if (tsconfig === null) {
		tsconfig = `${t.pkg}/tsconfig.stryker122.json`;
		writeFileSync(
			join(tree, tsconfig),
			JSON.stringify({extends: "./tsconfig.json", include: t.include}, null, 2),
		);
	}
	// The tests each mutant runs: every test file of each package that imports a mutated file,
	// directly or not, as vitest's own `related` finds them, run once here on the unmutated code.
	const related: Record<string, string[]> = {};
	for (const pkg of t.projects) {
		const out = join(WORK, n, `related-${basename(pkg)}.json`);
		const files = src.map((p) => relative(join(tree, pkg), join(tree, p)));
		const x = run(
			join(tree, pkg, "node_modules/.bin/vitest"),
			["related", ...files, "--run", "--reporter=json", `--outputFile=${out}`],
			join(tree, pkg),
			{timeoutMs: 20 * 60_000},
		);
		const json: VitestJson = JSON.parse(readFileSync(out, "utf8"));
		const failed = json.testResults.filter((f) => f.status !== "passed").map((f) => f.name);
		related[pkg] = json.testResults
			.filter((f) => f.status === "passed")
			.map((f) => relative(join(tree, pkg), f.name));
		console.log(
			`${n}: ${pkg} related tests ${related[pkg]?.length}, failing unmutated ${failed.length} (exit ${x.code})`,
		);
		if (failed.length > 0)
			writeFileSync(
				join(WORK, n, `related-failing-${basename(pkg)}.json`),
				tidy(JSON.stringify(failed)),
			);
	}
	writeFileSync(join(WORK, n, "related.json"), JSON.stringify(related, null, 2));
	mkdirSync(join(WORK, n, "rows"), {recursive: true});
	const config = {
		$schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
		packageManager: "pnpm",
		// pnpm keeps each package apart, so Stryker's own search for `@stryker-mutator/*` finds none.
		plugins: ["@stryker-mutator/typescript-checker"],
		// Stryker 9.6.1's vitest runner reports no coverage on vitest 5.0.1 (every test "covered 0",
		// every mutant survived), so each mutant runs this script, as in 119, which runs vitest once
		// per package and keeps vitest's own list of every failing test.
		testRunner: "command",
		commandRunner: {
			command: `node ${join(ROOT, "experiments/122-verify-writer-replay.ts")} mutant ${n}`,
		},
		checkers: ["typescript"],
		tsconfigFile: tsconfig,
		typescriptChecker: {prioritizePerformanceOverAccuracy: false},
		coverageAnalysis: "off",
		inPlace: true,
		concurrency: Number(CONCURRENCY),
		mutate,
		reporters: ["json", "clear-text"],
		jsonReporter: {fileName: "reports/mutation122.json"},
		clearTextReporter: {allowColor: false, logTests: false, reportMutants: false},
		tempDirName: ".stryker-tmp",
		cleanTempDir: true,
		timeoutMS: 120_000,
	};
	writeFileSync(join(tree, "stryker122.config.json"), JSON.stringify(config, null, 2));
	console.log(
		`${n}: Stryker on ${mutate.length} ranges in ${src.length} files, base copies ${copies.length}, agent test ${withAgent}`,
	);
	const s = run(
		"nice",
		["-n", "15", join(tree, "node_modules/.bin/stryker"), "run", "stryker122.config.json"],
		tree,
		{timeoutMs: 90 * 60_000},
	);
	writeFileSync(join(WORK, n, "stryker.log"), tidy(s.out));
	noteTime(n, "mutants", Date.now() - started);
	console.log(`${n}: Stryker exit ${s.code}, ${Math.round(s.ms / 1000)} s`);
	if (s.code !== 0) {
		console.error(tidy(s.out).slice(-6000));
		process.exit(1);
	}
	copyFileSync(join(tree, "reports/mutation122.json"), join(WORK, n, "mutation.json"));
	writeFileSync(
		join(WORK, n, "mutate.json"),
		JSON.stringify({mutate, copies, withAgent, testFiles, related}, null, 2),
	);
};

interface VitestJson {
	readonly testResults: readonly {
		readonly name: string;
		readonly status: string;
		readonly message?: string;
		readonly assertionResults: readonly {
			readonly fullName: string;
			readonly status: string;
			readonly location?: {readonly line: number};
		}[];
	}[];
}

/** One mutant, as Stryker's command runner calls it: the related tests of each package, once. */
const mutant = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const id = process.env.__STRYKER_ACTIVE_MUTANT__ ?? "none";
	const tree = dirOf(n, "mutate");
	const related: Record<string, string[]> = JSON.parse(
		readFileSync(join(WORK, n, "related.json"), "utf8"),
	);
	let failed = false;
	for (const [pkg, files] of Object.entries(related)) {
		if (files.length === 0) continue;
		const out = join(WORK, n, "rows", `${id}-${basename(pkg)}.json`);
		const x = run(
			join(tree, pkg, "node_modules/.bin/vitest"),
			["run", ...files, "--reporter=json", `--outputFile=${out}`],
			join(tree, pkg),
			{timeoutMs: 110_000},
		);
		if (x.code !== 0) failed = true;
	}
	process.exit(failed ? 1 : 0);
};

// ---------------------------------------------------------------- counting the kills

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

/** Every test that failed on one mutant, as `file#full name`; a file that would not load is `file#`. */
const killersOf = (n: string, id: string): readonly string[] => {
	const tree = dirOf(n, "mutate");
	const rows = join(WORK, n, "rows");
	const out: string[] = [];
	for (const f of readdirSync(rows).filter((x) => x.startsWith(`${id}-`))) {
		const json: VitestJson = JSON.parse(readFileSync(join(rows, f), "utf8"));
		for (const file of json.testResults) {
			const rel = relative(tree, file.name);
			const failing = file.assertionResults.filter((x) => x.status === "failed");
			for (const x of failing) out.push(`${rel}#${x.fullName}`);
			if (file.status === "failed" && failing.length === 0) out.push(`${rel}#`);
		}
	}
	return out;
};

/** Mulberry32, seeded: the same sample every time. */
const sampleOf = (ids: readonly string[]): ReadonlySet<string> => {
	let s = SAMPLE_SEED;
	const next = () => {
		s = (s + 0x6d2b79f5) | 0;
		let r = Math.imul(s ^ (s >>> 15), 1 | s);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
	};
	const xs = [...ids].sort((a, b) => Number(a) - Number(b));
	for (let i = xs.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		const a = xs[i] ?? "";
		xs[i] = xs[j] ?? "";
		xs[j] = a;
	}
	return new Set(xs.slice(0, SAMPLE_SIZE));
};

type Set3 = "a" | "b" | "c" | "kept";

/** Each test of one file, by its full name, with the source text from its line to the next test's. */
const testsIn = (n: string, rel: string): ReadonlyMap<string, string> => {
	const tree = dirOf(n, "mutate");
	const pkg = rel.split("/").slice(0, 2).join("/");
	const out = join(WORK, n, `tests-${rel.replaceAll("/", "_")}.json`);
	if (!existsSync(out))
		run(
			join(tree, pkg, "node_modules/.bin/vitest"),
			[
				"run",
				rel.slice(pkg.length + 1),
				"--reporter=json",
				`--outputFile=${out}`,
				"--includeTaskLocation",
			],
			join(tree, pkg),
			{timeoutMs: 10 * 60_000},
		);
	const json: {
		testResults: {
			assertionResults: {fullName: string; location?: {line: number}}[];
		}[];
	} = JSON.parse(readFileSync(out, "utf8"));
	const tests = json.testResults
		.flatMap((x) => x.assertionResults)
		.map((x) => ({name: x.fullName, line: x.location?.line ?? 0}))
		.sort((a, b) => a.line - b.line);
	const lines = readFileSync(join(tree, rel), "utf8").split("\n");
	return new Map(
		tests.map((x, i) => [
			x.name,
			lines
				.slice(x.line - 1, (tests[i + 1]?.line ?? lines.length + 1) - 1)
				.map((l) => l.trim())
				.join("\n"),
		]),
	);
};

/**
 * Which set a killing test is in, from its Stryker id (`file#full name`).
 * - a: a test that existed at baseSha: every test of a file the PR did not touch, and every test
 *   of the base copies of the files it did.
 * - b: a test the PR added (its name is not in the base copy) or changed (its text differs).
 * - c: the agent's test.
 * - kept: the merged copy of a test the PR left as it was; the same test is in a, by its base copy.
 */
const setsOf = (n: string, r: Replay) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const prTests = new Set(r.filesChanged.filter((f) => f.kind === "test").map((f) => f.path));
	const merged = new Map<string, ReadonlyMap<string, string>>();
	const based = new Map<string, ReadonlyMap<string, string>>();
	const why = new Map<string, string>();
	const classify = (id: string): Set3 => {
		const [file = "", ...rest] = id.split("#");
		const name = rest.join("#");
		if (file === t.test) return "c";
		if (!prTests.has(file)) return "a";
		if (!merged.has(file)) merged.set(file, testsIn(n, file));
		const copy = file.replace(/\.test\.ts$/, BASE_COPY);
		if (!based.has(file))
			based.set(
				file,
				existsSync(join(dirOf(n, "mutate"), copy)) ? testsIn(n, copy) : new Map<string, string>(),
			);
		const mine = merged.get(file) ?? new Map<string, string>();
		const old = based.get(file) ?? new Map<string, string>();
		const kind =
			name === ""
				? "file would not load"
				: !mine.has(name)
					? "not found"
					: !old.has(name)
						? "added"
						: old.get(name) === mine.get(name)
							? "kept"
							: "changed";
		why.set(id, kind);
		return kind === "kept" ? "kept" : "b";
	};
	return {classify, why};
};

const count = (n: string) => {
	const file = join(WORK, n, "mutation.json");
	if (!existsSync(file)) return null;
	const report: Report = JSON.parse(readFileSync(file, "utf8"));
	const r = replayOf(n);
	const tree = dirOf(n, "mutate");
	const relOf = (f: string) => (f.startsWith(tree) ? f.slice(tree.length + 1) : f);
	const {classify, why} = setsOf(n, r);
	const set = new Map<string, Set3>();
	const all = Object.entries(report.files).flatMap(([f, {mutants}]) =>
		mutants.map((m) => ({...m, file: relOf(f)})),
	);
	const sampled = all.length > SAMPLE_SIZE ? sampleOf(all.map((m) => m.id)) : null;
	const ms = sampled === null ? all : all.filter((m) => sampled.has(m.id));
	const rows = ms.map((m) => {
		const killers = m.status === "CompileError" ? [] : killersOf(n, m.id);
		for (const id of killers) if (!set.has(id)) set.set(id, classify(id));
		const by = new Set(killers.map((id) => set.get(id) ?? "a"));
		return {
			id: m.id,
			file: m.file,
			line: m.location.start.line,
			mutator: m.mutatorName,
			replacement: (m.replacement ?? "").slice(0, 120),
			status: m.status,
			a: by.has("a") || by.has("kept"),
			b: by.has("b"),
			c: by.has("c"),
			killers: killers.length,
			byAgent: killers
				.filter((id) => set.get(id) === "c")
				.map((id) => id.split("#").slice(1).join("#")),
		};
	});
	const valid = rows.filter((x) => x.status !== "CompileError");
	const killed = valid.filter((x) => x.status === "Killed" || x.status === "Timeout");
	const tally = {
		total: all.length,
		counted: rows.length,
		sampled: sampled !== null,
		refused: rows.filter((x) => x.status === "CompileError").length,
		valid: valid.length,
		statuses: Object.fromEntries(
			[...new Set(rows.map((x) => x.status))].map((s) => [
				s,
				rows.filter((x) => x.status === s).length,
			]),
		),
		killed: killed.length,
		byA: valid.filter((x) => x.a).length,
		byB: valid.filter((x) => x.b).length,
		byC: valid.filter((x) => x.c).length,
		cNotA: valid.filter((x) => x.c && !x.a).length,
		cNotB: valid.filter((x) => x.c && !x.b).length,
		bNotC: valid.filter((x) => x.b && !x.c).length,
		bNotA: valid.filter((x) => x.b && !x.a).length,
		cNotAB: valid.filter((x) => x.c && !x.a && !x.b).length,
		abNotC: valid.filter((x) => (x.a || x.b) && !x.c).length,
		killedNoTest: killed.filter((x) => x.killers === 0).length,
		survived: valid.filter((x) => x.status === "Survived" || x.status === "NoCoverage").length,
	};
	const tests = Object.fromEntries(
		["a", "b", "c", "kept"].map((k) => [k, [...set.values()].filter((v) => v === k).length]),
	);
	const changedWhy = Object.fromEntries(
		["added", "changed", "kept", "not found", "file would not load"].map((k) => [
			k,
			[...why.values()].filter((v) => v === k).length,
		]),
	);
	return {tally, tests, changedWhy, rows};
};

// ---------------------------------------------------------------- the report

const result = (n: string) => {
	const t = TICKETS[n];
	if (t === undefined) throw new Error(`no ticket ${n}`);
	const read = (name: string) => {
		const f = join(WORK, n, name);
		return existsSync(f) ? readFileSync(f, "utf8") : null;
	};
	const events = parseEvents(read("writer.json") ?? "");
	const res = events.findLast((e) => e.type === "result");
	const init = events.find((e) => e.type === "system" && e.subtype === "init");
	const u = res?.usage ?? {};
	const grade = read("grade.json");
	const mutate = read("mutate.json");
	return {
		ticket: `kamp-us/demlik#${n}`,
		pr: `https://github.com/kamp-us/demlik/pull/${replayOf(n).pr.number}`,
		promise: t.promise,
		is: "new",
		test: t.test,
		writer:
			res === undefined
				? null
				: {
						model: Object.keys(res.modelUsage ?? {}),
						asked: MODEL,
						tools: init?.tools ?? null,
						turns: res.num_turns,
						error: res.is_error,
						costUsd: res.total_cost_usd,
						tokens: {
							input: u.input_tokens ?? 0,
							output: u.output_tokens ?? 0,
							cacheRead: u.cache_read_input_tokens ?? 0,
							cacheWrite: u.cache_creation_input_tokens ?? 0,
						},
						ms: res.duration_ms,
						apiMs: res.duration_api_ms,
						denied: res.permission_denials ?? [],
						answer: tidy(res.result ?? ""),
						transcript: readTranscript(n),
					},
		grade: grade === null ? null : JSON.parse(grade),
		testSource: existsSync(join(dirOf(n, "writer"), t.test))
			? readFileSync(join(dirOf(n, "writer"), t.test), "utf8")
			: null,
		mutate: mutate === null ? null : JSON.parse(mutate),
		mutants: count(n),
		minutes: Object.fromEntries(
			Object.entries(JSON.parse(read("times.json") ?? "{}")).map(([k, v]) => [
				k,
				Math.round((Number(v) / 60_000) * 10) / 10,
			]),
		),
	};
};

const report = () => {
	const out = {
		experiment: 122,
		date: new Date().toISOString().slice(0, 10),
		stryker: STRYKER,
		sample: {seed: SAMPLE_SEED, size: SAMPLE_SIZE},
		claudeCode: run("claude", ["--version"], WORK).stdout.trim(),
		tickets: Object.keys(TICKETS)
			.filter((n) => existsSync(join(WORK, n)))
			.map(result),
	};
	writeFileSync(RESULTS, `${tidy(JSON.stringify(out, null, "\t"))}\n`);
	for (const x of out.tickets)
		console.log(
			`${x.ticket}: red ${x.grade?.red} green ${x.grade?.green} $${x.writer?.costUsd} ${JSON.stringify(x.mutants?.tally)}`,
		);
	console.log(`wrote ${RESULTS.replace(ROOT, "")}`);
};

// ---------------------------------------------------------------- main

if (WORK === "" || WORK.startsWith(ROOT)) {
	console.error("WORK must name a scratch folder outside this repository");
	process.exit(1);
}
const [step, n = ""] = process.argv.slice(2);
mkdirSync(join(WORK, n), {recursive: true});
if (step === "setup") setup(n);
else if (step === "write") write(n);
else if (step === "grade") grade(n);
else if (step === "mutants") mutants(n);
else if (step === "mutant") mutant(n);
else if (step === "report") report();
else if (step === "prompt") console.log(promptOf(n));
else
	console.error(
		`unknown step ${step}; one of setup, write, grade, mutants, mutant, report, prompt`,
	);
