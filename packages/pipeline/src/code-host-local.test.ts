import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {noSpend} from "@kampus/fabrika/agents/claude";
import {runEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, FileSystem, Layer, Path} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {beforeAll, describe, expect, it} from "vitest";
import {memoryLedger} from "./asks/ledger.ts";
import {bookOf, foldLedger} from "./asks/rules.ts";
import {runChild} from "./child.ts";
import {type LocalSettings, localCodeHost, taskOf, taskTarget} from "./code-host-local.ts";
import {standingAt} from "./criteria/book.ts";
import {ledgerRecord} from "./criteria/record.ts";
import {type CriterionId, criterionId, planOf, storyId, taskId, ticketId, ticketOf} from "./ids.ts";
import {CodeHost} from "./services.ts";
import type {Revision} from "./stages/plan/plan.ts";
import type {Brief} from "./stages/review/gate.ts";
import {reviewTask} from "./stages/review/local.ts";
import type {Drafted} from "./stages/review/reviewer.ts";
import {RUBRICS, scriptedReviewer} from "./stages/review/scripted.ts";
import type {Form} from "./stages/review/sheet.ts";

// A plan's task reviewed on this machine, with no pull request: a bare origin
// and a working copy of a small package, the plan in the ledger, the real
// review machine, and a scripted reviewer. Each head the builder commits is
// reviewed as it lands. The checks are commands run at that exact head. A
// `gh` stand-in sits first on the PATH, so any call to GitHub from anywhere
// in the run would be heard.

const PLAN = planOf(ticketId("https://github.com/example/words/issues/9"));
const S1 = storyId("s1");
const check = {how: "test", what: "node --test"} as const;
const PLAN_DATA: Revision = {
	summary: "Words can be counted, and the longest one found.",
	stories: [
		{id: S1, who: "a writer", want: "to know how long a text is", why: "to keep to a limit"},
	],
	tasks: [
		{
			title: "Count words and find the longest",
			ends: "pr",
			job: {
				when: "a writer counts three paragraphs",
				result: "each count is the number of words written",
				check,
				serves: [S1],
				fixture: "three paragraphs of 3, 5 and 8 words",
			},
			criteria: [
				{when: "a text is empty", result: "its count is 0", check, serves: [S1]},
				{
					when: "a text has one longest word",
					result: "longest returns that word",
					check,
					serves: [S1],
				},
			],
		},
		{
			title: "Print the count",
			ends: "pr",
			job: {
				when: "a writer runs the cli on a file",
				result: "it prints the count",
				check,
				serves: [S1],
				fixture: "a file of 12 words",
			},
			criteria: [],
		},
	],
	pointers: [],
	questions: [],
};
const [C1, C2, C3, C4] = [
	criterionId("c1"),
	criterionId("c2"),
	criterionId("c3"),
	criterionId("c4"),
];
const T1 = taskId("t1");
const TASK = taskTarget(PLAN, T1);

const BASE_FILES: Readonly<Record<string, string>> = {
	"package.json": '{"name": "words", "private": true, "type": "module"}\n',
	"src/words.js": "export const count = (text) => text.split(/\\s+/).filter(Boolean).length;\n",
	"test/words.test.js": [
		'import assert from "node:assert/strict";',
		'import {test} from "node:test";',
		'import {count} from "../src/words.js";',
		"",
		'test("counts words", () => assert.equal(count("a b  c"), 3));',
		"",
	].join("\n"),
	"AGENTS.md": "# Rules\n\nEvery change comes with a test.\n",
	".fabrika.jsonc": "{}\n",
};
const WORDS = [
	"export const count = (text) => text.split(/\\s+/).filter(Boolean).length;",
	"export const longest = (text) =>",
	'\ttext.split(/\\s+/).reduce((best, word) => (word.length > best.length ? word : best), "");',
	"",
].join("\n");
const testWith = (longestSays: string) =>
	[
		'import assert from "node:assert/strict";',
		'import {test} from "node:test";',
		'import {count, longest} from "../src/words.js";',
		"",
		'test("counts words", () => assert.equal(count("a b  c"), 3));',
		'test("an empty text has no words", () => assert.equal(count(""), 0));',
		`test("finds the longest word", () => assert.equal(longest("a bbb cc"), "${longestSays}"));`,
		"",
	].join("\n");

const SETTINGS = (repo: string): LocalSettings => ({
	repo,
	base: "origin/main",
	checks: [
		{name: "test", run: ["node", "--test"]},
		{name: "syntax", run: ["node", "--check", "src/words.js"]},
	],
});

// ---------------------------------------------------------------- the fixture

/** For the fixture's own commits: no hook, no signing, no config of the machine's. */
const FIXTURE_ENV = {
	...runEnv(),
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "builder",
	GIT_AUTHOR_EMAIL: "builder@example.com",
	GIT_COMMITTER_NAME: "builder",
	GIT_COMMITTER_EMAIL: "builder@example.com",
};
/** Effect's platform services, as `@effect/platform-node` gives them: the fixture's files and its git. */
const onNode = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
	>,
) => Effect.runPromise(effect.pipe(Effect.provide(nodeServices)));
const sh = (cwd: string, file: string, args: readonly string[]) =>
	runChild(file, args, {cwd, env: FIXTURE_ENV}).pipe(
		Effect.flatMap((ran) =>
			ran.code === 0
				? Effect.succeed(ran.out.trim())
				: Effect.die(new Error(`${file} ${args.join(" ")} failed: ${ran.err}`)),
		),
	);
const write = (dir: string, files: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		for (const [name, text] of Object.entries(files)) {
			yield* fs.makeDirectory(path.dirname(path.join(dir, name)), {recursive: true});
			yield* fs.writeFileString(path.join(dir, name), text);
		}
	});
/** Commit everything in `dir`, and answer the new head. */
const commit = (dir: string, files: Readonly<Record<string, string>>, message: string) =>
	Effect.gen(function* () {
		yield* write(dir, files);
		yield* sh(dir, "git", ["add", "-A"]);
		yield* sh(dir, "git", ["commit", "-q", "--no-verify", "-m", message]);
		return yield* sh(dir, "git", ["rev-parse", "HEAD"]);
	});

interface World {
	readonly root: string;
	/** The task's working copy, on the plan's one branch. */
	readonly task: string;
	readonly ghCalls: string;
	readonly path: string | undefined;
}
let world: World;

beforeAll(async () => {
	world = await onNode(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectory({prefix: "local-review-"});
			const ghCalls = path.join(root, "gh-calls");
			const bin = path.join(root, "bin");
			yield* write(bin, {gh: `#!/bin/sh\necho "$@" >> "${ghCalls}"\nexit 1\n`});
			yield* fs.chmod(path.join(bin, "gh"), 0o755);
			yield* sh(root, "git", ["init", "-q", "--bare", "origin.git"]);
			yield* sh(root, "git", ["init", "-q", "main"]);
			const main = path.join(root, "main");
			yield* commit(main, BASE_FILES, "words: count");
			yield* sh(main, "git", ["remote", "add", "origin", path.join(root, "origin.git")]);
			yield* sh(main, "git", ["push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main"]);
			yield* sh(main, "git", ["fetch", "-q", "origin"]);
			const task = path.join(root, "task");
			yield* sh(main, "git", ["worktree", "add", "-q", "-b", "plan/9", task, "origin/main"]);
			return {root, task, ghCalls, path: process.env.PATH};
		}),
	);
	// The stand-in comes first on the PATH for the rest of this file: every process started here finds it.
	process.env.PATH = `${world.root}/bin:${world.path ?? ""}`;
	// Undone after this file's tests. Vitest runs it only if the set-up got this far, so a set-up
	// that failed shows its own error, not a second one from undoing what was never made.
	return async () => {
		process.env.PATH = world.path;
		await onNode(
			Effect.gen(function* () {
				yield* (yield* FileSystem.FileSystem).remove(world.root, {recursive: true});
			}),
		);
	};
});

// ---------------------------------------------------------------- the reviewer

const RAN = {spend: noSpend, tools: ["Read"], refused: [], links: 0};
const row = (id: CriterionId) => ({
	id,
	grade: "pass" as const,
	where: [{file: "src/words.js", first: 1, last: 3}],
	says: "The test shows it.",
	limit: null,
});
const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((c) => row(c.id)),
	findings: [],
	skipped: [],
});
/** c3 fails: `longest` keeps the first of two equal words, and no test pins which. */
const failingC3 = (brief: Brief): Form => ({
	rows: brief.criteria.map((c) =>
		c.id === C3
			? {
					id: C3,
					grade: "fail" as const,
					where: [],
					says: "No test gives a text with a longest word.",
				}
			: row(c.id),
	),
	findings: [
		{
			kind: "review-code",
			from: {source: "criterion", id: C3},
			fault: "No test pins what longest returns.",
			at: {file: "test/words.test.js", first: 1, last: 7},
			proof: "The tests call count only.",
			wants: "A test that longest returns the one longest word.",
		},
	],
	skipped: [],
});

// ---------------------------------------------------------------- the user's job

describe("a plan's task, reviewed on this machine as each head lands", () => {
	it("keeps each review's rows in the ledger under the task's criterion ids, at that head, and calls no gh", async () => {
		const ledger = memoryLedger([
			{type: "planned", plan: PLAN, tickets: [ticketOf(PLAN)], data: PLAN_DATA, problems: []},
		]);
		const heads: string[] = [];
		const reviewer = scriptedReviewer((brief): Drafted => ({
			answer: "form",
			form: brief.head === heads[0] ? failingC3(brief) : passing(brief),
			...RAN,
		}));
		const host = localCodeHost(SETTINGS(world.task));
		const services = Layer.mergeAll(host.layer, ledgerRecord, reviewer.layer).pipe(
			Layer.provide(ledger.layer),
		);
		const review = () =>
			Effect.runPromise(
				reviewTask(TASK, RUBRICS, {model: "opus", effort: "medium", budget: 2}).pipe(
					Effect.provide(services),
				),
			);
		const judged = () => ledger.read().flatMap((e) => (e.fact.type === "judged" ? [e.fact] : []));

		// Round 1: the task's first head, with a half-written file left in the copy. The checks run at the
		// commit, so it is not seen; the reviewer fails c3.
		heads.push(
			await onNode(
				commit(
					world.task,
					{"src/words.js": WORDS, "test/words.test.js": testWith("bbb")},
					"words: longest",
				),
			),
		);
		await onNode(write(world.task, {"src/words.js": 'throw new Error("half-written");\n'}));
		const first = await review();
		await onNode(sh(world.task, "git", ["checkout", "--", "src/words.js"]));

		expect(first.outcome).toEqual({kind: "send", to: "builder", why: "review_failed"});
		const [brief] = reviewer.briefs;
		expect(brief).toMatchObject({
			pr: TASK,
			head: heads[0],
			ticket: {id: "example/words#9", link: "part_of_it"},
			files: [
				{path: "src/words.js", kind: "review-code"},
				{path: "test/words.test.js", kind: "review-code"},
			],
			kinds: ["review-code"],
			deviations: {state: "absent"},
			checks: {
				state: "green",
				required: [
					{name: "test", state: "green"},
					{name: "syntax", state: "green"},
				],
			},
			rules: [{file: "AGENTS.md", text: BASE_FILES["AGENTS.md"]}],
		});
		// The task's own criteria, from the ledger's book: not task 2's c4.
		expect(brief?.criteria.map((c) => [c.id, c.version, c.text])).toEqual([
			[C1, 1, "When a writer counts three paragraphs, each count is the number of words written"],
			[C2, 1, "When a text is empty, its count is 0"],
			[C3, 1, "When a text has one longest word, longest returns that word"],
		]);
		expect(brief?.diff).toContain("+export const longest");
		const proof = `the review of ${TASK} at ${heads[0]}`;
		const judgedAt = (criterion: CriterionId, grade: "pass" | "fail") => ({
			criterion,
			version: 1,
			head: heads[0],
			grade,
			proof,
		});
		expect(judged()).toEqual([
			{
				type: "judged",
				plan: PLAN,
				task: T1,
				head: heads[0],
				proof,
				rows: [judgedAt(C1, "pass"), judgedAt(C2, "pass"), judgedAt(C3, "fail")],
				found: [],
			},
		]);

		// Round 2: a test that is wrong. The checks run at this head are red: no reviewer starts, no row is kept.
		heads.push(
			await onNode(
				commit(world.task, {"test/words.test.js": testWith("cc")}, "words: pin longest"),
			),
		);
		const second = await review();
		expect(second.outcome).toEqual({kind: "send", to: "builder", why: "checks_red"});
		expect(reviewer.briefs).toHaveLength(1);
		expect(judged()).toHaveLength(1);

		// Round 3: fixed. Every criterion of the task passes at this head; task 2's stays open.
		heads.push(
			await onNode(
				commit(world.task, {"test/words.test.js": testWith("bbb")}, "words: fix the pin"),
			),
		);
		const third = await review();
		expect(third.outcome).toEqual({kind: "done", part: false, head: heads[2]});
		const book = bookOf(foldLedger(ledger.read()), PLAN);
		expect(book && standingAt(book, heads[2] as string).map((s) => [s.id, s.state])).toEqual([
			[C1, "met"],
			[C2, "met"],
			[C3, "met"],
			[C4, "open"],
		]);

		// One run per head, each at the commit it was asked for; no copy is left behind; gh never ran.
		expect(host.runs().runs.map((r) => [r.asked, r.at, r.results.map((x) => x.state)])).toEqual([
			[heads[0], heads[0], ["green", "green"]],
			[heads[1], heads[1], ["red", "green"]],
			[heads[2], heads[2], ["green", "green"]],
		]);
		const trees = await onNode(sh(world.task, "git", ["worktree", "list", "--porcelain"]));
		expect(trees.split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(2);
		const ghCalled = await onNode(
			Effect.gen(function* () {
				return yield* (yield* FileSystem.FileSystem).exists(world.ghCalls);
			}),
		);
		expect(ghCalled).toBe(false);
	});
});

describe("the local code host", () => {
	it("names a task of a plan, and reads one back", () => {
		expect(taskOf(taskTarget(PLAN, taskId("t2")))).toEqual({plan: PLAN, task: "t2"});
		expect(taskOf(PLAN)).toBeNull();
		expect(taskOf(`${PLAN}/tasks/t0`)).toBeNull();
		expect(taskOf(`${PLAN}/tasks/2`)).toBeNull();
	});

	it("has no pull request to read: ship's facts fail, and nothing is guessed", async () => {
		const ledger = memoryLedger();
		const failure = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Effect.flip((yield* CodeHost).prFacts(TASK));
			}).pipe(
				Effect.provide(localCodeHost(SETTINGS(world.task)).layer),
				Effect.provide(ledger.layer),
			),
		);
		expect(failure).toEqual({_tag: "unknown"});
	});

	it("reads a plan the ledger does not hold as unknown criteria, and a target that names no task as a failure", async () => {
		const ledger = memoryLedger();
		const host = localCodeHost(SETTINGS(world.task)).layer;
		const read = (target: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* Effect.result((yield* CodeHost).change(target, null));
				}).pipe(Effect.provide(host), Effect.provide(ledger.layer)),
			);
		const unplanned = await read(TASK);
		expect(unplanned).toMatchObject({_tag: "Success", success: {criteria: null, ticket: "none"}});
		expect(await read(PLAN)).toMatchObject({_tag: "Failure", failure: {_tag: "unknown"}});
	});
});
