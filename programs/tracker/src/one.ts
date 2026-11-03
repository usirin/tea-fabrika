import {Ticket, TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";
import type {Tracker} from "./machine.ts";

// One ticket as the tracker machine holds it, whole: what the map and runs programs show their
// windows. Each window folds the timeline its own way (the map into the nine steps, the runs
// into tracks up to its playhead), so the view hands over the facts and the clock, nothing more.
//
//   oneOf(state)   // state.open = 7
//   // {ready: true, number: 7, ticket: {number: 7, title: "...", state: "open", timeline: [7]}, now}

export const One = Schema.Struct({
	/** The ledger has been read once. */
	ready: Schema.Boolean,
	/** The ticket asked for. `null` only before main opens it, at start. */
	number: Schema.NullOr(TicketNumber),
	/** `null`: no ticket has that number, or the ledger has not been read yet. */
	ticket: Schema.NullOr(Ticket),
	/** The clock's last tick. 0: none yet. */
	now: Schema.Finite,
	/** The ledger could not be read, in its words. */
	unreachable: Schema.NullOr(Schema.String),
});
export type One = typeof One.Type;

/** The ticket the machine has open, with its facts. */
export const oneOf = (s: Tracker): One => ({
	ready: s.ready,
	number: s.open,
	ticket: s.tickets.find((t) => t.number === s.open) ?? null,
	now: s.now,
	unreachable: s.unreachable,
});
