// Experiment 171: one twin process. It starts the ledger's Alchemy stack at its local stage from
// code (no CLI), prints one ready line, and serves until SIGTERM. The driver
// (experiments/171-alchemy-local-twin.ts) starts it as a child, under plain Node or under
// Electron as Node, from source or from a built bundle, and watches it from outside.
//
// Env:
//   TWIN_HOME     a temp folder of the driver's: Alchemy's `.alchemy/` and its user folder go there
//   TWIN_STACK    "twin" (default: the local door) or "server" (packages/ledger-server as it is)
//   TWIN_PORT     the twin's fixed port on 127.0.0.1
//   TWIN_MAIN     left out: fabrika's source entry, bundled by Alchemy; a path: a built Worker file
//   TWIN_SECRET   the local door's secret (the driver's, made for this run)
//
// Prints `{"ready": url, "ms": ..., "importMs": ..., "pid": ..., "net": [...]}` once, then
// `{"net": [...]}` on SIGUSR2 (every connection this process opened, by host), then serves.
import {join} from "node:path";
import {watch} from "../147-alchemy-from-code/net-watch.ts";

const t0 = performance.now();
const home = process.env.TWIN_HOME;
if (home === undefined) throw new Error("TWIN_HOME is the driver's temp folder");
process.env.ALCHEMY_HOME = join(home, "alchemy-home");
process.env.DO_NOT_TRACK = "1";
for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];

const [
	{layer: NodeServices},
	{AlchemyContext},
	{ArtifactStore, createArtifactStore},
	{deploy},
	Interaction,
	{Effect, Exit, Layer, Redacted, Scope},
	{ledgerStack, twinStack},
] = await Promise.all([
	import("@effect/platform-node/NodeServices"),
	import("alchemy/AlchemyContext"),
	import("alchemy/Artifacts"),
	import("alchemy/Deploy"),
	import("alchemy/Interaction"),
	import("effect"),
	import("./stack.ts"),
]);
const importMs = Math.round(performance.now() - t0);

/** What `deploy` asks of its caller (experiment 147), with `.alchemy/` named, not the cwd's. */
const engine = Layer.mergeAll(
	Layer.succeed(AlchemyContext, {dotAlchemy: join(home, ".alchemy"), dev: true, adopt: false}),
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),
).pipe(Layer.provideMerge(NodeServices));

const port = Number(process.env.TWIN_PORT ?? "18787");
const stack =
	process.env.TWIN_STACK === "server"
		? ledgerStack({name: "tf-exp-171-server", founder: "github:7"})
		: twinStack({
				name: "tf-exp-171",
				person: "owner",
				secret: Redacted.make(process.env.TWIN_SECRET ?? "fabrika_l_exp171"),
				port,
				main:
					process.env.TWIN_MAIN === undefined
						? {kind: "source"}
						: {kind: "prebuilt", file: process.env.TWIN_MAIN},
			});

const scope = Effect.runSync(Scope.make());
const out = await Effect.runPromise(
	deploy({stack, stage: "local", dev: true, scope}).pipe(Effect.provide(engine)),
);
process.stdout.write(
	`${JSON.stringify({ready: out.url, ms: Math.round(performance.now() - t0), importMs, pid: process.pid, net: watch.hosts()})}\n`,
);

process.on("SIGUSR2", () => process.stdout.write(`${JSON.stringify({net: watch.hosts()})}\n`));
const stop = () => {
	Effect.runPromise(Scope.close(scope, Exit.void)).then(
		() => process.exit(0),
		() => process.exit(1),
	);
};
process.on("SIGTERM", stop);
// Our thin wrapper's one line inside the child (TWIN_GUARD=1): the parent is gone, so stop, as
// today's daemon.ts does. Alchemy's scope closing stops what it started.
if (process.env.TWIN_GUARD === "1") {
	const owner = process.ppid;
	setInterval(() => {
		if (process.ppid !== owner) stop();
	}, 250).unref();
}
// Keep the process alive: Alchemy's servers are unref'd in places.
setInterval(() => undefined, 1 << 30);
