import {Effect} from "effect";
import {type LaneId, laneId, type TicketId} from "../ids.ts";
import {type Entry, type Fact, Ledger} from "./ledger.ts";

// One lane works a ticket at a time. A lane takes its ticket with a claim on
// the ledger, and lets it go when it ends. Who holds a ticket is a fold over
// the ledger's facts, kept nowhere else:
//
//   claimed   holds the ticket if nobody did: the first claim since the ticket
//             was last let go wins, and a later one changes nothing
//   released  lets it go, if this lane held it; from any other lane, nothing
//
// The claim is one compare-and-set: the ledger takes the claim only if
// nothing came in since it was read (`appendAfter`). Two lanes that both read
// the ticket free cannot both write a claim; the second reads again, and is
// told who holds it. And since the fold keeps the first claim, even a claim
// written blind, past the compare, takes nothing from the lane that holds it.

/** The lane that holds `ticket` now. `null`: none does. */
export function holderOf(entries: readonly Entry[], ticket: TicketId): LaneId | null {
	let holder: LaneId | null = null;
	for (const {fact} of entries) {
		if (fact.type === "claimed" && fact.ticket === ticket && holder === null) holder = fact.lane;
		if (fact.type === "released" && fact.ticket === ticket && fact.lane === holder) holder = null;
	}
	return holder;
}

/**
 * A claim against the ledger as read: who holds the ticket after it, and the
 * fact to add for that (`null`: nothing to add, it was held already).
 */
export function claimOn(
	entries: readonly Entry[],
	ticket: TicketId,
	lane: LaneId,
): {readonly holder: LaneId; readonly add: Fact | null} {
	const holder = holderOf(entries, ticket);
	return holder === null
		? {holder: lane, add: {type: "claimed", ticket, lane}}
		: {holder, add: null};
}

/** The fact that lets `ticket` go, if `lane` holds it. `null`: it does not, and nothing changes. */
export function releaseOn(entries: readonly Entry[], ticket: TicketId, lane: LaneId): Fact | null {
	return holderOf(entries, ticket) === lane ? {type: "released", ticket, lane} : null;
}

/** Take `ticket` for `lane`, unless another lane holds it. Answers the lane that holds it after: `lane` itself, or the one before. */
export const claim = (ticket: TicketId, lane: LaneId): Effect.Effect<LaneId, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		for (;;) {
			const entries = yield* ledger.entries;
			const {holder, add} = claimOn(entries, ticket, lane);
			if (add === null) return holder;
			if ((yield* ledger.appendAfter(entries.at(-1)?.seq ?? 0, add)) !== null) return holder;
			// Another fact came in between the read and the write: read again.
		}
	});

/** Let `ticket` go, if `lane` holds it. Asked again, or by another lane, it changes nothing. */
export const release = (ticket: TicketId, lane: LaneId): Effect.Effect<void, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const fact = releaseOn(yield* ledger.entries, ticket, lane);
		if (fact !== null) yield* ledger.append(fact);
	});

/** A new lane on `ticket`: its id is made from the place of the fact that says it began. */
export const newLane = (ticket: TicketId): Effect.Effect<LaneId, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const entry = yield* ledger.append({type: "lane", ticket});
		return laneId(`L${entry.seq}`);
	});
