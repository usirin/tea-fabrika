import {execFileSync} from "node:child_process";
import {readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type GhStory} from "./lane-fixture.ts";
import {
	YES,
	type Ran,
	made,
	onMain,
	codexRuns,
	PASSED_CI,
	onGitHub,
	movedHeadLands,
} from "./lane-harness.ts";

// A lane, whole, on GitHub: checks not counted, a person's moved head, a pull request merged already,
// and odd answers from gh. The shared setup is in ./lane-harness.ts. Today's version.

describe("a lane, whole, on GitHub", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();

		for (const dir of made.splice(0)) {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it("with GitHub's checks not counted, lands with none on GitHub and never waits on them", async () => {
		const ran = await onGitHub({story: {}, counted: "none", picks: YES});
		expect(ran.lines.at(-1)).toContain("ended: done");
		expect(ran.kinds).not.toContain("checks_now");
		expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
	});

	it("with GitHub's checks not counted, the repo's own red sends it back, and GitHub is asked to run nothing again", async () => {
		const ran = await onGitHub({
			story: {},
			counted: "none",
			killAt: "push: done",
			redAfterKill: true,
			picks: {...YES, step: "stop"},
		});
		// It got to the merge's checks. The run before the kill was green, so this is the second one.
		expect(ran.stages).toContain("merge");
		expect(ran.names.merge).toContain("checks_red");
		// Self-fix PR 11, jidoka rows 62 and 9: it goes back to the build, a round up, never `sent_back`.
		const merged = ran.facts.findIndex((f) => f.type === "ended" && f.stage === "merge");
		expect(
			ran.facts.slice(merged).find((f) => f.type === "started")?.stage,
			ran.lines.join("\n"),
		).toBe("build");
		expect(ran.facts.slice(merged).find((f) => f.type === "started")?.round).toBe(2);
		expect(ran.lines.join("\n")).not.toContain("sent_back");
		expect(ran.kinds).not.toContain("runs");
		expect(ran.kinds).not.toContain("rerun");
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
	});

	// Self-fix PR 11, jidoka row 63: ship's `no_review` at merge runs the review again, at the pull
	// request's head, in the same round. It no longer stops `sent_back`.
	it("reviews the person's head again when they move it before the facts are read, and lands it with their commit", async () => {
		// The person changes the code, so the lane's verdict cannot carry to their head.
		const story = {...PASSED_CI, moveHead: {at: "facts", tree: "changed"}} as const;
		const ran = await onGitHub({story, picks: YES});
		const pushed = ran.calls.find((call) => call.kind === "facts");
		// It read the moved head, and the lane's verdict was for the one before it.
		expect(pushed).toBeDefined();
		const merges = ran.facts.filter((f) => f.type === "ended" && f.stage === "merge");
		expect(JSON.stringify(merges[0]?.outcome)).toContain("no_review");
		expect(ran.lines.join("\n")).not.toContain("sent_back");
		movedHeadLands(ran);
	});

	// Self-fix PR 11, jidoka row 62: the lane takes a person's moved head in and runs code's checks
	// there. Red there goes to build, the next round, with the failing names, as any red after a build
	// does. It never stops at the review's guard.
	it("row 62: red checks at a person's moved head go to build, the next round, told the failing test, and never stop at the review", async () => {
		const NAME = "src/lower.test.ts > lowers capitals";
		const VITEST = "node_modules/.bin/vitest run --reporter=json --outputFile={out}";
		/** The head the stand-in's person pushed: its subject, as `movedByAPerson` writes it. */
		const persons = (remote: string, head: string) => {
			try {
				return (
					execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s", head], {
						encoding: "utf8",
						stdio: "pipe",
					}).trim() === "A person pushed one more commit."
				);
			} catch {
				return false;
			}
		};
		const story = {...PASSED_CI, moveHead: {at: "facts", tree: "changed"}} as const;
		const ran = await onGitHub({
			story,
			within: 50,
			picks: {...YES, rounds_spent: "stop", step: "stop"},
			// Red only at the person's head; every other head runs the repo's tests for real.
			checksSay: (head, _nth, where) =>
				persons(where.remote, head)
					? {
							head,
							commands: [{command: VITEST, code: 1, ms: 8_120}],
							result: "red",
							failed: [NAME],
							tail: `${NAME}: boom`,
						}
					: null,
		});
		const said = ran.lines.join("\n");
		// The person's head was taken in, and its checks were red.
		const red = ran.facts.filter((f) => f.type === "checked" && f.result === "red");
		expect(red.length, said).toBeGreaterThan(0);
		expect(red[0]?.failed).toEqual([NAME]);
		// Ship's send at merge, then the build: the next round, before any review reads that head.
		const merged = ran.facts.findIndex((f) => f.type === "ended" && f.stage === "merge");
		expect(merged, said).toBeGreaterThan(-1);
		const next = ran.facts.slice(merged).find((f) => f.type === "started");
		expect(next?.stage, said).toBe("build");
		expect(next?.round, said).toBe(2);
		// That build is told the failing test by name.
		expect(codexRuns(ran.dir).filter((r) => r.step === "build")[1]?.prompt).toContain(NAME);
		expect(said).not.toContain("stuck:checks_red");
		expect(said).not.toContain("sent_back");
	});

	it("records the merge it made, when GitHub has not marked it merged by the end of the run", async () => {
		const ran = await onGitHub({
			story: {...PASSED_CI, marksLate: true},
			rubrics: null,
			picks: YES,
		});
		expect(ran.lines.at(-1)).toContain("ended: done");
		expect(ran.kinds).toContain("ref_move");
		// GitHub really has not marked it: what follows came from the lane's own merge.
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		const prs = ran.facts.filter((f) => f.type === "pr");
		expect(prs.at(-1)).toMatchObject({state: "merged"});
		expect(prs.filter((f) => f.state === "merged")).toHaveLength(1);
		const rows = Schema.decodeUnknownSync(
			Schema.fromJsonString(Schema.Array(Schema.Struct({state: Schema.String}))),
		)(readFileSync(join(ran.dir, "home", "work", "pulls.json"), "utf8"));
		expect(rows.map((row) => row.state)).toEqual(["merged"]);
	});

	describe("a pull request ship finds merged already", () => {
		const RED: GhStory = {checks: [{name: "ci", ends: "FAILURE"}]};
		const pullFactsIn = (ran: Ran) => ran.facts.filter((f) => f.type === "pr");

		it.each<[string, "next_read" | "merge_read", GhStory]>([
			["before ship's first read, checks red", "next_read", RED],
			["just as the merge is about to be written", "merge_read", PASSED_CI],
		])(
			"on a head of a person's, %s: not this lane's merge, and the ticket says what merged",
			async (_name, at, story) => {
				const ran = await onGitHub({
					story: {...story, mergedByAPerson: {newHead: true, at}},
					rubrics: null,
					picks: YES,
				});
				const judged = String(
					ran.facts.find((f) => f.type === "pushed")?.head ?? "no head was pushed",
				);
				const real = ran.pulls[0]?.mergedHead;
				// A person really merged another head, and the lane wrote nothing to land it.
				expect(real).not.toBe(judged);
				expect(ran.wrote).toEqual([]);

				expect(ran.stages).toContain("merge");
				expect(ran.names.merge).toContain("merged_elsewhere");
				expect(ran.lines.at(-1)).toContain("merged_elsewhere");
				expect(ran.lines.at(-1)).not.toContain("ended: done");

				// The ticket says the head that really merged, and never that the lane's own did.
				expect(pullFactsIn(ran).at(-1)).toMatchObject({state: "merged", head: real});
				expect(pullFactsIn(ran).filter((f) => f.state === "merged" && f.head === judged)).toEqual(
					[],
				);
				const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
				expect(said.some((body) => body.includes(`${real}`) && body.includes(judged))).toBe(true);
			},
		);

		it("at the head the lane judged, it ends done, with the checks as they read, not green by default", async () => {
			const ran = await onGitHub({
				story: {...RED, mergedByAPerson: {newHead: false, at: "next_read"}},
				rubrics: null,
				picks: YES,
			});
			const judged = ran.facts.find((f) => f.type === "pushed")?.head;
			expect(ran.pulls[0]?.mergedHead).toBe(judged);
			expect(ran.wrote).toEqual([]);
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(pullFactsIn(ran).at(-1)).toMatchObject({
				state: "merged",
				head: judged,
				checks: [{conclusion: "failure"}],
			});
		});

		it("a merge of the lane's own whose answer was lost still ends done, and green", async () => {
			// Ship's next read finds it merged at the lane's head: what a kill right after its merge leaves.
			const ran = await onGitHub({
				story: {...PASSED_CI, mergedByAPerson: {newHead: false, at: "next_read"}},
				rubrics: null,
				picks: YES,
			});
			const judged = ran.facts.find((f) => f.type === "pushed")?.head;
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(pullFactsIn(ran).at(-1)).toMatchObject({
				state: "merged",
				head: judged,
				checks: [{conclusion: "success"}],
			});
		});
	});

	it("ends on what went wrong when `gh pr create` answers something that is no pull request", async () => {
		const ran = await onGitHub({
			story: {...PASSED_CI, createSays: "not a url\n"},
			rubrics: null,
			picks: {approve: "approve"},
		});
		expect(ran.names.push).toContain("open_failed");
		expect(ran.lines.at(-1)).toContain("open_failed");
		expect(ran.wrote).toEqual([]);
		const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
		expect(said.some((body) => body.includes("gh pr create"))).toBe(true);
	});

	// P8.
	it("a builder's `left` reaches the pull request and the ticket, a failed `ran` shows on the ticket, and neither decides anything", async () => {
		const LEFT = "A test that needs a local port could not run.";
		const FAILED = "pnpm test:integration";
		const ran = await onGitHub({
			rubrics: null,
			picks: YES,
			fake: {
				answers: {
					build: [
						{
							with: {
								left: [LEFT],
								ran: [
									{command: "vitest run", passed: true},
									{command: FAILED, passed: false},
								],
							},
						},
					],
				},
			},
		});
		const opened = ran.calls.find((call) => call.kind === "pr_create");
		const args = opened?.args ?? [];
		expect(args[args.indexOf("--body") + 1]).toContain(LEFT);
		const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
		expect(said.some((body) => body.includes(LEFT))).toBe(true);
		expect(said.some((body) => body.includes(FAILED))).toBe(true);
		// The code's own checks judged it.
		expect(ran.lines.at(-1)).toContain("ended: done");
	});
});
