/// <reference types="vite/client" />
import {expect, it} from "vitest";
import fc from "fast-check";

// Discover the planned module without making its baseline absence an import error.
const modules = import.meta.glob<{slugify?: unknown}>("./slug.ts", {eager: true});

function getSlugify(): (text: string) => string {
	const candidate = modules["./slug.ts"]?.slugify;
	expect(typeof candidate, "src/slug.ts must export the planned slugify function").toBe("function");
	return candidate as (text: string) => string;
}

const asciiWord = fc.array(
	fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
	{minLength: 1, maxLength: 40},
).map(characters => characters.join(""));

const separators = [
	" ", "\t", "\n", "\r\n", "\u00a0", "\u2003", "\u200b",
	"_", "__", "&", "!", "---", ".,;:/\\()[]{}", "'\"?@#$%^*+=|<>~`",
	"🍵", "😀", "中", "中文", " \t__&🍵中!\n",
] as const;

const separatorRun = fc.array(fc.constantFrom(...separators), {
	minLength: 1,
	maxLength: 12,
}).map(parts => parts.join(""));

it("p2: preserves every ASCII letter and digit while lowercasing and joining words", () => {
	const slugify = getSlugify();
	expect(slugify("ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789"))
		.toBe("abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-0123456789");
	fc.assert(
		fc.property(fc.array(asciiWord, {minLength: 1, maxLength: 15}), words => {
			expect(slugify(words.join(" ")))
				.toBe(words.map(word => word.toLowerCase()).join("-"));
		}),
		{seed: 631202, numRuns: 300},
	);
});

it("p3: folds the named accented and compatibility spellings to readable letters", () => {
	const slugify = getSlugify();
	const examples = [
		["Çay Şeker", "cay-seker"],
		["C\u0327ay S\u0327eker", "cay-seker"],
		["Café", "cafe"],
		["Cafe\u0301", "cafe"],
		["ﬂower", "flower"],
		["flower", "flower"],
	] as const;
	for (const [title, expected] of examples) {
		expect(slugify(title), JSON.stringify(title)).toBe(expected);
	}
});

it("p4: collapses separator runs between words and removes edge separators", () => {
	const slugify = getSlugify();
	expect(slugify("  Tea__&🍵Cake!  ")).toBe("tea-cake");
	expect(slugify("a中b")).toBe("a-b");
	for (const separator of separators) {
		expect(slugify(`${separator}Tea${separator}Cake${separator}`), JSON.stringify(separator))
			.toBe("tea-cake");
	}
	fc.assert(
		fc.property(asciiWord, asciiWord, separatorRun, separatorRun, separatorRun,
			(left, right, leading, middle, trailing) => {
				expect(slugify(`${leading}${left}${middle}${right}${trailing}`))
					.toBe(`${left.toLowerCase()}-${right.toLowerCase()}`);
			}),
		{seed: 631204, numRuns: 300},
	);
});

it("p5: returns an empty string for titles without usable content", () => {
	const slugify = getSlugify();
	for (const title of ["", ...separators]) {
		expect(slugify(title), JSON.stringify(title)).toBe("");
	}
	fc.assert(
		fc.property(separatorRun, title => {
			expect(slugify(title)).toBe("");
		}),
		{seed: 631205, numRuns: 300},
	);
});

it("p6: emits only lowercase ASCII alphanumeric groups separated by single hyphens", () => {
	const slugify = getSlugify();
	const unicodeTitle = fc.oneof(
		fc.string({unit: "binary", maxLength: 160}),
		fc.string({
			unit: fc.constantFrom("A", "z", "0", "9", "Ç", "é", "\u0301", "ﬂ", "中", "🍵", " ", "_", "-", "\n", "\u0000"),
			maxLength: 160,
		}),
	);
	fc.assert(
		fc.property(unicodeTitle, title => {
			const slug = slugify(title);
			expect(slug).toMatch(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/u);
			// Also reject a trailing newline, which JavaScript's $ anchor can allow.
			expect(slug).not.toMatch(/[^a-z0-9-]/u);
		}),
		{seed: 631206, numRuns: 1000},
	);
});
