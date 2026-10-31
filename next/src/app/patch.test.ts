import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {applyPatch, diff} from "./patch.ts";

describe("applyPatch", () => {
	it("applies the shape A3 and W2 show", () => {
		expect(
			applyPatch({stage: "build", line: ["a"]}, [
				{op: "replace", path: "/stage", value: "review"},
				{op: "add", path: "/line/-", value: "l"},
			]),
		).toEqual({stage: "review", line: ["a", "l"]});
	});

	it("reads an escaped key", () => {
		expect(applyPatch({"a/b": 1, "c~d": 2}, [{op: "replace", path: "/a~1b", value: 9}])).toEqual({
			"a/b": 9,
			"c~d": 2,
		});
		expect(diff({"c~d": 1}, {"c~d": 2})).toEqual([{op: "replace", path: "/c~0d", value: 2}]);
	});

	it("leaves the document it was given as it was", () => {
		const doc = {tiles: [{id: "t1"}]};
		applyPatch(doc, [{op: "replace", path: "/tiles/0/id", value: "t2"}]);
		expect(doc).toEqual({tiles: [{id: "t1"}]});
	});
});

describe("diff", () => {
	it("says nothing for two equal values", () => {
		expect(diff({n: 1, a: [1, {b: 2}]}, {n: 1, a: [1, {b: 2}]})).toEqual([]);
	});

	it("changes only what changed", () => {
		expect(diff({n: 1, m: 2}, {n: 1, m: 3})).toEqual([{op: "replace", path: "/m", value: 3}]);
	});

	it("replaces the whole value when the type changes", () => {
		expect(diff({a: [1]}, {a: {b: 1}})).toEqual([{op: "replace", path: "/a", value: {b: 1}}]);
		expect(diff(1, {b: 1})).toEqual([{op: "replace", path: "", value: {b: 1}}]);
	});

	it("always gets there: applying a diff gives the target", () => {
		const json = fc.jsonValue({maxDepth: 4}).map((v) => JSON.parse(JSON.stringify(v)));
		fc.assert(
			fc.property(json, json, (a, b) => {
				expect(applyPatch(a, diff(a, b))).toEqual(b);
			}),
			{numRuns: 300},
		);
	});
});
