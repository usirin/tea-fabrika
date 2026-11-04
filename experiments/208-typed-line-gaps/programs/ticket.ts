import {Schema} from "effect";
import {defineProgram, flag, input, output} from "../register.ts";
import {OneTicket, TicketNumber} from "../schemas.ts";

// Today's ticket program's parts (programs/ticket/src/index.ts), cut to four. No import of another program.
export const ticket = defineProgram({
	name: "ticket",
	flags: {
		ticket: flag(
			Schema.UndefinedOr(TicketNumber),
			"The ticket to show first, by its number. Left out, it waits for one on its input ticket.",
		),
	},
	inputs: {
		ticket: input(TicketNumber, "A ticket to show now, by its number."),
		close: input(OneTicket, "Close the ticket shown."),
		quit: input(Schema.Null, "Stop."),
	},
	outputs: {
		ticket: output(TicketNumber, "The ticket it shows, sent each time that changes."),
	},
});

declare module "../register.ts" {
	interface Register {
		ticket: typeof ticket;
	}
}
