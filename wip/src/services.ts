import type {JevHttpReply, JevRequest} from "@demlik/tea/jev";
import {Context, type Effect, type Stream} from "effect";
import type {Change} from "./stages/review/pack.ts";
import type {Merged, PrFacts, Rerun} from "./stages/ship/facts.ts";
import type {ReadyToMerge} from "./stages/ship/ready.ts";

// The services the stage machines talk to: where the code lives (its reads and
// its writes) and Jev. The first-generation factory's services (Facts,
// Builder, Workspace, ...) are in the legacy package (factory-services.ts).

/**
 * Where the code lives: pull requests, checks, whether a branch can merge,
 * the merge queue. GitHub is the first Layer behind it, not the thing itself
 * (docs/direction/ledger-behind-a-service.md).
 *
 * This is the read side: nothing in it changes a pull request. The writes are
 * a service of their own, `CodeHostWrites`, so a run that is only given this
 * one cannot write, and the compiler says so.
 */
export class CodeHost extends Context.Service<
	CodeHost,
	{
		/**
		 * What the ship gate needs from the code host about one pull request,
		 * read in one go at its head commit. The ticket's criteria and their
		 * verdicts are the record's (`CriteriaRecord`), not the code host's.
		 */
		readonly prFacts: (pr: string) => Effect.Effect<PrFacts, {readonly _tag: "unknown"}>;
		/**
		 * Everything a review needs about one pull request at one commit: the
		 * ticket and its criteria, the files, the diff, the builder's deviations,
		 * the required checks. `head: null`: its head now. A named head is a
		 * replay of an older review. A part that cannot be read is `null` inside
		 * the answer; only a pull request that cannot be read at all fails.
		 */
		readonly change: (
			pr: string,
			head: string | null,
		) => Effect.Effect<Change, {readonly _tag: "unknown"}>;
		/**
		 * Says once, when no check of this head is still running. It does not say
		 * how they went. `after`: runs that were started again; each must have
		 * finished a later try than the one named, so an old red run is never
		 * taken for the new one.
		 */
		readonly checksSettled: (
			pr: string,
			head: string,
			after: readonly Rerun[],
		) => Stream.Stream<void>;
		/** Says once how the pull request left the merge queue. `commit`: the commit on the base branch, which is not the head. */
		readonly leftQueue: (
			pr: string,
			head: string,
		) => Stream.Stream<
			{readonly reading: "landed"; readonly commit: string} | {readonly reading: "ejected"}
		>;
	}
>()("CodeHost") {}

/**
 * The writes on where the code lives. Each one changes a real pull request,
 * so they are kept apart from the reads and handed out on purpose.
 */
export class CodeHostWrites extends Context.Service<
	CodeHostWrites,
	{
		/**
		 * Put the proven head in the merge queue. It takes the proof and nothing
		 * else, so no caller can queue a head no review passed. The code host
		 * itself refuses when the head is no longer `ready.head`: `head_moved`.
		 * Never "merge when ready", never a deleted branch, never an owner's
		 * bypass. `no_queue`: the repository has no merge queue, and nothing was
		 * written.
		 */
		readonly enqueue: (
			ready: ReadyToMerge,
		) => Effect.Effect<
			"queued" | "head_moved" | "conflicts" | "no_queue",
			{readonly _tag: "unknown"}
		>;
		/**
		 * Merge the proven head straight in, for a repository with no merge
		 * queue. The code host itself refuses when the head is no longer
		 * `ready.head`. Never an owner's bypass, never a deleted branch.
		 */
		readonly merge: (ready: ReadyToMerge) => Effect.Effect<Merged, {readonly _tag: "unknown"}>;
		/** Start the failed jobs of this head's runs again, and only those. It answers which runs, and the try each was on. */
		readonly rerunChecks: (
			pr: string,
			head: string,
		) => Effect.Effect<readonly Rerun[], {readonly _tag: "unknown"}>;
	}
>()("CodeHostWrites") {}

/** A call to Jev that never got a reply: a socket error, a DNS failure. */
export interface JevCallFailed {
	readonly _tag: "jev_call_failed";
	readonly cause: unknown;
}

/** One HTTP call to Jev. The key and the network live in the Layer. */
export class Jev extends Context.Service<
	Jev,
	{
		readonly call: (request: JevRequest) => Effect.Effect<JevHttpReply, JevCallFailed>;
	}
>()("Jev") {}
