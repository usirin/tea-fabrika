import {Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect, Layer} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Experiments, experimentsOnLedger} from "./experiments.ts";

// What a run key promises, as laws over any order of starts: one run per key, numbered by the
// order the keys first came, and the same run for a key however often it is started again.

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
	it("give one run per key, numbered in the order the keys first came", async () => {
		await fc.assert(
			fc.asyncProperty(keys, async (order) => {
				const {answered, runs} = await started(order);
				const firsts = [...new Set(order)];
				expect(runs.map((r) => [r.run, r.key])).toEqual(firsts.map((k, i) => [`170-${i + 1}`, k]));
				expect(answered).toEqual(order.map((k) => `170-${firsts.indexOf(k) + 1}`));
			}),
			{numRuns: 40},
		);
	});
});
