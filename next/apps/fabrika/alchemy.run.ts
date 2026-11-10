import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import {Context, Effect, Layer} from "effect";
import type {Built} from "./src/build.ts";
import type {Settings} from "./src/settings.ts";

export const stack = (
	built: Built,
	settings: Settings,
	local: Context.Context<never> = Context.empty(),
) =>
	Alchemy.Stack(
		"fabrika",
		{
			providers: Cloudflare.providers().pipe(Layer.provide(Layer.succeedContext(local))),
			state: Alchemy.localState(),
		},
		Effect.gen(function* () {
			const health = yield* Cloudflare.R2.Bucket("Health", {
				name: "fabrika-health",
				lifecycleRules: [],
				locks: [],
			});
			const brain = yield* Cloudflare.Workers.Worker("Brain", {
				name: settings.name,
				main: built.brain,
				bundle: false,
				compatibility: {date: "2026-10-12"},
				observability: {enabled: false},
				dev: {host: "127.0.0.1", port: settings.port, strictPort: true},
				env: {
					PROJECT: Cloudflare.DurableObject("Project"),
					PROCESS: Cloudflare.DurableObject("Process"),
					GATEWAY: Cloudflare.DurableObject("Gateway"),
					RECORD: Cloudflare.DurableObject("RecordPart"),
					// Spike (experiment 248): Alchemy's runtime finds a hosted class at env[<class name>].
					RecordPart: Cloudflare.DurableObject("RecordPart"),
					LOADER: Cloudflare.WorkerLoader(),
					HEALTH: health,
					STAGE: SchemaEncode(settings),
				},
			});
			return {url: brain.url};
		}),
	);

const SchemaEncode = (value: Settings) => JSON.stringify(value);
