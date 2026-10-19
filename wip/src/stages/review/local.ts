import {run} from "@demlik/tea/effect";
import {Effect} from "effect";
import {reviewReadInterpret, reviewSubscribe} from "./handlers.ts";
import {type fileNote, type Review, review} from "./machine.ts";
import {keepRows} from "./program.ts";
import type {Settings} from "./reviewer.ts";

// One task of a plan, reviewed on this machine as it lands: the review
// machine, unchanged, with its own read and its own Subs, to its end, and its
// rows kept in the criteria record. No pull request: what `CodeHost` reads is
// the caller's to say, and for a task it is the local one
// (../../code-host-local.ts), where `target` is `taskTarget(plan, task)`.
//
// It reviews the working copy's head as it is now, never a named commit: a
// named one is a replay, and a replay keeps no rows.
//
// A note the reviewer files is kept in the report and posted nowhere.

/** The end of one review: its outcome and the report it was worked out from. */
export type Reviewed = Extract<Review, {phase: "over"}>;

/** Review `target` at its head now, keep the rows, and answer how it ended. */
export const reviewTask = (target: string, rubrics: string, settings: Settings, machine = review) =>
	Effect.gen(function* () {
		const handle = yield* run(machine, {
			ctx: undefined,
			interpret: {
				...reviewReadInterpret,
				review_file_note: (_cmd: ReturnType<typeof fileNote>) => Effect.succeed("kept" as const),
			},
			subscribe: reviewSubscribe,
			terminal: (s: Review) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({type: "start", ask: {pr: target, head: null, rubrics}, settings});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the review stopped in ${end.phase}`);
		yield* keepRows(end.report);
		return end as Reviewed;
	}).pipe(Effect.scoped);
