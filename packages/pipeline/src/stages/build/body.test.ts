import * as fc from "fast-check";
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

/** Every mention GitHub would notify from a text: an `@` with no word right before it, then a name. */
const mentions = (text: string) => text.match(/(?<!\w)@[a-z0-9][\w/-]*/gi) ?? [];

describe("an agent's words, for any text", () => {
	const PIECES = [
		"@name",
		"@org/team",
		"first.last@example.com",
		"#2",
		"a/b#4",
		"GH-3",
		"fixes ",
		"https://github.com/a/b/issues/5",
		"https://github.com/a/b/pull/6",
		"plain words",
		" ",
		"\n",
		"(",
		")",
		",",
		"`",
		"**",
		"> ",
	];
	const texts = fc.array(fc.constantFrom(...PIECES), {maxLength: 12}).map((p) => p.join(""));
	const RUNS = {numRuns: 500, seed: 7};

	it("ping nobody and reference nothing", () => {
		fc.assert(
			fc.property(texts, (text) => {
				const made = inert(text);
				expect(mentions(made)).toEqual([]);
				expect(references(made)).toEqual([]);
			}),
			RUNS,
		);
	});

	it("read the same to a person", () => {
		fc.assert(
			fc.property(texts, (text) => {
				expect(inert(text).replaceAll(BREAK, "")).toBe(text);
			}),
			RUNS,
		);
	});

	it("are the same made inert twice, as a text that passes two steps is", () => {
		fc.assert(
			fc.property(texts, (text) => {
				expect(inert(inert(text))).toBe(inert(text));
			}),
			RUNS,
		);
	});

	it.each([
		["a name alone", "@name"],
		["a team", "@org/team"],
		["a name in a sentence", "Thanks @name, this one is yours."],
		["a name in brackets", "(@name)"],
		["a name on a line of its own", "first line\n@name\nlast line"],
		["a name in bold", "**@name**"],
	])("%s pings nobody", (_name, text) => {
		expect(mentions(text)).not.toEqual([]);
		expect(mentions(inert(text))).toEqual([]);
	});

	it.each(["first.last@example.com", "Write to a_b+tag@example.co.uk about it.", "x-y@a.io"])(
		"an email address stays as it is, so it can still be copied: %s",
		(text) => {
			expect(mentions(text)).toEqual([]);
			expect(inert(text)).toBe(text);
		},
	);
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
