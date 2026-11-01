// One counter host: `serve` from the package, nothing else. Experiment 97's counter host
// (../97-one-ledger/counter-host.ts) was 200 lines of claim, renew, registry tail, replay, journal
// and error sink around 94's host machine; all of that is the package's now.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (this host's name, unique per process start), NAME
// (the registered name), TTL_MS, RENEW_MS, RETRY_MS. One JSON line per host event on stdout, for
// the harness, and every second what its tails read. Stops on SIGTERM: its scope closes, and the
// program stops with it.

import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, meter, serve} from "@kampus/fabrika-old";
import {layerHttp} from "@kampus/fabrika-old/http";
import {Config, Console, Duration, Effect} from "effect";
import {counterProgram} from "./counter.ts";

const main = Effect.gen(function* () {
	const holder = yield* Config.String("HOST");
	const name = yield* Config.String("NAME").pipe(Config.withDefault("counter:1"));
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const listen = (e: HostEvent) => Effect.runSync(line(e));
	const meters = {registry: meter(), inbox: meter()};

	yield* serve({
		name,
		holder,
		program: counterProgram,
		ttlMs,
		renewEveryMs,
		retryMs,
		listen,
		meters,
	});
	yield* line({ev: "started", pid: process.pid});
	// 94's pause detector: says when the process was frozen, and decides nothing.
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
	yield* Effect.sleep(Duration.seconds(1)).pipe(
		Effect.andThen(() => line({ev: "reads", ...meters})),
		Effect.forever,
		Effect.forkScoped,
	);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		});
		return yield* main.pipe(Effect.provide(layer));
	}),
);
