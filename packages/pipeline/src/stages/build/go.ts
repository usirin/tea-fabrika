import {Effect, type Layer} from "effect";
import {type Ledger, readFacts} from "../../asks/ledger.ts";
import {type Folded, foldLedger, planFor} from "../../asks/rules.ts";
import {readTicketId, type TicketId} from "../../ids.ts";
import type {PlanState, Ticket} from "./ticket.ts";

// What lets a ticket be built, read beside the ticket: the owner approved its
// plan on the ledger, read from the asks core's own fold (../../asks/rules.ts).
// The owner approves plans, not pull requests, and the approval is kept on
// the record a label can drift from (docs/direction/sort-answers-yes-or-no.md,
// docs/direction/every-wait-is-a-queue.md). A label is never read.
//
// The gate that decides with it is pure (`buildGate`, ./ticket.ts). This file
// only reads.

/** How the plan that names `ticket` stands, in the fold. Pure. */
export function planStateIn(state: Folded, ticket: TicketId): PlanState {
	const plan = planFor(state, ticket);
	const track = plan === null ? undefined : state.plans.get(plan);
	if (track === undefined) return "none";
	return track.approved !== null && track.closed === null ? "approved" : "not_approved";
}

/** How the plan that names the ticket at `url` stands on the ledger. A ledger that breaks is `unknown`. */
export const planStateOf = (url: string): Effect.Effect<PlanState, never, Ledger> => {
	const ticket = readTicketId(url);
	if (ticket === null) return Effect.succeed("unknown");
	return readFacts.pipe(
		Effect.map((entries) => planStateIn(foldLedger(entries), ticket)),
		Effect.catchCause(() => Effect.succeed("unknown" as const)),
	);
};

/** The ticket, with how its plan stands on `ledger` read beside it. */
export const withPlan = (ledger: Layer.Layer<Ledger>, ticket: Ticket): Effect.Effect<Ticket> =>
	planStateOf(ticket.url).pipe(
		Effect.provide(ledger),
		Effect.catchCause(() => Effect.succeed("unknown" as const)),
		Effect.map((plan): Ticket => ({...ticket, plan})),
	);
