import {Context, type Effect} from "effect";

/** One write, named by its intent: a second write with the same intent answers as the first did. */
interface Intended {
	readonly intent: string;
}

/** Could not read or write at all. The machine stops; nothing is guessed. */
type Unknown = {readonly _tag: "unknown"};

/**
 * The working copies a lane's shells work in, made and removed by the
 * machine, never by an agent: every shell of a lane runs in the one tree the
 * run made when it claimed the lane, and the run removes it however the lane
 * ends. A tree is named, not pathed: the Layer keeps the trees in one folder
 * of its own. Both calls are safe to repeat: making a tree that stands, or
 * removing one that is gone, does nothing and succeeds.
 *
 * Not on the operator's `Fabrika` (./fabrika.ts): a tree is git on the
 * machine that runs the lane, not the lane's ledger, and it is the same
 * whichever ledger the lane keeps. Not the old lane's `Workspace` either,
 * which runs an issue's tests in a folder it is handed.
 */
export class Worktrees extends Context.Service<
	Worktrees,
	{
		/** Check out the repo's default branch, as it is now, in a new tree. */
		readonly make: (request: {readonly name: string} & Intended) => Effect.Effect<void, Unknown>;
		readonly remove: (request: {readonly name: string} & Intended) => Effect.Effect<void, Unknown>;
	}
>()("Worktrees") {}
