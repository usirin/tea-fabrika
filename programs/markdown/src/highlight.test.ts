import {describe, expect, it} from "vitest";
import {colorsNow, loadColors, wantsColors} from "./highlight.ts";

// A code block's colors: a language the highlighter knows gets colored spans, any other none,
// and the spans hold the code's own text, every character of it.

const TS = 'const plan = {key: "job-7f3a"};\n// a comment\nyield* experiments.start("170", plan);';

describe("loadColors", () => {
	it("loads once: a second call gets the same load, and the colors are there after", async () => {
		expect(colorsNow()).toBeNull();
		const first = loadColors();
		expect(loadColors()).toBe(first);
		const colors = await first;
		expect(colors).not.toBeNull();
		expect(colorsNow()).toBe(colors);
	});

	it("colors a language it knows, by its name or an alias, in any case", async () => {
		const colors = await loadColors();
		for (const lang of ["ts", "typescript", "TS"]) {
			const lines = colors?.(TS, lang) ?? [];
			expect(lines).toHaveLength(3);
			const colored = lines.flat().filter((s) => s.color !== null);
			expect(colored.length).toBeGreaterThan(3);
			for (const span of colored) expect(span.color).toMatch(/^#[0-9a-f]{6,8}$/);
		}
	});

	it("keeps every character: the spans of each line, joined, are the code", async () => {
		const colors = await loadColors();
		const lines = colors?.(TS, "ts") ?? [];
		expect(lines.map((line) => line.map((s) => s.text).join("")).join("\n")).toBe(TS);
	});

	it("gives a comment a color of its own, apart from the code around it", async () => {
		const colors = await loadColors();
		const [, comment = []] = colors?.(TS, "ts") ?? [];
		expect(comment).toEqual([{text: "// a comment", color: "#9198a1", italic: false, bold: false}]);
	});

	it.each(["nope", "text", "constructor", "__proto__"])(
		"draws a block in %s plain: no colors, no error",
		async (lang) => {
			const colors = await loadColors();
			expect(colors?.(TS, lang)).toBeNull();
		},
	);

	it("keeps a token's text as text: markup in the code is never read as HTML", async () => {
		const colors = await loadColors();
		const code = '<script>alert(1)</script><img src=x onerror="alert(2)">';
		const lines = colors?.(code, "html") ?? [];
		expect(lines.flat().map((s) => s.text)).toContain("script");
		expect(
			lines
				.flat()
				.map((s) => s.text)
				.join(""),
		).toBe(code);
	});
});

describe("wantsColors", () => {
	it("asks for colors only for a block that names a language other than plain text", () => {
		expect([null, "", "text", "TXT", "plain", "plaintext", "ts", "nope"].map(wantsColors)).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
			true,
			true,
		]);
	});
});
