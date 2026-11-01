import {Ledger} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Effect, Layer} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {runIdOf} from "./experiment.ts";
import {Experiments, experimentsOnLedger} from "./experiments.ts";

// What a run key promises, as laws over any order of starts: one run per key, the same id for a
// key whatever the order and however often it is started again, and labels in the order the
// keys first came.

const keys = fc.array(fc.constantFrom("a", "b", "c", "d"), {maxLength: 10});

/** Start each key in turn on experiment 170, on a fresh ledger: the run each start answered. */
const started = (order: readonly string[]) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const ex = yield* Experiments;
			yield* ex.create("170", "The experiments program");
			const answered: string[] = [];
			for (const key of order)
				answered.push(yield* ex.start("170", {key, params: {}, tags: {}, job: null}));
			return {answered, runs: yield* ex.runs("170")};
		}).pipe(
			Effect.provide(
				experimentsOnLedger({kind: "agent", id: "test"}).pipe(
					Layer.provide(Layer.succeed(Ledger, memoryService())),
				),
			),
		),
	);

describe("run keys", () => {
	it("give one run per key, its id made from the key, labelled in the order keys first came", async () => {
		await fc.assert(
			fc.asyncProperty(keys, async (order) => {
				const {answered, runs} = await started(order);
				const firsts = [...new Set(order)];
				expect(runs.map((r) => [r.run, r.label, r.key])).toEqual(
					firsts.map((k, i) => [runIdOf("170", k), `170-${i + 1}`, k]),
				);
				expect(answered).toEqual(order.map((k) => runIdOf("170", k)));
			}),
			{numRuns: 40},
		);
	});

	it("give each key the same id in any order of starts", async () => {
		const orders = keys.chain((order) =>
			fc.tuple(fc.constant(order), fc.shuffledSubarray(order, {minLength: order.length})),
		);
		await fc.assert(
			fc.asyncProperty(orders, async ([one, other]) => {
				const idOf = async (order: readonly string[]) => {
					const {runs} = await started(order);
					return new Map(runs.map((r) => [r.key, r.run]));
				};
				expect(await idOf(other)).toEqual(await idOf(one));
			}),
			{numRuns: 40},
		);
	});
});
