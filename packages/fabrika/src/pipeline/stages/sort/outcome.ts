import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What the sort stage hands back, in the shape every stage uses (`../outcome.ts`). The answer
// itself, and the writes it made, are in the report beside it.

const sort = outcomesOf({
	/** The ticket was closed: a no by the bar, or a duplicate. Nobody is next. */
	done: {closed: Schema.Literals(["no", "duplicate"])},
	/**
	 * `plan:yes`: worth doing, and a plan comes next. `plan:fold`: worth doing, and part of an open
	 * plan, which grows by one ticket. `research:yes`: worth doing, and it ends in a finding.
	 */
	send: {plan: ["yes", "fold"], research: ["yes"]},
	/** `owner:ruling`: worth doing, and the owner must choose first. */
	ask: {owner: ["ruling"]},
	/** `closed`: the ticket is closed already. */
	skip: ["closed"],
	/**
	 * Stop, never guess. `read_failed`: the ticket or the repo's other tickets and plans could not
	 * be read. `draft_failed`: the sorter broke, or answered with something that does not fit.
	 * `over_budget`: it reached its limit in dollars. `unchecked`: its last answer still has
	 * problems and the tries are spent. `changed`: the ticket's words changed while it was sorted.
	 * `write_failed`: a write was refused.
	 */
	stuck: ["read_failed", "draft_failed", "over_budget", "unchecked", "changed", "write_failed"],
});

export const SortOutcome = sort.schema;
export type SortOutcome = typeof SortOutcome.Type;
export type SortName = Name<SortOutcome>;
export const SORT_NAMES = sort.names;
