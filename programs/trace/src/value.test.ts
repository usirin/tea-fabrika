import {describe, expect, it} from "vitest";
import {inline, linesOf, needsTree} from "./value.ts";

// A value as a tree's lines, the way the step detail draws a Msg, a state and a Cmd.

const shape = (value: unknown, changed?: ReadonlySet<string>) =>
	linesOf(value, changed).map((l) => [l.depth, l.key, l.text, l.changed]);

describe("a value's lines", () => {
	it("puts each key on a line, nested ones under their key, and marks what changed", () => {
		expect(shape({total: 3, seen: [1, {at: "x"}]}, new Set(["/total"]))).toEqual([
			[0, "total", "3", true],
			[0, "seen", "", false],
			[1, "0", "1", false],
			[1, "1", "", false],
			[2, "at", '"x"', false],
		]);
	});

	it("draws a plain value, and an empty one, as one line with no key", () => {
		expect(shape(7)).toEqual([[0, null, "7", false]]);
		expect(shape({})).toEqual([[0, null, "{}", false]]);
		expect(shape(null)).toEqual([[0, null, "null", false]]);
		expect(shape({list: []})).toEqual([[0, "list", "[]", false]]);
	});

	it("names a key with a slash or a tilde as a JSON Pointer does", () => {
		expect(linesOf({"a/b": 1, "c~": 2}).map((l) => l.path)).toEqual(["/a~1b", "/c~0"]);
	});
});

describe("a value on one line", () => {
	it("is its JSON when short, else how big it is", () => {
		expect(inline({type: "add", n: 2})).toBe('{"type":"add","n":2}');
		expect(inline({a: "x".repeat(80)})).toBe("{1 key}");
		expect(inline(Array.from({length: 30}, (_, i) => i))).toBe("[30 items]");
		expect(inline("y".repeat(80))).toBe(JSON.stringify("y".repeat(80)));
		expect([needsTree({n: 1}), needsTree({a: "x".repeat(80)})]).toEqual([false, true]);
	});
});
