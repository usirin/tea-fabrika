// Experiment 107: a repository that is not demlik (step S9). Does the pipeline assume demlik's
// setup? Each piece a repository may lack, or set up its own way, gets a named refusal or a
// named default, printed before anything runs. Write-up: 107-a-repo-that-is-not-demlik.md.
//
// ONLY: a comma list of table|lines (default both; neither spends anything).
//   table  every assumption a run made of demlik, each as a fixture: what the repository holds
//          and what its fabrika.toml says. Each must give the line or the refusal in the
//          table of the write-up, and no fixture may crash.
//   lines  the tsh lines of the real runs, printed for the record; it runs none of them.
//
// The real runs are tsh lines, started from a folder holding a tsh.toml that names the sandbox
// repository (the `lines` part prints them). They ran against a fresh sandbox repository, with
// real haiku agents; their outcomes are in results/107-a-repo-that-is-not-demlik.json under
// `real`, kept when this script writes the table again.
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {Effect} from "effect";
import {
	DEFAULT_SETTINGS,
	type Settings,
	settingsFrom,
} from "../packages/fabrika/src/pipeline/settings.ts";
import {
	type Holds,
	type Local,
	setupLines,
	setupOf,
} from "../packages/fabrika/src/pipeline/setup.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/107-a-repo-that-is-not-demlik.json");
const only = new Set((process.env.ONLY ?? "table,lines").split(","));

/** Kept across invocations: the real runs' rows stay when the table is written again. */
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};

const NOTHING_SAID: Local = {model: null, effort: null, budget: null, rubrics: null};
const PLACES = {shipped: "<fabrika>/rubrics", repo: "<home>/rubrics/<commit>"};
const holding = (...files: string[]): Holds => ({files: new Set(files), rubrics: {}});
/** A fresh npm repository: a lockfile and nothing else fabrika reads. */
const NPM = holding("package-lock.json");

/** One assumption: what a run took for granted on demlik, as a fixture. */
interface Row {
	readonly assumption: string;
	readonly toml: string;
	readonly holds: Holds;
	readonly local?: Local;
	/** The line the run prints, by its key, must hold this. */
	readonly line?: {readonly key: string; readonly says: string};
	/** Or: the file is refused, with a message that holds this. */
	readonly refused?: string;
}

const ROWS: readonly Row[] = [
	{
		assumption: "pnpm installs a fresh copy",
		toml: "",
		holds: NPM,
		line: {key: "build.install", says: "npm ci (default: package-lock.json at main)"},
	},
	{
		assumption: "a repository has a lockfile",
		toml: "",
		holds: holding(),
		line: {key: "build.install", says: "none (default: no lockfile at main)"},
	},
	{
		assumption: "one lockfile only",
		toml: "",
		holds: holding("pnpm-lock.yaml", "package-lock.json"),
		line: {key: "build.install", says: "also package-lock.json, not read"},
	},
	{
		assumption: "the builder knows the check commands",
		toml: "",
		holds: NPM,
		line: {key: "build.checks", says: "the builder is told to find the repository's checks itself"},
	},
	{
		assumption: "the builder is told the repository's own checks",
		toml: '[build]\nchecks = [["npm", "test"]]',
		holds: NPM,
		line: {key: "build.checks", says: "npm test (from fabrika.toml)"},
	},
	{
		assumption: "the ready-for:agent label lets a ticket be built",
		toml: "",
		holds: NPM,
		line: {key: "build.go", says: "plan (default)"},
	},
	{
		assumption: "a repository that keeps the label",
		toml: '[build]\ngo = "label"\nlabel = "ready"',
		holds: NPM,
		line: {
			key: "build.go",
			says: "label (from fabrika.toml): a ticket is built when it carries ready",
		},
	},
	{
		assumption: "a label and a plan both read",
		toml: '[build]\nlabel = "ready"',
		holds: NPM,
		refused: "build.label",
	},
	{
		assumption: "one model, effort and budget for every agent",
		toml: '[agents.build]\nmodel = "haiku"\nusd = 0.4',
		holds: NPM,
		local: {model: null, effort: "high", budget: null, rubrics: null},
		line: {
			key: "agents.build",
			says: "haiku (from fabrika.toml), effort high (from tsh.toml), at most $0.4 a run (from fabrika.toml)",
		},
	},
	{
		assumption: "an agent step nobody wrote",
		toml: "",
		holds: NPM,
		line: {
			key: "agents.plan",
			says: "opus (default), effort medium (default), at most $2 a run (default)",
		},
	},
	{
		assumption: "an agent step that is not one",
		toml: '[agents.triage]\nmodel = "haiku"',
		holds: NPM,
		refused: "agents",
	},
	{
		assumption: "a budget of nothing",
		toml: "[agents.build]\nusd = 0",
		holds: NPM,
		refused: "agents.build.usd",
	},
	{
		assumption: "CI on GitHub reports the checks",
		toml: "",
		holds: NPM,
		line: {key: "checks.github", says: "checks wait for ever: add a [[checks.run]]"},
	},
	{
		assumption: "fabrika runs the checks itself where there is no CI",
		toml: '[checks]\ngithub = "none"\n[[checks.run]]\nname = "test"\nrun = ["npm", "test"]',
		holds: NPM,
		line: {
			key: "checks.run",
			says: "test = npm test (from fabrika.toml): run by fabrika at each head",
		},
	},
	{
		assumption: "no check at all counts as passing",
		toml: '[checks]\ngithub = "none"',
		holds: NPM,
		refused: "checks",
	},
	{
		assumption: "a CODEOWNERS file says whose approval",
		toml: "",
		holds: NPM,
		line: {key: "ship.approval", says: "ship stops at approval_unknown"},
	},
	{
		assumption: "CODEOWNERS at the root counts",
		toml: "",
		holds: holding("package-lock.json", "CODEOWNERS"),
		line: {key: "ship.approval", says: "(CODEOWNERS is not read)"},
	},
	{
		assumption: "a repository that needs no approval",
		toml: '[ship]\napproval = "none"',
		holds: NPM,
		line: {
			key: "ship.approval",
			says: "a .github/CODEOWNERS at a change's base names an owner, which still binds",
		},
	},
	{
		assumption: ".fabrika.jsonc says which reviews a change owes",
		toml: "",
		holds: NPM,
		line: {
			key: "review kinds",
			says: "no .fabrika.jsonc at main, so governed [] and ui [] (default): text reviews only",
		},
	},
	{
		assumption: "the governed paths, with no .fabrika.jsonc",
		toml: '[review]\ngoverned = [".github/"]',
		holds: NPM,
		line: {key: "review kinds", says: "governed [.github/] and ui [] (from fabrika.toml)"},
	},
	{
		assumption: "rubrics are a folder on this machine",
		toml: "",
		holds: NPM,
		line: {key: "review.rubrics", says: "default: the rubrics fabrika ships"},
	},
	{
		assumption: "a repository's rubric folder holds every kind",
		toml: '[review]\nrubrics = "docs/rubrics"',
		holds: {files: new Set(["package-lock.json"]), rubrics: {"code.md": "x"}},
		line: {
			key: "review.rubrics",
			says: "doc.md is not in the repository's folder: a change of that kind stops at rubric_unknown",
		},
	},
	{
		assumption: "a rubric folder outside the repository",
		toml: '[review]\nrubrics = "../elsewhere"',
		holds: NPM,
		refused: "review.rubrics",
	},
	{
		assumption: "CLAUDE.md holds the rules for agents",
		toml: "",
		holds: NPM,
		line: {key: "rules: CLAUDE.md", says: "none at main: agents are told the repository has none"},
	},
	{
		assumption: "the ledger is the Durable Object on this machine",
		toml: "",
		holds: NPM,
		line: {key: "ledger.at", says: "local (default)"},
	},
	{
		assumption: "a repository that keeps its ledger in a file",
		toml: '[ledger]\nat = "sqlite"',
		holds: NPM,
		line: {key: "ledger.at", says: "sqlite (from fabrika.toml)"},
	},
	{
		assumption: "a ledger nobody has",
		toml: '[ledger]\nat = "postgres"',
		holds: NPM,
		refused: "ledger.at",
	},
];

type Got =
	| {readonly row: string; readonly ok: true; readonly said: string}
	| {readonly row: string; readonly ok: false; readonly said: string; readonly wanted: string};

const judge = (row: Row): Got => {
	const read = Effect.runSync(Effect.result(settingsFrom(row.toml)));
	if (read._tag === "Failure") {
		const said = read.failure.why;
		return row.refused !== undefined && said.includes(row.refused)
			? {row: row.assumption, ok: true, said}
			: {
					row: row.assumption,
					ok: false,
					said,
					wanted: row.refused ?? `a line under ${row.line?.key}`,
				};
	}
	const settings: Settings = read.success;
	const lines = setupLines(
		setupOf(settings, row.holds, row.local ?? NOTHING_SAID, PLACES),
		row.holds,
		settings,
	);
	const said = lines.filter((line) => line.startsWith(row.line?.key ?? "\0")).join("\n");
	if (row.line === undefined)
		return {row: row.assumption, ok: false, said, wanted: `refused at ${row.refused}`};
	return said.includes(row.line.says)
		? {row: row.assumption, ok: true, said}
		: {row: row.assumption, ok: false, said, wanted: row.line.says};
};

const table = () => {
	// The defaults alone first: a repository with no fabrika.toml must still print every line.
	const bare = setupLines(
		setupOf(DEFAULT_SETTINGS, NPM, NOTHING_SAID, PLACES),
		NPM,
		DEFAULT_SETTINGS,
	);
	console.log("A fresh npm repository with no fabrika.toml:");
	for (const line of bare) console.log(`  ${line}`);
	const got = ROWS.map((row) => {
		// biome-ignore lint/plugin: node at the edge: a fixture that throws is a finding, counted, not a stop
		try {
			return {...judge(row), crashed: false};
		} catch (cause) {
			return {
				row: row.assumption,
				ok: false,
				said: String(cause),
				wanted: "no crash",
				crashed: true,
			};
		}
	});
	console.log(
		`\n${got.filter((g) => g.ok).length} of ${got.length} assumptions give their named line or refusal`,
	);
	for (const g of got) if (!g.ok) console.log(`  MISS ${g.row}: said ${JSON.stringify(g.said)}`);
	results.table = {
		rows: got.length,
		ok: got.filter((g) => g.ok).length,
		crashed: got.filter((g) => g.crashed).length,
		bare,
		got,
	};
};

/** The sandbox repository, as owner/name; the write-up and results call it <sandbox>. */
const SANDBOX = process.env.SANDBOX ?? "<sandbox>";
const lines = () => {
	const ticket = (n: number) => `https://github.com/${SANDBOX}/issues/${n}`;
	const LINES = {
		start: 'tsh.toml: repo, work, own (the account that opens pull requests), ship = "write"',
		pass: [
			`plan ticket=${ticket(1)} | desk`,
			`answer --ask 'plan:${SANDBOX}#1@1' --reply /approve`,
			`operate ticket=${ticket(1)}`,
		],
		gate: [
			`plan ticket=${ticket(3)} | desk`,
			`operate ticket=${ticket(3)}   # before the approval`,
		],
		fault: [
			`answer --ask 'plan:${SANDBOX}#3@1' --reply /approve`,
			`operate ticket=${ticket(3)}   # with a gh first on PATH that lands a commit on main just before the merge commit is made`,
		],
	};
	console.log(JSON.stringify(LINES, null, 2));
	results.lines = LINES;
};

if (only.has("table")) table();
if (only.has("lines")) lines();
writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
