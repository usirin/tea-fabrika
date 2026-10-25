// The `Ledger` on a node:sqlite file: the solo ledger, same SQL as the Durable Object (`rules.ts`).
// A pool of worker threads, each with its own connection to the one file, so "50 at once" is real:
// the threads race for SQLite's write lock (experiment 93's law 9).
//
// New in 98: an alarm (a fiber that runs the due jobs every `tickMs`), so leases expire here as
// they do on the Durable Object, and a doorbell: writes made through this layer ring at once;
// writes from another process are seen by a poll every `pollMs`.
//
// `layerSqliteSync` is the same ledger on one connection in the caller's own thread, with no
// worker: for a host bundled into one file, which has no `./sqlite-worker.ts` beside it (the
// fabrika app). Each call blocks that thread while SQLite runs it.
//
// Node at the edge: worker threads (`./sqlite-worker.ts`) and their message ports.
import {Worker} from "node:worker_threads";
import {Deferred, Duration, Effect, Layer, PubSub, Schedule, Stream} from "effect";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf, type WireCall} from "./ledger.ts";
import {MAX_DELIVERIES, RULES} from "./rules.ts";
import {dispatch, isMethod, openDb} from "./sqlite-driver.ts";

/**
 * The file's own driver, past the ledger's rules: for a test that writes a row the way a bad
 * tool or a torn copy would, and checks the ledger refuses to read it. Public since experiment
 * 114, when such a test moved out of this package with the pipeline.
 */
export {openDb};

export interface SqliteOptions {
	readonly path: string;
	/** Connections, each in its own thread. Default 1. */
	readonly threads?: number;
	readonly graceMs?: number;
	readonly tickMs?: number;
	readonly pollMs?: number;
	/** Crashes in a row on one message before it goes to `<name>/dead`; `null`: never. Default 3. */
	readonly maxDeliveries?: number | null;
}

type Answer = {readonly id: number; readonly ok?: unknown; readonly error?: string};
const isAnswer = (m: unknown): m is Answer =>
	typeof m === "object" && m !== null && "id" in m && typeof m.id === "number";

/** The streams a call wrote: its first argument, or (99's calls, the alarm) the `written` it answers. */
const writes = (method: string, args: readonly unknown[], answer: unknown): string[] => {
	if (["register", "append", "claim", "cancel"].includes(method)) return [String(args[0])];
	const list =
		typeof answer === "object" && answer !== null && "written" in answer ? answer.written : answer;
	return Array.isArray(list)
		? list.flatMap((x) => (typeof x === "object" && x && "stream" in x ? [String(x.stream)] : []))
		: [];
};

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
								workerData: {
									path: o.path,
									graceMs: o.graceMs ?? 1000,
									maxDeliveries: o.maxDeliveries === undefined ? MAX_DELIVERIES : o.maxDeliveries,
								},
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
			return yield* served(o, (method, args) =>
				Effect.gen(function* () {
					if (dead !== null) return yield* new LedgerUnreachable({method: "sqlite", message: dead});
					const id = next++;
					const d = yield* Deferred.make<unknown, LedgerUnreachable>();
					waiting.set(id, d);
					workers[id % workers.length]?.postMessage({id, method, args});
					return yield* Deferred.await(d);
				}),
			);
		}),
	);

/** The same `Ledger` on one connection in this thread: no worker, and each call blocks the thread. */
export const layerSqliteSync = (o: Omit<SqliteOptions, "threads">) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const {db} = yield* Effect.acquireRelease(
				Effect.sync(() => openDb(o.path)),
				(opened) => Effect.sync(() => opened.close()),
			);
			const graceMs = o.graceMs ?? 1000;
			const maxDeliveries = o.maxDeliveries === undefined ? MAX_DELIVERIES : o.maxDeliveries;
			return yield* served(o, (method, args) =>
				isMethod(method)
					? Effect.try({
							try: () => dispatch(db, RULES, graceMs, method, args, maxDeliveries),
							catch: (e) =>
								new LedgerUnreachable({
									method: "sqlite",
									message: e instanceof Error ? e.message : String(e),
								}),
						})
					: Effect.fail(new LedgerUnreachable({method: "sqlite", message: `no call ${method}`})),
			);
		}),
	);

/**
 * The service over one way to make a call: the doorbell, which rings for each stream a call
 * wrote, the alarm, and the poll that sees writes from another process.
 */
const served = (o: SqliteOptions, run: WireCall) =>
	Effect.gen(function* () {
		const bell = yield* PubSub.unbounded<string>();
		const call: WireCall = (method, args) =>
			run(method, args).pipe(
				Effect.tap((answer) => PubSub.publishAll(bell, writes(method, args, answer))),
			);
		// The alarm: the due jobs, as the Durable Object's alarm runs them.
		yield* call("runDue", []).pipe(
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
	});
