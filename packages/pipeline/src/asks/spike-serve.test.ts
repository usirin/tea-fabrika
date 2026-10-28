import {ear, start, tell} from "@kampus/fabrika";
import * as Program from "@kampus/fabrika/spike/serve";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {askId} from "../ids.ts";
import type {Ask, Refused, Settled} from "./ask.ts";
import {plans86b, RULINGS} from "./cases.ts";
import {memoryLedger} from "./ledger.ts";
import {asksProgram} from "./program.ts";
import {foldLedger, openAsks} from "./rules.ts";
import {spikeAsks} from "./spike-serve.ts";

// Experiment 164: asks on one mailbox (./spike-serve.ts), beside asks today
// (./program.ts), on the same tells.

const run = <A, E>(
	body: Effect.Effect<A, E, any>,
	layer: ReturnType<typeof memoryLedger>["layer"],
) =>
	Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, unknown>);

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
const ruling = RULINGS[0]!.ruling;
const id = askId(`ruling:${ruling.ticket}`);
const answer = {id, answer: {kind: "rule", answer: "(b)", rule: "one_off", build: true}} as const;

describe("asks on one mailbox", () => {
	it("a ruling, then its answer at once: today the answer can be read first and refused; on one mailbox it is settled", async () => {
		const today = memoryLedger();
		const seenToday = await run(
			Effect.gen(function* () {
				const settled = ear<Settled>();
				const refused = ear<Refused>();
				const started = yield* start(
					asksProgram,
					{holds: 0},
					{settled: settled.hear, refused: refused.hear},
				);
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* tell(started.run, "ruling", ruling);
				yield* tell(started.run, "answer", answer);
				for (const name of INPUTS) started.close(name);
				yield* started.run.ended;
				return {settled: settled.values.length, refused: refused.values};
			}),
			today.layer,
		);
		const spike = memoryLedger();
		const seenSpike = await run(
			Effect.gen(function* () {
				const settled = ear<Settled>();
				const refused = ear<Refused>();
				const started = yield* Program.start(
					spikeAsks,
					{holds: 0},
					{settled: settled.hear, refused: refused.hear},
				);
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* Program.tell(started.run, "ruling", ruling);
				yield* Program.tell(started.run, "answer", answer);
				for (const name of INPUTS) started.close(name);
				yield* started.run.ended;
				return {settled: settled.values.length, refused: refused.values};
			}),
			spike.layer,
		);
		// Today the answer was read before the ruling, so no ask had its id yet. Nothing was kept of it.
		expect(seenToday).toEqual({settled: 0, refused: [{id, why: "no ask has this id"}]});
		expect(today.read().map((e) => e.fact.type)).toEqual(["ruling_needed"]);
		expect(seenSpike).toEqual({settled: 1, refused: []});
		expect(spike.read().map((e) => e.fact.type)).toEqual(["ruling_needed", "answered"]);
	});

	it("six plans, then four rulings: each ask is kept in the order told, where today the two inputs interleave", async () => {
		const asksOf = async (shape: "today" | "spike") => {
			const disk = memoryLedger();
			await run(
				Effect.gen(function* () {
					if (shape === "today") {
						const started = yield* start(asksProgram, {holds: 0}, {});
						if (started.kind !== "running") return yield* Effect.die(started.why);
						for (const p of plans86b()) yield* tell(started.run, "planned", p);
						for (const {ruling} of RULINGS) yield* tell(started.run, "ruling", ruling);
						for (const name of INPUTS) started.close(name);
						yield* started.run.ended;
					} else {
						const started = yield* Program.start(spikeAsks, {holds: 0}, {});
						if (started.kind !== "running") return yield* Effect.die(started.why);
						for (const p of plans86b()) yield* Program.tell(started.run, "planned", p);
						for (const {ruling} of RULINGS) yield* Program.tell(started.run, "ruling", ruling);
						for (const name of INPUTS) started.close(name);
						yield* started.run.ended;
					}
				}),
				disk.layer,
			);
			return openAsks(foldLedger(disk.read())).map((a: Ask) => a.for);
		};
		const today = await asksOf("today");
		const spike = await asksOf("spike");
		expect(spike).toEqual([...Array(6).fill("plan"), ...Array(4).fill("ruling")]);
		expect(today).toEqual([
			"plan",
			"ruling",
			"plan",
			"ruling",
			"plan",
			"ruling",
			"plan",
			"ruling",
			"plan",
			"plan",
		]);
	});
});
