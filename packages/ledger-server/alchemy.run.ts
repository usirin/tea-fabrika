// The project's ledger server, for Alchemy's own command. Nothing here has been run against a real
// account: the deploy waits for the owner.
//
//   cd packages/ledger-server
//   LEDGER_NAME=acme-ledger LEDGER_FOUNDER=github:<your id> pnpm exec alchemy deploy --stage cloud
//
// `LEDGER_GITHUB_TOKEN`, when set, goes to the Worker as its `GITHUB_TOKEN` secret; the stack reads
// it itself, as a `Redacted`. The account and its token come from Alchemy's own login, never from
// this repo.
import {decodeConfig} from "./src/config.ts";
import {ledgerStack} from "./src/stack.ts";

const config = decodeConfig({
	name: process.env.LEDGER_NAME,
	founder: process.env.LEDGER_FOUNDER,
	...(process.env.LEDGER_ORIGIN === undefined ? {} : {origin: process.env.LEDGER_ORIGIN}),
});

export default ledgerStack(config);
