// Experiment 141: how many ghostty-web terminals does the app's one page hold?
//
// The app (apps/fabrika) draws every tile in one window, each tile a ghostty-web terminal on its
// own canvas, all in one renderer. This opens the real app on a fresh home, makes 1, 4, 8 and 16
// tiles with the desk's own keys (Ctrl-B | and Ctrl-B -), and reads, for each count:
//
//   memory     Electron's app.getAppMetrics(): the renderer's and the main process's working set
//              and private bytes, and the page's JS heap (performance.memory)
//   frames     the time between animation frames over 3 s: idle, and with every tile printing
//              `seq --to 2000` at once
//   typing     30 keys into the focused tile: keydown to the echo in the tile's screen text, and
//              to the frame after it
//
// No model, no key, no network. Needs the app built: `pnpm --filter @kampus/fabrika-app build`.
//
//   node experiments/141-tiles-in-one-page.ts
//
// Saves experiments/results/141-tiles-in-one-page.json.

import {mkdtemp, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
const appDir = join(root, "apps/fabrika");
const require = createRequire(join(appDir, "package.json"));
const {_electron} = require("playwright");
const electronPath = require("electron");

const COUNTS = (process.env.COUNTS ?? "1,4,8,16").split(",").map(Number);

const quantile = (xs, q) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const round = (x) => (x === null ? null : Math.round(x * 10) / 10);
const summary = (xs) => ({
	n: xs.length,
	median: round(quantile(xs, 0.5)),
	p95: round(quantile(xs, 0.95)),
	max: round(Math.max(...xs)),
});

const screen = (page, id) =>
	page.locator(`[data-tile="${id}"] .screen-text`).textContent({timeout: 5000});
const prompted = async (page, id) => {
	for (let i = 0; i < 400; i += 1) {
		const text = (await screen(page, id).catch(() => "")) ?? "";
		if (text.split("\n").at(-1) === "tsh$") return;
		await page.waitForTimeout(25);
	}
	throw new Error(`no prompt in ${id}: ${JSON.stringify(await screen(page, id).catch(String))}`);
};
const tiles = (page) =>
	page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));
const focused = (page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile");

/** Animation frame gaps over `ms`, in the page. */
const frames = (page, ms) =>
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

const measure = async (count) => {
	const home = await mkdtemp(join(tmpdir(), "fabrika-141-"));
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [appDir],
		env: {...process.env, FABRIKA_HOME: home},
	});
	try {
		const page = await app.firstWindow();
		await prompted(page, "t1");
		// Split the biggest tile each time, along its long side, so the tiles stay near equal.
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
			for (let w = 0; w < 200 && (await tiles(page)).length < i + 1; w += 1)
				await page.waitForTimeout(25);
			await prompted(page, await focused(page));
		}
		const ids = await tiles(page);
		if (ids.length !== count) throw new Error(`wanted ${count} tiles, have ${ids.length}`);
		await page.waitForTimeout(2000);

		const metrics = await app.evaluate(({app}) => app.getAppMetrics());
		const kb = (type) =>
			metrics
				.filter((m) => m.type === type)
				.reduce(
					(acc, m) => ({
						workingSetMB: acc.workingSetMB + m.memory.workingSetSize / 1024,
						privateMB: acc.privateMB + (m.memory.privateBytes ?? 0) / 1024,
					}),
					{workingSetMB: 0, privateMB: 0},
				);
		const heapMB = await page.evaluate(() => performance.memory.usedJSHeapSize / 1024 / 1024);
		const renderer = kb("Tab");
		const browser = kb("Browser");

		const idle = await frames(page, 3000);
		// Every tile prints at once: the page draws them all while it parses each tile's bytes.
		await page.evaluate((ids) => {
			for (const id of ids)
				window.fabrika.send(`tile:${id}`, {type: "keys", data: "seq --to 2000\r"});
		}, ids);
		const busy = await frames(page, 3000);
		for (const id of ids) await prompted(page, id);

		// Typing: keydown to the echo in the focused tile's screen text, and to the frame after.
		const typed = await focused(page);
		await page.evaluate((id) => {
			const text = document.querySelector(`[data-tile="${id}"] .screen-text`);
			const seen = {down: [], echo: [], frame: []};
			window.__seen = seen;
			window.addEventListener("keydown", () => seen.down.push(performance.now()), {capture: true});
			new MutationObserver(() => {
				if (seen.echo.length >= seen.down.length) return;
				const at = performance.now();
				seen.echo.push(at);
				requestAnimationFrame((now) => seen.frame.push(now));
			}).observe(text, {childList: true, characterData: true, subtree: true});
		}, typed);
		for (let i = 0; i < 30; i += 1) {
			const before = await page.evaluate(() => window.__seen.echo.length);
			await page.keyboard.press("a");
			for (let w = 0; w < 200; w += 1) {
				if ((await page.evaluate(() => window.__seen.frame.length)) > before) break;
				await page.waitForTimeout(5);
			}
		}
		const seen = await page.evaluate(() => window.__seen);
		const echo = seen.echo.map((t, i) => t - seen.down[i]);
		const frame = seen.frame.map((t, i) => t - seen.down[i]);

		return {
			count,
			memory: {
				rendererWorkingSetMB: round(renderer.workingSetMB),
				mainWorkingSetMB: round(browser.workingSetMB),
				pageHeapMB: round(heapMB),
			},
			frames: {idle: summary(idle), busy: summary(busy)},
			typing: {echo: summary(echo), frame: summary(frame)},
		};
	} finally {
		await app.close();
	}
};

const results = [];
for (const count of COUNTS) {
	const one = await measure(count);
	console.log(JSON.stringify(one));
	results.push(one);
}
const machine = {
	platform: process.platform,
	arch: process.arch,
	cpus: (await import("node:os")).cpus()[0]?.model,
};
await writeFile(
	join(root, "experiments/results/141-tiles-in-one-page.json"),
	`${JSON.stringify({machine, window: "1200x760", results}, null, 2)}\n`,
);
