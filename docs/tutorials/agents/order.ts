// Order lines for guests, from outside any host.
import {NodeRuntime} from "@effect/platform-node";
import {cast} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Console, Effect} from "effect";

const guests = ["Ayşe", "Deniz", "Emre", "Selin", "Mert", "Zeynep", "Can", "Elif"];
const round = Date.now().toString(36);

const main = Effect.gen(function* () {
	for (const [i, guest] of guests.entries()) {
		const id = `${round}-${i + 1}`;
		const r = yield* cast("poet", id, {id, guest}, "counter");
		yield* Console.log(`order ${i + 1}  ${guest.padEnd(6)}  ${r.how}`);
	}
});

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerHttp({url: "http://127.0.0.1:8790", ledger: "teahouse"}))),
);
