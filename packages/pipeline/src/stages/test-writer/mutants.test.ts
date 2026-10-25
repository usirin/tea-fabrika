import {describe, expect, it} from "vitest";
import {
	killRan,
	kills,
	type MutantAnswer,
	NOISE_RULE,
	outcomeOf,
	ratedAs,
	startKills,
} from "./mutants.ts";

// The second job's code side: each mutant that lived gets `test`, `cannot`
// or `noise`, and code checks a `test` answer with both controls.

const test: MutantAnswer = {
	mutant: "jev.ts:82:32",
	answer: "test",
	test: "redaction keeps the rest of the body",
	file: "src/jev-redact.test.ts",
};
const cannot: MutantAnswer = {
	mutant: "machine.ts:620:9",
	answer: "cannot",
	why: "an empty outbox loops zero times",
};
const noise: MutantAnswer = {
	mutant: "jev.ts:105:13",
	answer: "noise",
	why: "a 200 body redacted too breaks no promise",
};

describe("answering the mutants that lived", () => {
	it("runs a `test` answer on the mutant and on the original, and is done when red on one and green on the other", () => {
		const [killing, cmds] = startKills("c1", [test]);
		expect(cmds).toEqual([
			kills.run({
				key: "jev.ts:82:32",
				side: "bad",
				on: {
					commit: "c1",
					file: test.file,
					test: "redaction keeps the rest of the body",
					mutant: "jev.ts:82:32",
				},
			}),
			kills.run({
				key: "jev.ts:82:32",
				side: "good",
				on: {
					commit: "c1",
					file: test.file,
					test: "redaction keeps the rest of the body",
					mutant: null,
				},
			}),
		]);
		const [bad, good] = cmds;
		if (bad === undefined || good === undefined) throw new Error("two runs");
		const half = killRan(killing, bad, "red");
		expect(outcomeOf([test], half)).toBeNull();
		expect(outcomeOf([test], killRan(half, good, "green"))).toEqual({
			kind: "done",
			part: false,
			findings: [],
		});
	});

	it("is stuck `not_killed` when the test misses the mutant or fails on the original", () => {
		const [killing, [bad, good]] = startKills("c1", [test]);
		if (bad === undefined || good === undefined) throw new Error("two runs");
		const missed = killRan(killRan(killing, bad, "green"), good, "green");
		expect(outcomeOf([test], missed)).toEqual({kind: "stuck", why: "not_killed"});
		const wrong = killRan(killRan(killing, bad, "red"), good, "red");
		expect(outcomeOf([test], wrong)).toEqual({kind: "stuck", why: "not_killed"});
		expect(outcomeOf([test], killRan(killing, bad, null))).toEqual({
			kind: "stuck",
			why: "run_failed",
		});
	});

	it("asks the owner about a disable comment for a `cannot`, and hands each `noise` on as a Finding", () => {
		expect(outcomeOf([cannot, noise], {})).toEqual({kind: "ask", who: "owner", for: "disable"});
		expect(outcomeOf([noise], {})).toEqual({
			kind: "done",
			part: false,
			findings: [{id: "jev.ts:105:13", rule: NOISE_RULE}],
		});
	});

	it("reads the owner's rating of a noise answer by Rate's count", () => {
		if (noise.answer !== "noise") throw new Error("noise");
		const none = {ratings: [], shipped: []};
		expect(ratedAs(noise, none)).toBe("open");
		expect(ratedAs(noise, {...none, shipped: [noise.mutant]})).toBe("lives");
		expect(
			ratedAs(noise, {ratings: [{finding: noise.mutant, by: "owner", says: "fix"}], shipped: []}),
		).toBe("write_test");
	});
});
