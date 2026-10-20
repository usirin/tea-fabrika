// Miniflare as a long-lived local process: the solo ledger's daemon. The harness starts it as
// a child, talks to it over HTTP, and SIGKILLs it for real. PERSIST is the data folder, PORT
// the port (0 picks one), GRACE_MS the ledger's expiry grace. It prints one JSON line when
// ready, and stops cleanly on SIGTERM.
import {Miniflare} from "miniflare";
import {ledgerOptions} from "./worker.ts";

const t0 = performance.now();
const mf = new Miniflare(
	ledgerOptions({
		persist: process.env.PERSIST ?? false,
		port: Number(process.env.PORT ?? "0"),
		graceMs: Number(process.env.GRACE_MS ?? "1000"),
	}),
);
const url = await mf.ready;
process.stdout.write(
	`${JSON.stringify({ready: url.origin, ms: performance.now() - t0, pid: process.pid})}\n`,
);

process.on("SIGTERM", () => {
	mf.dispose().then(
		() => process.exit(0),
		() => process.exit(1),
	);
});
