import {mkdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import {Shown, shownOf} from "@tea-fabrika/ticket";
import {One, oneOf} from "@tea-fabrika/tracker";
import {SEVEN_NOW, trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {Schema} from "effect";
import {chromium} from "playwright";
import {createStack, createTabbed, createTile, type StackNode} from "./src/desk/layout/node.ts";
import {readToPage, readToWindow} from "./src/messages.ts";

// The desk's page with no Electron and no host: the built renderer (dist/) in headless Chromium,
// handed a desk and three views as the host would send them. The views are the ticket, map and
// trace programs' own, of the stand-in ticket #7 (@tea-fabrika/tracker/seven). It opens no
// window, takes no focus and needs no network: the page's files are served from dist/ by the
// browser's own request hook. Not part of `pnpm test`.
//
//   pnpm --filter @kampus/fabrika-app shots                writes docs/round-6/*.png
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app shots  writes them there
//
//   ticket.png         t1, t2, t3 tabbed, on t1: the ticket
//   map.png            the same, on t2: the map of today's programs
//   trace.png          the same, on t3: the ticket's runs in time
//   side-by-side.png   the ticket beside the map over the trace

const DIST = join(import.meta.dirname, "dist");
const OUT = process.env.SHOTS ?? join(import.meta.dirname, "docs", "round-6");
const ORIGIN = "http://fabrika.test";
const TYPES: Readonly<Record<string, string>> = {
	html: "text/html",
	js: "text/javascript",
	css: "text/css",
	wasm: "application/wasm",
};

const state = trackerAtSeven();
const views = {
	1: {type: "view", program: "ticket", data: Schema.encodeSync(Shown)(shownOf(state))},
	2: {type: "view", program: "map", data: Schema.encodeSync(One)(oneOf(state))},
	3: {type: "view", program: "trace", data: Schema.encodeSync(One)(oneOf(state))},
} as const;
for (const view of Object.values(views)) {
	const read = readToWindow(view);
	if (read.kind === "refused") throw new Error(`a view does not read: ${read.why}`);
}

const tiles = [
	createTile("t1", {kind: "tsh", run: {id: "1", program: "ticket"}}),
	createTile("t2", {kind: "tsh", run: {id: "2", program: "map"}}),
	createTile("t3", {kind: "tsh", run: {id: "3", program: "trace"}}),
] as const;

/** The desk message for one layout, focused on `focused`. */
const deskWith = (root: StackNode, focused: string) => {
	const msg = {
		type: "desk",
		desk: {
			at: "open",
			workspaces: [{id: "1", layout: {root, zoomed: null}, focused}],
			active: "1",
			prefix: {armed: false},
			ask: null,
			running: {},
			closing: [],
			next: 4,
		},
		takes: {all: false, keys: ["<c-b>"]},
	};
	const read = readToPage(msg);
	if (read.kind === "refused") throw new Error(`the desk does not read: ${read.why}`);
	return msg;
};

const shots = [
	{name: "ticket", desk: deskWith(createTabbed("s1", tiles, "t1"), "t1")},
	{name: "map", desk: deskWith(createTabbed("s1", tiles, "t2"), "t2")},
	{name: "trace", desk: deskWith(createTabbed("s1", tiles, "t3"), "t3")},
	{
		name: "side-by-side",
		desk: deskWith(
			createStack(
				"s1",
				"horizontal",
				[tiles[0], createStack("s2", "vertical", [tiles[1], tiles[2]])],
				{
					t1: 42,
					s2: 58,
				},
			),
			"t1",
		),
	},
];

/** The bridge preload.cjs gives the page, with the host's messages played into it. */
const bridge = (arg: {desk: unknown; views: Readonly<Record<string, unknown>>}) => {
	const send = (fn: (raw: unknown) => void, raw: unknown) => setTimeout(() => fn(raw), 0);
	Object.defineProperty(window, "fabrika", {
		value: {
			send: () => {},
			forget: () => {},
			onMessage: (port: string, fn: (raw: unknown) => void) => {
				if (port === "desk") send(fn, arg.desk);
				const view = port.startsWith("run:") ? arg.views[port.slice(4)] : undefined;
				if (view !== undefined) send(fn, view);
			},
		},
	});
};

await mkdir(OUT, {recursive: true});
const browser = await chromium.launch({headless: true});
try {
	for (const shot of shots) {
		const context = await browser.newContext({
			viewport: {width: 1440, height: 900},
			deviceScaleFactor: 2,
			timezoneId: "UTC",
			colorScheme: "dark",
		});
		const page = await context.newPage();
		page.on("pageerror", (e) => console.error(`${shot.name}: ${e.message}`));
		await page.route(`${ORIGIN}/**`, async (route) => {
			const file = new URL(route.request().url()).pathname.slice(1);
			const type = TYPES[file.split(".").at(-1) ?? ""];
			if (type === undefined || file.includes("/")) return route.fulfill({status: 404});
			return route.fulfill({contentType: type, body: await readFile(join(DIST, file))});
		});
		await page.route(/^(?!http:\/\/fabrika\.test\/)/, (route) => route.abort());
		await page.addInitScript(bridge, {desk: shot.desk, views});
		// The clock the page reads is the stand-in's, so "5 minutes" reads as it does at 10:14.
		await page.clock.setFixedTime(SEVEN_NOW);
		await page.goto(`${ORIGIN}/desk.html`);
		await page.waitForSelector("[data-view]");
		await page.waitForTimeout(600);
		await page.screenshot({path: join(OUT, `${shot.name}.png`)});
		console.log(`${shot.name}.png`);
		await context.close();
	}
} finally {
	await browser.close();
}
