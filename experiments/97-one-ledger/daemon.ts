// Experiment 97's copy of experiment 96's daemon, unchanged but for which ledger it loads: this
// folder's, the one ledger merged from 95's and 96's. Both 97 tests (the counter and the agents)
// run on it.
//
// The local ledger daemon, served on workerd's own socket. The harness starts it detached, in its
// own process group, and stops (or SIGKILLs) the group: a kill to this Node process alone would
// leave workerd serving (experiment 93).
//
// PERSIST: the data folder. PORT: the direct socket's port. GRACE_MS: the ledger's expiry grace.
// Prints one JSON line when ready. Node at the edge: it is a process the harness signals, and
// Miniflare is a Node library.
import {Miniflare} from "miniflare";
import {ledgerOptions} from "./worker.ts";

const t0 = performance.now();
const mf = new Miniflare(
	ledgerOptions({
		persist: process.env.PERSIST ?? false,
		graceMs: Number(process.env.GRACE_MS ?? "1000"),
		direct: Number(process.env.PORT ?? "0"),
	}),
);
await mf.ready;
const direct = await mf.unsafeGetDirectURL();
process.stdout.write(
	`${JSON.stringify({ready: direct.origin, ms: performance.now() - t0, pid: process.pid})}\n`,
);

process.on("SIGTERM", () => {
	mf.dispose().then(
		() => process.exit(0),
		() => process.exit(1),
	);
});
