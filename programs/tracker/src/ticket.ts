import {hashOf, Text} from "@kampus/pipeline/tickets/approval";
import {
	Asks,
	Body,
	type Fact,
	Id,
	Said,
	Says,
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
//   comment {ticket: 3, body: "Skip part 2.", asks: "changes"}
//   // tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}
//   answer {ticket: 3, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // tracker/ticket/3/inbox  {type: "answered", ..., text: "sha256:…"}: the hash of what it saw
//
// Each command is its own struct, the value of the tracker's input of the same name (./index.ts).
// Inside the machine a write is one tagged union, `Write`, as an Elm Msg is: the input's name
// becomes the tag there, and only there.

/** A new ticket: its title and body. Becomes its `filed`. */
export const File = Schema.Struct({title: Title, body: Body});
export type File = typeof File.Type;

/** A comment. `asks: "changes"`: the "Request changes" button, not "Comment". Becomes one `commented`. */
export const Comment = Schema.Struct({
	ticket: TicketNumber,
	body: Said,
	asks: Schema.optionalKey(Asks),
});
export type Comment = typeof Comment.Type;

/** One ticket, by its number: what `close` and `reopen` take. Becomes its `closed` or `reopened`. */
export const OneTicket = Schema.Struct({ticket: TicketNumber});
export type OneTicket = typeof OneTicket.Type;

/**
 * A click on an ask's box: one of its picks, the note typed beside it, and the ticket's title and
 * body as the person saw them, so the answer names the text it covers. Becomes one `answered`.
 */
export const Answer = Schema.Struct({
	ticket: TicketNumber,
	ask: Id,
	pick: Title,
	note: Body,
	saw: Text,
});
export type Answer = typeof Answer.Type;

/** Accept or dismiss on a duplicate hint: is `ticket` the same as `of`? Advice: nothing closes. */
export const RateDuplicate = Schema.Struct({ticket: TicketNumber, of: TicketNumber, says: Says});
export type RateDuplicate = typeof RateDuplicate.Type;

/** One change a person asks for, as the machine holds it: the command, tagged by its input's name. */
export const Write = Schema.Union([
	Schema.Struct({kind: Schema.Literal("file"), ...File.fields}),
	Schema.Struct({kind: Schema.Literal("comment"), ...Comment.fields}),
	Schema.Struct({kind: Schema.Literal("close"), ...OneTicket.fields}),
	Schema.Struct({kind: Schema.Literal("reopen"), ...OneTicket.fields}),
	Schema.Struct({kind: Schema.Literal("answer"), ...Answer.fields}),
	Schema.Struct({kind: Schema.Literal("rate_duplicate"), ...RateDuplicate.fields}),
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
		case "rate_duplicate":
			return Effect.succeed({type: "duplicate_rated", of: write.of, says: write.says});
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
