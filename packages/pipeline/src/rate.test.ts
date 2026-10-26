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
	type RatingRow,
	type Says,
	tallyOf,
	userRatings,
} from "./rate.ts";

// Rate on its own: findings, rating rows and what shipped go in; a count per
// rule and a mode come out. No engine, no ledger: a row's writer is plain text
// here, the way the ledger keeps it.

const enough = Schema.decodeUnknownSync(Enough);
const facts = (ratings: readonly RatingRow[], shipped: readonly string[] = []): Facts => ({
	ratings,
	shipped,
});
/** A rating in a row that `writer` wrote. */
const by =
	(writer: string) =>
	(finding: string, says: Says): RatingRow => ({writer, rating: {finding, says}});
const rated = by("user:owner");
const byAgent = by("agent:review");
const says = fc.constantFrom("fix" as const, "noise" as const);
const silence = fc.constantFrom("noise" as const, "open" as const);

describe("how one finding counts", () => {
	const f: Finding = {id: "f-1", rule: "scope"};

	it("counts as its rating, shipped or not, whatever silence means", () => {
		expect(countedAs(f, facts([rated("f-1", "fix")]), "noise")).toBe("fix");
		expect(countedAs(f, facts([rated("f-1", "fix")], ["f-1"]), "noise")).toBe("fix");
		expect(countedAs(f, facts([rated("f-1", "noise")], ["f-1"]), "open")).toBe("noise");
	});

	it("counts a check's finding as noise when never rated and its change shipped, and not yet while open", () => {
		expect(countedAs(f, facts([], ["f-1"]), "noise")).toBe("noise");
		expect(countedAs(f, facts([]), "noise")).toBeNull();
		expect(countedAs(f, facts([rated("f-2", "fix")]), "noise")).toBeNull();
	});

	it("keeps a finding never rated open, shipped or not, when silence is open", () => {
		expect(countedAs(f, facts([], ["f-1"]), "open")).toBeNull();
		expect(countedAs(f, facts([]), "open")).toBeNull();
	});

	it("takes the last rating when a person changes their mind", () => {
		expect(countedAs(f, facts([rated("f-1", "noise"), rated("f-1", "fix")]), "noise")).toBe("fix");
	});

	it("a finding whose last rating is fix never counts as noise, whatever shipped", () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({finding: fc.constantFrom("f-1", "f-2"), says})),
				fc.array(fc.constantFrom("f-1", "f-2")),
				silence,
				(earlier, shipped, s) => {
					const ratings = [...earlier.map((r) => rated(r.finding, r.says)), rated("f-1", "fix")];
					expect(countedAs(f, facts(ratings, shipped), s)).toBe("fix");
				},
			),
			{numRuns: 500, seed: 1},
		);
	});
});

describe("who wrote a rating", () => {
	const f: Finding = {id: "f-1", rule: "scope"};

	it("is the writer of its row: a rating does not say who wrote it", () => {
		// @ts-expect-error a rating has no `by`: who rated is the row's writer
		const said: Rating = {finding: "f-1", by: "owner", says: "noise"};
		expect(said.finding).toBe("f-1");
	});

	it("does not count a rating in a row an agent wrote: as if never rated", () => {
		expect(countedAs(f, facts([byAgent("f-1", "fix")]), "noise")).toBeNull();
		expect(countedAs(f, facts([byAgent("f-1", "fix")], ["f-1"]), "noise")).toBe("noise");
	});

	it.each(["ledger", "owner", "user:", "robot:owner", "User:owner", ""])(
		"does not count a rating in a row whose writer %j names neither a user nor an agent",
		(writer) => {
			expect(countedAs(f, facts([by(writer)("f-1", "fix")]), "noise")).toBeNull();
		},
	);

	it("lets a user's rating after an agent's win, and an agent's after a user's change nothing", () => {
		const agentThenUser = facts([byAgent("f-1", "fix"), rated("f-1", "noise")]);
		const userThenAgent = facts([rated("f-1", "noise"), byAgent("f-1", "fix")]);
		expect(countedAs(f, agentThenUser, "noise")).toBe("noise");
		expect(countedAs(f, userThenAgent, "noise")).toBe("noise");
	});

	it("hands on only users' ratings, each with the user its row names", () => {
		const rows = [
			byAgent("f-1", "fix"),
			by("user:second")("f-1", "noise"),
			by("ledger")("f-2", "fix"),
		];
		expect(userRatings(facts(rows))).toEqual([
			{by: {kind: "user", id: "second"}, rating: {finding: "f-1", says: "noise"}},
		]);
	});

	it("never changes a count for rows no user wrote, wherever they sit", () => {
		const users = ["user:owner", "user:second"];
		const writer = fc.constantFrom(...users, "agent:review", "agent:plan", "ledger", "owner");
		const finding = fc.record({
			id: fc.constantFrom("a", "b", "c"),
			rule: fc.constantFrom("scope", "survived"),
		});
		fc.assert(
			fc.property(
				fc.uniqueArray(finding, {selector: (f) => f.id}),
				fc.array(fc.record({writer, finding: fc.constantFrom("a", "b", "x"), says})),
				fc.array(fc.constantFrom("a", "c")),
				silence,
				(found, rows, shipped, s) => {
					const all = rows.map((r) => by(r.writer)(r.finding, r.says));
					const fromUsers = all.filter((r) => users.includes(r.writer));
					expect(tallyOf(found, facts(all, shipped), () => s)).toEqual(
						tallyOf(found, facts(fromUsers, shipped), () => s),
					);
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
		const tally = tallyOf(
			findings,
			facts([rated("a", "fix"), rated("d", "fix")], ["b"]),
			() => "noise",
		);
		expect(tally).toEqual({
			scope: {fix: 1, noise: 1, open: 1},
			survived: {fix: 1, noise: 0, open: 0},
		});
	});

	it("asks each rule what silence means: a shipped unrated finding is noise for one, open for another", () => {
		const found: readonly Finding[] = [
			{id: "a", rule: "scope"},
			{id: "n", rule: "test_writer/noise"},
		];
		const silenceOf = (rule: string) => (rule === "scope" ? "noise" : "open");
		expect(tallyOf(found, facts([], ["a", "n"]), silenceOf)).toEqual({
			scope: {fix: 0, noise: 1, open: 0},
			"test_writer/noise": {fix: 0, noise: 0, open: 1},
		});
	});

	// A rule's name is the check's word, so it may be a name every object has.
	it.each(["constructor", "toString", "__proto__"])(
		"counts a rule named %s from zero, under its own name",
		(rule) => {
			const tally = tallyOf(
				[
					{id: "a", rule},
					{id: "b", rule},
				],
				facts([rated("a", "fix")]),
				() => "open",
			);
			expect(Object.keys(tally)).toEqual([rule]);
			expect(Object.getPrototypeOf(tally)).toBe(Object.prototype);
			expect(Object.hasOwn(tally, rule) ? tally[rule] : null).toEqual({fix: 1, noise: 0, open: 1});
		},
	);

	it("counts every distinct finding exactly once", () => {
		const finding = fc.record({
			id: fc.constantFrom("a", "b", "c", "d", "e"),
			rule: fc.constantFrom("scope", "survived", "constructor", "__proto__"),
		});
		fc.assert(
			fc.property(
				fc.uniqueArray(finding, {selector: (f) => f.id}),
				fc.array(fc.record({finding: fc.constantFrom("a", "b", "x"), says})),
				fc.array(fc.constantFrom("a", "c", "e")),
				silence,
				(found, ratings, shipped, s) => {
					const tally = tallyOf(
						found,
						facts(
							ratings.map((r) => rated(r.finding, r.says)),
							shipped,
						),
						() => s,
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
