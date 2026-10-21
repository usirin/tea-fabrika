import {Context, Duration, Effect, FiberMap, Layer} from "effect";
import {Ledger} from "../../host/ledger.ts";
import {type LaneId, laneId, readLaneId, type TicketId} from "../ids.ts";
import {appendFact, ensureName, type Hold, sendFact, steady, ticketName} from "./ledger.ts";

// One lane works a ticket at a time. A lane takes its ticket with the ledger's lease on the
// ticket's name (`pipeline/ticket/<ticket>`): `register`, then `claim`, as a tea-host takes the
// name its program runs under (../../host/host.ts). The lease is the claim, kept nowhere else:
//
//   claim     the ledger's compare-and-set on the name. One claim wins; the others are told
//             who holds it (`Held`). The winner gets a fence, and keeps the lease live by renewing
//             it every third of its time to live, from a fiber of this process.
//   release   a `released` fact under the fence, then the lease ended at once (renewed to 0 ms:
//             etcd's LeaseRevoke).
//   lost      a process that dies, freezes or loses the ledger stops renewing. Its lease runs
//             out; the next claim takes the name with a new fence, and every write under the old
//             fence is refused (`Fenced`): the old holder cannot write as the lane any more.
//
// The fences live in this process only (`Lanes`): a lane started again after a crash, under the
// same id, has none, so it waits for its old lease to run out and claims again.

/** The lane that holds `ticket`'s lease now. `null`: none does. */
export const holderOf = (ticket: TicketId): Effect.Effect<LaneId | null, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const lease = yield* steady("read a lease", ledger.lease(ticketName(ticket)));
		if (lease === null || lease.expires_at <= Date.now()) return null;
		return readLaneId(lease.holder) ?? (yield* Effect.die(`not a lane: ${lease.holder}`));
	});

/**
 * A new lane on `ticket`: a `lane` fact in the ticket's inbox, and its id `L` with that fact's rev
 * there. Under one message id, sent again, it is the same lane.
 */
export const newLane = (ticket: TicketId, id?: string): Effect.Effect<LaneId, never, Ledger> =>
	sendFact({type: "lane", ticket}, id === undefined ? {} : {id}).pipe(
		Effect.catchTag("Fenced", () => Effect.die("an unfenced send was fenced")),
		Effect.map((at) => laneId(`L${at.rev}`)),
	);

export interface LanesOptions {
	/** How long a lease lives unless renewed. Default 30 s; it is renewed every third of that. */
	readonly ttlMs?: number;
}

/** The leases this process holds, one per ticket, each renewed while it is held. */
export class Lanes extends Context.Service<
	Lanes,
	{
		/**
		 * Take `ticket` for `lane`, unless another lane holds it. Answers the lane that holds it
		 * after: `lane` itself, or the one before. A lease of `lane`'s own that this process has no
		 * fence for (a run before a crash) is waited out, then claimed again.
		 */
		readonly claim: (ticket: TicketId, lane: LaneId) => Effect.Effect<LaneId>;
		/** Let `ticket` go, if `lane` holds it here. Asked again, or by another lane, it changes nothing. */
		readonly release: (ticket: TicketId, lane: LaneId) => Effect.Effect<void>;
		/**
		 * Whether `lane` holds `ticket` now: its lease renewed at this moment, under its fence. With no
		 * fence here (a lane started again after a crash, mid way), it claims the ticket as `lane`
		 * first: its own old lease is waited out, and a ticket another lane took is not its own.
		 */
		readonly holding: (ticket: TicketId, lane: LaneId) => Effect.Effect<boolean>;
		/** The lease this process holds on `ticket`, to write facts under. `null`: it holds none. */
		readonly hold: (ticket: TicketId) => Effect.Effect<Hold | null>;
	}
>()("@kampus/fabrika/pipeline/Lanes") {}

/** `Lanes` over the `Ledger`. Its renewals end with the layer's scope, as a killed process's would. */
export const layerLanes = (o: LanesOptions = {}) =>
	Layer.effect(
		Lanes,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const ttlMs = o.ttlMs ?? 30_000;
			const held = new Map<TicketId, {readonly lane: LaneId; readonly fence: number}>();
			const renewals = yield* FiberMap.make<TicketId>();

			const drop = (ticket: TicketId) =>
				Effect.sync(() => held.delete(ticket)).pipe(
					Effect.andThen(FiberMap.remove(renewals, ticket)),
				);
			/** Renew every third of the time to live, until the lease is lost or cancelled. */
			const renewing = (ticket: TicketId, fence: number) =>
				Effect.gen(function* () {
					for (;;) {
						yield* Effect.sleep(Duration.millis(ttlMs / 3));
						const r = yield* ledger.renew(ticketName(ticket), fence, ttlMs).pipe(Effect.result);
						// A ledger that does not answer is asked again at the next turn: the lease may still live.
						if (r._tag === "Success" || r.failure._tag === "LedgerUnreachable") continue;
						// Lost or cancelled: this process holds the ticket no more.
						if (held.get(ticket)?.fence === fence) held.delete(ticket);
						return;
					}
				});

			const claim = (ticket: TicketId, lane: LaneId) =>
				Effect.gen(function* () {
					const mine = held.get(ticket);
					if (mine !== undefined) return mine.lane;
					const name = ticketName(ticket);
					yield* ensureName(name, lane);
					let rev = (yield* steady("read a registry", ledger.readLast(name, 1)))[0]?.rev ?? 0;
					for (;;) {
						const r = yield* steady("claim", ledger.claim(name, lane, rev, ttlMs)).pipe(
							Effect.result,
						);
						if (r._tag === "Success") {
							held.set(ticket, {lane, fence: r.success.fence});
							yield* FiberMap.run(renewals, ticket)(renewing(ticket, r.success.fence));
							return lane;
						}
						const e = r.failure;
						switch (e._tag) {
							case "Stale":
								rev = e.rev;
								continue;
							case "Held": {
								const holder = readLaneId(e.holder);
								if (holder === null) return yield* Effect.die(`not a lane: ${e.holder}`);
								if (holder !== lane) return holder;
								// Its own lease from before a crash: no fence here, so wait it out.
								yield* Effect.sleep(Duration.millis(Math.max(1, e.expiresAt - Date.now() + 1)));
								continue;
							}
							default:
								return yield* Effect.die(`claim on ${name}: ${e._tag}`);
						}
					}
				});

			const release = (ticket: TicketId, lane: LaneId) =>
				Effect.gen(function* () {
					const mine = held.get(ticket);
					if (mine === undefined || mine.lane !== lane) return;
					const name = ticketName(ticket);
					yield* drop(ticket);
					yield* appendFact({type: "released", ticket, lane}, {name, fence: mine.fence}).pipe(
						Effect.catchTag("Fenced", () => Effect.void),
					);
					yield* steady("end a lease", ledger.renew(name, mine.fence, 0)).pipe(
						Effect.catchTags({LeaseLost: () => Effect.void, Cancelled: () => Effect.void}),
					);
				});

			const holding = (ticket: TicketId, lane: LaneId) =>
				Effect.gen(function* () {
					const mine = held.get(ticket);
					if (mine === undefined) return (yield* claim(ticket, lane)) === lane;
					if (mine.lane !== lane) return false;
					const renewed = yield* steady(
						"renew",
						ledger.renew(ticketName(ticket), mine.fence, ttlMs),
					).pipe(Effect.result);
					if (renewed._tag === "Success") return true;
					yield* drop(ticket);
					return false;
				});

			const hold = (ticket: TicketId) =>
				Effect.sync((): Hold | null => {
					const mine = held.get(ticket);
					return mine === undefined ? null : {name: ticketName(ticket), fence: mine.fence};
				});

			const here = <A>(e: Effect.Effect<A, never, Ledger>) =>
				Effect.provideService(e, Ledger, ledger);
			return {
				claim: (ticket, lane) => here(claim(ticket, lane)),
				release: (ticket, lane) => here(release(ticket, lane)),
				holding: (ticket, lane) => here(holding(ticket, lane)),
				hold,
			};
		}),
	);

export const claim = (ticket: TicketId, lane: LaneId) => Lanes.use((l) => l.claim(ticket, lane));
export const release = (ticket: TicketId, lane: LaneId) =>
	Lanes.use((l) => l.release(ticket, lane));
export const holding = (ticket: TicketId, lane: LaneId) =>
	Lanes.use((l) => l.holding(ticket, lane));
