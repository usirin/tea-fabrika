import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What one task's build hands back (./machine.ts): one typed answer, in the shape every stage uses
// (`../outcome.ts`). A task build ends in a commit on the plan's one branch, never in a pull request:
// the plan opens one pull request once every task is in (docs/direction/done-is-per-criterion.md).

const task = outcomesOf({
	/** `head`: the plan's branch after the push. `changed`: this round added a commit. */
	done: {head: Schema.String, changed: Schema.Boolean},
	send: {},
	ask: {},
	/**
	 * Nothing to build. `closed`: the owner said no to the plan. `not_approved`: no version of the
	 * plan is approved yet. `removed`: the owner took the task out, or the approved version has no
	 * such task.
	 */
	skip: ["closed", "not_approved", "removed"],
	/**
	 * Stop, never guess. `read_failed`: the plan or the branch could not be read. `no_criteria`: the
	 * task holds no live criterion to build to. `draft_failed`: the builder broke, or handed back no
	 * form. `over_budget`: it reached its limit first. `push_failed`: the branch moved under the
	 * round, or the push was refused.
	 */
	stuck: ["read_failed", "no_criteria", "draft_failed", "over_budget", "push_failed"],
});

export const TaskOutcome = task.schema;
export type TaskOutcome = typeof TaskOutcome.Type;
export type TaskName = Name<TaskOutcome>;
export const TASK_NAMES = task.names;
