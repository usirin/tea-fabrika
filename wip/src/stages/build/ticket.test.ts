import {describe, expect, it} from "vitest";
import {buildGate, openOf, READY, type Ticket, ticketOf} from "./ticket.ts";

describe("a ticket's url", () => {
	it("names its repository and number, for any repository", () => {
		expect(ticketOf("https://github.com/acme/widgets.js/issues/670")).toEqual({
			owner: "acme",
			name: "widgets.js",
			number: 670,
		});
		expect(ticketOf("https://github.com/acme/widgets/pull/670")).toBeNull();
	});
});

// The build gate: pure, so each case is one ticket.

const ticket: Ticket = {
	url: "https://github.com/kamp-us/tea-fabrika-sandbox/issues/1",
	number: 1,
	state: "open",
	title: "t",
	body: "b",
	labels: [READY],
	criteria: [{n: 1, text: "it works", checked: false, evidence: null}],
	prs: [],
};

describe("the build gate", () => {
	it("an open, ready ticket with criteria goes, and hands them on", () => {
		expect(buildGate(ticket)).toEqual({answer: "go", criteria: ticket.criteria});
	});

	it.each([
		["closed", {state: "closed" as const}, {kind: "skip", why: "closed"}],
		[
			"merged already",
			{prs: [{url: "u", state: "merged" as const, head: "h"}]},
			{kind: "skip", why: "merged"},
		],
		["not labelled ready", {labels: ["type:bug"]}, {kind: "skip", why: "not_ready"}],
		["with no criteria", {criteria: []}, {kind: "stuck", why: "no_criteria"}],
	])("a ticket %s stops", (_, change, outcome) => {
		expect(buildGate({...ticket, ...change})).toEqual({answer: "stop", outcome});
	});

	it("the open pull request from the branch is found; a closed one is not", () => {
		const open = {url: "u2", state: "open" as const, head: "h2"};
		expect(openOf({...ticket, prs: [{url: "u1", state: "closed", head: "h1"}, open]})).toEqual(
			open,
		);
		expect(openOf({...ticket, prs: [{url: "u1", state: "closed", head: "h1"}]})).toBeNull();
	});
});
