// The local ledger's child process: Miniflare serving the ledger's Durable Object on workerd's own
// socket (`unsafeDirectSockets`), so no request passes through Miniflare's router worker. `local.ts`
// starts it in its own process group and signals the whole group: a kill to this Node process alone
// would leave workerd serving (experiment 93).
//
// Env: PERSIST (the data folder), PORT (the direct socket's port), GRACE_MS (the expiry grace).
// Prints one JSON line when ready, `{ready: origin, ms, pid}`. Stops on SIGTERM.
//
// Node at the edge, all of it: a process that `local.ts` signals, around Miniflare, a Node library.
import {Miniflare} from "miniflare";
import {ledgerOptions} from "./worker-options.ts";

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
