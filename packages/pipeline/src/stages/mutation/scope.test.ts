import {describe, expect, it} from "vitest";
import {changesOf, isSource, spansOf, unapproved} from "./scope.ts";

// The pure Checks before anything runs: which lines, and what changes the exam.

const line = (file: string, n: number, text = "x;") => ({file, line: n, text});

describe("the lines to mutate", () => {
	it("joins touching lines into one span, keeps files apart, and leaves tests out", () => {
		const added = [
			line("b.ts", 3),
			line("a.ts", 7),
			line("a.ts", 5),
			line("a.ts", 6),
			line("a.test.ts", 1),
		];
		expect(spansOf({diff: {files: [], added}, kept: []})).toEqual([
			{file: "a.ts", from: 5, to: 7},
			{file: "b.ts", from: 3, to: 3},
		]);
	});

	it("adds each kept Property's code, joined with what overlaps it", () => {
		const scope = {
			diff: {files: [], added: [line("a.ts", 12)]},
			kept: [
				{file: "a.ts", from: 9, to: 13},
				{file: "c.ts", from: 1, to: 4},
			],
		};
		expect(spansOf(scope)).toEqual([
			{file: "a.ts", from: 9, to: 13},
			{file: "c.ts", from: 1, to: 4},
		]);
	});

	it("takes code files only, not tests, type files or text", () => {
		expect(["a.ts", "a.tsx", "a.mjs", "a.js"].every(isSource)).toBe(true);
		expect(["a.test.ts", "a.spec.js", "a.d.ts", "README.md", "a.json"].some(isSource)).toBe(false);
	});
});

describe("what changes the exam", () => {
	const comment = "  // Stryker disable next-line all: an empty outbox loops zero times";

	it("finds an added disable comment, and a touched file of the exam", () => {
		const diff = {files: ["a.ts", "skip.ts"], added: [line("a.ts", 4, comment), line("a.ts", 5)]};
		expect(changesOf(diff, ["skip.ts", "other.ts"])).toEqual([
			{kind: "disable", file: "a.ts", line: 4, text: comment.trim()},
			{kind: "exam", file: "skip.ts", hash: expect.stringMatching(/^[0-9a-f]{12}$/)},
		]);
		expect(
			changesOf({files: ["a.ts"], added: [line("a.ts", 1, "// Stryker restore all")]}, []),
		).toEqual([]);
	});

	it("drops a change the owner said yes to, wherever its line moved, and keeps the rest", () => {
		const yes = {kind: "disable" as const, file: "a.ts", line: 40, text: comment.trim()};
		const now = [
			{...yes, line: 4},
			{...yes, file: "b.ts"},
		];
		expect(unapproved(now, [yes])).toEqual([{...yes, file: "b.ts"}]);
	});

	it("keeps a yes to a file of the exam for the contents it was given to", () => {
		const exam = (text: string) =>
			changesOf({files: ["skip.ts"], added: [line("skip.ts", 1, text)]}, ["skip.ts"]);
		const yes = exam("skip ['logs']");
		expect(unapproved(exam("skip ['logs']"), yes)).toEqual([]);
		expect(unapproved(exam("skip ['everything']"), yes)).toHaveLength(1);
	});
});
