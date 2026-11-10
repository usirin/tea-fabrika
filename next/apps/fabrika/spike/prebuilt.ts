// Experiment 248 spike, next/. Question 1: the stack stays `bundle: false` with our own Rolldown
// build. The entry is ours: Alchemy's bridge classes for the Effect objects, and a plain class,
// a plain WorkerEntrypoint and a plain default fetch beside them. Never merged.
import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import {Effect} from "effect";
import {rolldown} from "rolldown";

export const entry = (worker: string, objects: ReadonlyArray<string>) => `
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {makeDurableObjectBridge, makeRpcStub} from "@alchemy.run/cloudflare/Bridge";
import {Effect} from "effect";
import entrypoint from ${JSON.stringify(worker)};

const meta = {entrypoint, stack: {name: "spike", stage: "local"}};
const Bridge = makeDurableObjectBridge(DurableObject, meta);
${objects.map((name) => `export class ${name} extends Bridge(${JSON.stringify(name)}) {}`).join("\n")}

// A plain class beside the Effect objects, as Project, Process and Gateway would be mid-port.
export class Plain extends DurableObject {
	async hello() {
		// A plain caller reaches an Effect object through Alchemy's stub, so the envelope is decoded.
		const store = makeRpcStub(this.env.Store.getByName("from-plain"));
		const rows = await Effect.runPromise(store.sql());
		const raw = await this.env.Pong.getByName("one").refuse();
		return {plain: this.ctx.id.name, rows, raw};
	}
}

export class Control extends WorkerEntrypoint {
	fetch() {
		return Response.json({props: this.ctx.props ?? null});
	}
}

const names = {store: "Store", sock: "Sock", ping: "Ping", pong: "Pong"};
export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === "/ws") {
			return env.Sock.getByName("room").fetch(request);
		}

		if (url.pathname === "/plain") {
			return Response.json(await env.PLAIN.getByName("p1").hello());
		}

		const q = await request.json();
		const stub = makeRpcStub(env[names[q.object]].getByName(q.name));
		const exit = await Effect.runPromiseExit(stub[q.method](...q.args));
		return Response.json(exit._tag === "Success" ? {value: exit.value ?? null} : {error: String(exit.cause)});
	},
};
`;

export const build = async (home: string, options: {readonly cloudflare: boolean}) => {
	const out = join(home, "dist");
	mkdirSync(out, {recursive: true});
	const source = resolve(import.meta.dirname, "prebuilt-entry.generated.mjs");
	writeFileSync(source, entry("./worker.ts", ["Store", "Sock", "Ping", "Pong"]));
	const plugins = options.cloudflare
		? (await import("@alchemy.run/cloudflare-runtime/rolldown")).default({
				compatibilityDate: "2026-10-12",
				compatibilityFlags: [],
			})
		: [];
	const bundle = await rolldown({
		input: source,
		plugins,
		...(options.cloudflare
			? {external: ["lightningcss", "fsevents"], checks: {unresolvedImport: false}}
			: {
					platform: "browser" as const,
					external: ["cloudflare:workers", /^node:/],
					resolve: {conditionNames: ["workerd", "worker", "import", "default"]},
				}),
		logLevel: "silent",
		...(process.env.SPIKE_DEFINE === "0"
			? {}
			: {transform: {define: {"globalThis.__ALCHEMY_RUNTIME__": "true"}}}),
	});

	try {
		const built = await bundle.generate({
			format: "esm",
			codeSplitting: false,
			...(process.env.SPIKE_INLINE === "1" ? {inlineDynamicImports: true} : {}),
			entryFileNames: "worker.mjs",
			chunkFileNames: "[name]-[hash].mjs",
		});
		let bytes = 0;

		for (const o of built.output) {
			if (o.type === "chunk") {
				writeFileSync(join(out, o.fileName), o.code);
				bytes += o.code.length;
			}
		}

		return {
			main: join(out, "worker.mjs"),
			bytes,
			chunks: built.output.filter((o) => o.type === "chunk").map((o) => o.fileName),
		};
	} finally {
		await bundle.close();
	}
};

export const prebuilt = async (home: string, port: number) => {
	const built = await build(home, {cloudflare: process.env.SPIKE_CF_PLUGIN === "1"});
	process.stdout.write(
		`${JSON.stringify({probe: "prebuilt.build", value: {bytes: built.bytes, chunks: built.chunks}})}\n`,
	);
	return Alchemy.Stack(
		"spike",
		{providers: Cloudflare.providers(), state: Alchemy.localState()},
		Effect.gen(function* () {
			const spike = yield* Cloudflare.Workers.Worker("Spike", {
				name: "spike",
				main: built.main,
				bundle: false,
				compatibility: {date: "2026-10-12"},
				observability: {enabled: false},
				dev: {host: "127.0.0.1", port, strictPort: true},
				env: {
					Store: Cloudflare.DurableObject("Store"),
					Sock: Cloudflare.DurableObject("Sock"),
					Ping: Cloudflare.DurableObject("Ping"),
					Pong: Cloudflare.DurableObject("Pong"),
					PLAIN: Cloudflare.DurableObject("Plain"),
				},
			});
			return {url: spike.url};
		}),
	);
};
