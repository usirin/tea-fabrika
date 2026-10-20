// What 94's host machine (../94-tea-host/host-machine.ts, unchanged) needs from the one ledger, for
// both hosts of experiment 97 (the counter's and the agents'): its two Cmds, `claim` and `renew`,
// and its registry tail. 94, 95 and 96 each wrote these inline; here they are once, on the merged
// service, whose refusals are tagged errors:
//
//   claim:  Claimed -> claimed;  Held -> held (wait out the lease);  Stale -> try at the new rev;
//           Denied or no answer -> claim_failed
//   renew:  ok -> renewed;  LeaseLost or Cancelled -> renew_lost;  no answer -> renew_unknown
//
// The registry tail is 96's live tail of the name's own stream, which holds only claims, expiries
// and cancels. 95 read the whole log every 25 ms instead.
import {Effect, Exit, Schema, Stream} from "effect";
import type {HostMsg} from "../94-tea-host/host-machine.ts";
import type {Ledger, Row} from "./service.ts";
import {type Meter, tail} from "./tail.ts";

const Expired = Schema.Struct({fence: Schema.Number});
const expiredFence = (r: Row): number | null => {
	const exit = Schema.decodeUnknownExit(Schema.fromJsonString(Expired))(r.data);
	return Exit.isSuccess(exit) ? exit.value.fence : null;
};

export const hostCmds = (o: {
	readonly ledger: Ledger["Service"];
	/** The registered name: the lease is on it. */
	readonly name: string;
	readonly holder: string;
	readonly ttlMs: number;
	/** The ledger's base URL and name, for the tail's socket. */
	readonly base: string;
	readonly ledgerName: string;
	readonly meter: Meter;
	readonly line: (o: object) => Effect.Effect<void>;
}) => {
	const {ledger, name, holder, ttlMs, line} = o;
	/** The registry stream's rev as last seen: a claim must name it, and `Stale` gives the new one. */
	let rev = 0;
	const claim = Effect.gen(function* () {
		for (let tries = 0; tries < 10; tries++) {
			const r = yield* ledger.claim(name, holder, rev, ttlMs).pipe(Effect.result);
			if (r._tag === "Success") {
				rev = r.success.rev;
				yield* line({ev: "claimed", fence: r.success.fence, expiresAt: r.success.expiresAt});
				return {type: "claimed", fence: r.success.fence} satisfies HostMsg;
			}
			const e = r.failure;
			if (e._tag === "Held")
				return {type: "held", waitMs: Math.max(0, e.expiresAt - Date.now()) + 1} satisfies HostMsg;
			if (e._tag !== "Stale") break;
			rev = e.rev;
		}
		return {type: "claim_failed"} satisfies HostMsg;
	});

	const renew = (fence: number) =>
		ledger.renew(name, fence, ttlMs).pipe(
			Effect.as<HostMsg>({type: "renewed", fence}),
			Effect.catchTags({
				LeaseLost: () => Effect.succeed<HostMsg>({type: "renew_lost", fence}),
				Cancelled: () => Effect.succeed<HostMsg>({type: "renew_lost", fence}),
				LedgerUnreachable: () => Effect.succeed<HostMsg>({type: "renew_unknown", fence}),
			}),
			Effect.tap((m) =>
				m.type === "renewed" ? Effect.void : line({ev: "renew", fence, answer: m.type}),
			),
		);

	// From the current claim on (or from the stream's end when nobody holds it).
	const registryTail = Stream.unwrap(
		Effect.gen(function* () {
			const lease = yield* ledger.lease(name).pipe(Effect.orElseSucceed(() => null));
			const rows = yield* ledger.readStream(name).pipe(Effect.orElseSucceed(() => []));
			o.meter.reads++;
			o.meter.events += rows.length;
			o.meter.bytes += JSON.stringify(rows).length;
			const claimRow = lease === null ? undefined : rows.find((r) => r.pos === lease.fence);
			const fromRev = claimRow === undefined ? (rows.at(-1)?.rev ?? 0) : claimRow.rev - 1;
			return tail(ledger, {
				base: o.base,
				name: o.ledgerName,
				stream: name,
				fromRev,
				meter: o.meter,
			});
		}),
	).pipe(
		Stream.flatMap((r): Stream.Stream<HostMsg> => {
			if (r.kind === "claimed") return Stream.make({type: "seen_claim", fence: r.pos});
			const fence = r.kind === "lease_expired" ? expiredFence(r) : null;
			return fence === null ? Stream.empty : Stream.make({type: "seen_expiry", fence});
		}),
	);

	return {claim, renew, registryTail};
};
