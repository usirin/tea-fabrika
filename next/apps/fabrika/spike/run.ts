// Experiment 248 spike, next/. Deploys one probe stack to the local provider and prints probe
// answers as JSON lines. node spike/run.ts <bundled|prebuilt> [probe ...]
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import {NodeServices} from "@effect/platform-node";
import * as Alchemy from "alchemy";
import {AlchemyContext} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import {localState} from "alchemy/State/LocalState";
import {Effect, Layer} from "effect";

process.env.DO_NOT_TRACK = "1";
const variant = process.argv[2] ?? "bundled";
const probes = process.argv.slice(3);
const home = mkdtempSync(join(tmpdir(), "sp-"));
process.env.ALCHEMY_HOME = join(home, "alchemy-home");
const port = Number(process.env.SPIKE_PORT ?? 18931);
const url = `http://127.0.0.1:${port}`;

const say = (probe: string, value: unknown) =>
	process.stdout.write(`${JSON.stringify({probe, value})}\n`);

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const call = async (
	object: string,
	name: string,
	method: string,
	...args: ReadonlyArray<unknown>
) => {
	const reply = await fetch(url, {
		method: "POST",
		body: JSON.stringify({object, name, method, args}),
	});
	const text = await reply.text();

	try {
		return JSON.parse(text);
	} catch {
		return {status: reply.status, text: text.slice(0, 600)};
	}
};

const want = (name: string) => probes.length === 0 || probes.includes(name);

const stack = async () => {
	if (variant === "bundled") {
		const worker = await import("./worker.ts");
		return Alchemy.Stack(
			"spike",
			{providers: Cloudflare.providers(), state: Alchemy.localState()},
			Effect.gen(function* () {
				const spike = yield* worker.default.pipe(
					Layer.build,
					Effect.flatMap(() => worker.Spike),
				);
				return {url: spike.url};
			}),
		);
	}

	if (variant === "eager") {
		const worker = await import("./worker-eager.ts");
		return Alchemy.Stack(
			"spike",
			{providers: Cloudflare.providers(), state: Alchemy.localState()},
			Effect.gen(function* () {
				const spike = yield* worker.default.pipe(
					Layer.build,
					Effect.flatMap(() => worker.Eager),
				);
				return {url: spike.url};
			}),
		);
	}

	const {prebuilt} = await import("./prebuilt.ts");
	return prebuilt(home, port);
};

const main = Effect.gen(function* () {
	const scope = yield* Effect.scope;
	const engine = Layer.mergeAll(
		Layer.succeed(AlchemyContext, {dotAlchemy: join(home, ".alchemy"), dev: true, adopt: false}),
		Layer.succeed(ArtifactStore, createArtifactStore()),
		Interaction.layerNonInteractive(),
	);
	const s = yield* Effect.promise(stack);
	const t0 = Date.now();
	yield* deploy({stack: s as never, stage: "local", dev: true, scope}).pipe(
		Effect.provide(localState()),
		Effect.provide(engine),
	);
	say("deployed", {variant, ms: Date.now() - t0});
	yield* Effect.promise(async () => {
		if (variant === "eager") {
			await pause(4000);
			const reply = await fetch(url).then(
				(r) => r.text(),
				(error) => `fetch failed: ${error}`,
			);
			say("eager", {text: reply.slice(0, 500), rss: process.memoryUsage().rss});
			return;
		}

		for (let n = 0; n < 150; n++) {
			try {
				await call("store", "boot", "sql");
				break;
			} catch {
				await pause(200);
			}
		}

		if (want("sql")) {
			say("sql", await call("store", "a", "sql"));
			say("txSync.ok", await call("store", "a", "txSync", false));
			say("txSync.fail", await call("store", "a", "txSync", true));
			say("txEffect.ok", await call("store", "a", "txEffect", false));
			say("txEffect.fail", await call("store", "a", "txEffect", true));
		}

		if (want("alarm")) {
			say("alarm.before", await call("store", "plain", "alarms"));
			say("alarm.arm", {now: Date.now(), armed: await call("store", "plain", "arm", 600, "plain")});
			say("alarm.delete", await call("store", "deleted", "arm", 600, "delete"));
			say("alarm.abort.arm", await call("store", "abort", "arm", 600, "abort"));
			await pause(2500);
			say("alarm.plain.after", await call("store", "plain", "alarms"));
			say("alarm.deleted.after", await call("store", "deleted", "alarms"));
			await pause(6000);
			say("alarm.abort.after", await call("store", "abort", "alarms"));
		}

		if (want("ws")) {
			const frames: Array<unknown> = [];
			const socket = new WebSocket(`${url.replace("http", "ws")}/ws`);
			socket.addEventListener("message", (event) =>
				frames.push(
					JSON.parse(
						String(event.data).startsWith("{")
							? String(event.data)
							: JSON.stringify(String(event.data)),
					),
				),
			);
			await new Promise<void>((done, fail) => {
				socket.addEventListener("open", () => done());
				socket.addEventListener("error", () => fail(new Error("ws error")));
			});
			socket.send("one");
			await pause(300);
			const before = await call("sock", "room", "look");
			say("ws.before", {frames: [...frames], look: before});
			socket.send("ping");
			await pause(300);
			say("ws.autoresponse", frames.at(-1));
			await pause(12_500);
			socket.send("two");
			await pause(500);
			say("ws.after.message", frames.at(-1));
			say("ws.ring", await call("sock", "room", "ring", "tab-a", "hello"));
			await pause(300);
			const after = await call("sock", "room", "look");
			say("ws.after", {
				frames: [...frames],
				look: after,
				woke: after.value?.instance !== before.value?.instance,
			});
			socket.close();
			await pause(300);
		}

		if (want("rpc")) {
			say("rpc.chain", await call("ping", "start", "hit", 0));
			say("rpc.crossing", await call("ping", "start", "crossing"));
			say("rpc.fail.at.worker", await call("pong", "one", "refuse"));
			say("rpc.missing.at.worker", await call("pong", "one", "nope"));
		}

		if (want("plain")) {
			const reply = await fetch(`${url}/plain`);
			say("plain", {status: reply.status, text: (await reply.text()).slice(0, 300)});
		}
	});
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

Effect.runPromise(main).then(
	() => {
		rmSync(home, {recursive: true, force: true});
		process.exit(0);
	},
	(error) => {
		say("failed", String(error?.stack ?? error).slice(0, 3000));
		rmSync(home, {recursive: true, force: true});
		process.exit(1);
	},
);
