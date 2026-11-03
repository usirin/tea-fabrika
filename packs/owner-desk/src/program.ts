import {defineProgram, input, output} from "@kampus/fabrika-old";
import {Answer, Refused, Settled, Waiting} from "@kampus/pipeline/asks/ask";
import {Typed} from "@kampus/pipeline/asks/packs";
import {Effect, Ref} from "effect";
import {type DeskMsg, deskKind, pagesOf} from "./inbox.ts";
import {typedAnswerOf} from "./reply.ts";
import {DeskView} from "./view.ts";

// The owner's desk, as a program. It hears what waits on the owner and how
// each answer went, keeps the desk (./inbox.ts), shows each page that changed
// through the view it was given (./view.ts), and hands the owner's answers on.
//
//   core.waiting, core.settled, core.refused  ->  desk    (the pack listens)
//   desk.answer                                ->  core.answer   (the pack answers)
//   the owner                                  ->  desk.reply    (a host, a comment reader)
//   the owner, typing in a shell               ->  desk.typed    (read by ./reply.ts; unread if not an answer)
//
// It decides nothing: whether an answer fits its ask is the core's call. It
// imports the core's ask and answer types, as a JavaScript port handler knows
// the Elm app's port values; the core imports nothing of it.

export const deskProgram = defineProgram({
	name: "owner-desk",
	description:
		"The owner's desk: an inbox of everything waiting on the owner, oldest first, and one page per ask (a plan to approve, a stuck task, a ticket to rule on). It hands the owner's answers to the core and shows what the core did with them.",
	inputs: {
		waiting: input(Waiting, "Everything that waits on the owner now, oldest first."),
		settled: input(Settled, "An answer the core took."),
		refused: input(Refused, "An answer the core did not take, and why."),
		reply: input(Answer, "The owner's answer to an ask, by its id."),
		typed: input(Typed, "The owner's reply to an ask as typed in a shell, `/` optional."),
	},
	outputs: {
		answer: output(Answer, "The owner's answer, for the core to check and keep."),
		unread: output(Refused, "A typed reply that is not an answer. Nothing was handed on."),
	},
	machines: {desk: deskKind},
	main: ({serve, send, machines}) =>
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
			const msg = (msg: DeskMsg) => desk.dispatch(msg).pipe(Effect.andThen(show));
			const read = ({id, text}: Typed) => {
				const answer = typedAnswerOf(text);
				return answer === null
					? send("unread", {
							id,
							why: `${JSON.stringify(text.trim())} is not a reply the desk reads`,
						})
					: send("answer", {id, answer});
			};
			// Each value in the order told, across every input.
			yield* serve({
				waiting: ({asks}) => msg({type: "waiting", asks}),
				settled: ({ask, answer}) => msg({type: "settled", ask, answer}),
				refused: ({id, why}) => msg({type: "refused", id, why}),
				reply: (reply) => send("answer", reply),
				typed: read,
			});
		}).pipe(Effect.scoped),
});
