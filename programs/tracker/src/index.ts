import {run} from "@demlik/tea/effect";
import {defineProgram, input, kind} from "@kampus/fabrika";
import {Effect, Schema, Stream} from "effect";
import {loadCell, pollRunner, saveCell} from "./ledger.ts";
import {over, Shown, shownOf, statusOf, type TrackerMsg, tracker as tickets} from "./machine.ts";
import {TicketNumber, Write} from "./ticket.ts";

// The tracker: tickets on the ledger, one stream of facts each (./ticket.ts), and a window to work
// them (./window.tsx). Its machine (./machine.ts) holds what was read and the writes on their way;
// its cells (./ledger.ts) are the only code that reads or writes the ledger. No React here.
//
//   tsh> tracker                 in the fabrika app, its window takes over: the list, newest first
//   {kind: "file", title: "Login fails", body: "On main."}     what the window sends, on `do`
//   // ledger: tracker/ticket/1/inbox gets {type: "filed", ...} by user:owner; the list shows #1
//   {kind: "quit"}               the tracker ends once its writes are on the ledger; tsh is back
//
// It needs two services: `Ledger`, and `Author` (./ledger.ts), who it writes as. Its machine's
// state is kept nowhere: started again, it reads the ledger again.
//
// Left for later, with a place for each: an agent writing to a ticket is another `Author` on the
// same ledger, and the poll already shows its facts; GitHub sync and the PR watcher are programs
// that read and write the same streams; asks and approvals are new facts in `Fact`.

export {Author} from "./ledger.ts";
export type {Shown} from "./machine.ts";
export type {Fact, Summary, Ticket, Write} from "./ticket.ts";

/** What the window does: go to the list or a ticket, change a ticket, or quit. One input, so it all stays in order. */
export const Do = Schema.Union([
	Schema.Struct({kind: Schema.Literal("list")}),
	Schema.Struct({kind: Schema.Literal("open"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("quit")}),
	Write,
]);
export type Do = typeof Do.Type;

/** What the machine is told for one `do`. A write gets its message id here, once. */
const msgOf = (d: Exclude<Do, {readonly kind: "quit"}>): TrackerMsg => {
	switch (d.kind) {
		case "list":
			return {type: "list"};
		case "open":
			return {type: "open", ticket: d.ticket};
		default:
			return {type: "write", id: crypto.randomUUID(), write: d};
	}
};

const options = {
	ctx: undefined,
	interpret: {load: loadCell, save: saveCell},
	subscribe: {poll: pollRunner},
	terminal: over,
};

export const tracker = defineProgram({
	name: "tracker",
	description:
		"Tickets on the ledger, one stream of facts each: lists them, files one, shows one's timeline, comments, closes and reopens. It has a window.",
	inputs: {
		do: input(
			Do,
			"What the window does: list, open a ticket, file, comment, close, reopen, or quit.",
		),
	},
	outputs: {},
	// The ledger keeps the tickets, so the machine is kept nowhere else: main runs it and shows it.
	// No ref of this run ever starts it.
	machines: {
		tickets: kind({
			machine: tickets,
			parent: "main",
			options: () => options,
			drawing: () => ({
				name: "tickets",
				steps: {load: "read the ledger", save: "write a fact", poll: "wait for news"},
			}),
			status: statusOf,
		}),
	},
	view: {machine: "tickets", data: Shown, of: shownOf},
	main: ({inputs, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, options)).ready;
			yield* watch("tickets", "tickets", runtime);
			yield* inputs.do.pipe(
				Stream.takeWhile((d) => d.kind !== "quit"),
				Stream.runForEach((d) => runtime.dispatch(msgOf(d)).pipe(Effect.orDie)),
			);
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});
