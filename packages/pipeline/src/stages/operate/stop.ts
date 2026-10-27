import {Schema} from "effect";
import {asksOnStall} from "../../asks/rules.ts";
import {BuildReport} from "../build/machine.ts";
import {BuildOutcome} from "../build/outcome.ts";
import {Item} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import type {Reviewed} from "../review/program.ts";
import type {Place} from "../review/sheet.ts";
import {ShipOutcome} from "../ship/outcome.ts";
import {LoopOutcome} from "./outcome.ts";

// The loop's decisions, as pure functions: what each stage handed back, and
// what the loop does next. The machine (./machine.ts) only carries them out.
//
// The stop rule. After each review, the loop counts what is still open: each
// criterion the review left open, and one for red checks. Then:
//
//   nothing open                          ship it
//   open, and the second round in a row   stop, and ask the owner: no_progress
//     to leave no fewer than the one
//     before, or the third in a row
//     with no new lowest (the stall rule)
//   open, otherwise                       build again, told what is open
//
// There is no cap on rounds (docs/direction/done-is-per-criterion.md): a list
// that keeps getting shorter keeps going back to the builder, however long it
// was. Only the stall rule stops a loop that still has work.
//
// The stall rule is the asks core's (`asksOnStall`, ../../asks/rules.ts), not
// a copy: one stall earns one more round, a list that wobbles (1, 2, 1, 2)
// asks at its third round with no new lowest, and the loop asks the owner at
// the round the owner's desk raises its stuck ask.
//
// A ship that sends a passed head back to the builder leaves one thing open:
// the one item the next round is told. The stall rule reads that round as 1,
// so a ship that keeps sending back stops the loop as any other stall does.
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
	/**
	 * How many were open after the round: the review's count, or 1 when the
	 * ship sent the passed head back. `null`: no review ended this round.
	 */
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
export const Next = Schema.Union([
	Schema.Struct({go: Schema.Literal("review")}),
	Schema.Struct({go: Schema.Literal("ship"), head: Schema.String}),
	Schema.Struct({go: Schema.Literal("build"), items: Schema.Array(Item)}),
	Schema.Struct({
		go: Schema.Literal("end"),
		outcome: LoopOutcome,
		said: Schema.optionalKey(Schema.String),
	}),
]);
export type Next = typeof Next.Type;

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
 * The stall rule over the rounds before this one and this one's `items`:
 * build again, told them, or stop and ask the owner.
 */
function again(rounds: readonly Round[], items: readonly Item[]): Next {
	const opens = [
		...rounds.slice(0, -1).flatMap((r) => (r.open === null ? [] : [r.open])),
		items.length,
	];
	return asksOnStall(opens)
		? end({kind: "ask", who: "owner", for: "no_progress"})
		: {go: "build", items};
}

/**
 * The stop rule, after a review. `rounds`: every round so far, the last one
 * with this review's open count already in it.
 *
 * A pass counts only for the head it saw. It ships only when that is the head
 * this round built; a pass at any other head (someone pushed between the
 * build and the review) says nothing about the change the round made, so the
 * loop stops rather than ship what nobody reviewed.
 */
export function afterReview(
	rounds: readonly Round[],
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
		case "send":
			return rounds.length === 0 ? end({kind: "stuck", why: "review"}) : again(rounds, items);
		case "skip":
			return outcome.why === "draft"
				? end({kind: "stuck", why: "review"})
				: end({kind: "skip", why: outcome.why});
		default:
			return end({kind: "stuck", why: "review"});
	}
}

/**
 * What a ship left open: one item when it sent the passed head back to the
 * builder, else nothing. The round that shipped keeps it as its open list.
 */
export function shipItems(shipped: ShipEnd): readonly Item[] {
	const {outcome} = shipped;
	if (outcome?.kind !== "send" || outcome.to !== "builder") return [];
	return [
		{
			criterion: null,
			text: `The ship stage sent it back: ${nameOf(outcome)}.`,
			says: "The review passed, and the pull request still could not be shipped.",
			where: [],
			wants: [
				"The pull request can be shipped: checks green, no conflicts, nothing left unanswered.",
			],
		},
	];
}

/**
 * After a ship. `rounds`: every round so far, the last one the round that
 * shipped. A send back to the builder leaves one item open (`shipItems`), and
 * goes through the stall rule like a review's list: a ship that sends back
 * round after round stops the loop to ask the owner. Anything else ends.
 */
export function afterShip(pr: string, rounds: readonly Round[], shipped: ShipEnd): Next {
	const {outcome} = shipped;
	if (outcome === null) return end({kind: "ask", who: "owner", for: "ship"});
	switch (outcome.kind) {
		case "done":
			return end({
				kind: "done",
				part: outcome.part,
				pr,
				head: outcome.commit,
				rounds: rounds.at(-1)?.n ?? rounds.length,
			});
		case "send":
			if (outcome.to !== "builder") return end({kind: "ask", who: "owner", for: "ship"});
			return again(rounds, shipItems(shipped));
		case "ask":
			return end({kind: "ask", who: "owner", for: "ship"});
		default:
			return end({kind: "stuck", why: "ship"});
	}
}
