import {defineProgram} from "@tea-fabrika/tea-program";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {Answer, type AnswerBody, Ask, Refused, Settled} from "@tea-fabrika/wip/asks/ask";
import {Effect, Stream} from "effect";
import {type InboxMsg, inboxKind} from "./inbox.ts";
import {askPage, inboxPage} from "./pages.ts";
import {DeskView} from "./view.ts";

// The owner's desk, as a program. It hears what the core asks the owner and
// how each answer went, keeps the inbox (./inbox.ts), shows each page through
// the view it was given (./view.ts), and hands the owner's answers on.
//
//   core.ask, core.settled, core.refused  ->  desk   (the pack listens)
//   desk.answer                            ->  core.answer   (the pack answers)
//   the owner                              ->  desk.reply    (a host, a comment reader)
//
// It decides nothing: whether an answer fits its ask is the core's call. It
// imports the core's ask and answer types, as a JavaScript port handler knows
// the Elm app's port values; the core imports nothing of it.

/** How an answer reads on a closed ask. */
export function saidOf(answer: AnswerBody): string {
	switch (answer.kind) {
		case "approve":
			return "approved";
		case "change":
			return `change ${answer.line}: ${answer.to}`;
		case "no":
			return `no: ${answer.why}`;
		case "remove":
			return "remove the task";
		case "keep_going":
			return `keep going, ${answer.rounds} rounds`;
		case "reword":
			return `reword ${answer.line}: When ${answer.when}, ${answer.result}`;
		case "rule":
			return `${answer.rule === "lasting" ? "a lasting rule" : "a one-off call"}${answer.build ? ", and it must be built" : ""}: ${answer.answer}`;
	}
}

type Heard =
	| {readonly on: "ask"; readonly ask: Ask}
	| {readonly on: "settled"; readonly settled: Settled}
	| {readonly on: "refused"; readonly refused: Refused}
	| {readonly on: "reply"; readonly reply: Answer};

export const deskProgram = defineProgram({
	name: "owner-desk",
	description:
		"The owner's desk: an inbox of everything waiting on the owner, oldest first, and one page per ask (a plan to approve, a stuck task, a ticket to rule on). It hands the owner's answers to the core and shows what the core did with them.",
	inputs: {
		ask: input(Ask, "Each ask the core makes of the owner."),
		settled: input(Settled, "An answer the core took."),
		refused: input(Refused, "An answer the core did not take, and why."),
		reply: input(Answer, "The owner's answer to an ask, by its id."),
	},
	outputs: {
		answer: output(Answer, "The owner's answer, for the core to check and keep."),
	},
	machines: {inbox: inboxKind},
	main: ({inputs, send, machines}) =>
		Effect.gen(function* () {
			const view = yield* DeskView;
			const desk = yield* machines.inbox.get("inbox").start();
			const step = (msg: InboxMsg) => desk.dispatch(msg);
			const showInbox = Effect.suspend(() => view.show(inboxPage(desk.getState().open)));
			yield* showInbox;
			const heard: Stream.Stream<Heard> = Stream.mergeAll(
				[
					inputs.ask.pipe(Stream.map((ask): Heard => ({on: "ask", ask}))),
					inputs.settled.pipe(Stream.map((settled): Heard => ({on: "settled", settled}))),
					inputs.refused.pipe(Stream.map((refused): Heard => ({on: "refused", refused}))),
					inputs.reply.pipe(Stream.map((reply): Heard => ({on: "reply", reply}))),
				],
				{concurrency: "unbounded"},
			);
			yield* heard.pipe(
				Stream.runForEach((item) =>
					Effect.gen(function* () {
						switch (item.on) {
							case "ask": {
								if (desk.getState().open.some((a) => a.id === item.ask.id)) return;
								yield* step({type: "asked", ask: item.ask});
								yield* view.show(askPage(item.ask, null));
								return yield* showInbox;
							}
							case "settled": {
								const {ask, answer} = item.settled;
								yield* step({type: "settled", id: ask.id});
								yield* view.show({kind: "closed", ask, said: saidOf(answer)});
								return yield* showInbox;
							}
							case "refused": {
								const {id, why} = item.refused;
								yield* step({type: "refused", id, why});
								const ask = desk.getState().open.find((a) => a.id === id);
								if (ask !== undefined) yield* view.show(askPage(ask, why));
								return;
							}
							case "reply":
								return yield* send("answer", item.reply);
						}
					}),
				),
			);
		}).pipe(Effect.scoped),
});
