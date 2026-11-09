// P16, next/. CSS spelling changes must keep the same imported rules.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as fc from "fast-check";
import {type Rule, transform} from "lightningcss";
import {afterEach, describe, expect, it} from "vitest";
import {inlineStylesheet} from "./css.ts";

const runs = {seed: 119120, numRuns: 30};
const ids = fc.integer({min: 0, max: 10000});
const homes: string[] = [];
// Inspect the parsed rules before printing can merge or normalize them. Only locations differ.
const cssRules = (css: string) => {
	let rules: Rule[] = [];
	transform({
		filename: "law.css",
		code: Buffer.from(css),
		visitor: {
			StyleSheet: (sheet) => {
				rules = sheet.rules;
			},
		},
	});
	return rules;
};
const meaning = (rules: readonly Rule[]): unknown =>
	JSON.parse(JSON.stringify(rules, (key, value) => (key === "loc" ? undefined : value)));
const fixture = (id: number) => {
	const home = mkdtempSync("/tmp/p16css.");
	homes.push(home);
	const body = `.child${id} { color: red; }`;
	writeFileSync(join(home, `child${id}.css`), body);
	return {
		home,
		body,
		read: (css: string) => {
			const file = join(home, "root.css");
			writeFileSync(file, css);
			return inlineStylesheet(file);
		},
	};
};
afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

describe("P16 CSS tokens", () => {
	// The expected rule comes from the file, never from decoding the generated import spelling.
	const verifyImport = (css: string, id: number) => {
		expect(
			meaning(cssRules(css)),
			"the imported rule must appear once, with its declarations",
		).toEqual(meaning(cssRules(`.child${id} { color: red; }`)));
	};
	const imported = (css: string, id: number) => {
		verifyImport(css, id);
		// Drop or repeat the actual child output. Both must fail the same semantic check.
		for (const plant of ["", `${css}\n${css}`])
			expect(() => verifyImport(plant, id)).toThrow("imported rule");
	};
	it("escaped at-keywords import the same file as their unescaped spelling", () => {
		fc.assert(
			fc.property(
				ids,
				fc.constantFrom("im\\70ort", "\\69mport", "\\000069mport", "i\\mport"),
				(id, keyword) => {
					const f = fixture(id),
						css = `@${keyword} "./child${id}.css";`;
					// Plant the review bug: leave the import in the served text without its child.
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(f.read(css), id);
				},
			),
			{...runs, examples: [[0, "im\\70ort"]]}, // Pinned round-3 escaped @import bug.
		);
	});
	it("escaped url functions import the same file as their unescaped spelling", () => {
		fc.assert(
			fc.property(
				ids,
				fc.constantFrom("u\\72l", "\\75rl", "\\000075rl", "u\\rl"),
				fc.constantFrom('"', "'", ""),
				(id, url, quote) => {
					const f = fixture(id),
						css = `@import ${url}(${quote}./child${id}.css${quote});`;
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(f.read(css), id);
				},
			),
			{...runs, examples: [[0, "u\\72l", '"']]}, // Pinned round-3 escaped url() bug.
		);
	});
	// CSS Syntax 3 normalizes CRLF, CR and form feed to LF before consuming strings.
	// https://www.w3.org/TR/css-syntax-3/#input-preprocessing
	for (const [ending, newline] of [
		["LF", "\n"],
		["CRLF", "\r\n"],
		["CR", "\r"],
		["form feed", "\f"],
	])
		it(`${ending} string continuations import the same disk name after CSS input preprocessing`, () => {
			fc.assert(
				fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
					const f = fixture(id),
						css = `@import ${quote}./chi\\${newline}ld${id}.css${quote};`;
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(f.read(css), id);
				}),
				runs,
			);
		});
	it("comments and whitespace around a quoted import URL keep every imported rule", () => {
		fc.assert(
			fc.property(
				ids,
				fc.constantFrom(" ", "\t", "\n", "\r", "\f", "/**/", " /*first*/\t/*second*/ "),
				fc.constantFrom('"', "'"),
				(id, gap, quote) => {
					expect.hasAssertions();
					const f = fixture(id);
					// A quoted url() allows whitespace before its quote, but no comment there.
					// https://www.w3.org/TR/css-syntax-3/#consume-ident-like-token
					const space = gap.includes("/*") ? " " : gap;
					imported(f.read(`@import${gap}url(${space}${quote}./child${id}.css${quote}${gap});`), id);
					if (gap.includes("/*"))
						expect(() =>
							f.read(`@import${gap}url(${gap}${quote}./child${id}.css${quote}${gap});`),
						).toThrow("stylesheet has a broken url()");
				},
			),
			runs,
		);
	});

	it("hex escapes consume only their digits and optional whitespace, including CRLF", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("", " ", "\t", "\n", "\r", "\f", "\r\n"), (id, gap) => {
				const f = fixture(id);
				imported(f.read(`@import "\\63${gap}hild${id}.css";`), id);
			}),
			runs,
		);
	});

	it("an asterisk inside a quoted filename does not start a comment", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `*child${id}.css`), f.body);
				imported(f.read(`@import url(${quote}*child${id}.css${quote});`), id);
			}),
			runs,
		);
	});

	it("whitespace ends an unquoted URL only when the closing parenthesis follows", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom(" ", "\t", "\n", "\r", "\f"), (id, gap) => {
				const f = fixture(id);
				imported(f.read(`@import url(./child${id}.css${gap});`), id);
				expect(() => f.read(`a { background: url(https://test.invalid/a${gap}b); }`)).toThrow(
					"stylesheet has a broken url()",
				);
			}),
			runs,
		);
	});

	it("zero, surrogate and out-of-range hex escapes name the replacement character", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("0", "d800", "dfff", "110000"), (id, hex) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child�${id}.css`), f.body);
				imported(f.read(`@import "child\\${hex} ${id}.css";`), id);
			}),
			runs,
		);
	});

	it("a hex escape ends after six digits even when the filename continues with hex digits", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("af", "face", "00"), (id, suffix) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `c${suffix}${id}.css`), f.body);
				imported(f.read(`@import "\\000063${suffix}${id}.css";`), id);
			}),
			runs,
		);
	});

	it("a newline in a quoted reference fails instead of accepting a different disk name", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child\n${id}.css`), f.body);
				expect(() => f.read(`@import ${quote}child\n${id}.css${quote};`)).toThrow(
					"stylesheet has a broken string",
				);
			}),
			runs,
		);
	});

	it("a string token ending at the end of the file still imports its stylesheet", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
				const f = fixture(id);
				imported(f.read(`@import ${quote}child${id}.css`), id);
			}),
			runs,
		);
	});

	it("media comments become whitespace and do not hide the following root rule", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("", "note", "* longer *", "line\nnext"), (id, note) => {
				const f = fixture(id),
					last = `.root${id} { color: blue; }`;
				const rules = cssRules(
					f.read(`@import "child${id}.css" print/*${note}*/and/*${note}*/(color);${last}`),
				);
				const verify = (actual: readonly Rule[]) =>
					expect(meaning(actual), "imported rules keep their order and media condition").toEqual(
						meaning(cssRules(`@media print and (color) {${f.body}}${last}`)),
					);
				verify(rules);
				const media = rules[0]!;
				expect(media.type).toBe("media");
				if (media.type !== "media") throw new Error("imported media rule missing");
				for (const plant of [
					rules.slice(1),
					[media, ...rules],
					[...rules].reverse(),
					[...media.value.rules, ...rules.slice(1)],
				])
					expect(() => verify(plant)).toThrow("imported rules");
			}),
			runs,
		);
	});

	it("layer and supports imports fail before their rules can become a media query", () => {
		// 1.33.0 reports layer:null for both bare layer and no layer, and dependencies omit it.
		// Keep the refusal: flattening an anonymous layer changes the cascade. Raw CSS retains it.
		fc.assert(
			fc.property(
				ids,
				fc.constantFrom("layer", "layer(theme)", "supports(display: grid)", "LAYER(theme)"),
				(id, condition) => {
					const f = fixture(id);
					expect(() => f.read(`@import "child${id}.css" ${condition};`)).toThrow(
						"unsupported @import condition",
					);
				},
			),
			{...runs, examples: [[0, "layer"]]}, // Pinned 1.33.0 anonymous-layer loss.
		);
	});

	it("a bare layer on a later import is refused after ordinary imports and line breaks", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom(" ", "\n", "\r\n", "\r", "\f"), (id, gap) => {
				const f = fixture(id),
					first = `@import "child${id}.css";${gap}`,
					last = `.root${id} { color: blue; }`;
				const verify = (condition: string) =>
					expect(() =>
						f.read(`${first}@import "child${id}.css" ${condition};${gap}${last}`),
					).toThrow("unsupported @import condition");
				verify("layer");
				// Removing the unsupported condition must make this refusal check fail.
				expect(() => verify("")).toThrow();
			}),
			runs,
		);
	});

	it("nested stylesheets keep remote imports with their media conditions before local rules", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("print", "screen and (color)"), (id, media) => {
				const f = fixture(id),
					remote = `@import url("https://test.invalid/theme${id}.css") ${media};`,
					last = `.root${id} { color: blue; }`;
				writeFileSync(join(f.home, `child${id}.css`), `${remote}\n${f.body}`);
				const verify = (css: string) =>
					expect(
						meaning(cssRules(css)),
						"nested imports keep their URLs, order and conditions",
					).toEqual(meaning(cssRules(`${remote}\n${f.body}\n${last}`)));
				verify(f.read(`@import "child${id}.css";\n${last}`));
				for (const plant of [
					`${f.body}\n${last}`,
					`@import url("https://test.invalid/theme${id}.css");\n${f.body}\n${last}`,
				])
					expect(() => verify(plant)).toThrow("nested imports");
			}),
			runs,
		);
	});

	it("broken CSS reports an Error that names the broken token", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("string", "url()", "@import"), (id, token) => {
				const f = fixture(id);
				const css =
					token === "string"
						? `@import "child\n${id}.css";`
						: token === "url()"
							? `a { background: url(https://test.invalid/a ${id}); }`
							: `@import ("child${id}.css");`;
				let error: unknown;
				try {
					f.read(css);
				} catch (caught) {
					error = caught;
				}
				const verify = (actual: unknown) => {
					expect(actual).toBeInstanceOf(Error);
					expect(actual).toMatchObject({
						message: expect.stringContaining(`stylesheet has a broken ${token}`),
					});
				};
				verify(error);
				for (const plant of [undefined, new Error("wrong reason")])
					expect(() => verify(plant)).toThrow();
			}),
			runs,
		);
	});

	it("CSS multiplication does not hide a later local file reference", () => {
		fc.assert(
			fc.property(ids, (id) => {
				const f = fixture(id);
				expect(() =>
					f.read(`.root { width: calc(1*${id}px); background: url(./image${id}.png); }`),
				).toThrow("stylesheet references a file");
			}),
			runs,
		);
	});

	it("unquoted remote URLs reject quote and parenthesis characters", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'", "("), (id, char) => {
				const f = fixture(id);
				expect(() => f.read(`a { background: url(https://test.invalid/a${char}${id}); }`)).toThrow(
					"stylesheet has a broken url()",
				);
			}),
			runs,
		);
	});

	it("a scheme-like word inside a relative path still names a local file", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("https", "data", "custom+3"), (id, scheme) => {
				const f = fixture(id);
				expect(() => f.read(`a { background: url(./folder/${scheme}:${id}.png); }`)).toThrow(
					"stylesheet references a file",
				);
			}),
			runs,
		);
	});

	it("an escaped identifier ending in url is not a URL function", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("61", "000061", "62", "000062"), (id, hex) => {
				const f = fixture(id),
					css = `a { --value: \\${hex}url(./file${id}.png); }`;
				const expected = cssRules(
					`a { --value: ${hex.endsWith("61") ? "a" : "b"}url(./file${id}.png); }`,
				);
				const verify = (rules: readonly Rule[]) =>
					expect(meaning(rules), "the escaped function and its argument must remain").toEqual(
						meaning(expected),
					);
				const rules = cssRules(f.read(css));
				verify(rules);
				for (const plant of [
					[],
					[...rules, ...rules],
					cssRules(`a { --value: url(./file${id}.png); }`),
				])
					expect(() => verify(plant)).toThrow("escaped function");
			}),
			runs,
		);
	});

	it("parentheses without the URL keyword are a broken import", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
				const f = fixture(id);
				expect(() => f.read(`@import (${quote}child${id}.css${quote});`)).toThrow(
					"stylesheet has a broken @import",
				);
			}),
			runs,
		);
	});

	it("an imported file cannot hide an import cycle behind another relative path", () => {
		fc.assert(
			fc.property(ids, (id) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child${id}.css`), '@import "./root.css";');
				expect(() => f.read(`@import "./child${id}.css";`)).toThrow("stylesheet imports itself");
			}),
			runs,
		);
	});
});
