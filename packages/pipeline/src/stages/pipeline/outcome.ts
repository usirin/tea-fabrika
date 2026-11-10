import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What a whole lane hands back, in the shape every stage uses (`../outcome.ts`). The step that
// ended it is in `said`, by its outcome's name, beside this.
//
// Self-fix PR 5: a lane either ends or stops. An end is `done`, a `skip`, or a stuck reason in
// `FINAL`: nobody goes on from it. Every other stuck reason, and `ask:owner:paused`, is a stop the
// same line goes on from:
//
//   isEnd({kind: "skip", why: "closed"})          // true: the line says so again, and runs nothing
//   isEnd({kind: "stuck", why: "step_stuck"})     // false: the line goes on at the step that stopped
//   isEnd({kind: "ask", who: "owner", for: "paused"})  // false: a person's `no` or `stop`

const lane = outcomesOf({
	/** The change is merged, or triage closed the ticket as a no or a duplicate. */
	done: {},
	send: {},
	/**
	 * A person is next. `paused`: they picked `no` or `stop` on a question, and the lane is saved
	 * where that pick goes on: they type the same line again, or close the ticket.
	 */
	ask: {owner: ["paused"]},
	/**
	 * Nothing more to do, on someone's decision. `closed`: the ticket is closed. `owner_no`: the
	 * person answered no. `research`: triage says this ends in a finding, not a change. `claimed`:
	 * another lane holds the ticket, and `said` names it, as operate does (jidoka row 3).
	 */
	skip: ["closed", "owner_no", "research", "claimed"],
	/**
	 * Stop, never guess. `not_yours`: the ticket was not filed by the person running the lane, or by
	 * an agent of theirs, so no agent reads it on their login. `no_ticket`: it could not be read.
	 * `claim_held`: another lane holds it. `step_failed`: a step could not be run at all.
	 * `step_stuck`: a step ended stuck. `rounds_spent`: review kept sending it back.
	 * `sent_back`: a step sent it somewhere this lane has no way to go. `checks_not_run`: code's checks
	 * after the build could not run at its head, or a step after build had no green ones there.
	 * `checks_red`: code's checks failed at the head a step after build was to run on, and the builder
	 * said that head was done. Red on the mutants job's commit goes back to the builder instead.
	 * `merged_elsewhere`: someone else merged the pull request, at a head this lane did not push.
	 */
	stuck: [
		"not_yours",
		"no_ticket",
		"claim_held",
		"step_failed",
		"step_stuck",
		"rounds_spent",
		"sent_back",
		"checks_not_run",
		"checks_red",
		"merged_elsewhere",
	],
});

export const LaneOutcome = lane.schema;
export type LaneOutcome = typeof LaneOutcome.Type;
export type LaneName = Name<LaneOutcome>;
export const LANE_NAMES = lane.names;

type Stuck = Extract<LaneOutcome, {readonly kind: "stuck"}>;
export type StuckWhy = Stuck["why"];

/**
 * The stuck reasons that are a person's call, never the lane's: the same line says why and runs
 * nothing. `not_yours`: no agent reads a ticket on a login it was not filed under.
 * `merged_elsewhere`: what landed is someone else's, and running a step again cannot change it.
 */
const FINAL_WHYS = ["not_yours", "merged_elsewhere"] as const satisfies readonly StuckWhy[];
export const FINAL: ReadonlySet<StuckWhy> = new Set<StuckWhy>(FINAL_WHYS);

/** How a lane ends: nobody goes on from it. */
export type EndOutcome =
	| Exclude<LaneOutcome, {readonly kind: "stuck" | "ask"}>
	| (Stuck & {readonly why: (typeof FINAL_WHYS)[number]});

/** How a lane stops: the same line goes on from it. A stuck reason in `FINAL` read back from a save is one too, and a restart refuses it. */
export type StopOutcome = Stuck | Extract<LaneOutcome, {readonly kind: "ask"}>;

/** Whether nobody goes on from `outcome`. Pure. */
export const isEnd = (outcome: LaneOutcome): outcome is EndOutcome =>
	outcome.kind === "done" ||
	outcome.kind === "skip" ||
	(outcome.kind === "stuck" && FINAL.has(outcome.why));

const isStop = (outcome: LaneOutcome): outcome is StopOutcome =>
	outcome.kind === "stuck" || outcome.kind === "ask";

export const EndOutcome = LaneOutcome.pipe(Schema.refine(isEnd));
export const StopOutcome = LaneOutcome.pipe(Schema.refine(isStop));
