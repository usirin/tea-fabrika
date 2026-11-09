import {readdirSync, statSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {BaseSequencer, createVitest} from "vitest/node";
import {assign, measured, Shards} from "./vitest.shards.ts";

// T342, today's sharding. Covers assign and the measured table. Plants: drop a file,
// restore equal-count assignment, or discard measured script times.
it("generated sharding assigns once, ignores input order and balances measured seconds", () => {
	fc.assert(
		fc.property(
			fc.uniqueArray(
				fc.record({path: fc.string({minLength: 1}), seconds: fc.integer({min: 1, max: 500})}),
				{selector: (f) => f.path, minLength: 1, maxLength: 40},
			),
			fc.integer({min: 1, max: 12}),
			(files, count) => {
				const machines = assign(files, count);
				expect(machines).toHaveLength(files.length);
				expect(machines.every((m) => m >= 0 && m < count && Number.isInteger(m))).toBe(true);
				const first = Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));
				const reversed = files.toReversed();
				expect(
					Object.fromEntries(reversed.map((f, i) => [f.path, assign(reversed, count)[i]])),
				).toEqual(first);
				const load = Array.from({length: count}, (_, m) =>
					files.reduce((sum, f, i) => sum + (machines[i] === m ? f.seconds : 0), 0),
				);
				expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(
					Math.max(...files.map((f) => f.seconds)),
				);
			},
		),
		{seed: 119120, numRuns: 100},
	);
});

it("vector: plan-supplied real CI measurements include the previously unweighted scripts", () => {
	// Fixed measurements, not invented timing limits. Run 42579837468, from the approved plan.
	expect(measured[".agents/skills/plan/scripts/plancheck.test.ts"]).toBe(53.9);
	expect(measured[".agents/skills/lead/scripts/catchup.test.ts"]).toBe(39.3);
	expect(measured["apps/fabrika/src/bundles.test.ts"]).toBe(3.2);
	expect(measured["packages/pipeline/src/laws/standard.test.ts"]).toBe(3.4);
});

// How the check's test machines split the test files: each gets about the same seconds, not the
// same count of files.

/** Twelve lane files of about two minutes each, and 300 files of a second. Made up. */
const HEAVY = Array.from({length: 12}, (_, i) => ({path: `lane.${i}.test.ts`, seconds: 115 + i}));
const LIGHT = Array.from({length: 300}, (_, i) => ({path: `small.${i}.test.ts`, seconds: 1}));

const ROOT = dirname(fileURLToPath(import.meta.url));
const LANES = "packages/pipeline/src/stages/pipeline";

/** How many files each of `count` machines got. */
const perMachine = (machines: readonly number[], count: number) =>
	Array.from({length: count}, (_, m) => machines.filter((at) => at === m).length);

/** Each path's machine. */
const byPath = (files: readonly {path: string}[], machines: readonly number[]) =>
	Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));

describe("assign", () => {
	it("puts two of twelve heavy files on each of six machines, among 300 light ones", () => {
		const machines = assign([...HEAVY, ...LIGHT], 6);
		expect(machines).toHaveLength(312);
		expect(perMachine(machines.slice(0, 12), 6)).toEqual([2, 2, 2, 2, 2, 2]);
		expect(machines.every((m) => m >= 0 && m < 6)).toBe(true);
	});

	it("gives each machine at most one file when there are fewer files than machines", () => {
		const machines = assign(HEAVY.slice(0, 3), 6);
		expect(machines).toHaveLength(3);
		expect(Math.max(...perMachine(machines, 6))).toBe(1);
	});

	it("gives each path the same machine, in whatever order the files come", () => {
		const files = [...HEAVY, ...LIGHT];
		const first = byPath(files, assign(files, 6));
		const reversed = files.toReversed();
		const interleaved = [
			...files.filter((_, i) => i % 2 === 1),
			...files.filter((_, i) => i % 2 === 0),
		];
		expect(byPath(reversed, assign(reversed, 6))).toEqual(first);
		expect(byPath(interleaved, assign(interleaved, 6))).toEqual(first);
	});

	it("places the heaviest file first, and two as heavy by their paths", () => {
		// Each goes to the machine with the least so far; of empty machines, the first.
		const files = [
			{path: "b.test.ts", seconds: 10},
			{path: "a.test.ts", seconds: 10},
			{path: "c.test.ts", seconds: 30},
		];
		expect(assign(files, 3)).toEqual([2, 1, 0]);
	});

	it("gives files of equal seconds their machines by path alone, whatever their order", () => {
		const files = ["d", "b", "e", "a", "c"].map((name) => ({path: `${name}.test.ts`, seconds: 5}));
		const want = {"a.test.ts": 0, "b.test.ts": 1, "c.test.ts": 2, "d.test.ts": 3, "e.test.ts": 4};
		expect(byPath(files, assign(files, 5))).toEqual(want);
		const sorted = files.toSorted((x, y) => (x.path < y.path ? -1 : 1));
		expect(byPath(sorted, assign(sorted, 5))).toEqual(want);
		expect(byPath(sorted.toReversed(), assign(sorted.toReversed(), 5))).toEqual(want);
	});
});

describe("measured", () => {
	it("names only files that are in the repo, so a renamed file cannot quietly count 1", () => {
		const keys = Object.keys(measured);
		expect(keys.length).toBeGreaterThan(0);
		const isFile = (path: string) =>
			statSync(join(ROOT, path), {throwIfNoEntry: false})?.isFile() === true;
		expect(keys.filter((path) => !isFile(path))).toEqual([]);
	});
});

describe("Shards", () => {
	it("is vitest's own sequencer with only its sharding changed: vitest's sort is kept", () => {
		expect(Object.getPrototypeOf(Shards.prototype)).toBe(BaseSequencer.prototype);
		expect(Object.hasOwn(Shards.prototype, "shard")).toBe(true);
		expect(Shards.prototype.sort).toBe(BaseSequencer.prototype.sort);
	});

	it("over `--shard k/6`, keeps each lane file on one machine, and every machine's seconds within the heaviest file of every other's", async () => {
		const lanes = readdirSync(join(ROOT, LANES))
			.filter((name) => /^lane\..*\.test\.ts$/.test(name))
			.map((name) => `${LANES}/${name}`);
		const kept: string[][] = [];
		for (const index of [1, 2, 3, 4, 5, 6]) {
			// This repo's config, as `vitest run --shard k/6` reads it; nothing runs.
			const vitest = await createVitest("test", {root: ROOT, watch: false, shard: `${index}/6`});
			try {
				const specs = await vitest.globTestSpecifications();
				const Sequencer = vitest.config.sequence.sequencer;
				const mine = await new Sequencer(vitest).shard(specs);
				kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
			} finally {
				await vitest.close();
			}
		}
		expect(
			kept
				.flat()
				.filter((p) => lanes.includes(p))
				.toSorted(),
		).toEqual(lanes.toSorted());
		const seconds = kept.map((paths) => paths.reduce((sum, p) => sum + (measured[p] ?? 1), 0));
		const heaviest = Math.max(...Object.values(measured));
		expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThanOrEqual(heaviest);
	});
});
