import {describe, expect, it} from "vitest";
import {blocksOf, splitPiece, textOf} from "./blocks.ts";

const SOURCE = [
	'import {x} from "./x.ts";',
	"",
	"/** A doc comment.",
	" * Its lines start with a space.",
	" */",
	"export function one(a: number) {",
	"\tif (a > 0) {",
	"\t\treturn `a template",
	"} that has a brace and a line at column 0",
	// oxlint-disable-next-line eslint/no-template-curly-in-string -- the source under test holds a template placeholder on purpose.
	"${a}`;",
	"\t}",
	'\treturn "}";',
	"}",
	"",
	"const two = {",
	"\tk: [1, 2],",
	"};",
	"type two = typeof two;",
	"// a comment at the top level",
	"export const three = (s: string) =>",
	"\ts.length; /* a { in a comment */",
].join("\n");

describe("blocksOf", () => {
	it("splits a file into its top-level statements, each with the name it declares", () => {
		expect(blocksOf(SOURCE).map((b) => [b.name, b.from, b.to])).toEqual([
			[null, 1, 1],
			[null, 3, 5],
			["one", 6, 13],
			["two", 15, 17],
			["two", 18, 18],
			[null, 19, 19],
			["three", 20, 21],
		]);
	});

	it("a name stands for every statement that declares it, so a const and its type go together", () => {
		expect(textOf(SOURCE, "two")).toBe("const two = {\n\tk: [1, 2],\n};\ntype two = typeof two;");
	});

	it("a block is the same text wherever it sits in the file", () => {
		const moved = `// a new line on top\n\n${SOURCE}`;
		expect(textOf(moved, "one")).toBe(textOf(SOURCE, "one"));
		expect(blocksOf(moved).find((b) => b.name === "one")?.from).toBe(8);
	});

	it("a change inside a block changes its text, and only its own", () => {
		const changed = SOURCE.replace('return "}";', 'return "{";');
		expect(textOf(changed, "one")).not.toBe(textOf(SOURCE, "one"));
		expect(textOf(changed, "three")).toBe(textOf(SOURCE, "three"));
	});

	it("a name no block declares is null, and no name is the whole file", () => {
		expect(textOf(SOURCE, "four")).toBeNull();
		expect(textOf(SOURCE, null)).toBe(SOURCE);
	});

	it("splits a piece into its file and its name", () => {
		expect(splitPiece("a/b.ts#one")).toEqual({file: "a/b.ts", name: "one"});
		expect(splitPiece("a/b.ts")).toEqual({file: "a/b.ts", name: null});
	});
});
