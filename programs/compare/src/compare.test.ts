import {call, Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import type {RunId} from "@kampus/pipeline/experiments/experiment";
import {Experiments, experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {Cause, Effect, Layer, Option} from "effect";
import {describe, expect, it} from "vitest";
import {compare} from "./index.ts";

// compare on a ledger in memory: experiment 170 with three runs, its cases scored by `agreed`.

const onLedger = <A, E>(use: Effect.Effect<A, E, Experiments>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const experiments = yield* Experiments;
			yield* experiments.create("170", "The experiments program");
			for (const scores of [
				[1, 0, 1],
				[1, 1, 1],
				[0, 1, 1],
			]) {
				const run = yield* experiments.start("170", {params: {}, tags: {}, job: null});
				yield* experiments.log(run, [
					...scores.map((agreed, i) => ({
						kind: "case" as const,
						item: `t-${i + 1}`,
						output: "yes",
						scores: {agreed},
					})),
					{kind: "metric", key: "agreed", value: scores.reduce((a, b) => a + b) / 3},
				]);
				yield* experiments.end(run, {status: "finished", usd: null, tokens: null});
			}
			yield* experiments.create("171", "One run only");
			yield* experiments.start("171", {params: {}, tags: {}, job: null});
			return yield* use;
		}).pipe(
			Effect.provide(
				experimentsOnLedger({kind: "agent", id: "test"}).pipe(
					Layer.provide(Layer.succeed(Ledger, memoryService())),
				),
			),
		),
	);

const run = (id: string) => id as RunId;

describe("compare", () => {
	it("compares the last two runs when none is named", async () => {
		const called = await onLedger(call(compare, {n: "170", a: undefined, b: undefined}));
		if (called.kind !== "called") throw new Error(called.why);
		const [comparison, markdown] = called.heard;
		expect(comparison?.name === "comparison" && comparison.value).toMatchObject({
			a: "170-2",
			b: "170-3",
			cases: [{item: "t-1", a: {agreed: 1}, b: {agreed: 0}}],
			same: 2,
		});
		expect(markdown?.value).toContain("# 170-2 against 170-3");
	});

	it("compares the two runs it is given", async () => {
		const called = await onLedger(call(compare, {n: "170", a: run("170-1"), b: run("170-3")}));
		if (called.kind !== "called") throw new Error(called.why);
		const comparison = called.heard.find((h) => h.name === "comparison");
		expect(comparison?.name === "comparison" && comparison.value.cases.map((c) => c.item)).toEqual([
			"t-1",
			"t-2",
		]);
	});

	it("fails when the experiment has fewer than two runs", async () => {
		const called = await onLedger(call(compare, {n: "171", a: undefined, b: undefined}));
		if (called.kind !== "called" || called.ended.kind !== "failed") throw new Error("it ended");
		expect(Option.getOrUndefined(Cause.findErrorOption(called.ended.cause))).toMatchObject({
			why: "no_run",
			says: "compare needs two runs of 171, and 171 has 1",
		});
	});
});
