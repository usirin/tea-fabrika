import {call, Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Experiments, experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {experiments} from "./index.ts";

// experiments on a ledger in memory: two experiments, the second with one finished run.

describe("experiments", () => {
	it("sends one row per experiment, by number, then the list as markdown", async () => {
		const called = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* Experiments;
				yield* service.create("170", "The experiments program");
				yield* service.create("09", "An old one");
				const run = yield* service.start("170", {key: "test-1", params: {}, tags: {}, job: null});
				yield* service.log(run, [{kind: "metric", key: "agreed", value: 0.5}]);
				yield* service.end(run, {status: "finished", usd: 0.01, tokens: null});
				return yield* call(experiments, {});
			}).pipe(
				Effect.provide(
					experimentsOnLedger({kind: "agent", id: "test"}).pipe(
						Layer.provide(Layer.succeed(Ledger, memoryService())),
					),
				),
			),
		);
		if (called.kind !== "called") throw new Error(called.why);
		expect(called.ended.kind).toBe("ended");
		expect(
			called.heard.map((h) => (h.name === "row" ? [h.value.n, h.value.runs] : h.name)),
		).toEqual([["09", 0], ["170", 1], "markdown"]);
		const markdown = called.heard.at(-1)?.value;
		expect(typeof markdown === "string" && markdown.split("\n").filter((l) => l !== "")).toEqual([
			"# Experiments",
			"| # | Title | Date | Runs | Latest |",
			"|---|---|---|---|---|",
			"| 09 | An old one |  | 0 |  |",
			"| 170 | The experiments program |  | 1 | 170-1 finished, agreed 0.5 |",
		]);
	});
});
