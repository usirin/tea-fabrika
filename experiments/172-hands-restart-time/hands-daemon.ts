// A stand-in for the hands that start the brain the way packages/fabrika's local ledger does
// (src/host/local.ts): today's daemon (src/host/daemon.ts, Miniflare around the ledger's Durable
// Object) as a child, in a process group of its own, from the source. The daemon watches its
// parent's pid every 250 ms and stops when it changes.
//
// Env: PORT, PERSIST, DOOR_SECRET, DAEMON (the daemon's path). Relays the daemon's ready line with
// its pid added: {ready, ms, pid, daemon}.
//
// Node at the edge, all of it: a process the driver kills.
import {spawn} from "node:child_process";

const daemon = process.env.DAEMON;
if (daemon === undefined) throw new Error("DAEMON is not set");
const child = spawn(process.execPath, ["--no-warnings", daemon], {
	env: {
		...process.env,
		GRACE_MS: "1000",
		DOOR_PERSON: "owner",
	},
	detached: true,
	stdio: ["ignore", "pipe", "inherit"],
});
let rest = "";
child.stdout.on("data", (chunk: Buffer) => {
	rest += chunk.toString("utf8");
	const nl = rest.indexOf("\n");
	if (nl < 0) return;
	const ready = JSON.parse(rest.slice(0, nl)) as Record<string, unknown>;
	process.stdout.write(`${JSON.stringify({...ready, pid: process.pid, daemon: child.pid})}\n`);
});
process.on("SIGTERM", () => {
	child.kill("SIGTERM");
	child.once("exit", () => process.exit(0));
});
setInterval(() => {}, 60_000);
