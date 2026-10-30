import {Schema} from "effect";
import type * as Mdast from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import {gfmFromMarkdown} from "mdast-util-gfm";
import {gfm} from "micromark-extension-gfm";

// Markdown read into a tree, in mdast's names (the syntax tree unified and remark use): a `root`
// whose children are blocks, and blocks whose text is inline nodes. Read by micromark, the
// CommonMark parser remark uses, with GitHub's tables, strikethrough, task lists and bare links.
//
//   Root.fromMarkdown("# Hi\n\nSome **bold** [link](https://example.com).")
//   // {type: "root", children: [
//   //   {type: "heading", depth: 1, children: [{type: "text", value: "Hi"}]},
//   //   {type: "paragraph", children: [
//   //     {type: "text", value: "Some "},
//   //     {type: "strong", children: [{type: "text", value: "bold"}]},
//   //     {type: "text", value: " "},
//   //     {type: "link", url: "https://example.com/", children: [{type: "text", value: "link"}]},
//   //     {type: "text", value: "."}]}]}
//
// The tree is narrower than mdast, so what the window may draw is only what this file lets in:
//
//   HTML                 left out, block or inline: `<script>` never reaches the window
//   a link               kept only when it is http or https; any other (javascript:, file:, a
//                        relative path) is its text alone. `Web` refuses one in the data itself
//   an image             its alt text: the window loads nothing from outside
//   footnotes, defs      left out

/** A URL a link may point at: http or https, as the URL parser writes it. */
export const Web = Schema.String.check(Schema.isPattern(/^https?:\/\//));

export interface Text {
	readonly type: "text";
	readonly value: string;
}
export interface InlineCode {
	readonly type: "inlineCode";
	readonly value: string;
}
export interface Break {
	readonly type: "break";
}
export interface Marked {
	readonly type: "strong" | "emphasis" | "delete";
	readonly children: readonly Inline[];
}
export interface Link {
	readonly type: "link";
	readonly url: string;
	readonly children: readonly Inline[];
}
export type Inline = Text | InlineCode | Break | Marked | Link;

const inlines = Schema.Array(Schema.suspend((): Schema.Codec<Inline> => Inline));

export const Inline = Schema.Union([
	Schema.Struct({type: Schema.Literal("text"), value: Schema.String}),
	Schema.Struct({type: Schema.Literal("inlineCode"), value: Schema.String}),
	Schema.Struct({type: Schema.Literal("break")}),
	Schema.Struct({type: Schema.Literals(["strong", "emphasis", "delete"]), children: inlines}),
	Schema.Struct({type: Schema.Literal("link"), url: Web, children: inlines}),
]);

export interface Heading {
	readonly type: "heading";
	readonly depth: number;
	readonly children: readonly Inline[];
}
export interface Paragraph {
	readonly type: "paragraph";
	readonly children: readonly Inline[];
}
export interface ListItem {
	readonly type: "listItem";
	/** A task list's box: ticked, not ticked, or no box. */
	readonly checked: boolean | null;
	readonly children: readonly Block[];
}
export interface List {
	readonly type: "list";
	readonly ordered: boolean;
	/** The first number of an ordered list. */
	readonly start: number | null;
	/** Loose: a blank line between items, so each item's paragraphs stand apart. */
	readonly spread: boolean;
	readonly children: readonly ListItem[];
}
export interface Code {
	readonly type: "code";
	readonly lang: string | null;
	readonly value: string;
}
export interface Blockquote {
	readonly type: "blockquote";
	readonly children: readonly Block[];
}
export type Align = "left" | "right" | "center" | null;
export interface Table {
	readonly type: "table";
	readonly align: readonly Align[];
	/** The rows, the head first; each row's cells, each cell's text. */
	readonly children: readonly (readonly (readonly Inline[])[])[];
}
export interface ThematicBreak {
	readonly type: "thematicBreak";
}
export type Block = Heading | Paragraph | List | Code | Blockquote | Table | ThematicBreak;

const blocks = Schema.Array(Schema.suspend((): Schema.Codec<Block> => Block));

const ListItem = Schema.Struct({
	type: Schema.Literal("listItem"),
	checked: Schema.NullOr(Schema.Boolean),
	children: blocks,
});

export const Block = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("heading"),
		depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(6)),
		children: inlines,
	}),
	Schema.Struct({type: Schema.Literal("paragraph"), children: inlines}),
	Schema.Struct({
		type: Schema.Literal("list"),
		ordered: Schema.Boolean,
		start: Schema.NullOr(Schema.Int),
		spread: Schema.Boolean,
		children: Schema.Array(ListItem),
	}),
	Schema.Struct({
		type: Schema.Literal("code"),
		lang: Schema.NullOr(Schema.String),
		value: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("blockquote"), children: blocks}),
	Schema.Struct({
		type: Schema.Literal("table"),
		align: Schema.Array(Schema.NullOr(Schema.Literals(["left", "right", "center"]))),
		children: Schema.Array(Schema.Array(inlines)),
	}),
	Schema.Struct({type: Schema.Literal("thematicBreak")}),
]);

/** A link's URL, when it is http or https; else null, and the link is its text alone. */
const webOf = (url: string): string | null => {
	const parsed = URL.parse(url);
	return parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:")
		? parsed.href
		: null;
};

/** mdast's inline nodes, narrowed: what is left out leaves its text, or nothing. */
const inlineOf = (nodes: readonly Mdast.PhrasingContent[]): Inline[] =>
	nodes.flatMap((node): Inline[] => {
		switch (node.type) {
			case "text":
				return [{type: "text", value: node.value}];
			case "inlineCode":
				return [{type: "inlineCode", value: node.value}];
			case "break":
				return [{type: "break"}];
			case "strong":
			case "emphasis":
			case "delete":
				return [{type: node.type, children: inlineOf(node.children)}];
			case "link": {
				const url = webOf(node.url);
				const children = inlineOf(node.children);
				return url === null ? children : [{type: "link", url, children}];
			}
			case "linkReference":
				return inlineOf(node.children);
			case "image":
			case "imageReference":
				return node.alt === null || node.alt === undefined || node.alt === ""
					? []
					: [{type: "text", value: node.alt}];
			default:
				// html and footnote references: nothing.
				return [];
		}
	});

/** mdast's blocks, narrowed: HTML, definitions and footnotes are left out. */
const blockOf = (nodes: readonly Mdast.RootContent[]): Block[] =>
	nodes.flatMap((node): Block[] => {
		switch (node.type) {
			case "heading":
				return [{type: "heading", depth: node.depth, children: inlineOf(node.children)}];
			case "paragraph": {
				const children = inlineOf(node.children);
				// A paragraph that was only HTML or an empty image is nothing at all.
				return children.length === 0 ? [] : [{type: "paragraph", children}];
			}
			case "list":
				return [
					{
						type: "list",
						ordered: node.ordered === true,
						start: node.ordered === true ? (node.start ?? 1) : null,
						spread: node.spread === true || node.children.some((i) => i.spread === true),
						children: node.children.map((item) => ({
							type: "listItem",
							checked: item.checked ?? null,
							children: blockOf(item.children),
						})),
					},
				];
			case "code":
				return [{type: "code", lang: node.lang ?? null, value: node.value}];
			case "blockquote":
				return [{type: "blockquote", children: blockOf(node.children)}];
			case "table":
				return [
					{
						type: "table",
						align: node.align ?? [],
						children: node.children.map((row) => row.children.map((c) => inlineOf(c.children))),
					},
				];
			case "thematicBreak":
				return [{type: "thematicBreak"}];
			default:
				return [];
		}
	});

/** A markdown text, read: mdast's root, its blocks as its children. */
export class Root extends Schema.Opaque<Root>()(
	Schema.Struct({type: Schema.Literal("root"), children: blocks}),
) {
	static fromMarkdown(text: string): Root {
		const tree = fromMarkdown(text, {extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()]});
		return {type: "root", children: blockOf(tree.children)};
	}
}
