import {Schema} from "effect";
import {CriterionId, Version} from "../../criteria/book.ts";
import type {Brief} from "./gate.ts";
import type {ReviewOutcome} from "./outcome.ts";
import {TextKind} from "./pack.ts";
import {Finding, Place, type Sheet} from "./sheet.ts";

// The Check after the reviewer: the verdict, worked out from the sheet. The
// agent never says pass or fail for a review. It grades rows and writes
// findings; these few lines do the rest, the same way every time.

/** `unseen`: nothing failed, and a criterion could not be seen. Neither a pass nor a fail. */
export const Verdict = Schema.Literals(["pass", "fail", "unseen"]);
export type Verdict = typeof Verdict.Type;

/**
 * One kind's verdict. Fail if any row failed or any finding of that kind is
 * open. Otherwise pass, unless a row could not be seen, which is neither.
 *
 * A row belongs to no kind: a criterion is the ticket's, not a review's. So
 * a failed row fails every kind the change owes, and an unseen row holds
 * every kind back. A finding counts for its own kind only.
 */
export function verdictOf(sheet: Sheet, kind: TextKind): Verdict {
	const failed =
		sheet.rows.some((row) => row.grade === "fail") ||
		sheet.findings.some((finding) => finding.kind === kind && finding.state === "open");
	if (failed) return "fail";
	return sheet.rows.some((row) => row.grade === "unseen") ? "unseen" : "pass";
}

export const KindVerdict = Schema.Struct({kind: TextKind, verdict: Verdict});
export type KindVerdict = typeof KindVerdict.Type;

/** The verdict of each kind, in the order the kinds are owed. */
export const verdictsOf = (kinds: readonly TextKind[], sheet: Sheet): readonly KindVerdict[] =>
	kinds.map((kind) => ({kind, verdict: verdictOf(sheet, kind)}));

/**
 * The stage's one outcome, from the verdicts. Any fail goes back to the
 * builder. With none, an unseen one stops: nobody is told "pass" on a
 * criterion nobody saw. All passed is done; in part when the change owes a
 * kind of review this stage does not do.
 */
export function outcomeOf(brief: Brief, verdicts: readonly KindVerdict[]): ReviewOutcome {
	if (verdicts.some((v) => v.verdict === "fail"))
		return {kind: "send", to: "builder", why: "review_failed"};
	if (verdicts.some((v) => v.verdict === "unseen")) return {kind: "stuck", why: "unseen"};
	return {kind: "done", part: brief.left.length > 0, head: brief.head};
}

// ---------------------------------------------------------------- the criteria, open or met

/**
 * One criterion of the result. It is only ever `met` or `open`: there is no
 * third state for a reader to weigh.
 *
 * `from`: `ticket` for a criterion the ticket lists, `review` for one the
 * review added. A real problem that no criterion of the ticket covers (a
 * finding from a rubric's standing check, or from a deviation) becomes a
 * criterion of its own here: its text is what the finding wants, and it is
 * open. So it makes the result not passed, the same way a failed criterion
 * does.
 *
 * The reviewer's form keeps its three grades. `unseen` stays there because it
 * tells the agent not to guess: a criterion it could not look at is never
 * graded `fail`. In the result an unseen criterion is open, and `says` is
 * why it could not be seen.
 */
const judgedFields = {
	text: Schema.String,
	/** In the reviewer's words: how it knows, why it is not met, or what it could not see. */
	says: Schema.String,
	/** The lines that show it. */
	where: Schema.Array(Place),
	/** What keeps it open: the findings that came from it. */
	findings: Schema.Array(Finding),
};

/** A criterion of the ticket: its id, and the wording the review judged. */
export const TicketJudged = Schema.Struct({
	from: Schema.Literal("ticket"),
	id: CriterionId,
	version: Version,
	state: Schema.Literals(["met", "open"]),
	...judgedFields,
});
export type TicketJudged = typeof TicketJudged.Type;

/** One the review added. It has no id: no criteria book gave it one, and it is open by being here. */
export const ReviewJudged = Schema.Struct({
	from: Schema.Literal("review"),
	state: Schema.Literal("open"),
	...judgedFields,
});
export type ReviewJudged = typeof ReviewJudged.Type;

export const Judged = Schema.Union([TicketJudged, ReviewJudged]);
export type Judged = typeof Judged.Type;

/**
 * The criteria of a sheet, each open or met: the ticket's, in its order, then
 * one per finding no criterion of the ticket covers. Every criterion is met
 * exactly when `outcomeOf` says `done`.
 */
export function criteriaOf(brief: Brief, sheet: Sheet): readonly Judged[] {
	const open = sheet.findings.filter((finding) => finding.state === "open");
	const ticket = brief.criteria.map((criterion): Judged => {
		const row = sheet.rows.find((r) => r.id === criterion.id);
		const findings = open.filter(
			(f) => f.from.source === "criterion" && f.from.id === criterion.id,
		);
		const base = {
			from: "ticket" as const,
			id: criterion.id,
			version: criterion.version,
			text: criterion.text,
			findings,
		};
		if (row === undefined) return {...base, state: "open", says: "No row was given.", where: []};
		if (row.grade === "unseen") return {...base, state: "open", says: row.says, where: []};
		return {
			...base,
			state: row.grade === "pass" && findings.length === 0 ? "met" : "open",
			says: row.says,
			where: row.where,
		};
	});
	const added = open
		.filter((finding) => finding.from.source !== "criterion")
		.map(
			(finding): Judged => ({
				text: finding.wants,
				from: "review",
				state: "open",
				says: finding.fault,
				where: finding.at === null ? [] : [finding.at],
				findings: [finding],
			}),
		);
	return [...ticket, ...added];
}
