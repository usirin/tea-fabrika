import {ear, start, tell} from "@kampus/fabrika-old";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {planOf, ticketId} from "../ids.ts";
import {numbered} from "../stages/plan/ids.ts";
import {revisionOfDraft} from "../stages/plan/plan.ts";
import type {Ask, Refused, Settled, Waiting} from "./ask.ts";
import {changed, numberOf, plans86b, RULINGS} from "./cases.ts";
import {memoryLedger} from "./ledger.ts";
import {asksProgram} from "./program.ts";
import {foldLedger, openAsks} from "./rules.ts";

// The core's asks program, started from code with no add-on pack: nobody
// listens to it, or only a test does. It must run either way.

const run = <A, E>(
	body: Effect.Effect<A, E, any>,
	layer: ReturnType<typeof memoryLedger>["layer"],
) =>
	Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, unknown>);

const NOBODY_HOLDS = {holds: 0};
const INPUTS = [
	"planned",
	"revised",
	"reviewed",
	"ruling",
	"answer",
	"build",
	"cleared",
	"raise",
] as const;

describe("the asks program", () => {
	it("with nobody listening it runs to its end; each ask is kept open in the ledger", async () => {
		const disk = memoryLedger();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				for (const p of plans86b()) yield* tell(started.run, "planned", p);
				for (const {ruling} of RULINGS) yield* tell(started.run, "ruling", ruling);
				for (const name of INPUTS) started.close(name);
				expect((yield* started.run.ended).kind).toBe("ended");
			}),
			disk.layer,
		);
		const open = openAsks(foldLedger(disk.read()));
		// Two inputs are read side by side, so plans and rulings interleave; each keeps its own order.
		expect(open.filter((a) => a.for === "plan")).toHaveLength(6);
		expect(open.filter((a) => a.for === "ruling")).toHaveLength(4);
		expect(open.map((a) => a.at)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it("a later start says every open ask again, oldest first, to whoever listens from the start", async () => {
		const disk = memoryLedger();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				for (const p of plans86b()) yield* tell(started.run, "planned", p);
				for (const name of INPUTS) started.close(name);
				yield* started.run.ended;
			}),
			disk.layer,
		);
		const asks = ear<Ask>();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {ask: asks.hear});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* asks.upTo(6);
				yield* started.stop;
			}),
			disk.layer,
		);
		expect(asks.values.map((a) => (a.for === "plan" ? numberOf(a.plan) : a.for))).toEqual([
			"367",
			"393",
			"490",
			"504",
			"565",
			"579",
		]);
	});

	it("takes an answer that fits, refuses one that does not, and keeps only the first", async () => {
		const disk = memoryLedger();
		const asks = ear<Ask>();
		const settled = ear<Settled>();
		const refused = ear<Refused>();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {
					ask: asks.hear,
					settled: settled.hear,
					refused: refused.hear,
				});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* tell(started.run, "ruling", RULINGS[0]!.ruling);
				const [ask] = yield* asks.upTo(1);
				yield* tell(started.run, "answer", {id: ask!.id, answer: {kind: "approve"}});
				yield* tell(started.run, "answer", {
					id: ask!.id,
					answer: {kind: "rule", answer: "(b)", rule: "one_off", build: true},
				});
				yield* settled.upTo(1);
				yield* refused.upTo(1);
				yield* started.stop;
			}),
			disk.layer,
		);
		expect(refused.values).toEqual([
			{
				id: "ruling:kamp-us/demlik#68",
				why: "a ruling ask takes rule, not approve",
			},
		]);
		expect(settled.values[0]?.next).toEqual({do: "ruled", record: false, plan: true});
		expect(disk.read().map((e) => e.fact.type)).toEqual(["ruling_needed", "answered"]);
	});

	it("a revised plan keeps the ids it names: its ask is version 2, shown against the approved one", async () => {
		const disk = memoryLedger();
		const asks = ear<Ask>();
		const p565 = plans86b().find((p) => numberOf(p.ticket) === "565")!;
		const v1 = numbered(revisionOfDraft(p565.plan!)!);
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {ask: asks.hear});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* tell(started.run, "planned", p565);
				const [first] = yield* asks.upTo(1);
				yield* tell(started.run, "answer", {id: first!.id, answer: {kind: "approve"}});
				yield* tell(started.run, "revised", {
					plan: planOf(ticketId(p565.ticket)),
					data: changed(v1),
				});
				yield* asks.upTo(2);
				yield* started.stop;
			}),
			disk.layer,
		);
		const again = asks.values[1];
		if (again?.for !== "plan") throw new Error("no second plan ask");
		expect(again).toMatchObject({version: 2, since: {version: 1}});
		expect(again.since?.data).toEqual(v1);
		expect(again.data.tasks[0]!.criteria[0]).toMatchObject({
			id: v1.tasks[0]!.criteria[0]!.id,
			version: 2,
		});
	});

	it("says the whole open list at its start and on each change, also when an ask stops waiting unanswered", async () => {
		const disk = memoryLedger();
		const waiting = ear<Waiting>();
		const [first] = plans86b();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, NOBODY_HOLDS, {waiting: waiting.hear});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				if (first === undefined) return yield* Effect.die("no plans");
				yield* waiting.upTo(1);
				yield* tell(started.run, "planned", first);
				yield* waiting.upTo(2);
				// Written again before it is answered: version 1 stops waiting, and no answer is heard for it.
				yield* tell(started.run, "planned", first);
				yield* waiting.upTo(3);
				yield* started.stop;
			}),
			disk.layer,
		);
		expect(waiting.values.map((w) => w.asks.map((a) => a.id.split("@")[1]))).toEqual([
			[],
			["1"],
			["2"],
		]);
	});
});
