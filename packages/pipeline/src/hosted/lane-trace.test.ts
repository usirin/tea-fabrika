import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {LIMIT_MS, traceCase, type Variant} from "./lane-ends.ts";
import {driveCase, isLaneStep, type Script, type Step, stepsOf} from "./lane-trace.ts";

// A hosted lane's ledger log read as the steps of experiment 139's spec, and a run driven down
// one path of it. TLC itself is in experiments/139-tla-trace-validation.ts only, so this suite
// needs no Java.

const acts = (steps: readonly Step[]) => steps.map((s) => `${s.act}(${s.k})`);
const laneMoves = (steps: readonly Step[]) => acts(steps.filter((s) => isLaneStep(s.act)));

const traced = (variant: Variant) =>
	Effect.runPromise(
		traceCase({endings: ["row_done", "no_row"], variant, limitMs: LIMIT_MS, settle: true}),
	).then((r) => stepsOf(r.log, 3));

describe("a hosted lane's log, as the spec's steps", () => {
	it("the fixed lane: a done row goes on, an exit with no row ends it, then the lane exits", async () => {
		const steps = await traced("fixed");
		expect(acts(steps)).toEqual([
			"Start(1)",
			"WriteRow(1)",
			"End(1)",
			"Deliver(1)",
			"SeeRow(1)",
			"Start(2)",
			"End(2)",
			"Deliver(2)",
			"SeeExit(2)",
			"Exit(2)",
		]);
		expect(steps.at(-1)?.to).toEqual({
			lane: "gone",
			cur: 2,
			proc: ["down", "down", "none"],
			row: ["done", "none", "none"],
			exit: [true, true, false],
			seen: [true, true, false],
		});
	});

	it("today's lane: the EXIT comes and the lane never takes it", async () => {
		const steps = await traced("today");
		expect(acts(steps).slice(-3)).toEqual(["Start(2)", "End(2)", "Deliver(2)"]);
		expect(steps.at(-1)?.to.lane).toBe("running");
	});
});

describe("a run driven down one path of the spec", () => {
	// Child 1 writes done and exits; child 2 exits with no row.
	const script: Script = {
		pushes: [
			{act: "WriteRow", k: 1, kind: "done", after: 1},
			{act: "End", k: 1, after: 1},
			{act: "End", k: 2, after: 3},
		],
		laneSteps: 5,
	};

	it("the fixed lane makes the path's moves", async () => {
		const r = await Effect.runPromise(driveCase({variant: "fixed", script, n: 3}));
		expect(r.stalled).toBeNull();
		expect(laneMoves(r.steps)).toEqual([
			"Start(1)",
			"SeeRow(1)",
			"Start(2)",
			"SeeExit(2)",
			"Exit(2)",
		]);
	});

	it("today's lane stalls where the path takes the EXIT", async () => {
		const r = await Effect.runPromise(driveCase({variant: "today", script, n: 3}));
		expect(r.stalled).toEqual({before: 3, wanted: 5, had: 3});
	});
});
