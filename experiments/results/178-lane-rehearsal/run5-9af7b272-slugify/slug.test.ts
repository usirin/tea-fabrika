import {expect, it} from "vitest";
import fc from "fast-check";
import {slugify} from "./slug.ts";

it("p1 preserves ASCII words and digits in order and lowercases letters", () => {
	expect(slugify("Hello World 2026")).toBe("hello-world-2026");
	expect(slugify("  MiXeD   a1B2  007  Z  ")).toBe("mixed-a1b2-007-z");
	expect(slugify("0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("0123456789-abcdefghijklmnopqrstuvwxyz");

	const word = fc.array(
		fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
		{minLength: 1, maxLength: 24},
	).map(characters => characters.join(""));

	fc.assert(
		fc.property(
			fc.array(word, {minLength: 1, maxLength: 12}),
			fc.integer({min: 1, max: 6}),
			(words, spaces) => {
				const title = words.map(word => word.toUpperCase()).join(" ".repeat(spaces));
				expect(slugify(title)).toBe(words.join("-"));
			},
		),
		{seed: 202601, numRuns: 200},
	);
});

it("p2 folds precomposed and combining accents to the same plain letters", () => {
	const cases = [
		["Çay Şeker", "cay-seker"],
		["C\u0327ay S\u0327eker", "cay-seker"],
		["Café", "cafe"],
		["Cafe\u0301", "cafe"],
		["Crème brûlée", "creme-brulee"],
		["Cre\u0300me bru\u0302le\u0301e", "creme-brulee"],
	] as const;

	for (const [title, expected] of cases) {
		expect(slugify(title)).toBe(expected);
	}
});

it("p3 collapses punctuation whitespace emoji and unsupported letters into separators", () => {
	const cases = [
		["  Hello, World! 2026 ", "hello-world-2026"],
		["one…☕ / two", "one-two"],
		["one\t\n\r\u00a0two", "one-two"],
		["one---___...two", "one-two"],
		["one😀🚀two", "one-two"],
		["Straße", "stra-e"],
		["aæb", "a-b"],
		["ałb", "a-b"],
		["oneßæł☕ / two", "one-two"],
		["---☕ one / two !!!", "one-two"],
	] as const;

	for (const [title, expected] of cases) {
		expect(slugify(title)).toBe(expected);
	}
});

it("p4 returns an empty string for titles with nothing usable", () => {
	for (const title of [
		"",
		"   \t\n\r",
		" ☕ !!! ",
		"---___.../?!",
		"😀🚀",
		"ßæł",
		"\u0301\u0327",
	]) {
		expect(slugify(title)).toBe("");
	}
});

it("p5 always produces lowercase ASCII words with single internal hyphens", () => {
	const slugPattern = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
	const check = (title: string) => {
		const result = slugify(title);
		// Compare the entire match so a trailing newline cannot pass via '$'.
		expect(result.match(slugPattern)?.[0]).toBe(result);
	};

	for (const title of [
		"",
		"---Hello World 2026---",
		" ☕ !!! ",
		"Çay Şeker",
		"Cafe\u0301",
		"Straße æ ł",
		"İ Σ 中文 １２３",
		"\u0000a\u0000",
	]) {
		check(title);
	}

	const unicodeTitle = fc.array(
		fc.integer({min: 0, max: 0xffff}),
		{maxLength: 160},
	).map(units => units.map(unit => String.fromCharCode(unit)).join(""));

	fc.assert(
		fc.property(unicodeTitle, title => {
			check(title);
			check(" ☕---" + title + "---!!!\n");
		}),
		{seed: 202605, numRuns: 300},
	);
});
