// Experiment 183: can a running program take new code in the brain and keep its model?
// Today's version is not touched. This is a lab model of `next/`'s brain: a core Durable Object
// in Miniflare keeps the model, and each program version is a pure step loaded by Worker Loader
// under its content hash (experiment 173's shape). Four parts:
//
//   swap     v1 -> v2 (view only) -> v3 (new shape, upcast) -> v4 (refused) -> a module that
//            throws as it loads -> v5 (throws on a step, rolled back). Every answer, and the log.
//   race     200 Msgs at once with a swap in the middle, through the queue and around it.
//   memory   GENS saves in a row (default 60), each a new hash: time per swap, workerd memory.
//   restart  a new Miniflare on the same data folder: is the model and the running code kept?
//
// RUNS (default 5) race runs per mode. GENS (default 60). Nothing deployed, no network out,
// no key, no model, $0. Results: results/183-hmr.json.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Miniflare} from "miniflare";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// esbuild is a dependency of experiment 173's harness, so it is found there.
const {build} = createRequire(here("./173-worker-loader/package.json"))(
	"esbuild",
) as typeof import("esbuild");
const RUNS = Number(process.env.RUNS ?? "5");
const GENS = Number(process.env.GENS ?? "60");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN, 2);
};

const bundle = async (entry: string, version?: string) => {
	const out = await build({
		entryPoints: [here(entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker", "browser", "import"],
		external: ["cloudflare:workers"],
		define: version ? {VERSION: JSON.stringify(version)} : {},
		minify: true,
		logLevel: "silent",
	});
	const code = out.outputFiles[0]?.text ?? "";
	return {code, hash: sha256(code)};
};

const workerdRssMb = (): number => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
		.filter((r) => r.length >= 4);
	const mine = new Set([String(process.pid)]);
	for (let changed = true; changed;) {
		changed = false;
		for (const [pid, ppid] of rows)
			if (pid && ppid && mine.has(ppid) && !mine.has(pid)) {
				mine.add(pid);
				changed = true;
			}
	}
	let kb = 0;
	for (const [pid, , rss, ...comm] of rows)
		if (pid && mine.has(pid) && comm.join(" ").includes("workerd")) kb += Number(rss);
	return round(kb / 1024);
};

const start = (core: string, persist: string) =>
	new Miniflare({
		modules: [{type: "ESModule", path: "core.js", contents: core}],
		compatibilityDate: "2026-07-01",
		durableObjects: {PROCESS: {className: "Process", useSQLite: true}},
		durableObjectsPersist: persist,
		workerLoaders: {LOADER: {}},
	});
type Mf = ReturnType<typeof start>;
const call = async (mf: Mf, pid: string, part: string, body: unknown = {}): Promise<any> => {
	const r = await mf.dispatchFetch(`http://core/p/${pid}/${part}`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	const out: any = await r.json();
	if (out?.error) throw new Error(`${part}: ${out.error}`);
	return out;
};
const plus = (mf: Mf, pid: string, id: string) => call(mf, pid, "msg", {id, msg: {type: "plus"}});

const persist = mkdtempSync(join(tmpdir(), "e183-"));
const results: Record<string, unknown> = {
	when: new Date().toLocaleDateString("en-CA"),
	node: process.version,
};
try {
	const core = (await bundle("183-hmr/core.ts")).code;
	const v = {
		v1: await bundle("183-hmr/versions.ts", "v1"),
		v2: await bundle("183-hmr/versions.ts", "v2"),
		v3: await bundle("183-hmr/versions.ts", "v3"),
		v4: await bundle("183-hmr/versions.ts", "v4"),
		v5: await bundle("183-hmr/versions.ts", "v5"),
		"top-throw": await bundle("183-hmr/versions.ts", "top-throw"),
	};
	results.bytes = Object.fromEntries(Object.entries(v).map(([k, b]) => [k, b.code.length]));

	// A save esbuild cannot read never becomes a hash, so it never reaches the brain.
	writeFileSync(join(persist, "broken.ts"), "export const Program = ;\n");
	try {
		await build({
			entryPoints: [join(persist, "broken.ts")],
			bundle: true,
			write: false,
			logLevel: "silent",
		});
		results.syntaxError = "built";
	} catch (e) {
		const first = (e as {errors?: {text: string; location?: {line: number}}[]}).errors?.[0];
		results.syntaxError = `refused by esbuild: line ${first?.location?.line}: ${first?.text}`;
	}

	let mf = start(core, persist);
	const install = async (pid: string, name: keyof typeof v) => call(mf, pid, "install", v[name]);

	// 1. swap
	{
		const pid = "counter-1";
		for (const name of Object.keys(v) as (keyof typeof v)[]) await install(pid, name);
		const views: Record<string, unknown> = {};
		await call(mf, pid, "boot", {hash: v.v1.hash});
		for (let i = 0; i < 3; i++) await plus(mf, pid, `m${i}`);
		views.v1 = (await call(mf, pid, "read")).view;
		const answers: Record<string, unknown> = {};
		answers.v2 = await call(mf, pid, "load", {hash: v.v2.hash, from: "watch"});
		views.v2 = (await call(mf, pid, "read")).view;
		for (let i = 3; i < 5; i++) await plus(mf, pid, `m${i}`);
		answers.v3 = await call(mf, pid, "load", {hash: v.v3.hash, from: "watch"});
		views.v3 = (await call(mf, pid, "read")).view;
		await plus(mf, pid, "m5");
		answers.v4 = await call(mf, pid, "load", {hash: v.v4.hash, from: "watch"});
		answers.topThrow = await call(mf, pid, "load", {hash: v["top-throw"].hash, from: "watch"});
		answers.v5 = await call(mf, pid, "load", {hash: v.v5.hash, from: "watch"});
		answers.v5step = await plus(mf, pid, "m6");
		const end = await call(mf, pid, "read");
		const short = (h: unknown) => {
			const name = Object.entries(v).find(([, b]) => b.hash === h)?.[0];
			return name ?? h;
		};
		results.swap = {
			answers,
			views,
			end: {model: end.model, running: short(end.hash), view: end.view},
			log: end.log.map((e: any) => {
				const b = {...e.body};
				for (const k of ["hash", "was", "build", "from", "to"])
					if (k in b && k !== "from") b[k] = short(b[k]);
				if (e._tag.startsWith("code.rolled")) b.from = short(e.body.from);
				return `${e.rev} ${e._tag} ${JSON.stringify(b)}`;
			}),
		};
	}

	// 2. race: 200 Msgs at once, a swap to v3 (new shape) after the 100th is sent.
	{
		const out = {queue: [] as unknown[], around: [] as unknown[]};
		for (const mode of ["queue", "around"] as const)
			for (let run = 0; run < RUNS; run++) {
				const pid = `race-${mode}-${run}`;
				await install(pid, "v1");
				await install(pid, "v3");
				await call(mf, pid, "boot", {hash: v.v1.hash});
				const sent: Promise<unknown>[] = [];
				for (let i = 0; i < 200; i++) {
					sent.push(plus(mf, pid, `m${i}`).catch((e) => ({error: String(e).slice(0, 80)})));
					if (i === 99)
						sent.push(
							call(mf, pid, "load", {hash: v.v3.hash, from: "watch", queue: mode === "queue"}),
						);
				}
				await Promise.all(sent);
				const end = await call(mf, pid, "read");
				const steps = end.log.filter((e: any) => e._tag === "stepped");
				const ids = new Set(steps.map((e: any) => e.body.id));
				out[mode].push({
					model: end.model,
					stepped: steps.length,
					distinct: ids.size,
					onOld: steps.filter((e: any) => e.body.build === v.v1.hash).length,
					onNew: steps.filter((e: any) => e.body.build === v.v3.hash).length,
				});
			}
		results.race = out;
	}

	// 3. memory: GENS saves of the view-only change, each a new hash, one step after each.
	{
		const pid = "counter-gens";
		await install(pid, "v2");
		await call(mf, pid, "boot", {hash: v.v2.hash});
		const rss: Record<string, number> = {before: workerdRssMb()};
		const loadMs: number[] = [];
		const firstStepMs: number[] = [];
		for (let g = 1; g <= GENS; g++) {
			const code = `${v.v2.code}\n// gen ${g}\n`;
			const hash = sha256(code);
			await call(mf, pid, "install", {hash, code});
			const t0 = performance.now();
			await call(mf, pid, "load", {hash, from: "watch"});
			const t1 = performance.now();
			await plus(mf, pid, `g${g}`);
			firstStepMs.push(performance.now() - t1);
			loadMs.push(t1 - t0);
			if (g % 10 === 0) rss[`after ${g}`] = workerdRssMb();
		}
		await new Promise((r) => setTimeout(r, 20_000));
		rss["after 20 s idle"] = workerdRssMb();
		const end = await call(mf, pid, "read");
		results.memory = {
			gens: GENS,
			loadMs: {p50: pct(loadMs, 50), p95: pct(loadMs, 95)},
			firstStepMs: {p50: pct(firstStepMs, 50), p95: pct(firstStepMs, 95)},
			rssMb: rss,
			model: end.model,
		};
	}

	// 4. restart: a new workerd on the same data folder.
	{
		await mf.dispose();
		mf = start(core, persist);
		const t0 = performance.now();
		const end = await call(mf, "counter-1", "read");
		results.restart = {
			firstReadMs: round(performance.now() - t0),
			model: end.model,
			running: end.hash === v.v3.hash ? "v3" : end.hash,
			view: end.view,
		};
	}
	await mf.dispose();
} finally {
	rmSync(persist, {recursive: true, force: true});
}

writeFileSync(here("results/183-hmr.json"), `${JSON.stringify(results, null, "\t")}\n`);
console.log(JSON.stringify(results, null, 2));
