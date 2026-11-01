import {Effect, Option, Schema, Stream} from "effect";
import {CodeHost} from "../../services.ts";
import type {ChecksSub, gatherPack, ReviewMsg, RunSub} from "./machine.ts";
import {readPack} from "./pack.ts";
import {type Drafted, type Ran, Reviewer, type Said} from "./reviewer.ts";
import {HeldForm} from "./sheet.ts";

// What answers the review machine's Cmds and runs its Subs, kept by what
// each may do:
//
//   reviewReadInterpret  the one read: the pack. It needs `CodeHost`.
//   reviewSubscribe      the reviewer's run, and the Listen on the checks.
//
// The one Act, `review_file_note`, is answered by whoever runs the machine:
// it is where a note goes, and that is the program's to say (./program.ts).

export const reviewReadInterpret = {
	review_pack: (cmd: ReturnType<typeof gatherPack>) => readPack(cmd),
};

const ranOf = (drafted: Drafted): Ran => ({
	spend: drafted.spend,
	tools: drafted.tools,
	refused: drafted.refused,
	links: drafted.links,
});

/**
 * One thing the reviewer's run said, as the machine's Msg. A Msg from a Sub
 * is not checked by tea the way a Cmd's answer is, so the form is read
 * against its schema here, on the way in: one that does not fit is the
 * declared `misfit`, never a Msg the machine would trust.
 */
export const msgOf =
	(at: {readonly pr: string; readonly head: string; readonly run: number}) =>
	(said: Said): ReviewMsg => {
		if (said.kind === "note") return {type: "review_note", ...at, note: said.note};
		const {drafted} = said;
		const ran = ranOf(drafted);
		switch (drafted.answer) {
			case "form": {
				const form = Schema.decodeUnknownOption(HeldForm)(drafted.form);
				return Option.isSome(form)
					? {type: "review_reviewed", ...at, form: form.value, ran}
					: {type: "review_failed", ...at, why: "misfit", error: null, ran};
			}
			case "misfit":
				return {type: "review_failed", ...at, why: "misfit", error: null, ran};
			case "over_budget":
				return {type: "review_failed", ...at, why: "over_budget", error: null, ran};
			case "broke":
				return {type: "review_failed", ...at, why: "broke", error: drafted.error, ran};
		}
	};

export const reviewSubscribe = {
	/** The reviewer's run, as long as the Sub is on. When it closes, the stream is cut, and the agent with it. */
	review_run: (sub: RunSub): Stream.Stream<ReviewMsg, never, Reviewer> =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* Reviewer).review(sub.deps.brief, sub.deps.settings, sub.deps.note);
			}),
		).pipe(Stream.map(msgOf({pr: sub.deps.pr, head: sub.deps.head, run: sub.deps.run}))),
	review_checks: (sub: ChecksSub): Stream.Stream<ReviewMsg, never, CodeHost> =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* CodeHost).checksSettled(sub.deps.pr, sub.deps.head, []);
			}),
		).pipe(
			Stream.map((): ReviewMsg => ({type: "review_checks", pr: sub.deps.pr, head: sub.deps.head})),
		),
};
