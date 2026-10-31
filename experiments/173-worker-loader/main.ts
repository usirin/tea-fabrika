// Experiment 173's driver, run from ../173-worker-loader.ts. The hands side (Node) bundles the
// program with esbuild and keys it by sha256; Miniflare runs the core (`core.ts`), which loads
// that code with Worker Loader. Everything stays on this machine: no deploy, no network out.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {build} from "esbuild";
import {Miniflare} from "miniflare";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("../results/173-worker-loader.json");
const STEPS = Number(process.env.STEPS ?? "1000");
const COLD = Number(process.env.COLD ?? "20");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN;
};
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const summary = (xs: number[]) => ({
	p50: round(pct(xs, 50)),
	p95: round(pct(xs, 95)),
	mean: round(xs.reduce((a, b) => a + b, 0) / xs.length),
	n: xs.length,
});

/** One bundle, the way a Worker Loader takes it: one ES module, cloudflare:* left to the runtime. */
const bundle = async (entry: string, minify: boolean) => {
	const t0 = performance.now();
	const out = await build({
		entryPoints: [here(entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker", "browser", "import"],
		external: ["cloudflare:workers", "cloudflare:sockets"],
		minify,
		legalComments: "none",
		logLevel: "silent",
		metafile: true,
	});
	const ms = performance.now() - t0;
	const code = out.outputFiles[0]?.text ?? "";
	// What the bytes are: the output's share of each package, biggest first.
	const by: Record<string, number> = {};
	for (const o of Object.values(out.metafile.outputs))
		for (const [path, {bytesInOutput}] of Object.entries(o.inputs)) {
			const m = path.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
			const name = m?.[1] ?? (path.includes("packages/fabrika") ? "@kampus/fabrika" : "own code");
			by[name] = (by[name] ?? 0) + bytesInOutput;
		}
	const parts = Object.fromEntries(
		Object.entries(by)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5),
	);
	return {
		code,
		hash: sha256(code),
		ms: round(ms, 1),
		bytes: Buffer.byteLength(code),
		gzip: gzipSync(code).length,
		parts,
	};
};

const workerdRssKb = (): number => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
		.filter((r) => r.length >= 4);
	const mine = new Set([String(process.pid)]);
	let total = 0;
	// Walk the tree under this Node process; count every workerd in it.
	for (let changed = true; changed; ) {
		changed = false;
		for (const [pid, ppid] of rows)
			if (pid && ppid && mine.has(ppid) && !mine.has(pid)) {
				mine.add(pid);
				changed = true;
			}
	}
	for (const [pid, , rss, ...comm] of rows)
		if (pid && mine.has(pid) && comm.join(" ").includes("workerd")) total += Number(rss);
	return total;
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
const call = async (mf: Mf, pid: string, part: string, body: unknown): Promise<any> => {
	const r = await mf.dispatchFetch(`http://core/p/${pid}/${part}`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	const out: any = await r.json();
	if (out?.error) throw new Error(`${part}: ${out.error}`);
	return out;
};

export const main = async () => {
	const results: Record<string, unknown> = {
		when: new Date().toISOString().slice(0, 10),
		versions: {node: process.version},
	};

	// 1. The hands bundle the program.
	const first = await bundle("program.ts", false);
	const plain = await bundle("program.ts", false);
	const small = await bundle("program.ts", true);
	const counter = await bundle("counter-entry.ts", true);
	const core = await bundle("core.ts", false);
	results.bundle = {
		tally: {
			bytes: plain.bytes,
			gzip: plain.gzip,
			firstBuildMs: first.ms,
			warmBuildMs: plain.ms,
			hash: plain.hash,
			sameBytesTwice: first.hash === plain.hash,
			parts: plain.parts,
		},
		tallyMinified: {
			bytes: small.bytes,
			gzip: small.gzip,
			buildMs: small.ms,
			hash: small.hash,
			parts: small.parts,
		},
		programsCounterMinified: {
			bytes: counter.bytes,
			gzip: counter.gzip,
			buildMs: counter.ms,
			parts: counter.parts,
		},
		core: {bytes: core.bytes, buildMs: core.ms},
	};
	console.log("bundle", JSON.stringify(results.bundle, null, 1));

	const persist = mkdtempSync(join(tmpdir(), "exp173-"));
	let mf = start(core.code, persist);
	try {
		const install = async (pid: string, b: {code: string; hash: string}, program = "tally") =>
			call(mf, pid, "install", {program, hash: b.hash, code: b.code});

		// The core refuses code whose hash is not its sha256.
		results.hashCheck = await call(mf, "a", "install", {
			program: "tally",
			hash: plain.hash,
			code: `${plain.code}\n// changed`,
		});
		await install("a", plain);
		await install("a", small);

		// 2a. Cold loads: each variant is new code, so a new hash and a new isolate.
		const variants = (b: {code: string}, tag: string) =>
			Array.from({length: COLD}, (_, i) => {
				const code = `${b.code}\n// ${tag} ${i}\n`;
				return {code, hash: sha256(code)};
			});
		const plainVariants = variants(plain, "plain");
		const smallVariants = variants(small, "small");
		for (const v of [...plainVariants, ...smallVariants]) await install("cold", v);
		// workerd is up, the core loaded, no program isolate yet.
		const rss0 = workerdRssKb();
		const coldPlain = await call(mf, "cold", "cold", {hashes: plainVariants.map((v) => v.hash)});
		const coldSmall = await call(mf, "cold", "cold", {hashes: smallVariants.map((v) => v.hash)});
		const rssCold = workerdRssKb();
		results.load = {
			coldMs: summary(coldPlain.ms),
			coldMinifiedMs: summary(coldSmall.ms),
			warm: await call(mf, "a", "warm", {hash: plain.hash, times: 1000}),
			workerdRssKb: {
				before: rss0,
				after: rssCold,
				isolates: 2 * COLD,
				perIsolateKb: Math.round((rssCold - rss0) / (2 * COLD)),
			},
		};
		console.log("load", JSON.stringify(results.load, null, 1));

		// Two processes on one version: do they meet one isolate? Each keeps its code itself.
		await install("x", plain);
		await install("y", plain);
		const [x, y] = [
			await call(mf, "x", "which", {hash: plain.hash}),
			await call(mf, "y", "which", {hash: plain.hash}),
		];
		results.shared = {x, y, oneIsolate: x.born === y.born && y.calls > x.calls};
		console.log("shared", JSON.stringify(results.shared));

		// 2b. Steps in a loop inside the object, by model size. The clock ticks in whole ms, so
		// the direct loop runs 100 times as many steps to be seen at all.
		const bench: Record<string, unknown> = {};
		for (const pad of [0, 10_000, 100_000])
			for (const mode of ["direct", "isolate"]) {
				const steps = mode === "direct" ? STEPS * 100 : STEPS;
				const runs = [];
				for (let r = 0; r < 3; r++)
					runs.push(await call(mf, "a", "bench", {hash: plain.hash, steps, pad, mode}));
				bench[`${mode} pad ${pad}`] = {
					steps,
					perStepUs: runs.map((x) => round(x.perStepUs, 2)),
					n: runs[0].n,
				};
			}
		{
			const runs = [];
			for (let r = 0; r < 3; r++)
				runs.push(
					await call(mf, "f", "bench", {hash: plain.hash, steps: STEPS, pad: 0, mode: "facet"}),
				);
			bench["facet pad 0 (a SQLite write each step)"] = {
				perStepUs: runs.map((x) => round(x.perStepUs, 1)),
			};
		}
		results.benchInObject = bench;
		console.log("bench", JSON.stringify(bench, null, 1));

		// 2c. One step at a time from outside, so each step has its own clock reading. The modes
		// take turns, so a slow moment of the machine lands on all of them alike.
		const modes = ["noop", "direct", "isolate", "facet"];
		const times: Record<string, number[]> = {};
		for (const mode of modes) {
			times[mode] = [];
			await install(`one-${mode}`, plain);
			await call(mf, `one-${mode}`, "start", {program: "tally", hash: plain.hash});
			for (let i = 0; i < 50; i++)
				await call(mf, `one-${mode}`, "one", {mode, msg: {type: "plus"}});
		}
		for (let i = 0; i < STEPS; i++)
			for (const mode of modes) {
				const t0 = performance.now();
				await call(mf, `one-${mode}`, "one", {mode, msg: {type: "plus"}});
				times[mode]?.push(performance.now() - t0);
			}
		const single = Object.fromEntries(modes.map((m) => [m, summary(times[m] ?? [])]));
		results.singleStepFromNodeMs = single;
		console.log("single", JSON.stringify(single, null, 1));

		// 3. What the loaded code can reach.
		results.isolation = await call(mf, "a", "probe", {hash: plain.hash});
		console.log("isolation", JSON.stringify(results.isolation, null, 1));

		// A program that spins for 300 ms: how long does a step of its own process wait, and
		// one of another process? Both processes run in this one workerd.
		{
			const timed = async (f: () => Promise<unknown>) => {
				const t0 = performance.now();
				await f();
				return round(performance.now() - t0, 1);
			};
			const spinning = timed(() => call(mf, "one-isolate", "spin", {hash: plain.hash, ms: 300}));
			await new Promise((r) => setTimeout(r, 30));
			const [same, other, otherDirect, spun] = await Promise.all([
				timed(() => call(mf, "one-isolate", "one", {mode: "noop", msg: {}})),
				timed(() => call(mf, "one-facet", "one", {mode: "isolate", msg: {type: "plus"}})),
				timed(() => call(mf, "one-direct", "one", {mode: "direct", msg: {type: "plus"}})),
				spinning,
			]);
			results.spin = {
				spinMs: spun,
				sameProcessNoopMs: same,
				otherProcessIsolateStepMs: other,
				otherProcessDirectStepMs: otherDirect,
			};
			console.log("spin", JSON.stringify(results.spin));
		}

		// 5. The Effect engine inside the isolate; the schema at the line.
		results.effect = await call(mf, "a", "effect", {
			hash: plain.hash,
			msgs: [{type: "plus"}, {type: "add", by: 41}],
		});
		console.log("effect", JSON.stringify(results.effect, null, 1));

		// The repo's own programs/counter, bundled whole.
		await install("c", counter, "counter");
		results.programsCounter = await call(mf, "c", "counter", {hash: counter.hash});
		console.log("counter", JSON.stringify(results.programsCounter, null, 1));

		// 4. Facets: the program's own SQLite, an upgrade, and a restart.
		const next = {code: `${plain.code}\n// next version\n`, hash: ""};
		next.hash = sha256(next.code);
		await install("s", plain);
		await install("s", next);
		const facets = await call(mf, "s", "facets", {hash: plain.hash, next: next.hash, steps: 5});
		await mf.dispose();
		const t0 = performance.now();
		mf = start(core.code, persist);
		const afterRestart = await call(mf, "s", "facetRead", {hash: next.hash});
		results.facets = {
			...facets,
			afterRestart,
			firstCallAfterRestartMs: round(performance.now() - t0, 1),
		};
		console.log("facets", JSON.stringify(results.facets, null, 1));
	} finally {
		await mf.dispose();
		rmSync(persist, {recursive: true, force: true});
	}
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(`saved ${RESULTS.split("/").slice(-2).join("/")}`);
};
