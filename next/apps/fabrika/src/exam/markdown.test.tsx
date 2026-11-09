// P8, next/. Port source: programs/markdown/src/markdown.test.ts at 2c29c13f433c.
// Mapping: Root blocks/inline/safety -> parse/draw; MarkdownWindow -> draw; CodeBlock -> code;
// keyed -> repeated-key contract. Quit, text-stream closure and old host handshakes are excluded.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {Arbitrary, Effect, FileSystem, Schema} from "effect";

const options = {arbitrary: {seed: 119120, runs: 300, size: 4096, concurrency: 1}};
const bounded = (min: number, max: number) =>
	Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));
const int = (min: number, max: number) =>
	Schema.Int.check(Schema.isBetween({minimum: min, maximum: max}));
const MarkdownCases = Arbitrary.schema(
	Schema.Struct({
		text: Schema.Union([
			bounded(0, 4096),
			Schema.Literals(["مرحبا 🌱", "# Hi", "- a\n- b", "| a |\n|---|\n| 1 |", "> q", "---", ""]),
		]),
		depth: int(0, 8),
		nodes: int(0, 32),
		alt: bounded(0, 512).check(Schema.isPattern(/^[a-zA-Z0-9 ]*$/)),
		scheme: bounded(1, 24),
		url: bounded(0, 512),
	}),
);
const escape = (s: string) =>
	s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#x27;");
const safe = (html: string) => {
	expect(html).not.toMatch(/<(?:script|img|iframe|object|embed|svg)\b/i);
	expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
	for (const match of html.matchAll(/\bhref=["']([^"']*)["']/gi))
		expect(match[1]).toMatch(/^https?:\/\//i);
};
const codeText = (html: string, text: string) => {
	safe(html);
	const plain = html.replace(/<\/?(?:pre|code|span)\b[^>]*>/g, "");
	expect(plain).toBe(escape(text));
};

type Drawing = {
	readonly parse: (text: string) => unknown;
	readonly draw: (tree: unknown) => string;
	readonly code: (language: string | null, text: string) => string;
	readonly keyed: (texts: ReadonlyArray<string>) => ReadonlyArray<{readonly key: string}>;
};
// P22's tests step installs typed imports here before its builder starts. No mock is a binding.
const drawing = (): Drawing => {
	throw new Error(
		"P22 sources present: bind real parser, window, code renderer and keyed exports; failed imports are failures",
	);
};
const present = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const file of ["root.ts", "window.tsx", "markdown.ts", "draw.tsx", "highlight.ts"])
		if (
			yield* fs.exists(new URL(`../../../../programs/notes/src/${file}`, import.meta.url).pathname)
		)
			return true;
	return false;
}).pipe(Effect.provide(NodeFileSystem.layer));
const withDrawing = (ctx: {skip: (reason?: string) => never}, law: (d: Drawing) => void) =>
	Effect.gen(function* () {
		if (!(yield* present)) ctx.skip("not built: P22 drawing");
		law(drawing());
	});

it.effect.prop(
	"not built: P22 / parse and draw are deterministic, omit HTML and draw images as alt",
	{c: MarkdownCases},
	({c}, ctx) =>
		withDrawing(ctx, (d) => {
			const root = d.parse(c.text);
			expect(d.parse(c.text)).toEqual(root);
			expect(d.draw(root)).toBe(d.draw(d.parse(c.text)));
			safe(d.draw(root));
			for (const text of [
				"<script>alert(1)</script>",
				"<img src=x onerror=alert(1)>",
				`<svg onload=alert(1)>${escape(c.alt)}</svg>`,
			])
				safe(d.draw(d.parse(text)));
			const image = d.draw(d.parse(`![${escape(c.alt)}](https://example.test/p.png)`));
			safe(image);
			expect(image).not.toContain("<img");
			expect(image).toContain(escape(c.alt));
		}),
	options,
);

it.effect.prop(
	"not built: P22 / only http and https links survive in data and drawing",
	{c: MarkdownCases},
	({c}, ctx) =>
		withDrawing(ctx, (d) => {
			for (const scheme of ["javascript", "JAVASCRIPT", "data", "file", "relative", c.scheme]) {
				const url = scheme === "relative" ? "./other.md" : `${scheme}:example`;
				const tree = d.parse(`[click](${url})`),
					html = d.draw(tree);
				safe(html);
				if (!/^https?$/i.test(scheme)) {
					expect(html).not.toMatch(/<a\b/i);
					expect(JSON.stringify(tree)).not.toContain('"type":"link"');
				}
			}
			for (const scheme of ["http", "https"])
				expect(d.draw(d.parse(`[click](${scheme}://example.test/a)`))).toContain(
					`href="${scheme}://example.test/a"`,
				);
		}),
	options,
);

it.effect.prop(
	"not built: P22 / nested blocks, inline marks, escaping and repeated keys",
	{c: MarkdownCases},
	({c}, ctx) =>
		withDrawing(ctx, (d) => {
			const nested = `${"> ".repeat(c.depth)}**bold** *italic* \`code\` ~~gone~~`;
			const html = d.draw(d.parse(Array.from({length: c.nodes}, () => nested).join("\n\n")));
			safe(html);
			if (c.nodes > 0)
				for (const element of ["strong", "em", "code", "del"])
					expect(html).toContain(`<${element}>`);
			codeText(d.code(null, c.text), c.text);
			const keys = d.keyed([c.text, c.alt, c.text]);
			expect(new Set(keys.map((k) => k.key)).size).toBe(3);
			expect(d.keyed([c.text, c.alt, c.text])).toEqual(keys);
		}),
	options,
);

// format: exact syntax tree is the ported storage/drawing vocabulary, not a hand-picked law.
it.effect("not built: P22 / format: block and inline vocabulary from the source port", (ctx) =>
	withDrawing(ctx, (d) => {
		expect(d.keyed(["a", "b", "a"]).map((k) => k.key)).toEqual(["a#0", "b#0", "a#1"]);
		const text =
			"# Heading\n\n**b** *i* `c` ~~d~~ [l](https://example.test/a)\n\n- a\n- b\n\n3. third\n\n```ts\nconst a = 1;\n```\n\n> q\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n---";
		const root = Schema.decodeUnknownSync(
			Schema.Struct({
				type: Schema.Literal("root"),
				children: Schema.Array(Schema.Struct({type: Schema.String})),
			}),
		)(d.parse(text));
		expect(root.children.map((b) => b.type)).toEqual([
			"heading",
			"paragraph",
			"list",
			"list",
			"code",
			"blockquote",
			"table",
			"thematicBreak",
		]);
		const html = d.draw(d.parse(text));
		for (const piece of [
			"<strong>b</strong>",
			"<em>i</em>",
			"<code>c</code>",
			"<del>d</del>",
			'target="_blank"',
			'rel="noreferrer"',
			"<ul><li>a</li><li>b</li></ul>",
			"text-align:right",
		])
			expect(html).toContain(piece);
		expect(d.parse("\n\n")).toEqual({type: "root", children: []});
	}),
);

it.prop(
	"checker clean control: escaped text and http/https links are safe",
	{c: MarkdownCases},
	({c}) => {
		safe(`<p>${escape(c.text)}</p><a href="https://example.test/a">link</a>`);
		codeText(`<pre><code>${escape(c.text)}</code></pre>`, c.text);
	},
	options,
);
it.prop(
	"checker plants: raw HTML, javascript links, images, lost text and repeated keys fail",
	{c: MarkdownCases},
	({c}) => {
		for (const html of [
			"<script>alert(1)</script>",
			'<a href="javascript:alert(1)">x</a>',
			'<img src="https://example.test/a">',
		])
			expect(() => safe(html)).toThrow();
		expect(() => codeText(`<pre><code>${escape(c.text)}!</code></pre>`, c.text)).toThrow();
		expect(() => expect(new Set(["same", "same"]).size).toBe(2)).toThrow();
	},
	options,
);

// A local source-presence checker. A complete import may still fail; it is never absence.
const presence = (files: ReadonlyMap<string, string>, load: () => Drawing) => {
	if (files.size === 0) return "pending";
	for (const file of ["root.ts", "window.tsx", "highlight.ts"])
		if (!files.has(file)) throw new Error(`partial target: ${file}`);
	load();
	return "bound";
};
const TargetFiles = Arbitrary.schema(
	Schema.Struct({name: bounded(1, 96), content: bounded(0, 128), count: int(0, 4)}),
);
it.prop(
	"presence checker controls: absent, partial, failed-import and complete targets",
	{c: TargetFiles},
	({c}) => {
		const complete = new Map(["root.ts", "window.tsx", "highlight.ts"].map((f) => [f, c.content]));
		const noBinding = () => {
			throw new Error("failed import");
		};
		expect(presence(new Map(), noBinding)).toBe("pending");
		expect(() => presence(new Map([[c.name, c.content]]), noBinding)).toThrow();
		expect(() => presence(complete, noBinding)).toThrow("failed import");
		// Checker-only dummy; no product law calls it.
		const clean: Drawing = {
			parse: (s) => s,
			draw: String,
			code: (_l, s) => escape(s),
			keyed: (s) => s.map((_, i) => ({key: String(i)})),
		};
		expect(presence(complete, () => clean)).toBe("bound");
		expect(() => expect(presence(new Map(), noBinding)).toBe("passed")).toThrow();
	},
	options,
);
