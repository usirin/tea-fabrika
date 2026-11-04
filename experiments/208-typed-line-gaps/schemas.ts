import {Schema} from "effect";
import {DIGITS, LOWER, run, spelledNumber, spelledText} from "./spelling.ts";

// The shapes more than one program uses, as experiment 204 had them, now each said once, by its
// spelling. The compiler, the run-time reader and the schema's own check all read that spelling.
// 204 said each id's name twice (a brand and an `identifier`); `spelledText` and `spelledNumber`
// take it once and write both.

/**
 * A ticket, by its number: a digit 1-9, then up to 14 more digits. Today's `TicketNumber`
 * (packages/pipeline/src/tickets/ticket.ts) is an integer of at least 1. This is the same set
 * below 10^15, each number spelled one way: no `01`, no `1e3`, no `0x10`.
 */
export const TicketNumber = spelledNumber("TicketNumber", [
	run(DIGITS, {first: "123456789", most: 15}),
]);

/**
 * An ask, as the lane names one today: `a-<what for>-<count>`, `a-approve-8` or
 * `a-rounds_spent-3`. Today's own reading of it is `/^a-([a-z_]+)-\d+$/`
 * (packages/pipeline/src/stages/pipeline/machine.ts, `askedFor`); this is that, with a bound on
 * each run.
 */
export const AskId = spelledText("AskId", [
	"a-",
	run(`${LOWER}_`, {most: 32}),
	"-",
	run(DIGITS, {most: 15}),
]);

/** One ticket, named: what today's tracker takes on `close` and `reopen`. */
export const OneTicket = Schema.Struct({ticket: TicketNumber});

/** Today's tracker `query`, cut to two cases: open one ticket, or list by status. */
export const Query = Schema.Union([
	Schema.Struct({ticket: TicketNumber}),
	Schema.Struct({status: Schema.Literals(["open", "closed", "all"])}),
]);
