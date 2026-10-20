// Copied from experiments/94-tea-host/host.ts. What changed, all in how the host uses the ledger;
// the host machine and the counter are 94's, unchanged:
//
//   - The lease is on the name itself (`counter:1`), and the program's streams sit under it
//     (`counter:1/state`, `counter:1/inbox`), guarded by its fence.
//   - The registry tail follows only the name's stream, a live tail (./tail.ts): it reads that
//     one stream from its cursor when the ledger wakes it. 94 read the whole log every 25 ms.
//   - The program's feed is a live tail of the inbox from the saved cursor. Replay is: the last
//     saved state (`readLast`), then the inbox after its cursor. No set of seen ids: the ledger
//     keeps one event per message id, so the inbox has no repeats to skip.
//   - Every second the host prints what its tails read (`ev: "reads"`), for the harness.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (this host's name, unique per process start),
// NAME (the registered name), TTL_MS, RENEW_MS, RETRY_MS. One JSON line per event on stdout, for
// the harness. Stops on SIGTERM: its scopes close, and the program stops with them.

import {run} from "@demlik/tea/effect";
import {NodeRuntime} from "@effect/platform-node";
import {Config, Console, Duration, Effect, Exit, Queue, Schedule, Schema, Stream} from "effect";
import {offer, start} from "../../packages/tea-program/src/program.ts";
import {counterProgram, type Increment, Journal, ZERO} from "../94-tea-host/counter.ts";
import {createHost, type Host, type HostMsg} from "../94-tea-host/host-machine.ts";
import {Ledger, ledgerLayer, type Row, streams} from "./service.ts";
import {lastState, ledgerStore} from "./store.ts";
import {meter, tail} from "./tail.ts";

const Sent = Schema.Struct({id: Schema.String});
const idOf = (r: Row): string | null => {
	const exit = Schema.decodeUnknownExit(Schema.fromJsonString(Sent))(r.data);
	return Exit.isSuccess(exit) ? exit.value.id : null;
};
const Expired = Schema.Struct({fence: Schema.Number});
const expiredFence = (r: Row): number | null => {
	const exit = Schema.decodeUnknownExit(Schema.fromJsonString(Expired))(r.data);
	return Exit.isSuccess(exit) ? exit.value.fence : null;
};

const main = Effect.gen(function* () {
	const holder = yield* Config.String("HOST");
	const name = yield* Config.String("NAME").pipe(Config.withDefault("counter:1"));
	const base = yield* Config.String("LEDGER_URL");
	const ledgerName = yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host"));
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const ledger = yield* Ledger;
	const S = streams(name);

	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));

	// What the tails read, for the harness: the registry's, and the inbox's (summed over runs).
	const reads = {registry: meter(), inbox: meter(), replay: {reads: 0, events: 0, bytes: 0}};

	// ------------------------------------------------------------ the two Cmds

	/** The registry stream's rev as last seen: a claim must name it, and a stale answer gives the new one. */
	let rev = 0;
	const claim = Effect.gen(function* () {
		for (let tries = 0; tries < 10; tries++) {
			const r = yield* ledger.claim(S.registry, holder, rev, ttlMs);
			if (r.ok) {
				rev = r.rev;
				yield* line({ev: "claimed", fence: r.fence, expiresAt: r.expiresAt});
				return {type: "claimed", fence: r.fence} satisfies HostMsg;
			}
			if (r.why === "held")
				return {type: "held", waitMs: Math.max(0, r.expiresAt - Date.now()) + 1} satisfies HostMsg;
			rev = r.rev;
		}
		return {type: "claim_failed"} satisfies HostMsg;
	}).pipe(Effect.orElseSucceed((): HostMsg => ({type: "claim_failed"})));

	const renew = (fence: number) =>
		ledger.renew(S.registry, fence, ttlMs).pipe(
			Effect.map((r): HostMsg => (r.ok ? {type: "renewed", fence} : {type: "renew_lost", fence})),
			Effect.orElseSucceed((): HostMsg => ({type: "renew_unknown", fence})),
			Effect.tap((m) =>
				m.type === "renewed" ? Effect.void : line({ev: "renew", fence, answer: m.type}),
			),
		);

	// ------------------------------------------------------------ the registry tail

	// From the current claim on (or from the stream's end when nobody holds it): the name's stream
	// holds only claims, expiries and cancels, so this is a handful of events a run.
	const registryTail = Stream.unwrap(
		Effect.gen(function* () {
			const lease = yield* ledger.lease(S.registry).pipe(Effect.orElseSucceed(() => null));
			const rows = yield* ledger.readStream(S.registry).pipe(Effect.orElseSucceed(() => []));
			reads.registry.reads++;
			reads.registry.events += rows.length;
			reads.registry.bytes += JSON.stringify(rows).length;
			const claimRow = lease === null ? undefined : rows.find((r) => r.pos === lease.fence);
			const fromRev = claimRow === undefined ? (rows.at(-1)?.rev ?? 0) : claimRow.rev - 1;
			return tail(ledger, {
				base,
				name: ledgerName,
				stream: S.registry,
				fromRev,
				meter: reads.registry,
			});
		}),
	).pipe(
		Stream.flatMap((r): Stream.Stream<HostMsg> => {
			if (r.kind === "claimed") return Stream.make({type: "seen_claim", fence: r.pos});
			const fence = r.kind === "lease_expired" ? expiredFence(r) : null;
			return fence === null ? Stream.empty : Stream.make({type: "seen_expiry", fence});
		}),
	);

	// ------------------------------------------------------------ the program, while owning

	const program = (fence: number) =>
		Stream.callback<HostMsg>((queue) =>
			Effect.gen(function* () {
				const t0 = Date.now();
				// Replay: the last state saved under any fence, then the inbox after its cursor.
				// A ledger that does not answer is waited for: the lease, not this read, says
				// whether this host still owns the name.
				const again = <A, E>(read: Effect.Effect<A, E>) =>
					read.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
				const last = yield* again(ledger.readLast(S.state, 1));
				const inboxEnd = yield* again(ledger.readLast(S.inbox, 1));
				reads.replay.reads += 2;
				reads.replay.events += last.length + inboxEnd.length;
				reads.replay.bytes += JSON.stringify(last).length + JSON.stringify(inboxEnd).length;
				const saved = lastState(last).state ?? ZERO;
				const backlog = Math.max(0, (inboxEnd.at(-1)?.rev ?? 0) - saved.cursor);
				const store = ledgerStore(ledger, {
					stream: S.state,
					fence,
					holder,
					note: (n) => Effect.runSync(line(n)),
				});
				// A failure with no caller: logged, and the host goes on (94: without this sink tea
				// throws it on a timer and the whole host process dies).
				const onError = (error: unknown, context: {readonly phase: string}) =>
					Effect.runSync(
						line({
							ev: "tea_error",
							fence,
							phase: context.phase,
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				const started = yield* start(counterProgram, {}, {}, {id: name}).pipe(
					Effect.provideService(Journal, {store, onError}),
				);
				if (started.kind !== "running") return yield* Effect.die(`counter refused: ${started.why}`);
				yield* line({
					ev: "program",
					phase: "started",
					fence,
					count: saved.count,
					cursor: saved.cursor,
					backlog,
					replayMs: Date.now() - t0,
				});
				yield* Queue.offer(queue, {type: "program_started", fence});

				const tell = (inc: Increment) =>
					offer(started.run, "inc", inc).pipe(
						Effect.flatMap((word) =>
							word === "queued" ? Effect.void : Effect.die(`the counter's inbox said ${word}`),
						),
					);
				const feed = tail(ledger, {
					base,
					name: ledgerName,
					stream: S.inbox,
					fromRev: saved.cursor,
					meter: reads.inbox,
				}).pipe(
					Stream.runForEach((r) => {
						const id = idOf(r);
						return id === null ? Effect.void : tell({id, rev: r.rev});
					}),
				);
				yield* Effect.forkScoped(feed);

				const ended = yield* started.run.ended;
				yield* line({
					ev: "program",
					phase: "ended",
					fence,
					how: ended.kind,
					why: ended.kind === "failed" ? String(ended.cause).slice(0, 300) : null,
				});
				yield* Queue.offer(queue, {type: "program_ended", fence, how: ended.kind});
				return yield* Effect.never;
			}).pipe(Effect.onInterrupt(() => line({ev: "program", phase: "stopped", fence}))),
		);

	// ------------------------------------------------------------ the machine

	const machine = createHost({renewEveryMs, retryMs});
	const handle = yield* run(machine, {
		ctx: undefined,
		interpret: {claim: () => claim, renew: (cmd) => renew(cmd.fence)},
		subscribe: {
			registry_tail: () => registryTail,
			program: (sub) => program(sub.deps.fence),
		},
	});
	const host = yield* handle.ready;
	let was: Host = host.getState();
	host.observe((msg, now) => {
		if (now.phase !== was.phase && (now.phase === "owning" || was.phase === "owning"))
			Effect.runSync(
				line({
					ev: "phase",
					from: was.phase,
					to: now.phase,
					fence: now.phase === "owning" ? now.fence : was.phase === "owning" ? was.fence : null,
					by: msg.type,
				}),
			);
		was = now;
	});
	yield* line({ev: "up", pid: process.pid, ttlMs, renewEveryMs});
	// A pause detector, as in 94: it says when the process was frozen, and decides nothing.
	let last = Date.now();
	yield* Effect.sleep(Duration.millis(100)).pipe(
		Effect.andThen(() => {
			const now = Date.now();
			const gap = now - last;
			last = now;
			return gap > 600 ? line({ev: "paused", ms: gap - 100}) : Effect.void;
		}),
		Effect.forever,
		Effect.forkScoped,
	);
	// What the tails read so far, every second: the harness keeps the last line of each host.
	yield* Effect.sleep(Duration.seconds(1)).pipe(
		Effect.andThen(() => line({ev: "reads", ...reads})),
		Effect.forever,
		Effect.forkScoped,
	);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = ledgerLayer(
			yield* Config.String("LEDGER_URL"),
			yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		);
		return yield* main.pipe(Effect.provide(layer));
	}),
);
