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
const Text = Schema.Union([
	bounded(0, 4096),
	Schema.Literals(["مرحبا 🌱", "# Hi", "- a\n- b", "| a |\n|---|\n| 1 |", "> q", "---", ""]),
]);
const Alt = bounded(0, 512);
const MarkdownCases = Arbitrary.schema(
	Schema.Struct({
		text: Text,
		depth: int(0, 8),
		nodes: int(0, 32),
		alt: Alt,
	}),
);
const escape = (s: string) =>
	s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#x27;");
// Raw HTML tests exercise every element the Markdown renderer can itself produce.
const rendererTags = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"strong",
	"em",
	"del",
	"a",
	"pre",
	"code",
	"span",
	"blockquote",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"hr",
	"br",
	"input",
] as const;
const safe = (html: string) => {
	const elements = new Set<string>(rendererTags);
	for (const tag of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi))
		expect(elements.has((tag[1] ?? "").toLowerCase())).toBe(true);
	expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
	expect(html).not.toMatch(/<input\b[^>]*(?:\btype\s*=\s*["']?image\b|\bsrc\s*=)/i);
	for (const match of html.matchAll(/\bhref=["']([^"']*)["']/gi))
		expect(match[1]).toMatch(/^https?:\/\//i);
};
type RawProbe = {readonly source: string; readonly expected: string};
const rawOmitted = (render: (source: string) => string, probe: RawProbe) =>
	expect(render(probe.source)).toBe(probe.expected);
const Tag = bounded(1, 32).check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));
const RawCases = Arbitrary.schema(
	Schema.Struct({
		tag: Tag,
		content: bounded(1, 128).check(Schema.isPattern(/^[a-zA-Z0-9]+$/)),
		attribute: bounded(0, 96),
	}),
);
type RawCase = typeof RawCases extends Arbitrary.Arbitrary<infer A> ? A : never;
const rawSources = (c: RawCase) => {
	const sources: RawProbe[] = [];
	for (const tag of new Set([
		...rendererTags,
		"div",
		"style",
		"video",
		"script",
		"img",
		"svg",
		c.tag,
	]))
		for (const name of [tag.toLowerCase(), tag.toUpperCase()])
			for (const attrs of [
				"",
				` data-p8="${escape(new URLSearchParams({v: c.attribute}).toString())}"`,
			]) {
				sources.push({source: `<${name}${attrs}></${name}>`, expected: ""});
				// A newline after the opening tag makes a whole HTML block, even for inline tags.
				// Its contents are part of that block, so dropping only empty tags cannot pass.
				for (const content of ["", c.content])
					sources.push(
						{source: `<${name}${attrs}>\n${content}\n</${name}>`, expected: ""},
						{
							source: `before <${name}${attrs}>${content}</${name}> after`,
							expected: `<p>before ${content} after</p>`,
						},
					);
				for (const source of [`<${name}${attrs}/>`, `<${name}${attrs} />`])
					sources.push(
						{source, expected: ""},
						{source: `before ${source} after`, expected: "<p>before  after</p>"},
					);
			}
	for (const name of ["input", "INPUT"])
		for (const source of [
			`<${name} type="image" src="https://outside.test/p.png?${new URLSearchParams({p: c.attribute})}">`,
			`<${name} src="https://outside.test/p.png" type="IMAGE" />`,
		])
			sources.push(
				{source, expected: ""},
				{source: `before ${source} after`, expected: "<p>before  after</p>"},
			);
	return sources;
};
const altText = (html: string, alt: string) => {
	safe(html);
	expect(html).not.toMatch(/<img\b/i);
	expect(html).toContain(escape(alt));
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
const paths = [
	"root.ts",
	"window.tsx",
	"markdown.ts",
	"draw.tsx",
	"drawn.tsx",
	"highlight.ts",
	"highlight.tsx",
	"highlighter.ts",
].flatMap((file) => [
	`../../../../programs/notes/src/${file}`,
	`../../../../programs/notes/${file}`,
]);
const presence = (files: ReadonlySet<string>, load: () => Drawing): Drawing | null => {
	if (!paths.some((p) => files.has(p))) return null;
	const d = load();
	for (const name of ["parse", "draw", "code", "keyed"] as const)
		if (typeof d[name] !== "function") throw new Error(`missing drawing export: ${name}`);
	return d;
};
const present = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const found = new Set<string>();
	for (const p of paths) if (yield* fs.exists(new URL(p, import.meta.url).pathname)) found.add(p);
	return presence(found, drawing);
}).pipe(Effect.provide(NodeFileSystem.layer));
const withDrawing = (ctx: {skip: (reason?: string) => never}, law: (d: Drawing) => void) =>
	Effect.gen(function* () {
		const d = yield* present;
		if (d === null) ctx.skip("not built: P22 drawing");
		law(d);
	});

it.effect.prop(
	"not built: P22 / parse and draw are deterministic, omit HTML and draw images as alt",
	{c: Arbitrary.schema(Schema.Struct({text: Text, alt: Alt, tag: Tag})), raw: RawCases},
	({c, raw}, ctx) =>
		withDrawing(ctx, (d) => {
			const root = d.parse(c.text);
			expect(d.parse(c.text)).toEqual(root);
			expect(d.draw(root)).toBe(d.draw(d.parse(c.text)));
			safe(d.draw(root));
			for (const source of rawSources(raw)) rawOmitted((s) => d.draw(d.parse(s)), source);
			for (const tag of new Set([...rendererTags, "div", "style", "video", c.tag]))
				expect(d.draw(d.parse(`before <${tag} data-p8="raw"></${tag}> after`))).toBe(
					"<p>before  after</p>",
				);
			// Escape Markdown punctuation; Unicode is passed unchanged to the parser.
			for (const alt of [c.alt, "مرحبا 🧪 שלום ![]()_*`<> &.,:;?\\"]) {
				const source = alt.replace(/[\\`*_[\]{}()<>!#]/g, "\\$&").replaceAll("&", "&amp;");
				altText(d.draw(d.parse(`![${source}](https://example.test/p.png)`)), alt);
			}
		}),
	options,
);

it.effect.prop(
	"not built: P22 / only http and https links survive in data and drawing",
	{c: Arbitrary.schema(Schema.Struct({scheme: bounded(1, 24), url: bounded(0, 512)}))},
	({c}, ctx) =>
		withDrawing(ctx, (d) => {
			for (const scheme of ["javascript", "JAVASCRIPT", "data", "file", "relative", c.scheme]) {
				const url =
					scheme === "relative" ? "./other.md" : `${scheme}:${new URLSearchParams({q: c.url})}`;
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
			for (const lang of ["ts", "html"]) codeText(d.code(lang, c.text), c.text);
			const colored = d.code("ts", `const n = 1;\n// ${c.text}`);
			codeText(colored, `const n = 1;\n// ${c.text}`);
			expect(colored).toMatch(/<span\b[^>]*style=/);
			const keys = d.keyed([c.text, c.alt, c.text]);
			expect(new Set(keys.map((k) => k.key)).size).toBe(3);
			expect(d.keyed([c.text, c.alt, c.text])).toEqual(keys);
		}),
	options,
);

// format: exact syntax tree is the ported storage/drawing vocabulary, not a hand-picked law.
it.effect("format: not built: P22 / block and inline vocabulary from the source port", (ctx) =>
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
	{c: Arbitrary.schema(Schema.Struct({text: Text, alt: Alt, tag: Tag})), raw: RawCases},
	({c, raw}) => {
		safe(`<p>${escape(c.text)}</p><a href="https://example.test/a">link</a>`);
		codeText(`<pre><code>${escape(c.text)}</code></pre>`, c.text);
		codeText(
			`<pre><code><span style="color:#ffffff">${escape(c.text)}</span></code></pre>`,
			c.text,
		);
		for (const probe of rawSources(raw)) rawOmitted(() => probe.expected, probe);
		altText(`<p>${escape(c.alt)}</p>`, c.alt);
	},
	options,
);
it.prop(
	"checker plants: raw HTML, javascript links, images, lost text and repeated keys fail",
	{c: Arbitrary.schema(Schema.Struct({text: Text, alt: Alt, tag: Tag})), raw: RawCases},
	({c, raw}) => {
		for (const html of [
			"<script>alert(1)</script>",
			'<a href="javascript:alert(1)">x</a>',
			'<img src="https://example.test/a">',
			'<input type="image" src="https://outside.test/p.png">',
			'<INPUT SRC="https://outside.test/p.png" TYPE="IMAGE" />',
		])
			expect(() => safe(html)).toThrow();
		for (const probe of rawSources(raw))
			// Each plant preserves just this raw form. Other forms may still be correctly omitted.
			expect(() => rawOmitted((s) => (s === probe.source ? s : probe.expected), probe)).toThrow();
		expect(() => altText(`<p>${escape(c.alt)}!</p>`, `${c.alt}!lost`)).toThrow();
		expect(() => codeText(`<pre><code><span>${c.text}<img></span></code></pre>`, c.text)).toThrow();
		expect(() => codeText(`<pre><code>${escape(c.text)}!</code></pre>`, c.text)).toThrow();
		expect(() => expect(new Set(["same", "same"]).size).toBe(2)).toThrow();
	},
	options,
);

const TargetFiles = Arbitrary.schema(Schema.Struct({content: bounded(0, 128)}));
it.prop(
	"presence checker controls: absent, partial, failed-import and complete targets",
	{c: TargetFiles},
	({c}) => {
		const noBinding = () => {
			throw new Error(`failed import: ${c.content}`);
		};
		expect(presence(new Set(), noBinding)).toBeNull();
		for (const file of [
			"root.ts",
			"markdown.ts",
			"drawn.tsx",
			"highlighter.ts",
			"highlight.ts",
			"highlight.tsx",
			"window.tsx",
			"draw.tsx",
		])
			for (const p of [
				`../../../../programs/notes/src/${file}`,
				`../../../../programs/notes/${file}`,
			])
				expect(() => presence(new Set([p]), noBinding)).toThrow("failed import");
		// Checker-only dummy; no product law calls it.
		const clean: Drawing = {
			parse: (s) => s,
			draw: String,
			code: (_l, s) => escape(s),
			keyed: (s) => s.map((_, i) => ({key: String(i)})),
		};
		expect(presence(new Set(paths), () => clean)).toBe(clean);
		// @ts-expect-error Deliberately incomplete module: the real presence helper must reject it.
		const incomplete: Drawing = {...clean, code: undefined};
		expect(() => presence(new Set(paths), () => incomplete)).toThrow("missing drawing export");
		expect(() => expect(presence(new Set(), noBinding)).toBe("passed")).toThrow();
	},
	options,
);
