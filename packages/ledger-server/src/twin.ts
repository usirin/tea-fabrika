// The ledger server's local twin: the same Worker and Durable Object as the deploy
// (`LEDGER_ENTRY`), with the same bindings (`ledgerBindings` of `serverDoor`), in Miniflare on this
// laptop. Tests and the demo run on it; nothing here needs an account or leaves 127.0.0.1, except
// the door's own calls to GitHub, which a test sends to a fake (`github`).
//
//   const twin = yield* startTwin({config: {name: "acme-ledger", founder: "github:7"}, persist: false});
//   twin.url   // http://127.0.0.1:<port>: the address `fabrika connect <url>/acme` names
//
// Why Miniflare and not `alchemy dev` of `stack.ts`: a test must answer the Worker's calls to
// GitHub with a fake, and only Miniflare's `outboundService` does that; and Alchemy reads the
// working folder once as it loads, so a test process cannot hold it. What the twin cannot show is
// in the README.
import {ledgerOptions} from "@kampus/fabrika-old/local";
import {Effect, Schema} from "effect";
import {Miniflare} from "miniflare";
import {type ServerConfig, serverDoor} from "./config.ts";

export class TwinError extends Schema.TaggedError<TwinError>()("TwinError", {
	message: Schema.String,
}) {}

export interface TwinOptions {
	readonly config: ServerConfig;
	/** The Durable Object's data folder, or `false`: in memory. */
	readonly persist: string | false;
	/** The port on 127.0.0.1. Left out: a free one. */
	readonly port?: number;
	/** Where the Worker's calls to api.github.com go instead: a fake, in a test. Left out: GitHub. */
	readonly github?: (req: Request) => Promise<Response>;
	/** How long GitHub's answers are kept, in ms. Left out: the server's own default. */
	readonly cacheMs?: number;
}

/** The twin, running until the scope closes: its base URL. */
export const startTwin = (o: TwinOptions) =>
	Effect.gen(function* () {
		const door = serverDoor(o.config);
		const mf = yield* Effect.acquireRelease(
			Effect.tryPromise({
				try: async () => {
					const m = new Miniflare(
						ledgerOptions({
							persist: o.persist,
							direct: o.port ?? 0,
							door: {
								...door,
								keys: {
									...door.keys,
									...(o.github === undefined ? {} : {api: o.github}),
									...(o.cacheMs === undefined ? {} : {cacheMs: o.cacheMs, failMs: 0}),
								},
							},
						}),
					);
					await m.ready;
					return m;
				},
				catch: (e) => new TwinError({message: `the twin did not start: ${String(e)}`}),
			}),
			(m) => Effect.promise(() => m.dispose()),
		);
		const direct = yield* Effect.tryPromise({
			try: () => mf.unsafeGetDirectURL(),
			catch: (e) => new TwinError({message: `the twin has no address: ${String(e)}`}),
		});
		return {url: direct.origin};
	});
