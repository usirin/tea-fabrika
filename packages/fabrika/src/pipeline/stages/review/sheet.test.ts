import {Option} from "effect";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {jsonSchema, reader} from "../../schema.ts";
import {briefOf, WHOLE} from "./scripted.ts";
import {Form, type Found, formProblems, idOf, type Row, readForm} from "./sheet.ts";

// The sheet: what the schema refuses, how a finding gets its id, and the
// Check that holds a form against its brief.

const BRIEF = briefOf(WHOLE);
const C1 = criterionId("c1");
const C2 = criterionId("c2");
const C9 = criterionId("c9");
const PLACE = {file: "src/a.ts", first: 3, last: 9};
const PASS = {
	id: C1,
	grade: "pass",
	where: [PLACE],
	says: "the test covers it",
	limit: null,
} as const;
const FAIL = {id: C2, grade: "fail", where: [], says: "no page says it"} as const;
const UNSEEN = {id: C2, grade: "unseen", says: "its proof is in the pull request's text"} as const;
const FOUND: Found = {
	kind: "review-doc",
	from: {source: "criterion", id: C2},
	fault: "No page says what exit 3 means.",
	at: null,
	proof: "Grep for `exit 3` under docs/ finds nothing.",
	wants: "The reference page names exit 3 and when it happens.",
};
const STANDING: Found = {
	kind: "review-code",
	from: {source: "check", name: "no-silent-catch"},
	fault: "The catch drops the error.",
	at: {file: "src/a.ts", first: 12, last: 14},
	proof: "Lines 12 to 14 catch and return 0.",
	wants: "The error is reported.",
};
const GOOD: Form = {rows: [PASS, FAIL], findings: [FOUND], skipped: []};

describe("what the form's schema refuses", () => {
	const read = reader(Form);
	const fits = (value: unknown) => Option.isSome(read(value));
	const withRow = (row: unknown) => ({rows: [row], findings: [], skipped: []});
	const withFinding = (finding: unknown) => ({rows: [], findings: [finding], skipped: []});

	it("reads a form that fits, as an agent would hand it back in JSON", () => {
		expect(fits(JSON.parse(JSON.stringify(GOOD)))).toBe(true);
		expect(
			fits({
				rows: [PASS, UNSEEN],
				findings: [STANDING],
				skipped: [{what: "the tests", why: "no shell"}],
			}),
		).toBe(true);
	});

	it.each<[string, unknown]>([
		["a grade that is not one of the three", withRow({...PASS, grade: "partial"})],
		["a verdict word for a grade", withRow({...PASS, grade: "PASS"})],
		[
			"a passed row that says nothing about its limit",
			withRow({id: "c1", grade: "pass", where: [], says: "ok"}),
		],
		[
			"a failed row with no place to list its lines",
			withRow({id: "c2", grade: "fail", says: "no"}),
		],
		["a row with no id", withRow({grade: "unseen", says: "x"})],
		["a row that names its criterion by its place", withRow({grade: "unseen", says: "x", n: 2})],
		["a row whose id is a number", withRow({...UNSEEN, id: 2})],
		["a row whose id is a place in the plan", withRow({...UNSEEN, id: "t1.c2"})],
		["a row whose id no book gives", withRow({...UNSEEN, id: "c0"})],
		["a row that says nothing", withRow({id: "c2", grade: "unseen"})],
		[
			"a place whose lines are text",
			withRow({...PASS, where: [{file: "a.ts", first: "3", last: "9"}]}),
		],
		["a place with no file", withRow({...PASS, where: [{first: 3, last: 9}]})],
		["a finding of a kind this stage does not do", withFinding({...FOUND, kind: "governance"})],
		["a finding of no kind", withFinding({...FOUND, kind: undefined})],
		["a finding that came from nowhere", withFinding({...FOUND, from: {source: "hunch"}})],
		[
			"a finding from a criterion it does not name",
			withFinding({...FOUND, from: {source: "criterion"}}),
		],
		[
			"a finding from a criterion by its place",
			withFinding({...FOUND, from: {source: "criterion", n: 2}}),
		],
		["a finding with its fault and proof in one field", withFinding({...FOUND, proof: undefined})],
		["a finding that wants nothing", withFinding({...FOUND, wants: undefined})],
		["a form with no list of what was skipped", {rows: [], findings: []}],
		["a verdict in place of a form", {verdict: "PASS"}],
		["text", "PASS"],
	])("refuses %s", (_name, value) => {
		expect(fits(value)).toBe(false);
	});

	it("cannot be written in code with a criterion's place for its id", () => {
		// @ts-expect-error a row names its criterion by id, never by its place in a list
		const byPlace: Row = {n: 1, grade: "pass", where: [], says: "ok", limit: null};
		// @ts-expect-error an id is only what the book gives: a plain string is not one
		const byText: Row = {id: "c1", grade: "pass", where: [], says: "ok", limit: null};
		expect([byPlace, byText].map((row) => fits(withRow(row)))).toEqual([false, true]);
	});

	it("drops what a grade has no place for, so an unseen row never points at lines", () => {
		const row = Option.getOrThrow(read(withRow({...UNSEEN, where: [PLACE], limit: "x"}))).rows[0];
		expect(row).toEqual(UNSEEN);
	});

	it("is handed to the agent closed: no field the form does not name", () => {
		const text = JSON.stringify(jsonSchema(Form));
		expect(text).toContain('"additionalProperties":false');
		expect(text).not.toContain('"additionalProperties":true');
		// No finding id and no state: those are code's to give. A row's id is the criterion's.
		expect(text).not.toContain('"state"');
		expect(text).toContain('"required":["id","grade","says"]');
	});
});

describe("a finding's id", () => {
	it("is the kind and eight characters, and the same every time for the same finding", () => {
		expect(idOf(FOUND)).toBe(idOf({...FOUND}));
		expect(idOf(FOUND)).toMatch(/^doc-[0-9a-f]{8}$/);
		expect(idOf(STANDING)).toMatch(/^code-[0-9a-f]{8}$/);
		// Pinned: the same on any machine, in any run.
		expect(idOf(FOUND)).toBe(idOf({...FOUND, from: {source: "criterion", id: criterionId("c2")}}));
		expect(idOf(FOUND)).toBe("doc-d2fa8437");
		// The order an agent wrote an object's keys in does not reach the id.
		expect(idOf({...FOUND, from: {id: C2, source: "criterion"}})).toBe(idOf(FOUND));
	});

	it("stays when the lines move, the proof is put better, or the fix is said another way", () => {
		const id = idOf(STANDING);
		expect(idOf({...STANDING, at: {file: "src/a.ts", first: 40, last: 42}})).toBe(id);
		expect(idOf({...STANDING, proof: "Another way to show it."})).toBe(id);
		expect(idOf({...STANDING, wants: "Report it, or hand it on."})).toBe(id);
		expect(idOf({...STANDING, fault: "  the CATCH drops\nthe error. "})).toBe(id);
	});

	it("changes with the kind, the origin, the file, or the fault", () => {
		const id = idOf(STANDING);
		expect(idOf({...STANDING, kind: "review-doc"})).not.toBe(id);
		expect(idOf({...STANDING, from: {source: "check", name: "tests-prove-it"}})).not.toBe(id);
		expect(idOf({...STANDING, from: {source: "criterion", id: C1}})).not.toBe(id);
		expect(idOf({...STANDING, at: {file: "src/b.ts", first: 12, last: 14}})).not.toBe(id);
		expect(idOf({...STANDING, at: null})).not.toBe(id);
		expect(idOf({...STANDING, fault: "The catch hides the error."})).not.toBe(id);
	});
});

describe("the check on a form", () => {
	it("finds nothing wrong with a form that holds together", () => {
		expect(formProblems(GOOD, BRIEF)).toEqual([]);
		expect(formProblems({rows: [PASS, UNSEEN], findings: [STANDING], skipped: []}, BRIEF)).toEqual(
			[],
		);
	});

	it.each<[string, Form, string]>([
		["a criterion has no row", {...GOOD, rows: [PASS], findings: []}, "criterion c2 has no row"],
		["a criterion has two rows", {...GOOD, rows: [PASS, FAIL, UNSEEN]}, "criterion c2 has 2 rows"],
		[
			"a row is for a criterion the ticket does not have",
			{...GOOD, rows: [PASS, FAIL, {...UNSEEN, id: C9}]},
			"a row is for criterion c9, and the ticket has no such criterion",
		],
		[
			"a failed row has no finding",
			{...GOOD, findings: []},
			"criterion c2 is graded fail, and no finding says what has to change",
		],
		[
			"a passed row has a finding",
			{...GOOD, findings: [FOUND, {...FOUND, from: {source: "criterion", id: C1}}]},
			"criterion c1 is graded pass, and a finding comes from it",
		],
		[
			"a finding is for a kind the change does not owe",
			{...GOOD, findings: [FOUND, {...STANDING, kind: "review-skill"}]},
			"which this change does not owe",
		],
		[
			"a finding comes from a criterion the ticket does not have",
			{...GOOD, findings: [FOUND, {...FOUND, from: {source: "criterion", id: C9}}]},
			"comes from criterion c9",
		],
		[
			"a row's lines run backwards",
			{...GOOD, rows: [{...PASS, where: [{file: "a.ts", first: 9, last: 3}]}, FAIL]},
			"the row for criterion c1 names lines that are not lines",
		],
		[
			"a finding's line is line 0",
			{...GOOD, findings: [FOUND, {...STANDING, at: {file: "a.ts", first: 0, last: 2}}]},
			"names lines that are not lines",
		],
		[
			"a finding's line is half a line",
			{...GOOD, findings: [FOUND, {...STANDING, at: {file: "a.ts", first: 1.5, last: 2}}]},
			"names lines that are not lines",
		],
		[
			"a finding does not say what is wrong",
			{...GOOD, findings: [{...FOUND, fault: " "}]},
			"does not say what is wrong, or what it wants",
		],
		[
			"a pass names a limit",
			{...GOOD, rows: [{...PASS, limit: "except the painted-shut window"}, FAIL]},
			'criterion c1 is graded pass with a limit ("except the painted-shut window"). A limit is never a pass',
		],
	])("says so when %s", (_name, form, problem) => {
		expect(formProblems(form, BRIEF).join("\n")).toContain(problem);
	});

	it("names every problem, not only the first", () => {
		expect(formProblems({rows: [], findings: [], skipped: []}, BRIEF)).toEqual([
			"criterion c1 has no row",
			"criterion c2 has no row",
		]);
	});
});

describe("a form made a sheet", () => {
	it("puts the rows in the ticket's order and gives each finding its id, open", () => {
		const made = readForm(BRIEF, {
			rows: [FAIL, PASS],
			findings: [FOUND, STANDING],
			skipped: [{what: "the tests", why: "no shell"}],
		});
		if (made.answer !== "sheet") throw new Error("not a sheet");
		expect(made.sheet).toEqual({
			head: BRIEF.head,
			// A checked pass keeps no limit: there is none it could hold.
			rows: [{id: C1, grade: "pass", where: [PLACE], says: "the test covers it"}, FAIL],
			findings: [
				{id: idOf(FOUND), state: "open", ...FOUND},
				{id: idOf(STANDING), state: "open", ...STANDING},
			],
			skipped: [{what: "the tests", why: "no shell"}],
		});
	});

	it("keeps a finding written twice once", () => {
		const made = readForm(BRIEF, {...GOOD, findings: [FOUND, {...FOUND, proof: "said again"}]});
		if (made.answer !== "sheet") throw new Error("not a sheet");
		expect(made.sheet.findings).toHaveLength(1);
		expect(made.sheet.findings[0]?.proof).toBe(FOUND.proof);
	});

	it("is not a sheet while the form has a problem", () => {
		expect(readForm(BRIEF, {...GOOD, findings: []})).toEqual({
			answer: "problems",
			problems: ["criterion c2 is graded fail, and no finding says what has to change"],
		});
	});
});
