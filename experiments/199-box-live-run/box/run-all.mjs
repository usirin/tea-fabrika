// Experiment 199's box program: the box's one process. It runs the daily check's phases one after
// another, in a fresh box, and measures each:
//
//   clone    git clone --filter=blob:none of the public repo, no token, then the commit it is given
//   install  pnpm install --frozen-lockfile, as CI does
//   sets     181's `sets`: the planted bugs of 121's seed-119120 sample, found again in today's code
//   sample   181's `run <set> fast`: one real Stryker run of that sample, CONCURRENCY workers
//   suite    the whole vitest suite once
//
// Per phase: wall time, the box's CPU seconds (from /proc/stat), GNU time's user and system time and
// largest process, and the box's memory peak (from /proc/meminfo and the cgroup, sampled each second).
// Everything goes to /w/out/progress.json, which the box's Durable Object reads with `exec`. When
// done the box stays up (HOLD_MS) so that file can be read, until its object destroys it.
//
// It holds nothing secret: no token, no key. Its environment is REPO, COMMIT and the knobs below.
import {spawn} from "node:child_process";
import {mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import os from "node:os";

const REPO = process.env.REPO ?? "https://github.com/usirin/tea-fabrika";
const COMMIT = process.env.COMMIT ?? "";
const SET = process.env.SET ?? "ship121";
const ARM = process.env.ARM ?? "fast";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "4");
/** "all", "skip", or test files separated by spaces. */
const SUITE = process.env.SUITE ?? "all";
const HOLD_MS = Number(process.env.HOLD_MS ?? String(20 * 60_000));
const OUT = "/w/out";
const OUT181 = "/w/out181";
const DIR = "/w/repo";
mkdirSync(OUT, {recursive: true});
mkdirSync(OUT181, {recursive: true});

const t0 = Date.now();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => {
	try {
		return readFileSync(f, "utf8");
	} catch {
		return null;
	}
};
const num = (f) => {
	const t = read(f);
	return t === null || t.trim() === "max" ? null : Number(t.trim());
};

/** /proc/stat's first line, in ticks of 1/100 s (USER_HZ). */
const stat = () => {
	const [user, nice, system, idle, iowait, irq, softirq, steal] = (read("/proc/stat") ?? "")
		.split("\n")[0]
		.trim()
		.split(/\s+/)
		.slice(1)
		.map(Number);
	return {busy: user + nice + system + irq + softirq, idle: idle + iowait, steal: steal ?? 0};
};
const meminfo = () => {
	const m = Object.fromEntries(
		(read("/proc/meminfo") ?? "")
			.split("\n")
			.map((l) => /^(\w+):\s+(\d+)/.exec(l))
			.filter(Boolean)
			.map((x) => [x[1], Number(x[2])]),
	);
	return {
		totalKiB: m.MemTotal,
		usedKiB: m.MemTotal - m.MemAvailable,
		swapUsedKiB: (m.SwapTotal ?? 0) - (m.SwapFree ?? 0),
	};
};

const state = {
	commit: COMMIT,
	set: SET,
	arm: ARM,
	concurrency: CONCURRENCY,
	box: {
		cpus: os.cpus().length,
		parallelism: os.availableParallelism(),
		model: os.cpus()[0]?.model ?? null,
		mhz: os.cpus()[0]?.speed ?? null,
		kernel: os.release(),
		memTotalKiB: meminfo().totalKiB,
		cgroupMax: read("/sys/fs/cgroup/memory.max")?.trim() ?? null,
		cgroupCpuMax: read("/sys/fs/cgroup/cpu.max")?.trim() ?? null,
		node: process.version,
		user: os.userInfo().username,
	},
	phases: [],
	now: null,
	timeline: [],
	done: false,
	error: null,
	upMs: 0,
};
const save = () => {
	state.upMs = Date.now() - t0;
	writeFileSync(`${OUT}/progress.tmp`, JSON.stringify(state));
	renameSync(`${OUT}/progress.tmp`, `${OUT}/progress.json`);
};

// The sampler: memory each second, kept per phase; a coarse timeline every 10 s.
let current = null;
let ticks = 0;
setInterval(() => {
	const m = meminfo();
	const cg = num("/sys/fs/cgroup/memory.current");
	if (current !== null) {
		current.memPeakKiB = Math.max(current.memPeakKiB ?? 0, m.usedKiB);
		current.swapPeakKiB = Math.max(current.swapPeakKiB ?? 0, m.swapUsedKiB);
		if (cg !== null) current.cgroupPeakBytes = Math.max(current.cgroupPeakBytes ?? 0, cg);
		current.loadPeak = Math.max(current.loadPeak ?? 0, os.loadavg()[0]);
	}
	if (ticks++ % 10 === 0) {
		state.timeline.push([Math.round((Date.now() - t0) / 1000), Math.round(m.usedKiB / 1024)]);
		save();
	}
}, 1000).unref();

/** One phase under GNU time, its output to /w/out/<name>.log. */
const phase = (name, cmd, args, opts = {}) =>
	new Promise((resolve) => {
		const p = {name, startMs: Date.now() - t0};
		current = p;
		state.now = name;
		state.phases.push(p);
		save();
		const s0 = stat();
		let log = "";
		const child = spawn(
			"/usr/bin/time",
			["-o", `${OUT}/${name}.time`, "-f", "%e %U %S %M", cmd, ...args],
			{
				cwd: opts.cwd ?? "/w",
				env: {...process.env, ...(opts.env ?? {})},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const keep = (d) => {
			log += d.toString("utf8");
			if (log.length > 4_000_000) log = log.slice(-2_000_000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		child.on("close", (code) => {
			const s1 = stat();
			const [wallS, userS, sysS, maxRssKiB] = (read(`${OUT}/${name}.time`) ?? "")
				.trim()
				.split("\n")
				.at(-1)
				.split(" ")
				.map(Number);
			Object.assign(p, {
				code,
				wallMs: Date.now() - t0 - p.startMs,
				boxCpuS: (s1.busy - s0.busy) / 100,
				boxIdleS: (s1.idle - s0.idle) / 100,
				stealS: (s1.steal - s0.steal) / 100,
				time: {wallS, userS, sysS, maxRssKiB},
				tail: log.slice(-1500),
			});
			writeFileSync(`${OUT}/${name}.log`, log);
			current = null;
			state.now = null;
			save();
			resolve(p);
		});
	});

/** A short command's output, for sizes and the like. */
const sh = (line, cwd = "/w") =>
	new Promise((resolve) => {
		const c = spawn("sh", ["-c", line], {cwd, stdio: ["ignore", "pipe", "pipe"]});
		let out = "";
		c.stdout.on("data", (d) => (out += d));
		c.stderr.on("data", (d) => (out += d));
		c.on("close", () => resolve(out.trim()));
	});

/** Stryker's JSON report, cut down: per status, time, and one short row per mutant. */
const summarize = (file) => {
	const text = read(file);
	if (text === null) return {error: "no report"};
	const r = JSON.parse(text);
	const rows = [];
	for (const [f, e] of Object.entries(r.files))
		for (const m of e.mutants)
			rows.push({
				file: f.replace(/^.*?(?=(packages|programs|apps|wip|legacy)\/)/, ""),
				line: m.location.start.line,
				column: m.location.start.column,
				mutator: m.mutatorName,
				status: m.status,
				ms: m.duration ?? null,
				static: m.static === true,
				tests: m.testsCompleted ?? null,
			});
	const by = {};
	for (const x of rows) by[x.status] = (by[x.status] ?? 0) + 1;
	const ran = rows.filter((x) => x.status !== "Ignored");
	return {
		mutants: rows.length,
		ran: ran.length,
		byStatus: by,
		static: rows.filter((x) => x.static).length,
		mutantMs: ran.reduce((s, x) => s + (x.ms ?? 0), 0),
		rows,
	};
};

const post = async (path, body) => {
	for (let i = 0; i < 20; i++) {
		const res = await fetch(`http://host.internal${path}`, {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify(body ?? {}),
		}).catch(() => null);
		if (res?.ok) return true;
		await pause(200);
	}
	return false;
};

const main = async () => {
	state.began = await post("/began", {});
	save();
	const clone = await phase("clone", "sh", [
		"-c",
		`git clone --quiet --filter=blob:none ${REPO} ${DIR} && git -C ${DIR} checkout --quiet ${COMMIT || "HEAD"} && git -C ${DIR} rev-parse HEAD`,
	]);
	if (clone.code !== 0) throw new Error("clone failed");
	state.head = (await sh("git rev-parse HEAD", DIR)).slice(0, 40);
	const install = await phase("install", "pnpm", ["install", "--frozen-lockfile"], {
		cwd: DIR,
		env: {CI: "true"},
	});
	state.sizes = {
		duKiB: await sh(`du -skc ${DIR} "$(pnpm store path 2>/dev/null)" 2>/dev/null | tail -1`, DIR),
		df: await sh("df -k /w | tail -1"),
	};
	save();
	if (install.code !== 0) throw new Error("install failed");
	const env181 = {OUT: OUT181, CI: "true"};
	const sets = await phase(
		"sets",
		"node",
		["experiments/181-fast-and-daily-mutation.ts", "sets", DIR],
		{
			cwd: DIR,
			env: env181,
		},
	);
	if (sets.code === 0 && SET !== "skip") {
		const stream = `${OUT}/stream.jsonl`;
		const sample = await phase(
			"sample",
			"node",
			["experiments/181-fast-and-daily-mutation.ts", "run", DIR, SET, ARM],
			{
				cwd: DIR,
				env: {...env181, EXTRA: JSON.stringify({concurrency: CONCURRENCY}), STREAM: stream},
			},
		);
		const answers = (read(stream) ?? "")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
		const startAt = t0 + sample.startMs;
		sample.firstAnswerMs = answers.length > 0 ? answers[0].at - startAt : null;
		sample.lastAnswerMs = answers.length > 0 ? answers.at(-1).at - startAt : null;
		sample.answers = answers.length;
		sample.report = summarize(`${OUT181}/report-${SET}-${ARM}.json`);
		// Stryker runs in place and puts files back; check, and put back anything it did not.
		state.leftByStryker = await sh("git status --porcelain --untracked-files=no | wc -l", DIR);
		await sh("git checkout -- .", DIR);
		save();
	}
	if (SUITE !== "skip") {
		const files = SUITE === "all" ? [] : SUITE.split(" ");
		const suite = await phase(
			"suite",
			"pnpm",
			[
				"exec",
				"vitest",
				"run",
				"--reporter=dot",
				"--reporter=json",
				`--outputFile.json=${OUT}/suite.json`,
				...files,
			],
			{cwd: DIR, env: {CI: "true"}},
		);
		const j = JSON.parse(read(`${OUT}/suite.json`) ?? "{}");
		const failed = (j.testResults ?? []).filter((t) => t.status !== "passed");
		suite.result = {
			files: (j.testResults ?? []).length,
			tests: j.numTotalTests,
			passed: j.numPassedTests,
			failed: j.numFailedTests,
			pending: j.numPendingTests,
			todo: j.numTodoTests,
			success: j.success,
			failedFiles: failed.slice(0, 40).map((t) => ({
				file: String(t.name).replace(`${DIR}/`, ""),
				status: t.status,
				failed: (t.assertionResults ?? []).filter((a) => a.status === "failed").length,
				why: String(
					t.message ||
						(t.assertionResults ?? []).find((a) => a.status === "failed")?.failureMessages?.[0] ||
						"",
				).slice(0, 300),
			})),
		};
		save();
	}
};

try {
	await main();
} catch (e) {
	state.error = String(e?.stack ?? e).slice(0, 2000);
}
state.done = true;
state.doneMs = Date.now() - t0;
save();
state.told = await post("/done", {doneMs: state.doneMs, error: state.error});
save();
// Stay up so the object can read the answers; it destroys the box, or the hold runs out.
await pause(HOLD_MS);
