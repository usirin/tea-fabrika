import {call, Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {dayLabel, dayOf, type Experiment} from "@kampus/pipeline/experiments/experiment";
import {Experiments, experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {experiments} from "./index.ts";

// experiments on a ledger in memory: two experiments, the second with one finished run.

describe("experiments", () => {
	it("sends one row per experiment, newest first, then the list as markdown", async () => {
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
		).toEqual([["170", 1], ["09", 0], "markdown"]);
		const markdown = called.heard.at(-1)?.value;
		expect(typeof markdown === "string" && markdown.split("\n").filter((l) => l !== "")).toEqual([
			"# Experiments",
			"2 experiments, newest first.",
			"| # | Title | Runs | Latest | Date |",
			"|---|---|--:|---|---|",
			"| 170 | The experiments program | 1 | 170-1 finished, agreed 0.5 |  |",
			"| 09 | An old one | 0 |  |  |",
		]);
	});

	describe("a row, as tsh shows it to a person", () => {
		const person = experiments.outputs.row.person;
		const view = typeof person === "object" && "table" in person ? person.table : undefined;
		const row = (latest: Experiment["latest"], runs = 2): Experiment => ({
			n: "170",
			title: "The experiments program",
			date: "2026-10-30",
			runs,
			latest,
		});
		const run = (status: "running" | "finished" | "failed" | "killed") => ({
			run: "170.ed1e1dcf9719" as const,
			label: "170-2" as const,
			at: 1793382842000,
			status,
			headline: null,
		});
		const cells = (r: Experiment) => view?.columns.map((c) => c.cell(r));

		it("is a table of #, title, runs and day, cut on the title", () => {
			expect(view?.columns.map((c) => c.header)).toEqual(["#", "Title", "Runs", "Updated"]);
			expect(view?.cut).toBe("Title");
			expect(cells(row(run("finished")))).toEqual([
				"170",
				"The experiments program",
				"2",
				dayLabel("2026-10-30", dayOf(Date.now())),
			]);
		});

		it("says a run that is not over, or did not end well, in the runs cell", () => {
			expect(cells(row(run("running")))?.[2]).toEqual({text: "running 2", tone: "accent"});
			expect(cells(row(run("failed")))?.[2]).toEqual({text: "failed 2", tone: "warning"});
			expect(cells(row(run("killed")))?.[2]).toEqual({text: "killed 2", tone: "warning"});
			expect(cells(row(null, 0))?.[2]).toEqual({text: "0", tone: "faint"});
		});

		it("says what to type to read the first row", () => {
			expect(view?.next?.(row(null))).toEqual([
				{line: "experiment --n 170 | markdown", for: "to read one"},
			]);
		});

		it("prints the markdown only into a pipe or a window", () => {
			expect(experiments.outputs.markdown.person).toBe("none");
		});
	});
});
