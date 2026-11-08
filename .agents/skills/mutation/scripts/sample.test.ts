import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {sample} from "./sample.ts";

// Today's tooling. This is the selector's contract; the CLI gathers candidates with the real
// Instrumenter and changed lines with git. Stryker's CLI proof belongs to the mutation step.
// sample({candidates, changed, seed, max}) returns the plan's Sample report.
// Candidates use Stryker's fileName/location shape; changed is [{file, line}].
type Position = {line: number; column: number};
type Candidate = {
	id: string;
	fileName: string;
	mutatorName: string;
	replacement: string;
	location: {start: Position; end: Position};
};
type Changed = {file: string; line: number};
type Report = {
	seed: number;
	ranges: readonly string[];
	total: number;
	selected: number;
	left: number;
};
const options = {seed: 520, numRuns: 100};
const position = (a: Position, b: Position) => a.line - b.line || a.column - b.column;
// This is Stryker's documented file:startLine[:startColumn]-endLine[:endColumn] grammar.
const enclosed = (range: string, candidate: Candidate) => {
	const match = /^(.*):(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/.exec(range);
	expect(match, `invalid Stryker range: ${range}`).not.toBeNull();
	if (!match) throw new Error("invalid range");
	const [, file, startLine, startColumn, endLine, endColumn] = match;
	return (
		file === candidate.fileName &&
		position(candidate.location.start, {
			line: Number(startLine),
			column: Number(startColumn ?? 0),
		}) >= 0 &&
		position(candidate.location.end, {
			line: Number(endLine),
			column: Number(endColumn ?? Number.MAX_SAFE_INTEGER),
		}) <= 0
	);
};
const isChanged = (candidate: Candidate, changed: Changed[]) =>
	changed.some(
		(c) =>
			c.file === candidate.fileName &&
			c.line >= candidate.location.start.line &&
			c.line <= candidate.location.end.line,
	);
const checkReport = (
	report: Report,
	candidates: Candidate[],
	changed: Changed[],
	seed: number,
	max: number,
) => {
	const eligible = candidates.filter((c) => isChanged(c, changed));
	const selected = candidates.filter((c) => report.ranges.some((r) => enclosed(r, c)));
	expect(report.seed).toBe(seed);
	expect(report.total).toBe(eligible.length);
	expect(report.selected).toBe(selected.length);
	expect(report.selected).toBeLessThanOrEqual(Math.min(max, 150));
	expect(report.left).toBe(report.total - report.selected);
	expect(report.left).toBeGreaterThanOrEqual(0);
	expect(selected.every((c) => isChanged(c, changed))).toBe(true);
	expect(new Set(report.ranges).size).toBe(report.ranges.length);
	for (const range of report.ranges) expect(selected.some((c) => enclosed(range, c))).toBe(true);
	return selected;
};
const candidate = (
	id: number,
	file: string,
	line: number,
	start: number,
	end: number,
): Candidate => ({
	id: String(id),
	fileName: file,
	mutatorName: "EqualityOperator",
	replacement: `replacement${id}`,
	location: {start: {line, column: start}, end: {line, column: end}},
});
const pool = fc.array(
	fc.record({
		file: fc.constantFrom("src/a.ts", "src/b.ts", "src/c.tsx"),
		line: fc.integer({min: 1, max: 8}),
		start: fc.integer({min: 0, max: 5}),
		width: fc.integer({min: 1, max: 6}),
		changed: fc.boolean(),
	}),
	{minLength: 0, maxLength: 180},
);

describe("mutation sampling, today's tooling", () => {
	// Plants: ignore the seed, include unchanged lines, or allow more than the cap.
	it("sampling is repeatable, changed-only and bounded", () => {
		fc.assert(
			fc.property(pool, fc.integer(), fc.integer({min: 0, max: 180}), (rows, seed, max) => {
				const candidates = rows.map((r, i) =>
					candidate(i, r.file, r.line, r.start, r.start + r.width),
				);
				const changed = rows.filter((r) => r.changed).map((r) => ({file: r.file, line: r.line}));
				const input = {candidates, changed, seed, max};
				const before = structuredClone(input);
				const report: Report = sample(input);
				checkReport(report, candidates, changed, seed, max);
				expect(sample(input)).toEqual(report);
				expect(
					sample({
						...input,
						candidates: [...candidates].reverse(),
						changed: [...changed].reverse(),
					}),
				).toEqual(report);
				expect(input).toEqual(before);
				if (max === 0 || !changed.length) expect(report.ranges).toEqual([]);
			}),
			options,
		);

		// Disjoint single-mutant ranges must fill the budget, covering different changed lines
		// before taking a second mutant from one line. This also rules out an always-empty sample.
		fc.assert(
			fc.property(fc.integer({min: 2, max: 12}), fc.integer(), (lines, seed) => {
				const candidates = Array.from({length: lines * 2}, (_, i) =>
					candidate(i, "src/a.ts", 1 + Math.floor(i / 2), (i % 2) * 10, (i % 2) * 10 + 1),
				);
				const changed = Array.from({length: lines}, (_, i) => ({file: "src/a.ts", line: i + 1}));
				const report: Report = sample({candidates, changed, seed, max: lines});
				const selected = checkReport(report, candidates, changed, seed, lines);
				expect(selected).toHaveLength(lines);
				expect(new Set(selected.map((c) => c.location.start.line)).size).toBe(lines);
				const full: Report = sample({candidates, changed, seed, max: candidates.length});
				expect(checkReport(full, candidates, changed, seed, candidates.length)).toHaveLength(
					candidates.length,
				);
			}),
			options,
		);

		// A seeded sample must offer a choice when the pool has many disjoint choices on one line.
		fc.assert(
			fc.property(fc.integer({min: 4, max: 16}), fc.integer({min: 1, max: 50}), (n, line) => {
				const candidates = Array.from({length: n}, (_, i) =>
					candidate(i, "src/a.ts", line, i * 3, i * 3 + 1),
				);
				const changed = [{file: "src/a.ts", line}];
				const choices = new Set(
					Array.from({length: 32}, (_, seed) => {
						const report: Report = sample({candidates, changed, seed, max: 1});
						expect(checkReport(report, candidates, changed, seed, 1)).toHaveLength(1);
						return JSON.stringify(report.ranges);
					}),
				);
				expect(choices.size).toBeGreaterThan(1);
			}),
			{...options, numRuns: 20},
		);
	});

	// Plant: charge only the outer candidate, ignoring mutants its range pulls in.
	it("a range's enclosed and equal-location mutants count toward the cap", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({min: 1, max: 12}), {minLength: 2, maxLength: 12}),
				fc.integer(),
				fc.integer({min: 0, max: 15}),
				(widths, seed, max) => {
					expect.hasAssertions();
					// Every location is nested at the same start. Equal widths create equal locations
					// with different replacements, so they remain different mutant identities.
					const candidates = widths.map((width, i) => candidate(i, "src/nested.ts", 3, 0, width));
					const changed = [{file: "src/nested.ts", line: 3}];
					const report: Report = sample({candidates, changed, seed, max});
					const selected = checkReport(report, candidates, changed, seed, max);
					const least = Math.min(...widths);
					const cost = widths.filter((w) => w === least).length;
					if (max < cost) expect(selected).toHaveLength(0);
					else expect(selected.length).toBeGreaterThanOrEqual(cost);
					if (max >= widths.length) expect(selected).toHaveLength(widths.length);
				},
			),
			options,
		);
	});
});
