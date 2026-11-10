import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {type Model, type TraceMsg, trace} from "./machine.ts";
import {astra, LANE_1, LANE_2, T117, T117_MADE_UP} from "./t117.ts";
import {stopsOf} from "./ticket.ts";
import {shownOf} from "./view.ts";
import {TraceWindow} from "./window.tsx";

// The ticket view's window, drawn on Node with no browser (ticket 141): the owner's decision 7 and
// L6's last line. Today's version. A step row shows tokens, never dollars. Dollars show only in a
// lane's line and the ticket's line, labeled "at list price", and a price nobody knows is never
// drawn as $0.00. What a row looks like is the shots' job (E2); this reads only the text.
//
// The text, not the rows: the plan names no row markup, so the check is on numbers no line can
// say. Every step's own price below differs from each lane's sum and the ticket's, so a dollar
// figure equal to one step's price is that step's row speaking.

const ctx = stubCtxThrowingProxy<undefined>();

/** The window's text for a state: its markup with the tags taken out. */
const textOf = (s: Model): {readonly markup: string; readonly text: string} => {
	const markup = renderToStaticMarkup(
		createElement(TraceWindow, {view: shownOf(s), send: () => {}}),
	);
	return {markup, text: markup.replaceAll(/<[^>]*>/g, " ").replaceAll(/\s+/g, " ")};
};

/** Ticket 117 shown with every lane open: the newest opens on its own, the two older by a toggle. */
const shown117 = ({timeline}: typeof T117 = T117): Model => {
	const msgs: TraceMsg[] = [
		{type: "ticket", number: 117},
		{type: "facts", number: 117, timeline},
		{type: "toggle", row: `lane:${LANE_1}`},
		{type: "toggle", row: `lane:${LANE_2}`},
	];
	return foldEvents(trace, ctx, null, msgs).finalState;
};

/** Each priced step's own dollars, in ticket 117's shape. */
const STEP_PRICES = [
	0.03,
	astra(100_000, 60_000, 5_000),
	astra(50_000, 20_000, 2_000),
	astra(80_000, 40_000, 8_000),
	0.04,
	astra(120_000, 100_000, 4_000),
	astra(40_000, 0, 1_000),
];

/** Every way a figure might be written: to two places, and as short as it goes. */
const writings = (usd: number): readonly string[] => [
	...new Set([usd.toFixed(2), String(Math.round(usd * 100) / 100), usd.toFixed(3)]),
];

describe("the ticket view's window: dollars only in the summaries (decision 7)", () => {
	it("shows every lane open, and no step row's price in dollars", () => {
		const {text} = textOf(shown117());

		// Every lane is drawn open: its steps' stages are on the page.
		for (const stage of ["sort", "plan", "exam", "build"]) {
			expect(text).toContain(stage);
		}

		for (const usd of STEP_PRICES) {
			for (const w of writings(usd)) {
				expect(text).not.toMatch(new RegExp(`\\$\\s?${w.replace(".", "\\.")}(?!\\d)`));
			}
		}
	});

	it("says dollars at most once per lane and once for the ticket, each labeled at list price", () => {
		const {markup, text} = textOf(shown117());
		const dollars = text.match(/\$/g)?.length ?? 0;
		expect(dollars).toBeGreaterThan(0);
		// Lane 3 runs code alone: no dollars on its line.
		expect(dollars).toBeLessThanOrEqual(3);
		expect(markup).toContain("at list price");
	});

	it("never draws a price nobody knows as $0.00", () => {
		const {text} = textOf(shown117(T117_MADE_UP));
		expect(text).not.toMatch(/\$\s?0\.00(?!\d)/);
		expect(text).not.toMatch(/\$\s?0(?![.\d])/);
	});
});

/** Ticket 117 shown, then these Msgs: before its facts are read. */
const at117 = (more: readonly TraceMsg[]): Model =>
	foldEvents(trace, ctx, null, [{type: "ticket", number: 117}, ...more]).finalState;

/** Ticket 117 with every lane open, then these Msgs. */
const open117 = (more: readonly TraceMsg[]): Model =>
	at117([
		{type: "facts", number: 117, timeline: T117.timeline},
		{type: "toggle", row: `lane:${LANE_1}`},
		{type: "toggle", row: `lane:${LANE_2}`},
		...more,
	]);

/** How many times `part` is in `markup`. */
const timesIn = (markup: string, part: string): number => markup.split(part).length - 1;

/** The "one fact back" button's tag. */
const backButton = (markup: string): string =>
	markup.match(/<button[^>]*aria-label="one fact back"[^>]*>/)?.[0] ?? "";

describe("the ticket view's window: its words and its marks", () => {
	it("says while its facts are read, and why they cannot be", () => {
		expect(textOf(at117([])).text).toContain("Reading the facts of ticket 117.");
		expect(textOf(at117([{type: "unread", number: 117, why: "gone"}])).text).toContain(
			"The facts of ticket 117 cannot be read: gone",
		);
	});

	it("labels a minute tick of a lane's ruler in minutes", () => {
		const {markup} = textOf(shown117());
		expect(markup).toContain(">5 min</span>");
		expect(markup).not.toContain("300 s");
	});

	it("says a step row's tokens short: 120k in", () => {
		expect(textOf(shown117()).text).toContain("120k in");
	});

	it("says a done step under a minute to a tenth of a second", () => {
		expect(textOf(shown117()).text).toContain("6.0 s · sent to build: checks red");
	});

	it("puts a short bar's words after it", () => {
		expect(textOf(shown117()).markup).toContain('class="tv-words after"');
	});

	it("draws one gap row, for lane 2's restart, and names it in lane 2's label", () => {
		const {markup} = textOf(shown117());
		expect(timesIn(markup, 'class="tv-gap"')).toBe(1);
		expect(markup).toContain(
			'aria-label="lane 2, sent to build: checks red, 18 h 30 min later, restarted from plan"',
		);
		expect(markup).toContain('aria-label="lane 1, stuck: tests red"');
	});

	it("draws an open lane's caret pointing down", () => {
		expect(timesIn(textOf(shown117()).markup, "▾")).toBe(3);
	});

	it("lets one row alone take the focus, and marks the chosen row alone", () => {
		const s = open117([{type: "choose", row: "run:r-plan-2"}]);
		const {markup} = textOf(s);
		expect(timesIn(markup, 'tabindex="0"')).toBe(1);
		expect(timesIn(markup, " sel")).toBe(1);
		expect(markup).toMatch(/class="wf-row tv-step sel" data-row="run:r-plan-2"/);
	});

	it("shows a chosen step's exact tokens", () => {
		const s = open117([{type: "choose", row: "run:r-plan-2"}]);
		expect(textOf(s).text).toContain("100,000 in, of them 60,000 cached; 5,000 out");
	});

	it("disables one fact back at the first fact, and enables it at the third", () => {
		const stops = stopsOf(T117.timeline);
		const seek = (k: number) => open117([{type: "seek", at: stops[k] ?? 0}]);
		expect(backButton(textOf(seek(0)).markup)).toContain("disabled");
		expect(backButton(textOf(seek(2)).markup)).not.toContain("disabled");
	});
});
