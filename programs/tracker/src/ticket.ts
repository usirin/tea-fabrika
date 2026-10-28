import {hashOf, Text} from "@kampus/pipeline/tickets/approval";
import {
	Asks,
	Body,
	type Fact,
	Id,
	Said,
	State,
	type Ticket,
	TicketNumber,
	Title,
} from "@kampus/pipeline/tickets/ticket";
import {Effect, Schema} from "effect";

// What a person does to a ticket in the window, and how the list sums one up. The facts
// themselves, and the fold, are the pipeline's (`@kampus/pipeline/tickets/ticket`), so a lane
// writes the same facts this window shows.
//
//   {kind: "comment", ticket: 3, body: "Skip part 2.", asks: "changes"}
//   // tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}
//   {kind: "answer", ticket: 3, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // tracker/ticket/3/inbox  {type: "answered", ..., text: "sha256:…"}: the hash of what it saw

/** One change a person asks for. Each becomes one fact: `file` a new ticket's `filed`. */
export const Write = Schema.Union([
	Schema.Struct({kind: Schema.Literal("file"), title: Title, body: Body}),
	/** `asks: "changes"`: the "Request changes" button, not "Comment". */
	Schema.Struct({
		kind: Schema.Literal("comment"),
		ticket: TicketNumber,
		body: Said,
		asks: Schema.optionalKey(Asks),
	}),
	Schema.Struct({kind: Schema.Literal("close"), ticket: TicketNumber}),
	Schema.Struct({kind: Schema.Literal("reopen"), ticket: TicketNumber}),
	/**
	 * A click on an ask's box: one of its picks, the note typed beside it, and the ticket's title and
	 * body as the person saw them, so the answer names the text it covers.
	 */
	Schema.Struct({
		kind: Schema.Literal("answer"),
		ticket: TicketNumber,
		ask: Id,
		pick: Title,
		note: Body,
		saw: Text,
	}),
]);
export type Write = typeof Write.Type;

/** The fact a write puts on the ledger. An answer's text goes in as its hash. */
export const factOf = (write: Write): Effect.Effect<Fact> => {
	switch (write.kind) {
		case "file":
			return Effect.succeed({type: "filed", title: write.title, body: write.body});
		case "comment":
			return Effect.succeed({
				type: "commented",
				body: write.body,
				...(write.asks === undefined ? {} : {asks: write.asks}),
			});
		case "close":
			return Effect.succeed({type: "closed"});
		case "reopen":
			return Effect.succeed({type: "reopened"});
		case "answer":
			return Effect.map(hashOf(write.saw), (text) => ({
				type: "answered" as const,
				ask: write.ask,
				pick: write.pick,
				note: write.note,
				text,
			}));
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
