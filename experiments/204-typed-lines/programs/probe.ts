import {Schema} from "effect";
import {defineProgram, input, output} from "../register.ts";
import {AskId, TicketNumber} from "../schemas.ts";

// Made up, for the law only: the three real programs never have two inputs that fit one output,
// so this one exists to reach the "more than one way" and "a member of a union" rules.
export const probe = defineProgram({
	name: "probe",
	flags: {},
	inputs: {
		first: input(TicketNumber, "A ticket."),
		second: input(TicketNumber, "Another ticket."),
		either: input(Schema.Union([AskId, Schema.Null]), "An ask, or nothing."),
	},
	outputs: {
		ask: output(AskId, "An ask."),
	},
});

declare module "../register.ts" {
	interface Register {
		probe: typeof probe;
	}
}
