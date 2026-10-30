import {run} from "@demlik/tea/effect";
import {defineProgram, end, input, kind, output} from "@kampus/fabrika";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Effect, Schema} from "effect";
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
// It has one input, `do`, and its value is one tagged union, as an Elm program's message is: each
// write, each one fact, the query, which writes nothing (as CQRS keeps commands, its word, apart
// from queries), and quit. Its run's one mailbox reads what is told in the order it was told: a
// close told right after a file is read after it, and a quit after the last write.
//
//   tsh> tracker                 in the fabrika app, its window takes over: the list, newest first
//   {kind: "file", title: "Login fails", body: "On main."}
//   // ledger: tracker/ticket/1/inbox gets {type: "filed", ...} by user:owner; the list shows #1
//   {kind: "quit"}               the tracker ends once its writes are on the ledger; tsh is back
//
//   {kind: "query", status: "all", find: "login"}   the list: closed tickets too, titles with "login"
//   {kind: "query", ticket: 1}                      ticket 1's page
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
// `tracker | ticket | runs` shows the picked ticket in the next two windows:
//
//   {kind: "query", ticket: 7}    sends 7 on `ticket`
//   {kind: "query", status: "open"}, then {kind: "query", ticket: 7}   sends nothing: 7 is still the pick
//   {kind: "query", ticket: 3}    sends 3
//
// An agent sees one MCP tool per case (`tracker_file`, `tracker_query`, ...): `@kampus/fabrika/mcp`
// splits the union, the program does not. The query is `{writes: false}`, so its tool says it
// only reads. A ticket's page shows its top line (./head.ts), one row per fact (./rows.ts), and a
// box for each open ask. Only a person answers an ask or rates a duplicate hint: `answer` and
// `rate_duplicate` are `{personOnly: true}`, so an agent has no tool for either, and a tracker
// whose `Author` is an agent refuses the write all the same.
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
 * The query: one ticket's page, or the list by status and a title search ("" or left out: every
 * title). It writes nothing. A filter is sent whole, so a query never depends on the one before.
 *
 *   {kind: "query", ticket: 43}                       ticket 43's page
 *   {kind: "query", status: "open", find: "login"}    the list: open tickets with "login" in the title
 */
export const Query = Schema.Union([
	Schema.Struct({kind: Schema.Literal("query"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("query"), status: Show, find: Schema.optionalKey(Find)}),
]).annotate({
	description:
		'Read tickets: {ticket: 43} opens one; {status: "open" | "closed" | "all", find?: "text"} lists them by status and title. Writes nothing.',
	writes: false,
});
export type Query = typeof Query.Type;

/**
 * Everything the tracker is told, on its one input, in order: a write, the query, or quit. The
 * run's mailbox reads nothing told before what was told ahead of it.
 */
export const Do = Schema.Union([
	...Write.members,
	Query,
	Schema.Struct({kind: Schema.Literal("quit")}).annotate({
		description: "Stop, once every write told before it is on the ledger.",
	}),
]);
export type Do = typeof Do.Type;

/**
 * The ticket a `do` picks, when it is a new pick: a query for one ticket that is not the last one
 * picked. A query for the list picks nothing, so the last pick stands, as a selection does.
 *
 *   pickOf({kind: "query", ticket: 7}, null)              7
 *   pickOf({kind: "query", ticket: 7}, 7)                 null: no change, nothing to send
 *   pickOf({kind: "query", status: "open"}, 7)            null
 */
export const pickOf = (d: Do, last: number | null): number | null =>
	d.kind === "query" && "ticket" in d && d.ticket !== last ? d.ticket : null;

/** What the machine is told for one `do`, in order. A write gets its message id here, once. */
const msgsOf = (d: Exclude<Do, {readonly kind: "quit"}>): readonly TrackerMsg[] => {
	if (d.kind !== "query") return [{type: "write", id: crypto.randomUUID(), write: d}];
	return "ticket" in d
		? [{type: "open", ticket: d.ticket}]
		: [{type: "list"}, {type: "show", show: d.status}, {type: "find", text: d.find ?? ""}];
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
			"What the tracker is told, in order: file, comment, close, reopen, answer an ask, query, or quit.",
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
	main: ({serve, send, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(tickets, ticketsOptions)).ready;
			yield* watch("tickets", "tickets", runtime);
			let last: number | null = null;
			yield* serve({
				do: (d) =>
					d.kind === "quit"
						? end
						: Effect.gen(function* () {
								// One message after another: a query's `list`, `show` and `find` land in that order.
								yield* Effect.forEach(
									msgsOf(d),
									(msg) => runtime.dispatch(msg).pipe(Effect.orDie),
									{
										concurrency: 1,
										discard: true,
									},
								);
								// Sent after the window moved. Down a pipe whose reader has gone, this send fails
								// and the tracker ends, as a writer on a closed Unix pipe does.
								const picked = pickOf(d, last);
								if (picked === null) return;
								last = picked;
								yield* send("ticket", picked);
							}),
			});
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});
