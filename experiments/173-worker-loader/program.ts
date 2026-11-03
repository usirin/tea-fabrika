// The loaded side of experiment 173: what the hands bundle and the core hands to Worker Loader.
// Two ways in. `Program` is a stateless entrypoint: the core keeps the state and sends it with
// each Msg (Elm's update across the line). `Kept` is a Durable Object class the core runs as
// a facet, so the program keeps its own state in its own SQLite, and the core never sees it.
// `probe` answers what the loaded code can reach.
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {runAll, step, type Tally} from "./tally.ts";

// One per isolate: it says whether two calls met the same isolate.
let calls = 0;
const born = Date.now();

const tryIt = async (f: () => unknown): Promise<string> => {
	try {
		const v = await f();
		return `ok: ${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)?.slice(0, 80)}`;
	} catch (e) {
		return `refused: ${String(e).slice(0, 160)}`;
	}
};

export class Program extends WorkerEntrypoint<any> {
	init(): Tally {
		return {n: 0, pad: ""};
	}
	step(model: Tally, msg: unknown) {
		calls++;
		const [next, cmds] = step(model, msg);
		return {model: next, cmds};
	}
	runAll(msgs: readonly unknown[]) {
		return runAll(msgs);
	}
	isolate() {
		calls++;
		return {calls, born};
	}
	spin(ms: number) {
		const end = Date.now() + ms;
		let i = 0;
		while (Date.now() < end) i++;
		return i;
	}
	async probe() {
		const env: Record<string, any> = this.env ?? {};
		const out: Record<string, unknown> = {
			env: Object.keys(env),
			fetch: await tryIt(() => fetch("https://example.com/").then((r) => r.status)),
			fetchLocal: await tryIt(() => fetch("http://127.0.0.1:1/").then((r) => r.status)),
			connect: await tryIt(async () => {
				const {connect} = await import("cloudflare:sockets");
				const s = connect({hostname: "127.0.0.1", port: 1});
				await s.opened;
				return "opened";
			}),
			webSocket: await tryIt(() => new WebSocket("wss://example.com/")),
			cache: await tryIt(() => caches.default.match("https://example.com/")),
			process: typeof Reflect.get(globalThis, "process"),
			require: typeof Reflect.get(globalThis, "require"),
			crypto: await tryIt(() => crypto.randomUUID().length),
		};
		// A binding we passed is the one way out: the ledger, with the pid the core set.
		if (env.LEDGER) out.ledger = await tryIt(() => env.LEDGER.append("hello"));
		if (env.LEDGER) out.ledgerForged = await tryIt(() => env.LEDGER.append("hi", "process:other"));
		return out;
	}
}

export class Kept extends DurableObject<any> {
	model: Tally = {n: 0, pad: ""};
	loaded = false;
	private load() {
		if (this.loaded) return;
		this.model = this.ctx.storage.kv.get("model") ?? {n: 0, pad: ""};
		this.loaded = true;
	}
	step(msg: unknown) {
		this.load();
		const [next] = step(this.model, msg);
		this.model = next;
		this.ctx.storage.kv.put("model", next);
		return next.n;
	}
	read() {
		this.load();
		return {n: this.model.n, keys: [...this.ctx.storage.kv.list()].map(([k]) => k)};
	}
}

export default {
	fetch() {
		return new Response("a tea program; call its entrypoints");
	},
};
