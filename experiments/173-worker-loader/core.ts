// The core side of experiment 173: one Durable Object class, `Process`, one object per program
// process (`process:<pid>`). It holds the program's code by content hash, gets an isolate for
// it from Worker Loader, and steps the program through that isolate. It also runs the same
// program straight inside itself, as the baseline, and as a facet with its own SQLite.
//
//   POST /p/<pid>/install  {program, hash, code}   the code is kept if its sha256 is the hash
//   POST /p/<pid>/start    {program, hash}         the process runs this version from now on
//   POST /p/<pid>/one      {mode, msg}             one step: "isolate", "direct", "facet" or "noop"
//   POST /p/<pid>/<part>   {...}                   the measurements and probes below
//
// Timers inside workerd tick in whole milliseconds, so per-step numbers here are totals over
// many steps; the driver measures single steps from outside.
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";
import {runAll, step, type Tally} from "./tally.ts";

const COMPAT = "2026-07-01";

const sha256 = async (text: string): Promise<string> => {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** The one way out we hand a program: it appends under the pid the core set, never its own. */
export class Ledger extends WorkerEntrypoint<any, {pid: string}> {
	append(text: string, claimed?: string) {
		return {by: this.ctx.props.pid, text, claimed: claimed ?? null};
	}
}

/** A gate for `globalOutbound`: every fetch the program makes lands here, and is refused. */
export class Gate extends WorkerEntrypoint<any, {pid: string}> {
	fetch(request: Request) {
		return new Response(`gate refused ${request.url} for ${this.ctx.props.pid}`, {status: 403});
	}
}

type Running = {program: string; hash: string};

export class Process extends DurableObject<any> {
	model: Tally = {n: 0, pad: ""};
	running: Running | undefined;

	private pid(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	private code(hash: string): string {
		const code = this.ctx.storage.kv.get(`code:${hash}`);
		if (typeof code !== "string") throw new Error(`no code kept for ${hash}`);
		return code;
	}

	/** The isolate for one program version. Its id is the content hash, so a new version is a new id. */
	worker(hash: string, opts: {outbound?: "none" | "gate"; cpuMs?: number} = {}) {
		const pid = this.pid();
		return this.env.LOADER.get(
			`${hash}:${opts.outbound ?? "none"}:${opts.cpuMs ?? 0}`,
			async () => ({
				compatibilityDate: COMPAT,
				mainModule: "program.js",
				modules: {"program.js": this.code(hash)},
				env: {LEDGER: this.ctx.exports.Ledger({props: {pid}})},
				globalOutbound: opts.outbound === "gate" ? this.ctx.exports.Gate({props: {pid}}) : null,
				...(opts.cpuMs ? {limits: {cpuMs: opts.cpuMs}} : {}),
			}),
		);
	}

	private entry() {
		if (!this.running) throw new Error("nothing started");
		return this.worker(this.running.hash).getEntrypoint("Program");
	}

	private facet(hash: string) {
		return this.ctx.facets.get("program", () => ({
			class: this.worker(hash).getDurableObjectClass("Kept"),
		}));
	}

	async install(body: {program: string; hash: string; code: string}) {
		const real = await sha256(body.code);
		if (real !== body.hash) return {kept: false, why: "hash_mismatch", real};
		this.ctx.storage.kv.put(`code:${body.hash}`, body.code);
		return {kept: true, bytes: body.code.length};
	}

	start(body: Running & {pad?: number}) {
		this.running = {program: body.program, hash: body.hash};
		this.model = {n: 0, pad: "x".repeat(body.pad ?? 0)};
		return {started: body.program, hash: body.hash};
	}

	async one(body: {mode: string; msg: unknown}) {
		if (body.mode === "noop") return {n: this.model.n};
		if (body.mode === "direct") {
			this.model = step(this.model, body.msg)[0];
			return {n: this.model.n};
		}
		if (body.mode === "facet") {
			if (!this.running) throw new Error("nothing started");
			return {n: await this.facet(this.running.hash).step(body.msg)};
		}
		const out = await this.entry().step(this.model, body.msg);
		this.model = out.model;
		return {n: this.model.n};
	}

	/** Cold: the first get and call of a hash this workerd has never loaded. */
	async cold(body: {hashes: string[]}) {
		const ms: number[] = [];
		for (const hash of body.hashes) {
			const t0 = performance.now();
			await this.worker(hash).getEntrypoint("Program").isolate();
			ms.push(performance.now() - t0);
		}
		return {ms};
	}

	/** Warm: get the same hash again and call it, many times; and `get` alone. */
	async warm(body: {hash: string; times: number}) {
		const first = await this.worker(body.hash).getEntrypoint("Program").isolate();
		const t0 = performance.now();
		let last = first;
		for (let i = 0; i < body.times; i++)
			last = await this.worker(body.hash).getEntrypoint("Program").isolate();
		const getAndCall = (performance.now() - t0) / body.times;
		const t1 = performance.now();
		for (let i = 0; i < body.times * 10; i++) this.worker(body.hash);
		const getOnly = (performance.now() - t1) / (body.times * 10);
		return {
			getAndCallMs: getAndCall,
			getOnlyMs: getOnly,
			sameIsolate: last.born === first.born,
			calls: last.calls,
		};
	}

	/** Steps in a loop inside the object: total time over `steps`, for each mode. */
	async bench(body: {hash: string; steps: number; pad: number; mode: string}) {
		this.running = {program: "tally", hash: body.hash};
		let model: Tally = {n: 0, pad: "x".repeat(body.pad)};
		const msg = {type: "plus"};
		const entry = this.worker(body.hash).getEntrypoint("Program");
		await entry.isolate();
		const t0 = performance.now();
		if (body.mode === "direct") {
			for (let i = 0; i < body.steps; i++) model = step(model, msg)[0];
		} else if (body.mode === "isolate") {
			for (let i = 0; i < body.steps; i++) model = (await entry.step(model, msg)).model;
		} else if (body.mode === "facet") {
			const f = this.facet(body.hash);
			for (let i = 0; i < body.steps; i++) model = {n: await f.step(msg), pad: ""};
		}
		const ms = performance.now() - t0;
		return {ms, perStepUs: (ms * 1000) / body.steps, n: model.n};
	}

	async probe(body: {hash: string}) {
		const none = await this.worker(body.hash).getEntrypoint("Program").probe();
		const gate = await this.worker(body.hash, {outbound: "gate"}).getEntrypoint("Program").probe();
		const limits: Record<string, string> = {};
		for (const ms of [50, 500]) {
			try {
				const i = await this.worker(body.hash, {cpuMs: 10}).getEntrypoint("Program").spin(ms);
				limits[`spin ${ms} ms with cpuMs 10`] = `ran, ${i} turns`;
			} catch (e) {
				limits[`spin ${ms} ms with cpuMs 10`] = `stopped: ${String(e).slice(0, 120)}`;
			}
		}
		return {
			none,
			gate,
			limits,
			coreKeys: [...this.ctx.storage.kv.list()].map(([k]) => k.slice(0, 16)),
		};
	}

	/** Facets: the program keeps its own SQLite; the core's keys and its own do not mix. */
	async facets(body: {hash: string; next: string; steps: number}) {
		this.ctx.storage.kv.put("core-only", "the core's own row");
		const f = this.facet(body.hash);
		for (let i = 0; i < body.steps; i++) await f.step({type: "plus"});
		const seen = await f.read();
		const coreKeys = [...this.ctx.storage.kv.list()].map(([k]) => k.slice(0, 16));
		// A new version: stop the facet, start it again on the new code; its storage stays.
		this.ctx.facets.abort("program", new Error("upgraded"));
		const g = this.ctx.facets.get("program", () => ({
			class: this.worker(body.next).getDurableObjectClass("Kept"),
		}));
		const afterUpgrade = await g.read();
		let oldStub: string;
		try {
			await f.read();
			oldStub = "still answers";
		} catch (e) {
			oldStub = `refused: ${String(e).slice(0, 80)}`;
		}
		return {seen, coreKeys, afterUpgrade, oldStub};
	}

	/** Only reads the facet: run after a restart, to see its storage kept on disk. */
	async facetRead(body: {hash: string}) {
		return await this.facet(body.hash).read();
	}

	async effect(body: {hash: string; msgs: unknown[]}) {
		const inIsolate = await this.worker(body.hash).getEntrypoint("Program").runAll(body.msgs);
		const inCore = await runAll(body.msgs);
		let refused: string;
		try {
			await this.worker(body.hash).getEntrypoint("Program").step({n: 0, pad: ""}, {type: "minus"});
			refused = "accepted";
		} catch (e) {
			refused = `refused: ${String(e).split("\n")[0]?.slice(0, 160)}`;
		}
		return {inIsolate, inCore, refused};
	}

	async counter(body: {hash: string}) {
		const p = this.worker(body.hash).getEntrypoint("Program");
		const describe = await p.describe();
		let model: unknown = {n: 0};
		let status = "";
		for (let i = 0; i < 3; i++) ({model, status} = await p.step(model, {type: "plus"}));
		return {describe, model, status};
	}

	/** Which isolate answers this hash here: two processes on one version, one isolate or two? */
	async which(body: {hash: string}) {
		return await this.worker(body.hash).getEntrypoint("Program").isolate();
	}

	/** A program that spins: does it hold up its own process, or another one? */
	async spin(body: {hash: string; ms: number}) {
		const t0 = performance.now();
		await this.worker(body.hash).getEntrypoint("Program").spin(body.ms);
		return {ms: performance.now() - t0};
	}

	async fetch(request: Request): Promise<Response> {
		const part = new URL(request.url).pathname.split("/")[3] ?? "";
		const body = await request.json();
		const handlers: Record<string, (b: any) => unknown> = {
			install: (b) => this.install(b),
			start: (b) => this.start(b),
			one: (b) => this.one(b),
			cold: (b) => this.cold(b),
			warm: (b) => this.warm(b),
			bench: (b) => this.bench(b),
			probe: (b) => this.probe(b),
			facets: (b) => this.facets(b),
			facetRead: (b) => this.facetRead(b),
			effect: (b) => this.effect(b),
			counter: (b) => this.counter(b),
			spin: (b) => this.spin(b),
			which: (b) => this.which(b),
		};
		const handler = handlers[part];
		if (!handler) return Response.json({error: `no part ${part}`}, {status: 404});
		try {
			return Response.json(await handler(body));
		} catch (e) {
			return Response.json(
				{error: e instanceof Error ? (e.stack ?? e.message) : String(e)},
				{status: 500},
			);
		}
	}
}

export default {
	fetch(request: Request, env: any) {
		const pid = new URL(request.url).pathname.split("/")[2] ?? "";
		return env.PROCESS.getByName(`process:${pid}`).fetch(request);
	},
};
