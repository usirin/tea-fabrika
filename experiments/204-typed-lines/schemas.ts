import {Schema} from "effect";

// The shapes more than one program uses, as `@kampus/pipeline` holds `TicketNumber` today. A
// program imports these, never another program.
//
// Each id gets one name, said twice: a brand, which the type-level fit check sees, and an
// `identifier`, which puts the name into the JSON Schema the run-time fit check compares. Today's
// `TicketNumber` (packages/pipeline/src/tickets/ticket.ts) has neither: there it is a plain
// integer of at least 1.

/** A ticket, by its number: an integer of at least 1, as today's `TicketNumber`. */
export const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
	.pipe(Schema.brand("TicketNumber"))
	.annotate({identifier: "TicketNumber"});

/** An ask, as the lane names one today: `a-<what for>-<count>`, `a-approve-8` (stages/pipeline/machine.ts). */
export const AskId = Schema.TemplateLiteral(["a-", Schema.String, "-", Schema.Int])
	.pipe(Schema.brand("AskId"))
	.annotate({identifier: "AskId"});

/** One ticket, named: what today's tracker takes on `close` and `reopen`. */
export const OneTicket = Schema.Struct({ticket: TicketNumber});

/** Today's tracker `query`, cut to two cases: open one ticket, or list by status. */
export const Query = Schema.Union([
	Schema.Struct({ticket: TicketNumber}),
	Schema.Struct({status: Schema.Literals(["open", "closed", "all"])}),
]);
