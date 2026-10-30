import {Ledger} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {Experiments, experimentsOnLedger} from "./experiments.ts";
import {load, transform} from "./import.ts";

const index = [
	"| # | Title | Script(s) | Date | Result |",
	"|---|---|---|---|---|",
	"| 01 | [A](./01-a.md) | `01-a.ts`, `results/shared.json` | 2026-10-01 | Yes, a \\| b. |",
	"| 02 | [B](./02-b.md) | `02-b.ts` | 2026-10-02 | No. |",
].join("\n");

const files = {
	index,
	writeUps: [
		{name: "01-a.md", text: "# 01. The first one\n\nLead.\n\n## How\n\nLike this.\n"},
		{name: "02-b.md", text: "no heading here\n"},
		{name: "notes.md", text: "# Not an experiment\n"},
	],
	results: [
		{
			name: "01-a.json",
			text: JSON.stringify({
				agreed: 0.5,
				totalUsd: 0.25,
				tokens: {input: 10, output: 4},
				cases: [
					{id: "t-1", score: 1},
					{id: "t-2", score: 0},
				],
			}),
		},
		{name: "shared.json", text: JSON.stringify({agreed: 0.75})},
		{name: "written.json", text: JSON.stringify({agreed: 1})},
		{name: "nowhere.json", text: JSON.stringify({agreed: 1})},
		{name: "02-words.json", text: JSON.stringify({says: "no numbers"})},
		{name: "02-broken.json", text: "{"},
	],
	scripts: [
		{name: "02-b.ts", text: 'write("results/written.json")'},
		{name: "09-later.ts", text: 'read("results/written.json")'},
	],
};

describe("transform", () => {
	it("reads write-ups, places results files and counts every guess", () => {
		const old = transform(files);
		expect(old.experiments.map((e) => [e.n, e.title, e.writeUp?.date, e.writeUp?.answer])).toEqual([
			["01", "The first one", "2026-10-01", "Yes, a | b."],
			// No `# ` line: the title comes from the file's name.
			["02", "b", "2026-10-02", "No."],
		]);
		expect(old.experiments[0]?.writeUp?.sections).toEqual([
			{heading: "", text: "Lead."},
			{heading: "How", text: "Like this."},
		]);
		// 01-a by its number, shared by the README, written by the lowest script that names it.
		expect(old.runs.map((r) => [r.n, r.plan.tags.source])).toEqual([
			["01", "experiments/results/01-a.json"],
			["01", "experiments/results/shared.json"],
			["02", "experiments/results/written.json"],
		]);
		expect(old.runs[0]?.end).toEqual({
			status: "finished",
			usd: 0.25,
			tokens: {input: 10, output: 4},
		});
		expect(old.runs[0]?.logs.filter((l) => l.kind === "case").map((l) => l.item)).toEqual([
			"t-1",
			"t-2",
		]);
		expect(old.counts).toMatchObject({
			writeUps: 2,
			experiments: 2,
			titleFromName: 1,
			results: 6,
			notJson: 1,
			placedByIndex: 1,
			placedByScript: 1,
			manyScripts: 1,
			unplaced: 1,
			fit: 3,
			noNumbers: 1,
			withUsd: 1,
			withTokens: 1,
			costNames: {totalUsd: 1},
		});
	});
});

describe("load", () => {
	it("writes the import through the service; a second load writes nothing", async () => {
		const ledger = memoryService();
		const layer = experimentsOnLedger({kind: "agent", id: "import"}).pipe(
			Layer.provide(Layer.succeed(Ledger, ledger)),
		);
		const old = transform(files);
		const rows = ledger.read(0, 10_000, "experiments");
		const [listed, runs, first, again, second] = await Effect.runPromise(
			Effect.gen(function* () {
				const experiments = yield* Experiments;
				yield* load(old);
				const listed = yield* experiments.list();
				const runs = yield* experiments.runs("01");
				const first = yield* rows;
				yield* load(old);
				return [listed, runs, first, yield* experiments.list(), yield* rows] as const;
			}).pipe(Effect.provide(layer)),
		);
		expect(listed.map((e) => [e.n, e.runs])).toEqual([
			["01", 2],
			["02", 1],
		]);
		expect(runs.map((r) => [r.run, r.key, r.status, r.usd, r.metrics.agreed])).toEqual([
			["01-1", "import/experiments/results/01-a.json", "finished", 0.25, 0.5],
			["01-2", "import/experiments/results/shared.json", "finished", null, 0.75],
		]);
		// Every write and every start sent again is the ledger's `dup`: the same list, no new row.
		expect(again).toEqual(listed);
		expect(second).toEqual(first);
	});
});
