import {Exit} from "effect";
import {describe, expect, it} from "vitest";
import {type Facts, judge, type Ran} from "./judge.ts";
import {decodeEntry, type Entry} from "./record.ts";

const PIECE = "src/ship.ts#createShip";
const LAW = "src/laws.ts";

const entry: Entry = {
	promise: "An ended run sends nothing.",
	harm: "A run could merge twice.",
	tool: "search",
	check: 'node check.ts ship "an ended run sends nothing"',
	plant: {name: "actsAfterTheEnd", what: "A restart after the end reads again."},
	covers: [PIECE],
	exam: [LAW],
	confirmed: {commit: "c1", prints: {[PIECE]: "p1", [LAW]: "l1"}},
};

const verdict = (held: boolean, plant: string | null): Ran => ({
	kind: "verdict",
	verdict: {
		held,
		checked: "an ended run sends nothing",
		plant,
		bound: "8 messages",
		path: held ? [] : ["1. start"],
		why: held ? null : "sent after the end",
	},
	ms: 1,
});

const facts = (patch: Partial<Facts> = {}): Facts => ({
	id: "ship",
	entry,
	before: entry,
	now: {[PIECE]: "p1", [LAW]: "l1"},
	check: verdict(true, null),
	plant: verdict(false, "actsAfterTheEnd"),
	...patch,
});

const whys = (f: Facts) => judge(f).problems.map((p) => p.why);

describe("judge", () => {
	it("green: in step, the check held, the plant was caught", () => {
		const j = judge(facts());
		expect({green: j.green, exam: j.exam, moved: j.moved}).toEqual({
			green: true,
			exam: [],
			moved: false,
		});
	});

	it("covered code that changed and a record that did not: stale", () => {
		expect(judge(facts({now: {[PIECE]: "p2", [LAW]: "l1"}})).problems).toEqual([
			{why: "stale", pieces: [PIECE], commit: "c1"},
		]);
	});

	it("a block that is gone is named as gone, not as stale", () => {
		expect(whys(facts({now: {[PIECE]: null, [LAW]: "l1"}}))).toEqual(["gone"]);
	});

	it("a check that broke is red, whatever the record says", () => {
		expect(whys(facts({check: verdict(false, null)}))).toEqual(["red"]);
	});

	it("a plant that is not caught means the check cannot fail", () => {
		expect(whys(facts({plant: verdict(true, "actsAfterTheEnd")}))).toEqual(["not_caught"]);
	});

	it("a plant command that ran something else, or nothing, is no verdict", () => {
		expect(whys(facts({plant: verdict(false, null)}))).toEqual(["no_verdict"]);
		expect(whys(facts({plant: {kind: "none", why: "exit 2", ms: 1}}))).toEqual(["no_verdict"]);
		expect(whys(facts({check: verdict(true, "actsAfterTheEnd")}))).toEqual(["no_verdict"]);
	});

	it("covered code confirmed again: green, moved, and no exam change", () => {
		const after: Entry = {
			...entry,
			confirmed: {commit: "c2", prints: {[PIECE]: "p2", [LAW]: "l1"}},
		};
		const j = judge(facts({entry: after, now: {[PIECE]: "p2", [LAW]: "l1"}}));
		expect({green: j.green, moved: j.moved, exam: j.exam}).toEqual({
			green: true,
			moved: true,
			exam: [],
		});
	});

	it("the check changed and confirmed again: green, and marked as an exam change", () => {
		const after: Entry = {
			...entry,
			confirmed: {commit: "c2", prints: {[PIECE]: "p2", [LAW]: "l2"}},
		};
		const j = judge(facts({entry: after, now: {[PIECE]: "p2", [LAW]: "l2"}}));
		expect({green: j.green, exam: j.exam}).toEqual({green: true, exam: [`${LAW} was changed`]});
	});

	it("the record's own words changed, or a new record: an exam change", () => {
		expect(judge(facts({entry: {...entry, covers: []}})).exam).toEqual(["its covers was changed"]);
		expect(judge(facts({before: null})).exam).toEqual(["a new promise"]);
		expect(judge(facts({before: "unknown"})).exam).toEqual([]);
	});

	it("a record must say which code it covers by name: a path out of the repo does not decode", () => {
		const bad = JSON.stringify({...entry, covers: ["../outside.ts#x"]});
		expect(Exit.isFailure(decodeEntry(bad))).toBe(true);
		expect(Exit.isSuccess(decodeEntry(JSON.stringify(entry)))).toBe(true);
	});
});
