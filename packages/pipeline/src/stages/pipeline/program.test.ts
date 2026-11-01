import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Duration, Effect, Fiber, Layer, Option} from "effect";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import {hashOf, textOf} from "../../tickets/approval.ts";
import {nameOf} from "../../tickets/ticket.ts";
import {Tickets, ticketsOnLedger} from "../../tickets/tickets.ts";
import {fakeEnv, type GhStory, makeFakeGh, makeLaneHome} from "./lane-fixture.ts";
import {laneLayer, runLane} from "./layer.ts";

// One tracker ticket through the whole lane in this process: the real machines, the real Codex
// adapter over a fake `codex`, real git on a bare remote, real vitest and Stryker, the real box, and
// a person's answers written as the ticket window writes them. No live agent, and nothing real is
// touched. Today's version.

const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const BRIEFS = fileURLToPath(new URL("../../../../../programs/pipeline/briefs", import.meta.url));
const OWNER = "user:owner";
const NUMBER = 1;

const file = (title: string, body: string, writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(nameOf(NUMBER), writer);
		yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
			kind: "filed",
			writer,
			data: {type: "filed", title, body},
		});
	});

const read = Effect.gen(function* () {
	return yield* (yield* Tickets).read(NUMBER);
}).pipe(Effect.provide(ticketsOnLedger({kind: "agent", id: "reader", for: "owner"})));

/** Answers every ask as a person, with `picks[kind]` or its first pick, until the fiber is stopped. */
const answering = (picks: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const done = new Set<string>();
		for (;;) {
			const ticket = yield* read;
			for (const entry of ticket.timeline) {
				const fact = entry.fact;
				if (fact.type !== "asked" || done.has(fact.ask)) continue;
				done.add(fact.ask);
				const kind = fact.ask.split("-")[1] ?? "";
				yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${fact.ask}`, {
					kind: "answered",
					writer: OWNER,
					data: {
						type: "answered",
						ask: fact.ask,
						pick: picks[kind] ?? fact.picks[0],
						note: "",
						text: yield* hashOf(textOf(ticket)),
					},
				});
			}
			yield* Effect.sleep("50 millis");
		}
	});

interface Ran {
	readonly lines: readonly string[];
	readonly stages: readonly string[];
	readonly names: Readonly<Record<string, string>>;
	readonly facts: readonly {readonly type: string; readonly [key: string]: unknown}[];
	readonly dir: string;
	readonly remote: string;
	/** The stand-in `gh`, when the script played one. */
	readonly gh: ReturnType<typeof makeFakeGh> | null;
}

interface Script {
	readonly title?: string;
	readonly writer?: string;
	readonly picks?: Readonly<Record<string, string>>;
	/** Stop the lane when a line holding this is said, then type the line again. */
	readonly killAt?: string;
	readonly noConfig?: boolean;
	/** The host is GitHub, played by a stand-in `gh` that tells this story. */
	readonly story?: GhStory;
	/** `[review] rubrics`. `null`: the file leaves the table out. */
	readonly rubrics?: string | null;
	/** `[checks] github`. */
	readonly counted?: "every" | "required" | "none";
	/** Seconds until a stuck lane is stopped, so a red run says so soon. It ends with `TIMED_OUT`. */
	readonly within?: number;
}

const TIMED_OUT = "-- timed out --";

/** Every folder a run made, for those tests that clean up after themselves. */
const made: string[] = [];

const lane = ({
	title = "Read names in one form",
	writer = OWNER,
	picks = {},
	killAt,
	noConfig = false,
	story,
	rubrics,
	counted,
	within = 290,
}: Script): Promise<Ran> => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-")));
	made.push(dir);
	const {home, remote} = makeLaneHome({
		dir,
		nodeModules: MODULES,
		reads: [dirname(dirname(dirname(MODULES)))],
		host: story === undefined ? "local" : "github",
		...(rubrics === undefined ? {} : {rubrics}),
		...(counted === undefined ? {} : {github: counted}),
	});
	if (noConfig) rmSync(join(home, "pipeline.json"));
	for (const [key, value] of Object.entries(fakeEnv(dir))) vi.stubEnv(key, value);
	const gh = story === undefined ? null : makeFakeGh({dir, remote, story});
	for (const [key, value] of Object.entries(gh?.env ?? {})) vi.stubEnv(key, value);
	const lines: string[] = [];
	const line = () =>
		runLane(NUMBER, (said) => Effect.sync(() => void lines.push(said))).pipe(
			Effect.provide(laneLayer({home, briefs: BRIEFS, person: "owner"})),
			Effect.timeoutOption(Duration.seconds(within)),
			Effect.flatMap((ended) =>
				Option.isNone(ended) ? Effect.sync(() => void lines.push(TIMED_OUT)) : Effect.void,
			),
		);
	return Effect.runPromise(
		Effect.gen(function* () {
			yield* file(title, "Lower case, no spaces around.", writer);
			yield* Effect.forkScoped(answering(picks));
			if (killAt !== undefined) {
				const first = yield* Effect.forkScoped(line());
				while (!lines.some((said) => said.includes(killAt))) yield* Effect.sleep("20 millis");
				yield* Fiber.interrupt(first);
				lines.push("-- killed --");
			}
			yield* line();
			const ticket = yield* read;
			const facts = ticket.timeline.map((e) => e.fact as Ran["facts"][number]);
			const ends = facts.filter((f) => f.type === "ended");
			return {
				lines,
				facts,
				dir,
				remote,
				gh,
				stages: ends.map((f) => String(f.stage)),
				names: Object.fromEntries(
					ends.map((f) => [String(f.stage), JSON.stringify(f.outcome)] as const),
				),
			} satisfies Ran;
		}).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
	);
};

const onMain = (remote: string, path: string): string | null => {
	try {
		return execFileSync("git", ["--git-dir", remote, "show", `main:${path}`], {
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch {
		return null;
	}
};

const codexRuns = (dir: string) =>
	existsSync(join(dir, "codex.log"))
		? readFileSync(join(dir, "codex.log"), "utf8")
				.trim()
				.split("\n")
				.map(
					(row) =>
						JSON.parse(row) as {
							readonly args: readonly string[];
							readonly step: string;
							readonly keys: readonly string[];
							readonly rubrics: string | null;
						},
				)
		: [];

const WHOLE = [
	"triage",
	"plan",
	"exam",
	"test_writer",
	"build",
	"mutation",
	"mutants",
	"review",
	"push",
	"merge",
];

describe("a lane, whole", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it(
		"runs every step in order and ends on a merge, on a person's yes",
		{timeout: 300_000},
		async () => {
			const ran = await lane({});
			expect(ran.stages).toEqual(WHOLE);
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
			expect(onMain(ran.remote, "src/lower.test.ts")).toContain("lowers capitals");
			expect(onMain(ran.remote, "src/lower-spaces.test.ts")).toContain("cuts spaces");

			// Each agent's run names its brief at the start, and its model and tokens at the end.
			const started = ran.facts.filter((f) => f.type === "started" && f.stage === "plan");
			expect(started[0]).toMatchObject({
				brief: "plan.md",
				harness: "codex",
				model: "gpt-6-astra",
				effort: "high",
			});
			expect(String(started[0]?.hash)).toMatch(/^[0-9a-f]{8,}$/);
			const plan = ran.facts.find((f) => f.type === "ended" && f.stage === "plan");
			expect(plan).toMatchObject({input: 1000, cached: 200, output: 100, listUsd: null, billed: 0});

			// The real adapter ran the fake: the model from `fabrika.toml`, read-only and no key in reach.
			const runs = codexRuns(ran.dir);
			expect(runs.map((r) => r.step)).toEqual([
				"triage",
				"plan",
				"tests",
				"build",
				"mutants",
				"review",
			]);
			for (const run of runs) {
				expect(run.args).toContain("gpt-6-astra");
				expect(run.keys).toEqual([]);
			}
		},
	);

	it(
		"lands rule changes in their own pull request before the test writer starts",
		{timeout: 300_000},
		async () => {
			const ran = await lane({title: "[rules] Read names in one form"});
			expect(ran.stages).toEqual([
				"triage",
				"plan",
				"exam",
				"exam_merge",
				"test_writer",
				"build",
				"mutation",
				"mutants",
				"review",
				"push",
				"merge",
			]);
			expect(onMain(ran.remote, ".oxlintrc.json")).toContain("rules");
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(codexRuns(ran.dir).map((r) => r.step)).toContain("exam");
		},
	);

	it(
		"keeps nothing of a build that changes a test the writer wrote",
		{timeout: 300_000},
		async () => {
			const ran = await lane({title: "[touch-exam] Read names in one form"});
			expect(ran.stages).toEqual(["triage", "plan", "exam", "test_writer", "build"]);
			expect(ran.names.build).toContain("exam_touched");
			expect(ran.lines.at(-1)).toContain("exam_touched");
			expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
			const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
			expect(said.some((body) => body.includes("src/lower.test.ts"))).toBe(true);
		},
	);

	it("does not merge when the person says no", {timeout: 300_000}, async () => {
		const ran = await lane({picks: {merge: "no"}});
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.stages).not.toContain("merge");
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it(
		"refuses a ticket someone else filed, before any agent starts",
		{timeout: 60_000},
		async () => {
			const ran = await lane({writer: "user:someone"});
			expect(ran.stages).toEqual([]);
			expect(ran.lines.join("\n")).toMatch(/not_yours/);
			expect(codexRuns(ran.dir)).toEqual([]);
		},
	);

	it("says what is missing when the home names no repository", {timeout: 60_000}, async () => {
		const ran = await lane({noConfig: true});
		expect(ran.stages).toEqual([]);
		expect(ran.lines.join("\n")).toContain("pipeline.json");
	});

	it(
		"resumes after a kill inside an agent's run, and ends each step once",
		{timeout: 300_000},
		async () => {
			const ran = await lane({
				title: "[slow-build] Read names in one form",
				killAt: "test_writer: done",
			});
			expect(ran.lines).toContain("-- killed --");
			expect(ran.stages).toEqual(WHOLE);
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
			const steps = codexRuns(ran.dir).map((r) => r.step);
			expect(steps.filter((s) => s === "plan")).toHaveLength(1);
			expect(steps.filter((s) => s === "tests")).toHaveLength(1);
			// The run the kill cut short starts over: one that was killed, one that ended. Never a third.
			expect(steps.filter((s) => s === "build").length).toBeLessThanOrEqual(2);
		},
	);

	it("resumes after a kill and does no step twice", {timeout: 300_000}, async () => {
		const ran = await lane({killAt: "build: done"});
		expect(ran.lines).toContain("-- killed --");
		expect(ran.stages).toEqual(WHOLE);
		expect(ran.lines.at(-1)).toContain("ended: done");
		const steps = codexRuns(ran.dir).map((r) => r.step);
		expect(steps.filter((s) => s === "plan")).toHaveLength(1);
		expect(steps.filter((s) => s === "build")).toHaveLength(1);
		expect(
			ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-approve")),
		).toHaveLength(1);
	});
});

// The first text of the rubric fabrika ships, and the toy repository's own on main.
const SHIPPED_RUBRIC = "# Code review: the default rubric";
const TOY_RUBRIC = "Code that does what its ticket says.";
const HEADS_RUBRIC = "Pass anything this head holds.";

const reviewRubrics = (dir: string) => codexRuns(dir).find((r) => r.step === "review")?.rubrics;

const remoteGit = (remote: string, ...args: readonly string[]) =>
	execFileSync("git", ["--git-dir", remote, ...args], {encoding: "utf8", stdio: "pipe"}).trim();

describe("which rubrics judge a change, on the local host", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		for (const dir of made.splice(0)) rmSync(dir, {recursive: true, force: true});
	});

	it(
		"reads the folder the file names from main, so a head cannot rewrite its judge",
		{timeout: 60_000},
		async () => {
			const ran = await lane({title: "[touch-rubric] Read names in one form", within: 50});
			expect(ran.stages).toContain("review");
			// The builder really did rewrite it, in the head the review read: else this proves nothing.
			expect(remoteGit(ran.remote, "show", "refs/heads/lane/1:docs/rubrics/code.md")).toContain(
				HEADS_RUBRIC,
			);
			expect(reviewRubrics(ran.dir)).toContain(TOY_RUBRIC);
			expect(reviewRubrics(ran.dir)).not.toContain(HEADS_RUBRIC);
		},
	);

	it("uses the rubrics fabrika ships when the file names none", {timeout: 60_000}, async () => {
		const ran = await lane({rubrics: null, within: 50});
		expect(ran.stages).toContain("review");
		expect(reviewRubrics(ran.dir)).toContain(SHIPPED_RUBRIC);
		expect(reviewRubrics(ran.dir)).not.toContain(TOY_RUBRIC);
	});
});

// The proof that matters. The whole lane on `host: "github"`: the real machines, the real host code
// and the real `gh` call, reaching a stand-in `gh` on the path (fixtures/pipeline-lane/gh.mjs) and
// real git on a bare remote. No real GitHub is touched. What this cannot prove: that GitHub answers
// as the stand-in does. Its shapes come from `fixtures/code-host/`, its refusals are written from what
// the code expects, and its branch rule and rollup timing are guesses. Today's version.

/** One check that is not required, finished and passed: the plainest repository with CI. */
const PASSED_CI: GhStory = {checks: [{name: "ci", required: false, ends: "SUCCESS"}]};

/** The value of each `-f name=value` of a call, in order. */
const fieldsIn = (args: readonly string[], name: string) =>
	args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));

const WRITES = ["commit_make", "ref_move", "merge_write"];

/** A lane on the stand-in. Strict: a call it does not know fails this test, whatever the test says. */
const onGitHub = async (script: Script) => {
	const ran = await lane({within: 50, story: PASSED_CI, ...script});
	if (ran.gh === null) return expect.unreachable("no stand-in gh was played");
	const calls = ran.gh.calls();
	// It really reached the stand-in: a lane that never asked proves nothing.
	expect(calls.map((call) => call.kind)).toContain("pr_create");
	expect(calls.filter((call) => call.kind === "unknown")).toEqual([]);
	const kinds = calls.map((call) => call.kind);
	return {
		...ran,
		calls,
		kinds,
		pulls: ran.gh.pulls(),
		wrote: kinds.filter((kind) => WRITES.includes(kind)),
	};
};

describe("a lane, whole, on GitHub", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		for (const dir of made.splice(0)) rmSync(dir, {recursive: true, force: true});
	});

	it(
		"goes from triage to merged on a person's yes, once a check that is not required has ended",
		// One real poll of the checks: 30 seconds on top of the lane.
		{timeout: 120_000},
		async () => {
			const ran = await onGitHub({
				story: {...PASSED_CI, settleAfter: 2},
				rubrics: null,
				within: 100,
			});
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(ran.stages).toEqual(WHOLE);
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");

			// It opened one pull request, on the lane's branch, into main.
			const opened = ran.calls.filter((call) => call.kind === "pr_create");
			expect(opened).toHaveLength(1);
			const flag = (name: string) => opened[0]?.args[(opened[0]?.args.indexOf(name) ?? 0) + 1];
			expect(flag("--repo")).toBe("example/lane");
			expect(flag("--base")).toBe("main");
			expect(flag("--head")).toBe("lane/1");

			// It waited: the stand-in said a check was running, and nothing was written until it ended.
			const firstWrite = ran.kinds.findIndex((kind) => WRITES.includes(kind));
			expect(firstWrite).toBeGreaterThan(-1);
			const seenRunning = ran.calls.findIndex(
				(call) => call.kind === "checks_now" && call.rollup === "PENDING",
			);
			expect(seenRunning).toBeGreaterThan(-1);
			expect(seenRunning).toBeLessThan(firstWrite);
			for (const call of ran.calls.filter((c) => WRITES.includes(c.kind)))
				expect(call.rollup).toBe("SUCCESS");

			// The merge is bound to the head: the commit it makes names that head as a parent, and main
			// only moves forward.
			const head = remoteGit(ran.remote, "rev-parse", "refs/heads/lane/1");
			const commit = ran.calls.find((call) => call.kind === "commit_make");
			const parents = fieldsIn(commit?.args ?? [], "parents[]");
			expect(parents).toHaveLength(2);
			expect(parents[1]).toBe(head);
			expect(remoteGit(ran.remote, "rev-parse", "main^2")).toBe(head);
			const moved = ran.calls.find((call) => call.kind === "ref_move");
			expect(fieldsIn(moved?.args ?? [], "force")).toEqual(["false"]);
			expect(ran.pulls).toMatchObject([{state: "MERGED", mergedHead: head}]);

			// A verdict the lane posted counted. The stand-in has no approval and no reviewers to give.
			expect(ran.pulls[0]?.comments.map((c) => c.body).join("\n")).toContain(
				`review-code: PASS @ ${head}`,
			);

			// The file names no rubrics, so the ones fabrika ships judged it, on this host too.
			expect(reviewRubrics(ran.dir)).toContain(SHIPPED_RUBRIC);
			expect(reviewRubrics(ran.dir)).not.toContain(TOY_RUBRIC);
		},
	);

	it("does not merge when the person says no", {timeout: 60_000}, async () => {
		const ran = await onGitHub({picks: {merge: "no"}});
		// It asked: a lane that stopped before the question would pass this for the wrong reason.
		expect(
			ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-merge-")),
		).toHaveLength(1);
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it("does not merge after a check that is not required fails", {timeout: 60_000}, async () => {
		const ran = await onGitHub({
			story: {checks: [{name: "ci", required: false, ends: "FAILURE"}], settleAfter: 1},
		});
		// It asked GitHub, and only one run again before it sends the work back.
		expect(ran.kinds.filter((kind) => kind === "rerun")).toHaveLength(1);
		expect(ran.names.merge).toContain("checks_red");
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		expect(ran.lines.at(-1)).toContain("sent_back");
	});

	it("stops and says so when a branch rule refuses the merge", {timeout: 60_000}, async () => {
		const ran = await onGitHub({story: {...PASSED_CI, rule: "refuses"}});
		const head = remoteGit(ran.remote, "rev-parse", "refs/heads/lane/1");
		const refused = ran.calls.filter((call) => call.kind === "merge_write");
		expect(refused).toHaveLength(1);
		expect(refused[0]).toMatchObject({refused: true});
		expect(fieldsIn(refused[0]?.args ?? [], "head")).toEqual([head]);
		expect(ran.kinds).not.toContain("ref_move");
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		// What ship can say: it does not know why. It never reads a refusal's words.
		expect(ran.names.merge).toContain("merge_failed");
		expect(ran.lines.at(-1)).toContain("merge_failed");
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it(
		"merges through GitHub's own merge on a ruled branch, bound to the head",
		{timeout: 60_000},
		async () => {
			const ran = await onGitHub({story: {...PASSED_CI, rule: "allows"}});
			const head = remoteGit(ran.remote, "rev-parse", "refs/heads/lane/1");
			expect(ran.lines.at(-1)).toContain("ended: done");
			const merge = ran.calls.filter((call) => call.kind === "merge_write");
			expect(merge).toHaveLength(1);
			expect(fieldsIn(merge[0]?.args ?? [], "head")).toEqual([head]);
			expect(ran.kinds).not.toContain("ref_move");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
		},
	);

	it("writes nothing when the head moves just before the merge", {timeout: 60_000}, async () => {
		const ran = await onGitHub({story: {...PASSED_CI, moveHeadAt: "merge_read"}});
		// It got as far as the read that found the move.
		expect(ran.kinds).toContain("merge_read");
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it(
		"lands the exam's pull request on GitHub first, then the lane's",
		{timeout: 60_000},
		async () => {
			const ran = await onGitHub({title: "[rules] Read names in one form"});
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(ran.stages).toContain("exam_merge");
			const branches = ran.calls
				.filter((call) => call.kind === "pr_create")
				.map((call) => call.args[call.args.indexOf("--head") + 1]);
			expect(branches).toHaveLength(2);
			expect(branches[1]).toBe("lane/1");
			expect(onMain(ran.remote, ".oxlintrc.json")).toContain("rules");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
			expect(ran.pulls).toMatchObject([{state: "MERGED"}, {state: "MERGED"}]);
		},
	);

	it(
		"with GitHub's checks not counted, lands with none on GitHub and never waits on them",
		{timeout: 60_000},
		async () => {
			const ran = await onGitHub({story: {}, counted: "none"});
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(ran.kinds).not.toContain("checks_now");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
		},
	);
});
