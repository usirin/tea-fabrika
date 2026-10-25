// Experiment 144's stack: the ledger's real Durable Object on Cloudflare, behind a thin Worker.
// Alchemy 2.0.0-beta.84 deploys it; `../144-durable-objects-live.ts` runs `alchemy deploy` and
// `alchemy destroy` from this folder, so nothing here is run by hand.
//
// The Worker is Alchemy's "async Worker": `main` names a plain module, Alchemy bundles it as it is,
// and no Effect runs inside Cloudflare. The object is bound by its class name, which `worker.ts`
// exports. Alchemy derives the SQLite-backed namespace and its migration from that.
//
// What crosses into Alchemy from the run: only the SHA-256 of the run's key (`EXP_KEY_HASH`), the
// deploy's round (`EXP_ROUND`) and the build's number (`EXP_CODE`). Alchemy keeps every binding in
// its local state as plain text, so the key itself never comes here.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"tf-exp-144",
	// Local state, in `.alchemy/` here (git-ignored), and not `Cloudflare.state()`, which would put
	// a state-store Worker on the account.
	{providers: Cloudflare.providers(), state: Alchemy.localState()},
	Effect.gen(function* () {
		const worker = yield* Cloudflare.Worker("Ledger", {
			name: "tf-exp-144-ledger",
			main: "./worker.ts",
			// The date Miniflare runs the same object on (packages/fabrika/src/host/worker-options.ts).
			compatibility: {date: "2026-07-01"},
			// Alchemy turns Workers Logs on by default. Off: no log line holds a path with the key.
			observability: {enabled: false},
			// The build's number, written into the code itself (`__EXP_CODE__` in worker.ts), so a new
			// number is a code update: the kind of deploy Cloudflare says restarts every object. A new
			// `ROUND` alone changes a binding and leaves the code as it was.
			build: {
				input: {transform: {define: {__EXP_CODE__: JSON.stringify(process.env.EXP_CODE ?? "1")}}},
			},
			env: {
				LEDGER: Cloudflare.DurableObject("Ledger"),
				KEY_HASH: process.env.EXP_KEY_HASH ?? "",
				ROUND: process.env.EXP_ROUND ?? "1",
			},
		});
		return {url: worker.url};
	}),
);
