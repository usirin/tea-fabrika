import {Arbitrary, Effect} from "effect";
import {describe, expect, it} from "vitest";
import {LIMIT_MS, laneEnds, rowsRead, runCase} from "./lane-ends.ts";

// The hosted lane on the real host and the in-memory ledger, its children stand-ins that write a
// row or not (experiment 116). Today's lane breaks the law on a child that ends with no row; that
// run is in experiments/116-established-checkers.ts only, so this suite stays green. Here: the
// fixed lane keeps the law on every ending, and today's lane keeps it when every child writes its
// row, which is what it assumes.

const failure = (r: Arbitrary.CheckResult<unknown, unknown>) => Arbitrary.formatCheckFailure(r);

describe("the hosted lane ends once its children have ended", () => {
	it("the fixed lane: on any endings, rows or none, and it reads every row there is", async () => {
		const r = await Effect.runPromise(
			laneEnds("fixed", {rows: true, check: {runs: 60, seed: 116}}),
		);
		expect(failure(r)).toBeUndefined();
	});

	it("today's lane, when every child writes its row first", async () => {
		const r = await Effect.runPromise(
			laneEnds("today", {kinds: ["row_done", "row_stuck"], check: {runs: 60, seed: 116}}),
		);
		expect(failure(r)).toBeUndefined();
	});

	it("rowsRead says no when a child that wrote its row is reported with no outcome", () => {
		const children = [{name: "k1", ending: "row_done" as const}];
		const outcome = (problems: readonly string[]) => ({report: {problems}});
		expect(rowsRead({ended: true, outcome: outcome(["k1: no_outcome"]), children, ms: 0})).toBe(
			false,
		);
		expect(rowsRead({ended: true, outcome: outcome(["k1: planted"]), children, ms: 0})).toBe(true);
	});

	it("the fixed lane ends a child with no row as stuck: no_outcome", async () => {
		const seen = await Effect.runPromise(
			runCase({endings: ["row_done", "no_row"], variant: "fixed", limitMs: LIMIT_MS}),
		);
		expect(seen.ended).toBe(true);
		expect(seen.outcome).toMatchObject({
			outcome: {kind: "stuck", why: "build_failed"},
			report: {problems: [`${seen.children[1]?.name}: no_outcome`]},
		});
	});
});
