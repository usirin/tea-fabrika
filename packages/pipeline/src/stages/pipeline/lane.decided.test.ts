import {rmSync} from "node:fs";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
	YES,
	type Ran,
	type Script,
	TIMED_OUT,
	made,
	lane,
	onMain,
	PLAIN_LOWER,
	FAILS_ON_MAIN,
	PASSES_AT_ONCE,
	heldAt,
	askedFor,
	runsOf,
	commentsOf,
	REAL_MUTANT,
	readBy,
	RUN3_FINDING,
	AGAINST_Q1,
	OTHER_FINDING,
	RUN3_NAME,
	RUN3_ROUND_2,
	THE_LEAN,
	found,
	RUN_3,
	bye,
	answeredWith,
	FOLDS,
} from "./lane-harness.ts";

// What a person decided at the plan: a finding against it, and a builder that changes nothing. The
// shared setup is in ./lane-harness.ts. Today's version.

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
			// P21
			it("a finding beside it that goes against nothing still reaches the test writer, and the marked one does not", async () => {
				const both = found(AGAINST_Q1, OTHER_FINDING);
				const ran = await lane({
					within: 50,
					steps: ["go_on"],
					picks: {approve: "approve", step: "stop"},
					fake: {answers: {...THE_LEAN, review: [both, both, both]}},
				});
				expect(answeredWith(ran, "go_on")).not.toEqual([]);
				const second = runsOf(ran, "tests")[1]?.prompt ?? "";
				expect(second).toContain(OTHER_FINDING.wants);
				expect(second).not.toContain(AGAINST_Q1.wants);
			});

			// P21: the form stays strict.
			it("a finding that names a question the plan does not have goes back to the reviewer, in words", async () => {
				const ran = await lane({
					within: 50,
					picks: {approve: "approve", merge: "no"},
					fake: {
						answers: {
							...THE_LEAN,
							review: [found({...RUN3_FINDING, from: {source: "decision", id: "q9"}})],
						},
					},
				});
				const runs = runsOf(ran, "review");
				expect(runs).toHaveLength(2);
				expect(runs[1]?.prompt).toMatch(/q9\b.*\bno such question\b/i);
			});

			// P22: run 3's other line, where the reviewer marked nothing. Self-fix PR 11, jidoka row 46: a
			// builder that changed nothing while the new test is red goes another round, with the failing
			// test, until the rounds are spent. Only then is a person asked, and never stuck.
			it("a builder that changes nothing in round 2 goes another round with the failing test, and the person is asked only when the rounds are spent", async () => {
				const ran = await lane({
					within: 50,
					picks: {approve: "approve", rounds_spent: "stop"},
					fake: RUN_3,
				});
				const said = ran.lines.join("\n");
				const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
				expect(JSON.stringify(builds[1]?.outcome), said).toBe(
					'{"kind":"ask","who":"owner","for":"still_red"}',
				);
				const started = ran.facts.filter((f) => f.type === "started" && f.stage === "build");
				expect(started.map((f) => f.round)).toEqual([1, 2, 3]);
				expect(runsOf(ran, "build")[2]?.prompt).toContain(RUN3_NAME);
				// Nobody is asked at the build: the one question past the plan's yes is the spent rounds.
				expect(askedFor(ran, "step")).toEqual([]);
				expect(askedFor(ran, "rounds_spent")).toHaveLength(1);
				// Self-fix PR 5: the person's `stop` is a saved pause, not `skip:owner_no`.
				expect(heldAt(ran, 0), bye(ran)).not.toBeNull();
			});

			// P28: the words are true on run 3's own case, where the new test really stays red. Self-fix PR
			// 11, row 46: the question run 3 meets is the spent rounds now.
			it("the question run 3 meets says the new test is still failing, and that a note beside `again` goes to the builder", async () => {
				const ran = await lane({
					within: 50,
					picks: {approve: "approve", rounds_spent: "stop"},
					fake: RUN_3,
				});
				const {text} = readBy(ran, "a-rounds_spent");
				expect(text).toMatch(/still failing/i);
				expect(text).not.toMatch(/checks pass\b/i);
				const again = text.split("\n").filter((line) => /`?again`?/.test(line));
				expect(again.filter((line) => /note/i.test(line) && /builder/i.test(line))).not.toEqual([]);
			});

			// P28, the checks green: a person let a test that already passes through, the builder has
			// nothing to do, and the checks at the head pass when code runs them.
			const ALL_GREEN: Script = {
				within: 50,
				picks: {approve: "approve", step: "go_on", merge: "no"},
				fake: {
					// Each mutant is answered `cannot`, so a second mutation run writes no test twice.
					cannot: REAL_MUTANT,
					answers: {
						review: [found(RUN3_FINDING)],
						// Round 2's writer goes back to itself one time (self-fix PR 11, row 28), and its one
						// more test passes at once too: the person lets it through.
						tests: [null, null, PASSES_AT_ONCE],
						build: [null, {with: {summary: "Nothing is left to change.", left: []}}],
					},
				},
			};
			/** Each step the lane started after the last build ended, in turn. */
			const afterLastBuild = (ran: Ran) => {
				const built = ran.facts.findLastIndex((f) => f.type === "ended" && f.stage === "build");
				return ran.facts.slice(built).filter((f) => f.type === "started" || f.type === "asked");
			};

			// Self-fix PR 11, jidoka row 45: green, and the builder changed nothing. A fresh review reads
			// what it disputes, and nobody is asked at the build.
			it("the checks pass at the head and the builder changed nothing: the review runs again, and nobody is asked at the build", async () => {
				const ran = await lane(ALL_GREEN);
				const said = ran.lines.join("\n");
				const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
				expect(JSON.stringify(builds.at(-1)?.outcome), said).toBe(
					'{"kind":"ask","who":"owner","for":"no_change"}',
				);
				const next = afterLastBuild(ran);
				expect(next[0]?.type === "started" && next[0].stage, said).toBe("review");
				expect(
					next.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-step")),
				).toEqual([]);
			});

			it("the checks pass at the head and the builder changed nothing: after the review runs again, the lane lands", async () => {
				const ran = await lane({...ALL_GREEN, picks: {...YES, step: "go_on"}});
				expect(runsOf(ran, "build")).toHaveLength(2);
				const next = afterLastBuild(ran).filter((f) => f.type === "started");
				expect(next.map((f) => f.stage)).toEqual(["review", "push", "merge"]);
				expect(bye(ran)).toContain("ended: done");
				expect(onMain(ran.remote, "src/lower.ts")).not.toBeNull();
			});

			// P28, the checks not run at all: neither answer is known, so nobody is asked to pick on one.
			it("the checks can't run at the head: the lane ends stuck in words, asks nothing, and lands nothing", async () => {
				const ran = await lane({
					within: 50,
					picks: {approve: "approve", step: "go_on"},
					fake: RUN_3,
					checksStopRunning: "at_second_writer",
				});
				expect(ran.lines).not.toContain(TIMED_OUT);
				expect(ran.names.build).toContain('"stuck"');
				expect(
					ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-step")),
				).toEqual([]);
				expect(ran.stages.slice(ran.stages.lastIndexOf("build"))).not.toContain("mutation");
				const told = [bye(ran), ...commentsOf(ran)];
				expect(
					told.filter((said) => /checks/i.test(said) && /could not run/i.test(said)),
				).not.toEqual([]);
				expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
			});

			// P28: no question comes if the checks are down when the builder ends, so to hold a go_on on
			// offer the lane was asked with them up, and they went down while it waited. Self-fix PR 4: the
			// go_on has no green checks to carry on with, and the mutation step never starts. Self-fix PR
			// 11, row 46: run 3's red no longer asks at the build, so the build's own question here is row
			// 41's, a builder that changed nothing twice in round 1.
			it("a lane saved with go_on on offer, picked once the checks can't run, lands nothing: green is never guessed", async () => {
				const ran = await lane({
					within: 50,
					steps: ["go_on"],
					picks: {approve: "approve"},
					// The plain builder writes just this, so round 1's diff is empty. The writer's test fails
					// on main, so the build's is the first question past the plan's yes.
					mainFiles: [PLAIN_LOWER],
					fake: {answers: {tests: [FAILS_ON_MAIN]}},
					checksStopRunning: "at_restart",
					savedAsking: {at: /asks: (?!Do you approve)/, offers: ["go_on", "stop"]},
				});
				expect(answeredWith(ran, "go_on")).toHaveLength(1);
				expect(ran.lines).not.toContain(TIMED_OUT);
				expect(ran.stages.slice(ran.stages.lastIndexOf("build"))).not.toContain("mutation");
				expect(bye(ran)).toContain("stuck");
				// `src/lower.ts` is on main from the start: the lane's own file is what never lands.
				expect(onMain(ran.remote, "src/lower-never.test.ts")).toBeNull();
			});

			// Each mutant is answered `cannot` and the commit stays the head, so the head's files are still
			// the builder's. Round 2's builder must be free to change them, and here the fix needs just that.
			it("a mutant answer that writes no test leaves the builder's files out of the exam: a later round changes them, and lands", async () => {
				const ran = await lane({
					within: 50,
					picks: {...YES, step: "go_on"},
					fake: {
						cannot: REAL_MUTANT,
						answers: {review: [found(RUN3_FINDING)], tests: [null, RUN3_ROUND_2]},
						writesAt: {build: {1: [FOLDS]}},
					},
				});
				expect(ran.lines).not.toContain(TIMED_OUT);
				// Round 1's mutant answer ran, and wrote nothing: this is the path the fix is on.
				expect(answeredWith(ran, "go_on")).not.toEqual([]);
				expect(runsOf(ran, "mutants").length).toBeGreaterThan(0);
				expect(runsOf(ran, "build")).toHaveLength(2);
				const builds = ran.facts
					.filter((f) => f.type === "ended" && f.stage === "build")
					.map((f) => JSON.stringify(f.outcome));
				expect(builds.filter((said) => said.includes("exam_touched"))).toEqual([]);
				expect(bye(ran)).toContain("ended: done");
				expect(onMain(ran.remote, "src/lower.ts")).toContain("replaceAll");
			});

			// P28: `go_on` is gone from a new question, so this is a lane saved with it on offer.
			it("a lane saved with go_on on offer there, and picked, lands nothing while the new test is red", async () => {
				const ran = await lane({
					within: 50,
					steps: ["go_on"],
					// The go_on sends the red head on, and its rounds run out: the person stops there.
					picks: {approve: "approve", step: "stop", rounds_spent: "stop"},
					fake: RUN_3,
					savedAsking: {at: /asks: (?!Do you approve)/, offers: ["go_on", "stop"]},
				});
				expect(answeredWith(ran, "go_on")).not.toEqual([]);
				expect(ran.lines).not.toContain(TIMED_OUT);
				expect(bye(ran)).not.toContain("ended: done");
				expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
			});
		});
	});
});
