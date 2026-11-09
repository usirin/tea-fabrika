// The ticket program's data, shared by the three shapes so they differ only in the program.
// next/ only. Each schema is the job of today's programs/ticket, rethought for next/: the facts are
// `_tag`ged, the ticket's page is what one read Cmd hands back, and nothing here is a program part.
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";

/** A ticket, by its number. */
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** One open ask on a ticket: its id and the picks a person may answer with. */
export const Ask = Schema.Struct({id: Schema.String, picks: Schema.Array(Schema.String)});

/** One ticket as its window draws it: what the `ticket_read` Cmd hands back. */
export const Page = Schema.Struct({
	number: TicketNumber,
	title: Schema.String,
	body: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	asks: Schema.Array(Ask),
});
export type Page = typeof Page.Type;

// What a client sends. The door adds `parent`, its own envelope id, to every input it lets in.
export const Show = Schema.Struct({ticket: TicketNumber});
export const Comment = Schema.Struct({
	ticket: TicketNumber,
	body: Schema.String,
	asks: Schema.optionalKey(Schema.Literal("changes")),
});
export const Answer = Schema.Struct({
	ticket: TicketNumber,
	ask: Schema.String,
	pick: Schema.String,
	note: Schema.String,
	saw: Schema.Struct({title: Schema.String, body: Schema.String}),
});
export const OneTicket = Schema.Struct({ticket: TicketNumber});

// The facts the program writes, one per kind of change, on the ticket's stream.
export const Commented = Schema.TaggedStruct("commented", Comment.fields);
export const Answered = Schema.TaggedStruct("answered", Answer.fields);
export const Closed = Schema.TaggedStruct("closed", OneTicket.fields);
export const Reopened = Schema.TaggedStruct("reopened", OneTicket.fields);

/** The stream a ticket's facts go on. */
export const stream = (ticket: number): string => `ticket/${ticket}`;

/** Reads one ticket's page from the ledger. The runner's handler runs it; the program never does. */
export const readTicket = Cmd.make("ticket_read", {
	input: OneTicket,
	ok: Page,
	err: ["not_found"],
});

/** The ticket program's model. The same in all three shapes. */
export const Model = Schema.Struct({
	/** The ticket shown now, or none yet. */
	now: Schema.NullOr(TicketNumber),
	/** Every ticket this process has shown: the only ones its window may write to. */
	shown: Schema.Array(TicketNumber),
	/** The shown ticket's page, once read. */
	page: Schema.NullOr(Page),
	/** Writes asked for and not yet answered. */
	saving: Schema.Int,
	/** Why the last read or write failed, if it did. */
	failed: Schema.NullOr(Schema.String),
});
export type Model = typeof Model.Type;

export const start: Model = {now: null, shown: [], page: null, saving: 0, failed: null};
