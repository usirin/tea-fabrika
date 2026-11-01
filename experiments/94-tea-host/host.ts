// A minimal tea-host: one process that runs the host machine (./host-machine.ts) for one
// registered name, and, while it owns that name, the `counter` tea program under it. OTP's node,
// with the registry, the supervisor and the mailbox for one name and nothing else.
//
//   claim, renew        the machine's two Cmds: calls to the ledger
//   registry_tail Sub   the ledger's tail, read from the current claim on: a claim or a
//                       `lease_expired` on the registry stream becomes a Msg
//   program Sub         on while owning: replay, start the program, feed it the inbox, and say
//                       when it ends. Turned off, it stops the program.
//
// The mailbox is the inbox stream, folded: the first send of a message id is told to the
// program, a later send of the same id is skipped. Rebuilt from the inbox at every start, so a
// host that takes over skips exactly what the one before it skipped.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (this host's name, unique per process start),
// NAME (the registered name), TTL_MS, RENEW_MS, RETRY_MS. One JSON line per event on stdout,
// for the harness. Stops on SIGTERM: its scopes close, and the program stops with them.

import {run} from "@demlik/tea/effect";
import {NodeRuntime} from "@effect/platform-node";
import {offer, start} from "@kampus/fabrika-old";
import {Config, Console, Duration, Effect, Exit, Queue, Schedule, Schema, Stream} from "effect";
import {counterProgram, type Increment, Journal, ZERO} from "./counter.ts";
import {createHost, type Host, type HostMsg} from "./host-machine.ts";
import {Ledger, ledgerLayer, type Row, streams} from "./ledger.ts";
import {lastState, ledgerStore} from "./store.ts";

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
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const ledger = yield* Ledger;
	const S = streams(name);

	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));

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

	const registryTail = Stream.callback<HostMsg>((queue) =>
		Effect.gen(function* () {
			const lease = yield* ledger.lease(S.registry).pipe(Effect.orElseSucceed(() => null));
			let pos = lease === null ? 0 : lease.fence - 1;
			for (;;) {
				const rows = yield* ledger.read(pos, 500).pipe(Effect.orElseSucceed(() => []));
				for (const r of rows) {
					pos = r.pos;
					if (r.stream !== S.registry) continue;
					if (r.kind === "claimed") yield* Queue.offer(queue, {type: "seen_claim", fence: r.pos});
					const fence = r.kind === "lease_expired" ? expiredFence(r) : null;
					if (fence !== null) yield* Queue.offer(queue, {type: "seen_expiry", fence});
				}
				if (rows.length < 500) yield* Effect.sleep(Duration.millis(25));
			}
		}),
	);

	// ------------------------------------------------------------ the program, while owning

	const program = (fence: number) =>
		Stream.callback<HostMsg>((queue) =>
			Effect.gen(function* () {
				const t0 = Date.now();
				// Replay: the last state saved under any fence, then the inbox, folded to the same
				// mailbox every owner before this one had.
				// A ledger that does not answer is waited for: the lease, not this read, says
				// whether this host still owns the name.
				const again = <A, E>(read: Effect.Effect<A, E>) =>
					read.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
				const saved = lastState(yield* again(ledger.readStream(S.registry))).state ?? ZERO;
				const inbox = yield* again(ledger.readStream(S.inbox));
				const seen = new Set<string>();
				const backlog: Increment[] = [];
				let skipped = 0;
				let lastRev = 0;
				let pos = 0;
				const fold = (r: Row) => {
					pos = Math.max(pos, r.pos);
					lastRev = r.rev;
					const id = idOf(r);
					if (id === null) return null;
					if (seen.has(id)) {
						skipped++;
						return null;
					}
					seen.add(id);
					return r.rev > saved.cursor ? {id, rev: r.rev} : null;
				};
				for (const r of inbox) {
					const told = fold(r);
					if (told !== null) backlog.push(told);
				}
				const store = ledgerStore(ledger, {
					stream: S.registry,
					fence,
					holder,
					note: (n) => Effect.runSync(line(n)),
				});
				// A failure with no caller: logged, and the host goes on. Without this sink tea
				// throws it on a timer and the whole host process dies (seen in the first run).
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
					backlog: backlog.length,
					skipped,
					replayMs: Date.now() - t0,
				});
				yield* Queue.offer(queue, {type: "program_started", fence});

				const tell = (inc: Increment) =>
					offer(started.run, "inc", inc).pipe(
						Effect.flatMap((word) =>
							word === "queued" ? Effect.void : Effect.die(`the counter's inbox said ${word}`),
						),
					);
				const feed = Effect.gen(function* () {
					for (const inc of backlog) yield* tell(inc);
					for (;;) {
						const rows = yield* ledger.read(pos, 1000).pipe(Effect.orElseSucceed(() => []));
						for (const r of rows) {
							if (r.stream !== S.inbox || r.rev <= lastRev) {
								pos = r.pos;
								continue;
							}
							const told = fold(r);
							if (told !== null) yield* tell(told);
						}
						if (rows.length < 1000) yield* Effect.sleep(Duration.millis(5));
					}
				});
				yield* Effect.forkScoped(feed);

				const ended = yield* started.run.ended;
				yield* line({
					ev: "program",
					phase: "ended",
					fence,
					how: ended.kind,
					skipped,
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
	// A pause detector: a 100 ms tick that finds a far longer gap was frozen (SIGSTOP here; a long
	// GC pause or a closed laptop lid elsewhere) and says so. It decides nothing: the lease does.
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
	return yield* Effect.never;
}).pipe(Effect.scoped);

const LEDGER_URL = Config.String("LEDGER_URL");
const LEDGER_NAME = Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host"));

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = ledgerLayer(yield* LEDGER_URL, yield* LEDGER_NAME);
		return yield* main.pipe(Effect.provide(layer));
	}),
);
