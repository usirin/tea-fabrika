import {mkdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import {applyCell} from "@demlik/tea";
import {Shown, shownOf} from "@tea-fabrika/ticket";
import {
	type Model,
	nodesOf,
	Shown as TraceShown,
	shownOf as traceShownOf,
	treeOf,
} from "@tea-fabrika/trace";
import {TALLY_TRACE} from "@tea-fabrika/trace/tally";
import {One, oneOf, tracker} from "@tea-fabrika/tracker";
import {SEVEN_NOW, trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {Schema} from "effect";
import {chromium} from "playwright";
import {type Desk, type DeskCmd, type DeskMsg, deskMachine} from "./src/desk/desk.ts";
import {type ContainerNode, createContainer, createTile} from "./src/desk/layout/node.ts";
import {readToPage, readToWindow} from "./src/messages.ts";

// The desk's page with no Electron and no host: the built renderer (dist/) in headless Chromium,
// handed a desk and its views as the host would send them. The views are the tracker, ticket,
// map and runs programs' own, of the stand-in ticket #7 (@tea-fabrika/tracker/seven), and the trace
// program's, of the `seq --to 3 | tally` record (@tea-fabrika/trace/tally). It opens no
// window, takes no focus and needs no network: the page's files are served from dist/ by the
// browser's own request hook. Not part of `pnpm test`.
//
//   pnpm --filter @kampus/fabrika-app-old shots                writes docs/round-6/*.png
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app-old shots  writes them there
//
//   ticket.png         the ticket, with the map and the runs folded into strips beside it
//   folded-column.png  the ticket beside a column of the map over the runs, the column folded
//   folded-runs.png    the same column open, the runs folded into a strip under the map
//                      (folded-trace.png before the old trace view became `runs`)
//   side-by-side.png   the ticket beside the map over the runs
//   job-trace.png      the job's trace as it first opens, the ticket, map and runs folded beside it
//   job-step.png       the same, the trace opened to tally, count total, add 2
//   line-beside.png    `tracker | ticket | runs` typed in t2, beside the map: three windows, one tint
//   line-tight.png     the same line typed in the third of three columns: the ticket and runs folded
//
// The round-6 pictures in docs/round-6 were made when the map and the runs were tabs, and the
// runs view was named `trace`. The script now draws folds; run it with SHOTS set to keep those
// pictures as they are.

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

/** The trace's state with the rows named open, and the last one chosen. */
const traceWith = (names: readonly string[]): Model => {
	const nodes = nodesOf(treeOf(TALLY_TRACE));
	const keys = names.map((name) => {
		const found = nodes.find((n) => n.name === name);
		if (found === undefined) throw new Error(`the tally trace has no row ${name}`);
		return found.key;
	});
	return {
		read: {at: "read", trace: TALLY_TRACE, now: null},
		open: ["job", ...keys.slice(0, -1)],
		chosen: keys.at(-1) ?? null,
	};
};
const traceView = (model: Model) => ({
	type: "view",
	program: "trace",
	data: Schema.encodeSync(TraceShown)(traceShownOf(model)),
});

const views = {
	1: {type: "view", program: "ticket", data: Schema.encodeSync(Shown)(shownOf(state))},
	2: {type: "view", program: "map", data: Schema.encodeSync(One)(oneOf(state))},
	3: {type: "view", program: "runs", data: Schema.encodeSync(One)(oneOf(state))},
	4: traceView({read: {at: "read", trace: TALLY_TRACE, now: null}, open: ["job"], chosen: null}),
	5: traceView(traceWith(["tally", "count total", "add 2"])),
	6: {
		type: "view",
		program: "tracker",
		data: Schema.encodeSync(tracker.view.data)(tracker.view.of(state)),
	},
} as const;
for (const view of Object.values(views)) {
	const read = readToWindow(view);
	if (read.kind === "refused") throw new Error(`a view does not read: ${read.why}`);
}

/** The run, and so the view, each tile shows. t4 and t5 both show the trace, opened two ways. */
const RUNS = {
	t1: {id: "1", program: "ticket"},
	t2: {id: "2", program: "map"},
	t3: {id: "3", program: "runs"},
	t4: {id: "4", program: "trace"},
	t5: {id: "5", program: "trace"},
} as const;
type Tile = keyof typeof RUNS;

/** The tiles named, each showing its run; the ones named in `folded` folded into strips. */
const tilesOf = (names: readonly Tile[], folded: readonly Tile[]) =>
	names.map((name) => createTile(name, {kind: "tsh", run: RUNS[name]}, folded.includes(name)));

/** The ticket beside a column of the map over the runs. */
const column = (...folded: readonly Tile[]) => {
	const [ticket, map, runs] = tilesOf(["t1", "t2", "t3"], folded);
	if (ticket === undefined || map === undefined || runs === undefined)
		throw new Error("three tiles");
	return createContainer(
		"c1",
		"horizontal",
		[ticket, createContainer("c2", "vertical", [map, runs])],
		{t1: 42, c2: 58},
	);
};

/** One trace tile filling the row, with the ticket, the map and the runs folded beside it. */
const traceRow = (trace: "t4" | "t5") =>
	createContainer("c1", "horizontal", tilesOf(["t1", "t2", "t3", trace], ["t1", "t2", "t3"]));

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
			jobs: {},
			closing: [],
			next: 6,
			area: null,
		},
		takes: {all: false, keys: ["<c-b>"]},
	};
	const read = readToPage(msg);
	if (read.kind === "refused") throw new Error(`the desk does not read: ${read.why}`);
	return msg;
};

/** The workspace's size in the 1440 by 900 window, as the page tells the host. */
const AREA: DeskMsg = {type: "area", width: 1432, height: 868};
const LINE = [
	{id: "6", program: "tracker"},
	{id: "1", program: "ticket"},
	{id: "3", program: "runs"},
] as const;

/**
 * The desk message after these Msgs, from a fresh desk: the desk machine's own steps, so the
 * picture is what `tracker | ticket | runs` opens.
 */
const deskAfter = (msgs: readonly DeskMsg[]) => {
	const [first] = deskMachine.init(null, undefined);
	const desk = msgs.reduce<Desk>(
		(s, m) => applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, m)[0],
		first,
	);
	const msg = {type: "desk", desk, takes: {all: false, keys: ["<c-b>"]}};
	const read = readToPage(JSON.parse(JSON.stringify(msg)));
	if (read.kind === "refused") throw new Error(`the desk does not read: ${read.why}`);
	return msg;
};

const split: readonly DeskMsg[] = [
	{type: "key", key: "<c-b>", at: 0},
	{type: "key", key: "|", at: 1},
];

const shots = [
	{
		name: "ticket",
		desk: deskWith(
			createContainer("c1", "horizontal", tilesOf(["t1", "t2", "t3"], ["t2", "t3"])),
			"t1",
		),
	},
	{name: "folded-column", desk: deskWith(column("t2", "t3"), "t1")},
	{name: "folded-runs", desk: deskWith(column("t3"), "t2")},
	{name: "side-by-side", desk: deskWith(column(), "t1")},
	{name: "job-trace", desk: deskWith(traceRow("t4"), "t4")},
	{name: "job-step", desk: deskWith(traceRow("t5"), "t5")},
	// The map in t1; in t2, beside it, the line opens: three windows, each a third of t2, one tint.
	{
		name: "line-beside",
		desk: deskAfter([
			AREA,
			...split,
			{type: "covered", tile: "t1", runs: [{id: "2", program: "map"}]},
			{type: "covered", tile: "t2", runs: LINE},
		]),
	},
	// Three columns; the line typed in the third would be under 220px a window: the ticket and the
	// runs open folded, and the tracker has the column.
	{
		name: "line-tight",
		desk: deskAfter([
			AREA,
			...split,
			{type: "key", key: "<c-b>", at: 10},
			{type: "key", key: "|", at: 11},
			{type: "covered", tile: "t1", runs: [{id: "2", program: "map"}]},
			{type: "covered", tile: "t3", runs: LINE},
		]),
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
