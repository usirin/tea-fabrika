// Experiment 177: can fabrika's window wear a theme from a shared file, swapped live, terminal
// included? Today's version only. It needs the spike commit on this branch (the same change is kept
// as experiments/177-themes/spike.patch): the app has no theme input without it.
//
//   pnpm --filter @kampus/fabrika-app-old build
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/177-themes.ts
//
// Add the word `radix` to run only the Radix picks, in a headless tab, with no window at all.
//
// Parts: the real app (Playwright on Electron, on a temp FABRIKA_HOME, its host stopped and the home
// removed after), then the same built page in a Chromium tab with the real views of ticket #7, as
// apps/fabrika/shots.ts feeds them. No model, no key, $0. About 2 minutes. It reads GitHub's public
// pull requests of this repo only because the tracker program does. Plain Node and Playwright,
// said here: like 143 and 150, this drives the app from outside, in Playwright's promises.

import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {applyCell} from "@demlik/tea";
import {Root} from "@tea-fabrika/markdown/root";
import {Shown, shownOf} from "@tea-fabrika/ticket";
import {nodesOf, Shown as TraceShown, shownOf as traceShownOf, treeOf} from "@tea-fabrika/trace";
import {TALLY_TRACE} from "@tea-fabrika/trace/tally";
import {One, oneOf, tracker} from "@tea-fabrika/tracker";
import {SEVEN_NOW, trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {Schema} from "effect";
import {deskMachine} from "../apps/fabrika/src/desk/desk.ts";
import {createContainer, createTile} from "../apps/fabrika/src/desk/layout/node.ts";
import {DESK_CSP} from "../apps/fabrika/src/files.ts";
import {THEMES, UNREADABLE} from "./177-themes/import.ts";
import {audit, fromRadix} from "./177-themes/radix.ts";

const root = join(import.meta.dirname, "..");
const appDir = join(root, "apps/fabrika");
const require = createRequire(join(appDir, "package.json"));
const {_electron, chromium} = require("playwright");
const electronPath = require("electron");

const SHOTS = join(import.meta.dirname, "177-themes/shots");
const RESULTS = join(import.meta.dirname, "results/177-themes.json");
await mkdir(SHOTS, {recursive: true});
/** `radix` runs only the Radix part, in a headless tab, and keeps the rest of the saved answers. */
const RADIX_ONLY = process.argv[2] === "radix";
const results: Record<string, unknown> = RADIX_ONLY
	? JSON.parse(await readFile(RESULTS, "utf8"))
	: {};

/** All sixteen as blocks, so the pixels say which color each is; then a line of plain text. */
const SAMPLE = `${Array.from({length: 8}, (_, i) => `\x1b[4${i}m    \x1b[0m`).join("")}\r\n${Array.from({length: 8}, (_, i) => `\x1b[10${i}m    \x1b[0m`).join("")}\r\n\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m \x1b[33myellow\x1b[0m \x1b[34mblue\x1b[0m \x1b[35mmagenta\x1b[0m \x1b[36mcyan\x1b[0m plain\r\n`;

const quantile = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return Math.round((s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) * 10) / 10;
};

/** In the page: does each of these colors appear, exactly, on any terminal canvas? */
const colorsOnCanvas = (page, colors: readonly string[]) =>
	page.evaluate((wanted: string[]) => {
		const seen = new Set<string>();
		for (const canvas of document.querySelectorAll(".term canvas")) {
			const c = canvas as HTMLCanvasElement;
			const ctx = c.getContext("2d");
			if (ctx === null || c.width === 0) continue;
			const {data} = ctx.getImageData(0, 0, c.width, c.height);
			for (let i = 0; i < data.length; i += 4) {
				seen.add(
					`#${[data[i], data[i + 1], data[i + 2]].map((u) => (u ?? 0).toString(16).padStart(2, "0")).join("")}`,
				);
			}
		}
		return wanted.filter((hex) => !seen.has(hex));
	}, colors);

/**
 * In the page: every element with its own text, its color against what is behind it, worst first,
 * grouped by its class. Computed colors go through a canvas, so oklch() and color-mix() read as RGB.
 */
const sweep = (page) =>
	page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext("2d", {willReadFrequently: true});
		if (ctx === null) throw new Error("no canvas");
		const parts = (css: string) => {
			ctx.clearRect(0, 0, 1, 1);
			ctx.fillStyle = css;
			ctx.fillRect(0, 0, 1, 1);
			const d = ctx.getImageData(0, 0, 1, 1).data;
			return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255] as const;
		};
		const lum = (r: number, g: number, b: number) => {
			const f = (u: number) => {
				const v = u / 255;
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const behind = (start: Element) => {
			const stack: (readonly [number, number, number, number])[] = [];
			for (let at: Element | null = start; at !== null; at = at.parentElement) {
				const bg = parts(getComputedStyle(at).backgroundColor);
				if (bg[3] > 0) stack.push(bg);
				if (bg[3] >= 1) break;
			}
			let [r, g, b] = [0, 0, 0];
			for (const [cr, cg, cb, a] of stack.reverse()) {
				r = cr * a + r * (1 - a);
				g = cg * a + g * (1 - a);
				b = cb * a + b * (1 - a);
			}
			return [r, g, b] as const;
		};
		const worst = new Map<string, {ratio: number; text: string; inline: boolean}>();
		let checked = 0;
		for (const el of document.querySelectorAll("#root *")) {
			const own = [...el.childNodes].some(
				(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
			);
			if (!own || el.closest(".screen-text") !== null) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			checked += 1;
			const style = getComputedStyle(el);
			const [r, g, b, a] = parts(style.color);
			const [br, bg, bb] = behind(el);
			const [x, y] = [
				lum(r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)),
				lum(br, bg, bb),
			];
			const ratio = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
			const key = `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
				.split(" ")
				.slice(0, 2)
				.join(".")}`;
			const was = worst.get(key);
			if (was === undefined || ratio < was.ratio) {
				worst.set(key, {
					ratio: Math.round(ratio * 100) / 100,
					text: (el.textContent ?? "").trim().slice(0, 30),
					inline: (el as HTMLElement).style.color !== "",
				});
			}
		}
		const rows = [...worst].map(([key, v]) => ({key, ...v})).sort((p, q) => p.ratio - q.ratio);
		return {
			checked,
			kinds: rows.length,
			under3: rows.filter((row) => row.ratio < 3),
			under45: rows.filter((row) => row.ratio < 4.5).length,
		};
	});

// Part 1: the real app.

const launch = async (home: string) => {
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [appDir],
		cwd: root,
		env: {...process.env, FABRIKA_HOME: home},
	});
	const page = await app.firstWindow();
	await page.waitForSelector("[data-tile]");
	await page.waitForTimeout(800);
	return {app, page};
};
const size = async (app, width: number, height: number) => {
	await app.evaluate(
		({BrowserWindow}, s) => BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height),
		{width, height},
	);
	await new Promise((resolve) => setTimeout(resolve, 500));
};
const stopHost = async (home: string) => {
	const pid = Number.parseInt(
		await readFile(join(home, "host", "pid"), "utf8").catch(() => ""),
		10,
	);
	if (Number.isInteger(pid)) {
		try {
			process.kill(pid);
		} catch {}
	}
	await new Promise((resolve) => setTimeout(resolve, 400));
	await rm(home, {recursive: true, force: true});
};
const prefixed = async (page, key: string) => {
	await page.keyboard.press("Control+b");
	await page.keyboard.press(key);
	await page.waitForTimeout(500);
};
const line = async (page, text: string, wait = 900) => {
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(wait);
};
const setTheme = async (page, theme) => {
	await page.evaluate((t) => window.fabrikaThemeProbe.set(t), theme);
	await page.waitForTimeout(250);
};

const LOOKS = {mocha: THEMES.mocha, solarized: THEMES.solarized, dracula: THEMES.dracula};

/** A tsh tile with the sixteen and a printed table, as the owner sees one after some work. */
const terminalWork = async (page) => {
	await page.evaluate((s) => window.fabrikaThemeProbe.draw(s), SAMPLE);
	await line(page, "experiments", 1500);
};

const LAYOUTS = {
	one: async (page) => {
		await terminalWork(page);
	},
	"side-by-side": async (page) => {
		await terminalWork(page);
		await prefixed(page, "|");
		await line(page, "experiment --n 170 | markdown", 2500);
	},
	stacked: async (page) => {
		await terminalWork(page);
		await prefixed(page, "-");
		await line(page, "tracker", 1500);
	},
	"2x2": async (page) => {
		await terminalWork(page);
		await prefixed(page, "|");
		await line(page, "experiment --n 170 | markdown", 2500);
		await prefixed(page, "-");
		await line(page, "tracker", 1500);
		await prefixed(page, "h");
		await prefixed(page, "-");
		await line(page, "counter", 900);
	},
};

const electronRun = {sweeps: {}, swaps: {}, terminal: {}, consoleWarnings: new Set<string>()};
for (const [layout, build] of RADIX_ONLY ? [] : Object.entries(LAYOUTS)) {
	const home = await mkdtemp(join(tmpdir(), "fabrika-home-177-"));
	const {app, page} = await launch(home);
	page.on("console", (m) => electronRun.consoleWarnings.add(m.text().slice(0, 100)));
	await size(app, 1440, 900);
	await build(page);
	await size(app, 1440, 900);
	electronRun.viewport = await page.evaluate(() => [innerWidth, innerHeight]);
	for (const [name, theme] of Object.entries(LOOKS)) {
		await setTheme(page, theme);
		await page.screenshot({path: join(SHOTS, `app-${name}-${layout}.png`)});
		electronRun.sweeps[`${name}/${layout}`] = await sweep(page);
		const missing = await colorsOnCanvas(page, theme.terminal.palette);
		electronRun.terminal[`${name}/${layout}`] = {missingPalette: missing.length};
	}
	if (layout === "2x2") {
		await size(app, 1024, 700);
		for (const [name, theme] of Object.entries(LOOKS)) {
			await setTheme(page, theme);
			await page.screenshot({path: join(SHOTS, `app-${name}-small.png`)});
		}
		await size(app, 1440, 900);

		// The cost of a swap, on four live tiles, then with 2,000 lines more in the terminal.
		const swap = (times: number) =>
			page.evaluate(
				async ({a, b, times}) => {
					const task: number[] = [];
					const frame: number[] = [];
					for (let i = 0; i < times; i += 1) {
						const start = performance.now();
						window.fabrikaThemeProbe.set(i % 2 === 0 ? a : b);
						void document.body.offsetHeight;
						task.push(performance.now() - start);
						await new Promise((resolve) => requestAnimationFrame(resolve));
						await new Promise((resolve) => requestAnimationFrame(resolve));
						frame.push(performance.now() - start);
					}
					return {task, frame};
				},
				{a: THEMES.mocha, b: THEMES.solarized, times},
			);
		const of = (r) => ({
			taskP50: quantile(r.task, 0.5),
			taskP95: quantile(r.task, 0.95),
			twoFramesP50: quantile(r.frame, 0.5),
			twoFramesP95: quantile(r.frame, 0.95),
		});
		electronRun.swaps["four tiles, a screen of text"] = of(await swap(20));
		await prefixed(page, "h");
		await page.evaluate(() => {
			let s = "";
			for (let i = 0; i < 2000; i += 1)
				s += `\x1b[3${i % 8}mline ${i} of the long output\x1b[0m\r\n`;
			window.fabrikaThemeProbe.draw(s);
		});
		await page.waitForTimeout(400);
		electronRun.swaps["the same, 2,000 colored lines more"] = of(await swap(20));
		await page.evaluate(() => {
			let s = "";
			for (let i = 0; i < 26000; i += 1)
				s += `\x1b[3${i % 8}mline ${i} of the long output\x1b[0m\r\n`;
			window.fabrikaThemeProbe.draw(s);
		});
		await page.waitForTimeout(400);
		electronRun.terminals = await page.evaluate(
			() => document.querySelectorAll(".term canvas").length,
		);
		electronRun.swaps["every terminal holding its full 1 MiB of kept bytes"] = of(await swap(10));

		// A frame sees the new page and the new terminal together: read both in the task of the swap.
		electronRun.oneTask = await page.evaluate(
			async ({a}) => {
				window.fabrikaThemeProbe.set(a);
				const n2 = document.documentElement.style.getPropertyValue("--n-2");
				const c = document.querySelector(".term canvas") as HTMLCanvasElement;
				const px = c.getContext("2d")?.getImageData(1, c.height - 2, 1, 1).data;
				return {
					n2,
					canvasCorner: px === undefined ? null : [...px].slice(0, 3),
					ground: a.terminal.background,
				};
			},
			{a: THEMES.dracula},
		);
		const before = await page.evaluate(() =>
			[...document.querySelectorAll(".screen-text")].map((e) => e.textContent),
		);
		await setTheme(page, THEMES.nord);
		const after = await page.evaluate(() =>
			[...document.querySelectorAll(".screen-text")].map((e) => e.textContent),
		);
		electronRun.textKept = JSON.stringify(before) === JSON.stringify(after);

		// A new tile after the swap, and the app's own look back.
		await prefixed(page, "|");
		electronRun.newTileMissing = (
			await colorsOnCanvas(page, [THEMES.nord.terminal.background])
		).length;
		await setTheme(page, null);
		await page.screenshot({path: join(SHOTS, "app-default-2x2-back.png")});
		electronRun.backToDefault = await page.evaluate(() => ({
			inline: document.documentElement.getAttribute("style"),
			scheme: getComputedStyle(document.documentElement).colorScheme,
		}));

		// A start on a kept theme: is it there before the first paint?
		await setTheme(page, THEMES.solarized);
		await app.close();
		const again = await launch(home);
		electronRun.restart = await again.page.evaluate(() => ({
			marks: performance.getEntriesByType("mark").map((m) => [m.name, Math.round(m.startTime)]),
			paints: performance.getEntriesByType("paint").map((m) => [m.name, Math.round(m.startTime)]),
			theme: document.documentElement.dataset.theme,
		}));
		await again.page.screenshot({path: join(SHOTS, "app-solarized-restart.png")});
		electronRun.restartBackground = await colorsOnCanvas(again.page, [
			THEMES.solarized.terminal.background,
		]);
		await again.app.close();
	} else {
		await app.close();
	}
	await stopHost(home);
}
if (!RADIX_ONLY) {
	results.electron = {...electronRun, consoleWarnings: [...electronRun.consoleWarnings]};
	console.log("electron done");
}

// Part 2: the built page in a Chromium tab, with the real views of ticket #7.

const state = trackerAtSeven();
const VIEWS = {
	1: {type: "view", program: "ticket", data: Schema.encodeSync(Shown)(shownOf(state))},
	2: {type: "view", program: "map", data: Schema.encodeSync(One)(oneOf(state))},
	3: {type: "view", program: "runs", data: Schema.encodeSync(One)(oneOf(state))},
	4: {
		type: "view",
		program: "trace",
		data: Schema.encodeSync(TraceShown)(
			traceShownOf({
				read: {at: "read", trace: TALLY_TRACE, now: null},
				open: [
					"job",
					...nodesOf(treeOf(TALLY_TRACE))
						.slice(0, 3)
						.map((n) => n.key),
				],
				chosen: null,
			}),
		),
	},
	6: {
		type: "view",
		program: "tracker",
		data: Schema.encodeSync(tracker.view.data)(tracker.view.of(state)),
	},
	7: {
		type: "view",
		program: "markdown",
		data: Schema.encodeSync(Root)(
			Root.fromMarkdown(await readFile(join(root, "programs/markdown/README.md"), "utf8")),
		),
	},
};
const RUNS = {
	t1: {id: "1", program: "ticket"},
	t2: {id: "2", program: "map"},
	t3: {id: "3", program: "runs"},
	t4: {id: "6", program: "tracker"},
	t5: {id: "4", program: "trace"},
	t6: {id: "7", program: "markdown"},
};
const tile = (name: keyof typeof RUNS) => createTile(name, {kind: "tsh", run: RUNS[name]}, false);
const deskOf = (root, focused: string) => ({
	type: "desk",
	desk: {
		at: "open",
		workspaces: [{id: "1", layout: {root, zoomed: null}, focused}],
		active: "1",
		prefix: {armed: false},
		ask: null,
		jobs: {},
		closing: [],
		next: 6,
		area: null,
	},
	takes: {all: false, keys: ["<c-b>"]},
});
const AREA = {type: "area", width: 1432, height: 868};
const split = [
	{type: "key", key: "<c-b>", at: 0},
	{type: "key", key: "|", at: 1},
];
const LINE = [
	{id: "6", program: "tracker"},
	{id: "1", program: "ticket"},
	{id: "3", program: "runs"},
];
const lineDesk = () => {
	const [first] = deskMachine.init(null, undefined);
	const desk = [
		AREA,
		...split,
		{type: "covered", tile: "t1", runs: [{id: "2", program: "map"}]},
		{type: "covered", tile: "t2", runs: LINE},
	].reduce((s, m) => applyCell(deskMachine, s, m)[0], first);
	return JSON.parse(JSON.stringify({type: "desk", desk, takes: {all: false, keys: ["<c-b>"]}}));
};
const grid = () =>
	createContainer("c1", "horizontal", [
		createContainer("c2", "vertical", [tile("t1"), tile("t3")]),
		createContainer("c3", "vertical", [tile("t2"), tile("t4")]),
	]);
const TAB_LAYOUTS = {
	one: {desk: deskOf(createContainer("c1", "horizontal", [tile("t1")]), "t1"), size: [1440, 900]},
	"side-by-side": {
		desk: deskOf(createContainer("c1", "horizontal", [tile("t1"), tile("t2")]), "t1"),
		size: [1440, 900],
	},
	stacked: {
		desk: deskOf(createContainer("c1", "vertical", [tile("t4"), tile("t3")]), "t4"),
		size: [1440, 900],
	},
	"2x2": {desk: deskOf(grid(), "t1"), size: [1440, 900]},
	small: {desk: deskOf(grid(), "t1"), size: [1024, 700]},
	line: {desk: lineDesk(), size: [1440, 900]},
	code: {
		desk: deskOf(createContainer("c1", "horizontal", [tile("t6"), tile("t1")]), "t6"),
		size: [1440, 900],
	},
	trace: {
		desk: deskOf(createContainer("c1", "horizontal", [tile("t5"), tile("t3")]), "t5"),
		size: [1440, 900],
	},
};

const ORIGIN = "http://fabrika.test";
const TYPES = {html: "text/html", js: "text/javascript", css: "text/css"};
const bridge = (arg) => {
	const sent: unknown[] = [];
	Object.defineProperty(window, "fabrikaSent", {value: sent});
	const later = (fn, raw) => setTimeout(() => fn(raw), 0);
	Object.defineProperty(window, "fabrika", {
		value: {
			send: (port: string, m: unknown) => sent.push([port, m]),
			forget: () => {},
			onMessage: (port: string, fn) => {
				if (port === "desk") later(fn, arg.desk);
				const view = port.startsWith("run:") ? arg.views[port.slice(4)] : undefined;
				if (view !== undefined) later(fn, view);
			},
		},
	});
};
const browser = await chromium.launch({headless: true});
const openTab = async (context, desk) => {
	const page = await context.newPage();
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = new URL(route.request().url()).pathname.slice(1);
		const type = TYPES[file.split(".").at(-1) ?? ""];
		if (type === undefined || file.includes("/")) return route.fulfill({status: 404});
		return route.fulfill({
			contentType: type,
			headers: {"content-security-policy": DESK_CSP},
			body: await readFile(join(appDir, "dist", file)),
		});
	});
	await page.route(/^(?!http:\/\/fabrika\.test\/)/, (route) => route.abort());
	await page.addInitScript(bridge, {desk, views: VIEWS});
	await page.clock.setFixedTime(SEVEN_NOW);
	await page.goto(`${ORIGIN}/desk.html`);
	await page.waitForSelector("[data-view]");
	await page.waitForTimeout(900);
	return page;
};
const contextOf = (s: number[]) =>
	browser.newContext({
		viewport: {width: s[0], height: s[1]},
		deviceScaleFactor: 1,
		timezoneId: "UTC",
	});

// Part 3: Radix picks in the tab, no Electron. A pick is written out to full values, then the page
// wears them, in each of the three maps fromRadix knows.
const setRadix = async (page, made) => {
	await setTheme(page, made.theme);
	await page.evaluate((tokens) => {
		for (const [name, value] of Object.entries(tokens)) {
			document.documentElement.style.setProperty(name, value as string);
		}
	}, made.tokens);
	await page.waitForTimeout(200);
};
const PICKS = [
	["slate", "indigo", "dark"],
	["slate", "blue", "dark"],
	["mauve", "iris", "dark"],
	["sand", "orange", "dark"],
	["slate", "red", "dark"],
	["slate", "indigo", "light"],
	["sand", "jade", "light"],
	["slate", "amber", "light"],
] as const;
{
	const radix = {audit: audit(THEMES), sweeps: {}, tint: {}};
	for (const [layout, {desk, size: s}] of Object.entries(TAB_LAYOUTS)) {
		const context = await contextOf(s);
		const page = await openTab(context, desk);
		for (const [gray, accent, look] of PICKS) {
			const modes =
				look === "dark"
					? (["naive", "lift", "own", "shift"] as const)
					: (["naive", "lift", "own"] as const);
			for (const mode of modes) {
				const made = fromRadix(gray, accent, look, mode);
				await setRadix(page, made);
				const key = `${gray}-${accent}-${look}`;
				radix.sweeps[`${key}/${mode}/${layout}`] = await sweep(page);
				const kept = key === "slate-indigo-dark" ? ["2x2", "line", "one"] : ["2x2"];
				const shown =
					["slate-indigo-dark", "slate-indigo-light"].includes(key) && kept.includes(layout);
				const collision = key === "slate-red-dark" && layout === "2x2" && mode === "shift";
				if ((shown && mode !== "lift") || collision) {
					await page.screenshot({path: join(SHOTS, `radix-${key}-${mode}-${layout}.png`)});
				}
				if (
					key === "slate-indigo-dark" &&
					mode === "shift" &&
					["side-by-side", "stacked", "small"].includes(layout)
				) {
					await page.screenshot({path: join(SHOTS, `radix-${key}-${mode}-${layout}.png`)});
				}
				if (
					key === "slate-indigo-light" &&
					mode === "own" &&
					["side-by-side", "stacked", "small", "one"].includes(layout)
				) {
					await page.screenshot({path: join(SHOTS, `radix-${key}-${mode}-${layout}.png`)});
				}
			}
		}
		await context.close();
	}

	// A piped tile's ground and its text, two ways. Today: color-mix of the line color into the
	// gray. The other branch's: the gray's lightness kept, with a set chroma and the line's hue.
	// The chroma here, 0.03, is this run's guess.
	const context = await contextOf([300, 200]);
	const page = await openTab(context, TAB_LAYOUTS.one.desk);
	const tints = {
		default: null,
		...Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t])),
		"slate-indigo-dark": fromRadix("slate", "indigo", "dark", "lift").theme,
		"slate-indigo-light": fromRadix("slate", "indigo", "light", "lift").theme,
	};
	for (const [name, theme] of Object.entries(tints)) {
		await setTheme(page, theme);
		radix.tint[name] = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			const ctx = canvas.getContext("2d", {willReadFrequently: true});
			const read = (css: string) => {
				ctx.fillStyle = "#000";
				ctx.fillRect(0, 0, 1, 1);
				ctx.fillStyle = css;
				ctx.fillRect(0, 0, 1, 1);
				return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
			};
			const lum = ([r, g, b]) => {
				const f = (u: number) => {
					const v = u / 255;
					return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
			};
			const pair = (a: number[], b: number[]) => {
				const [x, y] = [lum(a), lum(b)];
				return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
			};
			const style = getComputedStyle(document.documentElement);
			const token = (name: string) => style.getPropertyValue(name).trim();
			const out = {mix: [], relative: [], gray: 0, text: 0};
			const n2 = token("--n-2");
			const faint = read(token("--n-9"));
			out.gray = Math.round(pair(faint, read(n2)) * 100) / 100;
			for (let i = 0; i < 6; i += 1) {
				const line = token(`--line-${i}`);
				const strength = Number.parseFloat(token("--line-strength"));
				const mix = read(`color-mix(in oklch, ${line} ${strength / 6}%, ${n2})`);
				const relative = read(`oklch(from ${n2} l 0.03 ${hueDegrees(read(line))})`);
				out.mix.push(Math.round(pair(faint, mix) * 100) / 100);
				out.relative.push(Math.round(pair(faint, relative) * 100) / 100);
			}
			return out;
			function hueDegrees([r, g, b]) {
				const f = (u: number) => {
					const v = u / 255;
					return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
				};
				const [lr, lg, lb] = [f(r), f(g), f(b)];
				const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
				const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
				const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
				const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
				const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
				return Math.round(((Math.atan2(B, A) * 180) / Math.PI + 360) % 360);
			}
		});
	}
	await context.close();
	results.radix = radix;
}

const tab = {sweeps: {}, swaps: {}};
const TAB_THEMES = {default: null, ...THEMES};
for (const [layout, {desk, size: s}] of RADIX_ONLY ? [] : Object.entries(TAB_LAYOUTS)) {
	const context = await contextOf(s);
	const page = await openTab(context, desk);
	for (const [name, theme] of Object.entries(TAB_THEMES)) {
		await setTheme(page, theme);
		if (["default", "mocha", "solarized", "latte"].includes(name) || layout === "line")
			await page.screenshot({path: join(SHOTS, `tab-${name}-${layout}.png`)});
		tab.sweeps[`${name}/${layout}`] = await sweep(page);
	}
	await context.close();
}

// A swap with views only, no terminal: the cost of the tokens alone.
if (!RADIX_ONLY) {
	const context = await contextOf([1440, 900]);
	const page = await openTab(context, TAB_LAYOUTS["2x2"].desk);
	const r = await page.evaluate(
		async ({a, b}) => {
			const task: number[] = [];
			const elements = document.querySelectorAll("*").length;
			for (let i = 0; i < 30; i += 1) {
				const start = performance.now();
				window.fabrikaThemeProbe.set(i % 2 === 0 ? a : b);
				void getComputedStyle(document.body).color;
				void document.body.offsetHeight;
				task.push(performance.now() - start);
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
			return {task, elements};
		},
		{a: THEMES.mocha, b: THEMES.solarized},
	);
	tab.swaps = {
		elements: r.elements,
		taskP50: quantile(r.task, 0.5),
		taskP95: quantile(r.task, 0.95),
	};

	// Two people on one desk: the same messages, two browsers, each its own theme.
	const other = await contextOf([1440, 900]);
	const second = await openTab(other, TAB_LAYOUTS["2x2"].desk);
	await setTheme(page, THEMES.mocha);
	await setTheme(second, THEMES.latte);
	await page.screenshot({path: join(SHOTS, "two-people-a.png")});
	await second.screenshot({path: join(SHOTS, "two-people-b.png")});
	const groundOf = (p) =>
		p.evaluate(() => document.documentElement.style.getPropertyValue("--n-2"));
	tab.twoPeople = {a: await groundOf(page), b: await groundOf(second)};
	await other.close();

	// A bad theme: unreadable on purpose, what the repair moved, and whether anything is left under.
	await setTheme(page, UNREADABLE);
	await page.screenshot({path: join(SHOTS, "tab-unreadable-2x2.png")});
	tab.unreadable = {
		sweep: await sweep(page),
		moved: await page.evaluate((t) => window.fabrikaThemeProbe.tokens(t).moved.length, UNREADABLE),
	};
	await context.close();
}

// A tsh tile in a tab: answers in the replayed bytes must not reach tsh again.
if (!RADIX_ONLY) {
	const context = await contextOf([900, 600]);
	const page = await openTab(
		context,
		deskOf(
			createContainer("c1", "horizontal", [
				createTile("t1", {kind: "tsh", run: null}, false),
				tile("t2"),
			]),
			"t1",
		),
	);
	await page.waitForTimeout(300);
	await page.evaluate(() => window.fabrikaThemeProbe.draw("\x1b[6n"));
	const keys = () =>
		page.evaluate(() => window.fabrikaSent.filter(([, m]) => m.type === "keys").length);
	const first = await keys();
	await setTheme(page, THEMES.mocha);
	await setTheme(page, THEMES.solarized);
	tab.replayAnswers = {afterDraw: first, afterTwoSwaps: await keys()};
	await context.close();
}

// What a theme's values ask of the repair: each shared theme, in the page's own code.
if (!RADIX_ONLY) {
	const context = await contextOf([800, 600]);
	const page = await openTab(context, TAB_LAYOUTS.one.desk);
	tab.moved = {};
	tab.terminalContrast = {};
	for (const [name, theme] of Object.entries(THEMES)) {
		tab.moved[name] = await page.evaluate((t) => window.fabrikaThemeProbe.tokens(t).moved, theme);
		tab.terminalContrast[name] = await page.evaluate((t) => {
			const c = window.fabrikaThemeProbe.contrast;
			const bg = t.terminal.background;
			return {
				ink: Math.round(c(t.terminal.foreground, bg) * 100) / 100,
				under3: t.terminal.palette.filter((hex) => c(hex, bg) < 3).length,
			};
		}, theme);
	}
	// A value that is not a hex color goes no further than the decode.
	tab.refused = await page.evaluate((t) => {
		const tries = ["url(x)", "red", "var(--x)", "#fff", "#ABCDEF", "#12345678"];
		return tries.map((v) => {
			try {
				window.fabrikaThemeProbe.tokens({...t, ground: v});
				return [v, "taken"];
			} catch {
				return [v, "refused"];
			}
		});
	}, THEMES.mocha);
	await context.close();
}
await browser.close();
if (!RADIX_ONLY) results.tab = tab;

await writeFile(RESULTS, `${JSON.stringify(results, null, 2)}\n`);
console.log("wrote", RESULTS);
