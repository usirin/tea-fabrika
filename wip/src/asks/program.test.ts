import {start, tell} from "@tea-fabrika/tea-program";
import {ear} from "@tea-fabrika/tea-program/ear";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {Ask, Refused, Settled} from "./ask.ts";
import {numberOf, plans86b, RULINGS} from "./cases.ts";
import {memoryLedger} from "./ledger.ts";
import {asksProgram} from "./program.ts";
import {foldLedger, openAsks} from "./rules.ts";

// The core's asks program, started from code with no add-on pack: nobody
// listens to it, or only a test does. It must run either way.

const run = <A>(
	body: Effect.Effect<A, never, any>,
	layer: ReturnType<typeof memoryLedger>["layer"],
) =>
	Effect.runPromise(
		body.pipe(
			Effect.scoped,
			Effect.provide(layer),
			Effect.timeout("5 seconds"),
		) as Effect.Effect<A>,
	);

describe("the asks program", () => {
	it("with nobody listening it runs to its end; each ask is kept open in the ledger", async () => {
		const disk = memoryLedger();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, {}, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				for (const p of plans86b()) tell(started.run, "planned", p);
				for (const {ruling} of RULINGS) tell(started.run, "ruling", ruling);
				for (const name of ["planned", "reviewed", "ruling", "answer"] as const)
					started.close(name);
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
				const started = yield* start(asksProgram, {}, {});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				for (const p of plans86b()) tell(started.run, "planned", p);
				for (const name of ["planned", "reviewed", "ruling", "answer"] as const)
					started.close(name);
				yield* started.run.ended;
			}),
			disk.layer,
		);
		const asks = ear<Ask>();
		await run(
			Effect.gen(function* () {
				const started = yield* start(asksProgram, {}, {ask: asks.hear});
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
				const started = yield* start(
					asksProgram,
					{},
					{ask: asks.hear, settled: settled.hear, refused: refused.hear},
				);
				if (started.kind !== "running") return yield* Effect.die(started.why);
				tell(started.run, "ruling", RULINGS[0]!.ruling);
				const [ask] = yield* asks.upTo(1);
				tell(started.run, "answer", {id: ask!.id, answer: {kind: "approve"}});
				tell(started.run, "answer", {
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
				id: "ruling:https://github.com/kamp-us/demlik/issues/68",
				why: "a ruling ask takes rule, not approve",
			},
		]);
		expect(settled.values[0]?.next).toEqual({do: "ruled", record: false, plan: true});
		expect(disk.read().map((e) => e.fact.type)).toEqual(["ruling_needed", "answered"]);
	});
});
