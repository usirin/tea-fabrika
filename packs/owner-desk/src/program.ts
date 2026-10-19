import {defineProgram} from "@tea-fabrika/tea-program";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {Answer, Refused, Settled, Waiting} from "@tea-fabrika/wip/asks/ask";
import {Effect, Ref, Stream} from "effect";
import {type DeskMsg, deskKind, pagesOf} from "./inbox.ts";
import {DeskView} from "./view.ts";

// The owner's desk, as a program. It hears what waits on the owner and how
// each answer went, keeps the desk (./inbox.ts), shows each page that changed
// through the view it was given (./view.ts), and hands the owner's answers on.
//
//   core.waiting, core.settled, core.refused  ->  desk    (the pack listens)
//   desk.answer                                ->  core.answer   (the pack answers)
//   the owner                                  ->  desk.reply    (a host, a comment reader)
//
// It decides nothing: whether an answer fits its ask is the core's call. It
// imports the core's ask and answer types, as a JavaScript port handler knows
// the Elm app's port values; the core imports nothing of it.

type Heard =
	| {readonly on: "msg"; readonly msg: DeskMsg}
	| {readonly on: "reply"; readonly reply: Answer};

export const deskProgram = defineProgram({
	name: "owner-desk",
	description:
		"The owner's desk: an inbox of everything waiting on the owner, oldest first, and one page per ask (a plan to approve, a stuck task, a ticket to rule on). It hands the owner's answers to the core and shows what the core did with them.",
	inputs: {
		waiting: input(Waiting, "Everything that waits on the owner now, oldest first."),
		settled: input(Settled, "An answer the core took."),
		refused: input(Refused, "An answer the core did not take, and why."),
		reply: input(Answer, "The owner's answer to an ask, by its id."),
	},
	outputs: {
		answer: output(Answer, "The owner's answer, for the core to check and keep."),
	},
	machines: {desk: deskKind},
	main: ({inputs, send, machines}) =>
		Effect.gen(function* () {
			const view = yield* DeskView;
			const desk = yield* machines.desk.get("desk").start();
			// What each place shows now, as Elm's renderer keeps the last view: a page is shown again only when it changed.
			const shown = yield* Ref.make(new Map<string, string>());
			const show = Effect.gen(function* () {
				const before = yield* Ref.get(shown);
				const after = new Map<string, string>();
				for (const [where, page] of pagesOf(desk.getState())) {
					const text = JSON.stringify(page);
					after.set(where, text);
					if (before.get(where) !== text) yield* view.show(page);
				}
				yield* Ref.set(shown, after);
			});
			yield* show;
			const heard: Stream.Stream<Heard> = Stream.mergeAll(
				[
					inputs.waiting.pipe(
						Stream.map(({asks}): Heard => ({on: "msg", msg: {type: "waiting", asks}})),
					),
					inputs.settled.pipe(
						Stream.map(
							({ask, answer}): Heard => ({on: "msg", msg: {type: "settled", ask, answer}}),
						),
					),
					inputs.refused.pipe(
						Stream.map(({id, why}): Heard => ({on: "msg", msg: {type: "refused", id, why}})),
					),
					inputs.reply.pipe(Stream.map((reply): Heard => ({on: "reply", reply}))),
				],
				{concurrency: "unbounded"},
			);
			yield* heard.pipe(
				Stream.runForEach((item) =>
					item.on === "reply"
						? send("answer", item.reply)
						: desk.dispatch(item.msg).pipe(Effect.andThen(show)),
				),
			);
		}).pipe(Effect.scoped),
});
