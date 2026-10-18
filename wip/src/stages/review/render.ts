import {Schema} from "effect";
import type {Brief} from "./gate.ts";
import {TextKind} from "./pack.ts";
import type {Finding, From, Place, Row, Sheet} from "./sheet.ts";
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
			return `criterion ${from.n}`;
		case "check":
			return `standing check: ${from.name}`;
		case "deviation":
			return `deviation: ${from.about}`;
		case "rule":
			return `the repository's ${from.file}: ${from.rule}`;
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

function rowLines(row: Row, text: string): string[] {
	const head = `${row.n}. **${row.grade}**: ${flat(text)}`;
	if (row.grade === "unseen") return [head, `   - ${flat(row.says)}`];
	const where = row.where.length === 0 ? "" : ` (${row.where.map(placeOf).join(", ")})`;
	const limit =
		row.grade === "pass" && row.limit !== null ? [`   - Limit: ${flat(row.limit)}`] : [];
	return [head, `   - ${flat(row.says)}${where}`, ...limit];
}

/** One kind's comment. */
export function renderKind(brief: Brief, sheet: Sheet, {kind, verdict}: KindVerdict): string {
	const open = sheet.findings.filter(
		(finding) => finding.kind === kind && finding.state === "open",
	);
	const textOf = (n: number) => brief.criteria.find((criterion) => criterion.n === n)?.text ?? "";
	const notLooked = [
		...sheet.rows.flatMap((row) =>
			row.grade === "unseen" ? [`- Criterion ${row.n}: ${flat(row.says)}`] : [],
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
		HEADINGS.rows,
		"",
		...sheet.rows.flatMap((row) => rowLines(row, textOf(row.n))),
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
