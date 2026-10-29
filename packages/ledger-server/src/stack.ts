// The ledger server on Cloudflare, declared with Alchemy: one Worker for the project, with the
// ledger's Durable Object bound as `LEDGER`, and the door's bindings from `config.ts`. Experiments
// 144 and 147 deployed this shape; this is it with the shared door in front.
//
//   const stack = ledgerStack({name: "acme-ledger", founder: "github:7"});
//   yield* deploy({stack, stage: "cloud"});   // what waits for the owner: alchemy.run.ts
//
// The Worker is Alchemy's "async Worker": `main` names fabrika's plain module, and Alchemy bundles
// it as it is. No Effect of Alchemy's runs inside Cloudflare. The object is bound by its class
// name, which that module exports, and Alchemy makes the SQLite-backed namespace from it.
//
// - `RemovalPolicy.retain()`: a rename or a destroy leaves the old Worker and its data in place
//   (experiment 147). Putting the old name back takes it back.
// - `Alchemy.localState()`: what was deployed is kept in `.alchemy/` beside the run, never in a
//   state Worker on the account. Never `Alchemy.remote()`: the laptop needs no account.
// - Workers Logs off, as in experiment 144: no log line holds a session token's path.
// - `LEDGER_GITHUB_TOKEN`: a GitHub token, read as a `Redacted` and bound as a secret
//   (`GITHUB_TOKEN`), for the server's own budget of 5,000 calls an hour. Left out, it shares 60
//   an hour with Cloudflare's outgoing address. Alchemy unwraps it only to send it to Cloudflare.
//
// The twin (`twin.ts`) runs the same `LEDGER_ENTRY` with the same `ledgerBindings` in Miniflare.
// This file loads Alchemy, which reads the working folder once as it loads, so no test imports it.
import * as Cloudflare from "@alchemy.run/cloudflare";
import {COMPATIBILITY_DATE, LEDGER_ENTRY, ledgerBindings} from "@kampus/fabrika/local";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import {Config, Effect, Option} from "effect";
import {type ServerConfig, serverDoor} from "./config.ts";

/** The GitHub token, if one is set. Effect's env provider reads an empty one as none. */
const githubToken = Config.option(Config.Redacted("LEDGER_GITHUB_TOKEN"));

export const ledgerStack = (c: ServerConfig) =>
	Alchemy.Stack(
		`fabrika-${c.name}`,
		{providers: Cloudflare.providers(), state: Alchemy.localState()},
		Effect.gen(function* () {
			const token = Option.getOrUndefined(yield* githubToken);
			const worker = yield* Cloudflare.Worker("Ledger", {
				name: c.name,
				main: LEDGER_ENTRY,
				compatibility: {date: COMPATIBILITY_DATE},
				observability: {enabled: false},
				env: {
					LEDGER: Cloudflare.DurableObject("Ledger"),
					JOB_RECORD: Cloudflare.DurableObject("JobRecord"),
					...ledgerBindings({door: serverDoor(c)}),
					...(token === undefined ? {} : {GITHUB_TOKEN: token}),
				},
			}).pipe(RemovalPolicy.retain());
			return {url: worker.url};
		}),
	);
