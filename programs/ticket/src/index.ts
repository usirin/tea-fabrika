import {run} from "@demlik/tea/effect";
import {defineProgram, end, flag, input, output} from "@kampus/fabrika-old";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {
	Answer,
	Comment,
	OneTicket,
	type TrackerMsg,
	tickets,
	ticketsKind,
	ticketsOptions,
	type Write,
} from "@tea-fabrika/tracker";
import {Effect, Schema} from "effect";
import {Shown, shownOf} from "./view.ts";

// One ticket, in a tile of its own: its title, whose turn it is, its body, a row per fact that
// opens in place, a comment box, and a panel of its properties (./window.tsx). It reads the
// tickets with the tracker's own machine and cells, opened on one ticket, and writes through
// them: an answer, a comment, a close are the same facts the tracker writes.
//
//   tsh> ticket --ticket 7          its window takes over the tile, on ticket 7
//   tsh> tracker | ticket | runs    it shows the ticket the tracker picks, and sends it on
//   answer {ticket: 7, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // tracker/ticket/7/inbox gets {type: "answered", ask: "a-1", pick: "approve", ...} by user:owner
//   comment {ticket: 7, body: "Skip part 2.", asks: "changes"}         "Request changes"
//   quit null                        it ends once its writes are on the ledger
//
// Its inputs are the tracker's own commands, by the same names and with the same structs:
// `comment`, `answer` (a person only), `close`, `reopen`, and `quit`. One more, `ticket`, says
// which ticket to show.
//
// Which ticket it shows comes from the flag, then from its input `ticket`, the latest one winning.
// Each time the ticket it shows changes, it sends the number on its output `ticket`, so the next
// program of a line follows too. The input's end changes nothing: the last ticket stays.
//
// A write names the ticket the window drew it on. It is taken only for a ticket this run has
// shown, so a write made on #7 lands on #7 even when a pick of #3 came in a moment before, and a
// window cannot write to a ticket it was never shown.

/** A write the ticket's window makes: one of the tracker's writes, always on one ticket. */
export type TicketWrite = Extract<
	Write,
	{readonly kind: "comment" | "answer" | "close" | "reopen"}
>;

/**
 * The write itself, when its ticket is one this run has shown. `null`: it names a ticket the
 * window was never shown, and nothing is written.
 *
 *   writeOf(new Set([7]), {kind: "close", ticket: 7})   {kind: "close", ticket: 7}
 *   writeOf(new Set([7]), {kind: "close", ticket: 3})   null
 */
export const writeOf = (shown: ReadonlySet<number>, write: TicketWrite): TicketWrite | null =>
	shown.has(write.ticket) ? write : null;

const msgOf = (write: Write): TrackerMsg => ({type: "write", id: crypto.randomUUID(), write});

/** The inputs a person's window writes on, and quit: `serve` stops once all of them have closed. */
const WINDOW = ["comment", "answer", "close", "reopen", "quit"] as const;

export const ticket = defineProgram({
	name: "ticket",
	description:
		"One ticket, read from the ledger: its title, whose turn it is, its body, its facts, and its properties. Answers its open ask, comments, asks for changes, closes and reopens. Shows the ticket a pipe sends it, and sends on the one it shows. It has a window.",
	flags: {
		ticket: flag(
			Schema.UndefinedOr(TicketNumber),
			"The ticket to show first, by its number. Left out, it waits for one on its input ticket.",
		),
	},
	inputs: {
		comment: input(
			Comment,
			'Comment on the ticket shown. `asks: "changes"` requests changes. Writes one `commented`.',
		),
		answer: input(
			Answer,
			"Answer an open ask on the ticket shown: a pick, a note, and the title and body as seen. A person only. Writes one `answered`.",
			{personOnly: true},
		),
		close: input(OneTicket, "Close the ticket shown. Writes its `closed`."),
		reopen: input(OneTicket, "Reopen the ticket shown. Writes its `reopened`."),
		quit: input(Schema.Null, "Stop, once every write told before it is on the ledger."),
		ticket: input(
			TicketNumber,
			"A ticket to show now, by its number: what a pipe from the tracker sends as the person picks.",
		),
	},
	outputs: {
		ticket: output(
			TicketNumber,
			"The ticket it shows, by its number: sent each time that changes, so the next program of a line follows.",
		),
	},
	machines: {tickets: ticketsKind},
	view: {machine: "tickets", data: Shown, of: shownOf},
	main: ({flags, serve, send, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			yield* watch("tickets", "tickets", runtime);
			/** Every ticket this run has shown: the only ones its window may write to. */
			const shown = new Set<number>();
			let now: number | null = null;
			const show = (n: number) =>
				Effect.gen(function* () {
					if (n === now) return;
					now = n;
					shown.add(n);
					yield* runtime.dispatch({type: "open", ticket: n}).pipe(Effect.orDie);
					// Down a pipe whose reader has gone, this send fails and the ticket ends.
					yield* send("ticket", n);
				});
			if (flags.ticket !== undefined) yield* show(flags.ticket);
			const write = (w: TicketWrite) =>
				writeOf(shown, w) === null
					? Effect.logWarning(`ticket: a write to #${w.ticket}, never shown here, is dropped`)
					: runtime.dispatch(msgOf(w)).pipe(Effect.orDie);
			// The picks and the writes, in the order told across every input, until a quit or until
			// the window's inputs are all closed. Once `ticket` is closed the last pick stays. A failed
			// send ends the run.
			yield* serve(
				{
					ticket: show,
					comment: (v) => write({kind: "comment", ...v}),
					answer: (v) => write({kind: "answer", ...v}),
					close: (v) => write({kind: "close", ...v}),
					reopen: (v) => write({kind: "reopen", ...v}),
					quit: () => end,
				},
				{until: WINDOW},
			);
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});

export {type Page, Shown, shownOf} from "./view.ts";
