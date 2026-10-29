import {run} from "@demlik/tea/effect";
import {defineProgram, flag, input} from "@kampus/fabrika";
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
//   tsh> ticket --ticket 7          its window takes over the tile
//   {kind: "answer", ask: "a-1", pick: "approve", note: "", saw: {title, body}}   on `do`
//   // tracker/ticket/7/inbox gets {type: "answered", ask: "a-1", pick: "approve", ...} by user:owner
//   {kind: "comment", body: "Skip part 2.", asks: "changes"}                     "Request changes"
//   {kind: "quit"}                   it ends once its writes are on the ledger
//
// What it writes never names a ticket: the flag does, once, so a write to another ticket cannot
// be sent from this window.

/** What the window does to its ticket. Each is one of the tracker's writes, less the number. */
export const Do = Schema.Union([
	Schema.Struct({kind: Schema.Literal("comment"), body: Said, asks: Schema.optionalKey(Asks)}),
	Schema.Struct({
		kind: Schema.Literal("answer"),
		ask: Id,
		pick: Title,
		note: Body,
		saw: Text,
	}),
	Schema.Struct({kind: Schema.Literal("close")}),
	Schema.Struct({kind: Schema.Literal("reopen")}),
	Schema.Struct({kind: Schema.Literal("quit")}),
]);
export type Do = typeof Do.Type;

/** The tracker's write for one `do`, on ticket `ticket`. */
export const writeOf = (ticket: number, d: Exclude<Do, {readonly kind: "quit"}>): Write => {
	switch (d.kind) {
		case "comment":
			return d.asks === undefined
				? {kind: "comment", ticket, body: d.body}
				: {kind: "comment", ticket, body: d.body, asks: d.asks};
		case "answer":
			return {kind: "answer", ticket, ask: d.ask, pick: d.pick, note: d.note, saw: d.saw};
		case "close":
			return {kind: "close", ticket};
		case "reopen":
			return {kind: "reopen", ticket};
	}
};

const msgOf = (ticket: number, d: Exclude<Do, {readonly kind: "quit"}>): TrackerMsg => ({
	type: "write",
	id: crypto.randomUUID(),
	write: writeOf(ticket, d),
});

export const ticket = defineProgram({
	name: "ticket",
	description:
		"One ticket, read from the ledger: its title, whose turn it is, its body, its facts, and its properties. Answers its open ask, comments, asks for changes, closes and reopens. It has a window.",
	flags: {ticket: flag(TicketNumber, "The ticket to show, by its number.")},
	inputs: {
		do: input(
			Do,
			"What the window does to the ticket: answer an ask, comment, ask for changes, close, reopen, or quit.",
		),
	},
	outputs: {},
	machines: {tickets: ticketsKind},
	view: {machine: "tickets", data: Shown, of: shownOf},
	main: ({flags, inputs, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			yield* runtime.dispatch({type: "open", ticket: flags.ticket}).pipe(Effect.orDie);
			yield* watch("tickets", "tickets", runtime);
			yield* inputs.do.pipe(
				Stream.takeWhile((d) => d.kind !== "quit"),
				// The predicate narrows: past it, `d` is never a quit.
				Stream.runForEach((d) => runtime.dispatch(msgOf(flags.ticket, d)).pipe(Effect.orDie)),
			);
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});

export {type Page, Shown, shownOf} from "./view.ts";
