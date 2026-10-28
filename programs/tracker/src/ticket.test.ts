import {type Entry, type Fact, fold} from "@kampus/pipeline/tickets/ticket";
import {hashOf} from "@kampus/pipeline/tickets/yes";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {factOf, summaryOf} from "./ticket.ts";

// What a person's write puts on the ledger, and a ticket as the list sums it up.

const owner = {kind: "user", id: "owner"} as const;
const entry = (pos: number, fact: Fact): Entry => ({
	pos,
	ticket: 1,
	by: owner,
	at: pos * 1000,
	fact,
});

describe("a write", () => {
	it("is a comment, or one that asks for changes: the button says which", async () => {
		const plain = await Effect.runPromise(factOf({kind: "comment", ticket: 1, body: "Seen it."}));
		const changes = await Effect.runPromise(
			factOf({kind: "comment", ticket: 1, body: "Skip part 2.", asks: "changes"}),
		);
		expect([plain, changes]).toEqual([
			{type: "commented", body: "Seen it."},
			{type: "commented", body: "Skip part 2.", asks: "changes"},
		]);
	});

	it("answers with the hash of the text the person saw", async () => {
		const saw = {title: "Login fails", body: "On main."};
		const [fact, hash] = await Effect.runPromise(
			Effect.all(
				[
					factOf({kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "", saw}),
					hashOf(saw),
				],
				{concurrency: "unbounded"},
			),
		);
		expect(fact).toEqual({type: "answered", ask: "a-1", pick: "approve", note: "", text: hash});
	});
});

describe("the list", () => {
	it("sums a ticket up: its comments, and when it last moved", () => {
		const [ticket] = fold(
			[],
			[
				entry(1, {type: "filed", title: "Login fails", body: ""}),
				entry(2, {type: "commented", body: "One."}),
				entry(3, {type: "closed"}),
				entry(4, {type: "commented", body: "Two."}),
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
