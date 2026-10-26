// Experiment 147's ledger server: experiment 144's Worker and its Durable Object, as a stack made
// by a function, so one long-lived process can deploy it with different inputs and no CLI.
//
//   const stack = ledgerStack({name: "tf-exp-147-ledger", keyHash, retain: false});
//   yield* deploy({stack, stage: "local", dev: true});   // workerd on this laptop, no account
//   yield* deploy({stack, stage: "cloud"});              // the same stack on Cloudflare
//
// What crosses into Alchemy: only the SHA-256 of the run's key, as in experiment 144. Alchemy
// keeps every binding in its state as plain text, so the key itself never comes here.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import type {SecretProviders} from "alchemy/Stack";
import * as Effect from "effect/Effect";

export interface LedgerInputs {
	/** The Worker's name on Cloudflare. A new name is a replace (experiment 144). */
	readonly name: string;
	/** SHA-256 of the run's key, hex. */
	readonly keyHash: string;
	/** Keep the old Worker, and its object's storage, when Alchemy would delete it. */
	readonly retain: boolean;
	/** Where the credentials come from, in code. None: the process environment, as the CLI. */
	readonly secrets?: SecretProviders;
}

const main = new URL("./worker.ts", import.meta.url).pathname;

export const ledgerStack = (inputs: LedgerInputs) =>
	Alchemy.Stack(
		"tf-exp-147-ledger",
		{
			providers: Cloudflare.providers(),
			// Local state in `<cwd>/.alchemy/`: the driver's own temp folder. Not `Cloudflare.state()`,
			// which would put a state-store Worker on the account.
			state: Alchemy.localState(),
			...(inputs.secrets === undefined ? {} : {secrets: inputs.secrets}),
		},
		Effect.gen(function* () {
			const worker = yield* Cloudflare.Worker("Ledger", {
				name: inputs.name,
				main,
				compatibility: {date: "2026-07-01"},
				// Alchemy turns Workers Logs on by default (experiment 144). Off.
				observability: {enabled: false},
				build: {input: {transform: {define: {__EXP_CODE__: JSON.stringify("147")}}}},
				env: {
					LEDGER: Cloudflare.DurableObject("Ledger"),
					KEY_HASH: inputs.keyHash,
					ROUND: "1",
				},
			}).pipe(RemovalPolicy.retain(inputs.retain));
			return {url: worker.url};
		}),
	);
