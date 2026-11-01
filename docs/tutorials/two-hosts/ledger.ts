// The ledger: one Durable Object, run locally in Miniflare. Every host talks to it.
import {NodeRuntime} from "@effect/platform-node";
import {Ledger} from "@kampus/fabrika-old";
import {LocalLedger, layerLocal} from "@kampus/fabrika-old/local";
import {Console, Effect} from "effect";

const main = Effect.gen(function* () {
	const local = yield* LocalLedger;
	const ledger = yield* Ledger;
	// Deny by default: nothing is written under a name until it is registered.
	yield* ledger.register("kettle", "setup");
	yield* ledger.register("glass", "setup");
	yield* Console.log(`ledger up at ${local.url}  (names: kettle, glass)`);
	return yield* Effect.never;
});

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerLocal({persist: ".teahouse", ledger: "teahouse", port: 8790}))),
);
