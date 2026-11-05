import {trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {OnlyYou} from "@tea-fabrika/tracker/window";
import {createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {ticket} from "./index.ts";
import {shownOf} from "./view.ts";
import {TicketWindow} from "./window.tsx";

// 185b PR 3b, call C and d18 (today's version): in an agent's tile, the ticket's window draws no
// control for an input its run does not take. The agent's tsh drops the person-only `answer`, so
// its window shows the ask, with no pick buttons, and one line in their place:
//
//   takes: every input             the ask's buttons, "Approve plan v1" and "No", as today
//   takes: every input but answer  no button for a pick; "Only you can answer this. Open #7 in
//                                  your own tile.", a link that calls `mine(7)`
//
// Made up here, for the builder: `takes` and `mine` on the window's props (WindowProps), and
// `OnlyYou`, the line, from the tracker's window, so both windows draw the same words. Drawn on
// Node with no browser, as window.from.test.ts draws; the shots (d25) show how it looks.

/** Ticket 7 open, with its one ask, "approve plan v1", picks approve and no. */
const VIEW = shownOf(trackerAtSeven());

/** Every input the ticket program takes: what a person's tsh gives its run. */
const ALL: ReadonlySet<string> = new Set(Object.keys(ticket.inputs));

/** What an agent's tsh gives its run: every input but the person-only ones. */
const AGENTS: ReadonlySet<string> = new Set(
	Object.entries(ticket.inputs)
		.filter(([, declared]) => declared.personOnly !== true)
		.map(([name]) => name),
);

/** The markup, with the marks React puts between two pieces of text taken out. */
const drawn = (props: {takes?: ReadonlySet<string>; mine?: (n: number) => void}): string =>
	renderToStaticMarkup(createElement(TicketWindow, {view: VIEW, send: () => {}, ...props})).replace(
		/<!-- -->/g,
		"",
	);

/** The words on each button in the markup, in order. */
const buttonsIn = (html: string): readonly string[] =>
	[...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
		(m[1] ?? "").replace(/<[^>]+>/g, ""),
	);

const LINE = "Only you can answer this. Open #7 in your own tile.";

describe("the ticket's window, by the inputs its run takes (call C)", () => {
	it("is sure the agent's run lacks answer, and only answer", () => {
		expect([...ALL].filter((name) => !AGENTS.has(name))).toEqual(["answer"]);
	});

	it("draws the ask's buttons in a person's tile, with or without takes, and no line", () => {
		for (const html of [drawn({}), drawn({takes: ALL, mine: () => {}})]) {
			expect(buttonsIn(html)).toEqual(expect.arrayContaining(["Approve plan v1", "No"]));
			expect(html).not.toContain("Only you can answer this");
		}
	});

	it("draws no pick button in an agent's tile, and the line in their place (d18)", () => {
		const html = drawn({takes: AGENTS, mine: () => {}});
		expect(buttonsIn(html)).not.toContain("Approve plan v1");
		expect(buttonsIn(html)).not.toContain("No");
		expect(html).toContain(LINE);
		// The ask itself still shows: the agent reads what waits on the person.
		expect(html).toContain("approve plan v1");
	});

	it("keeps the controls the agent's run does take: a comment and a request for changes", () => {
		const html = drawn({takes: AGENTS, mine: () => {}});
		expect(html).toContain("<textarea");
		expect(buttonsIn(html)).toContain("Request changes");
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

describe("the line's link", () => {
	it("opens the ticket in the person's own tile: a click calls mine with its number", () => {
		const asked: number[] = [];
		const line = foundIn(createElement(OnlyYou, {ticket: 7, mine: (n) => asked.push(n)}), "button");
		expect(line).toHaveLength(1);
		const click = line[0]?.["onClick"];
		if (typeof click !== "function") throw new Error("the link's button has no onClick");
		click();
		expect(asked).toEqual([7]);
	});

	it("is the line the ticket's window draws, handed the window's mine", () => {
		const mine = () => {};
		const lines = foundIn(
			createElement(TicketWindow, {view: VIEW, send: () => {}, takes: AGENTS, mine}),
			OnlyYou,
		);
		expect(lines).toEqual([{ticket: 7, mine}]);
	});
});
