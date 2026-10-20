// Experiment 97's copy of experiment 96's tail, unchanged but for importing this folder's service.
//
// New in 96: the live tail of one stream, EventStoreDB's catch-up subscription. It reads the
// stream from a rev (`readStream`), then waits for a wake-up and reads again from where it is.
//
// The wake-up comes over a WebSocket the ledger's Durable Object holds with its hibernation API:
// one small notice per write to the stream, with no event in it. Correctness never rests on it:
//
//   - every event comes from `readStream(stream, cursor)`, and the cursor moves only by events
//     handed on, so a wake-up lost, doubled or late costs at most a read;
//   - on every (re)connect the tail reads once, so a write between the last read and the new
//     socket is not missed;
//   - and with no wake-up at all it reads every `safety` anyway.
//
// A stream's revs have no gaps (the ledger's `UNIQUE (stream, rev)` and the insert's `max + 1`),
// so the tail checks each event is the one after its cursor and dies if not: a skip or a repeat
// would be a ledger bug, and it must not pass quietly.
import {Duration, Effect, Queue, Schedule, Stream} from "effect";
import {Socket} from "effect/socket";
import type {Ledger, Row} from "./service.ts";

/** What a tail did, for the harness: how much it read to follow its one stream. */
export interface Meter {
	reads: number;
	events: number;
	bytes: number;
	wakes: number;
	connects: number;
}
export const meter = (): Meter => ({reads: 0, events: 0, bytes: 0, wakes: 0, connects: 0});

export interface TailOptions {
	/** The ledger's base URL (http), and its name. */
	readonly base: string;
	readonly name: string;
	readonly stream: string;
	/** The last rev already seen: the tail starts after it. */
	readonly fromRev: number;
	readonly page?: number;
	/** Read even with no wake-up after this long. */
	readonly safety?: Duration.Duration;
	readonly meter?: Meter;
}

/** The socket that rings: every notice, and every (re)connect, is one ring. Never fails. */
const doorbell = (url: string, ring: Effect.Effect<void>, m: Meter) =>
	Effect.scoped(
		Effect.gen(function* () {
			const socket = yield* Socket.makeWebSocket(url, {openTimeout: Duration.seconds(2)});
			const pull = yield* Socket.readerString(socket);
			m.connects++;
			yield* ring;
			for (;;) {
				const notes = yield* pull;
				m.wakes += notes.length;
				yield* ring;
			}
		}),
	).pipe(
		// Node at the edge: Node's own global WebSocket, through Effect's Socket.
		Effect.provide(Socket.layerWebSocketConstructorGlobal),
		Effect.catchCause(() => Effect.void),
		Effect.andThen(Effect.sleep(Duration.millis(100))),
		Effect.forever,
	);

export const tail = (ledger: Ledger["Service"], o: TailOptions): Stream.Stream<Row> =>
	Stream.callback<Row>((out) =>
		Effect.gen(function* () {
			const m = o.meter ?? meter();
			const page = o.page ?? 1000;
			const safety = o.safety ?? Duration.seconds(1);
			const bell = yield* Queue.sliding<void>(1);
			const url = `${o.base.replace(/^http/, "ws")}/${o.name}/tail?stream=${encodeURIComponent(o.stream)}`;
			yield* Effect.forkScoped(doorbell(url, Queue.offer(bell, undefined).pipe(Effect.asVoid), m));
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
