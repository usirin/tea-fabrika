// The `Ledger` on a node:sqlite file: the solo ledger, same SQL as the Durable Object (`rules.ts`).
// A pool of worker threads, each with its own connection to the one file, so "50 at once" is real:
// the threads race for SQLite's write lock (experiment 93's law 9).
//
// New in 98: an alarm (a fiber that runs the due jobs every `tickMs`), so leases expire here as
// they do on the Durable Object, and a doorbell: writes made through this layer ring at once;
// writes from another process are seen by a poll every `pollMs`.
//
// Node at the edge: worker threads (`./sqlite-worker.ts`) and their message ports.
import {Worker} from "node:worker_threads";
import {Deferred, Duration, Effect, Layer, PubSub, Schedule, Stream} from "effect";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf} from "./ledger.ts";
import {openDb} from "./sqlite-driver.ts";

export interface SqliteOptions {
	readonly path: string;
	/** Connections, each in its own thread. Default 1. */
	readonly threads?: number;
	readonly graceMs?: number;
	readonly tickMs?: number;
	readonly pollMs?: number;
}

type Answer = {readonly id: number; readonly ok?: unknown; readonly error?: string};
const isAnswer = (m: unknown): m is Answer =>
	typeof m === "object" && m !== null && "id" in m && typeof m.id === "number";

/** The streams a call writes, if it is a write: what its ring says moved. */
const writes = (method: string, args: readonly unknown[]): string | null =>
	["register", "append", "claim", "cancel"].includes(method) ? String(args[0]) : null;

export const layerSqlite = (o: SqliteOptions) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			// One connection first, so the threads do not race to run the migrations.
			yield* Effect.sync(() => openDb(o.path).close());
			const workers = yield* Effect.acquireRelease(
				Effect.sync(() =>
					Array.from(
						{length: o.threads ?? 1},
						() =>
							new Worker(new URL("./sqlite-worker.ts", import.meta.url), {
								workerData: {path: o.path, graceMs: o.graceMs ?? 1000},
							}),
					),
				),
				(ws) =>
					Effect.tryPromise({
						try: () => Promise.all(ws.map((w) => w.terminate())),
						catch: (e) => new LedgerUnreachable({method: "close", message: String(e)}),
					}).pipe(Effect.ignore),
			);
			const waiting = new Map<number, Deferred.Deferred<unknown, LedgerUnreachable>>();
			// A thread that dies answers nothing again: every call waiting, and every call after, fails.
			let dead: string | null = null;
			for (const w of workers) {
				w.on("error", (e) => {
					dead = e.message;
					for (const d of waiting.values())
						Deferred.doneUnsafe(
							d,
							Effect.fail(new LedgerUnreachable({method: "sqlite", message: e.message})),
						);
					waiting.clear();
				});
				w.on("message", (m: unknown) => {
					if (!isAnswer(m)) return;
					const d = waiting.get(m.id);
					waiting.delete(m.id);
					if (d === undefined) return;
					Deferred.doneUnsafe(
						d,
						m.error === undefined
							? Effect.succeed(m.ok)
							: Effect.fail(new LedgerUnreachable({method: "sqlite", message: m.error})),
					);
				});
			}
			let next = 0;
			const bell = yield* PubSub.unbounded<string>();
			const call = (method: string, args: readonly unknown[]) =>
				Effect.gen(function* () {
					if (dead !== null) return yield* new LedgerUnreachable({method: "sqlite", message: dead});
					const id = next++;
					const d = yield* Deferred.make<unknown, LedgerUnreachable>();
					waiting.set(id, d);
					workers[id % workers.length]?.postMessage({id, method, args});
					const answer = yield* Deferred.await(d);
					const wrote = writes(method, args);
					if (wrote !== null) yield* PubSub.publish(bell, wrote);
					return answer;
				});
			// The alarm: the due jobs, as the Durable Object's alarm runs them.
			yield* call("runDue", []).pipe(
				Effect.flatMap((w) =>
					Array.isArray(w)
						? PubSub.publishAll(
								bell,
								w.flatMap((x) =>
									typeof x === "object" && x && "stream" in x ? [String(x.stream)] : [],
								),
							)
						: Effect.void,
				),
				Effect.ignore,
				Effect.repeat(Schedule.spaced(Duration.millis(o.tickMs ?? 25))),
				Effect.forkScoped,
			);
			const poll = Stream.tick(Duration.millis(o.pollMs ?? 250));
			const watch: Raw["watch"] = (stream) =>
				Stream.merge(
					Stream.fromPubSub(bell).pipe(
						Stream.filter((s) => s === stream),
						Stream.map(() => undefined),
					),
					poll,
				);
			return fromRaw(rawOf(call, watch));
		}),
	);
