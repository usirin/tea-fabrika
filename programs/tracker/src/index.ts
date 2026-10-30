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
import {Answer, Comment, File, OneTicket, RateDuplicate, type Write} from "./ticket.ts";

// The tracker: tickets on the ledger, one stream of facts each (`@kampus/pipeline/tickets/ticket`,
// so a lane writes the same facts), and a window to work
// them (./window.tsx). Its machine (./machine.ts) holds what was read and the writes on their way;
// its cells (./ledger.ts) are the only code that reads or writes the ledger. No React here.
//
// It has one input per command, named by its verb, as CQRS names each command by what it does:
// `file`, `comment`, `close`, `reopen`, `answer` and `rate_duplicate`, each one fact; `query`,
// which writes nothing; and `quit`. Each value is that command's own struct. Its run's one mailbox
// reads what is told in the order it was told, across every input: a close told right after a file
// is read after it, and a quit after the last write.
//
//   tsh> tracker                 in the fabrika app, its window takes over: the list, newest first
//   file {title: "Login fails", body: "On main."}
//   // ledger: tracker/ticket/1/inbox gets {type: "filed", ...} by user:owner; the list shows #1
//   quit null                    the tracker ends once its writes are on the ledger; tsh is back
//
//   query {status: "all", find: "login"}   the list: closed tickets too, titles with "login"
//   query {ticket: 1}                      ticket 1's page
//   answer {ticket: 1, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // a click on an open ask's box: tracker/ticket/1/inbox gets {type: "answered", ..., text:
//   // "sha256:…"} by user:owner, the hash of the text the person saw
//   comment {ticket: 1, body: "Skip part 2.", asks: "changes"}   "Request changes"
//   rate_duplicate {ticket: 9, of: 4, says: "dismiss"}           a click on a duplicate hint
//   // tracker/ticket/9/inbox gets {type: "duplicate_rated", of: 4, says: "dismiss"} by user:owner
//
// Once its own filing lands, it asks Jev whether the new ticket is a duplicate of an open one,
// when the host gave it a `Jev` (./duplicates.ts). A hint at or above the floor goes on the new
// ticket as `maybe_duplicate`, written as the agent `duplicates`: advice only, it closes nothing.
//
// Its one output is the ticket the person picks (opens), sent each time the pick changes, so
// `tracker | ticket | runs` shows the picked ticket in the next two windows:
//
//   query {ticket: 7}    sends 7 on `ticket`
//   query {status: "open"}, then query {ticket: 7}   sends nothing: 7 is still the pick
//   query {ticket: 3}    sends 3
//
// An agent sees one MCP tool per input (`tracker_file`, `tracker_query`, ...). The query is
// `{writes: false}`, so its tool says it only reads. A ticket's page shows its top line
// (./head.ts), one row per fact (./rows.ts), and a box for each open ask. Only a person answers an
// ask or rates a duplicate hint: `answer` and `rate_duplicate` are `{personOnly: true}`, so an
// agent has no tool for either, and a tracker whose `Author` is an agent refuses the write all the
// same.
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
export {Head, headOf, lineOf, OpenAsk, openAsksOf, prRefOf, waits, words} from "./head.ts";
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
export {Answer, Comment, File, OneTicket, RateDuplicate, type Summary, Write} from "./ticket.ts";
/**
 * The tracker's machine, for a program that reads the same tickets another way: the ticket,
 * map and runs programs run it with `ticketsOptions`, open one ticket, and show that.
 */
export {tickets};

/**
 * The query: one ticket's page, or the list by status and a title search ("" or left out: every
 * title). It writes nothing. A filter is sent whole, so a query never depends on the one before.
 *
 *   {ticket: 43}                       ticket 43's page
 *   {status: "open", find: "login"}    the list: open tickets with "login" in the title
 */
export const Query = Schema.Union([
	Schema.Struct({ticket: TicketNumber}),
	Schema.Struct({status: Show, find: Schema.optionalKey(Find)}),
]);
export type Query = typeof Query.Type;

/**
 * The ticket a query picks, when it is a new pick: a query for one ticket that is not the last one
 * picked. A query for the list picks nothing, so the last pick stands, as a selection does.
 *
 *   pickOf({ticket: 7}, null)          7
 *   pickOf({ticket: 7}, 7)             null: no change, nothing to send
 *   pickOf({status: "open"}, 7)        null
 */
export const pickOf = (q: Query, last: number | null): number | null =>
	"ticket" in q && q.ticket !== last ? q.ticket : null;

/** What the machine is told for one query, in order. */
const queryMsgsOf = (q: Query): readonly TrackerMsg[] =>
	"ticket" in q
		? [{type: "open", ticket: q.ticket}]
		: [{type: "list"}, {type: "show", show: q.status}, {type: "find", text: q.find ?? ""}];

/** What the machine is told for one write. It gets its message id here, once. */
const writeMsgOf = (write: Write): TrackerMsg => ({type: "write", id: crypto.randomUUID(), write});

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
		file: input(File, "File a new ticket: its title and body. Writes its `filed`."),
		comment: input(
			Comment,
			'Comment on a ticket. `asks: "changes"` requests changes. Writes one `commented`.',
		),
		close: input(OneTicket, "Close a ticket. Writes its `closed`."),
		reopen: input(OneTicket, "Reopen a closed ticket. Writes its `reopened`."),
		answer: input(
			Answer,
			"Answer an open ask on a ticket: a pick, a note, and the title and body as seen. A person only. Writes one `answered`.",
			{personOnly: true},
		),
		rate_duplicate: input(
			RateDuplicate,
			"Accept or dismiss a duplicate hint: is the ticket the same as `of`? A person only. Writes one `duplicate_rated`.",
			{personOnly: true},
		),
		query: input(
			Query,
			'Read tickets: {ticket: 43} opens one; {status: "open" | "closed" | "all", find?: "text"} lists them by status and title. Writes nothing.',
			{writes: false},
		),
		quit: input(Schema.Null, "Stop, once every write told before it is on the ledger."),
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
			const write = (w: Write) => runtime.dispatch(writeMsgOf(w)).pipe(Effect.orDie);
			// One handler per input, each value in the order told across all of them.
			yield* serve({
				file: (v) => write({kind: "file", ...v}),
				comment: (v) => write({kind: "comment", ...v}),
				close: (v) => write({kind: "close", ...v}),
				reopen: (v) => write({kind: "reopen", ...v}),
				answer: (v) => write({kind: "answer", ...v}),
				rate_duplicate: (v) => write({kind: "rate_duplicate", ...v}),
				query: (q) =>
					Effect.gen(function* () {
						// One message after another: a list query's `list`, `show` and `find` land in that order.
						yield* Effect.forEach(
							queryMsgsOf(q),
							(msg) => runtime.dispatch(msg).pipe(Effect.orDie),
							{concurrency: 1, discard: true},
						);
						// Sent after the window moved. Down a pipe whose reader has gone, this send fails
						// and the tracker ends, as a writer on a closed Unix pipe does.
						const picked = pickOf(q, last);
						if (picked === null) return;
						last = picked;
						yield* send("ticket", picked);
					}),
				quit: () => end,
			});
			// Quit, or the input was closed: the writes still waiting land before it ends.
			yield* runtime.dispatch({type: "quit"}).pipe(Effect.orDie);
			yield* runtime.done();
		}).pipe(Effect.scoped),
});
