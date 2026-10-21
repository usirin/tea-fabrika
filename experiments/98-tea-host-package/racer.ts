// One "host" for law 8: a separate Node process that races claims on the package's `Ledger`
// over HTTP. Experiment 93's racer (../93-ledger/racer.ts) on the package: the names are
// registered by the runner first, and every answer is a word (`ok`, or the refusal's tag).
//
// Env: BASE (the ledger's URL), LEDGER (its name), STREAMS (the names, comma list), PER (claims
// per name), START_AT (the wall-clock ms to fire at), WHO (this host's name), INFLIGHT (requests
// open at once; also the pool's size). Prints one JSON line: the names it won, and every answer
// counted.

import {NodeRuntime} from "@effect/platform-node";
import {Ledger} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Config, Console, Duration, Effect} from "effect";

const main = Effect.gen(function* () {
	const names = (yield* Config.String("STREAMS")).split(",");
	const per = yield* Config.Number("PER").pipe(Config.withDefault(10));
	const who = yield* Config.String("WHO");
	const inflight = yield* Config.Number("INFLIGHT").pipe(Config.withDefault(32));
	const startAt = yield* Config.Number("START_AT");
	const ledger = yield* Ledger;
	const jobs = names.flatMap((s) => Array.from({length: per}, (_, i) => ({s, i})));
	yield* Effect.sleep(Duration.millis(Math.max(0, startAt - Date.now())));
	const out = yield* Effect.forEach(
		jobs,
		({s, i}) =>
			ledger.claim(s, `${who}-${i}`, 1, 60_000).pipe(
				Effect.result,
				Effect.map((r) => ({s, r: r._tag === "Success" ? "ok" : r.failure._tag})),
			),
		{concurrency: inflight},
	);
	const counts: Record<string, number> = {};
	for (const o of out) counts[o.r] = (counts[o.r] ?? 0) + 1;
	const won = out.filter((o) => o.r === "ok").map((o) => o.s);
	yield* Console.log(JSON.stringify({who, won, counts}));
});

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = layerHttp({
			url: yield* Config.String("BASE"),
			ledger: yield* Config.String("LEDGER"),
			maxSockets: yield* Config.Number("INFLIGHT").pipe(Config.withDefault(32)),
		});
		return yield* main.pipe(Effect.provide(layer));
	}),
);
