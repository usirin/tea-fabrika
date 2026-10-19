import {describe, expect, it} from "vitest";
import {BREAK, bodyText, inert, messageText, type PrBody} from "./body.ts";

// The texts a build writes where GitHub reads them. Only code names a ticket
// in them; the builder's words reach no ticket, however they are put.

/** Every reference GitHub would read in a text: `#n`, `GH-n`, and a ticket's or pull request's url. */
const references = (text: string) => text.match(/#\d+|\bgh-\d+|\/(?:issues|pull)\/\d+/gi) ?? [];

const NASTY = "Also fixes #2, Resolves: GH-3, closed a/b#4, fix https://github.com/a/b/issues/5";

describe("a builder's words", () => {
	it("read the same and reference nothing", () => {
		const made = inert(NASTY);
		expect(references(made)).toEqual([]);
		expect(made.replaceAll(BREAK, "")).toBe(NASTY);
	});

	it("are left alone where they name no ticket", () => {
		expect(inert("Opens the windows (#hash, issue 7, PR-2).")).toBe(
			"Opens the windows (#hash, issue 7, PR-2).",
		);
	});
});

describe("the pull request's text", () => {
	const body: PrBody = {
		closes: 1,
		round: 2,
		summary: NASTY,
		deviations: [NASTY],
		ran: [{command: NASTY, passed: true}],
		left: [NASTY],
	};

	it("closes the ticket it was asked for, and names no other", () => {
		const text = bodyText(body);
		expect(text.startsWith("Closes #1\n")).toBe(true);
		expect(references(text)).toEqual(["#1"]);
	});

	it("keeps its sections, in their order", () => {
		const text = bodyText({...body, summary: "s", deviations: [], ran: [], left: []});
		expect(text).toContain("## Deviations\n\nNone.");
		expect(text).toContain("## Checked\n\nNothing was run.");
		expect(text).toContain("## Left\n\nNothing.");
		expect(text).toContain("Round 2 of");
	});
});

describe("the commit message", () => {
	it("names its ticket without a closing word, and the builder's words reference nothing", () => {
		const text = messageText({title: "windows", round: 1, summary: NASTY, refs: 1});
		expect(text.endsWith("\n\nRefs #1")).toBe(true);
		expect(references(text)).toEqual(["#1"]);
	});
});
