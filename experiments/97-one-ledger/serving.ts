// Experiment 97's port of experiment 95's `Serving` (../95-agents-across-hosts/serving.ts): what a
// host hands a program it serves while it owns the program's name. The host's own machine
// (../94-tea-host/host-machine.ts, unchanged) turns this off when it stops owning.
//
// New in 97: `tail`, the host's live tail of one stream (96's), in place of 95's whole-log
// polling; and `deliver`, one message into an inbox under the program's own fence, the one way a
// program here writes to anyone else.
import type {OnError} from "@demlik/tea";
import {Duration, Effect, type Stream} from "effect";
import type {Inbox, Ledger, NewEvent, Row} from "./service.ts";

export interface Serving {
	readonly ledger: Ledger["Service"];
	/** The registered name, `asker:1` or `answerer:1`. */
	readonly name: string;
	/** The fence of the claim this host won: every write the program makes carries it. */
	readonly fence: number;
	/** This host's name in the ledger, unique per process start. */
	readonly holder: string;
	/** One JSON line on stdout, for the harness. */
	readonly line: (o: object) => Effect.Effect<void>;
	/** Where the run's failures with no caller go (94: tea's default throws them and the host dies). */
	readonly onError: OnError;
	/** Say the program is running. */
	readonly started: Effect.Effect<void>;
	/** A live tail of one stream, from after `fromRev` on. */
	readonly tail: (stream: string, fromRev: number) => Stream.Stream<Row>;
}

/** How one delivery ended. `fenced`: this program's lease is gone, so it may not speak. */
export type Delivered =
	| {readonly how: "sent"; readonly rev: number; readonly dup: boolean}
	| {readonly how: "fenced"}
	| {readonly how: "denied"}
	| {readonly how: "unreachable"};

/**
 * One message into `inbox`, fenced on the sender's own lease, under the message id `id`. No answer:
 * it is sent again under the same id, up to `tries` times; the ledger answers a landed one `dup`.
 * Unlike 95's `sender`, nothing is ever `stale`: a send names no rev.
 */
export const deliver = (
	o: Serving,
	inbox: Inbox,
	id: string,
	event: Omit<NewEvent, "id" | "writer">,
	tries = 20,
): Effect.Effect<Delivered> =>
	Effect.gen(function* () {
		for (let lost = 0; lost < tries; lost++) {
			const r = yield* o.ledger
				.send(inbox, id, {...event, writer: o.holder}, o.fence)
				.pipe(Effect.result);
			if (r._tag === "Success") return {how: "sent", rev: r.success.rev, dup: r.success.dup};
			const e = r.failure;
			if (e._tag === "Fenced") return {how: "fenced"};
			if (e._tag === "Denied") return {how: "denied"};
			yield* Effect.sleep(Duration.millis(50));
		}
		return {how: "unreachable"};
	});
