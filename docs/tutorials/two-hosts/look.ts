// Look without touching: who holds each name, and its last saved state. Writes nothing.
import {NodeRuntime} from "@effect/platform-node";
import {getState, whereis} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Console, Effect, type Schema} from "effect";
import {Glass, Kettle} from "./programs.ts";

const show = <S>(name: string, schema: Schema.Codec<S, unknown>) =>
	Effect.gen(function* () {
		const w = yield* whereis(name);
		const {state} = yield* getState(name, schema);
		const who = w.live ? `held by ${w.holder}, fence ${w.fence}` : "free";
		yield* Console.log(`${name.padEnd(6)}  ${who}\n        ${JSON.stringify(state)}`);
	});

NodeRuntime.runMain(
	// One after the other, so the kettle always prints first.
	Effect.all([show("kettle", Kettle), show("glass", Glass)], {concurrency: 1}).pipe(
		Effect.provide(layerHttp({url: "http://127.0.0.1:8790", ledger: "teahouse"})),
	),
);
