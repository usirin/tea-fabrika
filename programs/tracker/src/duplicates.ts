import {Jev} from "@kampus/pipeline/services";
import {scoresOf} from "@kampus/pipeline/tickets/duplicates";
import {
	factsOf,
	Says,
	State,
	type Ticket,
	TicketNumber,
	Title,
	Yes,
} from "@kampus/pipeline/tickets/ticket";
import {Effect, Option, Schema} from "effect";
import type {duplicates} from "./machine.ts";

// The duplicate hint, on the tracker's side: the cell that asks Jev, and what a ticket's page
// shows. The question, the filter and the floor are the pipeline's
// (`@kampus/pipeline/tickets/duplicates`).
//
//   duplicates {ticket: 9, filed: {title, body}, candidates: [#4, #6]}
//   // no `Jev` in the services: {kind: "off"}, and no call goes out
//   // with one: {kind: "scored", scores: [{of: 4, yes: 0.83}, {of: 6, yes: 0.12}]}
//
// `Jev` is optional on purpose. The app's host gives it only when a key is set
// (apps/fabrika/src/host/main.ts), so a tracker in a test, or in a script that posts to the
// ledger, never calls Jev and never spends.

/** Ask Jev about each candidate; with no `Jev` service, ask nothing and say so. */
export const duplicatesCell = (cmd: ReturnType<typeof duplicates>) =>
	Effect.gen(function* () {
		const jev = yield* Effect.serviceOption(Jev);
		if (Option.isNone(jev)) return {kind: "off" as const};
		const scores = yield* scoresOf(cmd.filed, cmd.candidates).pipe(
			Effect.provideService(Jev, jev.value),
			Effect.mapError(() => ({_tag: "unreachable" as const, why: "Jev did not answer"})),
		);
		return {kind: "scored" as const, scores};
	});

/** A duplicate hint, as a ticket's page shows it. */
export const Hint = Schema.Struct({
	of: TicketNumber,
	/** The other ticket's title and state; `null` when it is not on the ledger as read. */
	title: Schema.NullOr(Title),
	state: Schema.NullOr(State),
	yes: Yes,
	/** A person's newest word on it; `null`: none yet. */
	says: Schema.NullOr(Says),
});
export type Hint = typeof Hint.Type;

/** A ticket's duplicate hints, in the order they were written, each with its newest word. */
export const hintsOn = (ticket: Ticket, tickets: readonly Ticket[]): readonly Hint[] => {
	const words = factsOf(ticket.timeline, "duplicate_rated");
	return factsOf(ticket.timeline, "maybe_duplicate").map((h) => {
		const other = tickets.find((t) => t.number === h.of);
		return {
			of: h.of,
			title: other?.title ?? null,
			state: other?.state ?? null,
			yes: h.yes,
			says: words.findLast((w) => w.of === h.of)?.says ?? null,
		};
	});
};
