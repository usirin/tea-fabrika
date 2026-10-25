import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {pass} from "./combos.ts";
import {
	countedAs,
	Enough,
	type Facts,
	type Finding,
	gateRate,
	modeOf,
	type Rating,
	tallyOf,
} from "./rate.ts";

// Rate on its own: findings, ratings and what shipped go in; a count per rule
// and a mode come out. No engine, no ledger.

const enough = Schema.decodeUnknownSync(Enough);
const facts = (ratings: readonly Rating[], shipped: readonly string[] = []): Facts => ({
	ratings,
	shipped,
});
const rated = (finding: string, says: "fix" | "noise"): Rating => ({finding, by: "owner", says});

describe("how one finding counts", () => {
	const f: Finding = {id: "f-1", rule: "scope"};

	it("counts as its rating, shipped or not", () => {
		expect(countedAs(f, facts([rated("f-1", "fix")]))).toBe("fix");
		expect(countedAs(f, facts([rated("f-1", "fix")], ["f-1"]))).toBe("fix");
		expect(countedAs(f, facts([rated("f-1", "noise")]))).toBe("noise");
	});

	it("counts as noise when never rated and its change shipped, and not yet while open", () => {
		expect(countedAs(f, facts([], ["f-1"]))).toBe("noise");
		expect(countedAs(f, facts([]))).toBeNull();
		expect(countedAs(f, facts([rated("f-2", "fix")]))).toBeNull();
	});

	it("takes the last rating when a person changes their mind", () => {
		expect(countedAs(f, facts([rated("f-1", "noise"), rated("f-1", "fix")]))).toBe("fix");
	});

	it("takes a rating from a person only: an agent's role does not type", () => {
		// @ts-expect-error a rating by the reviewer agent is not a Rating
		const byAgent: Rating = {finding: "f-1", by: "review", says: "noise"};
		expect(byAgent.by).toBe("review");
	});

	it("a finding whose last rating is fix never counts as noise, whatever shipped", () => {
		const says = fc.constantFrom("fix" as const, "noise" as const);
		fc.assert(
			fc.property(
				fc.array(fc.record({finding: fc.constantFrom("f-1", "f-2"), says})),
				fc.array(fc.constantFrom("f-1", "f-2")),
				(earlier, shipped) => {
					const ratings = [...earlier.map((r) => rated(r.finding, r.says)), rated("f-1", "fix")];
					expect(countedAs(f, facts(ratings, shipped))).toBe("fix");
				},
			),
			{numRuns: 500, seed: 1},
		);
	});
});

describe("the count per rule", () => {
	const findings: readonly Finding[] = [
		{id: "a", rule: "scope"},
		{id: "b", rule: "scope"},
		{id: "c", rule: "scope"},
		{id: "d", rule: "survived"},
		{id: "a", rule: "scope"},
	];

	it("counts fix, noise and not yet for each rule, a finding listed twice once", () => {
		const tally = tallyOf(findings, facts([rated("a", "fix"), rated("d", "fix")], ["b"]));
		expect(tally).toEqual({
			scope: {fix: 1, noise: 1, open: 1},
			survived: {fix: 1, noise: 0, open: 0},
		});
	});

	it("counts every distinct finding exactly once", () => {
		const finding = fc.record({
			id: fc.constantFrom("a", "b", "c", "d", "e"),
			rule: fc.constantFrom("scope", "survived"),
		});
		fc.assert(
			fc.property(
				fc.uniqueArray(finding, {selector: (f) => f.id}),
				fc.array(
					fc.record({
						finding: fc.constantFrom("a", "b", "x"),
						says: fc.constantFrom("fix" as const, "noise" as const),
					}),
				),
				fc.array(fc.constantFrom("a", "c", "e")),
				(found, ratings, shipped) => {
					const tally = tallyOf(
						found,
						facts(
							ratings.map((r) => rated(r.finding, r.says)),
							shipped,
						),
					);
					const total = Object.values(tally).reduce((n, t) => n + t.fix + t.noise + t.open, 0);
					expect(total).toBe(found.length);
				},
			),
			{numRuns: 500, seed: 1},
		);
	});
});

describe("advise or block", () => {
	const three = enough(3);

	it("blocks with enough counted findings and no noise", () => {
		expect(modeOf({fix: 3, noise: 0, open: 0}, three)).toBe("block");
		expect(modeOf({fix: 30, noise: 0, open: 9}, three)).toBe("block");
	});

	it("advises with one noise, or too few counted, and open findings are not evidence", () => {
		expect(modeOf({fix: 30, noise: 1, open: 0}, three)).toBe("advise");
		expect(modeOf({fix: 2, noise: 0, open: 0}, three)).toBe("advise");
		expect(modeOf({fix: 2, noise: 0, open: 50}, three)).toBe("advise");
	});

	it("takes `enough` from the settings, as a whole number of at least 1", () => {
		expect(() => enough(0)).toThrow();
		expect(() => enough(2.5)).toThrow();
		// @ts-expect-error a bare number is not `enough`: it has to come through the settings' schema
		modeOf({fix: 1, noise: 0, open: 0}, 1);
	});

	it("gates on the findings of a rule that blocks, and lets an advising rule's pass", () => {
		const found: readonly Finding[] = [
			{id: "a", rule: "scope"},
			{id: "d", rule: "survived"},
			{id: "e", rule: "survived"},
		];
		const mode = (rule: string) => (rule === "survived" ? "block" : "advise");
		expect(gateRate(found, mode)).toEqual({
			pass: false,
			why: [
				{id: "d", rule: "survived"},
				{id: "e", rule: "survived"},
			],
		});
		expect(gateRate(found, () => "advise")).toBe(pass);
		expect(gateRate([], () => "block")).toBe(pass);
	});
});
