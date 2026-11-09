// P16, next/. CSS spelling changes must keep the same imported bytes.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as fc from "fast-check";
import {afterEach, describe, expect, it} from "vitest";
import {inlineStylesheet} from "./css.ts";

const runs = {seed: 119120, numRuns: 30};
const ids = fc.integer({min: 0, max: 10000});
const homes: string[] = [];
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
		expect(css, "the imported rule must be in the output").toMatch(
			new RegExp(`\\.child${id}\\s*\\{[^}]*color:\\s*red\\s*;?\\s*\\}`),
		);
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
					verifyImport(f.read(css), id);
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
					verifyImport(f.read(css), id);
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
					verifyImport(f.read(css), id);
				}),
				runs,
			);
		});
	it("comments and whitespace around a quoted import URL keep every imported byte", () => {
		fc.assert(
			fc.property(
				ids,
				fc.constantFrom(" ", "\t", "\n", "\r", "\f", "/**/", " /*first*/\t/*second*/ "),
				fc.constantFrom('"', "'"),
				(id, gap, quote) => {
					const f = fixture(id);
					expect(f.read(`@import${gap}url(${gap}${quote}./child${id}.css${quote}${gap});`)).toBe(
						f.body,
					);
				},
			),
			runs,
		);
	});

	it("hex escapes consume only their digits and optional whitespace, including CRLF", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("", " ", "\t", "\n", "\r", "\f", "\r\n"), (id, gap) => {
				const f = fixture(id);
				expect(f.read(`@import "\\63${gap}hild${id}.css";`)).toBe(f.body);
			}),
			runs,
		);
	});

	it("an asterisk inside a quoted filename does not start a comment", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom('"', "'"), (id, quote) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `*child${id}.css`), f.body);
				expect(f.read(`@import url(${quote}*child${id}.css${quote});`)).toBe(f.body);
			}),
			runs,
		);
	});

	it("whitespace ends an unquoted URL only when the closing parenthesis follows", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom(" ", "\t", "\n", "\r", "\f"), (id, gap) => {
				const f = fixture(id);
				expect(f.read(`@import url(./child${id}.css${gap});`)).toBe(f.body);
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
				expect(f.read(`@import "child\\${hex} ${id}.css";`)).toBe(f.body);
			}),
			runs,
		);
	});

	it("a hex escape ends after six digits even when the filename continues with hex digits", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("af", "face", "00"), (id, suffix) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `c${suffix}${id}.css`), f.body);
				expect(f.read(`@import "\\000063${suffix}${id}.css";`)).toBe(f.body);
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
				expect(f.read(`@import ${quote}child${id}.css`)).toBe(f.body);
			}),
			runs,
		);
	});

	it("media comments become whitespace and do not hide the following root rule", () => {
		fc.assert(
			fc.property(ids, fc.constantFrom("", "note", "* longer *", "line\nnext"), (id, note) => {
				const f = fixture(id),
					last = `.root${id} { color: blue; }`;
				expect(
					f.read(`@import "child${id}.css" print/*${note}*/and/*${note}*/(color);${last}`),
				).toBe(`@media print and (color) {\n${f.body}\n}${last}`);
			}),
			runs,
		);
	});

	it("layer and supports imports fail before their rules can become a media query", () => {
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
				expect(f.read(css)).toBe(css);
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
