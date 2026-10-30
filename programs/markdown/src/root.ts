import {Schema} from "effect";

// Markdown read into blocks, in mdast's names (the syntax tree unified and remark use): a `root`
// whose children are headings, paragraphs, lists, code, quotes, tables and breaks. Only the block
// level: a block's text keeps its inline marks (`**`, `` ` ``, links) as they were typed.
//
//   Root.fromMarkdown("# Hi\n\nSome *text*.\n\n- a\n- b")
//   // {type: "root", children: [
//   //   {type: "heading", depth: 1, text: "Hi"},
//   //   {type: "paragraph", text: "Some *text*."},
//   //   {type: "list", ordered: false, items: ["a", "b"]}]}
//
// It is a small reader for the markdown this repo writes, not CommonMark: no nested lists, no
// setext headings, no HTML, no reference links. A line it does not know is a paragraph's.

export const Block = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("heading"),
		depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(6)),
		text: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("paragraph"), text: Schema.String}),
	Schema.Struct({
		type: Schema.Literal("list"),
		ordered: Schema.Boolean,
		items: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("code"),
		lang: Schema.NullOr(Schema.String),
		value: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("blockquote"), text: Schema.String}),
	Schema.Struct({
		type: Schema.Literal("table"),
		head: Schema.Array(Schema.String),
		rows: Schema.Array(Schema.Array(Schema.String)),
	}),
	Schema.Struct({type: Schema.Literal("thematicBreak")}),
]);
export type Block = typeof Block.Type;

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^(```|~~~)\s*(\S*)/;
const ITEM = /^\s{0,3}(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ALIGN = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A table row's cells, split on the `|` that are not escaped, the escapes undone. */
const cells = (line: string): string[] =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/(?<!\\)\|$/, "")
		.split(/(?<!\\)\|/)
		.map((c) => c.trim().replaceAll("\\|", "|"));

/** The blocks of a markdown text. */
const blocks = (text: string): Block[] => {
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	const out: Block[] = [];
	let i = 0;
	/** Lines from `i` while `keep` holds. */
	const run = (keep: (line: string) => boolean): string[] => {
		const taken: string[] = [];
		while (i < lines.length && keep(lines[i] ?? "")) taken.push(lines[i++] ?? "");
		return taken;
	};
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.trim() === "") {
			i++;
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence !== null) {
			i++;
			const body = run((l) => !l.startsWith(fence[1] ?? "```"));
			i++;
			out.push({
				type: "code",
				lang: fence[2] === "" ? null : (fence[2] ?? null),
				value: body.join("\n"),
			});
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading !== null) {
			i++;
			out.push({type: "heading", depth: heading[1]?.length ?? 1, text: heading[2] ?? ""});
			continue;
		}
		if (RULE.test(line)) {
			i++;
			out.push({type: "thematicBreak"});
			continue;
		}
		if (line.trimStart().startsWith(">")) {
			const quoted = run((l) => l.trimStart().startsWith(">"));
			out.push({
				type: "blockquote",
				text: quoted.map((l) => l.trimStart().replace(/^>\s?/, "")).join("\n"),
			});
			continue;
		}
		if (line.trimStart().startsWith("|") && ALIGN.test(lines[i + 1] ?? "")) {
			const head = cells(line);
			i += 2;
			const rows = run((l) => l.trimStart().startsWith("|")).map(cells);
			out.push({type: "table", head, rows});
			continue;
		}
		const item = ITEM.exec(line);
		if (item !== null) {
			const ordered = item[2] !== undefined;
			const items: string[] = [];
			// An item goes on over the lines indented under it, until a blank line or a new item.
			for (const l of run((l) => l.trim() !== "" && (ITEM.test(l) || /^\s+\S/.test(l)))) {
				const next = ITEM.exec(l);
				if (next !== null) items.push(next[3] ?? "");
				else items[items.length - 1] = `${items.at(-1) ?? ""} ${l.trim()}`;
			}
			out.push({type: "list", ordered, items});
			continue;
		}
		const para = run(
			(l) =>
				l.trim() !== "" &&
				!HEADING.test(l) &&
				!FENCE.test(l) &&
				!l.trimStart().startsWith(">") &&
				!ITEM.test(l),
		);
		// Every line the branches above leave has text, so a paragraph takes at least this one.
		if (para.length === 0) i++;
		else out.push({type: "paragraph", text: para.map((l) => l.trim()).join(" ")});
	}
	return out;
};

/** A markdown text, read: mdast's root, its blocks as its children. */
export class Root extends Schema.Opaque<Root>()(
	Schema.Struct({type: Schema.Literal("root"), children: Schema.Array(Block)}),
) {
	static fromMarkdown(text: string): Root {
		return {type: "root", children: blocks(text)};
	}
}
