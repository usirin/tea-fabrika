import {replay} from "@demlik/tea";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {tracker} from "./index.ts";
import {load, shownOf, tracker as machine} from "./machine.ts";
import {LANE, SEVEN, SEVEN_NOW, trackerAtSeven} from "./seven.ts";
import {OnlyYou, TrackerWindow} from "./window.tsx";

// 185b PR 3b, call C and d18 (today's version): in an agent's tile, the tracker's window draws
// no control for an input its run does not take. An agent's tsh drops the person-only inputs:
// answer, rate_duplicate, make_area, rename_area, merge_area and skip_onboarding.
//
//   an open ask         the ask's words stay; no note box, no pick button, and in their place
//                       "Only you can answer this. Open #7 in your own tile."
//   a duplicate hint    the link to #4 stays; no Accept, no Dismiss
//   the first areas     not drawn: every control in it is the person's, and it is about no
//                       ticket a link could open
//   a person's tile     all of it, as today, and no line
//
// Made up here, for the builder: `takes` and `mine` on the window's props (WindowProps), where
// `mine(n)` opens ticket n in a tile of the person's, and `OnlyYou`, the line, exported from this
// window. Drawn on Node with no browser.

/** Every input the tracker takes: what a person's tsh gives its run. */
const ALL: ReadonlySet<string> = new Set(Object.keys(tracker.inputs));

/** What an agent's tsh gives its run: every input but the person-only ones. */
const AGENTS: ReadonlySet<string> = new Set(
	Object.entries(tracker.inputs)
		.filter(([, declared]) => declared.personOnly !== true)
		.map(([name]) => name),
);

type Shown = ReturnType<typeof shownOf>;

/** The markup, with the marks React puts between two pieces of text taken out. */
const drawn = (view: Shown, takes?: ReadonlySet<string>): string =>
	renderToStaticMarkup(
		createElement(TrackerWindow, {
			view,
			send: () => {},
			...(takes === undefined ? {} : {takes, mine: () => {}}),
		}),
	).replace(/<!-- -->/g, "");

/** The words on each button in the markup, in order. */
const buttonsIn = (html: string): readonly string[] =>
	[...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
		(m[1] ?? "").replace(/<[^>]+>/g, ""),
	);

const LINE = "Only you can answer this. Open #7 in your own tile.";

/** Ticket 7 open, with its ask "approve plan v1", picks approve and no. */
const ASKED = shownOf(trackerAtSeven());

/** Ticket 7 open, with a duplicate hint: maybe the same as #4. */
const HINTED = shownOf(
	trackerAtSeven([
		...SEVEN,
		{pos: 8, ticket: 7, by: LANE, at: SEVEN_NOW, fact: {type: "maybe_duplicate", of: 4, yes: 0.83}},
	] satisfies readonly Entry[]),
);

/** The list page, with no area on the ledger yet: the first areas' step shows. */
const FIRST = shownOf(
	replay(machine, {
		ctx: undefined,
		msgs: [
			load.ok(load({after: 0}), {entries: SEVEN, broken: [], last: 7, areas: []}),
			{type: "tick", now: SEVEN_NOW},
		],
	}).state,
);

describe("the tracker's views these tests draw", () => {
	it("are the ticket page with its ask, with its hint, and the list with the first areas", () => {
		expect(ASKED.page.kind).toBe("ticket");
		expect(HINTED.page.kind === "ticket" && HINTED.page.opened?.duplicates.length).toBe(1);
		expect(FIRST.page.kind === "list" && FIRST.page.onboarding !== null).toBe(true);
	});

	it("are sure the agent's run lacks only the person-only inputs", () => {
		expect([...ALL].filter((name) => !AGENTS.has(name)).sort()).toEqual(
			[
				"answer",
				"make_area",
				"merge_area",
				"rate_duplicate",
				"rename_area",
				"skip_onboarding",
			].sort(),
		);
	});
});

describe("an open ask, by the inputs the run takes (call C, d18)", () => {
	it("draws the note box and a button per pick in a person's tile, and no line", () => {
		for (const html of [drawn(ASKED), drawn(ASKED, ALL)]) {
			expect(html).toContain('aria-label="note with the answer"');
			expect(buttonsIn(html)).toEqual(expect.arrayContaining(["approve", "no"]));
			expect(html).not.toContain("Only you can answer this");
		}
	});

	it("draws no note box and no pick button in an agent's tile, and the line in their place", () => {
		const html = drawn(ASKED, AGENTS);
		expect(html).not.toContain('aria-label="note with the answer"');
		expect(buttonsIn(html)).not.toContain("approve");
		expect(buttonsIn(html)).not.toContain("no");
		expect(html).toContain(LINE);
		// The ask's own words stay: the agent reads what waits on the person.
		expect(html).toContain('aria-label="ask: approve plan v1"');
	});

	it("keeps what the agent's run does take: comment, request changes, close", () => {
		const buttons = buttonsIn(drawn(ASKED, AGENTS));
		expect(buttons).toEqual(
			expect.arrayContaining(["Comment", "Request changes", "Close ticket", "← Tickets"]),
		);
	});
});

describe("a duplicate hint, by the inputs the run takes", () => {
	it("draws Accept and Dismiss in a person's tile", () => {
		expect(buttonsIn(drawn(HINTED, ALL))).toEqual(expect.arrayContaining(["Accept", "Dismiss"]));
	});

	it("draws neither in an agent's tile, and keeps the link to the other ticket", () => {
		const html = drawn(HINTED, AGENTS);
		expect(buttonsIn(html)).not.toContain("Accept");
		expect(buttonsIn(html)).not.toContain("Dismiss");
		expect(html).toContain('aria-label="maybe the same as #4"');
		expect(buttonsIn(html).some((words) => words.startsWith("#4"))).toBe(true);
	});
});

describe("the first areas, by the inputs the run takes", () => {
	it("shows in a person's tile", () => {
		expect(drawn(FIRST, ALL)).toContain("Pick your first areas");
	});

	it("does not show in an agent's tile, and the list does", () => {
		const html = drawn(FIRST, AGENTS);
		expect(html).not.toContain("Pick your first areas");
		expect(html).not.toContain("Make areas");
		expect(html).toContain('aria-label="tickets"');
	});
});

/**
 * The props of each element of `type` that `top` draws, found by walking what each component in
 * between returns. Run inside one render, so the hooks of the components walked have a place.
 */
const foundIn = (top: ReactNode, type: unknown): readonly Record<string, unknown>[] => {
	const found: Record<string, unknown>[] = [];
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const kid of node) walk(kid);
			return;
		}
		if (!isValidElement(node)) return;
		const given = node.props;
		if (typeof given !== "object" || given === null) return;
		if (node.type === type) {
			found.push({...given});
			return;
		}
		if (typeof node.type === "function") {
			walk((node.type as (p: unknown) => ReactNode)(given));
			return;
		}
		if ("children" in given) walk(given.children);
	};
	function Read(): ReactNode {
		walk(top);
		return null;
	}
	renderToStaticMarkup(createElement(Read));
	return found;
};

describe("the line in the tracker's window", () => {
	it("is OnlyYou, for the ask's ticket, handed the window's mine", () => {
		const mine = () => {};
		const lines = foundIn(
			createElement(TrackerWindow, {view: ASKED, send: () => {}, takes: AGENTS, mine}),
			OnlyYou,
		);
		expect(lines).toEqual([{ticket: 7, mine}]);
	});
});
