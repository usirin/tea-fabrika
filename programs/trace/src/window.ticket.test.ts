import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {type Model, type TraceMsg, trace} from "./machine.ts";
import {astra, LANE_1, LANE_2, T117, T117_MADE_UP} from "./t117.ts";
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
		for (const stage of ["sort", "plan", "exam", "build"]) expect(text).toContain(stage);
		for (const usd of STEP_PRICES)
			for (const w of writings(usd))
				expect(text).not.toMatch(new RegExp(`\\$\\s?${w.replace(".", "\\.")}(?!\\d)`));
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
