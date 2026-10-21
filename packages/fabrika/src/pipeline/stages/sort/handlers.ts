import {Effect, Stream} from "effect";
import type {RunSub, readContext, readTicket, writeOne} from "./machine.ts";
import {Sorter, SortHost, SortPlans, SortWrites} from "./services.ts";

// What answers the sort machine's Cmds and runs its Sub. Kept in two parts, by what each may do:
//
//   sortReadInterpret   the two reads. They need `SortHost` and `SortPlans`, and cannot write.
//   sortWriteInterpret  the one write. It needs `SortWrites`, and is made by a call, so a run that
//                       never makes it has no write.

export const sortReadInterpret = {
	sort_ticket: (cmd: ReturnType<typeof readTicket>) =>
		Effect.gen(function* () {
			return yield* (yield* SortHost).ticket(cmd.ticket);
		}),
	sort_context: (cmd: ReturnType<typeof readContext>) =>
		Effect.gen(function* () {
			const earlier = yield* (yield* SortHost).earlier(cmd.ticket);
			const plans = yield* (yield* SortPlans).open(cmd.ticket);
			return {earlier, plans};
		}),
};

export const sortWriteInterpret = () => ({
	sort_write: (cmd: ReturnType<typeof writeOne>) =>
		Effect.gen(function* () {
			return yield* (yield* SortWrites).write(cmd.write, cmd.intent);
		}),
});

export const sortSubscribe = {
	/** The sorter's run, as long as the Sub is on. When it closes, the stream is cut, and the agent with it. */
	sort_run: (sub: RunSub) =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* Sorter).run(sub.deps.run, sub.deps.settings);
			}),
		),
};
