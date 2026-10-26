// Order tea from outside any host: `cast` puts one message in the kettle's inbox.
import {NodeRuntime} from "@effect/platform-node";
import {cast} from "@kampus/fabrika";
import {layerAttach} from "@kampus/fabrika/local";
import {Console, Duration, Effect} from "effect";

const guests = ["Ayşe", "Deniz", "Emre", "Selin", "Mert"];
const count = Number(process.argv[2] ?? "30");
const round = Date.now().toString(36);

const main = Effect.gen(function* () {
	for (let i = 1; i <= count; i++) {
		const id = `${round}-${i}`;
		const guest = guests[i % guests.length] ?? "guest";
		const r = yield* cast("kettle", id, {id, guest}, "counter");
		yield* Console.log(`order ${String(i).padStart(2)}  ${guest.padEnd(5)}  ${r.how}`);
		yield* Effect.sleep(Duration.millis(400));
	}
});

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerAttach({persist: ".teahouse", ledger: "teahouse", port: 8790}))),
);
