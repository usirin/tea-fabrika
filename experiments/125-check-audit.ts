// Experiment 125: every check that can turn main red. Where its rule came from, and how often it
// raised a false alarm. This script does the counting; the reading and the verdicts are in
// 125-check-audit.md.
//
//   node experiments/125-check-audit.ts          # counts from the working tree and git history
//   CI=1 node experiments/125-check-audit.ts     # also reads this repo's CI runs through gh, read-only
//   PR44=origin/<PR 44's branch> ...           # also reads PR 44's dead-export ledger, fetched first
//
// It writes experiments/results/125-check-audit.json. It changes no check and no file but that
// one. No agent, no model, no Jev, no key. Network only with CI=1.

import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "experiments/results/125-check-audit.json");
/** The fetched head of PR 44 (`git fetch origin <its branch>`, then `PR44=origin/<its branch>`). */
const PR_BRANCH = process.env.PR44 ?? "";

function run(cmd: string, args: readonly string[]): string {
	return execFileSync(cmd, args, {cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28});
}

/** Tracked files, the folders biome leaves out left out here too. */
const files = run("git", ["ls-files"])
	.split("\n")
	.filter((f) => f !== "")
	.filter((f) => !/^(blog|video|biome-plugins)\//.test(f) && !f.includes("/fixtures/"))
	.filter((f) => !f.startsWith("experiments/results/"));
const code = files.filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f));

function area(file: string): string {
	if (file.startsWith("experiments/")) return "experiments";
	if (file.startsWith("legacy/")) return "legacy";
	if (file.startsWith("packages/") || file.startsWith("programs/") || file.startsWith("packs/"))
		return "packages";
	return "other";
}

// 1. Every biome-ignore today, and which custom rule it quiets. A plugin ignore names only
// `lint/plugin`, so the rule is read from the line it sits on.
type Ignore = {file: string; line: number; rule: string; area: string; reason: string};
function pluginOf(next: string): string {
	if (/\bas (unknown|never) as\b/.test(next)) return "no-type-assertions";
	if (/Effect\.(promise|tryPromise)\(/.test(next)) return "no-effect-promise";
	if (/^\s*try \{/.test(next)) return "no-raw-try-catch";
	if (/node:sqlite/.test(next)) return "no-node-sqlite-test-backing";
	return "unknown";
}
const ignores: Ignore[] = [];
for (const file of code) {
	const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
	lines.forEach((text, i) => {
		const m = /biome-ignore\s+lint\/([A-Za-z/]+):\s*(.*)$/.exec(text);
		if (m === null) return;
		const rule = m[1] === "plugin" ? `plugin/${pluginOf(lines[i + 1] ?? "")}` : (m[1] ?? "");
		ignores.push({file, line: i + 1, rule, area: area(file), reason: m[2] ?? ""});
	});
}
const ignoresBy = (key: (i: Ignore) => string) =>
	ignores.reduce<Record<string, number>>((acc, i) => {
		acc[key(i)] = (acc[key(i)] ?? 0) + 1;
		return acc;
	}, {});

// 2. biome-ignore lines added and removed over main's history.
const history = run("git", [
	"log",
	"origin/main",
	"-p",
	"--format=@@commit %h %ad",
	"--date=short",
	"-G",
	"biome-ignore",
	"--",
	".",
	":!blog",
	":!video",
	":!biome-plugins",
	":!*.md",
]);
let added = 0;
let removed = 0;
const commitsAdding = new Set<string>();
let current = "";
for (const line of history.split("\n")) {
	if (line.startsWith("@@commit ")) current = line.slice(9);
	else if (/^\+(?!\+\+).*biome-ignore/.test(line)) {
		added++;
		commitsAdding.add(current);
	} else if (/^-(?!--).*biome-ignore/.test(line)) removed++;
}

// 3. Other quieting: Effect's diagnostics, TypeScript's own.
const count = (re: RegExp, among: readonly string[]) =>
	among.reduce((n, f) => n + (readFileSync(join(ROOT, f), "utf8").match(re)?.length ?? 0), 0);
const quieted = {
	effectDiagnostics: count(/@effect-diagnostics/g, code),
	tsExpectError: count(/@ts-expect-error/g, code),
	tsIgnore: count(/@ts-ignore/g, code),
	tsNocheck: count(/@ts-nocheck/g, code),
};

// 4. The layer gate's allowlist and the boundary rules.
const layers = JSON.parse(readFileSync(join(ROOT, "layer-rules.json"), "utf8")) as {
	layers: readonly {name: string}[];
	allowed: readonly {from: string; to: string; reason: string}[];
};
const allowedTo = layers.allowed.reduce<Record<string, number>>((acc, a) => {
	acc[a.to] = (acc[a.to] ?? 0) + 1;
	return acc;
}, {});
const layerCommits = run("git", [
	"log",
	"origin/main",
	"--format=%h %ad %s",
	"--date=short",
	"--",
	"layer-rules.json",
	"boundary-rules.json",
])
	.split("\n")
	.filter((l) => l !== "");

// 5. "Every machine has laws": which machines the suite looks at.
const COVERED = [/^packages\/pipeline\/src\//, /^packages\/fabrika\/src\/agents\//];
const machines = code
	.filter((f) => !f.endsWith(".test.ts"))
	.map((f) => ({
		file: f,
		count: readFileSync(join(ROOT, f), "utf8").split("defineMachine(").length - 1,
	}))
	.filter((m) => m.count > 0)
	.map((m) => ({...m, covered: COVERED.some((re) => re.test(m.file))}));
const sum = (ms: readonly {count: number}[]) => ms.reduce((n, m) => n + m.count, 0);

// 6. Time limits written into tests, against vitest's 5 s default.
const tests = code.filter((f) => f.endsWith(".test.ts"));
const timeouts = {
	thirdArgument: count(/\},\s*\d[\d_]*\s*\)/g, tests),
	optionTimeout: count(/\btimeout:\s*\d/g, tests),
	configTestTimeout: count(/testTimeout/g, ["vitest.config.ts"]),
};

// 7. The promises gate: records, and every commit that touched one.
const promises = files.filter((f) => f.startsWith("promises/") && f.endsWith(".json"));
const promiseCommits = run("git", [
	"log",
	"origin/main",
	"--format=%h %ad %s",
	"--date=short",
	"--",
	"promises",
])
	.split("\n")
	.filter((l) => l !== "");

// 8. PR 44's dead-export ledger, if its branch is fetched.
function ledger(): {entries: number; reasons: Record<string, number>} | null {
	if (PR_BRANCH === "" || run("git", ["branch", "-r", "--list", PR_BRANCH]).trim() === "")
		return null;
	const j = JSON.parse(run("git", ["show", `${PR_BRANCH}:unreachable-ledger.json`])) as {
		entries: readonly {id: string; reason: string}[];
	};
	const reasons = j.entries.reduce<Record<string, number>>((acc, e) => {
		const key = e.id.startsWith("video/") ? "in the finished video" : "called in its own file";
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
	return {entries: j.entries.length, reasons};
}
const dead = ledger();

// 9. CI runs on this repo. The cause of each red main push is read from the commit that turned
// it green again (the logs of most runs are gone): written here by hand, with that commit.
const CAUSES: Readonly<Record<string, {cause: string; fixedBy: string; falseAlarm: boolean}>> = {
	af1fdee: {cause: "CI being set up: install", fixedBy: "ed3e3d0", falseAlarm: false},
	ed3e3d0: {cause: "CI being set up: pnpm pin", fixedBy: "075eb56", falseAlarm: false},
	"075eb56": {
		cause: "runner had no expect or zsh, node:test output, whole-world search under 5 s",
		fixedBy: "7b4e440",
		falseAlarm: true,
	},
	"7b4e440": {
		cause: "unknown: the log is gone",
		fixedBy: "3d326c6, a feature commit",
		falseAlarm: false,
	},
	a06a26a: {
		cause:
			"inferred, log gone: tea-host walks over vitest's 5 s default (d16846b says they took 7 to 12 s under load); green again at c43d876 before any fix",
		fixedBy: "d16846b",
		falseAlarm: true,
	},
	"21cd0b8": {
		cause: "ship-pbt planted-mistake test over vitest's 5 s default",
		fixedBy: "1687d65",
		falseAlarm: true,
	},
	"159a08d": {cause: "same test, same limit", fixedBy: "1687d65", falseAlarm: true},
	"21831fb": {cause: "same test, same limit (log read)", fixedBy: "1687d65", falseAlarm: true},
	"2b72f2d": {cause: "same test, same limit", fixedBy: "1687d65", falseAlarm: true},
	bcb3008: {cause: "same test, same limit (log read)", fixedBy: "1687d65", falseAlarm: true},
};
function ci() {
	const runs = JSON.parse(
		run("gh", [
			"run",
			"list",
			"--limit",
			"1000",
			"--json",
			"databaseId,conclusion,headBranch,event,headSha",
		]),
	) as {
		databaseId: number;
		conclusion: string;
		headBranch: string;
		event: string;
		headSha: string;
	}[];
	const red = runs
		.filter((r) => r.conclusion === "failure")
		.map((r) => {
			const v = JSON.parse(run("gh", ["run", "view", String(r.databaseId), "--json", "jobs"])) as {
				jobs: {steps: {name: string; conclusion: string}[]}[];
			};
			const step = v.jobs
				.flatMap((j) => j.steps)
				.filter((s) => s.conclusion === "failure")
				.map((s) => s.name)
				.join(",");
			const sha = r.headSha.slice(0, 7);
			return {
				branch: r.headBranch === "main" ? "main" : "not main",
				event: r.event,
				sha,
				step,
				...(CAUSES[sha] ?? {}),
			};
		});
	const mainPush = runs.filter((r) => r.headBranch === "main" && r.event === "push");
	return {
		runs: runs.length,
		red: red.length,
		mainPushRuns: mainPush.length,
		mainPushRed: mainPush.filter((r) => r.conclusion === "failure").length,
		redRuns: red,
	};
}

const results = {
	head: run("git", ["rev-parse", "--short", "HEAD"]).trim(),
	ignores: {
		total: ignores.length,
		byRule: ignoresBy((i) => i.rule),
		byRuleAndArea: ignoresBy((i) => `${i.rule} @ ${i.area}`),
		list: ignores,
	},
	ignoreHistory: {added, removed, commitsAdding: commitsAdding.size},
	quieted,
	layers: {
		layers: layers.layers.length,
		allowed: layers.allowed.length,
		allowedTo,
		commits: layerCommits,
	},
	machines: {
		files: machines.length,
		calls: sum(machines),
		covered: sum(machines.filter((m) => m.covered)),
		notCovered: machines.filter((m) => !m.covered),
	},
	timeouts,
	promises: {records: promises.length, commits: promiseCommits},
	deadLedgerOnPr44: dead,
	ci: process.env.CI === "1" ? ci() : "not read (run with CI=1)",
};
writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
console.log(
	JSON.stringify({...results, ignores: {...results.ignores, list: "(in the file)"}}, null, 2),
);
