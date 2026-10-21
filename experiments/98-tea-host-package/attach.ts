// Attach, read-only, on the package's observer: who holds a registered name (Erlang's `whereis`),
// under which fence, and its last saved state (`sys:get_state`). It runs no program, holds no
// lease and writes nothing. Experiment 97's attach (../97-one-ledger/attach.ts), in two calls.
//
// Config (env): LEDGER_URL, LEDGER_NAME, NAME. Prints one JSON line.

import {NodeRuntime} from "@effect/platform-node";
import {getState, whereis} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Config, Console, Effect} from "effect";
import {Count} from "../94-tea-host/counter.ts";

const main = Effect.gen(function* () {
	const name = yield* Config.String("NAME").pipe(Config.withDefault("counter:1"));
	const w = yield* whereis(name);
	const s = yield* getState(name, Count);
	const now = Date.now();
	const count = s.state?.count ?? 0;
	const line = !w.registered
		? `${name}: nobody registered it`
		: w.live
			? `${name}: held by ${w.holder}, fence ${w.fence}, ${(w.expiresAt ?? now) - now} ms left; count ${count}`
			: `${name}: not held (last ${w.holder ?? "nobody"}); count ${count}`;
	yield* Console.log(
		JSON.stringify({
			at: now,
			registered: w.registered,
			holder: w.live ? w.holder : null,
			fence: w.live ? w.fence : null,
			msLeft: w.live ? (w.expiresAt ?? now) - now : null,
			count,
			savedBy: s.savedBy,
			line,
		}),
	);
});

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
			maxSockets: 1,
		});
		return yield* main.pipe(Effect.provide(layer));
	}),
);
