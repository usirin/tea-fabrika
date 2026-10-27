// The local ledger's child process: Miniflare serving the ledger's Durable Object on workerd's own
// socket (`unsafeDirectSockets`), so no request passes through Miniflare's router worker. `local.ts`
// starts it in its own process group and signals the whole group: a kill to this Node process alone
// would leave workerd serving (experiment 93).
//
// Env: PERSIST (the data folder), PORT (the direct socket's port), GRACE_MS (the expiry grace),
// MAX_DELIVERIES (crashes in a row before a message is set aside; "off": never), DOOR_PERSON and
// DOOR_SECRET (the local door: who the one person is, and the secret that proves it). With no
// secret, the door is closed.
// Prints one JSON line when ready, `{ready: origin, ms, pid}`. Stops on SIGTERM, and when the process that
// started it is gone.
//
// Node at the edge, all of it: a process that `local.ts` signals, around Miniflare, a Node library.
import {Config, Effect, Option} from "effect";
import {Miniflare} from "miniflare";
import {ledgerOptions} from "./worker-options.ts";

const t0 = performance.now();
// Read as a `Redacted` and kept one: an empty or missing secret is none.
const secret = Effect.runSync(Config.option(Config.Redacted("DOOR_SECRET")));
const mf = new Miniflare(
	ledgerOptions({
		persist: process.env.PERSIST ?? false,
		...(Option.isNone(secret)
			? {}
			: {
					door: {
						kind: "local" as const,
						person: process.env.DOOR_PERSON ?? "owner",
						secret: secret.value,
					},
				}),
		graceMs: Number(process.env.GRACE_MS ?? "1000"),
		...(process.env.MAX_DELIVERIES === undefined
			? {}
			: {
					maxDeliveries:
						process.env.MAX_DELIVERIES === "off" ? null : Number(process.env.MAX_DELIVERIES),
				}),
		direct: Number(process.env.PORT ?? "0"),
	}),
);
await mf.ready;
const direct = await mf.unsafeGetDirectURL();
process.stdout.write(
	`${JSON.stringify({ready: direct.origin, ms: performance.now() - t0, pid: process.pid})}\n`,
);

const stop = () => {
	mf.dispose().then(
		() => process.exit(0),
		() => process.exit(1),
	);
};
process.on("SIGTERM", stop);

// The process that started it is gone (killed with no chance to close its scope): stop too, so
// no ledger is left serving with no owner. Its parent changes when it is orphaned.
const owner = process.ppid;
setInterval(() => {
	if (process.ppid !== owner) stop();
}, 250).unref();
