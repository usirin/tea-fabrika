// The live tail of one stream: EventStoreDB's catch-up subscription. It reads the stream from a rev
// (`readStream`), then waits for the stream's doorbell (`Ledger.watch`) and reads again from where
// it is. Lifted from experiment 96 (experiments/96-ledger-mailbox/tail.ts); what changed is the
// doorbell: 96 opened the Durable Object's WebSocket here, so it worked only over HTTP. Now each
// implementation of the `Ledger` rings its own way, and this one tail runs on all of them.
//
// Correctness never rests on the doorbell:
//
//   - every event comes from `readStream(stream, cursor)`, and the cursor moves only by events
//     handed on, so a ring lost, doubled or late costs at most a read;
//   - with no ring at all it reads every `safety` anyway.
//
// A stream's revs have no gaps (the ledger's `UNIQUE (stream, rev)` and its `max + 1`), so the tail
// checks each event is the one after its cursor and dies if not: a skip or a repeat would be a
// ledger bug, and it must not pass quietly.
import {Duration, Effect, Queue, Schedule, Stream} from "effect";
import type {Ledger, Row} from "./ledger.ts";

/** What a tail did: how much it read to follow its one stream. */
export interface Meter {
	reads: number;
	events: number;
	bytes: number;
	rings: number;
}
export const meter = (): Meter => ({reads: 0, events: 0, bytes: 0, rings: 0});

export interface TailOptions {
	readonly stream: string;
	/** The last rev already seen: the tail starts after it. */
	readonly fromRev: number;
	readonly page?: number;
	/** Read even with no ring after this long. Default 1 s. */
	readonly safety?: Duration.Duration;
	readonly meter?: Meter;
}

export const tail = (ledger: Ledger["Service"], o: TailOptions): Stream.Stream<Row> =>
	Stream.callback<Row>((out) =>
		Effect.gen(function* () {
			const m = o.meter ?? meter();
			const page = o.page ?? 1000;
			const safety = o.safety ?? Duration.seconds(1);
			const bell = yield* Queue.sliding<void>(1);
			yield* ledger.watch(o.stream).pipe(
				Stream.runForEach(() =>
					Effect.sync(() => {
						m.rings++;
					}).pipe(Effect.andThen(Queue.offer(bell, undefined))),
				),
				Effect.forkScoped,
			);
			let cursor = o.fromRev;
			// A ledger that does not answer (restarting) is waited for: the cursor is kept.
			const readFrom = (rev: number) =>
				ledger
					.readStream(o.stream, rev, page)
					.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
			for (;;) {
				const rows = yield* readFrom(cursor);
				m.reads++;
				m.events += rows.length;
				m.bytes += JSON.stringify(rows).length;
				for (const r of rows) {
					if (r.rev !== cursor + 1)
						return yield* Effect.die(`tail of ${o.stream}: rev ${r.rev} after ${cursor}`);
					cursor = r.rev;
					yield* Queue.offer(out, r);
				}
				if (rows.length < page) yield* Queue.take(bell).pipe(Effect.timeoutOption(safety));
			}
		}),
	);
