import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What the build stage hands back: one typed answer, in the shape every stage
// uses (`../outcome.ts`). Only the words below are the build stage's own.

const build = outcomesOf({
	/**
	 * The change is on a branch, in an open pull request. `head`: the commit
	 * pushed. `changed`: this round added a commit. A round that changed
	 * nothing on a pull request that is already open is still `done`: the pull
	 * request stands as it was, and the parent decides what that means.
	 */
	done: {pr: Schema.String, head: Schema.String, changed: Schema.Boolean},
	/** This piece passes no work on. */
	send: {},
	/** This piece asks nobody. */
	ask: {},
	/**
	 * Nothing here to build. `closed`: the ticket is closed. `merged`: a pull
	 * request from its branch has landed. `not_ready`: the ticket may not be
	 * built yet: no approved plan names it on the ledger.
	 */
	skip: ["closed", "merged", "not_ready"],
	/**
	 * Stop, never guess. `read_failed`: the ticket could not be read, or the
	 * ledger could not say how its plan stands.
	 * `no_criteria`: it lists no acceptance criteria to build to.
	 * `criteria_unknown`: its list names criteria ids in a way that would need
	 * a guess (some boxes marked and some not, or one id twice).
	 * `copy_failed`: the working copy could not be made or installed.
	 * `draft_failed`: the builder broke, or what it handed back is not a form.
	 * `over_budget`: it reached its limit in dollars first. `no_change`: the
	 * first round changed nothing, so there is nothing to open a pull request
	 * on. `push_failed`, `open_failed`: the branch could not be pushed, or the
	 * pull request could not be opened or found. `exam_touched`: the change
	 * reached a file the test writer wrote, or a rule file, so nothing was kept.
	 */
	stuck: [
		"read_failed",
		"no_criteria",
		"criteria_unknown",
		"copy_failed",
		"draft_failed",
		"over_budget",
		"no_change",
		"push_failed",
		"open_failed",
		"exam_touched",
	],
});

export const BuildOutcome = build.schema;
export type BuildOutcome = typeof BuildOutcome.Type;
export type BuildName = Name<BuildOutcome>;
export const BUILD_NAMES = build.names;
export const isBuildName = build.isName;
