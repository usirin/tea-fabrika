// Experiment 248 spike, next/. Question 5's other half: both objects resolve each other in the
// outer (init) Effect. phoenix decision 0033 saw the build run out of memory on beta.44.
import * as Cloudflare from "@alchemy.run/cloudflare";
import {Effect, Layer} from "effect";
import {HttpServerResponse} from "effect/http";
import {Ping, Pong} from "./objects.ts";

export class Eager extends Cloudflare.Worker<Eager, {}>()("Eager") {}

const EagerPing = Ping.make(
	Effect.gen(function* () {
		const pongs = yield* Pong; // eager
		return Effect.succeed({
			hit: (n: number) => pongs.getByName("one").back(n + 1),
			leaf: (n: number) => Effect.succeed({path: ["ping.leaf"], n: n + 1}),
			crossing: () => Effect.succeed({}),
		});
	}),
);

const EagerPong = Pong.make(
	Effect.gen(function* () {
		const pings = yield* Ping; // eager
		return Effect.succeed({
			back: (n: number) => pings.getByName("two").leaf(n + 1),
		} as never);
	}),
);

export const eagerLayers = Layer.mergeAll(EagerPing, EagerPong);

export default Eager.make(
	{
		main: import.meta.url,
		compatibility: {date: "2026-10-12"},
		observability: {enabled: false},
		dev: {host: "127.0.0.1", port: Number(process.env.SPIKE_PORT ?? 18931), strictPort: true},
	},
	Effect.gen(function* () {
		const pings = yield* Ping;
		return {
			fetch: Effect.gen(function* () {
				const exit = yield* pings.getByName("start").hit(0).pipe(Effect.exit);
				return yield* HttpServerResponse.json({exit: String(exit)});
			}).pipe(Effect.orDie),
		};
	}).pipe(Effect.provide(eagerLayers)),
);
