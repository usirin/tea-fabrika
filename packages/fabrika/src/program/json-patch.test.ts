import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {apply, diff, type Json, PatchMisfit} from "./json-patch.ts";

// A job's record keeps most steps as a patch on the step before (../host/job-rules.ts), and reads
// a step back by applying them in order. So the one law that matters: a patch, applied to what it
// was taken from, gives what it was taken to. Keys with `/` and `~` in them are in the mix, since
// a pointer must escape them (RFC 6901).

const key = fc.oneof(fc.string({maxLength: 6}), fc.constantFrom("a/b", "~", "~1", "", "0"));
const json: fc.Arbitrary<Json> = fc.letrec<{v: Json}>((tie) => ({
	v: fc.oneof(
		{depthSize: "small"},
		fc.constant(null),
		fc.boolean(),
		fc.integer(),
		fc.string({maxLength: 8}),
		fc.array(tie("v"), {maxLength: 4}),
		fc.dictionary(key, tie("v"), {maxKeys: 4}),
	),
})).v;

describe("JSON Patch", () => {
	it("apply(a, diff(a, b)) is b, and a is left as it was", () => {
		fc.assert(
			fc.property(json, json, (a, b) => {
				const before = structuredClone(a);
				expect(apply(a, diff(a, b))).toEqual(b);
				expect(a).toEqual(before);
			}),
			{numRuns: 500},
		);
	});

	it("the same value needs no ops", () => {
		fc.assert(fc.property(json, (a) => diff(a, structuredClone(a)).length === 0));
	});

	it("writes what changed, at its place", () => {
		expect(diff({total: 1}, {total: 3})).toEqual([{op: "replace", path: "/total", value: 3}]);
		expect(diff({list: [1]}, {list: [1, 2]})).toEqual([{op: "add", path: "/list/1", value: 2}]);
		expect(diff({"a/b": {"~": 1}}, {"a/b": {"~": 2}})).toEqual([
			{op: "replace", path: "/a~1b/~0", value: 2},
		]);
	});

	it("refuses a patch that does not fit the value", () => {
		expect(() => apply({}, [{op: "remove", path: "/gone"}])).toThrow(PatchMisfit);
		expect(() => apply([1], [{op: "replace", path: "/5", value: 1}])).toThrow(PatchMisfit);
	});
});
