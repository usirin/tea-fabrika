import {applyCell} from "@demlik/tea";
import {Ledger, Stale, streams, type MsgOf} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {Entry, nameOf} from "@kampus/pipeline/tickets/ticket";
import {Author} from "@tea-fabrika/tracker";
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
	loadCell,
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

// Review 2's fix list, high 1 and medium 1: the asks list's own read of the ledger, on a ledger in
// memory. Parked old asks are sealed once per ticket per read, after the paging, and one ticket
// whose old ask cannot be sealed leaves every other ticket's asks to load.
const LANE = "agent:lane for:owner";
const inboxOf = (n: number) => streams(nameOf(n)).inbox;
const put = (
	n: number,
	facts: readonly {readonly type: string; readonly [key: string]: unknown}[],
) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(nameOf(n), "user:owner");
		yield* ledger.send(inboxOf(n), "filed", {kind: "filed", writer: "user:owner", data: FILED});
		for (const [i, fact] of facts.entries())
			yield* ledger.send(inboxOf(n), `fact/${i}`, {kind: fact.type, writer: LANE, data: fact});
	});
const onLedger = <A, E>(effect: Effect.Effect<A, E, Ledger | Author>) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provideService(Author, OWNER),
			Effect.provideService(Ledger, memoryService()),
		),
	);

describe("ask desk review 2, medium 1: old asks are sealed once per ticket per read", () => {
	it("reads a ticket with a parked old ask once, however many pages the read takes", async () => {
		await onLedger(
			Effect.gen(function* () {
				// A merge ask is left parked (never sealed), so each preparing reads its inbox once.
				yield* put(5, [
					{type: "asked", ask: "a-merge-3", what: "Merge it?", picks: ["merge", "no"]},
				]);
				// More than one page of 500 rows after it.
				yield* put(
					6,
					Array.from({length: 600}, (_, i) => ({type: "commented", body: `Note ${i}.`})),
				);
				const ledger = yield* Ledger;
				let reads = 0;
				const counted: typeof ledger = {
					...ledger,
					readStream: (stream, ...rest) => {
						if (stream === inboxOf(5)) reads++;
						return ledger.readStream(stream, ...rest);
					},
				};
				const loaded = yield* loadCell(load({after: 0})).pipe(
					Effect.provideService(Ledger, counted),
				);
				expect(loaded.entries.length).toBeGreaterThan(500);
				expect(reads).toBe(1);
			}),
		);
	});
});

describe("ask desk review 2, high 1: one ticket that cannot be sealed fails no other", () => {
	it("loads the other tickets' asks when one ticket's old ask cannot be sealed", async () => {
		await onLedger(
			Effect.gen(function* () {
				yield* put(5, [
					{type: "asked", ask: "a-step-4", what: "Run the build again?", picks: ["again", "no"]},
				]);
				const sealed = yield* seal(DRAFT, policyFor(DRAFT.ask, false, blindDraw));
				yield* put(6, [{type: "planned", version: 2, tasks: []}, sealed]);
				const ledger = yield* Ledger;
				// Ticket 5's stream keeps moving under every write: its old ask can never be sealed.
				const stale: typeof ledger = {
					...ledger,
					append: (stream, rev, ...rest) =>
						stream === inboxOf(5)
							? Effect.fail(new Stale({stream, rev: typeof rev === "number" ? rev : 0}))
							: ledger.append(stream, rev, ...rest),
				};
				const loaded = yield* loadCell(load({after: 0})).pipe(
					Effect.provideService(Ledger, stale),
					Effect.result,
				);
				expect(loaded._tag).toBe("Success");
				if (loaded._tag !== "Success") return;
				const asks = asksNow(initial(loaded.success.entries)).asks;
				expect(asks.map((a) => a.key)).toContain(`6/${sealed.ask}`);
			}),
		);
	});
});
