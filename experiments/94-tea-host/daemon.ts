// The local ledger daemon: experiment 93's Ledger Durable Object, unchanged, in Miniflare, served
// on workerd's own socket (`unsafeDirectSockets`) so no request passes through Miniflare's router
// worker. The harness starts it detached, in its own process group, and stops the group: a kill
// to this Node process alone would leave workerd serving (experiment 93).
//
// PERSIST: the data folder. PORT: the direct socket's port. GRACE_MS: the ledger's expiry grace.
// Prints one JSON line when ready. Node at the edge: it is a process the harness signals, and
// Miniflare is a Node library.
import {Miniflare} from "miniflare";
import {ledgerOptions} from "../93-ledger/worker.ts";

const t0 = performance.now();
const port = Number(process.env.PORT ?? "0");
const mf = new Miniflare({
	...ledgerOptions({
		persist: process.env.PERSIST ?? false,
		graceMs: Number(process.env.GRACE_MS ?? "1000"),
	}),
	unsafeDirectSockets: [{host: "127.0.0.1", port}],
});
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
