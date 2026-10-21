import {Effect, type Layer} from "effect";
import {type Ledger, readFacts} from "../../asks/ledger.ts";
import {type Folded, foldLedger, planFor} from "../../asks/rules.ts";
import {readTicketId, type TicketId} from "../../ids.ts";
import type {Go, PlanState, Ticket} from "./ticket.ts";

// What lets a ticket be built, read beside the ticket, by the rule the
// repository's fabrika.toml picks (`build.go`, ../../setup.ts):
//
//   plan    the owner approved its plan on the ledger, read from the asks
//           core's own fold (../../asks/rules.ts). The default: the owner
//           approves plans, not pull requests, and the approval is kept on
//           the record a label can drift from
//           (docs/direction/sort-answers-yes-or-no.md,
//           docs/direction/every-wait-is-a-queue.md)
//   label   the ticket carries the label, as today's fabrika reads it
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

/** The rule a live build reads tickets by. `plan` reads the ledger it is handed. */
export type GoRule =
	| {readonly by: "label"; readonly label: string}
	| {readonly by: "plan"; readonly ledger: Layer.Layer<Ledger>};

/** The ticket, with what lets it be built read beside it. */
export const withGo = (rule: GoRule, ticket: Ticket): Effect.Effect<Ticket> => {
	if (rule.by === "label") return Effect.succeed({...ticket, go: {by: "label", label: rule.label}});
	return planStateOf(ticket.url).pipe(
		Effect.provide(rule.ledger),
		Effect.catchCause(() => Effect.succeed("unknown" as const)),
		Effect.map((plan): Ticket => ({...ticket, go: {by: "plan", plan} satisfies Go})),
	);
};
