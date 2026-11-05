import {shownOf} from "@tea-fabrika/ticket";
import {trackerAtSeven} from "@tea-fabrika/tracker/seven";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {WINDOWS} from "./windows.tsx";

// 185b PR 3b, call C (today's version): the page hands each window the inputs its run takes, as
// the host said them with the view (messages.ts, `ToWindow.takes`), and the way to open a ticket
// in the person's own tile. A view from a host before 3b says no `takes`: every control draws.
//
//   draw(data, send)                                          a person's tile, as today
//   draw(data, send, {takes: ["comment", ...], mine})         an agent's: no answer, one line
//
// Made up here, for the builder: `draw`'s third argument, `{takes, mine}`, where `mine(n)` opens
// ticket n in a tile of the person's.

/** Ticket 7 open, with its one ask, "approve plan v1". */
const DATA = shownOf(trackerAtSeven());

/** The ticket's inputs in an agent's tsh: every one but `answer`. */
const AGENTS = ["comment", "close", "reopen", "quit", "ticket"];

const ticketWindow = () => {
	const known = WINDOWS.get("ticket");
	if (known === undefined) throw new Error("the app has no ticket window");
	return known;
};

const markupOf = (node: ReturnType<ReturnType<typeof ticketWindow>["draw"]>) =>
	renderToStaticMarkup(node).replace(/<!-- -->/g, "");

describe("a window drawn by the app, with the inputs its run takes", () => {
	it("draws every control when the host said no takes, as from a host before 3b", () => {
		const html = markupOf(ticketWindow().draw(DATA, () => {}));
		expect(html).toContain("Approve plan v1");
		expect(html).not.toContain("Only you can answer this");
	});

	it("draws no answer, and the line, when the run takes no answer", () => {
		const html = markupOf(ticketWindow().draw(DATA, () => {}, {takes: AGENTS, mine: () => {}}));
		expect(html).not.toContain("Approve plan v1");
		expect(html).toContain("Only you can answer this. Open #7 in your own tile.");
	});

	it("draws every control when the run takes answer too", () => {
		const html = markupOf(
			ticketWindow().draw(DATA, () => {}, {takes: [...AGENTS, "answer"], mine: () => {}}),
		);
		expect(html).toContain("Approve plan v1");
		expect(html).not.toContain("Only you can answer this");
	});
});
