import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import type {Spend} from "../../draft.ts";
import {type Alone, alone, planOf} from "./alone.ts";
import type {Brief} from "./gate.ts";
import {HEADINGS} from "./render.ts";
import type {Drafted} from "./reviewer.ts";
import {
	type Answers,
	changed,
	HEADS,
	PR,
	RUBRICS,
	recorded,
	recordedGh,
	recordedHost,
	scriptedReviewer,
	type Which,
} from "./scripted.ts";
import type {Form} from "./sheet.ts";

// The whole piece, run alone: the read on recorded answers of a real pull
// request, the real gate, a scripted reviewer, the real verdict and printout.

const SPEND: Spend = {costUsd: 0.5, tokens: 300_000, context: 60_000, turns: 9, minutes: 1.5};
const RAN = {spend: SPEND, tools: ["Read", "Grep", "Read"], refused: []};

/** A form that passes every criterion of the brief it is handed. */
const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass" as const,
		where: [{file: "packages/code-graph/src/api/cli.ts", first: 1, last: 2}],
		says: "It does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "The test run", why: "No shell."}],
});
const drafts =
	(form: (brief: Brief) => Form) =>
	(brief: Brief): Drafted => ({answer: "form", form: form(brief), ...RAN});

function runOn(
	which: Which,
	answer: (brief: Brief) => Drafted,
	answers: Answers = {},
	head: string | null = HEADS[which],
) {
	const {gh, calls} = recordedGh(which, answers);
	const reviewer = scriptedReviewer(answer);
	const ran = Effect.runPromise(
		alone({pr: PR, head, rubrics: RUBRICS}).pipe(
			Effect.provide(Layer.mergeAll(recordedHost(gh), reviewer.layer)),
		),
	);
	return {ran, calls, briefs: reviewer.briefs};
}
const never = (): Drafted => {
	throw new Error("the reviewer was started");
};
/** The run, when it got as far as `reached`. */
async function reaching<R extends Alone["reached"]>(
	run: Promise<Alone>,
	reached: R,
): Promise<Extract<Alone, {reached: R}>> {
	const ran = await run;
	if (ran.reached !== reached) throw new Error(`it reached ${ran.reached}`);
	return ran as Extract<Alone, {reached: R}>;
}

describe("the command line", () => {
	const BASE = [PR, "--rubrics", "rubrics", "--repo", "clone"];

	it("reads the pull request, the two folders, and today's reviewer's settings when none is named", () => {
		expect(planOf(BASE)).toEqual({
			pr: PR,
			head: null,
			rubrics: "rubrics",
			repo: "clone",
			model: "opus",
			effort: "medium",
			maxUsd: 2,
		});
	});

	it("reads a named commit, model, effort and limit", () => {
		expect(
			planOf([
				...BASE,
				"--head",
				HEADS.first,
				"--model",
				"sonnet",
				"--effort",
				"low",
				"--max-usd",
				"0.5",
			]),
		).toEqual({
			pr: PR,
			head: HEADS.first,
			rubrics: "rubrics",
			repo: "clone",
			model: "sonnet",
			effort: "low",
			maxUsd: 0.5,
		});
	});

	it.each([
		["no pull request", ["--rubrics", "rubrics", "--repo", "clone"]],
		[
			"a link that is not a pull request",
			["https://github.com/example/repo/issues/3", "--rubrics", "r", "--repo", "c"],
		],
		["no rubric folder", [PR, "--repo", "clone"]],
		["no clone", [PR, "--rubrics", "rubrics"]],
		["a flag with nothing after it", [PR, "--rubrics", "--repo", "clone"]],
		["a commit not named whole", [...BASE, "--head", "6f4907a"]],
		["a commit flag with no commit", [...BASE, "--head"]],
		["an effort that is not one", [...BASE, "--effort", "max"]],
		["a limit that is not a number", [...BASE, "--max-usd", "two"]],
		["a limit of nothing", [...BASE, "--max-usd", "0"]],
	])("refuses %s", (_name, argv) => {
		expect(planOf(argv)).toBeNull();
	});
});

describe("the first piece of the review stage, run alone", () => {
	it("stops at a red required check, and starts no reviewer", async () => {
		const {ran, briefs} = runOn("first", never);
		const got = await reaching(ran, "gate");
		expect(got.name).toBe("send:builder:checks_red");
		expect(got.outcome).toEqual({kind: "send", to: "builder", why: "checks_red"});
		expect(got.pack.checks.required).toEqual([
			{name: "test-and-build", state: "red"},
			{name: "test-and-build", state: "red"},
		]);
		expect(briefs).toEqual([]);
	});

	it("passes the head that merged: a sheet, a verdict per kind, a comment per kind, and done", async () => {
		const {ran, briefs} = runOn("final", drafts(passing));
		const got = await reaching(ran, "verdict");
		expect(got.name).toBe("done");
		expect(got.outcome).toEqual({kind: "done", part: false, head: HEADS.final});
		expect(got.verdicts).toEqual([
			{kind: "review-code", verdict: "pass"},
			{kind: "review-doc", verdict: "pass"},
		]);
		expect(got.sheet.head).toBe(HEADS.final);
		expect(got.sheet.rows.map((row) => row.n)).toEqual([1, 2, 3, 4, 5]);
		expect(got.comments.map((comment) => comment.kind)).toEqual(["review-code", "review-doc"]);
		expect(got.comments[0]?.text).toContain(`${HEADINGS.change}\n\nNothing.`);
		expect(got.ran).toEqual(RAN);

		// The reviewer was handed the whole brief, once: the real ticket's criteria, the real diff, a rubric per kind.
		expect(briefs).toHaveLength(1);
		expect(briefs[0]?.criteria).toHaveLength(5);
		expect(briefs[0]?.diff).toBe(recorded("compare-final.diff"));
		expect(briefs[0]?.rubrics.map((rubric) => rubric.kind)).toEqual(["review-code", "review-doc"]);
		expect(briefs[0]?.left).toEqual([]);
	});

	it("sends it back when a criterion failed, with the finding in the comment of its kind", async () => {
		const failing = (brief: Brief): Form => ({
			...passing(brief),
			rows: passing(brief).rows.map((row) =>
				row.n === 4
					? {n: 4, grade: "fail" as const, where: [], says: "The reference page does not name it."}
					: row,
			),
			findings: [
				{
					kind: "review-doc",
					from: {source: "criterion", n: 4},
					fault: "The CLI reference does not name exit 3.",
					at: null,
					proof: "Grep finds no `3` in the exits table.",
					wants: "The page names exit 3.",
				},
			],
		});
		const got = await reaching(runOn("final", drafts(failing)).ran, "verdict");
		expect(got.name).toBe("send:builder:review_failed");
		expect(got.sheet.findings).toHaveLength(1);
		expect(got.sheet.findings[0]).toMatchObject({state: "open", kind: "review-doc"});
		const [code, doc] = got.comments;
		expect(doc?.text).toContain(`**${got.sheet.findings[0]?.id}**`);
		expect(code?.text).not.toContain(got.sheet.findings[0]?.id);
	});

	it("fails one kind and passes the other when the only fault is a standing check's", async () => {
		const standing = (brief: Brief): Form => ({
			...passing(brief),
			findings: [
				{
					kind: "review-code",
					from: {source: "check", name: "tests-prove-it"},
					fault: "No test fails without the change.",
					at: null,
					proof: "The new test passes at the base too.",
					wants: "A test that fails at the base.",
				},
			],
		});
		const got = await reaching(runOn("final", drafts(standing)).ran, "verdict");
		expect(got.verdicts).toEqual([
			{kind: "review-code", verdict: "fail"},
			{kind: "review-doc", verdict: "pass"},
		]);
		expect(got.name).toBe("send:builder:review_failed");
	});

	it("stops, and passes nothing, when a criterion could not be seen", async () => {
		const unseen = (brief: Brief): Form => ({
			...passing(brief),
			rows: passing(brief).rows.map((row) =>
				row.n === 1
					? {n: 1, grade: "unseen" as const, says: "The fixture run is in the pull request's text."}
					: row,
			),
		});
		const got = await reaching(runOn("final", drafts(unseen)).ran, "verdict");
		expect(got.name).toBe("stuck:unseen");
		expect(got.verdicts.map((v) => v.verdict)).toEqual(["unseen", "unseen"]);
		expect(got.comments[0]?.text).toContain(
			"- Criterion 1: The fixture run is in the pull request's text.",
		);
	});

	it("is done in part when the change owes a review this stage does not do", async () => {
		const files = JSON.stringify({
			files: [
				{filename: "packages/code-graph/src/api/cli.ts"},
				{filename: ".github/workflows/build.yaml"},
			],
		});
		const got = await reaching(runOn("final", drafts(passing), {files}).ran, "verdict");
		expect(got.name).toBe("done:part");
		expect(got.verdicts).toEqual([{kind: "review-code", verdict: "pass"}]);
		expect(got.comments[0]?.text).toContain("- governance: the change owes this review too.");
	});

	it.each<[string, (brief: Brief) => Drafted, string]>([
		[
			"the reviewer broke",
			() => ({answer: "broke", error: "error_max_budget_usd", ...RAN}),
			"error_max_budget_usd",
		],
		[
			"what it handed back is not a form",
			() => ({answer: "misfit", ...RAN}),
			"does not read as a form",
		],
		[
			"its form left a criterion out",
			drafts((brief) => ({...passing(brief), rows: passing(brief).rows.slice(1)})),
			"criterion 1 has no row",
		],
		[
			"its form fails a criterion and names nothing to change",
			drafts((brief) => ({
				...passing(brief),
				rows: passing(brief).rows.map((row) =>
					row.n === 2 ? {n: 2, grade: "fail" as const, where: [], says: "no"} : row,
				),
			})),
			"criterion 2 is graded fail",
		],
	])("is stuck, with what the run cost kept, when %s", async (_name, answer, problem) => {
		const got = await reaching(runOn("final", answer).ran, "draft");
		expect(got.name).toBe("stuck:draft_failed");
		expect(got.problems.join("\n")).toContain(problem);
		expect(got.ran.spend).toEqual(SPEND);
	});

	it("is stuck when the pull request cannot be read at all", async () => {
		const got = await reaching(runOn("final", never, {change: "breaks"}).ran, "read");
		expect(got.name).toBe("stuck:read_failed");
	});

	it.each<[string, Answers, string]>([
		["the ticket cannot be read", {ticket: "breaks"}, "stuck:ticket_unknown"],
		["the diff cannot be read", {diff: "breaks"}, "stuck:diff_unknown"],
		[
			"the text names no ticket",
			{
				change: changed(recorded("change-final.json"), (repo) => {
					repo.pullRequest.body = "A change.";
				}),
			},
			"send:builder:no_ticket",
		],
		[
			"a skill page changed and the folder has no skill rubric",
			{files: JSON.stringify({files: [{filename: "skills/x/SKILL.md"}]})},
			"stuck:rubric_unknown",
		],
	])("stops before the reviewer when %s", async (_name, answers, expected) => {
		const {ran, briefs} = runOn("final", never, answers);
		expect((await reaching(ran, "gate")).name).toBe(expected);
		expect(briefs).toEqual([]);
	});

	it("skips a merged pull request when no commit is named, and reviews it when one is", async () => {
		expect((await reaching(runOn("final", never, {}, null).ran, "gate")).name).toBe("skip:merged");
		expect((await reaching(runOn("final", drafts(passing)).ran, "verdict")).name).toBe("done");
	});

	it("does not wait for a check that is still running: it says so, with no outcome and no reviewer", async () => {
		const running = changed(recorded("change-final.json"), (repo) => {
			for (const check of repo.commit.statusCheckRollup.contexts.nodes)
				Object.assign(check, {status: "IN_PROGRESS", conclusion: null});
		});
		const {ran, briefs} = runOn("final", never, {change: running});
		const got = await reaching(ran, "wait");
		expect(got.pack.checks.state).toBe("pending");
		expect("outcome" in got).toBe(false);
		expect(briefs).toEqual([]);
	});

	it("only ever reads: no call it makes writes to the code host", async () => {
		const {ran, calls} = runOn("final", drafts(passing));
		await ran;
		expect(calls).toHaveLength(5);
		for (const call of calls) {
			expect(call[0]).toBe("api");
			expect(call.some((arg) => ["-X", "--method", "--input"].includes(arg))).toBe(false);
			const query = call.find((arg) => arg.startsWith("query="));
			if (query === undefined) expect(call[1]).toMatch(/^repos\/example\/repo\/compare\//);
			else expect(query).toMatch(/^query=\s*query\(/);
		}
	});
});
