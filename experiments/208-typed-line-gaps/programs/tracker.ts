import {Schema} from "effect";
import {defineProgram, input, output} from "../register.ts";
import {OneTicket, Query, TicketNumber} from "../schemas.ts";

// Today's tracker's parts (programs/tracker/src/index.ts), cut to four. It has no flags.
export const tracker = defineProgram({
	name: "tracker",
	flags: {},
	inputs: {
		close: input(OneTicket, "Close a ticket."),
		query: input(Query, "Read tickets: open one, or list them by status."),
		quit: input(Schema.Null, "Stop."),
	},
	outputs: {
		ticket: output(TicketNumber, "The ticket the person picks, sent each time the pick changes."),
	},
});

declare module "../register.ts" {
	interface Register {
		tracker: typeof tracker;
	}
}
