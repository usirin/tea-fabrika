import {call, Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Experiments, experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {Cause, Effect, Layer, Option} from "effect";
import {describe, expect, it} from "vitest";
import {experiment} from "./index.ts";

// experiment on a ledger in memory: 170 with its write-up and one run.

const onLedger = <A, E>(use: Effect.Effect<A, E, Experiments>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* Experiments;
			yield* service.create("170", "The experiments program");
			yield* service.write("170", {
				date: "2026-10-30",
				answer: "Yes, on today's blocks.",
				headline: "agreed",
				sections: [{heading: "What we did", text: "Read the old log."}],
			});
			const run = yield* service.start("170", {key: "test-1", params: {}, tags: {}, job: null});
			yield* service.log(run, [{kind: "metric", key: "agreed", value: 1}]);
			yield* service.end(run, {status: "finished", usd: 0, tokens: null});
			return yield* use;
		}).pipe(
			Effect.provide(
				experimentsOnLedger({kind: "agent", id: "test"}).pipe(
					Layer.provide(Layer.succeed(Ledger, memoryService())),
				),
			),
		),
	);

describe("experiment", () => {
	it("sends the page as data, then as markdown with the answer first", async () => {
		const called = await onLedger(call(experiment, {n: "170"}));
		if (called.kind !== "called") throw new Error(called.why);
		const [page, markdown] = called.heard;
		expect(page?.name === "page" && [page.value.title, page.value.runs.map((r) => r.run)]).toEqual([
			"The experiments program",
			["170-1"],
		]);
		expect(
			typeof markdown?.value === "string" && markdown.value.split("\n").filter((l) => l !== ""),
		).toEqual([
			"# 170: The experiments program",
			"Date: 2026-10-30",
			"**Answer.** Yes, on today's blocks.",
			"## What we did",
			"Read the old log.",
			"## Runs",
			"| Run | Status | Dollars | Metrics |",
			"|---|---|---|---|",
			"| 170-1 | finished | 0 | agreed 1 |",
		]);
	});

	it("fails on a number the ledger does not have", async () => {
		const called = await onLedger(call(experiment, {n: "404"}));
		if (called.kind !== "called" || called.ended.kind !== "failed") throw new Error("it ended");
		expect(Option.getOrUndefined(Cause.findErrorOption(called.ended.cause))).toMatchObject({
			why: "no_experiment",
		});
	});
});
