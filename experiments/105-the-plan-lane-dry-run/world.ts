// Experiment 105's world, as a host process sees it: every service the lane and its children read
// and write, over the fake GitHub (./fake.ts, in the harness process), and scripted agents. As in
// 104, every scripted turn takes 300 ms and bills a fixed sum, so a kill 100 ms into a turn lands
// inside it, and a wasted turn shows on the ledger's bill.
//
// The repository is a small pnpm workspace shaped like demlik's, where #700 was built: a package
// that moves files (`structure-sweep`) and one it may depend on (`move-core`). The plan is #700's
// as demlik built it (draft PR #708): three tasks, each touching the files its commit touched there.
//
// The scripted agents work from marks. Every criterion the planner writes ends with `(mark:<m>)`;
// the builder writes the line `// mark:<m>` into the file that mark belongs to, for every criterion
// its brief names and every one the last review left open; the reviewer passes a criterion only when
// an added line of the diff it is handed carries its mark. A scenario (env SCENARIO) bends one rule:
//
//   A   task 1's first round leaves one mark out (a failed review); task 3's first round drops task
//       2's marks from the file they share (the last review reopens task 2)
//   B   task 3 never writes one of its marks (a stuck task)
//   C   no bend: the happy path, for a kill
//
// Node at the edge: pnpm and git through execFileSync, in the scripted builder and the template.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {Duration, Effect, Layer, Option, Schedule, Schema, Stream} from "effect";
import type {LocalCheck} from "../../packages/fabrika/src/pipeline/code-host-local.ts";
import type {Spend} from "../../packages/fabrika/src/pipeline/draft.ts";
import {LocalChecks} from "../../packages/fabrika/src/pipeline/hosted/review-local.ts";
import {CodeHost} from "../../packages/fabrika/src/pipeline/services.ts";
import {Builder} from "../../packages/fabrika/src/pipeline/stages/build/form.ts";
import {builtBy} from "../../packages/fabrika/src/pipeline/stages/build/scripted.ts";
import type {PlanDraft} from "../../packages/fabrika/src/pipeline/stages/plan/plan.ts";
import {
	PlanFacts,
	PlanHost,
	type PlanMsg,
	Planner,
} from "../../packages/fabrika/src/pipeline/stages/plan/services.ts";
import type {Brief} from "../../packages/fabrika/src/pipeline/stages/review/gate.ts";
import type {Drafted} from "../../packages/fabrika/src/pipeline/stages/review/reviewer.ts";
import {scriptedReviewer} from "../../packages/fabrika/src/pipeline/stages/review/scripted.ts";
import type {Form} from "../../packages/fabrika/src/pipeline/stages/review/sheet.ts";
import type {SortAnswer} from "../../packages/fabrika/src/pipeline/stages/sort/answer.ts";
import {Sorter, type SortMsg} from "../../packages/fabrika/src/pipeline/stages/sort/services.ts";
import {issueUrl, REPO, type Seed} from "./fake.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

export const SCENARIOS = ["A", "B", "C"] as const;
export type Scenario = (typeof SCENARIOS)[number];
const scenario = (): Scenario => (process.env.SCENARIO ?? "C") as Scenario;

/** What one scripted turn bills. */
export const TURN_USD = 0.1;
const TURN = Duration.millis(300);
const spendOf = (usd: number): Spend => ({
	costUsd: usd,
	tokens: 100,
	context: 50,
	turns: 2,
	minutes: 0.01,
});
const ran = (usd: number) => ({spend: spendOf(usd), tools: [], refused: [], links: 0});

// ---------------------------------------------------------------- git and pnpm

const GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
const ME = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com"];
const git = (args: readonly string[], cwd: string) =>
	execFileSync("git", [...GIT, ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
/** The lockfile made again from the manifests, from nothing but the workspace: no network. */
export const relock = (tree: string) =>
	execFileSync("pnpm", ["install", "--lockfile-only", "--offline", "--ignore-scripts"], {
		cwd: tree,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

// ---------------------------------------------------------------- the repository

const SWEEP = "packages/structure-sweep";
const PKG = `${SWEEP}/package.json`;
const sweepPackage = `{
	"name": "@demo/structure-sweep",
	"version": "0.0.0",
	"description": "Moves files between folders and packages.",
	"license": "MIT",
	"private": true,
	"type": "module"
}
`;

const FILES: Record<string, string> = {
	"package.json": `${JSON.stringify({name: "demo", private: true, version: "0.0.0"}, null, "\t")}\n`,
	"pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
	".fabrika.jsonc": '{"governedRoots": []}\n',
	"AGENTS.md": "# Agents\n\nKeep each change to the task it is for.\n",
	".changeset/README.md": "Changesets go here.\n",
	"packages/move-core/package.json": `${JSON.stringify({name: "@demo/move-core", version: "0.0.0", private: true, type: "module"}, null, "\t")}\n`,
	"packages/move-core/src/index.ts": "export const core = 1;\n",
	[PKG]: sweepPackage,
	[`${SWEEP}/README.md`]: "# structure-sweep\n\nMoves files between folders.\n",
	[`${SWEEP}/src/move/apply.ts`]: "export const apply = () => [];\n",
	[`${SWEEP}/src/move/entries.ts`]: "export const entries = () => [];\n",
};

const put = (tree: string, path: string, text: string) => {
	mkdirSync(dirname(join(tree, path)), {recursive: true});
	writeFileSync(join(tree, path), text);
};

/** A fresh repository for every run to clone: the workspace, its lockfile, one commit on main. */
export const makeTemplate = (dir: string): string => {
	const tree = mkdtempSync(join(dir, "template-"));
	git(["init", "-q", "-b", "main"], tree);
	for (const [path, text] of Object.entries(FILES)) put(tree, path, text);
	relock(tree);
	put(tree, ".gitignore", "node_modules\n");
	git(["add", "-A"], tree);
	git([...ME, "commit", "-q", "-m", "the workspace"], tree);
	return tree;
};

/**
 * Main moves on with a change of its own to the same manifest, at its other end, and a new
 * package: git merges the manifest, and leaves only the lockfile in conflict.
 */
export const mainMove = (tree: string) => {
	put(
		tree,
		"packages/aa-shared/package.json",
		`${JSON.stringify({name: "@demo/aa-shared", version: "0.0.0", private: true, type: "module"}, null, "\t")}\n`,
	);
	const pkg = readFileSync(join(tree, PKG), "utf8");
	put(
		tree,
		PKG,
		pkg.replace(
			'\t"type": "module"\n}',
			'\t"type": "module",\n\t"devDependencies": {\n\t\t"@demo/aa-shared": "workspace:*"\n\t}\n}',
		),
	);
	relock(tree);
};

// ---------------------------------------------------------------- the tickets

export const PLAN_NUMBER = 700;
export const SEEDS: readonly Seed[] = [
	{
		number: 700,
		title: "structure-sweep move apply can't move a file into another workspace package",
		body: [
			"`structure-sweep move apply` moves files between folders of one package. A row that moves a",
			"file into another workspace package breaks the workspace: the importers keep a relative path",
			"into the other package, and the target package does not depend on the source.",
			"",
			"Wanted: a move across packages refuses cleanly until it is supported; then it writes the",
			"imports through the target package's exports, and adds the `workspace:*` dependency the move",
			"needs, with the lockfile made again, refusing a move that would make a cycle.",
		].join("\n"),
	},
	{
		number: 709,
		title: "move apply drops .ts and .js extensions in rewritten imports",
		body: "A rewritten import loses its extension.",
		state: "closed",
	},
];
/** Filed while the plan runs: one sort folds into it, one is a duplicate of a closed ticket. */
export const LATER: Record<number, Seed> = {
	707: {
		number: 707,
		title: "workspace map silently misses brace globs and ./-prefixed rows",
		body: [
			"Found while reviewing the refusal for #700: the workspace map reads `packages/*` but not",
			"`packages/{a,b}` nor `./packages/*`. A move into such a package is not refused.",
		].join("\n"),
	},
	711: {
		number: 711,
		title: "move apply drops the .js extension",
		body: "An import of `./x.js` comes out as `./x`. The same bug as #709, seen again.",
	},
};

// ---------------------------------------------------------------- sort

const SORTED: Record<number, SortAnswer> = {
	700: {
		answer: "yes",
		next: "plan",
		partOf: null,
		why: "A change in three steps: it needs a plan.",
	},
	707: {
		answer: "yes",
		next: "plan",
		partOf: 700,
		why: "A case the open plan for #700 must cover: its refusal reads the same workspace map.",
	},
	711: {answer: "duplicate", of: 709, why: "Both report an import that loses its extension."},
};
const numberOfName = (key: string) => Number(key.slice(key.lastIndexOf(":") + 1));

/** The scripted sorter: 300 ms, $0.10 a try, the ticket's answer. */
export const scriptedSorter = Layer.succeed(Sorter, {
	run: (run) =>
		Stream.fromEffect(
			Effect.gen(function* () {
				yield* Effect.sleep(TURN);
				const sort = SORTED[numberOfName(run.key)];
				if (sort === undefined) return yield* Effect.die(`no answer for ${run.key}`);
				return {
					type: "sort_finished",
					key: run.key,
					id: run.id,
					output: {sort},
					session: "s",
					spend: spendOf(TURN_USD),
				} satisfies SortMsg;
			}),
		),
});

// ---------------------------------------------------------------- the plan

const S = ["mover"] as const;
const claim = (when: string, result: string, mark: string) => ({
	when,
	result: `${result} (mark:${mark})`,
	check: {how: "test" as const, what: "a test of move apply on a fixture workspace"},
	serves: S,
});
const job = (when: string, result: string, mark: string, fixture: string) => ({
	...claim(when, result, mark),
	fixture,
});

const T1 = "Refuse a move that crosses a workspace package";
const T2 = "Write imports across packages through the target's exports";
const T3 = "Add the workspace dependency a move across packages needs";
const BRACES = claim(
	"the workspace file names packages with a brace glob or a ./ prefix",
	"every package it names is in the workspace map that move apply reads",
	"t1-braces",
);

/** #700's plan as demlik built it: three tasks and a goal. `folded`: version 2, with #707 in. */
export const planDraft = (folded: boolean): PlanDraft => ({
	summary:
		"structure-sweep move apply moves files into another workspace package: it refuses such a move first, then writes the imports through the target's exports and adds the workspace dependency.",
	stories: [
		{
			id: "mover",
			who: "someone who reorganizes a pnpm workspace with structure-sweep",
			want: "to move a file into another package with one command",
			why: "so the workspace still builds after the move",
		},
	],
	tasks: [
		{
			title: T1,
			ends: "pr",
			job: job(
				"someone applies a move plan of five rows, two of them into another package, twice",
				"the two rows are refused with the package they cross, the three others move, and the second run moves nothing",
				"t1-job",
				"a workspace of three packages and a five-row plan, applied twice",
			),
			criteria: [
				claim(
					"a row moves a file into another workspace package",
					"the file stays where it was, with a message saying the row crosses a package",
					"t1-refuse",
				),
				claim(
					"move apply refuses a row",
					"its message names the package the row would cross into",
					"t1-reason",
				),
				...(folded ? [BRACES] : []),
			],
		},
		{
			title: T2,
			ends: "pr",
			job: job(
				"someone moves three files into another package that exports them",
				"every importer imports them through the package name, and the workspace typechecks",
				"t2-job",
				"three files with five importers across two packages",
			),
			criteria: [
				claim(
					"a moved file is exported by the target package",
					"its importers in other packages import it by the package's name",
					"t2-exports",
				),
				claim(
					"a moved file is not exported by the target package",
					"the file stays where it was, with a message naming the missing export",
					"t2-entry",
				),
			],
		},
		{
			title: T3,
			ends: "pr",
			job: job(
				"someone moves files into a package their importers do not depend on yet, then runs the move again",
				"each importing package gains one workspace:* dependency, the lockfile is made again, and the second run adds nothing",
				"t3-job",
				"four importers in three packages, the move run twice",
			),
			criteria: [
				claim(
					"an importing package does not depend on the target",
					"its package.json lists a workspace:* dependency on the target",
					"t3-dep",
				),
				claim(
					"a new dependency would make a cycle between packages",
					"the file stays where it was, with a message naming the cycle",
					"t3-cycle",
				),
			],
		},
	],
	goal: {
		job: job(
			"someone moves a folder of six files from one package into another, then builds and tests the workspace",
			"the move needs no hand edit: the workspace installs, typechecks and passes its tests",
			"goal-job",
			"six files, two packages, eight importers",
		),
		criteria: [
			claim(
				"someone reads the package's readme",
				"it says how a move across packages works and when it is refused",
				"goal-readme",
			),
		],
	},
	pointers: [{at: `${SWEEP}/src/move/apply.ts`, why: "where a move is applied"}],
	questions: [],
});

/** The scripted planner: 300 ms, $0.10; version 2 once the ticket it reads has #707 folded in. */
export const scriptedPlanner = Layer.succeed(Planner, {
	run: (run) =>
		Stream.fromEffect(
			Effect.sleep(TURN).pipe(
				Effect.as<PlanMsg>({
					type: "plan_finished",
					key: run.key,
					id: run.id,
					output: planDraft(run.prompt.includes("# Folded in: #707")),
					session: "s",
					spend: spendOf(TURN_USD),
				}),
			),
		),
});

// ---------------------------------------------------------------- the builder

const MARK = /\(mark:([\w-]+)\)/;
const markOf = (text: string) => MARK.exec(text)?.[1] ?? null;
const markFile = (mark: string): string =>
	mark.startsWith("t1-")
		? `${SWEEP}/src/move/workspace.ts`
		: mark.startsWith("t2-")
			? `${SWEEP}/src/move/crossing.ts`
			: mark.startsWith("t3-")
				? `${SWEEP}/src/move/dependencies.ts`
				: `${SWEEP}/README.md`;
const markLine = (mark: string) =>
	markFile(mark).endsWith(".md") ? `<!-- mark:${mark} -->` : `// mark:${mark}`;

/** The files each task's commit touched in #708, as the builder touches them here. */
export const TASK_FILES: Record<"t1" | "t2" | "t3", readonly string[]> = {
	t1: [
		".changeset/structure-sweep-workspace-refusal.md",
		`${SWEEP}/README.md`,
		PKG,
		`${SWEEP}/src/move/apply.ts`,
		`${SWEEP}/src/move/workspace.ts`,
		`${SWEEP}/test/move-workspace.test.ts`,
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
	],
	t2: [
		".changeset/structure-sweep-cross-package-rewrite.md",
		".changeset/structure-sweep-workspace-refusal.md",
		`${SWEEP}/README.md`,
		`${SWEEP}/src/move/apply.ts`,
		`${SWEEP}/src/move/crossing.ts`,
		`${SWEEP}/src/move/entries.ts`,
		`${SWEEP}/test/move-cross-package.test.ts`,
		`${SWEEP}/test/move-exports.test.ts`,
		`${SWEEP}/test/move-workspace.test.ts`,
	],
	t3: [
		".changeset/structure-sweep-workspace-dependencies.md",
		`${SWEEP}/README.md`,
		`${SWEEP}/src/move/apply.ts`,
		`${SWEEP}/src/move/crossing.ts`,
		`${SWEEP}/src/move/dependencies.ts`,
		`${SWEEP}/test/move-cross-package.test.ts`,
		`${SWEEP}/test/move-workspace-deps.test.ts`,
	],
};
const taskOfTitle = (title: string): "t1" | "t2" | "t3" | null =>
	title === T1 ? "t1" : title === T2 ? "t2" : title === T3 ? "t3" : null;

const read = (tree: string, path: string) =>
	existsSync(join(tree, path)) ? readFileSync(join(tree, path), "utf8") : "";
const comment = (path: string, text: string) =>
	path.endsWith(".md") ? `<!-- ${text} -->` : path.endsWith(".yaml") ? `# ${text}` : `// ${text}`;
const appendLine = (tree: string, path: string, line: string) => {
	const was = read(tree, path);
	if (was.split("\n").includes(line)) return;
	put(tree, path, `${was}${was === "" || was.endsWith("\n") ? "" : "\n"}${line}\n`);
};

/** One task's round, in its copy: the task's files touched, and the marks it owes. */
const buildIn = (
	tree: string,
	task: "t1" | "t2" | "t3",
	round: number,
	marks: readonly string[],
) => {
	const s = scenario();
	const skip = (m: string) =>
		(s === "A" && m === "t1-reason" && task === "t1" && round === 1) ||
		(s === "B" && m === "t3-cycle");
	for (const path of TASK_FILES[task]) {
		if (path === "pnpm-lock.yaml" || path === PKG) continue;
		if (task === "t2" && path === ".changeset/structure-sweep-workspace-refusal.md") {
			rmSync(join(tree, path), {force: true});
			continue;
		}
		appendLine(tree, path, comment(path, `${task}, round ${round}`));
	}
	if (task === "t1") {
		const pkg = read(tree, PKG);
		if (!pkg.includes("@demo/move-core")) {
			put(
				tree,
				PKG,
				pkg.replace(
					'\t"version": "0.0.0",\n',
					'\t"version": "0.0.0",\n\t"dependencies": {\n\t\t"@demo/move-core": "workspace:*"\n\t},\n',
				),
			);
			relock(tree);
		}
	}
	for (const m of marks) if (!skip(m)) appendLine(tree, markFile(m), markLine(m));
	// Task 3's first round in scenario A rewrites the file it shares with task 2, losing task 2's marks.
	if (s === "A" && task === "t3" && round === 1) {
		const shared = `${SWEEP}/src/move/crossing.ts`;
		put(
			tree,
			shared,
			read(tree, shared)
				.split("\n")
				.filter((l) => !l.includes("mark:t2-"))
				.join("\n"),
		);
	}
};

/** The scripted builder: 300 ms, $0.10, the task's files and marks written in its copy. */
export const scriptedBuilder = Layer.succeed(Builder, {
	build: (brief) =>
		Effect.gen(function* () {
			yield* Effect.sleep(TURN);
			const task = taskOfTitle(brief.title);
			if (task === null)
				return {answer: "broke" as const, error: `no task ${brief.title}`, ...ran(TURN_USD)};
			const marks = [...brief.criteria.map((c) => c.text), ...brief.open.map((i) => i.text)]
				.map(markOf)
				.filter((m): m is string => m !== null);
			yield* Effect.sync(() => buildIn(brief.tree, task, brief.round, [...new Set(marks)]));
			return {
				answer: "built" as const,
				built: builtBy(`${task} round ${brief.round}: ${marks.length} marks`),
				...ran(TURN_USD),
			};
		}).pipe(Effect.orDie),
});

// ---------------------------------------------------------------- the reviewer

/** The lines a diff adds, each with its file. */
const added = (diff: string) => {
	const out: {file: string; text: string}[] = [];
	let file = "";
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
		else if (line.startsWith("+")) out.push({file, text: line.slice(1)});
	}
	return out;
};

const formOf = (brief: Brief): Form => {
	const lines = added(brief.diff);
	const graded = brief.criteria.map((c) => {
		const m = markOf(c.text);
		const at = m === null ? undefined : lines.find((l) => l.text.includes(`mark:${m}`));
		return {c, m, at};
	});
	return {
		rows: graded.map(({c, m, at}) =>
			at === undefined && m !== null
				? {id: c.id, grade: "fail" as const, where: [], says: `No line carries mark ${m}.`}
				: {
						id: c.id,
						grade: "pass" as const,
						where: at === undefined ? [] : [{file: at.file, first: 1, last: 1}],
						says: m === null ? "Nothing to mark." : `The change carries mark ${m}.`,
						limit: null,
					},
		),
		// A failed criterion says what has to change, as the form's Check asks.
		findings: graded.flatMap(({c, m, at}) =>
			at === undefined && m !== null
				? [
						{
							kind: "review-code" as const,
							from: {source: "criterion" as const, id: c.id},
							fault: `The change has no line for this criterion (mark ${m}).`,
							at: null,
							proof: `No added line of the diff carries mark:${m}.`,
							wants: `An added line that carries mark:${m}.`,
						},
					]
				: [],
		),
		skipped: [{what: "The tests", why: "A scripted review reads marks only."}],
	};
};

/** The scripted reviewer: 300 ms, $0.10, a criterion passes when its mark is in an added line. */
export const scriptedReview = scriptedReviewer(
	(brief): Drafted => ({answer: "form", form: formOf(brief), ...ran(TURN_USD)}),
	{hold: Effect.sleep(TURN)},
).layer;

// ---------------------------------------------------------------- the fake, over HTTP

const call = (fake: string, body: Record<string, unknown>) =>
	Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${fake}/call`, {method: "POST", body: JSON.stringify(body)});
			const json: {answer?: unknown} = await res.json();
			return json.answer;
		},
		catch: (): Failed => ({_tag: "unknown"}),
	});
const ask = (fake: string, fn: string, args: Record<string, unknown>) => call(fake, {fn, args});
const as =
	<A>(schema: Schema.Codec<A, unknown>) =>
	(u: unknown) =>
		Schema.decodeUnknownEffect(schema)(u).pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));

const IssueRead = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: Schema.Literals(["open", "closed"]),
});

/** The plan stage's reads: the ticket from the fake, and a line of facts. */
export const fakePlanReads = (fake: string) =>
	Layer.mergeAll(
		Layer.succeed(PlanHost, {
			ticket: (url) =>
				ask(fake, "issue", {issue: url}).pipe(
					Effect.flatMap(as(IssueRead)),
					Effect.map((i) => ({url, ...i, at: null})),
				),
		}),
		Layer.succeed(PlanFacts, {
			gather: () =>
				Effect.succeed({
					text: "move apply lives in packages/structure-sweep; the workspace file lists packages/*.",
					names: [],
				}),
		}),
	);

const ShipRead = Schema.Struct({
	head: Schema.String,
	state: Schema.Literals(["open", "merged"]),
	checks: Schema.Literals(["green", "pending"]),
	passed: Schema.Boolean,
	main: Schema.Struct({tested: Schema.String, tip: Schema.String}),
});
const LandingOf = Schema.Union([
	Schema.Struct({at: Schema.Literals(["none", "queued"])}),
	Schema.Struct({at: Schema.Literals(["merged"]), commit: Schema.String}),
]);

/** Ship's `CodeHost` over the fake: the pull request as it stands, its verdict comment, its checks. */
export const shipCodeHost = (fake: string) =>
	Layer.succeed(CodeHost, {
		prFacts: (pr) =>
			ask(fake, "shipFacts", {pr}).pipe(
				Effect.flatMap(as(ShipRead)),
				Effect.map((p) => ({
					head: p.head,
					state: p.state,
					ours: true,
					ticket: {id: issueUrl(PLAN_NUMBER), link: "closes_it" as const},
					approval: "not_needed" as const,
					reviews: [
						{
							kind: "review-code" as const,
							verdict: p.passed ? ("passed" as const) : ("missing" as const),
						},
					] as const,
					checks: p.checks,
					mergeable: "clean" as const,
					comments: [],
					main: p.main,
				})),
			),
		change: () => failed,
		checksSettled: () => Stream.succeed(undefined),
		leftQueue: (pr, head) =>
			Stream.fromEffect(
				ask(fake, "landing", {pr, head}).pipe(
					Effect.flatMap(as(LandingOf)),
					Effect.map((l) => (l.at === "merged" ? Option.some(l.commit) : Option.none<string>())),
					Effect.orElseSucceed(() => Option.none<string>()),
					Effect.repeat({until: Option.isSome, schedule: Schedule.spaced(Duration.millis(100))}),
					Effect.map((c) => ({reading: "landed" as const, commit: Option.getOrElse(c, () => "")})),
				),
			),
	});

/** The one check a local review runs at the head: the lockfile agrees with every manifest. */
export const LOCKFILE_CHECK: LocalCheck = {
	name: "lockfile",
	run: ["pnpm", "install", "--frozen-lockfile", "--offline", "--ignore-scripts"],
};
export const localChecks = Layer.succeed(LocalChecks, [LOCKFILE_CHECK]);

export {REPO};
