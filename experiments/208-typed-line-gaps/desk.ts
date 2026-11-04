import {asks} from "./programs/asks.ts";
import {probe} from "./programs/probe.ts";
import {ticket} from "./programs/ticket.ts";
import {tracker} from "./programs/tracker.ts";

// The desk's programs, as values. The only place all of them meet; no program imports another.
export const programs = {asks, ticket, tracker, probe};
