import {Schema} from "effect";
import {defineProgram, flag, input, output} from "../register.ts";
import {AskId, TicketNumber} from "../schemas.ts";

// The asks program of the program guidelines (`asks --ask a-approve-8 | ticket`) and the ask desk
// (its output is the selected ask's ticket). Not built yet in either version. Its inputs are not
// settled, so it has only `quit` here.
export const asks = defineProgram({
	name: "asks",
	flags: {
		ask: flag(Schema.UndefinedOr(AskId), "The ask to start on. Left out, the first in the queue."),
	},
	inputs: {
		quit: input(Schema.Null, "Stop."),
	},
	outputs: {
		ticket: output(TicketNumber, "The selected ask's ticket, for `| ticket`."),
	},
});

declare module "../register.ts" {
	interface Register {
		asks: typeof asks;
	}
}
