import {Effect, Stream} from "effect";
import {Worktrees} from "../../fabrika.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {
	ChecksSub,
	enqueue,
	finish,
	QueueSub,
	readShipFacts,
	rerunChecks,
	ShipMsg,
} from "./machine.ts";

// What answers the ship machine's Cmds and runs its Listens. Kept in three
// parts, by what each may do:
//
//   shipReadInterpret   the one read. It needs `CodeHost` and cannot write.
//   shipSubscribe       the two Listens. Reads too: they only watch.
//   shipWriteInterpret  the writes. It needs `CodeHostWrites`, and is made by
//                       a call, so a run that never makes it has no write.

export const shipReadInterpret = {
	ship_facts: (cmd: ReturnType<typeof readShipFacts>) =>
		Effect.gen(function* () {
			return yield* (yield* CodeHost).prFacts(cmd.pr);
		}),
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
			Stream.map(
				(left): ShipMsg => ({type: "ship_queue", pr: sub.deps.pr, head: sub.deps.head, ...left}),
			),
		),
};

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
			return yield* (yield* CodeHostWrites).enqueue(cmd.pr, cmd.head);
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
