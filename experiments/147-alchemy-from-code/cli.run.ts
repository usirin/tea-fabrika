// The same ledger stack as a file for Alchemy's own CLI, so `run.ts cli-live` can time
// `alchemy deploy` and `alchemy destroy` on Cloudflare against the from-code numbers.
import {ledgerStack} from "./ledger.ts";

export default ledgerStack({
	name: "tf-exp-147-ledger-cli",
	keyHash: process.env.EXP_KEY_HASH ?? "",
	retain: false,
});
