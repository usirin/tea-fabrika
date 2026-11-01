import {Schema} from "effect";
import {markOf} from "../../criteria/mark.ts";
import type {CriterionId} from "../../ids.ts";
import type {Brief} from "./gate.ts";
import {type Criterion, TextKind} from "./pack.ts";
import {
	type Finding,
	type From,
	type Graded,
	isAgainstDecision,
	type Place,
	type Sheet,
} from "./sheet.ts";
import type {KindVerdict} from "./verdict.ts";

// The printout: the sheet as a comment a person can read, one per kind of
// review. Pure, and the markdown is only a view: nothing reads it back. The
// same three headings are there every time, in the same order, so a reader
// knows where to look and an empty part says "nothing" out loud.
//
// Nothing here is posted. Posting is a later piece.

export const HEADINGS = {
	change: "## What has to change",
	rows: "## Criteria",
	unseen: "## Not looked at",
} as const;

const NOTHING = "Nothing.";

const placeOf = (place: Place) =>
	`\`${place.file}:${place.first === place.last ? place.first : `${place.first}-${place.last}`}\``;
const fromOf = (from: From) => {
	switch (from.source) {
		case "criterion":
			return `criterion ${from.id}`;
		case "check":
			return `standing check: ${from.name}`;
		case "deviation":
			return `deviation: ${from.about}`;
		case "rule":
			return `the repository's ${from.file}: ${from.rule}`;
		case "decision":
			return `a person's decision on the plan, question ${from.id}`;
	}
};
/** A text on one line: a list item that breaks its line would break the list. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function findingLines(finding: Finding): string[] {
	return [
		`- **${finding.id}** ${finding.at === null ? "(nothing to point at)" : placeOf(finding.at)}, from ${flat(fromOf(finding.from))}`,
		`  - Fault: ${flat(finding.fault)}`,
		`  - Proof: ${flat(finding.proof)}`,
		`  - Wants: ${flat(finding.wants)}`,
	];
}

function rowLines(row: Graded, criterion: Criterion | undefined): string[] {
	const mark = markOf({id: row.id, version: criterion?.version ?? 1});
	const head = `- ${mark} **${row.grade}**: ${flat(criterion?.text ?? "")}`;
	if (row.grade === "unseen") return [head, `  - ${flat(row.says)}`];
	const where = row.where.length === 0 ? "" : ` (${row.where.map(placeOf).join(", ")})`;
	return [head, `  - ${flat(row.says)}${where}`];
}

/** One kind's comment. */
export function renderKind(brief: Brief, sheet: Sheet, {kind, verdict}: KindVerdict): string {
	const found = sheet.findings.filter(
		(finding) => finding.kind === kind && finding.state === "open",
	);
	const open = found.filter((finding) => !isAgainstDecision(finding));
	const against = found.filter(isAgainstDecision);
	const criterionOf = (id: CriterionId) => brief.criteria.find((criterion) => criterion.id === id);
	const notLooked = [
		...sheet.rows.flatMap((row) =>
			row.grade === "unseen" ? [`- Criterion ${row.id}: ${flat(row.says)}`] : [],
		),
		...sheet.skipped.map((skipped) => `- ${flat(skipped.what)}: ${flat(skipped.why)}`),
		...brief.left.map(
			(left) => `- ${left}: the change owes this review too. This stage does not do it.`,
		),
		`- The required checks were read at this commit (${brief.checks.state}). They were not run again.`,
	];
	return [
		`**${kind}: ${verdict}** at \`${sheet.head.slice(0, 7)}\`, against ${brief.ticket.id}`,
		"",
		HEADINGS.change,
		"",
		...(open.length === 0 ? [NOTHING] : open.flatMap(findingLines)),
		"",
		...(against.length === 0
			? []
			: [
					"## Against a person's decision",
					"",
					"These fail nothing. The reviewer disagrees, and the call is the person's.",
					"",
					...against.flatMap(findingLines),
					"",
				]),
		HEADINGS.rows,
		"",
		...sheet.rows.flatMap((row) => rowLines(row, criterionOf(row.id))),
		"",
		HEADINGS.unseen,
		"",
		...notLooked,
		"",
	].join("\n");
}

export const Comment = Schema.Struct({kind: TextKind, text: Schema.String});
export type Comment = typeof Comment.Type;

/** One comment per kind, in the order of the verdicts. */
export const render = (
	brief: Brief,
	sheet: Sheet,
	verdicts: readonly KindVerdict[],
): readonly Comment[] =>
	verdicts.map((verdict) => ({kind: verdict.kind, text: renderKind(brief, sheet, verdict)}));
