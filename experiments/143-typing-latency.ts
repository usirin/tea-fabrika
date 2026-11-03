// Experiment 143: where the time goes from a key press to the character on screen, in the
// fabrika app (apps/fabrika), and which cheap fix buys how much.
//
// It builds copies of the app from two pinned commits, main and pull request 90's head, each with
// timing probes patched in (experiments/143-typing-latency/probes-*.patch), and with the fixes
// tried here patched on top (fix*.patch). The app's own code is never changed: each copy is made
// from `git archive` under runs/exp-143/build/, which git ignores.
//
//   probes        each process keeps a list of [name, performance.now(), note] rows on its own
//                 clock: the page, the main process, and pull request 90's host. Every hop is a
//                 difference inside one process; a hop that crosses processes is a round trip
//                 seen from one side, less the time the other side reports. No two clocks meet.
//   trace         Chromium's own tracing (CDP, categories benchmark and blink.user_timing), one
//                 clock for every process: from the key event's EventLatency begin to the end of
//                 the PipelineReporter of the frame whose main-frame work drew the echo, which is
//                 when Chromium was told the frame was on screen.
//
// Every copy is opened quiet (X143_QUIET, in the probes patch): never the active app, no Dock
// icon, its window shown inactive and kept on top, so it never takes focus from whoever uses the
// machine. Keys come through Chromium (CDP), not the keyboard. `floor` is no copy: one canvas that
// draws a key in the next frame, with no bridge and no terminal (143-typing-latency/floor/).
//
// Plain Node and Playwright, said here: this measures the app from outside, as 141 did, and uses
// no Effect. Never under `nice`, which would skew it. No model, no key, no network, $0.
//
//   node experiments/143-typing-latency.ts build                 # every copy, or name some
//   node experiments/143-typing-latency.ts run                   # VARIANTS, CONDITIONS, HZ, TRACE
//   node experiments/143-typing-latency.ts report                # the tables, and the results file
//
// VARIANTS=main,pr90 CONDITIONS=idle-fresh,idle-full,busy4 HZ=60,120 TRACE=0,1 KEYS=250 are the
// defaults. Each run opens the copy on a fresh FABRIKA_HOME in the temp folder, and removes it
// after; pull request 90's host is stopped by the pid in that home. Each run's raw rows go to
// runs/exp-143/raw/; `report` writes experiments/results/143-typing-latency.json.

import {execFileSync, spawn} from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {mkdtemp} from "node:fs/promises";
import {createRequire} from "node:module";
import {cpus, loadavg, tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
const appDir = join(root, "apps/fabrika");
const require = createRequire(join(appDir, "package.json"));
const {_electron} = require("playwright");
const electronPath = require("electron");
const esbuild = require("esbuild");

const PATCHES = join(root, "experiments/143-typing-latency");
const WORK = join(root, "runs/exp-143");
const BUILDS = join(WORK, "build");
const RAW = join(WORK, "raw");
const RESULTS = join(root, "experiments/results/143-typing-latency.json");

const COMMITS = {
	main: "27f6afa1cbe3d9076911ae8340d8308203737289",
	pr90: "23327b071e46d76d579e328e9e42566bd3b77872",
};

// Each copy: the commit it is made from, then its patches, in order.
const FIX123 = ["fix1-viewport-cache", "fix2-erase-row", "fix3-mirror-idle"];
const VARIANTS = {
	main: ["main", "probes-main"],
	pr90: ["pr90", "probes-pr90"],
	"main-f1": ["main", "probes-main", "fix1-viewport-cache"],
	"main-f2": ["main", "probes-main", "fix2-erase-row"],
	"main-f3": ["main", "probes-main", "fix3-mirror-idle"],
	"main-f12": ["main", "probes-main", "fix1-viewport-cache", "fix2-erase-row"],
	"main-f123": ["main", "probes-main", ...FIX123],
	"main-f1234": ["main", "probes-main", ...FIX123, "fix4-local-echo"],
	"main-f1235": ["main", "probes-main", ...FIX123, "fix5-desynchronized"],
	"pr90-f123": ["pr90", "probes-pr90", ...FIX123],
	"pr90-f1234": ["pr90", "probes-pr90", ...FIX123, "fix4-local-echo"],
};

/**
 * What a run can change after a "+": the copy is the same, only how it is opened. `args` are
 * Chromium switches on the command line. `off` are Chromium features switched off, set by the
 * probes in main.ts (X143_FEATURES_OFF), joined to any list already there; a run reads the page
 * process's own command line to check they arrived.
 */
const SWITCHES = {
	novsync: {args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"], off: []},
	// Chromium 156 holds most of a page's tasks after a key press until its next frame: the
	// echo arriving on its MessagePort is one of them. See the write-up.
	nodefer: {args: [], off: ["DeferRendererTasksAfterInput"]},
	// Not a fix: the page's JavaScript profiler on while typing, 100 µs samples, as the first
	// look at this used. It shows what a profiler does to the numbers.
	profiled: {args: [], off: [], profile: true},
	// The copy asks macOS not to nap it (powerSaveBlocker "prevent-app-suspension", X143_AWAKE in
	// the probes patch), in its own process: no system setting is written.
	awake: {args: [], off: [], awake: true},
};
const NONE = {args: [], off: []};

const list = (name, fallback) => (process.env[name] ?? fallback).split(",").filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Numbers

const quantile = (xs, q) => {
	const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	return s.length === 0 ? null : s[Math.max(0, Math.ceil(q * s.length) - 1)];
};
const round = (x, d = 2) =>
	x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d;
const summary = (xs) => {
	const ok = xs.filter((x) => Number.isFinite(x));
	return {
		n: ok.length,
		p50: round(quantile(ok, 0.5)),
		p95: round(quantile(ok, 0.95)),
		p99: round(quantile(ok, 0.99)),
	};
};
/** A small seeded random, so every run waits the same gaps. */
const seeded = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------
// Build: a copy of the app from a pinned commit, patched, bundled as build.ts bundles it.

const REQUIRE =
	'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);';

const bundle = async (app, host) => {
	const at = (...parts) => join(app, ...parts);
	const jobs = [
		{
			entryPoints: [at("src/main.ts")],
			outfile: at("dist/main.mjs"),
			platform: "node",
			format: "esm",
			target: "node24",
			external: ["electron"],
			banner: {js: REQUIRE},
		},
		{
			entryPoints: [at("src/preload.ts")],
			outfile: at("dist/preload.cjs"),
			platform: "node",
			format: "cjs",
			target: "node24",
			external: ["electron"],
		},
		{
			entryPoints: [at("src/window/desk.tsx")],
			outfile: at("dist/desk.js"),
			platform: "browser",
			format: "iife",
			target: "chrome140",
			jsx: "automatic",
			minify: true,
			loader: {".wasm": "binary"},
			define: {"process.env.NODE_ENV": '"production"'},
		},
	];
	if (host)
		jobs.push({
			entryPoints: [at("src/host/main.ts")],
			outfile: at("dist/host.mjs"),
			platform: "node",
			format: "esm",
			target: "node24",
			banner: {js: REQUIRE},
		});
	await Promise.all(
		jobs.map((o) =>
			esbuild.build({bundle: true, logLevel: "warning", legalComments: "none", ...o}),
		),
	);
	copyFileSync(at("src/window/desk.html"), at("dist/desk.html"));
	copyFileSync(at("src/window/window.css"), at("dist/window.css"));
};

const build = async (variant) => {
	const [from, ...patches] = VARIANTS[variant];
	const dir = join(BUILDS, variant);
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir, {recursive: true});
	const tar = execFileSync(
		"git",
		[
			"-C",
			root,
			"archive",
			"--format=tar",
			COMMITS[from],
			"apps/fabrika/src",
			"apps/fabrika/tsconfig.json",
			"tsconfig.base.json",
		],
		{maxBuffer: 1 << 28},
	);
	execFileSync("tar", ["-x", "-C", dir], {input: tar});
	// ghostty-web as installed, with the app's own pnpm patch on it: a copy, so a fix can patch it.
	cpSync(realpathSync(join(appDir, "node_modules/ghostty-web")), join(dir, "ghostty-web"), {
		recursive: true,
		dereference: true,
	});
	for (const p of patches)
		execFileSync(
			"patch",
			["-p1", "--batch", "--forward", "-d", dir, "-i", join(PATCHES, `${p}.patch`)],
			{
				stdio: "pipe",
			},
		);
	// The app's own packages, linked, except ghostty-web: the copy.
	const app = join(dir, "apps/fabrika");
	const modules = join(app, "node_modules");
	mkdirSync(modules);
	for (const name of readdirSync(join(appDir, "node_modules"))) {
		if (name.startsWith(".") || name === "ghostty-web") continue;
		symlinkSync(realpathSync(join(appDir, "node_modules", name)), join(modules, name));
	}
	symlinkSync(join(dir, "ghostty-web"), join(modules, "ghostty-web"));
	writeFileSync(
		join(app, "package.json"),
		`${JSON.stringify({name: "exp-143-fabrika", private: true, type: "module", main: "dist/main.mjs"})}\n`,
	);
	await bundle(app, from === "pr90");
	// The draw-on-change patch must be in, or every tile draws every frame (experiment 142).
	if (!readFileSync(join(app, "dist/desk.js"), "utf8").includes("strokeRect"))
		throw new Error(`${variant}: dist/desk.js has no strokeRect: the ghostty-web patch is missing`);
	console.log(`built ${variant}: ${patches.join(", ")}`);
};

// ---------------------------------------------------------------------------------------------
// One run: a copy, a condition, a display rate, with or without the trace.

const screenText = (page, tile) =>
	page.locator(`[data-tile="${tile}"] .screen-text`).textContent({timeout: 5000});
const prompted = async (page, tile) => {
	for (let i = 0; i < 800; i += 1) {
		const text = (await screenText(page, tile).catch(() => "")) ?? "";
		if (text.split("\n").at(-1) === "tsh$") return;
		await page.waitForTimeout(25);
	}
	throw new Error(
		`no prompt in ${tile}: ${JSON.stringify(await screenText(page, tile).catch(String))}`,
	);
};
const tiles = (page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));
const focusedTile = (page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile");
const sendKeys = (page, tile, data) =>
	page.evaluate(
		([tile, data]) => window.fabrika.send(`tile:${tile}`, {type: "keys", data}),
		[tile, data],
	);

/** Split the focused tile with the desk's own keys, and wait for the new tile's prompt. */
const split = async (page, how) => {
	const before = (await tiles(page)).length;
	await page.keyboard.press("Control+b");
	await page.keyboard.press(how);
	for (let i = 0; i < 200 && (await tiles(page)).length === before; i += 1)
		await page.waitForTimeout(25);
	await prompted(page, await focusedTile(page));
};
const focusTile = async (page, tile) => {
	await page.locator(`[data-tile="${tile}"]`).click();
	for (let i = 0; i < 200 && (await focusedTile(page)) !== tile; i += 1)
		await page.waitForTimeout(25);
};

/**
 * The window on a display of the asked rate, always on top, and never the key window. The copy
 * was opened quiet (X143_QUIET, in the probes patch): it is never the active app, has no Dock
 * icon, and its window was shown inactive. Nothing here shows or focuses it.
 */
const place = async (app, hz) => {
	const displays = await app.evaluate(({screen}) =>
		screen.getAllDisplays().map((d) => ({
			id: d.id,
			bounds: d.bounds,
			hz: d.displayFrequency,
			scale: d.scaleFactor,
			internal: d.internal,
		})),
	);
	const display = displays.find((d) => Math.abs(d.hz - hz) < 5);
	if (display === undefined) throw new Error(`no ${hz} Hz display in ${JSON.stringify(displays)}`);
	await app.evaluate(({BrowserWindow}, b) => {
		const w = BrowserWindow.getAllWindows()[0];
		// Keys come from Playwright, through Chromium: a key typed on the machine must not land here.
		w.setFocusable(false);
		w.setAlwaysOnTop(true, "floating");
		w.setBounds({x: b.x + 40, y: b.y + 40, width: 1200, height: 760});
	}, display.bounds);
	return {display, focused: await focusedNow(app)};
};
/** Is any window of the copy the key window? It must never be. */
const focusedNow = (app) =>
	app.evaluate(({BrowserWindow}) => BrowserWindow.getFocusedWindow() !== null);
/**
 * Chromium switches a window that is not the active one needs to keep drawing. Every run passes
 * them, and checks they arrived. Playwright's Electron launch adds no Chromium switches of its
 * own (checked: `app.commandLine.hasSwitch` is false for each without these).
 */
const KEEP_DRAWING = [
	"disable-backgrounding-occluded-windows",
	"disable-renderer-backgrounding",
	"disable-background-timer-throttling",
];
const keepsDrawing = async (app, page) => {
	for (const s of KEEP_DRAWING)
		if (!(await app.evaluate(({app}, s) => app.commandLine.hasSwitch(s), s)))
			throw new Error(`Chromium did not get --${s}`);
	// The page believes it has focus, so the focused tile's cursor and its keys work. Playwright
	// does this too; said here so the run does not lean on it.
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setFocusEmulationEnabled", {enabled: true});
	return cdp;
};

/** Animation frame gaps over `ms`, in the page. */
const frameGaps = (page, ms) =>
	page.evaluate(
		(ms) =>
			new Promise((resolve) => {
				const gaps = [];
				let last = performance.now();
				const end = last + ms;
				const tick = (now) => {
					gaps.push(now - last);
					last = now;
					if (now < end) requestAnimationFrame(tick);
					else resolve(gaps);
				};
				requestAnimationFrame(tick);
			}),
		ms,
	);

/** The keys of one run: letters, and Ctrl-U every 25 so the line stays on one row. */
const planKeys = (timed) => {
	const plan = [];
	let inLine = 0;
	let letters = 0;
	while (letters < timed) {
		if (inLine === 25) {
			plan.push({key: "Control+u", timed: false});
			inLine = 0;
			continue;
		}
		plan.push({key: "abcdefghijklmnopqrstuvwxyz"[letters % 26], timed: true});
		letters += 1;
		inLine += 1;
	}
	plan.push({key: "Control+u", timed: false});
	return plan;
};

/** In the page: a promise per key, kept when the frame after the echo's draw comes. */
const armPage = (page) =>
	page.evaluate(() => {
		const probes = window.__x143;
		let keep = null;
		let heard = false;
		let timer = 0;
		window.__x143arm = () => {
			heard = false;
			window.__x143wait = new Promise((resolve) => {
				keep = resolve;
				timer = setTimeout(() => {
					keep = null;
					resolve("timeout");
				}, 3000);
			});
		};
		probes.after = (name) => {
			if (name === "recv") heard = true;
			if (name !== "frame" || !heard || keep === null) return;
			clearTimeout(timer);
			const k = keep;
			keep = null;
			k("ok");
		};
	});

const typeKeys = async (page, plan, seed) => {
	const gap = seeded(seed);
	let timeouts = 0;
	for (const {key} of plan) {
		await page.evaluate(() => window.__x143arm());
		await page.keyboard.press(key);
		if ((await page.evaluate(() => window.__x143wait)) === "timeout") timeouts += 1;
		await page.waitForTimeout(30 + Math.floor(gap() * 61));
	}
	return timeouts;
};

const hostPid = (home) => {
	const file = join(home, "host/pid");
	return existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : null;
};
/** Pull request 90's host on this home: its rows, dumped to a file on SIGUSR2. */
const hostRows = async (home) => {
	const pid = hostPid(home);
	if (pid === null) return null;
	const file = join(home, "host/x143.json");
	rmSync(file, {force: true});
	process.kill(pid, "SIGUSR2");
	for (let i = 0; i < 200 && !existsSync(file); i += 1) await new Promise((r) => setTimeout(r, 10));
	await new Promise((r) => setTimeout(r, 50));
	return JSON.parse(readFileSync(file, "utf8"));
};
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
/** Stop the host this run started: its pid is in this run's home, and it runs this copy's bundle. */
const stopHost = async (home, variant) => {
	const pid = hostPid(home);
	if (pid === null || !alive(pid)) return;
	let command = "";
	try {
		command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {encoding: "utf8"});
	} catch {
		return;
	}
	if (!command.includes(join(BUILDS, variant))) {
		console.warn(`left pid ${pid} alone: it is not this run's host (${command.trim()})`);
		return;
	}
	process.kill(pid, "SIGTERM");
	for (let i = 0; i < 60 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
	if (alive(pid)) process.kill(pid, "SIGKILL");
};

/**
 * CPU=1: the same fixed loop, run in the page's main thread and in a plain Node process at the
 * same moment (both wait for one wall-clock start, so they share the machine's load). If the page
 * is much slower than Node, the page's process is held back; if both are slow, the machine is
 * busy. While they run: each process's priority and nice (`ps`), and the power assertions macOS
 * holds for the copy (`pmset -g assertions`), read only.
 */
const loop = ([start, reps]) => {
	while (Date.now() < start) {
		// Both sides start at the same wall-clock time.
	}
	const out = [];
	let x = 1;
	for (let r = 0; r < reps; r++) {
		const t = performance.now();
		for (let i = 0; i < 5e6; i++) x = Math.imul(x ^ i, 2654435761) >>> 0;
		out.push(performance.now() - t);
	}
	return {ms: out, x};
};
const pairedCpu = async (app, page, pid) => {
	const reps = 30;
	const start = Date.now() + 400;
	const source = `console.log(JSON.stringify((${loop.toString()})([${start}, ${reps}])))`;
	const child = spawn(process.execPath, ["-e", source], {stdio: ["ignore", "pipe", "inherit"]});
	let out = "";
	child.stdout.on("data", (b) => {
		out += b;
	});
	const ended = new Promise((resolve) => child.on("close", resolve));
	const pids = await app.evaluate(({app, webContents}) => ({
		renderer: webContents.getAllWebContents()[0].getOSProcessId(),
		gpu: app.getAppMetrics().find((m) => m.type === "GPU")?.pid ?? null,
	}));
	const inPage = page.evaluate(loop, [start, reps]);
	// Halfway through, as both loops run.
	await new Promise((r) => setTimeout(r, 400 + 150));
	const who = {main: pid, ...pids, node: child.pid};
	const ps = execFileSync(
		"ps",
		["-o", "pid=,pri=,nice=,%cpu=", "-p", Object.values(who).filter(Boolean).join(",")],
		{encoding: "utf8"},
	)
		.trim()
		.split("\n")
		.map((l) => {
			const [p, pri, nice, cpu] = l.trim().split(/\s+/).map(Number);
			return {who: Object.keys(who).find((k) => who[k] === p), pid: p, pri, nice, cpu};
		});
	const assertions = execFileSync("pmset", ["-g", "assertions"], {encoding: "utf8"})
		.split("\n")
		.filter((l) =>
			[pid, pids.renderer, pids.gpu].some((p) => p !== null && l.includes(`pid ${p}(`)),
		)
		.map((l) => l.trim().replace(/\s+/g, " "));
	const there = await inPage;
	await ended;
	const node = JSON.parse(out);
	return {
		page: summary(there.ms),
		node: summary(node.ms),
		ratio: round(quantile(there.ms, 0.5) / quantile(node.ms, 0.5)),
		ps,
		assertions,
	};
};

/** macOS's window server's CPU share, as `ps` shows it: read only, nothing is done to it. */
const windowServer = () => {
	try {
		const pid = execFileSync("pgrep", ["-x", "WindowServer"], {encoding: "utf8"}).split("\n")[0];
		return Number(execFileSync("ps", ["-o", "%cpu=", "-p", pid], {encoding: "utf8"}).trim());
	} catch {
		return null;
	}
};

/** DEEP=1 adds the main thread's tasks and messages, to see why one key waits: more to read, slower. */
const CATEGORIES = [
	"benchmark",
	"blink.user_timing",
	...(process.env.DEEP === "1"
		? ["toplevel", "mojom", "renderer.scheduler", "ipc", "electron"]
		: []),
	// GPU=1 adds the GPU process's display link callbacks (OnVSyncPresentation): what macOS says
	// the screen's next display time is, which Chromium's presentation times are made from.
	...(process.env.GPU === "1" ? ["gpu"] : []),
];
const startTrace = async (page) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Tracing.start", {
		traceConfig: {
			includedCategories: CATEGORIES,
			recordMode: "recordUntilFull",
			traceBufferSizeInKb: 400 * 1024,
		},
		transferMode: "ReturnAsStream",
		streamFormat: "json",
	});
	return cdp;
};
const endTrace = async (cdp) => {
	const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
	await cdp.send("Tracing.end");
	const {stream} = await done;
	const chunks = [];
	for (;;) {
		const c = await cdp.send("IO.read", {handle: stream, size: 1 << 22});
		chunks.push(c.base64Encoded ? Buffer.from(c.data, "base64").toString() : c.data);
		if (c.eof) break;
	}
	await cdp.send("IO.close", {handle: stream});
	const parsed = JSON.parse(chunks.join(""));
	return parsed.traceEvents ?? parsed;
};

const run = async ({variant, condition, hz, trace, keys, seed}) => {
	// "main+novsync": the copy main, opened with that set of Chromium switches.
	const [copy, how] = variant.split("+");
	const opened = how === undefined ? NONE : SWITCHES[how];
	if (opened === undefined) throw new Error(`no switches named ${how}`);
	// The floor is no copy of the app: one canvas that draws the key, no bridge, no terminal.
	const floor = copy === "floor";
	if (floor && condition !== "idle-fresh") throw new Error("the floor has only idle-fresh");
	const dir = floor ? join(PATCHES, "floor/main.mjs") : join(BUILDS, copy, "apps/fabrika");
	if (!floor && !existsSync(join(dir, "dist/main.mjs"))) throw new Error(`build ${copy} first`);
	const home = await mkdtemp(join(tmpdir(), "f143-"));
	// Never the Jev key: nothing here may spend money.
	const {TYPESAFE_API_KEY: _never, ...env} = process.env;
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [dir, ...KEEP_DRAWING.map((s) => `--${s}`), ...opened.args],
		env: {
			...env,
			FABRIKA_HOME: home,
			X143_TILE: "t1",
			X143_FEATURES_OFF: opened.off.join(","),
			X143_QUIET: "1",
			X143_AWAKE: opened.awake === true ? "1" : "",
		},
	});
	const pid = app.process().pid;
	try {
		const page = await app.firstWindow();
		await keepsDrawing(app, page);
		for (const s of opened.args)
			if (!(await app.evaluate(({app}, s) => app.commandLine.hasSwitch(s), s.slice(2))))
				throw new Error(`Chromium did not get ${s}`);
		// A feature switched off must reach the page's own process: read its command line.
		if (opened.off.length > 0) {
			const renderer = await app.evaluate(({webContents}) =>
				webContents.getAllWebContents()[0].getOSProcessId(),
			);
			const argv = execFileSync("ps", ["-o", "command=", "-p", String(renderer)], {
				encoding: "utf8",
			});
			const off = /--disable-features=(\S*)/.exec(argv)?.[1].split(",") ?? [];
			for (const f of opened.off)
				if (!off.includes(f)) throw new Error(`the page's process did not get ${f} off`);
		}
		const {display, focused} = await place(app, hz);
		if (!floor) await prompted(page, "t1");
		const flood = condition === "busy4" ? "t3" : null;
		if (condition === "idle-full") {
			await sendKeys(page, "t1", "seq --to 300\r");
			await page.waitForTimeout(300);
			await prompted(page, "t1");
		}
		if (condition === "busy4") {
			await split(page, "|");
			await split(page, "-");
			await focusTile(page, "t1");
			await split(page, "-");
			const ids = await tiles(page);
			if (ids.length !== 4 || !ids.includes(flood)) throw new Error(`wanted t1 to t4, have ${ids}`);
			await sendKeys(page, flood, "seq --to 3000000\r");
			await page.waitForTimeout(1000);
		}
		if (!floor) await focusTile(page, "t1");
		const gaps = await frameGaps(page, 1000);
		await armPage(page);
		// Warm up, then start every list from nothing.
		await typeKeys(page, [...planKeys(10)], seed + 1);
		await page.evaluate(() => {
			window.__x143.rows.length = 0;
		});
		await app.evaluate(() => {
			globalThis.__x143.rows.length = 0;
		});
		if (variant.startsWith("pr90")) await hostRows(home);
		const cpu = process.env.CPU === "1" ? await pairedCpu(app, page, pid) : null;
		const cdp = trace ? await startTrace(page) : null;
		const profiler = opened.profile === true ? await page.context().newCDPSession(page) : null;
		if (profiler !== null) {
			await profiler.send("Profiler.enable");
			await profiler.send("Profiler.setSamplingInterval", {interval: 100});
			await profiler.send("Profiler.start");
		}
		const plan = planKeys(keys);
		// The machine's one-minute load, and the share of a CPU macOS's window server takes, before
		// and after: other work on the machine, or a screen recorder, shows here.
		const loadBefore = round(loadavg()[0]);
		const serverBefore = windowServer();
		const started = Date.now();
		const timeouts = await typeKeys(page, plan, seed);
		const took = Date.now() - started;
		const load = [loadBefore, round(loadavg()[0]), cpus().length];
		const server = [serverBefore, windowServer()];
		const focusedAtEnd = await focusedNow(app);
		if (profiler !== null) await profiler.send("Profiler.stop");
		const events = cdp === null ? null : await endTrace(cdp);
		if (events !== null && process.env.KEEP_TRACE === "1")
			writeFileSync(join(RAW, `${variant}.${condition}.${hz}.events`), JSON.stringify(events));
		const pageRows = await page.evaluate(() => window.__x143.rows);
		const mainRows = await app.evaluate(() => globalThis.__x143.rows);
		const host = variant.startsWith("pr90") ? await hostRows(home) : null;
		// Was the busy tile still printing at the end?
		const busyToEnd =
			flood === null ? null : ((await screenText(page, flood)) ?? "").split("\n").at(-1) !== "tsh$";
		const context = await page.evaluate(() => {
			const canvas = document.querySelector('[data-tile="t1"] canvas');
			const attrs = canvas?.getContext("2d")?.getContextAttributes();
			return {desynchronized: attrs?.desynchronized ?? null, dpr: window.devicePixelRatio};
		});
		return {
			variant,
			condition,
			hz,
			trace,
			display,
			// Opened quiet: never the active app. A window that became the key one says so here.
			quiet: true,
			focused: focused || focusedAtEnd,
			frameMs: round(quantile(gaps, 0.5)),
			busyToEnd,
			timeouts,
			took,
			load,
			server,
			cpu,
			context,
			plan,
			page: pageRows,
			main: mainRows,
			host,
			traced: events === null ? null : fromTrace(events),
		};
	} finally {
		// A close that hangs is cut off after 5 s; the pid is killed below if it is still alive.
		await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
		await stopHost(home, copy);
		if (alive(pid)) process.kill(pid, "SIGKILL");
		rmSync(home, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------------------------------------
// From the trace: per key, the event's begin, the draw, and when its frame was presented.

/** A frame's stages, as Chromium's PipelineReporter names them, from its begin to on screen. */
const STAGES = [
	"BeginImplFrameToSendBeginMainFrame",
	"SendBeginMainFrameToCommit",
	"Commit",
	"EndCommitToActivation",
	"Activation",
	"EndActivateToSubmitCompositorFrame",
	"SubmitCompositorFrameToPresentationCompositorFrame",
	"SubmitToReceiveCompositorFrame",
	"ReceiveCompositorFrameToStartDraw",
	"StartDrawToSwapStart",
	"BufferAvailableToBufferReady",
	"BufferReadyToLatch",
	"LatchToSwapEnd",
	"SwapEndToPresentationCompositorFrame",
];

const fromTrace = (events) => {
	const marks = events.filter((e) => e.cat === "blink.user_timing" && e.name.startsWith("x143:"));
	const downs = marks.filter((m) => m.name === "x143:down").sort((a, b) => a.ts - b.ts);
	const draws = marks.filter((m) => m.name === "x143:draw").sort((a, b) => a.ts - b.ts);
	if (downs.length === 0) return {keys: []};
	const {pid, tid} = downs[0];
	const latencies = events
		.filter(
			(e) =>
				e.name === "EventLatency" &&
				e.ph === "b" &&
				e.pid === pid &&
				e.args?.event_latency?.event_type === "KEY_PRESSED",
		)
		.sort((a, b) => a.ts - b.ts);
	const mainFrames = events.filter(
		(e) => e.name === "ProxyMain::BeginMainFrame" && e.ph === "X" && e.pid === pid && e.tid === tid,
	);
	// Each PipelineReporter's begin and end, and its stages' (they share its id), paired on its thread.
	const reporters = [];
	const stages = [];
	const open = new Map();
	for (const e of events
		.filter((e) => (e.ph === "b" || e.ph === "e") && e.pid === pid && e.id2?.local !== undefined)
		.sort((a, b) => a.ts - b.ts)) {
		const id = `${e.name}:${e.tid}:${e.id2.local}`;
		if (e.ph === "b") open.set(id, e);
		if (e.ph !== "e" || !open.has(id)) continue;
		const b = open.get(id);
		open.delete(id);
		if (e.name === "PipelineReporter")
			reporters.push({
				seq: b.args?.frame_reporter?.frame_sequence,
				state: b.args?.frame_reporter?.state,
				tid: e.tid,
				id: e.id2.local,
				begin: b.ts,
				end: e.ts,
			});
		else if (STAGES.includes(e.name))
			stages.push({name: e.name, tid: e.tid, id: e.id2.local, begin: b.ts, end: e.ts});
	}
	const stagesOf = (r) =>
		Object.fromEntries(
			stages
				.filter((s) => s.tid === r.tid && s.id === r.id && s.begin >= r.begin && s.end <= r.end)
				.map((s) => [s.name, round((s.end - s.begin) / 1000, 3)]),
		);
	const keys = downs.map((down, i) => {
		const next = downs[i + 1]?.ts ?? Number.POSITIVE_INFINITY;
		const begin = latencies.filter((l) => l.ts <= down.ts && down.ts - l.ts < 50_000).at(-1);
		const draw = draws.find((d) => d.ts > down.ts && d.ts < next);
		if (begin === undefined || draw === undefined)
			return {missing: begin === undefined ? "event" : "draw"};
		const frame = mainFrames.find((f) => f.ts <= draw.ts && draw.ts <= f.ts + f.dur);
		const seq = frame?.args?.begin_frame_id;
		const shown = reporters
			.filter((r) => r.seq === seq && /PRESENTED/.test(r.state ?? ""))
			.sort((a, b) => a.end - b.end)[0];
		const ms = (us) => round(us / 1000, 3);
		return {
			toDown: ms(down.ts - begin.ts),
			toDraw: ms(draw.ts - begin.ts),
			frameWork: frame === undefined ? null : ms(frame.dur),
			present: shown === undefined ? null : ms(shown.end - draw.ts),
			e2e: shown === undefined ? null : ms(shown.end - begin.ts),
			state: shown?.state ?? reporters.find((r) => r.seq === seq)?.state ?? "none",
			stages: shown === undefined ? {} : stagesOf(shown),
		};
	});
	const presented = reporters.filter((r) => /PRESENTED/.test(r.state ?? "")).map((r) => r.end);
	const presentGaps = presented.slice(1).map((t, i) => (t - presented[i]) / 1000);
	return {keys, presentGapMs: round(quantile(presentGaps, 0.5))};
};

// ---------------------------------------------------------------------------------------------
// From the probes: per key, each hop, in the process it happened in.

/** Rows cut into one group per key: each group starts at a row named `start`. */
const groups = (rows, start, accept = () => true) => {
	const out = [];
	for (const row of rows ?? []) {
		if (row[0] === start && accept(row)) out.push([]);
		if (out.length > 0) out.at(-1).push(row);
	}
	return out;
};
/** The time of the first row named `name` in a group, after the time `after`. */
const at = (group, name, after = Number.NEGATIVE_INFINITY, note) =>
	group?.find((r) => r[0] === name && r[1] >= after && (note === undefined || r[2] === note))?.[1];
const minus = (a, b) => (a === undefined || b === undefined ? undefined : a - b);

const pageHops = (g) => {
	const down = at(g, "down");
	const stamp = g[0][2]?.[0];
	const routed = at(g, "routed");
	const data = at(g, "data");
	const sent = at(g, "sent", data);
	const recv = at(g, "recv", data);
	const parsed = at(g, "parsed", recv);
	const draw0 = at(g, "draw0", parsed, true);
	const draw1 = at(g, "draw1", draw0, true);
	const frame = at(g, "frame", draw1);
	const firstDraw = at(g, "draw1", down, true);
	const firstFrame = at(g, "frame", firstDraw);
	const mirror0 = at(g, "mirror0", parsed);
	return {
		input: minus(down, stamp),
		desk: minus(routed, down),
		encode: minus(data, routed),
		send: minus(sent, data),
		roundTrip: minus(recv, data),
		write: minus(parsed, recv),
		wait: minus(draw0, parsed),
		draw: minus(draw1, draw0),
		mirror: minus(at(g, "mirror1", mirror0), mirror0),
		toFrame: minus(frame, draw1),
		pageTotal: minus(firstFrame, stamp),
		local: at(g, "local") === undefined ? 0 : 1,
	};
};

const mainHops = (g, pr90) => {
	const inAt = at(g, "in");
	if (!pr90) {
		const heard = at(g, "heard", inAt);
		const edit0 = at(g, "edit0", heard);
		const edit1 = at(g, "edit1", edit0);
		const posted = at(g, "posted", edit1);
		return {
			mainIn: minus(heard, inAt),
			wake: minus(edit0, heard),
			editor: minus(edit1, edit0),
			mainOut: minus(posted, edit1),
			mainTotal: minus(posted, inAt),
		};
	}
	const up = at(g, "sock-write", inAt);
	const back = at(g, "sock-data", up);
	const posted = at(g, "posted", back);
	return {
		relayUp: minus(up, inAt),
		socketRoundTrip: minus(back, up),
		relayDown: minus(posted, back),
		mainTotal: minus(posted, inAt),
	};
};

const hostHops = (g) => {
	const read = at(g, "sock-data");
	const hin = at(g, "hin", read);
	const hheard = at(g, "hheard", hin);
	const edit0 = at(g, "edit0", hheard);
	const edit1 = at(g, "edit1", edit0);
	const hout = at(g, "hout", edit1);
	const wrote = at(g, "sock-write", hout);
	return {
		hostIn: minus(hin, read),
		heard: minus(hheard, hin),
		wake: minus(edit0, hheard),
		editor: minus(edit1, edit0),
		hostOut: minus(hout, edit1),
		hostSend: minus(wrote, hout),
		hostTotal: minus(wrote, read),
	};
};

/** Every hop of every timed key of one run, by name. */
const hopsOf = (raw) => {
	const pr90 = raw.variant.startsWith("pr90");
	// Ctrl-U is two keydowns, Control's and u's: the key is u's.
	const pages = groups(raw.page, "down", (r) => r[2]?.[1] !== "Control");
	const mains = groups(raw.main, "in", (r) => r[2] === "keys");
	const hosts = pr90 ? groups(raw.host, "sock-data") : [];
	// The trace has a key for every keydown, so Ctrl-U is two there, and its list runs ahead of the
	// plan by one at each Ctrl-U. A plan key's place in the trace, with Ctrl-U at u's keydown:
	const traced = raw.traced?.keys ?? [];
	const inTrace = [];
	let next = 0;
	for (const p of raw.plan) {
		if (p.key === "Control+u") next += 1;
		inTrace.push(next);
		next += 1;
	}
	const aligned =
		pages.length === raw.plan.length &&
		mains.length === raw.plan.length &&
		(!pr90 || hosts.length === raw.plan.length) &&
		(raw.traced === undefined || raw.traced === null || traced.length === next);
	const keys = [];
	raw.plan.forEach((p, i) => {
		if (!p.timed) return;
		const page = pageHops(pages[i] ?? [[]]);
		const main = mainHops(mains[i], pr90);
		const host = pr90 ? hostHops(hosts[i]) : {};
		const both = minus(page.roundTrip, main.mainTotal);
		const kernel = pr90 ? minus(main.socketRoundTrip, host.hostTotal) : undefined;
		const t = traced[inTrace[i]] ?? {};
		keys.push({
			...page,
			...(pr90 ? {main: main, host} : main),
			bridge: both,
			kernel,
			e2e: t.e2e ?? undefined,
			present: t.present ?? undefined,
			frameWork: t.frameWork ?? undefined,
			toDraw: t.toDraw ?? undefined,
			stage: t.stages ?? {},
			state: t.state,
		});
	});
	return {aligned, counts: {page: pages.length, main: mains.length, host: hosts.length}, keys};
};

/** Flatten the nested main/host hops of pull request 90 into names with a side. */
const flat = (key) => {
	const out = {};
	for (const [k, v] of Object.entries(key)) {
		if (v !== null && typeof v === "object")
			for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = v2;
		else out[k] = v;
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// Steps

const step = process.argv[2] ?? "report";

if (step === "build") {
	const names = process.argv.slice(3);
	for (const v of names.length > 0 ? names : Object.keys(VARIANTS)) await build(v);
}

if (step === "run") {
	mkdirSync(RAW, {recursive: true});
	const keys = Number(process.env.KEYS ?? 250);
	// TAG=r2 names a repeat, so it is kept beside the first run, not over it.
	const tag = process.env.TAG ? `.${process.env.TAG}` : "";
	// The variants take turns inside each condition and rate, so a machine that gets busier or
	// quieter over the hour moves every variant alike, not the ones measured last.
	for (const condition of list("CONDITIONS", "idle-fresh,idle-full,busy4"))
		for (const hz of list("HZ", "60,120").map(Number))
			for (const trace of list("TRACE", "0,1").map((t) => t === "1"))
				for (const variant of list("VARIANTS", "main,pr90")) {
					const name = `${variant}.${condition}.${hz}.${trace ? "trace" : "probes"}${tag}`;
					const raw = await run({variant, condition, hz, trace, keys, seed: 143});
					writeFileSync(join(RAW, `${name}.json`), JSON.stringify(raw));
					const {aligned, counts, keys: hops} = hopsOf(raw);
					const e2e = summary(hops.map((k) => k.e2e));
					const page = summary(hops.map((k) => k.pageTotal));
					console.log(
						// oxlint-disable-next-line eslint/prefer-template -- an experiment is a record; this line stays as it ran.
						`${name}: frame ${raw.frameMs} ms, page total p50 ${page.p50} p95 ${page.p95}` +
							(trace ? `, end to end p50 ${e2e.p50} p95 ${e2e.p95}` : "") +
							`, timeouts ${raw.timeouts}, aligned ${aligned} ${JSON.stringify(counts)}` +
							(raw.busyToEnd === null ? "" : `, busy to the end ${raw.busyToEnd}`) +
							`, focused ${raw.focused}, ${Math.round(raw.took / 1000)} s`,
					);
				}
}

const PER_KEY = ["e2e", "pageTotal", "roundTrip", "wait", "draw", "present", "toDraw", "local"];

if (step === "report") {
	const runs = [];
	for (const file of existsSync(RAW) ? readdirSync(RAW).sort() : []) {
		if (!file.endsWith(".json")) continue;
		const raw = JSON.parse(readFileSync(join(RAW, file), "utf8"));
		const {aligned, counts, keys} = hopsOf(raw);
		const names = [...new Set(keys.flatMap((k) => Object.keys(flat(k))))].filter(
			(n) => n !== "state",
		);
		const hops = Object.fromEntries(names.map((n) => [n, summary(keys.map((k) => flat(k)[n]))]));
		runs.push({
			name: file.replace(/\.json$/, ""),
			variant: raw.variant,
			condition: raw.condition,
			hz: raw.hz,
			trace: raw.trace,
			display: {hz: raw.display.hz, internal: raw.display.internal, scale: raw.display.scale},
			frameMs: raw.frameMs,
			presentGapMs: raw.traced?.presentGapMs ?? null,
			busyToEnd: raw.busyToEnd,
			timeouts: raw.timeouts,
			focused: raw.focused,
			// "normal": opened as an app opens, so macOS made it the active app once, at launch;
			// the window was then made unfocusable. "quiet": never the active app (see `place`).
			launch: raw.quiet === true ? "quiet" : "normal",
			keys: raw.plan.filter((p) => p.timed).length,
			load: raw.load ?? null,
			windowServerCpu: raw.server ?? null,
			cpu: raw.cpu ?? null,
			desynchronized: raw.context?.desynchronized ?? null,
			aligned,
			counts,
			notPresented: raw.traced === null ? null : keys.filter((k) => k.e2e === undefined).length,
			hops,
			// Every key's value, for the hops the write-up reads; the rest stay in runs/exp-143/raw/.
			perKey: Object.fromEntries(
				PER_KEY.filter((n) => names.includes(n)).map((n) => [
					n,
					keys.map((k) => round(flat(k)[n] ?? null)),
				]),
			),
		});
	}
	for (const r of runs) {
		console.log(`\n${r.name}  frame ${r.frameMs} ms  aligned ${r.aligned}  timeouts ${r.timeouts}`);
		for (const [n, s] of Object.entries(r.hops))
			if (s.n > 0)
				console.log(`  ${n.padEnd(22)} p50 ${s.p50}  p95 ${s.p95}  p99 ${s.p99}  n ${s.n}`);
	}
	const machine = {platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model};
	writeFileSync(
		RESULTS,
		`${JSON.stringify({machine, commits: COMMITS, window: "1200x760", variants: VARIANTS, switches: SWITCHES, runs})}\n`,
	);
	console.log(`\nwrote ${RESULTS}`);
}
