import {type Name, outcomesOf} from "../outcome.ts";

// What a whole lane hands back, in the shape every stage uses (`../outcome.ts`). The step that
// ended it is in `said`, by its outcome's name, beside this.

const lane = outcomesOf({
	/** The change is merged, or triage closed the ticket as a no or a duplicate. */
	done: {},
	send: {},
	ask: {},
	/**
	 * Nothing more to do, on someone's decision. `closed`: the ticket is closed. `owner_no`: the
	 * person answered no. `research`: triage says this ends in a finding, not a change.
	 */
	skip: ["closed", "owner_no", "research"],
	/**
	 * Stop, never guess. `not_yours`: the ticket was not filed by the person running the lane, or by
	 * an agent of theirs, so no agent reads it on their login. `no_ticket`: it could not be read.
	 * `claim_held`: another lane holds it. `step_failed`: a step could not be run at all.
	 * `step_stuck`: a step ended stuck. `rounds_spent`: review kept sending it back.
	 * `sent_back`: a step sent it somewhere this lane has no way to go.
	 */
	stuck: [
		"not_yours",
		"no_ticket",
		"claim_held",
		"step_failed",
		"step_stuck",
		"rounds_spent",
		"sent_back",
	],
});

export const LaneOutcome = lane.schema;
export type LaneOutcome = typeof LaneOutcome.Type;
export type LaneName = Name<LaneOutcome>;
export const LANE_NAMES = lane.names;
