import {
	type Entry,
	type Fact,
	type FactOf,
	fold,
	type Ticket,
} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {pageOf, runTicketOf, Shown} from "./view.ts";
import {TicketWindow} from "./window.tsx";

// Ticket 196: the ticket's window says where a ticket came from (plan 196, "Traced: ticket 188").
// Drawn on Node with no browser, as programs/trace's window tests are. Today's version. The PR
// numbers and the run id are the real ones of tickets 188, 191 and 193; the comment anchor is made
// up. What the row looks like is the shots' job; this reads the From row's markup only.

const REPO = "https://github.com/usirin/tea-fabrika";
const NOW = Date.UTC(2026, 10, 3, 12, 0);
const review = {kind: "agent", id: "review", for: "owner"} as const;

/** A ticket filed by an agent, with `filed` as its one fact. */
const filedAs = (number: number, fact: Fact): Ticket => {
	const entry: Entry = {pos: 1, ticket: number, by: review, at: NOW - 60_000, fact};
	const [ticket] = fold([], [entry]).tickets;

	if (ticket === undefined) {
		throw new Error("the fold made no ticket");
	}

	return ticket;
};

const filed = (from?: FactOf<"filed">["from"]): Fact => ({
	type: "filed",
	title: "Mutation runner: sandbox links node_modules",
	body: "",
	...(from === undefined ? {} : {from}),
});

/** What the window is shown for one ticket, opened. */
const viewOf = (ticket: Ticket): Shown => ({
	ready: true,
	number: ticket.number,
	page: pageOf(ticket, NOW, [ticket]),
	saving: [],
	failed: null,
	unreachable: null,
	now: NOW,
});

/** The window's markup for `view`. */
const drawn = (view: Shown): string =>
	renderToStaticMarkup(createElement(TicketWindow, {view, send: () => {}}));

/** The window's markup for one ticket, opened. */
const markupOf = (ticket: Ticket): string => drawn(viewOf(ticket));

/**
 * What each From row holds, in markup: one in the inline properties, one in the side column. The
 * marks React puts between two pieces of text (`<!-- -->`) are taken out first.
 */
const fromRows = (markup: string): readonly string[] =>
	[...markup.replaceAll("<!-- -->", "").matchAll(/<dt>From<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)].map(
		(m) => m[1] ?? "",
	);

/** Markup with its tags taken out and its spaces made one. */
const textOf = (markup: string): string =>
	markup
		.replaceAll(/<[^>]*>/g, " ")
		.replaceAll(/\s+/g, " ")
		.trim();

describe("a ticket's page says where it came from", () => {
	// p1
	it("is null for a ticket filed with no `from`", () => {
		expect(pageOf(filedAs(7, filed()), NOW).from).toBeNull();
	});

	// p5
	it("a pull request's step reads `PR 352 · mutation`, linked to the pull request", () => {
		const url = `${REPO}/pull/352`;
		const ticket = filedAs(188, filed({_tag: "pr", url, step: "mutation"}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({text: "PR 352 · mutation", url});
		const rows = fromRows(markupOf(ticket));
		expect(rows).toHaveLength(2);

		for (const row of rows) {
			expect(row).toMatch(/^<a [^>]*>[^<]*<\/a>$/);
			expect(row).toContain(`href="${url}"`);
			expect(row).toContain(`target="_blank"`);
			expect(row).toContain(`rel="noreferrer"`);
			expect(textOf(row)).toBe("PR 352 · mutation");
		}
	});

	// p5
	it("a review comment reads by its pull request's number, linked to the comment itself", () => {
		const url = `${REPO}/pull/357#discussion_r1001`;
		const ticket = filedAs(186, filed({_tag: "pr", url, step: "review"}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({text: "PR 357 · review", url});

		for (const row of fromRows(markupOf(ticket))) {
			expect(row).toContain(`href="${url}"`);
			expect(textOf(row)).toBe("PR 357 · review");
		}
	});

	// p5
	it("a walk is a link to what was walked", () => {
		const url = `${REPO}/pull/332`;
		const ticket = filedAs(191, filed({_tag: "walk", url}));
		expect(pageOf(ticket, NOW).from?.url).toBe(url);
		const rows = fromRows(markupOf(ticket));
		expect(rows).toHaveLength(2);

		for (const row of rows) {
			expect(row).toMatch(/^<a [^>]*>[^<]*<\/a>$/);
			expect(row).toContain(`href="${url}"`);
		}
	});

	// p5
	it("a walk of a pull request reads `walk of PR 332`", () => {
		const url = `${REPO}/pull/332`;
		const ticket = filedAs(191, filed({_tag: "walk", url}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({text: "walk of PR 332", url});

		for (const row of fromRows(markupOf(ticket))) {
			expect(textOf(row)).toBe("walk of PR 332");
		}
	});

	// p5. A walk of a note or an experiment has no pull request in its address: it reads by the
	// address, without its `https://`. The address is made up.
	it("a walk of an address that is no pull request reads by the address, still linked", () => {
		const url = "https://example.com/notes/flaky-lane-writes";
		const ticket = filedAs(195, filed({_tag: "walk", url}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({
			text: "walk of example.com/notes/flaky-lane-writes",
			url,
		});
		const rows = fromRows(markupOf(ticket));
		expect(rows).toHaveLength(2);

		for (const row of rows) {
			expect(row).toContain(`href="${url}"`);
			expect(textOf(row)).toBe("walk of example.com/notes/flaky-lane-writes");
		}
	});

	// p5
	it("a pull request with no step reads `PR 352`, with nothing after it", () => {
		const url = `${REPO}/pull/352`;
		const ticket = filedAs(188, filed({_tag: "pr", url}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({text: "PR 352", url});

		for (const row of fromRows(markupOf(ticket))) {
			expect(textOf(row)).toBe("PR 352");
		}
	});

	// p6
	it("a lane run reads `#117 · r-test_writer-26`, with the line that opens ticket 117", () => {
		const ticket = filedAs(193, filed({_tag: "run", ticket: 117, run: "r-test_writer-26"}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({text: "#117 · r-test_writer-26", url: null});
		const rows = fromRows(markupOf(ticket));
		expect(rows).toHaveLength(2);

		for (const row of rows) {
			// No link: the run is on this ledger, not at an address.
			expect(row).not.toContain("<a ");
			expect(textOf(row)).toContain("#117 · r-test_writer-26");
			expect(row).toMatch(/<code class="cmd">ticket 117<\/code>/);
		}
	});

	// p6. Ticket 194's run, at its head; the sha's last 32 characters are made up.
	it("a lane run at a head reads the head's first 8 characters after the run", () => {
		const head = "b5b969a0c3d4e5f60718293a4b5c6d7e8f901234";
		const ticket = filedAs(194, filed({_tag: "run", ticket: 117, run: "r-test_writer-25", head}));
		expect(pageOf(ticket, NOW).from).toStrictEqual({
			text: "#117 · r-test_writer-25 · b5b969a0",
			url: null,
		});

		for (const row of fromRows(markupOf(ticket))) {
			expect(textOf(row)).toContain("#117 · r-test_writer-25 · b5b969a0");
		}
	});

	// p1. Every ticket filed before the key has no `from`: its window draws, with no From row.
	it("the window of a ticket filed with no `from` draws, with no From row", () => {
		const markup = markupOf(filedAs(7, filed()));
		expect(markup).toContain("Mutation runner: sandbox links node_modules");
		expect(fromRows(markup)).toEqual([]);
	});

	// The window is sent its view through the program's view schema (index.ts, `view.data`), as
	// JSON over the app's socket, and the app reads it by that schema before it draws
	// (apps/fabrika/src/window/windows.tsx): the From row comes through whole, and a row the window
	// could not draw is refused there, never handed to it.
	it("comes through the view's schema whole, and the window draws it", () => {
		const url = `${REPO}/pull/352`;
		const ticket = filedAs(188, filed({_tag: "pr", url, step: "mutation"}));
		const sent = JSON.parse(JSON.stringify(viewOf(ticket)));
		const read = Schema.decodeUnknownSync(Shown)(sent);
		expect(read.page?.from).toStrictEqual({text: "PR 352 · mutation", url});
		const rows = fromRows(drawn(read));
		expect(rows).toHaveLength(2);

		for (const row of rows) {
			expect(textOf(row)).toBe("PR 352 · mutation");
		}

		const readWith = (from: unknown) => () =>
			Schema.decodeUnknownSync(Shown)({...sent, page: {...sent.page, from}});
		expect(readWith({url})).toThrow(/text/);
		expect(readWith({text: "PR 352 · mutation"})).toThrow(/url/);
		expect(readWith({text: 352, url})).toThrow(/text/);
	});
});

describe("the ticket a filing's run opens", () => {
	it("is the run's ticket, and none for a filing from a pull request, a walk or nothing", () => {
		const url = `${REPO}/pull/352`;
		expect(runTicketOf(filedAs(193, filed({_tag: "run", ticket: 117, run: "r-1"})))).toBe(117);
		expect(runTicketOf(filedAs(188, filed({_tag: "pr", url, step: "mutation"})))).toBeNull();
		expect(runTicketOf(filedAs(191, filed({_tag: "walk", url})))).toBeNull();
		expect(runTicketOf(filedAs(7, filed()))).toBeNull();
	});
});
