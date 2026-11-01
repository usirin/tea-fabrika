import {Effect} from "effect";
import {saidOf} from "../../tickets/ticket.ts";
import {Tickets} from "../../tickets/tickets.ts";
import {listed} from "./briefs.ts";
import type {LaneOutcome} from "./outcome.ts";
import {LanePulls, ownBranch, PullWire} from "./pulls.ts";
import {LaneWork} from "./work.ts";

// What a lane takes with it as it ends. Today's version. Best effort: the lane's end is already
// decided, so nothing here can change it. What could not go is said on the ticket.
//
//   every end   the Codex homes it made, and the copies only it holds
//   done        its working copies and their branches too, and the branch of each pull request it merged
//   any other   its working copy stays, for a person to read
//
// `outcome` left out: a lane saved before it said how it ended. Only what is safe on any end goes.

/** Lane `n`'s things off this machine and, once merged, its branch off the code host. Never fails. */
export const leaveBehind = (number: number, outcome: LaneOutcome | undefined) =>
	Effect.gen(function* () {
		const work = yield* LaneWork;
		const pulls = yield* LanePulls;
		const wire = yield* PullWire;
		const tickets = yield* Tickets;
		const done = outcome?.kind === "done";
		const merged = done ? (yield* pulls.landed(number)).filter(ownBranch) : [];
		const branches = yield* Effect.forEach(
			merged,
			(pull) =>
				wire.gone(pull).pipe(
					Effect.as<readonly string[]>([]),
					Effect.orElseSucceed((): readonly string[] => [
						`the branch ${pull.branch} on the code host`,
					]),
				),
			{concurrency: 1},
		);
		const left = [...branches.flat(), ...(yield* work.leave(number, {trees: done}))];
		if (left.length === 0) return;
		yield* tickets
			.talk(number, `r-left-behind-${number}`, {
				type: "commented",
				body: saidOf(["This lane has ended, and could not remove:", listed(left)].join("\n")),
			})
			.pipe(Effect.ignore);
	});
