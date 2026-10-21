import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What one catch-up of a plan's branch hands back (./machine.ts), in the shape every stage uses
// (`../outcome.ts`). A catch-up ends in one commit on the plan's branch, or none: never a rebase,
// never a forced push.

const catchup = outcomesOf({
	/** `head`: the plan's branch after the push. `changed`: this catch-up added a commit. */
	done: {head: Schema.String, changed: Schema.Boolean},
	send: {},
	ask: {},
	/** `up_to_date`: main is in the branch already, or there is no branch yet, or nothing to take out. */
	skip: ["up_to_date"],
	/**
	 * Stop, never guess. `read_failed`: the branch or main could not be read. `unresolved`: a
	 * conflict the resolver left, or a revert that does not apply. `lockfile_failed`: the lockfile
	 * could not be made again. `draft_failed`: the resolver broke. `push_failed`: the branch moved
	 * under the catch-up, or the push was refused.
	 */
	stuck: ["read_failed", "unresolved", "lockfile_failed", "draft_failed", "push_failed"],
});

export const CatchupOutcome = catchup.schema;
export type CatchupOutcome = typeof CatchupOutcome.Type;
export type CatchupName = Name<CatchupOutcome>;
export const CATCHUP_NAMES = catchup.names;
