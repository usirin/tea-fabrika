import type {Row} from "@kampus/fabrika";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {type Entry, type Fact, fold, readRow, Said, summaryOf, Title} from "./ticket.ts";

// A ticket from its rows: what reads, what is broken, and what the fold makes of the facts.

const row = (over: Partial<Row> & {readonly fact?: Fact}): Row => {
	const {fact = {type: "filed", title: "Login fails", body: ""}, ...rest} = over;
	return {
		pos: 1,
		stream: "tracker/ticket/1/inbox",
		rev: 1,
		writer: "user:owner",
		kind: fact.type,
		at: 1000,
		data: JSON.stringify(fact),
		id: "m1",
		...rest,
	};
};

const owner = {kind: "user", id: "owner"} as const;
const entry = (pos: number, ticket: number, fact: Fact): Entry => ({
	pos,
	ticket,
	by: owner,
	at: pos * 1000,
	fact,
});

describe("a row", () => {
	it("in a ticket's inbox is a fact on that ticket, with who wrote it and when", () => {
		expect(readRow(row({stream: "tracker/ticket/12/inbox", writer: "agent:review"}))).toEqual({
			kind: "entry",
			entry: {
				pos: 1,
				ticket: 12,
				by: {kind: "agent", id: "review"},
				at: 1000,
				fact: {type: "filed", title: "Login fails", body: ""},
			},
		});
	});

	it("anywhere else is no ticket's fact: the name's registration, another program's stream", () => {
		expect(readRow(row({stream: "tracker/ticket/1", kind: "registered"}))).toEqual({
			kind: "other",
		});
		expect(readRow(row({stream: "tracker/ticket/0/inbox"}))).toEqual({kind: "other"});
		expect(readRow(row({stream: "pipeline/asks/inbox"}))).toEqual({kind: "other"});
	});

	const cases: readonly (readonly [string, Parameters<typeof row>[0], RegExp])[] = [
		["a writer that is neither a user nor an agent", {writer: "ledger"}, /neither a user/],
		["data that is no fact", {data: '{"type":"edited"}'}, /not a fact/],
		["data that is not JSON", {data: "filed"}, /not a fact/],
		["a fact kept under another kind", {kind: "closed"}, /a filed fact kept as closed/],
		["a blank title", {fact: {type: "filed", title: " ", body: ""}}, /not a fact/],
	];
	it.each(cases)("is broken with %s, and says where", (_, over, why) => {
		const read = readRow(row(over));
		expect(read.kind).toBe("broken");
		expect(read.kind === "broken" && read.why).toMatch(/^row 1 on #1: /);
		expect(read.kind === "broken" && read.why).toMatch(why);
	});
});

describe("the fold", () => {
	it("makes a ticket from its facts, oldest first, with closed and reopened as its state", () => {
		const entries = [
			entry(1, 1, {type: "filed", title: "Login fails", body: "On main."}),
			entry(2, 2, {type: "filed", title: "Docs typo", body: ""}),
			entry(3, 1, {type: "commented", body: "Seen it too."}),
			entry(4, 1, {type: "closed"}),
		];
		const {tickets, problems} = fold([], entries);
		expect(problems).toEqual([]);
		expect(tickets.map((t) => [t.number, t.title, t.state, t.timeline.length])).toEqual([
			[1, "Login fails", "closed", 3],
			[2, "Docs typo", "open", 1],
		]);
		const reopened = fold(tickets, [entry(5, 1, {type: "reopened"})]).tickets[0];
		expect(reopened?.state).toBe("open");
		expect(reopened?.timeline.map((e) => e.fact.type)).toEqual([
			"filed",
			"commented",
			"closed",
			"reopened",
		]);
	});

	it("keeps a fact that does not fit out of every ticket, and says why", () => {
		const {tickets, problems} = fold(
			[],
			[
				entry(1, 3, {type: "commented", body: "Early."}),
				entry(2, 3, {type: "filed", title: "Late", body: ""}),
				entry(3, 3, {type: "filed", title: "Again", body: ""}),
			],
		);
		expect(tickets.map((t) => [t.number, t.title, t.timeline.length])).toEqual([[3, "Late", 1]]);
		expect(problems).toEqual([
			"row 1 on #3: commented, but the ticket was never filed",
			"row 3 on #3: filed a second time",
		]);
	});

	it("sums a ticket up for the list: its comments, and when it last moved", () => {
		const [ticket] = fold(
			[],
			[
				entry(1, 1, {type: "filed", title: "Login fails", body: ""}),
				entry(2, 1, {type: "commented", body: "One."}),
				entry(3, 1, {type: "closed"}),
				entry(4, 1, {type: "commented", body: "Two."}),
			],
		).tickets;
		expect(ticket && summaryOf(ticket)).toEqual({
			number: 1,
			title: "Login fails",
			state: "closed",
			comments: 2,
			at: 4000,
		});
	});
});

describe("what a person may write", () => {
	it("is a title on one trimmed line, and a comment with something in it", () => {
		const isTitle = Schema.is(Title);
		const isSaid = Schema.is(Said);
		expect(["Login fails", "", " x", "a\nb", "x".repeat(257)].map((t) => isTitle(t))).toEqual([
			true,
			false,
			false,
			false,
			false,
		]);
		expect([isSaid("ok"), isSaid("  \n "), isSaid("")]).toEqual([true, false, false]);
	});
});
