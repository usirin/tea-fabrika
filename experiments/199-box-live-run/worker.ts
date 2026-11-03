// Experiment 199's Worker: one box per run, started by its own Durable Object, as 148's `JobBox`
// and 197's sketch. The object starts its one container, beats every 5 s while it runs (148: with
// no beat Cloudflare cut a box at about 26 s), reads the box's answers with `exec`, and destroys it.
//
//   driver ──HTTPS──▶ door ──▶ BoxRun "run:<id>" ──start──▶ box (standard-4's size, open internet)
//                                │  alarm every 5 s: the beat, and the 45-minute cap
//                                │  exec cat /w/out/progress.json: what the box measured so far
//                                └─ http://host.internal/{began,done} ◀── the box, caught outside it
//
// No secret goes in the box. The repo is public, so the clone needs no token, and the box calls no
// model. The door's session is made up per run by the driver.
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";

interface Env {
	readonly RUNS: DurableObjectNamespace<BoxRun>;
	readonly SESSION: string;
	/** The box's size at start, as JSON. Under a Durable Object the application may hold none (148). */
	readonly BOX_SIZE: string;
	/** The box is destroyed after this long, whatever it is doing. */
	readonly RUN_CAP_MS: string;
}

const BEAT_MS = 5000;

type Begin = {
	readonly commit: string;
	readonly set: string;
	readonly concurrency: number;
	readonly suite: string;
};

interface Row {
	readonly state: "running" | "done";
	readonly at: number;
	readonly startMs: number;
	readonly until: number;
	readonly beats: number;
	readonly began?: number;
	readonly told?: number;
	readonly ended?: {readonly why: string; readonly at: number};
	/** The last progress the object read from the box, kept so it outlives the box. */
	readonly last?: string;
}

/** http://host.internal, from inside the box: its first sign of life, and its end. */
export class BoxCalls extends WorkerEntrypoint<Env, {readonly run: string}> {
	async fetch(req: Request) {
		const path = new URL(req.url).pathname;
		const run = this.env.RUNS.getByName(this.ctx.props.run);
		if (req.method === "POST" && path === "/began") await run.mark("began");
		else if (req.method === "POST" && path === "/done") await run.mark("told");
		else return new Response("not found", {status: 404});
		return Response.json({ok: true});
	}
}

export class BoxRun extends DurableObject<Env> {
	private get box() {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- a Durable Object with a container always has one.
		return this.ctx.container!;
	}
	private row() {
		return this.ctx.storage.kv.get<Row>("run");
	}
	private put(row: Row) {
		this.ctx.storage.kv.put("run", row);
	}

	/** Start the box, once. Asked again, it answers how the run is. */
	async begin(run: string, o: Begin) {
		const kept = this.row();
		if (kept !== undefined) return {row: kept, fresh: false};
		const t0 = Date.now();
		this.put({
			state: "running",
			at: t0,
			startMs: -1,
			until: t0 + Number(this.env.RUN_CAP_MS),
			beats: 0,
		});
		this.box.start({
			image: this.box.images.Run,
			enableInternet: true,
			instance: JSON.parse(this.env.BOX_SIZE) as ContainerStartResources,
			env: {
				COMMIT: o.commit,
				SET: o.set,
				CONCURRENCY: String(o.concurrency),
				SUITE: o.suite,
			},
		});
		await this.box.interceptOutboundHttp(
			"host.internal",
			this.ctx.exports.BoxCalls({props: {run}}),
		);
		const row: Row = {...(this.row() as Row), startMs: Date.now() - t0};
		this.put(row);
		await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
		return {row, fresh: true};
	}

	async mark(what: "began" | "told") {
		const row = this.row();
		if (row === undefined || row[what] !== undefined) return;
		this.put({...row, [what]: Date.now() - row.at});
	}

	/** What the box measured so far, read from its own file. Kept, so it outlives the box. */
	async status() {
		const row = this.row();
		if (row === undefined) return {row: null, running: false, progress: null};
		let progress: string | null = null;
		let readError: string | null = null;
		if (this.box.running) {
			try {
				const p = await this.box.exec(["cat", "/w/out/progress.json"]);
				const out = await p.output();
				progress = new TextDecoder().decode(out.stdout);
				if (progress.length > 0) this.put({...(this.row() as Row), last: progress});
			} catch (e) {
				readError = String(e).slice(0, 500);
			}
		}
		const now = this.row() as Row;
		return {
			row: {...now, last: undefined},
			running: this.box.running,
			progress: progress ?? now.last ?? null,
			readError,
		};
	}

	/** The run ends: the box goes now. */
	async stop(why = "asked") {
		const row = this.row();
		if (row !== undefined && row.state === "running")
			this.put({...row, state: "done", ended: {why, at: Date.now() - row.at}});
		await this.ctx.storage.deleteAlarm();
		if (this.box.running) await this.box.destroy();
		return {running: this.box.running};
	}

	/** The beat while the box runs, and the cap. */
	async alarm() {
		const row = this.row();
		if (row?.state !== "running") return;
		if (Date.now() >= row.until) return void (await this.stop("cap"));
		if (!this.box.running) {
			this.put({...row, state: "done", ended: {why: "box stopped", at: Date.now() - row.at}});
			return;
		}
		this.put({...row, beats: row.beats + 1});
		await this.ctx.storage.setAlarm(Date.now() + BEAT_MS);
	}
}

export default {
	async fetch(req: Request, env: Env) {
		const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
		if (auth !== env.SESSION) return new Response("sign in first", {status: 401});
		const url = new URL(req.url);
		const run = url.searchParams.get("run") ?? "";
		if (!/^run:[\w-]+$/.test(run)) return new Response("which run?", {status: 400});
		const stub = env.RUNS.getByName(run);
		if (url.pathname === "/begin" && req.method === "POST")
			return Response.json(await stub.begin(run, (await req.json()) as Begin));
		if (url.pathname === "/status") return Response.json(await stub.status());
		if (url.pathname === "/stop" && req.method === "POST") return Response.json(await stub.stop());
		return new Response("not found", {status: 404});
	},
};
