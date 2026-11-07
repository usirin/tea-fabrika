// Experiment 224's stack: one Worker with one SQLite-backed Durable Object class, `Sizer`.
// Alchemy 2.0.0-beta.84 runs it, as experiment 144 did: `alchemy dev` for workerd on the laptop,
// `alchemy deploy` and `alchemy destroy` for Cloudflare. The driver
// (../224-do-size-after-delete.ts) runs each from this folder, so nothing here is run by hand.
//
// What crosses into Alchemy: only the SHA-256 of the run's key (`EXP_KEY_HASH`). Alchemy keeps
// bindings in its local state as plain text, so the key itself never comes here.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"tf-exp-224",
	// Local state in `.alchemy/` here (git-ignored), so no state-store Worker lands on the account.
	{providers: Cloudflare.providers(), state: Alchemy.localState()},
	Effect.gen(function* () {
		const worker = yield* Cloudflare.Worker("Sizer", {
			name: "tf-exp-224-size",
			main: "./worker.ts",
			// The date experiment 144 and the Miniflare tests use. The local stage alone adds
			// workerd's `experimental` flag (EXP_FLAGS), which exposes `setMaxPageCountForTest`.
			compatibility: {
				date: "2026-07-01",
				flags: process.env.EXP_FLAGS ? process.env.EXP_FLAGS.split(",") : [],
			},
			observability: {enabled: false},
			env: {
				SIZER: Cloudflare.DurableObject("Sizer"),
				KEY_HASH: process.env.EXP_KEY_HASH ?? "",
			},
		});
		return {url: worker.url};
	}),
);
