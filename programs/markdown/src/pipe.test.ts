import {Ledger, listed, Shell} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {compare} from "@tea-fabrika/compare";
import {experiment} from "@tea-fabrika/experiment";
import {experiments} from "@tea-fabrika/experiments";
import {Layer} from "effect";
import {describe, expect, it} from "vitest";
import {markdown} from "./index.ts";

// `experiment --n 170 | markdown`, as tsh checks a line: each experiments program has one output
// that is text, and markdown one input that takes it, so the pipe needs no names. Checked only:
// nothing runs.

const read = experimentsOnLedger({kind: "agent", id: "test"}).pipe(
	Layer.provide(Layer.succeed(Ledger, memoryService())),
);
const list = Shell.programList([
	listed(experiments, read),
	listed(experiment, read),
	listed(compare, read),
	listed(markdown, Layer.empty),
]);

const wires = (line: string) => {
	const parsed = Shell.parse(line);
	if (parsed.kind !== "parsed") throw new Error(`parse refused: ${parsed.why}`);
	const [first] = parsed.statements;
	if (first?.kind !== "run") throw new Error("not a run");
	const checked = Shell.check(first.pipeline, list, line);
	if (checked.kind !== "line") throw new Error(`refused: ${JSON.stringify(checked)}`);
	return checked.line.stages.map((s) => s.wire);
};

describe("a pipe into markdown", () => {
	it.each([
		"experiments | markdown",
		"experiment --n 170 | markdown",
		"compare --n 170 | markdown",
	])("%s wires the markdown output into its text input", (line) => {
		expect(wires(line)).toEqual([{output: "markdown", input: "text"}, null]);
	});
});
