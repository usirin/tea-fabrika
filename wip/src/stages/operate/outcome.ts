import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What the operate loop hands back, in the shape every stage uses
// (`../outcome.ts`). Only the words below are the loop's own. Which stage's
// outcome ended the loop is kept beside it, as `said`: these words say why
// the loop stopped, not what the stage said.

const loop = outcomesOf({
	/** The ship stage landed it. `rounds`: how many build rounds it took. */
	done: {pr: Schema.String, head: Schema.String, rounds: Schema.Finite},
	/** The loop passes no work on: it is the last one. */
	send: {},
	/**
	 * A person decides what happens next. `rounds`: the cap on rounds was
	 * reached with something still open. `no_progress`: a round left no fewer
	 * open than the round before it. `no_change`: a round's builder changed
	 * nothing. `ship`: the ship stage stopped for a person (an approval, a
	 * comment), or read mode stopped where it would write.
	 */
	ask: {owner: ["rounds", "no_progress", "no_change", "ship"]},
	/** Nothing here for the loop: the ticket is closed, its pull request has landed, or it is not ready for an agent. */
	skip: ["closed", "merged", "not_ready"],
	/** A stage could not go on and said why; `said` names its outcome. */
	stuck: ["build", "review", "post", "ship"],
});

export const LoopOutcome = loop.schema;
export type LoopOutcome = typeof LoopOutcome.Type;
export type LoopName = Name<LoopOutcome>;
export const LOOP_NAMES = loop.names;
export const isLoopName = loop.isName;
