import {run} from "@demlik/tea/effect";
import {defineProgram, input, kind, output} from "@kampus/fabrika";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Effect, Schema, Stream} from "effect";
import {duplicatesCell} from "./duplicates.ts";
import {clockRunner, loadCell, pollRunner, saveCell, saveHintsCell} from "./ledger.ts";
import {
	Find,
	over,
	Show,
	Shown,
	shownOf,
	statusOf,
	Tracker,
	type TrackerMsg,
	tracker as tickets,
} from "./machine.ts";
import {pullRequestsCell, pullRequestsWaitRunner} from "./pull-requests.ts";
import {Write} from "./ticket.ts";

// The tracker: tickets on the ledger, one stream of facts each (`@kampus/pipeline/tickets/ticket`,
// so a lane writes the same facts), and a window to work
// them (./window.tsx). Its machine (./machine.ts) holds what was read and the writes on their way;
// its cells (./ledger.ts) are the only code that reads or writes the ledger. No React here.
//
//   tsh> tracker                 in the fabrika app, its window takes over: the list, newest first
//   {kind: "file", title: "Login fails", body: "On main."}     what the window sends, on `do`
//   // ledger: tracker/ticket/1/inbox gets {type: "filed", ...} by user:owner; the list shows #1
//   {kind: "quit"}               the tracker ends once its writes are on the ledger; tsh is back
//
//   {kind: "show", show: "all"}                                the list shows closed tickets too
//   {kind: "find", text: "login"}                              and only titles with "login" in them
//   {kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // a click on an open ask's box: tracker/ticket/1/inbox gets {type: "answered", ..., text:
//   // "sha256:…"} by user:owner, the hash of the text the person saw
//   {kind: "comment", ticket: 1, body: "Skip part 2.", asks: "changes"}   "Request changes"
//   {kind: "rate_duplicate", ticket: 9, of: 4, says: "dismiss"}   a click on a duplicate hint
//   // tracker/ticket/9/inbox gets {type: "duplicate_rated", of: 4, says: "dismiss"} by user:owner
//
// Once its own filing lands, it asks Jev whether the new ticket is a duplicate of an open one,
// when the host gave it a `Jev` (./duplicates.ts). A hint at or above the floor goes on the new
// ticket as `maybe_duplicate`, written as the agent `duplicates`: advice only, it closes nothing.
//
// Its one output is the ticket the person picks (opens), sent each time the pick changes, so
// `tracker | ticket | trace` shows the picked ticket in the next two windows:
//
//   {kind: "open", ticket: 7}    sends 7 on `ticket`
//   {kind: "list"}, then {kind: "open", ticket: 7}   sends nothing: 7 is still the pick
//   {kind: "open", ticket: 3}    sends 3
//
// A ticket's page shows its top line (./head.ts), one row per fact (./rows.ts), and a box for each
// open ask. Only a person answers: a tracker whose `Author` is an agent refuses the write.
//
// It needs three services: `Ledger`, `Author` (./ledger.ts), who it writes as, and
// `PullRequests` (./pull-requests.ts), the open pull requests shown beside the tickets: GitHub's,
// through `@tea-fabrika/tracker/github`, or a fixed list. Its machine's state is kept nowhere:
// started again, it reads the ledger again.
//
// A lane writes its facts through the pipeline's `Tickets` service, on the same streams, and the
// poll shows them. Left for later: linking a pull request to a ticket, and the PR watcher.

export type {Fact, Ticket} from "@kampus/pipeline/tickets/ticket";
/** The streams the tracker reads and writes, and its fold: what a move copies and checks. */
export {fold, ROOT, readRow} from "@kampus/pipeline/tickets/ticket";
export {Hint, hintsOn} from "./duplicates.ts";
export {Head, headOf, lineOf, OpenAsk, openAsksOf, prRefOf, waits} from "./head.ts";
export {Author} from "./ledger.ts";
export {
	Failed,
	type Listed,
	Opened,
	openedOf,
	over,
	type Show,
	type Shown,
	statusOf,
	Tracker,
	type TrackerMsg,
} from "./machine.ts";
export {One, oneOf} from "./one.ts";
export {type PullRequest, PullRequests, pullRequestsOf} from "./pull-requests.ts";
export {checksLine, Row} from "./rows.ts";
export {currentOf, STEPS, StepName, StepNow, StepState, stepsOf, stepWords} from "./steps.ts";
export {type Summary, Write} from "./ticket.ts";
/**
 * The tracker's machine, for a program that reads the same tickets another way: the ticket,
 * map and runs programs run it with `ticketsOptions`, open one ticket, and show that.
 */
export {tickets};

/**
 * What the window does: go to the list or a ticket, pick what the list shows, change a ticket, or
 * quit. One input, so it all stays in order.
 */
export const Do = Schema.Union([
	Schema.Struct({kind: Schema.Literal("list")}),
	Schema.Struct({kind: Schema.Literal("open"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("show"), show: Show}),
	Schema.Struct({kind: Schema.Literal("find"), text: Find}),
	Schema.Struct({kind: Schema.Literal("quit")}),
	Write,
]);
export type Do = typeof Do.Type;

/**
 * The ticket a `do` picks, when it is a new pick: opening a ticket that is not the last one
 * picked. Going back to the list picks nothing, so the last pick stands, as a selection does.
 *
 *   pickOf({kind: "open", ticket: 7}, null)   7
 *   pickOf({kind: "open", ticket: 7}, 7)      null: no change, nothing to send
 *   pickOf({kind: "list"}, 7)                 null
 */
export const pickOf = (d: Do, last: number | null): number | null =>
	d.kind === "open" && d.ticket !== last ? d.ticket : null;

/** What the machine is told for one `do`. A write gets its message id here, once. */
const msgOf = (d: Exclude<Do, {readonly kind: "quit"}>): TrackerMsg => {
	switch (d.kind) {
		case "list":
			return {type: "list"};
		case "open":
			return {type: "open", ticket: d.ticket};
		case "show":
			return {type: "show", show: d.show};
		case "find":
			return {type: "find", text: d.text};
		default:
			return {type: "write", id: crypto.randomUUID(), write: d};
	}
};

/** How the machine runs: its cells and Subs, on the `Ledger`, `Author` and `PullRequests` services. */
export const ticketsOptions = {
	ctx: undefined,
	interpret: {
		load: loadCell,
		save: saveCell,
		pull_requests: pullRequestsCell,
		duplicates: duplicatesCell,
		save_hints: saveHintsCell,
	},
	subscribe: {poll: pollRunner, pull_requests_wait: pullRequestsWaitRunner, clock: clockRunner},
	terminal: over,
};

/**
 * The machine as a program declares it: kept nowhere, since the ledger keeps the tickets. `main`
 * runs it and shows it; no ref of a run ever starts it.
 */
export const ticketsKind = kind({
	machine: tickets,
	state: Tracker,
	parent: "main",
	options: () => ticketsOptions,
	drawing: () => ({
		name: "tickets",
		steps: {
			load: "read the ledger",
			save: "write a fact",
			poll: "wait for news",
			pull_requests: "read the open pull requests",
			pull_requests_wait: "wait to read them again",
			clock: "keep the time",
			duplicates: "ask Jev for a duplicate",
			save_hints: "write the duplicate hints",
		},
	}),
	status: statusOf,
});

export const tracker = defineProgram({
	name: "tracker",
	description:
		"Tickets on the ledger, one stream of facts each: lists them with the open pull requests beside them, files one, shows one's timeline and top line, comments, answers an open ask, closes and reopens. It has a window.",
	inputs: {
		do: input(
			Do,
			"What the window does: list, open a ticket, show open, closed or all, find by title, file, comment, answer an ask, close, reopen, or quit.",
		),
	},
	outputs: {
		ticket: output(
			TicketNumber,
			"The ticket the person picks, by its number: sent each time the pick changes, so a pipe carries the latest pick.",
		),
	},
	machines: {tickets: ticketsKind},
	view: {machine: "tickets", data: Shown, of: shownOf},
	main: ({inputs, send, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			yield* watch("tickets", "tickets", runtime);
			let last: number | null = null;
			yield* inputs.do.pipe(
				Stream.takeWhile((d) => d.kind !== "quit"),
				Stream.runForEach((d) =>
					Effect.gen(function* () {
						yield* runtime.dispatch(msgOf(d)).pipe(Effect.orDie);
						// Sent after the window moved. Down a pipe whose reader has gone, this send fails
						// and the tracker ends, as a writer on a closed Unix pipe does.
						const picked = pickOf(d, last);
						if (picked === null) return;
						last = picked;
						yield* send("ticket", picked);
					}),
				),
			);
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});
