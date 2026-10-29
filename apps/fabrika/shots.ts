import {mkdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import {Shown, shownOf} from "@tea-fabrika/ticket";
import {One, oneOf} from "@tea-fabrika/tracker";
import {SEVEN_NOW, trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {Schema} from "effect";
import {chromium} from "playwright";
import {type ContainerNode, createContainer, createTile} from "./src/desk/layout/node.ts";
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
//   ticket.png         the ticket, with the map and the trace folded into strips beside it
//   folded-column.png  the ticket beside a column of the map over the trace, the column folded
//   folded-trace.png   the same column open, the trace folded into a strip under the map
//   side-by-side.png   the ticket beside the map over the trace
//
// The round-6 pictures in docs/round-6 were made when the map and the trace were tabs. The
// script now draws folds; run it with SHOTS set to keep those pictures as they are.

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

/** The three tiles, each showing its program; the ones named in `folded` folded into strips. */
const tilesWith = (...folded: readonly string[]) =>
	(
		[
			["t1", "1", "ticket"],
			["t2", "2", "map"],
			["t3", "3", "trace"],
		] as const
	).map(([tile, run, program]) =>
		createTile(tile, {kind: "tsh", run: {id: run, program}}, folded.includes(tile)),
	);

/** The ticket beside a column of the map over the trace. */
const column = (...folded: readonly string[]) => {
	const [ticket, map, trace] = tilesWith(...folded);
	if (ticket === undefined || map === undefined || trace === undefined)
		throw new Error("three tiles");
	return createContainer(
		"c1",
		"horizontal",
		[ticket, createContainer("c2", "vertical", [map, trace])],
		{t1: 42, c2: 58},
	);
};

/** The desk message for one layout, focused on `focused`. */
const deskWith = (root: ContainerNode, focused: string) => {
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
	{
		name: "ticket",
		desk: deskWith(createContainer("c1", "horizontal", tilesWith("t2", "t3")), "t1"),
	},
	{name: "folded-column", desk: deskWith(column("t2", "t3"), "t1")},
	{name: "folded-trace", desk: deskWith(column("t3"), "t2")},
	{name: "side-by-side", desk: deskWith(column(), "t1")},
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
