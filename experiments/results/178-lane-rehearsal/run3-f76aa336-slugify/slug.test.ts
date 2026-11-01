import {expect, it} from "vitest";
import fc from "fast-check";
import {slugify} from "./slug.ts";

const options = {seed: 20261101, numRuns: 300};
const asciiCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const asciiWord = fc.array(fc.constantFrom(...asciiCharacters), {
	minLength: 1,
	maxLength: 40,
}).map(chars => chars.join(""));
const separators = [
	" ", "\t", "\n", "\r\n", "\v", "\f", "\u00a0", "\u2003",
	"!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",",
	"-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\",
	"]", "^", "_", "`", "{", "|", "}", "~", "’", "—", "€", "🎉", "🚀",
];
const separatorRun = fc.array(fc.constantFrom(...separators), {
	minLength: 1,
	maxLength: 12,
}).map(parts => parts.join(""));

it("converts the four approved post titles", () => {
	const fixtures = [
		["Çay Şeker", "cay-seker"],
		[" Release 2: What’s New? ", "release-2-what-s-new"],
		["Cafe\u0301 Society", "cafe-society"],
		["🎉 !!!", ""],
	];
	for (const [title, expected] of fixtures) {
		expect(slugify(title)).toBe(expected);
	}
});

it("p1: any string produces an empty slug or lowercase ASCII groups joined by single hyphens", () => {
	const arbitraryTitle = fc.array(fc.integer({min: 0, max: 0xffff}), {
		maxLength: 200,
	}).map(units => String.fromCharCode(...units));
	const check = (title: string) => {
		const slug = slugify(title);
		expect(typeof slug).toBe("string");
		expect(slug).toMatch(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
		expect(slug).not.toMatch(/[^a-z0-9-]/);
	};
	for (const title of ["", "A\n", "  A--B  ", "Çay Şeker", "東京", "🎉", "\ud800A\udfff", "a\u0000b"]) {
		check(title);
	}
	fc.assert(fc.property(arbitraryTitle, check), options);
});

it("p2: ASCII letters and digits are preserved in order with letters lowercased", () => {
	expect(slugify(asciiCharacters)).toBe("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789");
	fc.assert(fc.property(asciiWord, title => {
		expect(slugify(title)).toBe(title.toLowerCase());
	}), options);
});

it("p3: separator runs preserve ASCII word boundaries as single hyphens", () => {
	expect(slugify("  Hello, WORLD__42! 🎉 ")).toBe("hello-world-42");
	for (const separator of separators) {
		expect(slugify(`${separator}Hello${separator}${separator}WORLD${separator}42${separator}`))
			.toBe("hello-world-42");
	}
	fc.assert(fc.property(
		fc.array(fc.tuple(asciiWord, separatorRun), {minLength: 1, maxLength: 12}),
		separatorRun,
		(parts, prefix) => {
			const title = prefix + parts.map(([word, gap]) => word + gap).join("");
			const expected = parts.map(([word]) => word.toLowerCase()).join("-");
			expect(slugify(title)).toBe(expected);
		},
	), options);
});

it("p4: canonically composed and decomposed accented letters yield the same plain ASCII slug", () => {
	const accents: Array<readonly [string, string]> = [
		["À", "a"], ["á", "a"], ["Â", "a"], ["ã", "a"], ["Ä", "a"], ["å", "a"],
		["Ç", "c"], ["ć", "c"], ["Č", "c"], ["Ḉ", "c"],
		["È", "e"], ["é", "e"], ["Ê", "e"], ["ë", "e"], ["Ē", "e"],
		["Ì", "i"], ["í", "i"], ["Î", "i"], ["ï", "i"], ["İ", "i"],
		["Ñ", "n"], ["ń", "n"],
		["Ò", "o"], ["ó", "o"], ["Ô", "o"], ["õ", "o"], ["Ö", "o"], ["ő", "o"],
		["Ř", "r"], ["Ś", "s"], ["ş", "s"], ["Š", "s"],
		["Ù", "u"], ["ú", "u"], ["Û", "u"], ["ü", "u"], ["ǘ", "u"],
		["Ý", "y"], ["ÿ", "y"], ["Ž", "z"], ["ź", "z"], ["ậ", "a"],
	];
	const check = (title: string, expected: string) => {
		expect(slugify(title.normalize("NFC"))).toBe(expected);
		expect(slugify(title.normalize("NFD"))).toBe(expected);
	};
	check("Çay Şeker", "cay-seker");
	check("Café", "cafe");
	check("Cafe\u0301 Society", "cafe-society");
	for (const [accent, plain] of accents) {
		check(`B${accent}B`, `b${plain}b`);
	}
	fc.assert(fc.property(
		fc.array(fc.constantFrom(...accents), {minLength: 1, maxLength: 30}),
		pairs => {
			check(pairs.map(([accent]) => accent).join(""), pairs.map(([, plain]) => plain).join(""));
		},
	), options);
});

it("p5: non-ASCII characters remaining after accent folding separate usable words", () => {
	expect(slugify("tea東京time")).toBe("tea-time");
	expect(slugify("Straße")).toBe("stra-e");
	const unsupported = ["東京", "ß", "ø", "ł", "æ", "œ", "Ж", "العربية", "🎉"];
	for (const separator of unsupported) {
		expect(slugify(`${separator}TEA${separator}${separator}Time${separator}`)).toBe("tea-time");
	}
	fc.assert(fc.property(
		asciiWord,
		asciiWord,
		fc.array(fc.constantFrom(...unsupported), {minLength: 1, maxLength: 8}),
		(left, right, middle) => {
			expect(slugify(left + middle.join("") + right))
				.toBe(`${left.toLowerCase()}-${right.toLowerCase()}`);
		},
	), options);
});

it("p6: titles with no usable ASCII letters or digits after folding yield an empty string", () => {
	for (const title of ["", "   ", "---___!!!", "🎉 !!!", "東京", "ßøłæœ", "\u0301\u0327", "\u0000\n\t"]) {
		expect(slugify(title)).toBe("");
	}
	const unusable = fc.constantFrom(...separators, "東京", "ß", "ø", "ł", "æ", "œ", "Ж", "\u0301", "\u0327", "\u0000");
	fc.assert(fc.property(
		fc.array(unusable, {maxLength: 100}),
		parts => {
			expect(slugify(parts.join(""))).toBe("");
		},
	), options);
});
