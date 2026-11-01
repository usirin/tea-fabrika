import type {Writer} from "@kampus/fabrika-old";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {changesRequested, covers, hashOf, textOf} from "./approval.ts";
import {type Entry, type Fact, fold, type Hash} from "./ticket.ts";

// What takes an approval back, as laws over any timeline: only a person's "Request changes" after
// the approval, never an agent's, never a plain comment. And what an approval covers: its text, to
// the character.

const owner: Writer = {kind: "user", id: "owner"};
const agent: Writer = {kind: "agent", id: "plan", for: "owner"};

const writer = fc.constantFrom<Writer>(owner, agent, {kind: "agent", id: "review"});
const fact = fc.oneof(
	fc.constant<Fact>({type: "commented", body: "Seen it."}),
	fc.constant<Fact>({type: "commented", body: "Skip part 2.", asks: "changes"}),
	fc.constant<Fact>({type: "closed"}),
	fc.constant<Fact>({type: "started", run: "r-1", stage: "build", task: null, log: null}),
);

/** A timeline of any facts by anyone, at places 1, 2, 3. */
const timeline = fc
	.array(fc.tuple(writer, fact), {maxLength: 12})
	.map((rows) => rows.map(([by, f], i): Entry => ({pos: i + 1, ticket: 1, by, at: i, fact: f})));

/** An agent's "Request changes", put in at `at` (between rows), with places after it moved on. */
const withAgentsAsk = (entries: readonly Entry[], at: number): readonly Entry[] => {
	const ask: Entry = {
		pos: 0,
		ticket: 1,
		by: agent,
		at: 0,
		fact: {type: "commented", body: "Rewrite it all.", asks: "changes"},
	};
	const all = [...entries.slice(0, at), ask, ...entries.slice(at)];
	return all.map((e, i) => ({...e, pos: i + 1}));
};

describe("changes requested", () => {
	it("an agent's request for changes stops nothing, wherever it lands", () => {
		fc.assert(
			fc.property(timeline, fc.nat(), fc.nat(), (entries, rawAt, rawSince) => {
				const at = rawAt % (entries.length + 1);
				const since = rawSince % (entries.length + 1);
				const before = changesRequested(entries, since);
				// The approval at `since` moves with the rows; the ask goes in after it or before it.
				const after = withAgentsAsk(entries, at);
				const movedSince = at < since ? since + 1 : since;
				expect(changesRequested(after, movedSince)).toBe(before);
			}),
		);
	});

	it("is a person's request for changes after the approval, and nothing else", () => {
		fc.assert(
			fc.property(timeline, fc.nat(), (entries, raw) => {
				const since = raw % (entries.length + 1);
				const expected = entries.some(
					(e) =>
						e.pos > since &&
						e.by.kind === "user" &&
						e.fact.type === "commented" &&
						e.fact.asks === "changes",
				);
				expect(changesRequested(entries, since)).toBe(expected);
			}),
		);
	});

	it("does not count a person's request from before the approval", () => {
		const asked: Entry = {
			pos: 2,
			ticket: 1,
			by: owner,
			at: 0,
			fact: {type: "commented", body: "Skip part 2.", asks: "changes"},
		};
		expect(changesRequested([asked], 2)).toBe(false);
		expect(changesRequested([asked], 1)).toBe(true);
	});
});

const ticketOf = (title: string, body: string) => {
	const [ticket] = fold(
		[],
		[{pos: 1, ticket: 1, by: owner, at: 0, fact: {type: "filed", title, body}}],
	).tickets;
	if (ticket === undefined) throw new Error("the ticket did not fold");
	return ticket;
};

const answer = (text?: Hash) => ({
	type: "answered" as const,
	ask: "a-1",
	pick: "approve",
	note: "",
	...(text === undefined ? {} : {text}),
});

const title = fc
	.string({minLength: 1, maxLength: 20})
	.filter((t) => /^\S(.*\S)?$/.test(t) && !/[\r\n]/.test(t));
const body = fc.string({maxLength: 40});

describe("an approval", () => {
	it("covers the text it saw, and no other", async () => {
		await fc.assert(
			fc.asyncProperty(title, body, title, body, async (t1, b1, t2, b2) => {
				const saw = ticketOf(t1, b1);
				const now = ticketOf(t2, b2);
				const approval = answer(await Effect.runPromise(hashOf(textOf(saw))));
				const same = t1 === t2 && b1 === b2;
				expect(await Effect.runPromise(covers(approval, now))).toBe(same);
			}),
			{numRuns: 50},
		);
	});

	it('keeps title and body apart: "ab" + "c" is not "a" + "bc"', async () => {
		const approval = answer(await Effect.runPromise(hashOf({title: "ab", body: "c"})));
		expect(await Effect.runPromise(covers(approval, ticketOf("ab", "c")))).toBe(true);
		expect(await Effect.runPromise(covers(approval, ticketOf("a", "bc")))).toBe(false);
	});

	it("from before the hash covers nothing, so it is asked again", async () => {
		expect(await Effect.runPromise(covers(answer(), ticketOf("Login fails", "")))).toBe(false);
	});
});
