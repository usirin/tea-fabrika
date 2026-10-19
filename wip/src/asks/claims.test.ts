import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {laneId, ticketId} from "../ids.ts";
import {claim, holderOf, newLane, release} from "./claims.ts";
import {type Fact, Ledger, memoryLedger} from "./ledger.ts";

// The claim on a ticket: one lane works a ticket at a time. A lane takes it by
// one compare-and-set on the ledger, and lets it go when it ends. Who holds a
// ticket is a fold over the ledger's facts, kept nowhere else.

const T = ticketId("o/r#7");
const U = ticketId("o/r#8");
const [L1, L2, L3, L4] = ["L1", "L2", "L3", "L4"].map(laneId) as [
	ReturnType<typeof laneId>,
	ReturnType<typeof laneId>,
	ReturnType<typeof laneId>,
	ReturnType<typeof laneId>,
];

type Memory = ReturnType<typeof memoryLedger>;
const on = <A>(ledger: Memory | Layer.Layer<Ledger>, effect: Effect.Effect<A, never, Ledger>) =>
	Effect.runPromise(Effect.provide(effect, "layer" in ledger ? ledger.layer : ledger));

/**
 * The same ledger, with every call yielding first: each lane reads, then
 * another runs, then it writes. The interleaving a second process makes.
 */
const crowded = (memory: Memory) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const inner = yield* Ledger;
			return Ledger.of({
				append: (fact) => Effect.yieldNow.pipe(Effect.andThen(inner.append(fact))),
				appendAfter: (after, fact) =>
					Effect.yieldNow.pipe(Effect.andThen(inner.appendAfter(after, fact))),
				entries: Effect.yieldNow.pipe(Effect.andThen(inner.entries)),
			});
		}),
	).pipe(Layer.provide(memory.layer));

const claims = (memory: Memory) =>
	memory
		.read()
		.filter((e) => e.fact.type === "claimed")
		.map((e) => e.fact);

/** Every order of three. */
const ORDERS = [
	[L1, L2, L3],
	[L1, L3, L2],
	[L2, L1, L3],
	[L2, L3, L1],
	[L3, L1, L2],
	[L3, L2, L1],
];

/** A planted claim: it reads the holder, then writes its claim with no compare. */
const readThenWrite = (ticket: typeof T, lane: typeof L1) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const holder = holderOf(yield* ledger.entries, ticket);
		if (holder !== null) return holder;
		const fact: Fact = {type: "claimed", ticket, lane};
		yield* ledger.append(fact);
		return lane;
	});

describe("a claim on a ticket: one compare-and-set on the ledger", () => {
	it("three lanes claim one ticket, in every order: the first holds it, and each claim is told so", async () => {
		for (const order of ORDERS) {
			const memory = memoryLedger();
			const told = await on(
				memory,
				Effect.forEach(order, (lane) => claim(T, lane), {concurrency: 1}),
			);
			expect(told).toEqual([order[0], order[0], order[0]]);
			expect(holderOf(memory.read(), T)).toBe(order[0]);
			expect(claims(memory)).toHaveLength(1);
		}
	});

	it("three lanes claim at once, as three processes would, twenty times over: one holds it, all three are told the same lane", async () => {
		for (let run = 0; run < 20; run++) {
			const memory = memoryLedger();
			const told = await on(
				crowded(memory),
				Effect.all(
					[L1, L2, L3].map((lane) => claim(T, lane)),
					{concurrency: "unbounded"},
				),
			);
			expect(new Set(told).size).toBe(1);
			expect(holderOf(memory.read(), T)).toBe(told[0]);
			expect(claims(memory)).toHaveLength(1);
		}
	});

	it("planted: a claim read, then written with no compare, lets two lanes both think they hold it", async () => {
		const memory = memoryLedger();
		const told = await on(
			crowded(memory),
			Effect.all(
				[L1, L2, L3].map((lane) => readThenWrite(T, lane)),
				{concurrency: "unbounded"},
			),
		);
		expect(new Set(told).size).toBeGreaterThan(1);
	});

	it("a lane that claims again still holds it, and nothing more is written", async () => {
		const memory = memoryLedger();
		const told = await on(
			memory,
			Effect.forEach([L1, L1, L2, L1], (lane) => claim(T, lane), {concurrency: 1}),
		);
		expect(told).toEqual([L1, L1, L1, L1]);
		expect(claims(memory)).toHaveLength(1);
	});

	it("a release by a lane that does not hold it changes nothing", async () => {
		const memory = memoryLedger();
		await on(
			memory,
			Effect.gen(function* () {
				yield* claim(T, L1);
				yield* release(T, L2);
				yield* release(T, L3);
			}),
		);
		expect(holderOf(memory.read(), T)).toBe(L1);
		expect(await on(memory, claim(T, L2))).toBe(L1);
	});

	it("let go by its holder, the ticket is free: a fourth lane takes it, and the three before are told so", async () => {
		const memory = memoryLedger();
		const told = await on(
			memory,
			Effect.gen(function* () {
				for (const lane of [L1, L2, L3]) yield* claim(T, lane);
				yield* release(T, L1);
				return yield* Effect.forEach([L4, L2, L3, L1], (lane) => claim(T, lane), {concurrency: 1});
			}),
		);
		expect(told).toEqual([L4, L4, L4, L4]);
		expect(holderOf(memory.read(), T)).toBe(L4);
	});

	it("a claim on one ticket leaves another free", async () => {
		const memory = memoryLedger();
		const told = await on(
			memory,
			Effect.forEach(
				[
					[T, L1],
					[U, L2],
					[T, L3],
					[U, L3],
				] as const,
				([ticket, lane]) => claim(ticket, lane),
				{concurrency: 1},
			),
		);
		expect(told).toEqual([L1, L2, L1, L2]);
	});

	it("a claim written blind after another does not take the ticket: the first claim holds until it is let go", () => {
		const entries = [
			{seq: 1, fact: {type: "claimed", ticket: T, lane: L1}},
			{seq: 2, fact: {type: "claimed", ticket: T, lane: L2}},
			{seq: 3, fact: {type: "released", ticket: T, lane: L2}},
		] as const;
		expect(holderOf(entries, T)).toBe(L1);
		expect(holderOf([...entries, {seq: 4, fact: {type: "released", ticket: T, lane: L1}}], T)).toBe(
			null,
		);
	});

	it("each new lane has an id of its own, from the ledger, so two processes never share one", async () => {
		const memory = memoryLedger();
		const lanes = await on(
			crowded(memory),
			Effect.all([newLane(T), newLane(T), newLane(U)], {concurrency: "unbounded"}),
		);
		expect(new Set(lanes).size).toBe(3);
	});
});
