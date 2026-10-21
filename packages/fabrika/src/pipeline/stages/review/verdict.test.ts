import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {nameOf} from "../outcome.ts";
import {briefOf, WHOLE} from "./scripted.ts";
import type {Finding, Row, Sheet} from "./sheet.ts";
import {criteriaOf, outcomeOf, type Verdict, verdictOf, verdictsOf} from "./verdict.ts";

// The Check after the reviewer, as a full table: every mix of row grades,
// against every thing a finding can be for the kind that is asked about.

const pass: Row = {id: criterionId("c1"), grade: "pass", where: [], says: "", limit: null};
const fail: Row = {id: criterionId("c2"), grade: "fail", where: [], says: ""};
const unseen: Row = {id: criterionId("c3"), grade: "unseen", says: ""};

const finding = (kind: Finding["kind"], state: Finding["state"]): Finding => ({
	id: `${kind}-${state}`,
	state,
	kind,
	from: {source: "check", name: "a standing check"},
	fault: "a fault",
	at: null,
	proof: "a proof",
	wants: "a fix",
});
const sheetOf = (rows: readonly Row[], findings: readonly Finding[] = []): Sheet => ({
	head: "a".repeat(40),
	rows,
	findings,
	skipped: [],
});

const ROWS: readonly [string, readonly Row[]][] = [
	["every row passed", [pass]],
	["a row failed", [pass, fail]],
	["a row could not be seen", [pass, unseen]],
	["a row failed and another could not be seen", [pass, fail, unseen]],
	["no row at all", []],
];
const FINDINGS: readonly [string, readonly Finding[]][] = [
	["no finding", []],
	["an open finding of this kind", [finding("review-code", "open")]],
	["an open finding of another kind", [finding("review-doc", "open")]],
	["a closed finding of this kind", [finding("review-code", "closed")]],
	[
		"a closed one of this kind and an open one of another",
		[finding("review-code", "closed"), finding("review-doc", "open")],
	],
];

/** The verdict of review-code for each pair, row mix by finding mix, written out by hand. */
const EXPECTED: readonly (readonly Verdict[])[] = [
	//no finding  open, this  open, other  closed, this  closed this + open other
	["pass", "fail", "pass", "pass", "pass"], // every row passed
	["fail", "fail", "fail", "fail", "fail"], // a row failed
	["unseen", "fail", "unseen", "unseen", "unseen"], // a row could not be seen
	["fail", "fail", "fail", "fail", "fail"], // a row failed and another could not be seen
	["pass", "fail", "pass", "pass", "pass"], // no row at all
];

describe("one kind's verdict", () => {
	const table = ROWS.flatMap(([rowsName, rows], r) =>
		FINDINGS.map(
			([findingsName, findings], f) =>
				[
					rowsName,
					findingsName,
					rows,
					findings,
					(EXPECTED[r] as readonly Verdict[])[f] as Verdict,
				] as const,
		),
	);

	it("covers every pair", () => {
		expect(table).toHaveLength(25);
	});

	it.each(table)("%s, %s", (_rows, _findings, rows, findings, expected) => {
		expect(verdictOf(sheetOf(rows, findings), "review-code")).toBe(expected);
	});

	it("never fails a kind because a row could not be seen", () => {
		expect(verdictOf(sheetOf([unseen, unseen]), "review-code")).toBe("unseen");
	});

	it("fails every kind on a failed row, and only its own kind on a finding", () => {
		expect(verdictsOf(["review-code", "review-doc"], sheetOf([pass, fail]))).toEqual([
			{kind: "review-code", verdict: "fail"},
			{kind: "review-doc", verdict: "fail"},
		]);
		expect(
			verdictsOf(["review-code", "review-doc"], sheetOf([pass], [finding("review-doc", "open")])),
		).toEqual([
			{kind: "review-code", verdict: "pass"},
			{kind: "review-doc", verdict: "fail"},
		]);
	});
});

describe("the criteria, open or met", () => {
	it("keeps each ticket criterion under its id and the version judged, wherever its box stands", () => {
		const c4 = criterionId("c4");
		const c1 = criterionId("c1");
		// A ticket whose list put a new criterion first, and said c1 again.
		const brief = briefOf({
			...WHOLE,
			criteria: [
				{id: c4, version: 1, text: "a new claim", checked: false, evidence: null},
				{id: c1, version: 2, text: "it works, said again", checked: false, evidence: null},
			],
		});
		const judged = criteriaOf(
			brief,
			sheetOf(
				[
					{id: c1, grade: "pass", where: [], says: "seen", limit: null},
					{id: c4, grade: "fail", where: [], says: "not there"},
				],
				[finding("review-code", "open")],
			),
		);
		expect(
			judged.map((c) => (c.from === "ticket" ? [c.id, c.version, c.state] : [c.from, c.state])),
		).toEqual([
			["c4", 1, "open"],
			["c1", 2, "met"],
			// One the review added has no id: no book gave it one.
			["review", "open"],
		]);
	});
});

describe("the stage's outcome", () => {
	const BRIEF = briefOf(WHOLE);
	const PART = briefOf({...WHOLE, kinds: ["review-code", "review-doc", "governance"]});
	const of = (code: Verdict, doc: Verdict, brief = BRIEF) =>
		outcomeOf(brief, [
			{kind: "review-code", verdict: code},
			{kind: "review-doc", verdict: doc},
		]);

	it.each<[Verdict, Verdict, string]>([
		["pass", "pass", "done"],
		["pass", "fail", "send:builder:review_failed"],
		["fail", "pass", "send:builder:review_failed"],
		["fail", "fail", "send:builder:review_failed"],
		["pass", "unseen", "stuck:unseen"],
		["unseen", "unseen", "stuck:unseen"],
		["fail", "unseen", "send:builder:review_failed"],
		["unseen", "fail", "send:builder:review_failed"],
	])("code %s, doc %s", (code, doc, expected) => {
		expect(nameOf(of(code, doc))).toBe(expected);
	});

	it("is done at the commit that was reviewed", () => {
		expect(of("pass", "pass")).toEqual({kind: "done", part: false, head: BRIEF.head});
	});

	it("is done in part when the change owes a kind this stage does not do", () => {
		expect(of("pass", "pass", PART)).toEqual({kind: "done", part: true, head: PART.head});
		// What is owed elsewhere does not soften a fail.
		expect(nameOf(of("pass", "fail", PART))).toBe("send:builder:review_failed");
	});
});
