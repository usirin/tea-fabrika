// Experiment 183's core: one Durable Object per process, as experiment 173's `Process`, plus a
// code swap. The core keeps the model, the running hash and a small log in its own storage. A
// program version is a pure step behind Worker Loader, keyed by its content hash.
//
//   POST /p/<pid>/install {hash, code}            keep the code under its hash
//   POST /p/<pid>/boot    {hash}                  start fresh on this version
//   POST /p/<pid>/msg     {id, msg}               one step, in the process's queue
//   POST /p/<pid>/load    {hash, from, queue}     swap to this version; queue=false skips the queue
//   POST /p/<pid>/read    {}                      model, running hash, view, log
//
// The queue is the point of the test: a step awaits the isolate, and a Durable Object takes
// other calls while it waits. A swap must land between two steps, never inside one.
import {DurableObject} from "cloudflare:workers";

type Entry = {rev: number; _tag: string; body: Record<string, unknown>};
type Migrated = {ok: true; model: unknown} | {ok: false; why: string};

export class Process extends DurableObject<any> {
	queue: Promise<unknown> = Promise.resolve();

	private kv() {
		return this.ctx.storage.kv;
	}

	private append(_tag: string, body: Record<string, unknown>) {
		const rev = ((this.kv().get("rev") as number | undefined) ?? 0) + 1;
		this.kv().put("rev", rev);
		this.kv().put(`e:${String(rev).padStart(8, "0")}`, {rev, _tag, body});
	}

	private serial<T>(f: () => Promise<T>): Promise<T> {
		const run = this.queue.then(f);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private program(hash: string) {
		return this.env.LOADER.get(hash, async () => ({
			compatibilityDate: "2026-07-01",
			mainModule: "program.js",
			modules: {"program.js": this.kv().get(`code:${hash}`) as string},
			env: {},
			globalOutbound: null,
		})).getEntrypoint("Program");
	}

	install(b: {hash: string; code: string}) {
		this.kv().put(`code:${b.hash}`, b.code);
		return {kept: true};
	}

	async boot(b: {hash: string}) {
		const model = await this.program(b.hash).init();
		this.kv().put("model", model);
		this.kv().put("running", b.hash);
		this.append("code.loaded", {hash: b.hash, was: null, from: "boot"});
		return {model};
	}

	private async step(b: {id: string; msg: unknown}) {
		const hash = this.kv().get("running") as string;
		const before = this.kv().get("model");
		try {
			const model = await this.program(hash).step(before, b.msg);
			this.kv().put("model", model);
			this.append("stepped", {id: b.id, build: hash});
			return {ok: true, build: hash};
		} catch (e) {
			// The update is pure, so nothing it did escaped. Roll back to the code before it, run the
			// same Msg there once, and say so. A first boot has nothing to roll back to.
			const was = this.kv().get("was") as string | undefined;
			this.append("step.crashed", {id: b.id, build: hash, why: String(e).slice(0, 120)});
			if (!was) return {ok: false};
			this.kv().put("running", was);
			this.append("code.rolled_back", {from: hash, to: was});
			const model = await this.program(was).step(before, b.msg);
			this.kv().put("model", model);
			this.append("stepped", {id: b.id, build: was});
			return {ok: true, build: was, rolledBack: true};
		}
	}

	msg(b: {id: string; msg: unknown}) {
		return this.serial(() => this.step(b));
	}

	private async swap(b: {hash: string; from: string}) {
		const was = this.kv().get("running") as string;
		let out: Migrated;
		try {
			out = await this.program(b.hash).migrate(this.kv().get("model"));
		} catch (e) {
			this.append("code.failed", {hash: b.hash, was, why: String(e).slice(0, 120)});
			return {swapped: false, why: "failed"};
		}
		if (!out.ok) {
			this.append("code.refused", {hash: b.hash, was, why: out.why});
			return {swapped: false, why: "refused"};
		}
		this.kv().put("model", out.model);
		this.kv().put("was", was);
		this.kv().put("running", b.hash);
		this.append("code.loaded", {hash: b.hash, was, from: b.from});
		return {swapped: true};
	}

	load(b: {hash: string; from: string; queue?: boolean}) {
		return b.queue === false ? this.swap(b) : this.serial(() => this.swap(b));
	}

	async read() {
		const hash = this.kv().get("running") as string;
		const model = this.kv().get("model");
		const log = [...this.kv().list({prefix: "e:"})].map(([, v]) => v as Entry);
		return {hash, model, view: await this.program(hash).view(model), log};
	}

	async fetch(request: Request): Promise<Response> {
		const part = new URL(request.url).pathname.split("/")[3] ?? "";
		const body: any = await request.json();
		const parts: Record<string, (b: any) => unknown> = {
			install: (b) => this.install(b),
			boot: (b) => this.boot(b),
			msg: (b) => this.msg(b),
			load: (b) => this.load(b),
			read: () => this.read(),
		};
		const handler = parts[part];
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
