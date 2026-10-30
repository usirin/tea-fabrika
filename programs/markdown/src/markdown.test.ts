import {memoryStorage, readInput, start, tell, viewOf} from "@kampus/fabrika";
import * as highlights from "@pierre/highlights";
import dimmed from "@pierre/highlights/themes/github-dark-dimmed";
import {Effect, Fiber, Schema, Stream} from "effect";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {colorsOf} from "./highlight.ts";
import {markdown} from "./index.ts";
import {Root} from "./root.ts";
import {CodeBlock, keyed, MarkdownWindow} from "./window.tsx";

// The markdown program: a text read into a tree, its view following each text told, what its
// window draws, and when it ends.

const t = (value: string) => ({type: "text", value}) as const;
const blocksOf = (text: string) => Root.fromMarkdown(text).children;
/** The window's HTML for a text, as React draws it. */
const drawn = (text: string) =>
	renderToStaticMarkup(
		createElement(MarkdownWindow, {view: Root.fromMarkdown(text), send: () => {}}),
	);

describe("Root.fromMarkdown", () => {
	it("reads every block this repo writes, in mdast's names", () => {
		const text = [
			"# 170: The experiments program",
			"",
			"**Answer.** Yes,",
			"on today's blocks.",
			"",
			"- one",
			"  more",
			"- two",
			"",
			"3. third",
			"",
			"```ts",
			"const a = 1;",
			"```",
			"",
			"> a quote",
			"",
			"| Run | Note |",
			"|---|--:|",
			"| 170-1 | a \\| b |",
			"",
			"---",
		].join("\n");
		expect(blocksOf(text)).toEqual([
			{type: "heading", depth: 1, children: [t("170: The experiments program")]},
			{
				type: "paragraph",
				children: [{type: "strong", children: [t("Answer.")]}, t(" Yes,\non today's blocks.")],
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
					{
						type: "listItem",
						checked: null,
						children: [{type: "paragraph", children: [t("third")]}],
					},
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
		]);
	});

	it("reads inline marks: bold, italic, code, struck and links", () => {
		expect(blocksOf("**b** *i* `c` ~~d~~ [l](https://example.com/a)")).toEqual([
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
		]);
	});

	it("leaves out HTML, so a script never reaches the window", () => {
		const text = "<script>alert(1)</script>\n\nSafe <img src=x onerror=alert(1)> text.";
		expect(blocksOf(text)).toEqual([{type: "paragraph", children: [t("Safe "), t(" text.")]}]);
		expect(drawn(text)).not.toMatch(/<script|<img|onerror/);
	});

	it.each([
		"javascript:alert(1)",
		"JAVASCRIPT:alert(1)",
		"data:text/html,hi",
		"file:///etc/hosts",
		"./other.md",
	])("keeps a link to %s as its text alone", (url) => {
		expect(blocksOf(`[click](${url})`)).toEqual([{type: "paragraph", children: [t("click")]}]);
		expect(drawn(`[click](${url})`)).not.toMatch(/<a |href/);
	});

	it("refuses a link that is not http or https in the data itself", () => {
		const bad = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [{type: "link", url: "javascript:alert(1)", children: [t("x")]}],
				},
			],
		};
		expect(Schema.is(Root)(bad)).toBe(false);
	});

	it("reads an image as its alt text: the window loads nothing from outside", () => {
		expect(blocksOf("![a chart](https://example.com/c.png)")).toEqual([
			{type: "paragraph", children: [t("a chart")]},
		]);
	});

	it("reads an empty text as no blocks", () => {
		expect(blocksOf("\n\n")).toEqual([]);
	});
});

describe("MarkdownWindow", () => {
	it("draws inline marks as elements, and a link that opens outside", () => {
		const html = drawn("**b** *i* `c` [l](https://example.com/a)");
		expect(html).toContain("<strong>b</strong>");
		expect(html).toContain("<em>i</em>");
		expect(html).toContain("<code>c</code>");
		expect(html).toContain(
			'<a href="https://example.com/a" title="https://example.com/a" target="_blank" rel="noreferrer">l</a>',
		);
	});

	it("draws a tight list's items as lines, and a table's alignment", () => {
		expect(drawn("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
		expect(drawn("| a | b |\n|---|--:|\n| 1 | 2 |")).toContain(
			'<td style="text-align:right">2</td>',
		);
	});

	it("says what to do when it has nothing to show", () => {
		expect(drawn("")).toContain("Nothing to show yet");
	});

	it("draws a code block plain as it opens, before the highlighter has loaded", () => {
		expect(drawn("```ts\nconst a = 1;\n```")).toContain(
			'<pre><code data-lang="ts">const a = 1;</code></pre>',
		);
	});
});

describe("CodeBlock", () => {
	const colors = colorsOf(highlights, dimmed);
	const block = (lang: string | null, value: string) => ({type: "code", lang, value}) as const;
	const html = (lang: string | null, value: string) =>
		renderToStaticMarkup(createElement(CodeBlock, {block: block(lang, value), colors}));

	it("draws a language it knows as colored spans, the page's ink left bare", () => {
		expect(html("ts", "const a = 1;")).toBe(
			'<pre><code data-lang="ts"><span style="color:#f47067">const </span>a ' +
				'<span style="color:#f47067">= </span><span style="color:#6cb6ff">1</span>;</code></pre>',
		);
	});

	it("keeps each line on its own line", () => {
		expect(html("ts", "const a = 1;\nconst b = 2;")).toContain(
			';\n<span style="color:#f47067">const </span>b ',
		);
	});

	it.each([null, "nope", "text"])("draws a block in %s as plain text, with no error", (lang) => {
		expect(html(lang, "const a = 1;")).toBe(
			`<pre><code${lang === null ? "" : ` data-lang="${lang}"`}>const a = 1;</code></pre>`,
		);
	});

	it("draws a token's text as text, never as HTML", () => {
		const out = html("html", "<script>alert(1)</script><img src=x onerror=alert(2)>");
		expect(out).toContain("&lt;");
		expect(out).not.toMatch(/<script|<img/);
	});
});

describe("markdown", () => {
	it("shows each text told, the last one replacing the first, and ends on quit", async () => {
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(
					markdown,
					{text: "# Hi"},
					{},
					{id: "markdown:test", storage: memoryStorage()},
				);
				if (started.kind !== "running") return yield* Effect.die("markdown did not start");
				const view = viewOf(markdown);
				if (view === undefined) return yield* Effect.die("markdown has no view");
				const seen = yield* started.run.machines.page.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.map(view.of),
					// A view is untyped past `viewOf`: the window gets it as its data's schema reads it.
					Stream.filter(Schema.is(Root)),
					Stream.map((root) => root.children.map((b) => b.type)),
					Stream.filter((types) => types.includes("list")),
					Stream.take(1),
					Stream.runCollect,
					Effect.forkScoped,
				);
				yield* tell(started.run, "text", "- a\n- b");
				const lists = yield* Fiber.join(seen);
				yield* tell(started.run, "quit", {});
				const ended = yield* started.run.ended;
				return {lists, ended: ended.kind};
			}).pipe(Effect.scoped),
		);
		expect(shown).toEqual({lists: [["list"]], ended: "ended"});
	});

	/** How a run with no `--text` ends: its text told or not, then closed, then quit if it is still up. */
	const endOf = (texts: readonly string[]) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(
					markdown,
					{text: undefined},
					{},
					{id: "markdown:test", storage: memoryStorage()},
				);
				if (started.kind !== "running") return yield* Effect.die("markdown did not start");
				for (const text of texts) yield* tell(started.run, "text", text);
				started.close("text");
				const early = yield* started.run.ended.pipe(Effect.timeoutOption("200 millis"));
				if (early._tag === "Some") return {ended: early.value.kind, by: "close"};
				yield* tell(started.run, "quit", {});
				return {ended: (yield* started.run.ended).kind, by: "quit"};
			}).pipe(Effect.scoped),
		);

	it("ends at once when its text closes with none told: the program before it failed", async () => {
		expect(await endOf([])).toEqual({ended: "ended", by: "close"});
	});

	it("stays up after its text closes once a text came, until the window quits", async () => {
		expect(await endOf(["# Hi"])).toEqual({ended: "ended", by: "quit"});
	});

	it("takes quit from its window and refuses what it does not know", () => {
		expect(readInput(markdown, {type: "quit", value: {}}).kind).toBe("read");
		expect(readInput(markdown, {type: "scroll", value: {}}).kind).toBe("refused");
	});
});

describe("keyed", () => {
	it("keys each value by what it reads and how many alike came before", () => {
		expect(keyed(["a", "b", "a"], (x) => x).map((k) => k.key)).toEqual(["a#0", "b#0", "a#1"]);
	});
});
