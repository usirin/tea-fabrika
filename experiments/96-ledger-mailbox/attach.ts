// Copied from experiments/94-tea-host/attach.ts. What changed: the lease is on the name itself and
// the count is the last event of `<name>/state`, read with `readLast`, not the whole registry.
//
// Attach, read-only: who runs a registered name, under which fence, and its count now. It runs no
// program and writes nothing. Config (env): LEDGER_URL, LEDGER_NAME, NAME. Prints one JSON line.
import {NodeRuntime} from "@effect/platform-node";
import {Config, Console, Effect} from "effect";
import {Ledger, ledgerLayer, streams} from "./service.ts";
import {lastState} from "./store.ts";

const main = Effect.gen(function* () {
	const name = yield* Config.String("NAME").pipe(Config.withDefault("counter:1"));
	const ledger = yield* Ledger;
	const S = streams(name);
	const lease = yield* ledger.lease(S.registry);
	const {state} = lastState(yield* ledger.readLast(S.state, 1));
	const now = Date.now();
	const live = lease !== null && lease.expires_at > now;
	const who = lease === null ? "nobody" : lease.holder;
	const line = live
		? `${name}: held by ${who}, fence ${lease.fence}, ${lease.expires_at - now} ms left; count ${state?.count ?? 0}`
		: `${name}: not held (last ${who}); count ${state?.count ?? 0}`;
	yield* Console.log(
		JSON.stringify({
			at: now,
			holder: live ? who : null,
			fence: live ? lease.fence : null,
			msLeft: live ? lease.expires_at - now : null,
			count: state?.count ?? 0,
			line,
		}),
	);
});

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = ledgerLayer(
			yield* Config.String("LEDGER_URL"),
			yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
			1,
		);
		return yield* main.pipe(Effect.provide(layer));
	}),
);
