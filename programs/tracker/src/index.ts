import {run} from "@demlik/tea/effect";
import {defineProgram, input, kind} from "@kampus/fabrika";
import {Effect, Schema, Stream} from "effect";
import {clockRunner, loadCell, pollRunner, saveCell} from "./ledger.ts";
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
//   {kind: "show", show: "all"}                                the list shows closed tickets too
//   {kind: "find", text: "login"}                              and only titles with "login" in them
//   {kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: ""}
//   // a click on an open ask's box: tracker/ticket/1/inbox gets {type: "answered", ...} by user:owner
//
// A ticket's page shows its top line (./head.ts), one row per fact (./rows.ts), and a box for each
// open ask. Only a person answers: a tracker whose `Author` is an agent refuses the write.
//
// It needs three services: `Ledger`, `Author` (./ledger.ts), who it writes as, and
// `PullRequests` (./pull-requests.ts), the open pull requests shown beside the tickets: GitHub's,
// through `@tea-fabrika/tracker/github`, or a fixed list. Its machine's state is kept nowhere:
// started again, it reads the ledger again.
//
// Left for later, with a place for each: an agent writing to a ticket is another `Author` on the
// same ledger, and the poll already shows its facts; linking a pull request to a ticket and the
// PR watcher are programs that read and write the same streams, and write the lane's facts in
// `Fact`. Nothing writes those yet but tests.

export type {Head, OpenAsk} from "./head.ts";
export {Author} from "./ledger.ts";
export type {Listed, Opened, Show, Shown} from "./machine.ts";
export {type PullRequest, PullRequests, pullRequestsOf} from "./pull-requests.ts";
export type {Row} from "./rows.ts";
export type {Fact, Summary, Ticket, Write} from "./ticket.ts";
/** The streams the tracker reads and writes, and its fold: what a move copies and checks. */
export {fold, ROOT, readRow} from "./ticket.ts";

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

const options = {
	ctx: undefined,
	interpret: {load: loadCell, save: saveCell, pull_requests: pullRequestsCell},
	subscribe: {poll: pollRunner, pull_requests_wait: pullRequestsWaitRunner, clock: clockRunner},
	terminal: over,
};

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
	outputs: {},
	// The ledger keeps the tickets, so the machine is kept nowhere else: main runs it and shows it.
	// No ref of this run ever starts it.
	machines: {
		tickets: kind({
			machine: tickets,
			state: Tracker,
			parent: "main",
			options: () => options,
			drawing: () => ({
				name: "tickets",
				steps: {
					load: "read the ledger",
					save: "write a fact",
					poll: "wait for news",
					pull_requests: "read the open pull requests",
					pull_requests_wait: "wait to read them again",
					clock: "keep the time",
				},
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
