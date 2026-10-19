import {Schema} from "effect";
import {BuildReport} from "../build/machine.ts";
import {BuildOutcome} from "../build/outcome.ts";
import {Item} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import type {Reviewed} from "../review/program.ts";
import type {Place} from "../review/sheet.ts";
import {ShipOutcome} from "../ship/outcome.ts";
import type {LoopOutcome} from "./outcome.ts";

// The loop's decisions, as pure functions: what each stage handed back, and
// what the loop does next. The machine (./machine.ts) only carries them out.
//
// The stop rule. After each review, the loop counts what is still open: each
// criterion the review left open, and one for red checks. Then:
//
//   nothing open                          ship it
//   open, and no fewer than the round     stop, and ask the owner: no_progress
//     before left
//   open, and this was the last round     stop, and ask the owner: rounds
//   open, and fewer than before           build again, told what is open
//
// A round whose builder changed nothing stops before its review: the same
// commit would be reviewed again for the same answer (no_change).

/** How one build child ended, as the loop is handed it. */
export const BuildEnd = Schema.Struct({
	outcome: BuildOutcome,
	name: Schema.String,
	report: BuildReport,
});
export type BuildEnd = typeof BuildEnd.Type;

/** How one ship child ended. `outcome: null`: read mode stopped at the write it would send, named in `said`. */
export const ShipEnd = Schema.Struct({
	outcome: Schema.NullOr(ShipOutcome),
	said: Schema.String,
});
export type ShipEnd = typeof ShipEnd.Type;

/** One round, as the loop records it. Each stage's part is `null` until that stage has ended. */
export const Round = Schema.Struct({
	n: Schema.Finite,
	/** The build's outcome, by name. */
	built: Schema.String,
	pr: Schema.NullOr(Schema.String),
	head: Schema.NullOr(Schema.String),
	/** The builder added a commit this round. */
	changed: Schema.Boolean,
	/** The review's outcome, by name. */
	reviewed: Schema.NullOr(Schema.String),
	/** How many were open after the review. `null`: no review ended this round. */
	open: Schema.NullOr(Schema.Finite),
	/** What was open, as the next round is told it. */
	items: Schema.Array(Item),
	/** The ship's outcome, by name. */
	shipped: Schema.NullOr(Schema.String),
	/** What this round's agents cost, in dollars. */
	spend: Schema.Finite,
	/**
	 * What went wrong in the round, in the stages' own words: why the build
	 * stopped, each review form code refused (`problemsOf`, ../review/machine.ts)
	 * and why the review stopped. Kept here, in the loop's own state, so it
	 * outlives the stages' state that the tidy-up clears, and it is in the
	 * loop's end result.
	 */
	problems: Schema.Array(Schema.String),
});
export type Round = typeof Round.Type;

/**
 * What the loop does next. `ship` names the head it may ship: the one this
 * round built, which the review passed. `end`'s `said`: why, in words, where
 * the stage outcome the loop read does not say it.
 */
export type Next =
	| {readonly go: "review"}
	| {readonly go: "ship"; readonly head: string}
	| {readonly go: "build"; readonly items: readonly Item[]}
	| {readonly go: "end"; readonly outcome: LoopOutcome; readonly said?: string};

const end = (outcome: LoopOutcome, said?: string): Next =>
	said === undefined ? {go: "end", outcome} : {go: "end", outcome, said};
const where = (place: Place) =>
	`${place.file}:${place.first === place.last ? place.first : `${place.first}-${place.last}`}`;

/**
 * What a review left open, as the next round is told it: each open criterion
 * with why and what it wants, and one item for red checks, which the review
 * sends back before any reviewer reads the change.
 */
export function openItems(reviewed: Pick<Reviewed, "outcome" | "criteria">): readonly Item[] {
	if (reviewed.outcome.kind === "send" && reviewed.outcome.why === "checks_red")
		return [
			{
				criterion: null,
				text: "A check is red at the head.",
				says: "The repository's checks failed on the pushed commit, so no reviewer read it.",
				where: [],
				wants: ["The repository's typecheck, lint and tests all pass."],
			},
		];
	return reviewed.criteria
		.filter((criterion) => criterion.state === "open")
		.map((criterion) => ({
			criterion: criterion.from === "ticket" ? criterion.id : null,
			text: criterion.text,
			says: criterion.says,
			where: criterion.where.map(where),
			wants: criterion.findings.map((finding) => finding.wants),
		}));
}

/** After a build: review it, or stop. */
export function afterBuild(round: number, built: BuildEnd): Next {
	const {outcome} = built;
	switch (outcome.kind) {
		case "done":
			return !outcome.changed && round > 1
				? end({kind: "ask", who: "owner", for: "no_change"})
				: {go: "review"};
		case "skip":
			return end({kind: "skip", why: outcome.why});
		default:
			return end({kind: "stuck", why: "build"});
	}
}

/**
 * The stop rule, after a review. `rounds`: every round so far, the last one
 * with this review's open count already in it. `cap`: the most rounds.
 *
 * A pass counts only for the head it saw. It ships only when that is the head
 * this round built; a pass at any other head (someone pushed between the
 * build and the review) says nothing about the change the round made, so the
 * loop stops rather than ship what nobody reviewed.
 */
export function afterReview(
	rounds: readonly Round[],
	cap: number,
	reviewed: Pick<Reviewed, "outcome">,
	items: readonly Item[],
): Next {
	const {outcome} = reviewed;
	switch (outcome.kind) {
		case "done": {
			const built = rounds.at(-1)?.head ?? null;
			return built !== null && outcome.head === built
				? {go: "ship", head: built}
				: end(
						{kind: "stuck", why: "review"},
						`the review passed ${outcome.head}, and this round built ${built ?? "nothing"}`,
					);
		}
		case "send": {
			const now = rounds.at(-1);
			const before = rounds.at(-2);
			if (now === undefined) return end({kind: "stuck", why: "review"});
			if (before?.open != null && items.length >= before.open)
				return end({kind: "ask", who: "owner", for: "no_progress"});
			if (now.n >= cap) return end({kind: "ask", who: "owner", for: "rounds"});
			return {go: "build", items};
		}
		case "skip":
			return outcome.why === "draft"
				? end({kind: "stuck", why: "review"})
				: end({kind: "skip", why: outcome.why});
		default:
			return end({kind: "stuck", why: "review"});
	}
}

/**
 * After a ship. A send back to the builder is one more round, under the cap:
 * the review passed, so the open count does not apply. Anything else ends.
 */
export function afterShip(pr: string, round: number, cap: number, shipped: ShipEnd): Next {
	const {outcome} = shipped;
	if (outcome === null) return end({kind: "ask", who: "owner", for: "ship"});
	switch (outcome.kind) {
		case "done":
			return end({kind: "done", part: outcome.part, pr, head: outcome.commit, rounds: round});
		case "send":
			if (outcome.to !== "builder") return end({kind: "ask", who: "owner", for: "ship"});
			if (round >= cap) return end({kind: "ask", who: "owner", for: "rounds"});
			return {
				go: "build",
				items: [
					{
						criterion: null,
						text: `The ship stage sent it back: ${nameOf(outcome)}.`,
						says: "The review passed, and the pull request still could not be shipped.",
						where: [],
						wants: [
							"The pull request can be shipped: checks green, no conflicts, nothing left unanswered.",
						],
					},
				],
			};
		case "ask":
			return end({kind: "ask", who: "owner", for: "ship"});
		default:
			return end({kind: "stuck", why: "ship"});
	}
}
