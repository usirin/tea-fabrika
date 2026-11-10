import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {Shown as TraceShown, shownOf as traceShownOf} from "@tea-fabrika/trace";
import {TALLY_AT, TALLY_TRACE} from "@tea-fabrika/trace/tally";
import {Schema} from "effect";
import {chromium} from "playwright";
import {createContainer, createTile} from "./src/desk/layout/node.ts";
import {readToPage, readToWindow} from "./src/messages.ts";

// The trace ruler's labels, measured in the built renderer (the trace-ruler plan, P4 and P5).
// Today's version. jsdom cannot measure text, so this runs the page as shots.ts does: dist/ in
// headless Chromium, handed a desk and a view as the host would send them. No Electron, no host,
// no network, no FABRIKA_HOME (nothing here reads or writes one).
//
//   pnpm --filter @kampus/fabrika-app-old e2e:ruler
//
// Why not inside e2e.ts: e2e.ts drives the real app, where a ruler's width comes from the tile
// layout and a lane's length from a real run. It has no way to give one tile's ruler a chosen
// width, nor a trace of a chosen length. Here the job view's ruler is given each width by hand
// (its own `inline-size`, the size its container queries read), over a trace whose axis runs
// the chosen length: the tally record, read with `now` at that length.
//
//   P4  for each width from 60 to 1600px in 20px steps and each length: no two visible
//       `.wf-tick` boxes overlap, and neighbors keep at least 4px between them.
//   P5  from 120px up, "0" and at least one other label show; under 120px exactly one label
//       shows, and it ends in a unit (ms, s, min, h, d).

const DIST = join(import.meta.dirname, "dist");
const ORIGIN = "http://fabrika.test";

const TYPES: Readonly<Record<string, string>> = {
	html: "text/html",
	js: "text/javascript",
	css: "text/css",
	wasm: "application/wasm",
};

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/**
 * The plan's lane lengths: 30 s, 13 min 1 s, 29 min, 47 min 14 s, 2 h 10 min. 29 min is the
 * amendment's: before it, rank 0 there was "0" alone, and under 120px no label showed.
 */
const LENGTHS = [
	30 * SEC,
	13 * MIN + SEC,
	29 * MIN,
	47 * MIN + 14 * SEC,
	2 * HOUR + 10 * MIN,
] as const;

const WIDTHS = Array.from({length: (1600 - 60) / 20 + 1}, (_, k) => 60 + k * 20);
/** The least room between two labels shown side by side, in px. */
const ROOM = 4;
const UNIT = /\d (ms|s|min|h|d)$/;

/** The job view of the tally record, its axis `length` ms long. */
const viewOf = (length: number) => {
	const shown = traceShownOf({
		shows: {kind: "job", read: {at: "read", trace: TALLY_TRACE, now: TALLY_AT + length}},
		open: ["job"],
		chosen: null,
	});

	if (shown.shows !== "job" || shown.read !== "read" || shown.length !== length) {
		throw new Error(`the tally record does not read as a ${length} ms axis`);
	}

	const view = {type: "view", program: "trace", data: Schema.encodeSync(TraceShown)(shown)};
	const read = readToWindow(view);

	if (read.kind === "refused") {
		throw new Error(`the view does not read: ${read.why}`);
	}

	return view;
};

/** One trace tile filling the window. */
const desk = (() => {
	const root = createContainer("c1", "horizontal", [
		createTile("t1", {kind: "tsh", run: {id: "1", program: "trace"}}, false),
	]);
	const msg = {
		type: "desk",
		desk: {
			at: "open",
			workspaces: [{id: "1", layout: {root, zoomed: null}, focused: "t1"}],
			active: "1",
			prefix: {armed: false},
			ask: null,
			jobs: {},
			closing: [],
			next: 2,
			area: null,
		},
		takes: {all: false, keys: ["<c-b>"]},
	};
	const read = readToPage(msg);

	if (read.kind === "refused") {
		throw new Error(`the desk does not read: ${read.why}`);
	}

	return msg;
})();

/** The bridge preload.cjs gives the page, with the host's messages played into it. */
const bridge = (arg: {desk: unknown; view: unknown}) => {
	const send = (fn: (raw: unknown) => void, raw: unknown) => setTimeout(() => fn(raw), 0);
	Object.defineProperty(window, "fabrika", {
		value: {
			send: () => {},
			forget: () => {},
			onMessage: (port: string, fn: (raw: unknown) => void) => {
				if (port === "desk") {
					send(fn, arg.desk);
				}

				if (port === "run:1") {
					send(fn, arg.view);
				}
			},
		},
	});
};

type Label = {readonly text: string; readonly left: number; readonly right: number};

const failures: string[] = [];
const browser = await chromium.launch({headless: true});

try {
	for (const length of LENGTHS) {
		const context = await browser.newContext({
			viewport: {width: 1800, height: 900},
			timezoneId: "UTC",
			colorScheme: "dark",
		});
		const page = await context.newPage();
		page.on("pageerror", (e) => failures.push(`${length} ms: page error: ${e.message}`));
		await page.route(`${ORIGIN}/**`, async (route) => {
			const file = new URL(route.request().url()).pathname.slice(1);
			const type = TYPES[file.split(".").at(-1) ?? ""];

			if (type === undefined || file.includes("/")) {
				return route.fulfill({status: 404});
			}

			return route.fulfill({contentType: type, body: await readFile(join(DIST, file))});
		});
		await page.route(/^(?!http:\/\/fabrika\.test\/)/, (route) => route.abort());
		await page.addInitScript(bridge, {desk, view: viewOf(length)});
		await page.goto(`${ORIGIN}/desk.html`);
		await page.waitForSelector(".trace-view .wf-head .wf-ruler .wf-tick");
		await page.evaluate(() => document.fonts.ready);

		for (const width of WIDTHS) {
			const labels: readonly Label[] = await page.evaluate((w) => {
				const ruler = document.querySelector<HTMLElement>(".trace-view .wf-head .wf-ruler");

				if (ruler === null) {
					throw new Error("no ruler");
				}

				ruler.style.inlineSize = `${w}px`;
				ruler.style.minInlineSize = `${w}px`;
				ruler.style.maxInlineSize = `${w}px`;

				if (Math.round(ruler.getBoundingClientRect().width) !== w) {
					throw new Error(`the ruler took ${ruler.getBoundingClientRect().width}px, not ${w}px`);
				}

				return [...ruler.querySelectorAll<HTMLElement>(".wf-tick")]
					.filter((tick) => {
						const style = getComputedStyle(tick);
						const box = tick.getBoundingClientRect();
						return (
							style.display !== "none" &&
							style.visibility !== "hidden" &&
							Number(style.opacity) > 0 &&
							box.width > 0
						);
					})
					.map((tick) => {
						const box = tick.getBoundingClientRect();
						return {text: tick.textContent ?? "", left: box.left, right: box.right};
					})
					.toSorted((a, b) => a.left - b.left);
			}, width);
			const at = `${length} ms at ${width}px [${labels.map((l) => l.text).join(", ")}]`;

			// P4: no two labels meet.
			for (const [i, next] of labels.slice(1).entries()) {
				const prev = labels[i];

				if (prev !== undefined && next.left - prev.right < ROOM) {
					failures.push(
						`P4 ${at}: "${prev.text}" and "${next.text}" are ${(next.left - prev.right).toFixed(1)}px apart`,
					);
				}
			}

			// P5: under 120px one label with its unit; from 120px "0" and one more.
			if (width < 120) {
				const [one] = labels;

				if (labels.length !== 1 || one === undefined || !UNIT.test(one.text)) {
					failures.push(`P5 ${at}: under 120px, want exactly one label with its unit`);
				}
			} else if (labels[0]?.text !== "0" || labels.length < 2) {
				failures.push(`P5 ${at}: from 120px, want "0" and at least one other label`);
			}
		}

		await context.close();
	}
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	console.error(`${failures.length} ruler checks failed`);
	process.exitCode = 1;
} else {
	console.log(`ruler: ${LENGTHS.length} lengths x ${WIDTHS.length} widths, no labels meet`);
}
