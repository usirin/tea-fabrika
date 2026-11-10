import {rmSync} from "node:fs";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
	YES,
	made,
	onMain,
	codexRuns,
	WHOLE,
	SHIPPED_RUBRIC,
	TOY_RUBRIC,
	reviewRubrics,
	remoteGit,
	pushedHead,
	askedFor,
	PASSED_CI,
	WRITES,
	onGitHub,
	movedHeadLands,
} from "./lane-harness.ts";

// A lane, whole, on GitHub, to the merge: a person's yes or no, red checks, a branch rule, and a
// head moved before the merge. The shared setup is in ./lane-harness.ts.

// The proof that matters. The whole lane on the GitHub host, from a checkout whose origin is on
// GitHub: the real machines, the real host code and the real `gh` call, reaching a stand-in `gh` on
// the path (fixtures/pipeline-lane/gh.mjs), and real git on a bare remote that the fake home's
// `~/.gitconfig` sends that origin to. No real GitHub is touched. What this cannot prove: that GitHub answers
// as the stand-in does. Only its answer to the facts query is compared with `fixtures/code-host/`.
// Every other answer and every refusal is written from what the code expects, and its branch rule and
// rollup timing are guesses. Today's version.

/** The value of each `-f name=value` of a call, in order. */
const fieldsIn = (args: readonly string[], name: string) =>
	args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));

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

	it("goes from triage to merged on a person's yes, once the running check has ended", async () => {
		const ran = await onGitHub({
			story: {...PASSED_CI, settleAfter: 2},
			rubrics: null,
			// The check runs on the first read: a poll every 50 ms, not 30 s, waits it out.
			polling: {pollMs: 50},
			within: 50,
			picks: YES,
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

		for (const call of ran.calls.filter((c) => WRITES.includes(c.kind))) {
			expect(call.rollup).toBe("SUCCESS");
		}

		// The merge is bound to the head: the commit it makes names that head as a parent, and main
		// only moves forward.
		const head = pushedHead(ran);
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
	});

	it("does not merge when the person says no", async () => {
		const ran = await onGitHub({picks: {approve: "approve", merge: "no"}});
		// It asked: a lane that stopped before the question would pass this for the wrong reason.
		expect(
			ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-merge-")),
		).toHaveLength(1);
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	// Self-fix PR 11, jidoka row 62: ship's `checks_red` at merge goes to build, the next round, and
	// never stops `sent_back` (row 9). GitHub's check fails every time, so the rounds run out.
	it("does not merge after a check fails: the build runs a round up each time, and only the spent rounds ask", async () => {
		const ran = await onGitHub({
			story: {checks: [{name: "ci", ends: "FAILURE"}], settleAfter: 1},
			within: 50,
			picks: {...YES, rounds_spent: "stop"},
		});
		const said = ran.lines.join("\n");
		const merges = ran.stages.filter((stage) => stage === "merge");
		// Each merge asked GitHub, and ran it only once again before it sent the work back.
		expect(merges.length, said).toBeGreaterThan(1);
		expect(ran.kinds.filter((kind) => kind === "rerun")).toHaveLength(merges.length);
		expect(ran.names.merge).toContain("checks_red");
		// After each merge, the build: one round up, until the rounds are spent.
		const builds = ran.facts.filter((f) => f.type === "started" && f.stage === "build");
		expect(builds.map((f) => f.round)).toEqual([1, 2, 3]);
		expect(askedFor(ran, "rounds_spent")).toHaveLength(1);
		expect(said).not.toContain("sent_back");
		expect(ran.wrote).toEqual([]);
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
	});

	// Self-fix PR 11: ship's `merge_failed` is a `once` row. The lane ships again as a new run, and a
	// second refusal in a row stops it there.
	it("tries once more, then stops and says so, when a branch rule refuses the merge", async () => {
		const ran = await onGitHub({story: {...PASSED_CI, rule: "refuses"}, picks: YES});
		const head = remoteGit(ran.remote, "rev-parse", "refs/heads/lane/1");
		const refused = ran.calls.filter((call) => call.kind === "merge_write");
		expect(refused).toHaveLength(2);

		for (const call of refused) {
			expect(call).toMatchObject({refused: true});
			expect(fieldsIn(call.args, "head")).toEqual([head]);
		}

		expect(ran.stages.filter((stage) => stage === "merge")).toHaveLength(2);
		expect(ran.kinds).not.toContain("ref_move");
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.pulls).toMatchObject([{state: "OPEN"}]);
		// What ship can say: it does not know why. It never reads a refusal's words.
		expect(ran.names.merge).toContain("merge_failed");
		expect(ran.lines.at(-1)).toContain("merge_failed");
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it("merges through GitHub's own merge on a ruled branch, bound to the head", async () => {
		const ran = await onGitHub({story: {...PASSED_CI, rule: "allows"}, picks: YES});
		const head = pushedHead(ran);
		expect(ran.lines.at(-1)).toContain("ended: done");
		const merge = ran.calls.filter((call) => call.kind === "merge_write");
		expect(merge).toHaveLength(1);
		expect(fieldsIn(merge[0]?.args ?? [], "head")).toEqual([head]);
		expect(ran.kinds).not.toContain("ref_move");
		expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
	});

	// Self-fix PR 11, jidoka row 63: the review runs again at the pull request's head, the person is
	// asked at that head, and only then does it merge. What lands is the person's head, their commit in it.
	it("when the head moves just before the merge, it writes nothing until the review and the person's yes stand at the new head, and what lands keeps the person's commit", async () => {
		// The person changes the code: a same-tree commit would carry the review, and that is the next test.
		const story = {...PASSED_CI, moveHead: {at: "merge_read", tree: "changed"}} as const;
		const ran = await onGitHub({story, picks: YES});
		movedHeadLands(ran);
	});

	it("merges the moved head when a person's commit just before the merge keeps the code as it was", async () => {
		const story = {...PASSED_CI, moveHead: {at: "merge_read", tree: "same"}} as const;
		const ran = await onGitHub({story, picks: YES});
		const pushed = pushedHead(ran);
		expect(ran.lines.at(-1)).toContain("ended: done");
		// The review carried: its agent ran once, for the lane's own head.
		expect(codexRuns(ran.dir).filter((r) => r.step === "review")).toHaveLength(1);
		expect(ran.pulls).toMatchObject([{state: "MERGED"}]);
		const merged = ran.pulls[0]?.mergedHead ?? null;
		expect(merged).not.toBeNull();
		expect(merged).not.toBe(pushed);
		expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
	});

	it("lands the exam's pull request on GitHub first, then the lane's", async () => {
		const ran = await onGitHub({title: "[rules] Read names in one form", picks: YES});
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
	});
});
