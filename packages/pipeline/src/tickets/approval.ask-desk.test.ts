import {readFileSync} from "node:fs";
import type {Writer} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {covers, hashOf, textOf} from "./approval.ts";
import {sealAsk} from "./ask.ts";
import {type Entry, Fact, type FactOf, type Ticket} from "./ticket.ts";

// Today's version. What an answer approves (P4): an old title-and-body hash never approves a
// planned ticket or a change, and a sealed answer the ask refuses covers nothing.
const {DRAFT, FILED, HEAD, TOOK} = JSON.parse(
	readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);
const OWNER: Writer = {kind: "user", id: "owner"};
const LANE: Writer = {kind: "agent", id: "lane", for: "owner"};

const ticketOf = (facts: readonly (readonly [Writer, unknown])[]): Ticket => ({
	number: 117,
	title: FILED.title,
	state: "open",
	timeline: facts.map(([by, fact], i): Entry => ({
		pos: i + 1,
		ticket: 117,
		by,
		at: i,
		fact: Schema.decodeUnknownSync(Fact)(fact),
	})),
});
const answered = (fact: unknown): FactOf<"answered"> => {
	const read = Schema.decodeUnknownSync(Fact)(fact);
	if (read.type !== "answered") throw new Error("not an answer");
	return read;
};
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("ask desk P4: an old text hash approves only a plain ticket", () => {
	const legacy = {type: "asked", ask: "a-approve-2", what: "Approve?", picks: ["approve", "no"]};
	const old = async (more: Record<string, unknown> = {}) =>
		answered({
			type: "answered",
			ask: "a-approve-2",
			pick: "approve",
			note: "",
			text: await run(hashOf({title: FILED.title, body: FILED.body})),
			...more,
		});

	it("approves when the title and body read the same and nothing was planned", async () => {
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, legacy],
		]);
		expect(await run(hashOf(textOf(ticket)))).toBe(await run(hashOf(FILED)));
		expect(await run(covers(await old(), ticket))).toBe(true);
	});
	it("does not approve once the ticket has a planned fact", async () => {
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, {type: "planned", version: 1, tasks: []}],
			[LANE, legacy],
		]);
		expect(await run(covers(await old(), ticket))).toBe(false);
	});
	it("does not approve an answer that names a head", async () => {
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, legacy],
		]);
		expect(await run(covers(await old({head: HEAD}), ticket))).toBe(false);
	});
});

describe("ask desk P4: a sealed answer the ask refuses covers nothing", () => {
	const seeded = async () => {
		const ask = await run(sealAsk(DRAFT));
		const answer = (value: unknown) =>
			answered({
				type: "answered",
				format: 1,
				ask: ask.ask,
				answer: value,
				saw: ask.saw,
				via: {_tag: "window", took: TOOK},
			});
		return {ask, answer};
	};
	it("covers with the shown hash and an offered pick", async () => {
		const {ask, answer} = await seeded();
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, {type: "planned", version: 2, tasks: []}],
			[LANE, ask],
		]);
		expect(await run(covers(answer({_tag: "rec"}), ticket))).toBe(true);
	});
	it("does not cover a pick the ask never offered, though the hash matches", async () => {
		const {ask, answer} = await seeded();
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, {type: "planned", version: 2, tasks: []}],
			[LANE, ask],
		]);
		expect(
			await run(covers(answer({_tag: "against", pick: "merge", note: "Wrong pick"}), ticket)),
		).toBe(false);
	});
	it("does not cover once the plan moved on, though the hash matches", async () => {
		const {ask, answer} = await seeded();
		const ticket = ticketOf([
			[OWNER, FILED],
			[LANE, {type: "planned", version: 2, tasks: []}],
			[LANE, ask],
			[LANE, {type: "planned", version: 3, tasks: []}],
		]);
		expect(await run(covers(answer({_tag: "rec"}), ticket))).toBe(false);
	});
});
