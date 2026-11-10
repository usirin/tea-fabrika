// Experiment 248 spike, next/. The probe Worker in Alchemy's Effect form. Never merged.
import * as Cloudflare from "@alchemy.run/cloudflare";
import {Effect, Layer} from "effect";
import {HttpServerRequest, HttpServerResponse} from "effect/http";
import {Probe, ProbeLive} from "./ledger-probe.ts";
import {Ping, PingLive, Pong, PongLive, Sock, SockLive, Store, StoreLive} from "./objects.ts";

export class Spike extends Cloudflare.Worker<Spike, {}>()("Spike") {}

export const impl = Effect.gen(function* () {
	const stores = yield* Store,
		socks = yield* Sock,
		pings = yield* Ping,
		pongs = yield* Pong,
		probes = yield* Probe;
	const spaces: Record<string, {getByName: (name: string) => unknown}> = {
		store: stores,
		sock: socks,
		ping: pings,
		pong: pongs,
		probe: probes,
	};
	return {
		fetch: Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const url = new URL(request.url, "http://spike");

			if (url.pathname === "/plain") {
				return yield* HttpServerResponse.json({plain: true});
			}

			if (url.pathname === "/ws") {
				return yield* socks.getByName("room").fetch(request);
			}

			const q = (yield* request.json) as {
				object: string;
				name: string;
				method: string;
				args: ReadonlyArray<unknown>;
			};
			const stub = spaces[q.object]!.getByName(q.name) as Record<
				string,
				(...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>
			>;
			const exit = yield* stub[q.method]!(...q.args).pipe(Effect.exit);
			return yield* HttpServerResponse.json(
				exit._tag === "Success" ? {value: exit.value ?? null} : {error: String(exit.cause)},
			);
		}).pipe(Effect.orDie),
	};
});

export const Objects = Layer.mergeAll(StoreLive, SockLive, PingLive, PongLive, ProbeLive);

export default Spike.make(
	{
		main: import.meta.url,
		compatibility: {date: "2026-10-12"},
		observability: {enabled: false},
		dev: {host: "127.0.0.1", port: Number(process.env.SPIKE_PORT ?? 18931), strictPort: true},
	},
	impl.pipe(Effect.provide(Objects)),
);
