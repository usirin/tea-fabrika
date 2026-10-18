// Experiment 87: Given/When/Then as our moves, on four closed demlik tickets.
//
// Each ticket has a folder in `87-scenarios/`: a `.feature` written from the
// issue text alone, and `steps.ts`, its glue. `lib/` holds the steps any ticket
// can use and `lib/moves.ts`, which makes every step say which move it is.
// This script runs each ticket's scenarios at the commit before its fix (base)
// and at the fix's merge commit (merge), and counts the glue.
//
// Run with
//   node experiments/87-scenarios.ts
//       counts only: steps per Gherkin word and move, glue lines per file. No
//       clone, no network, writes nothing.
//   DEMLIK=<a clone of kamp-us/demlik> node experiments/87-scenarios.ts
//       also runs every ticket at base and merge, in a detached worktree of
//       that clone under CACHE, removed at the end (KEEP=1 keeps it). Writes
//       `results/87-scenarios.json`. TICKET=<id> runs one ticket only.
//
// No model, no key, no Jev: the run spends $0. The worktree needs
// `pnpm install` per commit, and quickpickle is installed once into CACHE
// (default `runs/exp-87-cache`) with npm, since demlik does not depend on it.
//
// Node at the edge, said out loud: `node:child_process` for git, pnpm, npm and
// vitest, `node:fs` for the copies and the results file. No Effect here: the
// script is a shell session written down.
import {spawnSync} from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {join, resolve} from "node:path";

const HERE = resolve(import.meta.dirname, "87-scenarios");
const CACHE = resolve(process.env.CACHE ?? "runs/exp-87-cache");
const OUT = resolve(import.meta.dirname, "results", "87-scenarios.json");

interface Ticket {
	readonly id: string;
	readonly folder: string;
	readonly pkg: string;
	readonly kind: "bug" | "feature";
	readonly base: string;
	readonly merge: string;
}

// The base is the merge commit's first parent: main just before the fix.
const TICKETS: readonly Ticket[] = [
	{
		id: "709",
		folder: "709-move-extensions",
		pkg: "structure-sweep",
		kind: "bug",
		base: "bb5d563",
		merge: "4f6eb70",
	},
	{
		id: "692",
		folder: "692-terminal-save",
		pkg: "tea",
		kind: "bug",
		base: "e608bdd",
		merge: "854e0dc",
	},
	{
		id: "631",
		folder: "631-effect-cmd",
		pkg: "tea",
		kind: "feature",
		base: "9915b2e",
		merge: "f4d0c71",
	},
	{
		id: "686",
		folder: "686-composition-root",
		pkg: "code-graph",
		kind: "feature",
		base: "8d2276c",
		merge: "752bfd1",
	},
];

// ------------------------------------------------------------ counts, from the source

const glueFiles = () => [
	"lib/moves.ts",
	"lib/common.ts",
	...TICKETS.map((t) => `${t.folder}/steps.ts`),
	"vitest.config.ts",
];

/** Lines that are code: not blank, not only a comment. */
const codeLines = (text: string) =>
	text.split("\n").filter((l) => l.trim() !== "" && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;

function counts() {
	const lines = Object.fromEntries(
		glueFiles().map((f) => [f, codeLines(readFileSync(join(HERE, f), "utf8"))]),
	);
	const moves: Record<string, number> = {};
	for (const f of glueFiles().filter((f) => f.endsWith("steps.ts") || f === "lib/common.ts")) {
		for (const m of readFileSync(join(HERE, f), "utf8").matchAll(
			/\b(Given|When|Then)\(\s*"(\w+)"/g,
		)) {
			const key = `${m[1]} ${m[2]}`;
			moves[key] = (moves[key] ?? 0) + 1;
		}
	}
	const scenarioSteps = Object.fromEntries(
		TICKETS.map((t) => {
			const feature = readdirSync(join(HERE, t.folder)).find((f) => f.endsWith(".feature")) ?? "";
			const text = readFileSync(join(HERE, t.folder, feature), "utf8");
			return [
				t.id,
				text.split("\n").filter((l) => /^\s*(Given|When|Then|And|But) /.test(l)).length,
			];
		}),
	);
	return {glueLines: lines, stepsByWordAndMove: moves, featureStepLines: scenarioSteps};
}

// ------------------------------------------------------------ runs, in a scratch worktree

function sh(cwd: string, cmd: string, args: readonly string[], env: Record<string, string> = {}) {
	const run = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		env: {...process.env, ...env},
		maxBuffer: 1 << 28,
	});
	return {code: run.status ?? -1, out: `${run.stdout}${run.stderr}`};
}

function must(cwd: string, cmd: string, args: readonly string[]) {
	const run = sh(cwd, cmd, args);
	if (run.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${run.out.slice(-2000)}`);
	return run.out;
}

/** A folder whose node_modules holds quickpickle, made once. */
function quickpickle(): string {
	const dir = join(CACHE, "qp");
	if (!existsSync(join(dir, "node_modules", "quickpickle"))) {
		mkdirSync(dir, {recursive: true});
		// Its own package.json, or npm climbs to the repo's and stops at `catalog:`.
		writeFileSync(join(dir, "package.json"), '{"name": "exp-87-qp", "private": true}\n');
		must(dir, "npm", [
			"install",
			"--no-package-lock",
			"quickpickle@1.11.2",
			"@cucumber/gherkin@32.2.0",
		]);
	}
	return join(dir, "node_modules");
}

interface Scenario {
	readonly name: string;
	readonly tag: string;
	readonly status: "green" | "red";
	readonly why: string;
}

interface Run {
	readonly ticket: string;
	readonly side: "base" | "merge";
	readonly sha: string;
	readonly seconds: number;
	readonly scenarios: readonly Scenario[];
	readonly steps: readonly {
		readonly word: string;
		readonly move: string;
		readonly pattern: string;
		readonly from: string;
	}[];
}

/** The first line of a failure that says something: quickpickle's own lines say only "a step failed". */
function why(messages: readonly string[]): string {
	const lines = messages
		.join("\n")
		.split("\n")
		.map((l) => l.trim())
		.filter(
			(l) => l !== "" && !/^(at |Error: Scenario finished|Scenario finished|❯|\d+\|)/.test(l),
		);
	return scrub(lines.find((l) => !/\(#\d+\)$/.test(l)) ?? lines[0] ?? "");
}

/** Absolute paths cut to their last part: this file is committed, and machine paths stay out. */
const scrub = (line: string) =>
	line.replace(/(^|[\s"'(])\/(?:[^\s/"']+\/)+([^\s/"':]+)/g, "$1…/$2");

function runSide(tree: string, qp: string, t: Ticket, side: "base" | "merge"): Run {
	const sha = t[side];
	const target = join(tree, "packages", t.pkg, "scen87");
	rmSync(target, {recursive: true, force: true});
	must(tree, "git", ["checkout", "-q", "-f", sha]);
	must(tree, "nice", ["-n", "19", "pnpm", "install", "--frozen-lockfile", "--prefer-offline"]);
	cpSync(HERE, target, {recursive: true});
	cpSync(qp, join(target, "node_modules"), {recursive: true});
	const report = join(CACHE, `vitest-${t.id}-${side}.json`);
	const stepLog = join(CACHE, `steps-${t.id}-${side}.jsonl`);
	rmSync(stepLog, {force: true});
	const started = Date.now();
	sh(
		join(tree, "packages", t.pkg),
		"nice",
		[
			"-n",
			"19",
			"./node_modules/.bin/vitest",
			"run",
			"--config",
			"scen87/vitest.config.ts",
			"--reporter=json",
			`--outputFile=${report}`,
		],
		{TICKET: t.folder, STEP_LOG: stepLog},
	);
	const seconds = Math.round((Date.now() - started) / 100) / 10;
	const json = JSON.parse(readFileSync(report, "utf8")) as {
		testResults: {assertionResults: {title: string; status: string; failureMessages: string[]}[]}[];
	};
	const logged = existsSync(stepLog)
		? readFileSync(stepLog, "utf8")
				.split("\n")
				.filter((l) => l !== "")
				.map((l) => JSON.parse(l) as Record<string, string>)
		: [];
	const failures = logged.filter((l) => l.failed !== undefined);
	const scenarios = json.testResults
		.flatMap((r) => r.assertionResults)
		.map((a): Scenario => {
			const tag = /\((@\w+)\)\s*$/.exec(a.title)?.[1] ?? "";
			const name = a.title.replace(/\s*\(@\w+\)\s*$/, "");
			const bare = name.replace(/^Scenario( Outline)?: /, "");
			const failed = failures.find((f) => f.scenario === bare);
			return {
				name,
				tag,
				status: a.status === "passed" ? "green" : "red",
				why:
					a.status === "passed"
						? ""
						: failed !== undefined
							? scrub(`${failed.failed}: ${failed.message?.split("\n")[0] ?? ""}`)
							: why(a.failureMessages) || "no step failed: an undefined step or a hook",
			};
		});
	const seen = new Set<string>();
	const steps = logged
		.filter((l) => l.failed === undefined)
		.filter((l) => !seen.has(JSON.stringify(l)) && seen.add(JSON.stringify(l)))
		.map((l) => ({
			word: l.word ?? "",
			move: l.move ?? "",
			pattern: l.pattern ?? "",
			from: l.from ?? "",
		}));
	rmSync(target, {recursive: true, force: true});
	return {ticket: t.id, side, sha, seconds, scenarios, steps};
}

/** Per ticket: the steps it ran, how many came from lib/, how many another ticket ran too. */
function reuse(runs: readonly Run[]) {
	const byTicket = new Map<string, Set<string>>();
	for (const r of runs) {
		const set = byTicket.get(r.ticket) ?? new Set<string>();
		for (const s of r.steps) set.add(`${s.from}\t${s.word} ${s.pattern}`);
		byTicket.set(r.ticket, set);
	}
	return [...byTicket].map(([ticket, used]) => {
		const others = [...byTicket].filter(([t]) => t !== ticket).flatMap(([, s]) => [...s]);
		return {
			ticket,
			stepsRun: used.size,
			fromLib: [...used].filter((s) => s.startsWith("lib/")).length,
			sharedWithAnotherTicket: [...used].filter((s) => others.includes(s)).length,
		};
	});
}

function main() {
	const counted = counts();
	console.log(JSON.stringify(counted, null, 2));
	const demlik = process.env.DEMLIK;
	if (demlik === undefined) return;

	mkdirSync(CACHE, {recursive: true});
	const qp = quickpickle();
	const tree = join(CACHE, "demlik");
	if (!existsSync(tree))
		must(resolve(demlik), "git", ["worktree", "add", "--detach", tree, "HEAD"]);
	const picked = TICKETS.filter(
		(t) => process.env.TICKET === undefined || t.id === process.env.TICKET,
	);
	const runs: Run[] = [];
	const started = Date.now();
	try {
		for (const t of picked) {
			for (const side of ["base", "merge"] as const) {
				const run = runSide(tree, qp, t, side);
				runs.push(run);
				const red = run.scenarios.filter((s) => s.status === "red").length;
				console.log(
					`${t.id} ${side} ${run.sha}: ${run.scenarios.length - red} green, ${red} red, ${run.seconds}s`,
				);
				for (const s of run.scenarios)
					console.log(
						`  ${s.status.padEnd(5)} ${s.tag.padEnd(7)} ${s.name}${s.why ? `\n        ${s.why}` : ""}`,
					);
			}
		}
	} finally {
		if (process.env.KEEP !== "1")
			must(resolve(demlik), "git", ["worktree", "remove", "--force", tree]);
	}
	const result = {
		date: new Date().toISOString().slice(0, 10),
		tickets: picked,
		wallSeconds: Math.round((Date.now() - started) / 1000),
		...counted,
		reuse: reuse(runs),
		runs,
	};
	mkdirSync(resolve(OUT, ".."), {recursive: true});
	writeFileSync(OUT, `${JSON.stringify(result, null, "\t")}\n`);
	console.log(JSON.stringify(result.reuse, null, 2));
}

main();
