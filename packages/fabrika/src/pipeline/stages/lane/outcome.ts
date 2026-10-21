import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What a plan's lane hands back (./machine.ts), in the shape every stage uses (`../outcome.ts`).
// A lane does not end on the owner: it waits for the answer, however long, and goes on.

const lane = outcomesOf({
	/** The plan's one pull request merged. `head`: the commit it merged at. */
	done: {pr: Schema.String, head: Schema.String},
	send: {},
	ask: {},
	/** `closed`: the owner said no to the plan. */
	skip: ["closed"],
	/**
	 * Stop, never guess. `read_failed`: the plan or the branch could not be read. `catchup_failed`,
	 * `build_failed`, `review_failed`, `ship_failed`: that step ended stuck, and says why in the
	 * report. `open_failed`: the pull request could not be opened. `no_end`: the last review kept
	 * finding the plan short, more times than a lane tries. `plan_failed`: a ticket was folded in,
	 * and planning again with it gave no plan.
	 */
	stuck: [
		"read_failed",
		"plan_failed",
		"catchup_failed",
		"build_failed",
		"review_failed",
		"ship_failed",
		"open_failed",
		"no_end",
	],
});

export const LaneOutcome = lane.schema;
export type LaneOutcome = typeof LaneOutcome.Type;
export type LaneName = Name<LaneOutcome>;
export const LANE_NAMES = lane.names;
