import {LedgerUnreachable} from "@kampus/fabrika-old";
import {Duration, Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {type LaneId, laneId, planOf, taskId, ticketId} from "../ids.ts";
import {claim, holderOf, holding, Lanes, layerLanes, newLane, release} from "./claims.ts";
import {factsOf, Ledger, memoryLedger, sendFact, ticketName} from "./ledger.ts";

// The claim on a ticket: one lane works a ticket at a time. A lane takes it with the ledger's lease
// on the ticket's name, keeps it live by renewing it, and lets it go when it ends. Who holds a
// ticket is the lease, kept nowhere else. Each `Lanes` layer below is one process: its own fences
// and renewals, on a ledger the processes share.

const T = ticketId("o/r#7");
const U = ticketId("o/r#8");
const [L1, L2, L3, L4] = ["L1", "L2", "L3", "L4"].map(laneId) as [LaneId, LaneId, LaneId, LaneId];

type Memory = ReturnType<typeof memoryLedger>;
/** One process on `ledger`: its own leases, renewed while `effect` runs. */
const proc = <A, E>(
	ledger: Layer.Layer<Ledger>,
	effect: Effect.Effect<A, E, Lanes | Ledger>,
	ttlMs = 30_000,
) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(layerLanes({ttlMs}).pipe(Layer.provideMerge(ledger)))),
	);
const holderNow = (memory: Memory, ticket = T) =>
	Effect.runSync(holderOf(ticket).pipe(Effect.provide(memory.layer)));
/** The `claimed` events on a ticket's name: one per claim the ledger took. */
const claimsOn = (memory: Memory, ticket = T) =>
	memory.rows().filter((r) => r.stream === ticketName(ticket) && r.kind === "claimed");

/**
 * The same ledger, with every call yielding first: each process reads, then another runs, then it
 * writes. The interleaving a second process makes.
 */
const crowded = (memory: Memory) => {
	const wrapped: Record<string, unknown> = {};
	for (const [key, call] of Object.entries(memory.service))
		wrapped[key] =
			key === "watch"
				? call
				: (...args: unknown[]) =>
						Effect.yieldNow.pipe(
							Effect.andThen((call as (...a: unknown[]) => Effect.Effect<unknown>)(...args)),
						);
	return Layer.succeed(Ledger, wrapped as Ledger["Service"]);
};

/** Every order of three. */
const ORDERS = [
	[L1, L2, L3],
	[L1, L3, L2],
	[L2, L1, L3],
	[L2, L3, L1],
	[L3, L1, L2],
	[L3, L2, L1],
];

/** A planted claim: it reads who holds the lease, and with nobody, takes the ticket with no claim. */
const readThenTake = (ticket: typeof T, lane: LaneId) =>
	Effect.map(holderOf(ticket), (holder) => holder ?? lane);

describe("a claim on a ticket: the ledger's lease on its name", () => {
	it("three lanes, three processes, claim one ticket in every order: the first holds it, each claim is told so, and the ledger took one claim", async () => {
		for (const order of ORDERS) {
			const memory = memoryLedger();
			const told: LaneId[] = [];
			for (const lane of order) told.push(await proc(memory.layer, claim(T, lane)));
			expect(told).toEqual([order[0], order[0], order[0]]);
			expect(holderNow(memory)).toBe(order[0]);
			expect(claimsOn(memory)).toHaveLength(1);
		}
	});

	it("three processes claim at once, twenty times over: one holds it, all three are told the same lane", async () => {
		for (let run = 0; run < 20; run++) {
			const memory = memoryLedger();
			const told = await Promise.all(
				[L1, L2, L3].map((lane) => proc(crowded(memory), claim(T, lane))),
			);
			expect(new Set(told).size).toBe(1);
			expect(holderNow(memory)).toBe(told[0]);
			expect(claimsOn(memory)).toHaveLength(1);
		}
	});

	it("planted: the lease read, then the ticket taken with no claim, lets two lanes both think they hold it; neither can write under the ticket", async () => {
		const memory = memoryLedger();
		const told = await Promise.all(
			[L1, L2, L3].map((lane) =>
				Effect.runPromise(readThenTake(T, lane).pipe(Effect.provide(crowded(memory)))),
			),
		);
		expect(new Set(told).size).toBeGreaterThan(1);
		// Once a lane claims for real, the ones that only read have no fence: the ledger refuses them.
		expect(await proc(memory.layer, claim(T, L4))).toBe(L4);
		const unfenced = await Effect.runPromise(
			memory.service
				.append(factsOf(ticketName(T)), "any", {kind: "released", writer: L1, data: {}})
				.pipe(Effect.flip),
		);
		expect(unfenced._tag).toBe("Denied");
	});

	it("a lane that claims again still holds it, and nothing more is written", async () => {
		const memory = memoryLedger();
		const told = await proc(
			memory.layer,
			Effect.forEach([L1, L1, L2, L1], (lane) => claim(T, lane), {concurrency: 1}),
		);
		expect(told).toEqual([L1, L1, L1, L1]);
		expect(claimsOn(memory)).toHaveLength(1);
	});

	it("a release by a lane that does not hold it changes nothing", async () => {
		const memory = memoryLedger();
		await proc(
			memory.layer,
			Effect.gen(function* () {
				yield* claim(T, L1);
				yield* release(T, L2);
				yield* release(T, L3);
			}),
		);
		expect(holderNow(memory)).toBe(L1);
		expect(await proc(memory.layer, claim(T, L2))).toBe(L1);
	});

	it("let go by its holder, the ticket is free at once: a fourth lane in another process takes it, and the three before are told so", async () => {
		const memory = memoryLedger();
		await proc(
			memory.layer,
			Effect.gen(function* () {
				yield* claim(T, L1);
				yield* release(T, L1);
			}),
		);
		expect(holderNow(memory)).toBeNull();
		const started = Date.now();
		const told: LaneId[] = [];
		for (const lane of [L4, L2, L3, L1]) told.push(await proc(memory.layer, claim(T, lane)));
		expect(told).toEqual([L4, L4, L4, L4]);
		// Nothing waited for the old lease's 30 s: the release ended it.
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(holderNow(memory)).toBe(L4);
		// The release is a fact, written under the old lease before the lease ended.
		expect(memory.read().map((e) => e.fact)).toEqual([{type: "released", ticket: T, lane: L1}]);
	});

	it("a claim on one ticket leaves another free", async () => {
		const memory = memoryLedger();
		const told: LaneId[] = [];
		for (const [ticket, lane] of [
			[T, L1],
			[U, L2],
			[T, L3],
			[U, L3],
		] as const)
			told.push(await proc(memory.layer, claim(ticket, lane)));
		expect(told).toEqual([L1, L2, L1, L2]);
	});

	it("a claim on a held name, or at a rev the name has moved past, is refused by the ledger: it takes nothing", async () => {
		const memory = memoryLedger();
		await proc(memory.layer, claim(T, L1));
		const l = memory.service;
		const name = ticketName(T);
		const rev = (await Effect.runPromise(l.readLast(name, 1)))[0]?.rev ?? 0;
		const held = await Effect.runPromise(Effect.flip(l.claim(name, L2, rev, 30_000)));
		expect(held).toMatchObject({_tag: "Held", holder: L1});
		// A free name, claimed at a rev it has moved past (its registration is rev 1).
		await Effect.runPromise(l.register(ticketName(U), "setup"));
		const stale = await Effect.runPromise(Effect.flip(l.claim(ticketName(U), L2, 0, 30_000)));
		expect(stale._tag).toBe("Stale");
		expect(holderNow(memory)).toBe(L1);
		expect(claimsOn(memory)).toHaveLength(1);
	});

	it("each new lane on a ticket has an id of its own, from the ledger, so two processes never share one; sent again under one id, it is the same lane", async () => {
		const memory = memoryLedger();
		const lanes = await Effect.runPromise(
			Effect.all([newLane(T), newLane(T), newLane(U)], {concurrency: "unbounded"}).pipe(
				Effect.provide(crowded(memory)),
			),
		);
		expect([...lanes.slice(0, 2)].sort()).toEqual([L1, L2]);
		expect(lanes[2]).toBe(L1);
		const again = await Effect.runPromise(
			Effect.all([newLane(T, "lane-a"), newLane(T, "lane-a")], {concurrency: 1}).pipe(
				Effect.provide(memory.layer),
			),
		);
		expect(again).toEqual([L3, L3]);
	});
});

describe("a lease that is lost", () => {
	it("a holder that stops renewing (killed, or frozen) loses the lease when it runs out: another lane takes the ticket, and every write under the old fence is refused", async () => {
		const memory = memoryLedger();
		// The first process claims, then is gone: its renewals end with it. Its fence is kept here.
		const old = await proc(
			memory.layer,
			Effect.gen(function* () {
				yield* claim(T, L1);
				return yield* Lanes.use((l) => l.hold(T));
			}),
			300,
		);
		if (old === null) throw new Error("the claim gave no lease");
		expect(await proc(memory.layer, claim(T, L2), 300)).toBe(L1);
		await new Promise((r) => setTimeout(r, 400));
		expect(await proc(memory.layer, claim(T, L2))).toBe(L2);
		// The old holder wakes, and writes as if it still held the ticket: under its own name, and to its plan.
		const late = await Effect.runPromise(
			Effect.all(
				[
					Effect.flip(sendFact({type: "released", ticket: T, lane: L1}, {hold: old})),
					Effect.flip(
						sendFact({type: "reviewed", plan: planOf(T), task: taskId("t1"), open: 0}, {hold: old}),
					),
				],
				{concurrency: 1},
			).pipe(Effect.provide(memory.layer)),
		);
		expect(late.map((e) => e._tag)).toEqual(["Fenced", "Fenced"]);
		expect(memory.read()).toEqual([]);
	});

	it("a lane started again after a crash, as the same lane, waits its old lease out and claims it as itself", async () => {
		const memory = memoryLedger();
		await proc(memory.layer, claim(T, L1), 600);
		const started = Date.now();
		expect(await proc(memory.layer, claim(T, L1), 600)).toBe(L1);
		expect(Date.now() - started).toBeGreaterThanOrEqual(400);
		expect(claimsOn(memory).map((r) => r.writer)).toEqual([L1, L1]);
	});

	it("the door: a lane holds its ticket while its lease renews, and another lane's door stays shut", async () => {
		const memory = memoryLedger();
		const seen = await proc(
			memory.layer,
			Effect.gen(function* () {
				yield* claim(T, L1);
				return {mine: yield* holding(T, L1), other: yield* holding(T, L2)};
			}),
		);
		expect(seen).toEqual({mine: true, other: false});
		// Held by L1 in a process that is gone, another lane's door, in a new process, stays shut too.
		expect(await proc(memory.layer, holding(T, L2))).toBe(false);
	});
});

/** `memory`'s ledger behind a link that can drop: while `link.down`, every call goes unanswered. */
const behind = (memory: Memory, link: {down: boolean}) => {
	const wrapped: Record<string, unknown> = {};
	for (const [key, call] of Object.entries(memory.service))
		wrapped[key] =
			key === "watch"
				? call
				: (...args: unknown[]) =>
						Effect.suspend(() =>
							link.down
								? Effect.fail(new LedgerUnreachable({method: key, message: "the link is down"}))
								: (call as (...a: unknown[]) => Effect.Effect<unknown>)(...args),
						);
	return Layer.succeed(Ledger, wrapped as Ledger["Service"]);
};

/** One process behind `link`, with a 300 ms lease and `graceMs` of patience. */
const cutOff = <A, E>(
	memory: Memory,
	link: {down: boolean},
	graceMs: number,
	effect: Effect.Effect<A, E, Lanes | Ledger>,
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(
				layerLanes({ttlMs: 300, graceMs}).pipe(Layer.provideMerge(behind(memory, link))),
			),
		),
	);

/** The lease's own events on a ticket's name, in order. */
const leaseEvents = (memory: Memory, ticket = T) =>
	memory
		.rows()
		.filter((r) => r.stream === ticketName(ticket))
		.map((r) => r.kind)
		.filter((k) => k === "claimed" || k.startsWith("lease_"));

// Experiment 151: a fence is good until someone newer claims (Kafka's producer epoch). A lane cut
// off from the ledger keeps its ticket while nobody claims it, and lets it go only past its lease's
// end plus a grace.
describe("a ledger that does not answer", () => {
	it("a holder cut off past its lease's end keeps the ticket while nobody claims it: back, it renews under the same fence", async () => {
		const memory = memoryLedger();
		const link = {down: false};
		const out = await cutOff(
			memory,
			link,
			60_000,
			Effect.gen(function* () {
				yield* claim(T, L1);
				const before = yield* Lanes.use((l) => l.hold(T));
				link.down = true;
				// Five lease times with no answer: the expiry job is due in the middle.
				yield* Effect.sleep(Duration.millis(1_500));
				link.down = false;
				yield* Effect.sleep(Duration.millis(400));
				return {before, after: yield* Lanes.use((l) => l.hold(T))};
			}),
		);
		expect(out.after).toEqual(out.before);
		expect(holderNow(memory)).toBe(L1);
		expect(leaseEvents(memory)).toEqual(["claimed", "lease_expired", "lease_resumed"]);
	});

	it("past its lease's end plus the grace with no answer, a holder lets the ticket go", async () => {
		const memory = memoryLedger();
		const link = {down: false};
		const held = await cutOff(
			memory,
			link,
			300,
			Effect.gen(function* () {
				yield* claim(T, L1);
				link.down = true;
				yield* Effect.sleep(Duration.millis(1_200));
				const held = yield* Lanes.use((l) => l.hold(T));
				link.down = false;
				return held;
			}),
		);
		expect(held).toBeNull();
	});

	it("a holder cut off while another lane claims the ticket is refused when it is back: it lets go, and its old fence writes nothing", async () => {
		const memory = memoryLedger();
		const link = {down: false};
		const old = await cutOff(
			memory,
			link,
			60_000,
			Effect.gen(function* () {
				yield* claim(T, L1);
				const old = yield* Lanes.use((l) => l.hold(T));
				link.down = true;
				yield* Effect.sleep(Duration.millis(500));
				// Its lease ran out: another lane, in another process, takes the ticket.
				const other = layerLanes().pipe(Layer.provideMerge(memory.layer));
				expect(yield* claim(T, L2).pipe(Effect.provide(other))).toBe(L2);
				link.down = false;
				yield* Effect.sleep(Duration.millis(400));
				expect(yield* Lanes.use((l) => l.hold(T))).toBeNull();
				return old;
			}),
		);
		if (old === null) throw new Error("the claim gave no lease");
		expect(holderNow(memory)).toBe(L2);
		const late = await Effect.runPromise(
			Effect.flip(sendFact({type: "released", ticket: T, lane: L1}, {hold: old})).pipe(
				Effect.provide(memory.layer),
			),
		);
		expect(late._tag).toBe("Fenced");
		expect(memory.read()).toEqual([]);
	});
});
