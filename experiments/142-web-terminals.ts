// Experiment 142: which web terminal library should the fabrika app draw its tiles with?
//
// The app draws every tile with ghostty-web 0.4.0, and sitting idle its window keeps a CPU core
// busy. This opens one Electron page (experiments/142-web-terminals/), as sandboxed as the app's,
// with N terminals of one library in 300 by 190 tiles, and reads, for each library and N:
//
//   idle      renderer ("Tab") and GPU process percentCPUUsage from app.getAppMetrics(), every
//             2 s for 20 s, with nothing happening
//   memory    the renderer's working set and the page's JS heap
//   burst     every terminal sent 2,000 lines at once: time until the last one has drawn its
//             prompt, and the worst gap between animation frames meanwhile
//   typing    25 keys into terminal 0: keydown to the library's own draw that first shows the
//             key, the pty's echo one task away
//   keys      Ctrl-B and the key after caught in the page's keydown capture, never sent
//   bytes     what the page loads, counted by the main process as it serves the files
//
// Then the fit checks: does the library load under the app's own Content Security Policy, can
// the screen be read as text, is an unfocused cursor hollow (from a screenshot's pixels), and
// what Chromium's accessibility tree holds.
//
// No model, no key, no network: every file comes from the page's own scheme.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/142-web-terminals.ts
//   LIBS=xterm,wterm COUNTS=1,4 IDLE_S=20 ...      to run a part
//   RESTTY_FONT=<a .ttf file>                       restty's font (default: macOS's SF Mono)
//   STEP=busy ...                                   CPU while every terminal scrolls a log
//   STEP=large ...                                  idle with 16 tiles in a 2400 by 1360 window
//   STEP=growth ...                                 idle as scrollback fills and time passes
//   STEP=app ...                                    the real app's idle CPU, for comparison
//
// ghostty-web-patched is ghostty-web 0.4.0 with the two .patch files in the harness folder
// applied to a copy: it draws only when something changed, and an unfocused cursor is hollow.
//
// Builds into runs/exp-142 (never committed). Saves experiments/results/142-web-terminals.json.

import {execFileSync} from "node:child_process";
import {copyFile, mkdir, mkdtemp, readdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
const harness = join(root, "experiments/142-web-terminals");
const require = createRequire(join(harness, "package.json"));
const {build} = require("esbuild");
const {_electron} = require("playwright");
const electronPath = require("electron");

const LIBS = (
	process.env.LIBS ??
	"blank,ghostty-web,ghostty-web-steady,ghostty-web-patched,ghostty-web-patched-steady,wterm,xterm,xterm-webgl,xterm-sr,restty"
).split(",");
const COUNTS = (process.env.COUNTS ?? "1,4,16").split(",").map(Number);
const IDLE_S = Number(process.env.IDLE_S ?? "20");
const BIG = (
	process.env.BIG ?? "blank,ghostty-web,ghostty-web-patched,wterm,xterm,xterm-webgl"
).split(",");
const FONT = process.env.RESTTY_FONT ?? "/System/Library/Fonts/SFNSMono.ttf";
const out = join(root, "runs/exp-142");

/** The app's own page policy (apps/fabrika/src/files.ts, DESK_CSP). */
const APP_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** The policy the measurements run under: the app's, and what wterm and xterm need (see fit). */
const MEASURE_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const quantile = (xs, q) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const round = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const summary = (xs) => ({
	n: xs.length,
	median: round(quantile(xs, 0.5)),
	p95: round(quantile(xs, 0.95)),
	max: xs.length === 0 ? null : round(Math.max(...xs)),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ghostty-web with its render loop patched, as a copy beside the build: the published dist file
 * and its one chunk, with ghostty-web-render-on-change.patch (draw only on a change), then
 * ghostty-web-hollow-cursor.patch (an unfocused cursor drawn as an outline) applied by `patch`,
 * a thin edge to a standard tool. node_modules is never touched.
 */
const patchGhostty = async () => {
	const dist = join(require.resolve("ghostty-web"), "..");
	const dir = join(out, "ghostty-web-patched");
	await mkdir(dir, {recursive: true});
	for (const file of await readdir(dist))
		if (file.startsWith("__vite-browser-external"))
			await copyFile(join(dist, file), join(dir, file));
	const to = join(dir, "ghostty-web.js");
	execFileSync("patch", [
		"--silent",
		"--output",
		to,
		join(dist, "ghostty-web.js"),
		join(harness, "ghostty-web-render-on-change.patch"),
	]);
	execFileSync("patch", ["--silent", to, join(harness, "ghostty-web-hollow-cursor.patch")]);
	return to;
};

const make = async () => {
	await mkdir(out, {recursive: true});
	const patched = await patchGhostty();
	await build({
		entryPoints: [join(harness, "page.ts")],
		outdir: out,
		bundle: true,
		splitting: true,
		format: "esm",
		platform: "browser",
		target: "chrome140",
		minify: true,
		legalComments: "none",
		logLevel: "warning",
		loader: {".wasm": "binary", ".ttf": "binary"},
		alias: {"bench-font": FONT, "ghostty-web-patched": patched},
	});
	await build({
		entryPoints: [join(harness, "main.ts")],
		outfile: join(out, "main.cjs"),
		bundle: true,
		format: "cjs",
		platform: "node",
		external: ["electron"],
		logLevel: "warning",
	});
	const from = (spec) => require.resolve(spec);
	await copyFile(join(harness, "page.html"), join(out, "page.html"));
	await copyFile(join(harness, "page.css"), join(out, "page.css"));
	await copyFile(from("@xterm/xterm/css/xterm.css"), join(out, "xterm.css"));
	await copyFile(from("@wterm/dom/src/terminal.css"), join(out, "wterm.css"));
	await copyFile(from("@wterm/ghostty/ghostty-vt.wasm"), join(out, "ghostty-vt.wasm"));
};

const open = async (lib, n, csp, tile = "300x190", size = "1200x760") => {
	const [w, h] = size.split("x");
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [join(out, "main.cjs")],
		env: {
			...process.env,
			BENCH_W: w,
			BENCH_H: h,
			BENCH_DIR: out,
			BENCH_CSP: csp,
			BENCH_URL: `bench://h/page.html?lib=${lib}&n=${n}&tile=${tile}`,
		},
	});
	const page = await app.firstWindow();
	await page.waitForFunction(() => "bench" in window, null, {timeout: 20_000});
	await page.evaluate(() => window.bench.ready);
	const info = await page.evaluate(() => window.bench.info);
	return {app, page, info};
};

const metrics = (app) => app.evaluate(({app}) => app.getAppMetrics());
const byType = (all, type) => all.filter((m) => m.type === type);

const cpuSeconds = (all, type) =>
	byType(all, type).reduce((a, p) => a + (p.cpu.cumulativeCPUUsage ?? 0), 0);

/**
 * Idle: CPU of the renderer and the GPU process over IDLE_S seconds. Two readings of the same
 * thing: `core` is CPU seconds used over wall seconds, in percent of one core, as Activity
 * Monitor shows it; `percentCPUUsage` is Electron's own, which on macOS is shared out over every
 * core (12 here), so it reads 12 times smaller. The 2 s samples give the spread.
 */
const idle = async (app, page, seconds = IDLE_S) => {
	const first = await metrics(app);
	const t0 = performance.now();
	const draws0 = await page.evaluate(() => [...window.bench.draws]);
	const tab = [];
	const gpu = [];
	for (let t = 0; t < seconds; t += 2) {
		await sleep(2000);
		const m = await metrics(app);
		tab.push(byType(m, "Tab").reduce((a, p) => a + p.cpu.percentCPUUsage, 0));
		gpu.push(byType(m, "GPU").reduce((a, p) => a + p.cpu.percentCPUUsage, 0));
	}
	const last = await metrics(app);
	const wall = (performance.now() - t0) / 1000;
	const draws1 = await page.evaluate(() => [...window.bench.draws]);
	const shown = await page.evaluate(() => window.bench.shown());
	const core = (type) => round(((cpuSeconds(last, type) - cpuSeconds(first, type)) / wall) * 100);
	const workingMB = byType(last, "Tab").reduce((a, p) => a + p.memory.workingSetSize / 1024, 0);
	return {
		rendererCorePercent: core("Tab"),
		gpuCorePercent: core("GPU"),
		percentCPUUsage: {
			renderer: {mean: round(mean(tab)), max: round(Math.max(...tab))},
			gpu: {mean: round(mean(gpu)), max: round(Math.max(...gpu))},
		},
		/** Draws a second, per terminal, with nothing to draw. */
		drawsPerSecond: round(mean(draws1.map((d, i) => d - draws0[i])) / wall),
		shown,
		rendererWorkingSetMB: round(workingMB),
	};
};

const typing = async (page) => {
	await page.evaluate(() => window.bench.typing.arm());
	for (let i = 0; i < 25; i += 1) {
		await page.keyboard.press(String.fromCharCode(97 + (i % 26)));
		for (let w = 0; w < 100; w += 1) {
			const ok = await page.evaluate((i) => window.bench.typing.seen[i]?.after != null, i);
			if (ok) break;
			await sleep(10);
		}
	}
	const seen = await page.evaluate(() => window.bench.typing.seen);
	const drawn = seen.filter((s) => s.drawn !== null);
	return {
		pressed: seen.length,
		drawn: drawn.length,
		toDraw: summary(drawn.map((s) => s.drawn - s.down)),
		toNextFrame: summary(drawn.filter((s) => s.after !== null).map((s) => s.after - s.down)),
	};
};

/** Ctrl-B, then `|`: the desk's two keys. Neither may reach the terminal. */
const prefix = async (page) => {
	const before = await page.evaluate(() => window.bench.sent[0].length);
	await page.keyboard.press("Control+b");
	await page.keyboard.press("|");
	await sleep(200);
	return page.evaluate((before) => {
		const after = window.bench.sent[0].slice(before);
		return {caught: [...window.bench.keys.caught], reachedTerminal: after};
	}, before);
};

const measure = async (lib, n, tile = "300x190") => {
	const {app, page, info} = await open(lib, n, MEASURE_CSP, tile);
	try {
		if (info.errors.length > 0) return {lib, n, failed: info.errors};
		await sleep(3000);
		const served = await app.evaluate(() => [...globalThis.served]);
		const heapMB = await page.evaluate(() => performance.memory.usedJSHeapSize / 1024 / 1024);
		const still = await idle(app, page);
		const shape = (b) =>
			b && {
				settledMs: round(b.settledMs),
				worstGapMs: round(b.worstGapMs),
				medianGapMs: round(b.medianGapMs),
				over50ms: b.over50ms,
				frames: b.frames,
			};
		const burst = shape(await page.evaluate(() => window.bench.burst("seq")));
		await sleep(500);
		const colorBurst = shape(await page.evaluate(() => window.bench.burst("color")));
		await sleep(1000);
		const typed = info.drawn.startsWith("none") ? null : await typing(page);
		const keys = n === 1 ? await prefix(page) : undefined;
		const after = await metrics(app);
		const afterMB = byType(after, "Tab").reduce((a, p) => a + p.memory.workingSetSize / 1024, 0);
		return {
			lib,
			n,
			tile,
			drawn: info.drawn,
			pageBytes: served.reduce((a, [, b]) => a + b, 0),
			served,
			idle: still,
			pageHeapMB: round(heapMB),
			/** The renderer's working set after 4,000 lines in every terminal. */
			rendererWorkingSetAfterMB: round(afterMB),
			burst,
			colorBurst,
			typing: typed,
			keys,
		};
	} finally {
		await app.close();
	}
};

/** Pixels near the cursor color in a screenshot, and how much of their box they fill. */
const cursorShape = async (page, png) =>
	page.evaluate(async (b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], {type: "image/png"}));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(bitmap, 0, 0);
		const {data, width, height} = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
		let count = 0;
		let x0 = width;
		let y0 = height;
		let x1 = -1;
		let y1 = -1;
		for (let y = 0; y < height; y += 1)
			for (let x = 0; x < width; x += 1) {
				const i = (y * width + x) * 4;
				const d = Math.hypot(data[i] - 59, data[i + 1] - 130, data[i + 2] - 246);
				if (d > 60) continue;
				count += 1;
				x0 = Math.min(x0, x);
				y0 = Math.min(y0, y);
				x1 = Math.max(x1, x);
				y1 = Math.max(y1, y);
			}
		if (count === 0) return {pixels: 0, box: null, fill: null};
		const area = (x1 - x0 + 1) * (y1 - y0 + 1);
		return {
			pixels: count,
			box: [x1 - x0 + 1, y1 - y0 + 1],
			fill: Math.round((count / area) * 100) / 100,
		};
	}, png.toString("base64"));

/** Several shots, the one with the most cursor pixels: a blinking cursor is off half the time. */
const cursorOf = async (page, i) => {
	const box = await page.locator(`[data-tile="${i}"]`).boundingBox();
	let best = {pixels: 0, box: null, fill: null};
	for (let k = 0; k < 4; k += 1) {
		const shot = await cursorShape(page, await page.screenshot({clip: box}));
		if (shot.pixels > best.pixels) best = shot;
		await sleep(260);
	}
	return best;
};

const axSummary = async (page) => {
	const cdp = await page.context().newCDPSession(page);
	const {nodes} = await cdp.send("Accessibility.getFullAXTree");
	const shown = nodes.filter((x) => !x.ignored);
	const roles = {};
	for (const x of shown) {
		const role = x.role?.value ?? "?";
		roles[role] = (roles[role] ?? 0) + 1;
	}
	const named = (x) => `${x.name?.value ?? ""} ${x.value?.value ?? ""}`;
	return {
		nodes: shown.length,
		roles,
		/** The text written to terminal 0, found in the tree as a node's name or value. */
		textInTree: shown.some((x) => named(x).includes("hello from 142")),
		inputs: shown
			.filter((x) => ["textbox", "TextField", "textField"].includes(x.role?.value))
			.map((x) => x.name?.value ?? ""),
	};
};

/** The app's policy with fetch from the page's own files allowed, and nothing else added. */
const FETCH_CSP = APP_CSP.replace("style-src 'self';", "style-src 'self'; connect-src 'self';");

/** Under a policy: does it load, and what does the page refuse? */
const underApp = async (lib, csp = APP_CSP) => {
	const strict = await open(lib, 1, csp).catch((e) => ({failed: String(e)}));
	if ("failed" in strict) return {loads: false, errors: [strict.failed], refused: []};
	try {
		await strict.page.evaluate(() => window.bench.write(0, "\x1b[31mred\x1b[0m plain\r\n"));
		await sleep(500);
		const info = await strict.page.evaluate(() => window.bench.info);
		// In a library that draws rows in the DOM: the color the word "red" got. Null on a canvas.
		const red = await strict.page.evaluate(() => {
			const el = [...document.querySelectorAll("span")].find((s) => s.textContent === "red");
			return el === undefined ? null : getComputedStyle(el).color;
		});
		return {
			red,
			loads: info.errors.length === 0,
			errors: info.errors.slice(0, 3),
			refused: [...new Set(info.csp)],
			node: info.node,
		};
	} finally {
		await strict.app.close();
	}
};

const fit = async (lib) => {
	const underAppCsp = await underApp(lib);
	const withFetch = await underApp(lib, FETCH_CSP);
	// Under the measuring policy: text, cursors, the accessibility tree.
	const {app, page, info} = await open(lib, 2, MEASURE_CSP);
	try {
		if (info.errors.length > 0) return {lib, underAppCsp, withFetch, failed: info.errors};
		await page.evaluate(() => window.bench.write(0, "hello from 142\r\ntsh$ "));
		await page.evaluate(() => window.bench.write(1, "\r\n"));
		await sleep(600);
		const text = await page.evaluate(() => window.bench.text(0));
		// The browser's own find (Cmd-F), from outside the terminal's input.
		const findable = await page.evaluate(() => {
			document.activeElement?.blur();
			window.getSelection()?.removeAllRanges();
			const found = window.find("hello from 142");
			window.getSelection()?.removeAllRanges();
			return found;
		});
		// Each tile had focus once, as a tile in the app has when it is made (xterm draws no cursor
		// in a terminal that never had focus or input).
		await page.evaluate(() => window.bench.focus(1));
		await sleep(300);
		await page.evaluate(() => window.bench.focus(0));
		await sleep(400);
		const focused = await cursorOf(page, 0);
		const unfocused = await cursorOf(page, 1);
		const ax = await axSummary(page);
		return {
			lib,
			underAppCsp,
			withFetch,
			node: info.node,
			textRead: text.includes("hello from 142"),
			browserFind: findable,
			cursor: {focused, unfocused},
			ax,
		};
	} finally {
		await app.close();
	}
};

/**
 * The real app, for comparison: idle CPU with 1, 4 and 16 tiles made with the desk's own keys,
 * as experiment 141 made them. Needs `pnpm --filter @kampus/fabrika-app-old build` first. `Browser`
 * is the main process, where every tile's tsh runs.
 */
const appIdle = async (count) => {
	const appDir = join(root, "apps/fabrika");
	const home = await mkdtemp(join(tmpdir(), "fabrika-142-"));
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [appDir],
		env: {...process.env, FABRIKA_HOME: home},
	});
	try {
		const page = await app.firstWindow();
		const tiles = () => page.locator("[data-tile]").count();
		await page.locator('[data-tile="t1"] .screen-text').waitFor({timeout: 20_000});
		for (let i = 1; i < count; i += 1) {
			const boxes = await page.locator("[data-tile]").evaluateAll((all) =>
				all.map((t) => {
					const r = t.getBoundingClientRect();
					return {id: t.getAttribute("data-tile"), w: r.width, h: r.height};
				}),
			);
			const big = boxes.sort((a, b) => b.w * b.h - a.w * a.h)[0];
			await page.locator(`[data-tile="${big.id}"]`).click();
			await page.keyboard.press("Control+b");
			await page.keyboard.press(big.w >= big.h * 1.6 ? "|" : "-");
			for (let w = 0; w < 200 && (await tiles()) < i + 1; w += 1) await sleep(25);
		}
		await sleep(4000);
		const first = await metrics(app);
		const t0 = performance.now();
		await sleep(IDLE_S * 1000);
		const last = await metrics(app);
		const wall = (performance.now() - t0) / 1000;
		const core = (type) => round(((cpuSeconds(last, type) - cpuSeconds(first, type)) / wall) * 100);
		return {
			count,
			tiles: await tiles(),
			rendererCorePercent: core("Tab"),
			gpuCorePercent: core("GPU"),
			mainCorePercent: core("Browser"),
		};
	} finally {
		await app.close();
	}
};

/**
 * Busy: CPU while every terminal scrolls a build log at BUSY_LINES colored lines a second, read
 * the same way as idle, over BUSY_S seconds after 2 s to settle.
 */
const BUSY_LINES = 200;
const BUSY_S = 10;
const busy = async (lib, n) => {
	const {app, page, info} = await open(lib, n, MEASURE_CSP);
	try {
		if (info.errors.length > 0) return {lib, n, failed: info.errors};
		await sleep(3000);
		await page.evaluate((k) => window.bench.stream(k), BUSY_LINES);
		await sleep(2000);
		const one = await idle(app, page, BUSY_S);
		await page.evaluate(() => window.bench.stop());
		return {lib, n, linesPerSecond: BUSY_LINES, ...one};
	} finally {
		await app.close();
	}
};

/**
 * Large: idle with 16 tiles of 600 by 340 in a 2400 by 1360 window, four times the pixels, as a
 * window filling a big screen has. Does idle cost follow the pixels drawn?
 */
const large = async (lib) => {
	const {app, page, info} = await open(lib, 16, MEASURE_CSP, "600x340", "2400x1360");
	try {
		if (info.errors.length > 0) return {lib, n: 16, failed: info.errors};
		await sleep(3000);
		return {lib, n: 16, tile: "600x340", window: "2400x1360", ...(await idle(app, page))};
	} finally {
		await app.close();
	}
};

/**
 * Growth: does an idle frame cost more as the scrollback fills, or as the tile stays open? Two
 * tiles, as the owner's app had. Idle is read fresh, after each tile has printed 1,000 lines
 * (its scrollback full), after 20,000 more, and after 3 more minutes open. Each reading also
 * gives the time inside render calls, per call.
 */
const growth = async (lib) => {
	const {app, page, info} = await open(lib, 2, MEASURE_CSP);
	const time = () => page.evaluate(() => ({...(globalThis.renderTime ?? {ms: 0, calls: 0})}));
	const reading = async (label) => {
		const t0 = await time();
		const one = await idle(app, page, 10);
		const t1 = await time();
		const calls = t1.calls - t0.calls;
		return {
			label,
			rendererCorePercent: one.rendererCorePercent,
			gpuCorePercent: one.gpuCorePercent,
			drawsPerSecond: one.drawsPerSecond,
			msPerRender: calls === 0 ? null : Math.round(((t1.ms - t0.ms) / calls) * 1000) / 1000,
			rendererWorkingSetMB: one.rendererWorkingSetMB,
		};
	};
	const print = async (lines) => {
		for (let i = 0; i < 2; i += 1)
			await page.evaluate(
				([i, lines]) => {
					const text = Array.from(
						{length: lines},
						(_, k) => `\x1b[32m${k}\x1b[0m line of an old build log ${k % 97}\r\n`,
					).join("");
					window.bench.write(i, `${text}tsh$ `);
				},
				[i, lines],
			);
		await sleep(2000);
	};
	try {
		if (info.errors.length > 0) return {lib, failed: info.errors};
		await sleep(3000);
		const out = [await reading("fresh")];
		await print(1000);
		out.push(await reading("1,000 lines"));
		await print(20_000);
		out.push(await reading("21,000 lines"));
		await sleep(180_000);
		out.push(await reading("3 minutes later"));
		return {lib, n: 2, readings: out};
	} finally {
		await app.close();
	}
};

// A run of some libraries replaces theirs in the saved file and keeps the rest.
const saved = join(root, "experiments/results/142-web-terminals.json");
const old = await readFile(saved, "utf8")
	.then((s) => JSON.parse(s))
	.catch(() => ({results: [], fits: [], app: []}));
/** A STEP run measures one thing and keeps every library's other results. */
const replaces = (r) => process.env.STEP === undefined && LIBS.includes(r.lib);
const results = old.results.filter((r) => !replaces(r));
const fits = old.fits.filter((r) => !replaces(r));
let theApp = old.app ?? [];
const busyRuns = (old.busy ?? []).filter(
	(r) => process.env.STEP !== "busy" || !LIBS.includes(r.lib),
);
const growthRuns = (old.growth ?? []).filter(
	(r) => process.env.STEP !== "growth" || !LIBS.includes(r.lib),
);
const largeRuns = (old.large ?? []).filter(
	(r) => process.env.STEP !== "large" || !LIBS.includes(r.lib),
);
const save = async () => {
	const os = await import("node:os");
	const body = {
		machine: {platform: process.platform, arch: process.arch, cpus: os.cpus()[0]?.model},
		electron: "45.0.0",
		tile: "300x190",
		window: "1200x760",
		idleSeconds: IDLE_S,
		csp: {app: APP_CSP, measure: MEASURE_CSP},
		results,
		fits,
		busy: busyRuns,
		large: largeRuns,
		growth: growthRuns,
		app: theApp,
	};
	await writeFile(saved, `${JSON.stringify(body, null, 2)}\n`);
};

if (process.env.STEP === "app") {
	theApp = [];
	for (const count of COUNTS) {
		const one = await appIdle(count);
		console.log(JSON.stringify(one));
		theApp.push(one);
	}
	await save();
	process.exit(0);
}

await make();
if (process.env.STEP === "busy") {
	for (const lib of LIBS)
		for (const n of COUNTS) {
			const one = await busy(lib, n);
			console.log(JSON.stringify(one));
			busyRuns.push(one);
		}
	await save();
	process.exit(0);
}
if (process.env.STEP === "growth") {
	for (const lib of LIBS) {
		const one = await growth(lib);
		console.log(JSON.stringify(one));
		growthRuns.push(one);
	}
	await save();
	process.exit(0);
}
if (process.env.STEP === "large") {
	for (const lib of LIBS) {
		const one = await large(lib);
		console.log(JSON.stringify(one));
		largeRuns.push(one);
	}
	await save();
	process.exit(0);
}
for (const lib of LIBS) {
	// The control has nothing to fit.
	if (lib !== "blank") {
		const f = await fit(lib);
		console.log(JSON.stringify(f));
		fits.push(f);
	}
	for (const n of COUNTS) {
		const one = await measure(lib, n);
		console.log(JSON.stringify({...one, served: undefined}));
		results.push(one);
	}
	// One tile the size of the window: how idle cost grows with the pixels a terminal covers.
	if (BIG.includes(lib)) {
		const one = await measure(lib, 1, "1200x760");
		console.log(JSON.stringify({...one, served: undefined}));
		results.push(one);
	}
	await save();
}
