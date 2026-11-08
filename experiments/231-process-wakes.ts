// Experiment 231: when a program's Durable Object is built again, does the saved activity marker,
// and not the constructor, tell an idle wake from interrupted work? P33's first step (ticket 252).
// Local only: Miniflare and its workerd, a made-up program, no network, no key, no model.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/231-process-wakes.ts
//
// One object plays one program (`counter:1`). It saves P33's `Activity` marker (`idle` or
// `stepping`) and, in its constructor, counts its own constructions in storage. Each case puts
// the object in a state, makes something happen to it (an eviction, `ctx.abort()`, a thrown step,
// a workerd restart, a workerd kill), then reads the marker back and hands it to next/'s own
// `recoverActivity`. The rule passes a case when the recovered answer is the one the case
// expects; the plant ("a constructor ran, so it crashed") is scored beside it.
//
// Prints one JSON line per case and a summary. Writes only to a temp folder, removed after.
// Node at the edge, said here: child_process for ps and kill, fs for the temp folder.
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Result} from "effect";
import {Miniflare} from "miniflare";
import {recoverActivity} from "../next/packages/libfabrika/src/coordination/process.ts";

const NAME = "counter:1";
const P = "process_01h455vb4pex5vsknk084sn02q";
const STEP = "?letter=letter-17&build=build-a";
const root = mkdtempSync(join(tmpdir(), "x231-"));

const worker = `
export class Program {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.instance = crypto.randomUUID();
		ctx.blockConcurrencyWhile(async () => {
			const n = ((await ctx.storage.get("constructions")) ?? 0) + 1;
			await ctx.storage.put("constructions", n);
			this.n = n;
		});
	}
	async fetch(request) {
		const url = new URL(request.url);
		const s = this.ctx.storage;
		const q = (k) => url.searchParams.get(k);
		const stepping = () => ({_tag: "stepping", process: q("process"), letter: q("letter"), build: q("build")});
		switch (url.pathname) {
			case "/init":
				await s.put("activity", {_tag: "idle", process: q("process")});
				break;
			case "/corrupt":
				await s.put("activity", {_tag: "stepping", process: q("process")});
				break;
			case "/abort":
				this.ctx.abort(new Error("probe abort"));
				break;
			case "/step": {
				await s.put("activity", stepping());
				await new Promise((r) => setTimeout(r, Number(q("ms"))));
				await s.put("activity", {_tag: "idle", process: q("process")});
				break;
			}
			case "/step-throw":
				await s.put("activity", stepping());
				throw new Error("probe step failed");
			case "/step-abort-now":
				s.put("activity", stepping());
				this.ctx.abort(new Error("probe abort in the same turn"));
				break;
			case "/step-abort-awaited":
				await s.put("activity", stepping());
				this.ctx.abort(new Error("probe abort after an awaited put"));
				break;
			case "/step-tick-abort":
				await s.put("activity", stepping());
				await new Promise((r) => setTimeout(r, 10));
				this.ctx.abort(new Error("probe abort 10 ms after an awaited put"));
				break;
			case "/step-sync-abort":
				await s.put("activity", stepping());
				await s.sync();
				this.ctx.abort(new Error("probe abort after storage.sync()"));
				break;
		}
		const body = {
			instance: this.instance,
			constructions: await s.get("constructions"),
			activity: (await s.get("activity")) ?? null,
		};
		return Response.json(body);
	}
}
export default {
	fetch(request, env) {
		return env.PROGRAM.get(env.PROGRAM.idFromName(${JSON.stringify(NAME)})).fetch(request);
	},
};
`;

const start = () =>
	new Miniflare({
		name: "probe",
		modules: true,
		script: worker,
		compatibilityDate: "2026-07-01",
		durableObjects: {PROGRAM: {className: "Program", useSQLite: true}},
		defaultPersistRoot: root,
	});

type Seen = {instance: string; constructions: number; activity: unknown};
let mf = start();
const call = async (path: string): Promise<Seen | {error: string}> => {
	try {
		const res = await mf.dispatchFetch(`http://probe${path}`);
		const text = await res.text();
		return res.ok ? (JSON.parse(text) as Seen) : {error: `${res.status} ${text.slice(0, 80)}`};
	} catch (e) {
		return {error: String(e instanceof Error ? e.message : e).slice(0, 80)};
	}
};
const read = async (): Promise<Seen> => {
	const seen = await call(`/state?process=${P}`);
	if ("error" in seen) throw new Error(`read failed: ${seen.error}`);
	return seen;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evict = () => mf.unsafeEvictDurableObject("probe", "Program", {name: NAME});
const workerdPids = () =>
	execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
		.filter(([, ppid, comm]) => Number(ppid) === process.pid && (comm ?? "").includes("workerd"))
		.map(([pid]) => Number(pid));
const restart = async (how: "dispose" | "kill") => {
	if (how === "kill") for (const pid of workerdPids()) process.kill(pid, "SIGKILL");
	await mf.dispose().catch(() => undefined);
	mf = start();
	await mf.ready;
};

type Expect = "idle" | "interrupted" | "bad_row";
const recover = (raw: unknown): string => {
	const r = recoverActivity(raw);
	return Result.isSuccess(r) ? r.success._tag : r.failure.why;
};
const rows: Array<Record<string, unknown>> = [];
const run = async (
	name: string,
	expect: Expect,
	setup: () => Promise<unknown>,
	event: () => Promise<unknown>,
) => {
	await setup();
	const before = await read();
	const t0 = performance.now();
	const said = await event();
	const after = await read();
	const got = recover(after.activity);
	const constructed = after.instance !== before.instance;
	const row = {
		case: name,
		constructed,
		constructions: `${before.constructions} -> ${after.constructions}`,
		event: said !== undefined && typeof said === "object" && "error" in said ? said : "ok",
		activity: after.activity,
		recovered: got,
		expect,
		rule: got === expect ? "pass" : "FAIL",
		plant: constructed ? "crash" : "no crash",
		plantRight: (constructed ? "interrupted" : "idle") === expect,
		ms: Math.round(performance.now() - t0),
	};
	rows.push(row);
	console.log(JSON.stringify(row));
};

const idle = () => call(`/init?process=${P}`);
const stepFor = (ms: number) => {
	const pending = call(`/step${STEP}&process=${P}&ms=${ms}`);
	return wait(300).then(() => pending);
};

try {
	const req = createRequire(import.meta.resolve("miniflare"));
	const version = (p: string) =>
		(JSON.parse(readFileSync(req.resolve(p), "utf8")) as {version: string}).version;
	console.log(
		JSON.stringify({
			date: new Date().toISOString().slice(0, 10),
			node: process.version,
			miniflare: version("miniflare/package.json"),
			workerd: version("workerd/package.json"),
		}),
	);
	await mf.ready;

	await run("plain request, no wake", "idle", idle, () => call(`/state?process=${P}`));
	await run("idle, evicted (workerd's unsafe evict)", "idle", idle, evict);
	await run("idle, left 15 s with no request", "idle", idle, () => wait(15_000));
	await run("idle, ctx.abort()", "idle", idle, () => call("/abort"));
	await run("step done normally", "idle", idle, () => call(`/step${STEP}&process=${P}&ms=50`));
	await run("mid-step, ctx.abort() from a second request", "interrupted", idle, async () => {
		const pending = call(`/step${STEP}&process=${P}&ms=30000`);
		await wait(300);
		await call("/abort");
		return pending;
	});
	await run("mid-step, evicted", "interrupted", idle, async () => {
		const pending = call(`/step${STEP}&process=${P}&ms=30000`);
		await wait(300);
		await evict();
		return pending;
	});
	await run("step throws (no reset expected)", "interrupted", idle, () =>
		call(`/step-throw${STEP}&process=${P}`),
	);
	await run("ctx.abort() after an awaited put", "interrupted", idle, () =>
		call(`/step-abort-awaited${STEP}&process=${P}`),
	);
	await run("ctx.abort() in the same turn as the put", "interrupted", idle, () =>
		call(`/step-abort-now${STEP}&process=${P}`),
	);
	// Follow-ups, added after the first run lost the marker in the two cases above.
	await run("ctx.abort() 10 ms after an awaited put", "interrupted", idle, () =>
		call(`/step-tick-abort${STEP}&process=${P}`),
	);
	await run("ctx.abort() after an awaited put and storage.sync()", "interrupted", idle, () =>
		call(`/step-sync-abort${STEP}&process=${P}`),
	);
	await run("idle, workerd restarted (dispose, new Miniflare)", "idle", idle, () =>
		restart("dispose"),
	);
	await run("idle, workerd killed (SIGKILL)", "idle", idle, () => restart("kill"));
	await run("mid-step, workerd killed (SIGKILL)", "interrupted", idle, async () => {
		void stepFor(30_000);
		await wait(300);
		await restart("kill");
	});
	await run("bad marker saved", "bad_row", () => call(`/corrupt?process=${P}`), evict);

	const pass = rows.filter((r) => r.rule === "pass").length;
	const plant = rows.filter((r) => r.plantRight).length;
	console.log(JSON.stringify({cases: rows.length, rulePasses: pass, plantRight: plant}));
} finally {
	await mf.dispose().catch(() => undefined);
	rmSync(root, {recursive: true, force: true});
}
