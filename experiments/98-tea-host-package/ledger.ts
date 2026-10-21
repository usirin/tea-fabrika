// The runner's handle on a ledger, through the package's exports alone: `layerLocal` starts the
// Durable Object in a Miniflare child (its own process group, the memory cap, the pool), and
// `layerHttp` reaches one already running. Each is held by a ManagedRuntime, so the Promise-shaped
// harness can run the package's Effects on it.
import {Ledger, type Row} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {LocalLedger, layerLocal} from "@kampus/fabrika/local";
import {Duration, Effect, ManagedRuntime} from "effect";
import {GRACE_MS, started} from "./harness.ts";

/** The ledger the hosts use (the laws use their own, `acme-app`). */
export const LEDGER = "tea-host";

export type Handle = Awaited<ReturnType<typeof openLocal>>;

export const openLocal = async (
	persist: string,
	o: {readonly port?: number; readonly capMb?: number; readonly ledger?: string} = {},
) => {
	const t0 = performance.now();
	const rt = ManagedRuntime.make(
		layerLocal({
			persist,
			ledger: o.ledger ?? LEDGER,
			graceMs: GRACE_MS,
			checkEvery: Duration.seconds(1),
			...(o.port === undefined ? {} : {port: o.port}),
			...(o.capMb === undefined ? {} : {capMb: o.capMb}),
		}),
	);
	const local = await rt.runPromise(
		Effect.gen(function* () {
			return yield* LocalLedger;
		}),
	);
	const startMs = Math.round(performance.now() - t0);
	/** The child's group, so the harness kills it on exit whatever happened. */
	const track = async () => {
		const pid = await rt.runPromise(local.pid);
		started.add(pid);
		return pid;
	};
	await track();
	const run = <A, E>(e: Effect.Effect<A, E, Ledger>) => rt.runPromise(e);
	return {
		url: local.url,
		port: local.port,
		startMs,
		run,
		pid: track,
		restarts: () => rt.runPromise(local.restarts),
		memoryMb: () => rt.runPromise(local.memoryMb),
		crash: async () => {
			const r = await rt.runPromise(local.crash);
			await track();
			return r;
		},
		readAll: () => run(readAllOf),
		close: () => rt.dispose(),
	};
};

/** A ledger already running at `url`, over the package's HTTP layer. */
export const connect = (url: string, ledger = LEDGER, maxSockets = 8) => {
	const rt = ManagedRuntime.make(layerHttp({url, ledger, maxSockets}));
	const run = <A, E>(e: Effect.Effect<A, E, Ledger>) => rt.runPromise(e);
	return {run, readAll: () => run(readAllOf), close: () => rt.dispose()};
};

/** Every event in the log, in order, a page at a time. */
export const readAllOf = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const all: Row[] = [];
	for (;;) {
		const page = yield* ledger.read(all.at(-1)?.pos ?? 0, 5000);
		all.push(...page);
		if (page.length < 5000) return all;
	}
});

/** The lease on `name` if it is live now. */
export const liveLease = (name: string) =>
	Effect.gen(function* () {
		const l = yield* (yield* Ledger).lease(name);
		return l !== null && l.expires_at > Date.now() ? l : null;
	});
