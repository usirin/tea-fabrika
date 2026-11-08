import {applyCell} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika-old";
import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {Entry} from "@kampus/pipeline/tickets/ticket";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {
	AGENT,
	DRAFT,
	FILED,
	NOW,
	OWNER,
	policyFor,
	type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import {
	type Asks,
	asksMachine,
	asksNow,
	keysOf,
	load,
	marksOf,
	NO_MARKS,
	readMarks,
} from "./asks.ts";

// P10/P11/P20, restricted by the amendment to today's host queue and old asks menu.
// Inbox tile, new glance, opening and focus history belong to the later inbox exam.
const seal: (draft: unknown, policy?: {seed: number}) => Effect.Effect<Sealed, unknown> = sealAsk;
type Msg = MsgOf<typeof asksMachine>;
const step = (model: Asks, msg: Msg) =>
	applyCell<Asks, Msg, ReturnType<typeof load>>(asksMachine, model, msg)[0];
const entry = (pos: number, fact: unknown, at = NOW) =>
	Schema.decodeUnknownSync(Entry)({pos, ticket: 117, by: OWNER, at, fact});
const initial = (entries: readonly Entry[]) =>
	step(
		asksMachine.init(null, NO_MARKS)[0],
		load.ok(load({after: 0}), {entries, last: entries.length}, 0),
	);

describe("ask desk P10: one queue for today's menu and badge", () => {
	it("removes Later from the shared live count, preserves it on restart, and clears it on answer", async () => {
		const ask = await Effect.runPromise(seal(DRAFT, policyFor(DRAFT.ask, false, blindDraw)));
		const model = initial([entry(1, FILED), entry(2, ask)]);
		const key = `117/${ask.ask}`;
		expect([...keysOf(asksNow(model))]).toEqual([key]);
		const later = step(model, {type: "later", key});
		expect(asksNow(later).asks).toEqual([]);
		expect(asksNow(later).later.map((a) => a.key)).toEqual([key]);
		const kept = readMarks(JSON.stringify(marksOf(later)));
		expect(kept).toMatchObject({kind: "read", marks: {later: [key]}});
		const answered = entry(3, {
			type: "answered",
			format: 1,
			ask: ask.ask,
			answer: {_tag: "rec"},
			saw: ask.saw,
			via: {_tag: "chat", session: "s1"},
		});
		const after = step(later, load.ok(load({after: 0}), {entries: [answered], last: 3}, 0));
		expect(asksNow(after).asks).toEqual([]);
		expect(asksNow(after).later).toEqual([]);
		expect(marksOf(after).later).toEqual([]);
	});
});

describe("ask desk P11: oldest kind, then oldest ask", () => {
	it("groups by judgment age rather than alphabet or global row age", async () => {
		const approve1 = await Effect.runPromise(seal({...DRAFT, ask: "z-old"}));
		const merge = await Effect.runPromise(seal({...DRAFT, ask: "a-mid", for: "ruling"}));
		const approve2 = await Effect.runPromise(seal({...DRAFT, ask: "z-new"}));
		const model = initial([
			entry(1, FILED),
			entry(2, approve1, NOW - 30),
			entry(3, merge, NOW - 20),
			entry(4, approve2, NOW - 10),
		]);
		expect(asksNow(model).asks.map((a) => a.key)).toEqual(["117/z-old", "117/z-new", "117/a-mid"]);
	});
});

describe("ask desk P20: a saved stop is not a question", () => {
	it("keeps the saved reason and resume step, without offered picks or a decision-time estimate", () => {
		const stop = Schema.decodeUnknownSync(Entry)({
			pos: 2,
			ticket: 117,
			by: AGENT,
			at: NOW,
			fact: {type: "stopped", why: "read_failed", resume: "review"},
		});
		const now = asksNow(initial([entry(1, FILED), stop]));
		expect(now.asks).toHaveLength(1);
		expect(now.asks[0]).toMatchObject({kind: "stuck", why: "read_failed", resume: "review"});
		expect(now.asks[0]).not.toHaveProperty("picks");
		expect(now.asks[0]).not.toHaveProperty("estimate");
	});
});
