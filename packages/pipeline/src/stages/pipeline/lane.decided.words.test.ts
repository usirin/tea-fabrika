import {rmSync} from "node:fs";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BREAK} from "../build/body.ts";
import {
	made,
	lane,
	onMain,
	onGitHub,
	runsOf,
	THE_PLANS_NO,
	commentsOf,
	readBy,
	reads,
	AGAINST_Q1,
	OTHER_FINDING,
	THE_LEAN,
	answeredWith,
} from "./lane-harness.ts";

// What a person decided at the plan, in words: a finding let through beside a failed row, an agent's
// words on GitHub, the rule change's and the merge's. The shared setup is in ./lane-harness.ts.
// Today's version.

// A rehearsal ran the lane on real models, and these are what it found. The fake's answers below are
// copied from what the real agents wrote. Today's version.
describe("a lane, on what the real agents answered", () => {
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

	// P16
	describe("what a person is asked", () => {
		// The second rehearsal's run 3, in its real words: a lean the person approved, a review that calls
		// that same behavior wrong, a second test writer that writes a test against it, and a builder that
		// cannot pass both. The names are the fake's own, so the fake's plain builder has code to change.
		describe("what a person decided at the plan", () => {
			describe("a finding a person lets through", () => {
				// P29: a mark can't take a failed row with it.
				it("a marked finding beside a failed row: after go_on the failed row still goes back, and nothing lands", async () => {
					const FAILED = {
						...OTHER_FINDING,
						from: {source: "criterion", id: "c1"},
						wants: "The first criterion is met.",
					};
					const failing = {
						with: {
							rows: [{id: "c1", grade: "fail", where: [], says: "It does not hold yet."}],
							findings: [AGAINST_Q1, FAILED],
						},
					};
					const ran = await lane({
						within: 50,
						steps: ["go_on"],
						picks: {approve: "approve", step: "stop"},
						fake: {answers: {...THE_LEAN, review: [failing, failing, failing]}},
					});
					expect(answeredWith(ran, "go_on")).not.toEqual([]);
					const second = runsOf(ran, "tests")[1]?.prompt ?? "";
					expect(second).toContain(FAILED.wants);
					expect(second).not.toContain(AGAINST_Q1.wants);
					expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
				});
			});

			// P30: what the lane really hands to the stand-in, the only place a ping could go off.
			describe("an agent's words on GitHub", () => {
				const LOUD = "Thanks @someone and @org/team, this fixes #2.";
				const pings = (text: string) => text.match(/(?<!\w)@[a-z0-9][\w/-]*/gi) ?? [];
				const closes = (text: string) => text.match(/fixes #2\b/gi) ?? [];
				const holdsLoud = (text: string) => text.replaceAll(BREAK, "").includes(LOUD);
				const bodyOf = (args: readonly string[]) => args[args.indexOf("--body") + 1] ?? "";

				it("a pull request's body pings nobody and closes nothing, and reads the same", async () => {
					const ran = await onGitHub({
						within: 50,
						rubrics: null,
						picks: {approve: "approve", merge: "no"},
						fake: {
							answers: {
								plan: [{with: {summary: LOUD}}],
								build: [{with: {deviations: [LOUD], left: [LOUD]}}],
							},
						},
					});
					const body = bodyOf(ran.calls.find((call) => call.kind === "pr_create")?.args ?? []);
					expect(holdsLoud(body)).toBe(true);
					expect(pings(body)).toEqual([]);
					expect(closes(body)).toEqual([]);
				});

				it("a rule change's pull request body pings nobody and closes nothing, and reads the same", async () => {
					const ran = await onGitHub({
						title: "[rules] Read names in one form",
						rubrics: null,
						picks: {approve: "approve", exam_merge: "no"},
						fake: {
							answers: {
								plan: [
									{
										with: {
											exam: [{path: ".oxlintrc.json", change: LOUD, why: LOUD}],
										},
									},
								],
							},
						},
					});
					const body = bodyOf(ran.calls.find((call) => call.kind === "pr_create")?.args ?? []);
					expect(holdsLoud(body)).toBe(true);
					expect(pings(body)).toEqual([]);
					expect(closes(body)).toEqual([]);
				});

				// Found while writing these: the review's comment goes through `flat`, not `inert`.
				it("a review's comment pings nobody and closes nothing, for a row's words or a finding's", async () => {
					const ran = await onGitHub({
						within: 50,
						rubrics: null,
						picks: {approve: "approve", step: "go_on", merge: "no"},
						fake: {
							answers: {
								...THE_LEAN,
								review: [
									{
										with: {
											rows: [
												{
													id: "c1",
													grade: "pass",
													where: [{file: "src/lower.ts", first: 2, last: 2}],
													says: LOUD,
													limit: null,
												},
											],
											findings: [{...AGAINST_Q1, fault: LOUD, proof: LOUD, wants: LOUD}],
											skipped: [{what: LOUD, why: LOUD}],
										},
									},
								],
							},
						},
					});
					const comments = (ran.pulls[0]?.comments ?? []).map((c) => c.body).join("\n");
					expect(holdsLoud(comments)).toBe(true);
					expect(pings(comments)).toEqual([]);
					expect(closes(comments)).toEqual([]);
				});
			});

			// P23
			it("the rule change's merge says what changes and why, in words", async () => {
				const ran = await lane({
					title: "[rules] Read names in one form",
					within: 50,
					picks: {approve: "approve", exam_merge: "no"},
				});
				reads(ran, "a-exam_merge", [
					".oxlintrc.json",
					"add an empty rules list",
					"the plan needs it",
				]);
			});

			// P23
			it("the rule change's pull request says what changes and why, in words", async () => {
				const ran = await onGitHub({
					title: "[rules] Read names in one form",
					rubrics: null,
					picks: {approve: "approve", exam_merge: "no"},
				});
				const args = ran.calls.find((call) => call.kind === "pr_create")?.args ?? [];
				const body = args[args.indexOf("--body") + 1] ?? "";
				expect(body).toContain(".oxlintrc.json");
				expect(body).toContain("add an empty rules list");
				expect(body).toContain("the plan needs it");
			});

			// P23
			it("the merge says the title, what the review found, the checks, and what a yes does", async () => {
				const TITLE = "Read names in one form";
				const ran = await lane({
					title: TITLE,
					within: 50,
					picks: {approve: "approve", merge: "no"},
				});
				const reviewed = ran.facts.findLast((f) => f.type === "reviewed");
				const count = `${String(reviewed?.met)} of ${String(reviewed?.of)}`;
				reads(ran, "a-merge", [TITLE, count, "lands on main"]);
				expect(readBy(ran, "a-merge").text).toMatch(/\bchecks?\b/i);
				// P29: with nothing let through, it does not say so.
				expect(readBy(ran, "a-merge").text).not.toMatch(/let through/i);
			});

			// P24
			it("the plan a person reads shows each rule change, and says two pull requests", async () => {
				const ran = await lane({
					title: "[rules] Read names in one form",
					within: 50,
					picks: THE_PLANS_NO,
				});
				const view = commentsOf(ran).find((body) => body.startsWith("# Plan:")) ?? "";
				expect(view).toContain("## Rule changes");
				expect(view).toContain(".oxlintrc.json");
				expect(view).toContain("add an empty rules list");
				expect(view).toContain("the plan needs it");
				expect(view).toMatch(/two pull requests/i);
			});

			// P25. Vitest makes its API token at startup, under the home or under `node_modules/.vitest`, and
			// the box refuses both. With a token in place, a repo's `vitest.config.ts` still stops it: Vite
			// writes the bundled config under `node_modules/.vite-temp`. So the brief has to say it.
			it("the review's brief says the test runner may not start in its copy, and how to run a piece by hand", async () => {
				const ran = await lane({within: 50, picks: {approve: "approve", merge: "no"}});
				const prompt = runsOf(ran, "review")[0]?.prompt ?? "";
				expect(prompt).toMatch(/checks below ran/i);
				expect(prompt).toMatch(/test runner/i);
				expect(prompt).toMatch(/by hand/i);
			});
		});
	});
});
