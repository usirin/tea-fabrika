import {describe, expect, it} from "vitest";
import {
	type CommentText,
	findingsIn,
	parseMarker,
	postedIn,
	verdictsBetween,
	verdictsIn,
} from "./verdict.ts";

// A review verdict of today's fabrika, read back from its comment. Every text
// here is written by hand in the shape the reviewer posts.

const HEAD = "bbe83ec08ab6a5140af3c7bef7f918b9380a753d";
const BASE = "eced6e282f48424c88c9db21f8378339e37dd912";
const marker = (namespace: string, polarity: string, clause: string, head = HEAD) =>
	`${namespace}: ${polarity} @ ${head} content:c2e1ec85c84f — ${clause}`;

describe("reading a marker line", () => {
	it("reads the namespace, the polarity, the commit and the reason", () => {
		expect(parseMarker(marker("review-skill", "FAIL", "three stale sentences"))).toEqual({
			namespace: "review-skill",
			polarity: "FAIL",
			head: HEAD,
			range: null,
			clause: "three stale sentences",
		});
	});

	it("reads a range verdict, as an epic child gets", () => {
		const read = parseMarker(
			`review-code: PASS range:${BASE}..${HEAD} content:ec88294e7cd7 — record fixed`,
		);

		expect(read).toMatchObject({
			polarity: "PASS",
			head: null,
			range: {base: BASE, tip: HEAD},
			clause: "record fixed",
		});
	});

	it("reads the older shapes: a short commit, no digest, no commit at all", () => {
		expect(
			parseMarker("review-doc: PASS @ 7982558 — the guard boundary is written down"),
		).toMatchObject({head: "7982558"});
		expect(parseMarker("governance: PASS — merge-ready.")).toMatchObject({
			namespace: "governance",
			head: null,
			clause: "merge-ready.",
		});
		expect(parseMarker("review-ui: FAIL")).toMatchObject({
			namespace: "review-ui",
			polarity: "FAIL",
			clause: "",
		});
	});

	it("refuses a line that is not a marker", () => {
		expect(parseMarker("## review-code: FAIL at bbe83ec0")).toBeNull();
		expect(parseMarker("review-code: advisory — criteria satisfied")).toBeNull();
		expect(parseMarker("ship: LANDED — PR #7389")).toBeNull();
		expect(parseMarker("Repair round 1 for the review-skill FAIL at bbe83ec0.")).toBeNull();
	});
});

describe("the verdicts in one comment", () => {
	it("finds none in a comment that does not open with a marker", () => {
		expect(
			verdictsIn(`Repair round 1.\n\n${marker("review-code", "PASS", "quoted, not posted")}`),
		).toEqual([]);
	});

	it("reads one verdict and its body", () => {
		const [only, ...rest] = verdictsIn(
			`${marker("review-code", "FAIL", "one bug")}\n\n## Findings\n\n1. It breaks.\n`,
		);

		expect(rest).toEqual([]);
		expect(only).toMatchObject({
			superseded: false,
			retiredOn: null,
			body: "## Findings\n\n1. It breaks.",
		});
		expect(only?.marker.polarity).toBe("FAIL");
	});

	it("keeps the verdict a re-post retired, under its dated heading", () => {
		const comment = [
			marker("review-code", "PASS", "record fixed"),
			"",
			"The record is fixed.",
			"",
			"<!-- fabrika:superseded -->",
			"",
			"## Superseded verdict — 2026-09-28",
			"",
			marker("review-code", "FAIL", "totals off by two"),
			"",
			"The totals are wrong.",
		].join("\n");

		const read = verdictsIn(comment);

		expect(read.map((v) => [v.marker.polarity, v.superseded, v.retiredOn, v.body])).toEqual([
			["PASS", false, null, "The record is fixed."],
			["FAIL", true, "2026-09-28", "The totals are wrong."],
		]);
	});

	it("does not take a quoted marker inside a body for a retired verdict", () => {
		const comment = `${marker("review-skill", "PASS", "round 2")}\n\nRound 1 said:\n\n${marker("review-skill", "FAIL", "round 1")}\n`;

		expect(verdictsIn(comment)).toHaveLength(1);
	});
});

describe("a comment's verdicts over its life", () => {
	const comment = (body: string, at: number, editedAt: number | null): CommentText => ({
		id: 7,
		url: "https://example.test/7",
		at,
		editedAt,
		body,
	});
	const fail = marker("review-code", "FAIL", "two names wrong");
	const pass = marker("review-code", "PASS", "merge-ready");

	it("reads an overwritten FAIL from the comment's earlier text", () => {
		const posted = postedIn(comment(pass, 1_000, 9_000), [
			{at: 1_000, body: `${fail}\n\nThe names are wrong.`},
			{at: 9_000, body: pass},
		]);

		expect(posted.map((p) => [p.marker.polarity, p.at])).toEqual([
			["FAIL", 1_000],
			["PASS", 9_000],
		]);
		expect(posted[0]?.body).toBe("The names are wrong.");
	});

	it("without the earlier texts, dates the standing verdict at the last edit and the oldest retired one at creation", () => {
		const body = `${pass}\n\n## Superseded verdict — 2026-09-28\n\n${fail}\n`;

		expect(
			postedIn(comment(body, 1_000, 9_000), null).map((p) => [p.marker.polarity, p.at]),
		).toEqual([
			["PASS", 9_000],
			["FAIL", 1_000],
		]);
	});

	it("gives nothing for a comment that is not a verdict", () => {
		expect(postedIn(comment("Repair round 1.", 1_000, null), null)).toEqual([]);
	});
});

describe("matching a lane line to its verdicts", () => {
	const MIN = 60_000;
	const posted = (commentId: number, at: number, polarity = "FAIL") => ({
		commentId,
		url: `https://example.test/${commentId}`,
		marker: parseMarker(marker("review-code", polarity, "x")) as NonNullable<
			ReturnType<typeof parseMarker>
		>,
		body: "",
		at,
	});

	it("takes what was posted after the event before, and up to a moment after the line", () => {
		const all = [posted(1, 5 * MIN), posted(2, 19 * MIN), posted(3, 21 * MIN), posted(4, 30 * MIN)];

		expect(verdictsBetween(all, 10 * MIN, 20 * MIN).map((p) => p.commentId)).toEqual([2, 3]);
	});

	it("leaves a line with no time before it unmatched: no reviewer ran in between", () => {
		expect(verdictsBetween([posted(1, 19 * MIN)], 20 * MIN, 20 * MIN)).toEqual([]);
	});

	it("counts a comment once, by the last text it held inside the window", () => {
		const all = [posted(1, 12 * MIN, "PASS"), posted(1, 18 * MIN, "FAIL")];

		const matched = verdictsBetween(all, 10 * MIN, 20 * MIN);

		expect(matched.map((p) => p.marker.polarity)).toEqual(["FAIL"]);
	});
});

describe("the findings in a failed verdict", () => {
	it("splits a Findings section into its numbered points, and tells a note from a blocker", () => {
		const body = [
			"## Per-criterion",
			"",
			"| 1 | It works | **PASS** | read it |",
			"",
			"## Findings",
			"",
			"**1 — the branch is renamed and the message says nothing changed (blocking).**",
			"",
			"Tested on a scratch repo.",
			"",
			"**2 — the remedy points at a tree with no special view (non-blocking).**",
			"",
			"## Deviations",
			"",
			"None.",
		].join("\n");

		const found = findingsIn(body);

		expect(found.map((f) => [f.blocking, f.from])).toEqual([
			[true, "item"],
			[false, "item"],
		]);
		expect(found[0]?.title).toBe(
			"1 — the branch is renamed and the message says nothing changed (blocking).",
		);
		expect(found[0]?.text).toContain("Tested on a scratch repo.");
	});

	it("reads a heading in the singular as one finding, whatever list sits inside it", () => {
		const body = [
			"## Why FAIL",
			"",
			"The fences carry substitutions. Three things make it blocking:",
			"",
			"1. **It binds new work.**",
			"2. **These are the fences that matter.**",
			"",
			"## Rubric",
			"",
			"Clean.",
		].join("\n");

		const found = findingsIn(body);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({blocking: true, from: "section"});
		expect(found[0]?.text).toContain("These are the fences that matter.");
	});

	it("prefers the list where a verdict has both a singular and a plural heading", () => {
		const body = [
			"## Why FAIL",
			"",
			"It is wrong.",
			"",
			"## Findings",
			"",
			"- **Blocking** — the three substitutions.",
			"- **Non-blocking** — the push became a verb.",
		].join("\n");

		expect(findingsIn(body).map((f) => f.blocking)).toEqual([true, false]);
	});

	it("takes deeper headings under a plural heading as the findings", () => {
		const body = [
			"## Findings",
			"",
			"### F1 — the new test is red at head",
			"",
			"It fails.",
			"",
			"### F5 — a nit: the bound is per command",
			"",
			"Small.",
		].join("\n");

		expect(findingsIn(body).map((f) => [f.title, f.blocking])).toEqual([
			["F1 — the new test is red at head", true],
			["F5 — a nit: the bound is per command", false],
		]);
	});

	it("marks a notes section as not blocking, and skips a section about the repair", () => {
		const body = [
			"## Blocking finding",
			"",
			"The guard reds.",
			"",
			"## Non-blocking notes",
			"",
			"- **One.** A small thing.",
			"",
			"## Repair",
			"",
			"Rename the file.",
		].join("\n");

		const found = findingsIn(body);

		expect(found.map((f) => f.blocking)).toEqual([true, false]);
		expect(found.some((f) => f.text.includes("Rename the file."))).toBe(false);
	});

	it("does not take an earlier round's findings for this round's", () => {
		const body = [
			"## Round 1's findings, re-read at this head",
			"",
			"1. Fixed.",
			"",
			"## Finding",
			"",
			"One sentence is still stale.",
		].join("\n");

		const found = findingsIn(body);

		expect(found).toHaveLength(1);
		expect(found[0]?.text).toContain("still stale");
	});

	it("falls back to the failing rows of a criteria table", () => {
		const body = [
			"## Per-criterion",
			"",
			"| # | Criterion | Verdict |",
			"|---|---|---|",
			"| 1 | It claims | **PASS** |",
			"| 3 | The route exists | **FAIL** |",
			"",
			"- AC7 — the suite is green: [FAIL]",
		].join("\n");

		expect(findingsIn(body).map((f) => [f.from, f.title])).toEqual([
			["row", "3 The route exists FAIL"],
			["row", "- AC7 — the suite is green: [FAIL]"],
		]);
	});

	it("falls back to a paragraph that opens with a bold FAIL", () => {
		const found = findingsIn(
			"**Scope.** Six files.\n\n**FAIL — the new fences contradict the record.** Three lines.\n\n**Gate half.** Clean.",
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({from: "paragraph", blocking: true});
	});

	it("finds nothing in a verdict that lists nothing, and leaves the reason to the caller", () => {
		expect(
			findingsIn(
				"The slice is clean. This namespace fails only because a criterion was appended this round.",
			),
		).toEqual([]);
		expect(findingsIn("## Findings\n\nNone.")).toEqual([]);
	});

	it("does not read a heading inside a code fence", () => {
		const body = [
			"## Finding",
			"",
			"The doc says:",
			"",
			"```",
			"## Findings",
			"1. not a finding",
			"```",
			"",
			"and that is false.",
		].join("\n");

		const found = findingsIn(body);

		expect(found).toHaveLength(1);
		expect(found[0]?.text).toContain("and that is false.");
	});
});
