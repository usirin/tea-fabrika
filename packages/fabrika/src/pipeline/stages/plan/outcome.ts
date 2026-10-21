import {type Name, outcomesOf} from "../outcome.ts";

// What the plan stage hands back, in the shape every stage uses
// (`../outcome.ts`). The plan itself is in the report beside it.

const plan = outcomesOf({
	/** A plan that passed its Check, with no open question. */
	done: {},
	/** This piece passes no work on: a parent hands the plan to build. */
	send: {},
	/**
	 * `owner:questions`: the plan passed its Check and is written with its
	 * leans, but it leaves product calls open, and the owner makes them.
	 */
	ask: {owner: ["questions"]},
	/** `closed`: the ticket is closed. */
	skip: ["closed"],
	/**
	 * Stop, never guess. `read_failed`: the ticket could not be read.
	 * `draft_failed`: the planner broke, or answered with something that is
	 * not a plan. `over_budget`: it reached its limit in dollars.
	 * `unchecked`: its last plan still has problems and the tries are spent.
	 * `cut_off`: a restart cut the planner off twice.
	 */
	stuck: ["read_failed", "draft_failed", "over_budget", "unchecked", "cut_off"],
});

export const PlanOutcome = plan.schema;
export type PlanOutcome = typeof PlanOutcome.Type;
export type PlanName = Name<PlanOutcome>;
export const PLAN_NAMES = plan.names;
