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
			"2 experiments, by number.",
			"| # | Title | Runs | Latest | Date |",
			"|---|---|--:|---|---|",
			"| 09 | An old one | 0 |  |  |",
			"| 170 | The experiments program | 1 | 170-1 finished, agreed 0.5 |  |",
		]);
	});

	it("prints a row in tsh as one line in columns, a human day in place of a raw time", () => {
		const row = {
			n: "170",
			title: "The experiments program, on today's ledger, with a title too long for its column",
			date: "2026-10-30",
			runs: 1,
			latest: {
				run: "170.ed1e1dcf9719",
				label: "170-1",
				at: 1793382842000,
				status: "finished",
				headline: {key: "agreed", value: 0.5},
			},
		} as const;
		const line = experiments.outputs.row.line;
		if (line === undefined) throw new Error("row has no line");
		const printed = line(row);
		expect(printed).toMatch(/^170 {3}The experiments program, on today's ledger,… {2}/);
		expect(printed).toMatch(/ 1 run {3}170-1 finished, agreed 0\.5$/);
		expect(printed).not.toContain("1793382842000");
	});
});
