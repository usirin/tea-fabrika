// P8, next/, p61. Assertions ported from programs/markdown/src/markdown.test.ts at 2c29c13.
// P22 binds parse/draw/code/keyed to its real Root and React renderToStaticMarkup. Controls below
// are saved observations for testing the examiner only. They do not test an unbuilt renderer.
// P22's lead run must show the real Chromium/Electron policy, lazy WebAssembly loading and plain
// fallback when loading is blocked, outside link handling, and a note's script never executing.
import {existsSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const t = (value: string) => ({type: "text", value});
const blockText =
	"# Heading\n\n**Answer.** Yes,\non two lines.\n\n- one\n  more\n- two\n\n3. third\n\n```ts\nconst a = 1;\n```\n\n> a quote\n\n| Run | Note |\n|---|--:|\n| 170-1 | a \\| b |\n\n---";
const blocks = [
	{type: "heading", depth: 1, children: [t("Heading")]},
	{
		type: "paragraph",
		children: [{type: "strong", children: [t("Answer.")]}, t(" Yes,\non two lines.")],
	},
	{
		type: "list",
		ordered: false,
		start: null,
		spread: false,
		children: [
			{
				type: "listItem",
				checked: null,
				children: [{type: "paragraph", children: [t("one\nmore")]}],
			},
			{type: "listItem", checked: null, children: [{type: "paragraph", children: [t("two")]}]},
		],
	},
	{
		type: "list",
		ordered: true,
		start: 3,
		spread: false,
		children: [
			{type: "listItem", checked: null, children: [{type: "paragraph", children: [t("third")]}]},
		],
	},
	{type: "code", lang: "ts", value: "const a = 1;"},
	{type: "blockquote", children: [{type: "paragraph", children: [t("a quote")]}]},
	{
		type: "table",
		align: [null, "right"],
		children: [
			[[t("Run")], [t("Note")]],
			[[t("170-1")], [t("a | b")]],
		],
	},
	{type: "thematicBreak"},
];
const inlineText = "**b** *i* `c` ~~d~~ [l](https://example.com/a)";
const inline = [
	{
		type: "paragraph",
		children: [
			{type: "strong", children: [t("b")]},
			t(" "),
			{type: "emphasis", children: [t("i")]},
			t(" "),
			{type: "inlineCode", value: "c"},
			t(" "),
			{type: "delete", children: [t("d")]},
			t(" "),
			{type: "link", url: "https://example.com/a", children: [t("l")]},
		],
	},
];
const unsafe = "<script>alert(1)</script>\n\nSafe <img src=x onerror=alert(1)> text.";
const badLinks = [
	"javascript:alert(1)",
	"JAVASCRIPT:alert(1)",
	"data:text/html,hi",
	"file:///etc/hosts",
	"./other.md",
];
const code = '<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n';
type Drawing = {
	readonly parse: (text: string) => unknown;
	readonly draw: (text: string) => string;
	readonly accepts: (root: unknown) => boolean;
	readonly keys: (values: readonly string[]) => readonly string[];
	// The binding walks the actual React tree before rendering it. Raw HTML props are collected
	// recursively, so escaped HTML output alone cannot pass a dangerouslySetInnerHTML plant.
	readonly code: (
		lang: string | null,
		text: string,
		colored: boolean,
	) => {readonly html: string; readonly text: string; readonly rawHtml: readonly unknown[]};
};
const parsing = (d: Drawing) => {
	expect(d.parse(blockText)).toEqual(blocks);
	expect(d.parse(inlineText)).toEqual(inline);
	expect(d.parse("\n\n")).toEqual([]);
	for (const text of [blockText, inlineText, unsafe, "# changed"])
		expect(d.parse(text), "deterministic parse").toEqual(d.parse(text));
	expect(d.keys(["a", "b", "a"])).toEqual(["a#0", "b#0", "a#1"]);
};
const safe = (d: Drawing) => {
	expect(d.accepts({type: "root", children: blocks}), "valid parsed blocks decode").toBe(true);
	expect(d.parse(unsafe)).toEqual([{type: "paragraph", children: [t("Safe "), t(" text.")]}]);
	expect(d.draw(unsafe), "raw HTML is omitted").not.toMatch(/<script|<img|onerror/i);
	for (const url of badLinks) {
		expect(d.parse(`[click](${url})`)).toEqual([{type: "paragraph", children: [t("click")]}]);
		expect(d.draw(`[click](${url})`), `unsafe link ${url}`).not.toMatch(/<a\b|href=/i);
	}
	expect(
		d.accepts({
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [{type: "link", url: "javascript:alert(1)", children: [t("x")]}],
				},
			],
		}),
		"unsafe links also fail data decoding",
	).toBe(false);
	for (const url of ["https://example.com/a", "http://example.com/a"]) {
		expect(d.draw(`[l](${url})`)).toContain(`href="${url}"`);
		expect(d.draw(`[l](${url})`)).toContain('target="_blank"');
		expect(d.draw(`[l](${url})`)).toContain('rel="noreferrer"');
	}
	const image = "![a chart](https://example.com/c.png)";
	expect(d.parse(image)).toEqual([{type: "paragraph", children: [t("a chart")]}]);
	expect(d.draw(image), "images are alt text only").not.toMatch(/<img\b|src=/i);
	expect(d.draw(image)).toContain("a chart");
};
const drawing = (d: Drawing) => {
	for (const part of ["<strong>b</strong>", "<em>i</em>", "<code>c</code>", "<del>d</del>"])
		expect(d.draw(inlineText)).toContain(part);
	expect(d.draw("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
	expect(d.draw("| a | b |\n|---|--:|\n| 1 | 2 |")).toContain("text-align:right");
	for (const lang of [null, "nope", "text", "ts", "html"])
		for (const colored of [false, true]) {
			const out = d.code(lang, code, colored);
			expect(out.text, "every code character is a text child").toBe(code);
			expect(out.rawHtml, "code has no raw HTML props").toEqual([]);
			expect(out.html).not.toMatch(/<script|<img/);
			expect(out.html).toContain("&lt;");
		}
};
const anyText = (d: Drawing) =>
	fc.assert(
		fc.property(fc.string({maxLength: 80}), (text) => {
			const first = d.parse(text);
			expect(d.parse(text), "arbitrary parse is deterministic").toEqual(first);
			expect(d.draw(text)).not.toMatch(/<script\b|<img\b|href=["'](?:javascript|data|file):/i);
		}),
		{seed: 119120, numRuns: 300},
	);

// These observations deliberately cover only the examiner's examples; no Markdown parser lives
// in the exam. Future binding commits replace none of these assertions.
const observations = new Map<string, unknown>([
	[blockText, blocks],
	[inlineText, inline],
	["\n\n", []],
	["# changed", [{type: "heading", depth: 1, children: [t("changed")]}]],
	[unsafe, [{type: "paragraph", children: [t("Safe "), t(" text.")]}]],
	["![a chart](https://example.com/c.png)", [{type: "paragraph", children: [t("a chart")]}]],
	...badLinks.map((url): [string, unknown] => [
		`[click](${url})`,
		[{type: "paragraph", children: [t("click")]}],
	]),
]);
const control: Drawing = {
	parse: (text) => {
		if (!observations.has(text)) throw new Error("no saved parse observation");
		return structuredClone(observations.get(text));
	},
	draw: (text) => {
		if (text === unsafe) return "<p>Safe  text.</p>";
		if (text.startsWith("[click]")) return "<p>click</p>";
		if (text.startsWith("![")) return "<p>a chart</p>";
		if (text === inlineText)
			return '<strong>b</strong> <em>i</em> <code>c</code> <del>d</del> <a href="https://example.com/a" target="_blank" rel="noreferrer">l</a>';
		if (text === "- a\n- b") return "<ul><li>a</li><li>b</li></ul>";
		if (text.startsWith("|")) return '<td style="text-align:right">2</td>';
		return `<a href="${text.slice(4, -1)}" target="_blank" rel="noreferrer">l</a>`;
	},
	accepts: (root) => !JSON.stringify(root).includes("javascript:"),
	keys: () => ["a#0", "b#0", "a#1"],
	code: (_lang, text) => ({
		html: `<pre><code>${text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code></pre>`,
		text,
		rawHtml: [],
	}),
};
describe("p61 fixed drawing exam, saved controls and plants only", () => {
	it("clean control satisfies parsing, safety, and code assertions", () => {
		parsing(control);
		safe(control);
		drawing(control);
	});
	it("any text parses and draws; generated examiner control", () =>
		anyText({...control, parse: () => [], draw: () => ""}));
	it("plant: arbitrary text parse throws", () =>
		expect(() =>
			anyText({
				...control,
				parse: () => {
					throw new Error("planted parser crash");
				},
				draw: () => "",
			}),
		).toThrow(/119120/));
	it("plant: a clock enters parsing", () => {
		let tick = 0;
		expect(() =>
			parsing({
				...control,
				parse: (text) => (text === unsafe ? {tick: tick++} : control.parse(text)),
			}),
		).toThrow(/deterministic parse/);
	});
	for (const [name, mutate, why] of [
		[
			"draw HTML",
			(d: Drawing): Drawing => ({
				...d,
				draw: (text) => (text === unsafe ? "<script>alert(1)</script>" : d.draw(text)),
			}),
			/raw HTML is omitted/,
		],
		[
			"keep javascript",
			(d: Drawing): Drawing => ({
				...d,
				draw: (text) =>
					text.startsWith("[click]") ? '<a href="javascript:alert(1)">click</a>' : d.draw(text),
			}),
			/unsafe link/,
		],
		[
			"emit image",
			(d: Drawing): Drawing => ({
				...d,
				draw: (text) => (text.startsWith("![") ? '<img src="remote">a chart' : d.draw(text)),
			}),
			/images are alt text/,
		],
	] as const)
		it(`plant: ${name}`, () => {
			expect(() => safe(mutate(control))).toThrow(why);
		});
	it("plant: escaped HTML output is still forbidden as a raw HTML prop", () => {
		expect(() =>
			drawing({
				...control,
				code: (...args) => ({...control.code(...args), rawHtml: [{__html: "&lt;script&gt;"}]}),
			}),
		).toThrow(/no raw HTML props/);
	});
	it("plant: lose one newline in colored code", () => {
		expect(() =>
			drawing({...control, code: (...args) => ({...control.code(...args), text: code.trimEnd()})}),
		).toThrow(/every code character/);
	});
});
const dir = resolve(import.meta.dirname, "../../../../programs/notes/src");
const codeFiles = (at: string): string[] =>
	!existsSync(at)
		? []
		: readdirSync(at, {withFileTypes: true}).flatMap((e) =>
				e.isDirectory()
					? codeFiles(resolve(at, e.name))
					: /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)
						? [e.name]
						: [],
			);
it("P22 real drawing binding", (ctx) => {
	const files = codeFiles(dir).filter((s) => /root|drawn|highlight|view|window/.test(s));
	if (files.length === 0)
		return ctx.skip("not built: P22 drawing; no React rendering was exercised");
	throw new Error(
		"P22 source exists: bind parse/draw/code/keyed and direct dependencies to the real renderer; incomplete exports or loading errors fail",
	);
});
