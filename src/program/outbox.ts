import {type Cause, Effect, Queue, type Scope, Semaphore} from "effect";
import type {Word} from "./program.ts";
import type {Handle} from "./storage.ts";

// A pipe's outbox: how a value sent down a pipe into an input that acks
// (`{ack: "manual"}`) is never lost to a kill. `pipe` makes one
// (./program.ts); a program never sees it.
//
//   send(value)   wait for room, keep the value in the run's outbox, hand it
//                 to the receiver's line, return
//   ack           the receiver has saved it: it leaves the outbox
//   resend        at the next start, before `main`: each value still there
//                 is handed on again, under its old number
//   drained       before the run ends: every value acked, or the receiver gone
//
// So from the moment `send` returns, one side or the other keeps the value,
// and for a moment both do: no kill can lose it. A value can come twice (the
// receiver saved it, and the kill came before the ack was kept), so the
// receiver drops a repeat by its own id.
//
// The design is Effect cluster's `MessageStorage`: a message is kept before
// it is delivered, a reply marks it processed, and `unprocessedMessages`
// hands back the rest at the next start. Here the sender keeps it, not a
// shared mailbox, since the two runs may have two storages and a
// `KeyValueStore` has no transactions. Akka's `AtLeastOnceDelivery` has the
// same shape (`deliver`, `confirmDelivery`, redelivery, a cap on unconfirmed
// messages), and so does a transactional outbox.
//
// Room: at most `WINDOW` values sent and not acked. A slow receiver makes the
// sender wait, the way a full Unix pipe makes its writer wait, so an outbox
// never holds more than `WINDOW` values. TCP calls this its send window;
// Kafka's producer, `max.in.flight.requests.per.connection`.

/** How many values one pipe may have sent and not yet acked: Kafka's default for its in-flight cap. */
export const WINDOW = 5;

/** One pipe's outbox, made by the run that writes into it. */
export interface Outbox {
	/** Keep `value` and hand it on. Returns once it is kept, not once it is acked. */
	readonly send: (value: unknown) => Effect.Effect<void>;
	/** Hand on again what an earlier start kept and never heard acked, in the order it was sent. */
	readonly resend: Effect.Effect<void>;
	/** Done once every value sent is acked, or the receiver has ended and no ack can come. */
	readonly drained: Effect.Effect<void>;
}

/** What an outbox is made from. */
export interface Wiring {
	/** The sender's run, where the outbox is kept. */
	readonly handle: Handle;
	/** The sender's name and the output, for why a pipe broke. */
	readonly program: string;
	readonly output: string;
	/** Whether the receiver's input takes the value's shape. One it never takes is not kept: sent again, it would break the pipe again. */
	readonly fits: (value: unknown) => boolean;
	/** Put one value on the receiver's line, with what its ack runs: `queued`, or why not. */
	readonly hand: (value: unknown, ack: Effect.Effect<void>) => Word;
	/** Done once the receiver has ended. */
	readonly gone: Effect.Effect<void>;
	/** An ack that could not be kept: it fails the sender's run. */
	readonly broken: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}

/** The outbox of one output, kept in its run, with its acks kept in a fiber of the run's scope. */
export const outboxOf = ({
	handle,
	program,
	output,
	fits,
	hand,
	gone,
	broken,
}: Wiring): Effect.Effect<Outbox, never, Scope.Scope> =>
	Effect.gen(function* () {
		const found = handle.unacked.filter((s) => s.output === output);
		const room = yield* Semaphore.make(WINDOW);
		/** Sent and not yet acked, by number. */
		const waiting = new Set<number>();
		let next = found.reduce((top, s) => Math.max(top, s.n + 1), 0);

		// Kept one at a time, by the sender: the receiver never waits on the sender's disk.
		const acks = yield* Queue.unbounded<number>();
		yield* Effect.forkScoped(
			Effect.forever(
				Queue.take(acks).pipe(
					Effect.flatMap((n) =>
						waiting.has(n)
							? handle.acked(output, n).pipe(
									Effect.andThen(
										Effect.sync(() => {
											waiting.delete(n);
										}),
									),
									Effect.andThen(room.release(1)),
								)
							: Effect.void,
					),
				),
			).pipe(Effect.catchCause(broken)),
		);

		const broke = (word: Word) =>
			Effect.die(new Error(`${program} sent ${output} down a pipe that answered ${word}`));
		/** Hand one value kept under `n` to the line. Anything but `queued` breaks the pipe. */
		const handOn = (n: number, value: unknown) =>
			Effect.suspend(() => {
				waiting.add(n);
				const word = hand(value, Queue.offer(acks, n).pipe(Effect.asVoid));
				return word === "queued" ? Effect.void : broke(word);
			});

		/** Wait for room, keep it under the next number, hand it on. */
		const keep = (value: unknown) =>
			room.take(1).pipe(
				Effect.andThen(
					Effect.suspend(() => {
						const n = next++;
						return handle
							.sent(output, n, value)
							.pipe(Effect.orDie, Effect.andThen(handOn(n, value)));
					}),
				),
			);

		return {
			send: (value) => (fits(value) ? keep(value) : broke("bad_shape")),
			resend: Effect.forEach(
				found,
				(s) => room.take(1).pipe(Effect.andThen(handOn(s.n, s.value))),
				// One at a time, so they come in the order they were sent.
				{discard: true, concurrency: 1},
			),
			drained: room.take(WINDOW).pipe(Effect.raceFirst(gone), Effect.asVoid),
		};
	});
