import {run} from "@demlik/tea/effect";
import {defineProgram, flag, input, output} from "@kampus/fabrika";
import {Text} from "@kampus/pipeline/tickets/approval";
import {Asks, Body, Id, Said, TicketNumber, Title} from "@kampus/pipeline/tickets/ticket";
import {
	type TrackerMsg,
	tickets,
	ticketsKind,
	ticketsOptions,
	type Write,
} from "@tea-fabrika/tracker";
import {Effect, Schema, Stream} from "effect";
import {Shown, shownOf} from "./view.ts";

// One ticket, in a tile of its own: its title, whose turn it is, its body, a row per fact that
// opens in place, a comment box, and a panel of its properties (./window.tsx). It reads the
// tickets with the tracker's own machine and cells, opened on one ticket, and writes through
// them: an answer, a comment, a close are the same facts the tracker writes.
//
//   tsh> ticket --ticket 7          its window takes over the tile, on ticket 7
//   tsh> tracker | ticket | trace   it shows the ticket the tracker picks, and sends it on
//   {kind: "answer", ticket: 7, ask: "a-1", pick: "approve", note: "", saw: {title, body}}   on `do`
//   // tracker/ticket/7/inbox gets {type: "answered", ask: "a-1", pick: "approve", ...} by user:owner
//   {kind: "comment", ticket: 7, body: "Skip part 2.", asks: "changes"}         "Request changes"
//   {kind: "quit"}                   it ends once its writes are on the ledger
//
// Which ticket it shows comes from the flag, then from its input `ticket`, the latest one winning.
// Each time the ticket it shows changes, it sends the number on its output `ticket`, so the next
// program of a line follows too. The input's end changes nothing: the last ticket stays.
//
// A write names the ticket the window drew it on. It is taken only for a ticket this run has
// shown, so a write made on #7 lands on #7 even when a pick of #3 came in a moment before, and a
// window cannot write to a ticket it was never shown.

/** What the window does to its ticket. Each is one of the tracker's writes, on a ticket it showed. */
export const Do = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("comment"),
		ticket: TicketNumber,
		body: Said,
		asks: Schema.optionalKey(Asks),
	}),
	Schema.Struct({
		kind: Schema.Literal("answer"),
		ticket: TicketNumber,
		ask: Id,
		pick: Title,
		note: Body,
		saw: Text,
	}),
	Schema.Struct({kind: Schema.Literal("close"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("reopen"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("quit")}),
]);
export type Do = typeof Do.Type;

/**
 * The tracker's write for one `do`, when its ticket is one this run has shown. `null`: it names
 * a ticket the window was never shown, and nothing is written.
 *
 *   writeOf(new Set([7]), {kind: "close", ticket: 7})   {kind: "close", ticket: 7}
 *   writeOf(new Set([7]), {kind: "close", ticket: 3})   null
 */
export const writeOf = (
	shown: ReadonlySet<number>,
	d: Exclude<Do, {readonly kind: "quit"}>,
): Write | null => {
	if (!shown.has(d.ticket)) return null;
	switch (d.kind) {
		case "comment":
			return d.asks === undefined
				? {kind: "comment", ticket: d.ticket, body: d.body}
				: {kind: "comment", ticket: d.ticket, body: d.body, asks: d.asks};
		case "answer":
			return {
				kind: "answer",
				ticket: d.ticket,
				ask: d.ask,
				pick: d.pick,
				note: d.note,
				saw: d.saw,
			};
		case "close":
			return {kind: "close", ticket: d.ticket};
		case "reopen":
			return {kind: "reopen", ticket: d.ticket};
	}
};

const msgOf = (write: Write): TrackerMsg => ({type: "write", id: crypto.randomUUID(), write});

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
		do: input(
			Do,
			"What the window does to the ticket: answer an ask, comment, ask for changes, close, reopen, or quit.",
		),
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
	main: ({flags, inputs, send, watch}) =>
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
			// The picks, until their input ends; then the last one stays. A failed send ends the run.
			const picks = inputs.ticket.pipe(Stream.runForEach(show), Effect.andThen(Effect.never));
			const writes = inputs.do.pipe(
				Stream.takeWhile((d) => d.kind !== "quit"),
				// The predicate narrows: past it, `d` is never a quit.
				Stream.runForEach((d) => {
					const write = writeOf(shown, d);
					return write === null
						? Effect.logWarning(`ticket: a write to #${d.ticket}, never shown here, is dropped`)
						: runtime.dispatch(msgOf(write)).pipe(Effect.orDie);
				}),
			);
			yield* Effect.raceFirst(writes, picks);
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});

export {type Page, Shown, shownOf} from "./view.ts";
