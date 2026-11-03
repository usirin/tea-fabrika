// Experiment 199: one live standard-4 box on Cloudflare runs 181's fixed-seed mutation sample (the
// `ship121` set: 121's 150 ship mutants, drawn with seed 119120) and the whole suite once, under
// 148's beat, and the same sample runs on this laptop for the speed comparison. No model is called.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY node experiments/199-box-live-run.ts rehearse
//     the box image built here (arm64) and run in local Docker on a small set, to check the program
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/199-box-live-run.ts laptop
//     the same sample on this laptop, 3 workers, in a throwaway worktree at the same commit
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/199-box-live-run.ts plan|live|sweep
//     the live part (199-box-live-run/live.ts): the dry step, the run, or only the cleanup
//
// The second live run, and its laptop twin:
//   SET=auto SUITE=skip RUN=2 COMMIT=<sha> ... node experiments/199-box-live-run.ts live
//   SET=lane139 COMMIT=<sha> ... nice -n 15 node experiments/199-box-live-run.ts laptop
//
// Every mode takes COMMIT (default: origin/main). Before a Docker build or the laptop sample it
// waits while the laptop's 1-minute load is above 8. Results go to experiments/results/199-*.json,
// with machine paths taken out.
//
// Node at the edge, said here: child_process for git, docker, pnpm and the 181 script.
import {execFileSync, spawn} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {loadavg, tmpdir} from "node:os";
import {join} from "node:path";

const here = join(import.meta.dirname, "199-box-live-run");
const root = join(import.meta.dirname, "..");
const resultsDir = join(import.meta.dirname, "results");
const mode = process.argv[2] ?? "";
/** The laptop sample's set: ship121 by default, lane139 for the second live run's comparison. */
const SET = process.env.SET ?? "ship121";
const commit =
	process.env.COMMIT ??
	execFileSync("git", ["rev-parse", "origin/main"], {cwd: root, encoding: "utf8"}).trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const home = process.env.HOME ?? "/nonexistent-home";
const scrubPaths = (s: string, extra: readonly string[] = []) => {
	let out = s;
	for (const p of [...extra, root, home]) out = out.split(p).join(p === home ? "~" : "<copy>");
	return out;
};

/** The laptop is in use: wait while the 1-minute load is above 8. */
const gentle = async (what: string) => {
	for (;;) {
		const one = loadavg()[0] ?? 0;
		if (one <= 8) return one;
		console.log(`${what}: load ${one.toFixed(1)}, waiting`);
		await wait(30_000);
	}
};

const run = (
	cmd: string,
	args: readonly string[],
	opts: {cwd?: string; env?: NodeJS.ProcessEnv} = {},
) =>
	new Promise<{code: number; out: string; ms: number}>((resolve) => {
		const t = Date.now();
		const c = spawn(cmd, args, {
			cwd: opts.cwd ?? root,
			env: opts.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		c.stdout.on("data", (d) => (out += d));
		c.stderr.on("data", (d) => (out += d));
		c.on("close", (code) => resolve({code: code ?? -1, out, ms: Date.now() - t}));
	});

/** Stryker's JSON report, cut down as the box program does it (box/run-all.mjs). */
const summarize = (file: string) => {
	type M = {
		mutatorName: string;
		status: string;
		duration?: number;
		static?: boolean;
		testsCompleted?: number;
		location: {start: {line: number; column: number}};
	};
	const r = JSON.parse(readFileSync(file, "utf8")) as {files: Record<string, {mutants: M[]}>};
	const rows = Object.entries(r.files).flatMap(([f, e]) =>
		e.mutants.map((m) => ({
			file: f.replace(/^.*?(?=(packages|programs|apps|wip|legacy)\/)/, ""),
			line: m.location.start.line,
			column: m.location.start.column,
			mutator: m.mutatorName,
			status: m.status,
			ms: m.duration ?? null,
			static: m.static === true,
			tests: m.testsCompleted ?? null,
		})),
	);
	const byStatus: Record<string, number> = {};
	for (const x of rows) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
	const ran = rows.filter((x) => x.status !== "Ignored");
	return {
		mutants: rows.length,
		ran: ran.length,
		byStatus,
		static: rows.filter((x) => x.static).length,
		mutantMs: ran.reduce((s, x) => s + (x.ms ?? 0), 0),
		rows,
	};
};

/** The box program in local Docker, on a small set: does every phase run and report? */
const rehearse = async () => {
	const name = "tf-exp-199-rehearse";
	const docker = (...a: string[]) => execFileSync("docker", a, {encoding: "utf8"}).trim();
	await gentle("docker build");
	const built = await run("nice", [
		"-n",
		"15",
		"docker",
		"build",
		"-q",
		"-t",
		name,
		join(here, "box"),
	]);
	if (built.code !== 0) throw new Error(built.out.slice(-2000));
	const results: Record<string, unknown> = {
		date: new Date().toLocaleDateString("en-CA"),
		commit,
		buildMs: built.ms,
	};
	try {
		docker(
			"run",
			"-d",
			"--name",
			name,
			"--cpus",
			"3",
			"--memory",
			"6g",
			"-e",
			`COMMIT=${commit}`,
			"-e",
			"SET=lane139",
			"-e",
			"CONCURRENCY=2",
			"-e",
			"SUITE=packages/pipeline/src/stages/mutation/scope.test.ts",
			"-e",
			"HOLD_MS=600000",
			name,
		);
		let p: {done?: boolean; now?: string} = {};
		for (let i = 0; i < 180 && p.done !== true; i++) {
			await wait(10_000);
			try {
				p = JSON.parse(docker("exec", name, "cat", "/w/out/progress.json"));
				console.log(new Date().toISOString().slice(11, 19), "now", p.now, "done", p.done);
			} catch {
				// not written yet
			}
		}
		results.box = p;
	} finally {
		try {
			docker("rm", "-f", name);
			docker("rmi", "-f", name);
		} catch {}
	}
	writeFileSync(
		join(resultsDir, "199-box-live-run-rehearsal.json"),
		`${scrubPaths(JSON.stringify(results, null, "\t"))}\n`,
	);
	console.log(JSON.stringify(results).slice(0, 3000));
};

/**
 * The same sample on this laptop: a throwaway worktree at the same commit, its own install, 181's
 * `sets` and `run ship121 fast` with 3 workers. Memory: every second, the summed RSS of the
 * processes whose command line names the copy, which is Stryker, its vitest workers and their
 * children.
 */
const laptop = async () => {
	// The real path: on macOS the temp folder is behind a link, and 181's ignorer compares Babel's real
	// file names with the folder it is given, so through the link every mutant was "not picked".
	const copy = mkdtempSync(join(realpathSync(tmpdir()), "tf199-"));
	const out = mkdtempSync(join(tmpdir(), "tf199-out-"));
	rmSync(copy, {recursive: true, force: true});
	const results: Record<string, unknown> = {date: new Date().toLocaleDateString("en-CA"), commit};
	const env = {...process.env, OUT: out, CI: "true"};
	try {
		const add = await run("git", ["worktree", "add", "--detach", copy, commit]);
		if (add.code !== 0) throw new Error(add.out);
		const install = await run("pnpm", ["install", "--frozen-lockfile"], {cwd: copy, env});
		results.install = {ms: install.ms, code: install.code, note: "warm pnpm store on the laptop"};
		const sets = await run("node", ["experiments/181-fast-and-daily-mutation.ts", "sets", copy], {
			cwd: copy,
			env,
		});
		results.sets = {ms: sets.ms, code: sets.code, out: sets.out.trim().slice(-300)};
		const load = await gentle("laptop sample");
		const stream = join(out, "stream.jsonl");
		let peakKiB = 0;
		const loads: number[] = [];
		const sampler = setInterval(() => {
			try {
				const ps = execFileSync("ps", ["-A", "-o", "rss=,args="], {
					encoding: "utf8",
					maxBuffer: 1 << 26,
				});
				const kib = ps
					.split("\n")
					.filter((l) => l.includes(copy))
					.reduce((s, l) => s + Number(l.trim().split(/\s+/)[0] ?? 0), 0);
				peakKiB = Math.max(peakKiB, kib);
				loads.push(loadavg()[0] ?? 0);
			} catch {}
		}, 1000);
		const t = Date.now();
		const sample = await run(
			"/usr/bin/time",
			["-l", "node", "experiments/181-fast-and-daily-mutation.ts", "run", copy, SET, "fast"],
			{cwd: copy, env: {...env, EXTRA: JSON.stringify({concurrency: 3}), STREAM: stream}},
		);
		clearInterval(sampler);
		const answers = readFileSync(stream, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as {at: number});
		const rusage = (k: string) =>
			Number(new RegExp(`([\\d.]+)\\s+${k}`).exec(sample.out)?.[1] ?? Number.NaN);
		results.sample = {
			code: sample.code,
			wallMs: sample.ms,
			userS: rusage("user"),
			sysS: rusage("sys"),
			largestProcessRssBytes: rusage("maximum resident set size"),
			copyRssPeakKiB: peakKiB,
			loadAtStart: load,
			loadMean: loads.reduce((s, x) => s + x, 0) / Math.max(1, loads.length),
			loadMax: Math.max(...loads),
			firstAnswerMs: answers.length > 0 ? (answers[0]?.at ?? t) - t : null,
			lastAnswerMs: answers.length > 0 ? (answers.at(-1)?.at ?? t) - t : null,
			answers: answers.length,
			report: summarize(join(out, `report-${SET}-fast.json`)),
			laptop: {
				cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {encoding: "utf8"}).trim(),
				cores: Number(execFileSync("sysctl", ["-n", "hw.ncpu"], {encoding: "utf8"}).trim()),
				memGiB:
					Number(execFileSync("sysctl", ["-n", "hw.memsize"], {encoding: "utf8"}).trim()) / 2 ** 30,
			},
		};
	} finally {
		await run("git", ["worktree", "remove", "--force", copy]);
		await run("git", ["worktree", "prune"]);
		rmSync(copy, {recursive: true, force: true});
		rmSync(out, {recursive: true, force: true});
	}
	mkdirSync(resultsDir, {recursive: true});
	writeFileSync(
		join(resultsDir, `199-box-live-run-laptop${SET === "ship121" ? "" : `-${SET}`}.json`),
		`${scrubPaths(JSON.stringify(results, null, "\t"), [copy, out])}\n`,
	);
	const {report: _r, ...small} = results.sample as Record<string, unknown>;
	console.log(scrubPaths(JSON.stringify({...results, sample: small}), [copy, out]));
};

if (mode === "rehearse") await rehearse();
else if (mode === "laptop") await laptop();
else if (mode === "plan" || mode === "live" || mode === "sweep") {
	// Alchemy reads the working folder once, as it loads (experiment 147), and would read a `.env`
	// there: so first a fresh, empty temp folder, then Alchemy.
	const work = mkdtempSync(join(tmpdir(), "tf-exp-199-"));
	process.chdir(work);
	process.env.ALCHEMY_HOME = join(work, "alchemy-home");
	process.env.DO_NOT_TRACK = "1";
	process.env.COMMIT = commit;
	if (mode === "live") await gentle("docker build for the deploy");
	await import("./199-box-live-run/live.ts");
} else console.log("rehearse | laptop | plan | live | sweep");
