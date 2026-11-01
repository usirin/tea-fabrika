import {createHash} from "node:crypto";
import {Schema} from "effect";
import {CriterionId} from "../../ids.ts";
import type {Check} from "../../primitives.ts";
import {RULE_FILES} from "../rules.ts";
import type {Brief} from "./gate.ts";
import {TextKind} from "./pack.ts";

// The sheet: what one review found, as data. A verdict is worked out from it
// by code (`verdict.ts`) and a comment is printed from it by code
// (`render.ts`). The reviewer never writes either.
//
//   rows      one per acceptance criterion: did the change meet it
//   findings  what has to change, each belonging to one kind of review
//   skipped   what the reviewer did not look at, and why
//
// The agent fills a `Form`: the same thing without ids. Code checks the form
// against the brief (`formProblems`), gives each finding its id, and only
// then is it a `Sheet` (`readForm`).

/** Lines of one file, as the file stands at the commit under review. */
export const Place = Schema.Struct({
	file: Schema.String,
	/** The first line, counted from 1. */
	first: Schema.Finite,
	/** The last line. The same as `first` for one line. */
	last: Schema.Finite,
});
export type Place = typeof Place.Type;

/** A criterion that is met, all of it. */
const Passed = Schema.Struct({
	/** The criterion's id, as its box names it. Never its place in the list. */
	id: CriterionId,
	grade: Schema.Literal("pass"),
	/** The lines that show it is met. */
	where: Schema.Array(Place),
	/** How the reviewer knows, in a sentence or two. */
	says: Schema.String,
});
const Failed = Schema.Struct({
	id: CriterionId,
	grade: Schema.Literal("fail"),
	/** The lines that show it is not met. Empty: what it asks for is not there at all. */
	where: Schema.Array(Place),
	says: Schema.String,
});
const Unseen = Schema.Struct({
	id: CriterionId,
	/** The reviewer could not see what it needed. It blocks a pass. It never causes a fail. */
	grade: Schema.Literal("unseen"),
	/** What was needed, and why it could not be seen. */
	says: Schema.String,
});

/**
 * One criterion, graded, as the reviewer hands it back. The grade decides
 * what else a row may hold, so a row that "could not be seen" cannot point
 * at lines.
 *
 * A pass may name a limit, so a reviewer that sees one says so rather than
 * hiding it. A limit is never a pass ("every window opens, except the
 * painted-shut one" leaves the criterion open): the Check refuses such a
 * form, and once a form is a sheet its rows ({@link Graded}) have no limit to
 * hold.
 */
export const Row = Schema.Union([
	Schema.Struct({
		...Passed.fields,
		/** What the pass does not cover. Anything but `null` sends the form back. */
		limit: Schema.NullOr(Schema.String),
	}),
	Failed,
	Unseen,
]);
export type Row = typeof Row.Type;

/** A row on a sheet: checked, so a pass is a whole pass. */
export const Graded = Schema.Union([Passed, Failed, Unseen]);
export type Graded = typeof Graded.Type;

/** Where a finding came from. */
export const From = Schema.Union([
	/** A criterion of the ticket, by its id. */
	Schema.Struct({source: Schema.Literal("criterion"), id: CriterionId}),
	/** A standing check of the rubric: something no criterion names. `name`: the rubric's own name for it. */
	Schema.Struct({source: Schema.Literal("check"), name: Schema.String}),
	/** A deviation: one the builder declared and should not have made, or a change nobody declared. */
	Schema.Struct({source: Schema.Literal("deviation"), about: Schema.String}),
	/** A rule of the repository's own (its CLAUDE.md or AGENTS.md) the change breaks. `rule`: the rule, in a few words. */
	Schema.Struct({
		source: Schema.Literal("rule"),
		file: Schema.Literals(RULE_FILES),
		rule: Schema.String,
	}),
]);
export type From = typeof From.Type;

/** A finding as the reviewer writes it. */
export const Found = Schema.Struct({
	/** The one kind of review it belongs to. */
	kind: TextKind,
	from: From,
	/** What is wrong, in a sentence or two. Only the fault: no proof, no fix. */
	fault: Schema.String,
	/** Where the fault is. `null`: it is something missing, so no line holds it. */
	at: Schema.NullOr(Place),
	/** What shows it: what the reviewer read or worked out. Kept apart from the fault, so each can be checked alone. */
	proof: Schema.String,
	/** What has to be true for it to be closed. Not how to write the fix. */
	wants: Schema.String,
	/** `ran`: the reviewer ran it and saw it. `read`: it worked it out from reading. */
	seen: Schema.optionalKey(Schema.Literals(["ran", "read"])),
});
export type Found = typeof Found.Type;

/**
 * A finding on the sheet. `id` is given by code. `state`: this piece only
 * ever makes `open` ones; a later round is what would close one.
 */
export const Finding = Schema.Struct({
	id: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	...Found.fields,
});
export type Finding = typeof Finding.Type;

/** Something the reviewer did not look at. */
export const Skipped = Schema.Struct({what: Schema.String, why: Schema.String});
export type Skipped = typeof Skipped.Type;

/** What the reviewer hands back: the one thing the agent writes. */
export const Form = Schema.Struct({
	rows: Schema.Array(Row),
	findings: Schema.Array(Found),
	skipped: Schema.Array(Skipped),
	gaps: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Form = typeof Form.Type;

export const Sheet = Schema.Struct({
	/** The commit the sheet is about. */
	head: Schema.String,
	/** One per criterion, in the ticket's order. */
	rows: Schema.Array(Graded),
	findings: Schema.Array(Finding),
	skipped: Schema.Array(Skipped),
});
export type Sheet = typeof Sheet.Type;

// ---------------------------------------------------------------- ids

const SHORT: Readonly<Record<TextKind, string>> = {
	"review-code": "code",
	"review-doc": "doc",
	"review-skill": "skill",
};
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A finding's id: its kind, then eight characters made from what the finding
 * is. The same finding gets the same id on every run, on any machine.
 *
 * "The same" means: the same kind, the same origin, the same file, and the
 * same fault in the same words (case and spacing aside). The line numbers,
 * the proof and what it wants are left out, so a finding keeps its id when
 * the lines above it move or its proof is put better. A fault said in other
 * words is another id: code cannot tell that two sentences mean one thing.
 */
export function idOf(found: Found): string {
	const {from} = found;
	// Written out field by field: the order of an object's keys must not reach the id.
	const origin = ((): readonly (string | number)[] => {
		switch (from.source) {
			case "criterion":
				return [from.source, from.id];
			case "check":
				return [from.source, plain(from.name)];
			case "deviation":
				return [from.source, plain(from.about)];
			case "rule":
				return [from.source, from.file, plain(from.rule)];
		}
	})();
	const what = JSON.stringify([found.kind, origin, found.at?.file ?? null, plain(found.fault)]);
	return `${SHORT[found.kind]}-${createHash("sha256").update(what).digest("hex").slice(0, 8)}`;
}

// ---------------------------------------------------------------- the Check on a form

const badPlace = (place: Place) =>
	!(
		Number.isInteger(place.first) &&
		Number.isInteger(place.last) &&
		place.first >= 1 &&
		place.last >= place.first
	);

/**
 * What is wrong with a form, set against the brief it answers. Empty: it can
 * be a sheet. This is about the form holding together, never about whether
 * the review is right.
 */
export const formProblems: Check<Form, Brief> = (form, brief) => {
	const problems: string[] = [];
	const asked: readonly CriterionId[] = brief.criteria.map((criterion) => criterion.id);
	for (const id of asked) {
		const rows = form.rows.filter((row) => row.id === id).length;
		if (rows !== 1)
			problems.push(rows === 0 ? `criterion ${id} has no row` : `criterion ${id} has ${rows} rows`);
	}
	for (const row of form.rows) {
		if (!asked.includes(row.id))
			problems.push(`a row is for criterion ${row.id}, and the ticket has no such criterion`);
		if (row.grade !== "unseen" && row.where.some(badPlace))
			problems.push(`the row for criterion ${row.id} names lines that are not lines`);
	}
	const fromCriterion = (id: CriterionId) =>
		form.findings.filter((found) => found.from.source === "criterion" && found.from.id === id);
	for (const row of form.rows) {
		const findings = fromCriterion(row.id).length;
		// A failed criterion with nothing to change gives the builder nothing to do.
		if (row.grade === "fail" && findings === 0)
			problems.push(`criterion ${row.id} is graded fail, and no finding says what has to change`);
		if (row.grade === "pass" && findings > 0)
			problems.push(`criterion ${row.id} is graded pass, and a finding comes from it`);
		// What a pass does not cover is still asked for: the criterion stays open.
		if (row.grade === "pass" && row.limit !== null)
			problems.push(
				`criterion ${row.id} is graded pass with a limit (${JSON.stringify(row.limit)}). A limit is never a pass: grade it fail, with a finding for what is not met, or unseen if you could not see it`,
			);
	}
	for (const found of form.findings) {
		const name = `the finding "${found.fault.slice(0, 60)}"`;
		if (!brief.kinds.includes(found.kind))
			problems.push(`${name} is for ${found.kind}, which this change does not owe`);
		if (found.from.source === "criterion" && !asked.includes(found.from.id))
			problems.push(
				`${name} comes from criterion ${found.from.id}, and the ticket has no such criterion`,
			);
		if (found.at !== null && badPlace(found.at))
			problems.push(`${name} names lines that are not lines`);
		if (found.fault.trim() === "" || found.wants.trim() === "")
			problems.push(`${name} does not say what is wrong, or what it wants`);
	}
	return problems;
};

/** A checked row, as a sheet keeps it: a pass that got here has no limit. */
const gradedOf = (row: Row): Graded => {
	if (row.grade !== "pass") return row;
	const {limit: _none, ...whole} = row;
	return whole;
};

export type ReadForm =
	| {readonly answer: "sheet"; readonly sheet: Sheet}
	| {readonly answer: "problems"; readonly problems: readonly [string, ...string[]]};

/**
 * A form, made a sheet: checked, its rows put in the ticket's order, each
 * finding given its id. A finding written twice is kept once.
 */
export function readForm(brief: Brief, form: Form): ReadForm {
	const [first, ...rest] = formProblems(form, brief);
	if (first !== undefined) return {answer: "problems", problems: [first, ...rest]};
	const findings = new Map<string, Finding>();
	for (const found of form.findings) {
		const id = idOf(found);
		if (!findings.has(id)) findings.set(id, {id, state: "open", ...found});
	}
	return {
		answer: "sheet",
		sheet: {
			head: brief.head,
			rows: brief.criteria.flatMap((c) => form.rows.filter((row) => row.id === c.id).map(gradedOf)),
			findings: [...findings.values()],
			skipped: form.skipped,
		},
	};
}
