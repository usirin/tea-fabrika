import {type Row, Writer, writerOf} from "@kampus/fabrika";
import {Option, Schema} from "effect";

// A ticket, as the tracker keeps it: one stream of facts on the ledger, and nothing else
// (docs/direction/tickets-start-in-our-tracker.md). Ticket 3 is the registered name
// `tracker/ticket/3`, and its facts are the messages in that name's inbox, oldest first. The row
// says who wrote a fact (a user or an agent) and when; the fact says only what happened:
//
//   tracker/ticket/3/inbox   {type: "filed", title: "Login fails", body: "On main."}   user:owner
//                            {type: "commented", body: "Seen it too."}                  agent:review
//                            {type: "closed"}                                           user:owner
//
//   fold([], entries).tickets   [{number: 3, title: "Login fails", state: "closed", timeline: [3 entries]}]
//
// A state change is a fact of its own (`closed`, `reopened`), never a comment. This file is pure:
// ./ledger.ts reads and writes the ledger.

/** A ticket's number: 1, 2, 3, in the order the tickets were filed. */
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** One line, with no space at either end. */
export const Title = Schema.String.check(
	Schema.isTrimmed(),
	Schema.isNonEmpty(),
	Schema.isMaxLength(256),
	Schema.isPattern(/^[^\r\n]*$/),
);

/** A ticket's body: any text, empty too. */
export const Body = Schema.String.check(Schema.isMaxLength(65_536));

/** A comment's text: a body with something in it besides spaces. */
export const Said = Body.check(Schema.isPattern(/\S/));

/** What happened to a ticket. The first fact of every ticket is `filed`, and only the first. */
export const Fact = Schema.Union([
	Schema.Struct({type: Schema.Literal("filed"), title: Title, body: Body}),
	Schema.Struct({type: Schema.Literal("commented"), body: Said}),
	Schema.Struct({type: Schema.Literal("closed")}),
	Schema.Struct({type: Schema.Literal("reopened")}),
]);
export type Fact = typeof Fact.Type;

/** One fact read back: on which ticket, who wrote it, when, and where the ledger put it. */
export const Entry = Schema.Struct({
	pos: Schema.Int,
	ticket: TicketNumber,
	by: Writer,
	at: Schema.Finite,
	fact: Fact,
});
export type Entry = typeof Entry.Type;

export const State = Schema.Literals(["open", "closed"]);
export type State = typeof State.Type;

/** A ticket, folded from its entries. `timeline`: every entry, oldest first, `filed` the first. */
export const Ticket = Schema.Struct({
	number: TicketNumber,
	title: Title,
	state: State,
	timeline: Schema.Array(Entry),
});
export type Ticket = typeof Ticket.Type;

/** The name every ticket's streams are under, as the ledger reads a prefix: by whole parts. */
export const ROOT = "tracker/ticket";

/** Ticket `number`'s registered name. Its facts go to the name's inbox. */
export const nameOf = (number: number) => `${ROOT}/${number}`;

const INBOX = /^tracker\/ticket\/([1-9]\d*)\/inbox$/;
const decodeFact = Schema.decodeUnknownOption(Schema.fromJsonString(Fact));

/** What one ledger row is to the tracker: a fact on a ticket, a row of no ticket's facts, or broken. */
export type Read =
	| {readonly kind: "entry"; readonly entry: Entry}
	| {readonly kind: "other"}
	| {readonly kind: "broken"; readonly why: string};

/** Read one row. A row in a ticket's inbox must hold a fact, by a user or an agent; else it is broken. */
export function readRow(row: Row): Read {
	const ticket = INBOX.exec(row.stream)?.[1];
	if (ticket === undefined) return {kind: "other"};
	const broken = (why: string): Read => ({
		kind: "broken",
		why: `row ${row.pos} on #${ticket}: ${why}`,
	});
	const by = writerOf(row.writer);
	if (by === null) return broken(`its writer "${row.writer}" is neither a user nor an agent`);
	const fact = Option.getOrNull(decodeFact(row.data));
	if (fact === null) return broken(`its data is not a fact`);
	if (fact.type !== row.kind) return broken(`a ${fact.type} fact kept as ${row.kind}`);
	return {kind: "entry", entry: {pos: row.pos, ticket: Number(ticket), by, at: row.at, fact}};
}

/** The tickets with the entries folded in, oldest ticket first, and what did not fit, in words. */
export interface Folded {
	readonly tickets: readonly Ticket[];
	readonly problems: readonly string[];
}

const after = (state: State, fact: Fact): State => {
	if (fact.type === "closed") return "closed";
	if (fact.type === "reopened") return "open";
	return state;
};

/** One entry onto its ticket: the ticket after it, or why it does not fit. */
const step = (ticket: Ticket | undefined, entry: Entry): Ticket | string => {
	const {fact} = entry;
	const where = `row ${entry.pos} on #${entry.ticket}`;
	if (fact.type === "filed")
		return ticket === undefined
			? {number: entry.ticket, title: fact.title, state: "open", timeline: [entry]}
			: `${where}: filed a second time`;
	if (ticket === undefined) return `${where}: ${fact.type}, but the ticket was never filed`;
	return {...ticket, state: after(ticket.state, fact), timeline: [...ticket.timeline, entry]};
};

/** Fold entries, in the ledger's order, onto the tickets folded so far. */
export function fold(tickets: readonly Ticket[], entries: readonly Entry[]): Folded {
	const byNumber = new Map(tickets.map((t) => [t.number, t]));
	const problems: string[] = [];
	for (const entry of entries) {
		const next = step(byNumber.get(entry.ticket), entry);
		if (typeof next === "string") problems.push(next);
		else byNumber.set(entry.ticket, next);
	}
	return {tickets: [...byNumber.values()].sort((a, b) => a.number - b.number), problems};
}

/** One change a person asks for. Each becomes one fact: `file` a new ticket's `filed`. */
export const Write = Schema.Union([
	Schema.Struct({kind: Schema.Literal("file"), title: Title, body: Body}),
	Schema.Struct({kind: Schema.Literal("comment"), ticket: TicketNumber, body: Said}),
	Schema.Struct({kind: Schema.Literal("close"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("reopen"), ticket: TicketNumber}),
]);
export type Write = typeof Write.Type;

/** The fact a write puts on the ledger. */
export const factOf = (write: Write): Fact => {
	switch (write.kind) {
		case "file":
			return {type: "filed", title: write.title, body: write.body};
		case "comment":
			return {type: "commented", body: write.body};
		case "close":
			return {type: "closed"};
		case "reopen":
			return {type: "reopened"};
	}
};

/** A ticket as the list shows it: no timeline, but how many comments and when it last moved. */
export const Summary = Schema.Struct({
	number: TicketNumber,
	title: Title,
	state: State,
	comments: Schema.Int,
	at: Schema.Finite,
});
export type Summary = typeof Summary.Type;

export const summaryOf = (ticket: Ticket): Summary => ({
	number: ticket.number,
	title: ticket.title,
	state: ticket.state,
	comments: ticket.timeline.filter((e) => e.fact.type === "commented").length,
	at: ticket.timeline.at(-1)?.at ?? 0,
});
