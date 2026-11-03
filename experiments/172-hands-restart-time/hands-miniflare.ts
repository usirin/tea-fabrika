// A stand-in for the hands that hold the brain in their own process: Miniflare, in this Node
// process, with the smallest Worker there is, on workerd's own socket (`unsafeDirectSockets`, as
// packages/fabrika's daemon does). No guard of our own: nothing here stops workerd when this
// process dies. That is the question part 4 asks.
//
// Env: PORT (the direct socket's port). Prints one JSON line when ready: {ready, ms, pid}.
//
// Node at the edge, all of it: a process the driver kills.
import {Miniflare} from "miniflare";

const t0 = performance.now();
const port = Number(process.env.PORT ?? "0");
const mf = new Miniflare({
	modules: true,
	script: `export default { fetch() { return new Response("brain"); } };`,
	compatibilityDate: "2026-07-01",
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
setInterval(() => {}, 60_000);
