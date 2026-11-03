import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Tick, ticksOf} from "./ruler.ts";

// The ruler's ticks, as laws (ticket 141, plan section 4, L7 and L8). Today's version, shared by
// the job view and the ticket view.
//
// The plan names no list of round steps. What it does say, in its own example (`ticksOf(781_000)`:
// 0 and 5 min at rank 1, 1 min and 13 min at rank 3), fixes three things the examples below lean on:
// 5 min and 1 min are round, 4 min is not (it would give 4 ticks over 13 min, under 5 min), and 2.5
// min is not (it would be rank 2 there, and 1 min does not divide it). Nothing here needs 2 min,
// 10 min or 15 min to be round, or not.

const OPTS = {numRuns: 500, seed: 141};
const MIN = 60_000;

/** An axis: a few ms to a day. One lane runs under an hour on the tickets so far. */
const lengths = fc.oneof(
	fc.integer({min: 1, max: 10_000}),
	fc.integer({min: 10_000, max: 3 * 3_600_000}),
	fc.integer({min: 3 * 3_600_000, max: 24 * 3_600_000}),
);

/** The times of the ticks of rank `rank` or coarser. */
const upTo = (ticks: readonly Tick[], rank: 1 | 2 | 3): readonly number[] =>
	ticks.filter((t) => t.rank <= rank).map((t) => t.t);

/** The space between neighbors, the smallest. `Infinity` for one tick. */
const smallestGap = (ts: readonly number[]): number =>
	ts.slice(1).reduce((least, t, i) => Math.min(least, t - (ts[i] ?? 0)), Infinity);

/** The ruler width from which each rank shows: the plan's CSS thresholds. Rank 1 always shows. */
const SHOWN_FROM = {1: 240, 2: 480, 3: 960} as const;

describe("the ruler's ticks (L7, L8)", () => {
	it("L7: the first tick is 0 at rank 1, all are inside [0, length], in time order, each once", () => {
		fc.assert(
			fc.property(lengths, (length) => {
				const ticks = ticksOf(length);
				expect(ticks[0]).toEqual({t: 0, rank: 1});
				for (const tick of ticks) {
					expect(tick.t).toBeGreaterThanOrEqual(0);
					expect(tick.t).toBeLessThanOrEqual(length);
					expect([1, 2, 3]).toContain(tick.rank);
				}
				const ts = ticks.map((t) => t.t);
				expect(ts).toEqual(ts.toSorted((a, b) => a - b));
				expect(new Set(ts).size).toBe(ts.length);
			}),
			OPTS,
		);
	});

	it("L7: at most 4 ticks of rank 1, 8 of rank 2 or coarser, 16 in all", () => {
		fc.assert(
			fc.property(lengths, (length) => {
				const ticks = ticksOf(length);
				expect(upTo(ticks, 1).length).toBeLessThanOrEqual(4);
				expect(upTo(ticks, 2).length).toBeLessThanOrEqual(8);
				expect(upTo(ticks, 3).length).toBeLessThanOrEqual(16);
			}),
			OPTS,
		);
	});

	it("L7: each rank's ticks are one step apart from 0 to the end, and a finer step divides a coarser one", () => {
		fc.assert(
			fc.property(lengths, (length) => {
				const ticks = ticksOf(length);
				const steps: number[] = [];
				for (const rank of [1, 2, 3] as const) {
					const ts = upTo(ticks, rank);
					const step = ts.length > 1 ? (ts[1] ?? 0) - (ts[0] ?? 0) : null;
					if (step === null) continue;
					expect(step).toBeGreaterThan(0);
					// Every multiple of the step up to the end, and nothing else.
					const want = Array.from({length: Math.floor(length / step) + 1}, (_, k) => k * step);
					expect(ts).toEqual(want);
					steps.push(step);
				}
				// Each coarser step is a whole number of the next finer one.
				const remainders = steps.slice(1).map((step, i) => (steps[i] ?? step) % step);
				expect(remainders.every((r) => r === 0)).toBe(true);
			}),
			OPTS,
		);
	});

	it("L8: labels never meet: each rank shown at its ruler width leaves 60 px between neighbors", () => {
		fc.assert(
			fc.property(
				lengths,
				fc.constantFrom(1, 2, 3),
				fc.integer({min: 0, max: 2_000}),
				(length, rank, wider) => {
					const width = SHOWN_FROM[rank] + wider;
					const gap = smallestGap(upTo(ticksOf(length), rank));
					expect((gap / length) * width).toBeGreaterThanOrEqual(60);
				},
			),
			OPTS,
		);
	});
});

describe("the ruler's ticks, by example", () => {
	it("13 min 1 s: 0, 5 and 10 min at rank 1, every minute at rank 3 (the plan's own example)", () => {
		const ticks = ticksOf(781_000);
		expect(upTo(ticks, 1)).toEqual([0, 5 * MIN, 10 * MIN]);
		expect(upTo(ticks, 3)).toEqual(Array.from({length: 14}, (_, k) => k * MIN));
		expect(ticks.find((t) => t.t === 13 * MIN)?.rank).toBe(3);
	});

	it("15 min: four ticks at rank 1 (the `<= 4` is a `<=`)", () => {
		expect(upTo(ticksOf(15 * MIN), 1)).toEqual([0, 5 * MIN, 10 * MIN, 15 * MIN]);
	});

	it("15 min: sixteen ticks in all, every minute (the `<= 16` is a `<=`)", () => {
		expect(upTo(ticksOf(15 * MIN), 3)).toEqual(Array.from({length: 16}, (_, k) => k * MIN));
	});

	it("35 min: eight ticks of rank 2 or coarser, every 5 min (the `<= 8` is a `<=`)", () => {
		expect(upTo(ticksOf(35 * MIN), 2)).toEqual(Array.from({length: 8}, (_, k) => k * 5 * MIN));
	});
});
