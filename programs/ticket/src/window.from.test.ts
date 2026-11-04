import {
	type Entry,
	type Fact,
	type FactOf,
	fold,
	type Ticket,
} from "@kampus/pipeline/tickets/ticket";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {pageOf, type Shown} from "./view.ts";
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
	if (ticket === undefined) throw new Error("the fold made no ticket");
	return ticket;
};

const filed = (from?: FactOf<"filed">["from"]): Fact => ({
	type: "filed",
	title: "Mutation runner: sandbox links node_modules",
	body: "",
	...(from === undefined ? {} : {from}),
});

/** The window's markup for one ticket, opened. */
const markupOf = (ticket: Ticket): string => {
	const view: Shown = {
		ready: true,
		number: ticket.number,
		page: pageOf(ticket, NOW, [ticket]),
		saving: [],
		failed: null,
		unreachable: null,
		now: NOW,
	};
	return renderToStaticMarkup(createElement(TicketWindow, {view, send: () => {}}));
};

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
});
