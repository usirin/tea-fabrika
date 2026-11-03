import {Effect, Stream} from "effect";
import {CriteriaRecord} from "../../criteria/record.ts";
import {readTicketId} from "../../ids.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {Worktrees} from "../../worktrees.ts";
import {atTheDoor, atTheMergeDoor} from "./door.ts";
import type {ShipFacts} from "./facts.ts";
import type {
	ChecksSub,
	enqueue,
	finish,
	merge,
	QueueSub,
	readShipFacts,
	rerunChecks,
	ShipMsg,
} from "./machine.ts";
import {ReadyToMerge} from "./ready.ts";

// What answers the ship machine's Cmds and runs its Listens. Kept in three
// parts, by what each may do:
//
//   shipReadInterpret   the one read. It needs `CodeHost` and cannot write.
//   shipSubscribe       the two Listens. Reads too: they only watch.
//   shipWriteInterpret  the writes. It needs `CodeHostWrites`, and is made by
//                       a call, so a run that never makes it has no write.

/**
 * The facts at the head, from two places: the code host's, and what the
 * record holds for the ticket the pull request serves, its criteria and every
 * verdict row on them. A pull request that serves no ticket has no criteria.
 */
export const readFacts = (pr: string) =>
	Effect.gen(function* () {
		const facts = yield* (yield* CodeHost).prFacts(pr);
		const ticket = facts.ticket === "none" ? null : readTicketId(facts.ticket.id);
		const held = ticket === null ? null : yield* (yield* CriteriaRecord).read(ticket);
		return {...facts, criteria: held?.criteria ?? null, verdicts: held?.verdicts ?? []};
	});

export const shipReadInterpret = {
	ship_facts: (cmd: ReturnType<typeof readShipFacts>) => readFacts(cmd.pr),
};

/** The Listens, over `CodeHost`. What the service says becomes the machine's Msg, with the pull request and head it was asked about. */
export const shipSubscribe = {
	ship_checks: (sub: ChecksSub): Stream.Stream<ShipMsg, never, CodeHost> =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* CodeHost).checksSettled(sub.deps.pr, sub.deps.head, sub.deps.after);
			}),
		).pipe(
			Stream.map((): ShipMsg => ({type: "ship_checks", pr: sub.deps.pr, head: sub.deps.head})),
		),
	ship_queue: (sub: QueueSub): Stream.Stream<ShipMsg, never, CodeHost> =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* CodeHost).leftQueue(sub.deps.pr, sub.deps.head);
			}),
		).pipe(
			Stream.map((left): ShipMsg => ({
				type: "ship_queue",
				pr: sub.deps.pr,
				head: sub.deps.head,
				...left,
			})),
		),
};

/**
 * A proof, checked once more at the door of the write: a copy edited after
 * it was made (moved to another head, a row changed) proves nothing, and the
 * write fails before the code host hears of it.
 */
const proven = (ready: ReadyToMerge) =>
	ReadyToMerge.revive(ready) === null
		? Effect.fail({_tag: "unknown" as const})
		: Effect.succeed(ready);

/**
 * The door of a write (./door.ts): the facts read again, now, and put
 * through `door`, the gate once more. What it lets through is the proof made
 * from this read; a read that fails fails the write, which nobody then makes.
 */
const atTheDoorNow = <D>(asked: ReadyToMerge, door: (asked: ReadyToMerge, fresh: ShipFacts) => D) =>
	Effect.gen(function* () {
		const ready = yield* proven(asked);
		const fresh = yield* readFacts(ready.pr).pipe(
			Effect.mapError(() => ({_tag: "unknown" as const})),
		);
		return door(ready, fresh);
	});

/**
 * The handlers that write. Making them is a choice: nothing in this file
 * calls this, and the read-only run never does.
 *
 * `ship_finish` here does nothing, and says so. The tidy-up after a merge has
 * one part a service here can do, removing a working copy, and a run that
 * holds one adds it with `shipTidyTree`. Today's shipper does more at this
 * step, and none of it has a service yet, so none of it is done: the
 * "waiting for release" label on flagged work, the ending written in the
 * ledger, and removing the ticket's other working copies.
 */
export const shipWriteInterpret = () => ({
	ship_rerun_checks: (cmd: ReturnType<typeof rerunChecks>) =>
		Effect.gen(function* () {
			return yield* (yield* CodeHostWrites).rerunChecks(cmd.pr, cmd.head);
		}),
	ship_enqueue: (cmd: ReturnType<typeof enqueue>) =>
		Effect.gen(function* () {
			const door = yield* atTheDoorNow(cmd.ready, atTheDoor);
			if ("stale" in door) return "stale" as const;
			return yield* (yield* CodeHostWrites).enqueue(door.write);
		}),
	ship_merge: (cmd: ReturnType<typeof merge>) =>
		Effect.gen(function* () {
			const door = yield* atTheDoorNow(cmd.ready, atTheMergeDoor);
			if ("stale" in door) return {reading: "stale" as const};
			if ("behind" in door) return {reading: "behind" as const};
			return yield* (yield* CodeHostWrites).merge(door.write);
		}),
	ship_finish: (_cmd: ReturnType<typeof finish>) => Effect.succeed(null),
});

/**
 * The tidy-up for a run that was given a working copy: remove it, through
 * `Worktrees`. Spread over `shipWriteInterpret()`. A run alone on a pull
 * request holds no working copy and does not use this.
 */
export const shipTidyTree = (tree: string) => ({
	ship_finish: (cmd: ReturnType<typeof finish>) =>
		Effect.gen(function* () {
			yield* (yield* Worktrees).remove({name: tree, intent: cmd.intent});
			return null;
		}),
});
