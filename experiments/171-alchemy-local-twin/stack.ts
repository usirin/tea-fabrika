// Experiment 171: the ledger's Alchemy stack, at its local stage, as the app host's twin.
//
// Two stacks. `ledgerStack` is the real one, imported by name from packages/ledger-server as it
// is: one Worker, `LEDGER` and `JOB_RECORD` Durable Objects, the shared door. `twinStack` is the
// same Worker resource with three changes the app host needs, and nothing else:
//
//   - the local door (one person, a secret) in place of the shared door, from the same
//     `ledgerBindings` both twins use today;
//   - `dev: {host, port, strictPort}`: a fixed port on 127.0.0.1, which fails at once when taken;
//   - `main` either fabrika's source entry (Alchemy bundles it with rolldown), or a file built
//     before (`bundle: false`: Alchemy reads it byte for byte, the way it would upload it).
//
//   const s = twinStack({name: "tf-exp-171", person: "owner", secret, port: 18787, main: {kind: "source"}});
//   yield* deploy({stack: s, stage: "local", dev: true, scope});   // {url: "http://127.0.0.1:18787"}
import * as Cloudflare from "@alchemy.run/cloudflare";
import {COMPATIBILITY_DATE, LEDGER_ENTRY, ledgerBindings} from "@kampus/fabrika/local";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import {Effect, type Redacted} from "effect";

export {ledgerStack} from "@kampus/ledger-server/stack";

export type Main = {readonly kind: "source"} | {readonly kind: "prebuilt"; readonly file: string};

export interface TwinStackOptions {
	readonly name: string;
	readonly person: string;
	readonly secret: Redacted.Redacted<string>;
	readonly port: number;
	readonly main: Main;
}

export const twinStack = (o: TwinStackOptions) =>
	Alchemy.Stack(
		`fabrika-${o.name}`,
		{providers: Cloudflare.providers(), state: Alchemy.localState()},
		Effect.gen(function* () {
			const worker = yield* Cloudflare.Worker("Ledger", {
				name: o.name,
				...(o.main.kind === "source"
					? {main: LEDGER_ENTRY}
					: {main: o.main.file, bundle: false as const}),
				compatibility: {date: COMPATIBILITY_DATE},
				observability: {enabled: false},
				dev: {host: "127.0.0.1", port: o.port, strictPort: true},
				env: {
					LEDGER: Cloudflare.DurableObject("Ledger"),
					JOB_RECORD: Cloudflare.DurableObject("JobRecord"),
					...ledgerBindings({door: {kind: "local", person: o.person, secret: o.secret}}),
				},
			}).pipe(RemovalPolicy.retain());
			return {url: worker.url};
		}),
	);
