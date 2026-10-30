import type {WindowProps} from "@kampus/fabrika";
import {
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import {type Colors, colorsNow, loadColors, onColors, type Span, wantsColors} from "./highlight.ts";
import type {markdown} from "./index.ts";
import type {Block, Code, Inline} from "./root.ts";

// The markdown program's window: its tree drawn as React elements, one per node, never as an HTML
// string, so nothing in the text can become markup. It holds no state and sends only `quit`.
//
//   q              quit, as less does
//   j / k          down and up a line; space and b a page; g and G the top and the end
//   a link         opens in the person's own browser, through the app's one way out
//                  (`target="_blank"`: main refuses the window and hands an http or https URL on)
//   ```ts          a fenced block with a language is colored (./highlight.ts): plain text at
//                  once, colors when the highlighter has loaded, once for the page

/**
 * Each value with a key made from what it reads and how many alike came before it, so two items
 * that read the same still get keys of their own, and an unchanged block keeps its key.
 *
 *   keyed(["a", "b", "a"], (x) => x)   [{key: "a#0", value: "a"}, {key: "b#0", ...}, {key: "a#1", ...}]
 */
export const keyed = <T,>(values: readonly T[], text: (value: T) => string) => {
	const seen = new Map<string, number>();
	return values.map((value) => {
		const t = text(value);
		const n = seen.get(t) ?? 0;
		seen.set(t, n + 1);
		return {key: `${t}#${n}`, value};
	});
};

const json = (value: unknown) => JSON.stringify(value);

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** Inline nodes, drawn. */
const Phrasing = ({nodes}: {readonly nodes: readonly Inline[]}): ReactNode =>
	keyed(nodes, json).map(({key, value}) => inline(value, key));

/** One inline node, drawn. */
const inline = (node: Inline, key: string): ReactNode => {
	switch (node.type) {
		case "text":
			return <Fragment key={key}>{node.value}</Fragment>;
		case "inlineCode":
			return <code key={key}>{node.value}</code>;
		case "break":
			return <br key={key} />;
		case "strong":
			return (
				<strong key={key}>
					<Phrasing nodes={node.children} />
				</strong>
			);
		case "emphasis":
			return (
				<em key={key}>
					<Phrasing nodes={node.children} />
				</em>
			);
		case "delete":
			return (
				<del key={key}>
					<Phrasing nodes={node.children} />
				</del>
			);
		case "link":
			return (
				<a key={key} href={node.url} title={node.url} target="_blank" rel="noreferrer">
					<Phrasing nodes={node.children} />
				</a>
			);
	}
};

/** A tight list's item reads as a line, not a paragraph: its paragraphs drawn bare. */
const Item = ({blocks, tight}: {readonly blocks: readonly Block[]; readonly tight: boolean}) =>
	keyed(blocks, json).map(({key, value}) =>
		tight && value.type === "paragraph" ? (
			<Phrasing key={key} nodes={value.children} />
		) : (
			<Drawn key={key} block={value} />
		),
	);

const Blocks = ({blocks}: {readonly blocks: readonly Block[]}) =>
	keyed(blocks, json).map(({key, value}) => <Drawn key={key} block={value} />);

/** One span of code: its text as a child, in its color, or bare in the page's ink. */
const spanOf = (span: Span, key: string): ReactNode =>
	span.color === null && !span.italic && !span.bold ? (
		<Fragment key={key}>{span.text}</Fragment>
	) : (
		<span
			key={key}
			style={{
				color: span.color ?? undefined,
				fontStyle: span.italic ? "italic" : undefined,
				fontWeight: span.bold ? 600 : undefined,
			}}
		>
			{span.text}
		</span>
	);

/**
 * A fenced block, in color when `colors` is there and knows its language, else as plain text.
 * The same characters either way, so coloring it moves nothing on the page.
 */
export function CodeBlock({block, colors}: {readonly block: Code; readonly colors: Colors | null}) {
	const lines = useMemo(
		() => (colors === null || block.lang === null ? null : colors(block.value, block.lang)),
		[colors, block.value, block.lang],
	);
	return (
		<pre>
			<code data-lang={block.lang ?? undefined}>
				{lines === null
					? block.value
					: keyed(lines, json).map(({key, value: line}, i) => (
							<Fragment key={key}>
								{i === 0 ? null : "\n"}
								{keyed(line, json).map((span) => spanOf(span.value, span.key))}
							</Fragment>
						))}
			</code>
		</pre>
	);
}

/** A fenced block: drawn plain at once, and asking for the colors only when it names a language. */
function Fenced({block}: {readonly block: Code}) {
	const colors = useSyncExternalStore(onColors, colorsNow, colorsNow);
	const wants = wantsColors(block.lang);
	useEffect(() => {
		if (wants) void loadColors();
	}, [wants]);
	return <CodeBlock block={block} colors={wants ? colors : null} />;
}

const ALIGN = {left: "left", right: "right", center: "center"} as const;

function Drawn({block}: {readonly block: Block}): ReactNode {
	switch (block.type) {
		case "heading": {
			const H = HEADINGS[block.depth - 1] ?? "h6";
			return (
				<H>
					<Phrasing nodes={block.children} />
				</H>
			);
		}
		case "paragraph":
			return (
				<p>
					<Phrasing nodes={block.children} />
				</p>
			);
		case "list": {
			const items = keyed(block.children, json).map(({key, value: item}) => (
				<li key={key} className={item.checked === null ? undefined : "markdown-task"}>
					{item.checked === null ? null : (
						<input
							className="markdown-box"
							type="checkbox"
							checked={item.checked}
							disabled
							readOnly
						/>
					)}
					<Item blocks={item.children} tight={!block.spread} />
				</li>
			));
			return block.ordered ? <ol start={block.start ?? undefined}>{items}</ol> : <ul>{items}</ul>;
		}
		case "code":
			return <Fenced block={block} />;
		case "blockquote":
			return (
				<blockquote>
					<Blocks blocks={block.children} />
				</blockquote>
			);
		case "table": {
			const [head = [], ...rows] = block.children;
			const align = (i: number) => {
				const a = block.align[i];
				return a === null || a === undefined ? undefined : {textAlign: ALIGN[a]};
			};
			return (
				<table>
					<thead>
						<tr>
							{keyed(head, json).map(({key, value}, i) => (
								<th key={key} style={align(i)}>
									<Phrasing nodes={value} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{keyed(rows, json).map((row) => (
							<tr key={row.key}>
								{keyed(row.value, json).map(({key, value}, i) => (
									<td key={key} style={align(i)}>
										<Phrasing nodes={value} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			);
		}
		case "thematicBreak":
			return <hr />;
	}
}

/** The keys less reads, as scrolls of the page: by a line, by a page, or to an end. */
const scrollOf = (key: string, page: HTMLElement): ScrollToOptions | null => {
	const line = 40;
	// A page less one line for the keys' line, and one kept on screen, as less keeps one.
	const screen = page.clientHeight - 2 * line;
	switch (key) {
		case "j":
		case "ArrowDown":
			return {top: page.scrollTop + line};
		case "k":
		case "ArrowUp":
			return {top: page.scrollTop - line};
		case " ":
		case "f":
		case "PageDown":
			return {top: page.scrollTop + screen};
		case "b":
		case "PageUp":
			return {top: page.scrollTop - screen};
		case "g":
		case "Home":
			return {top: 0};
		case "G":
		case "End":
			return {top: page.scrollHeight};
		default:
			return null;
	}
};

export function MarkdownWindow({view, send}: WindowProps<typeof markdown>) {
	// The page is the view, so it is the one box that scrolls in the tile (the app's window.css).
	const page = useRef<HTMLElement>(null);
	// The page takes the keys as it opens, as less does: q works without a click first.
	useEffect(() => page.current?.focus(), []);
	const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === "q") {
			e.preventDefault();
			send({type: "quit", value: {}});
			return;
		}
		const to = scrollOf(e.key, e.currentTarget);
		if (to === null) return;
		e.preventDefault();
		e.currentTarget.scrollTo(to);
	};
	return (
		<article
			ref={page}
			className="markdown"
			aria-label="markdown"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes less's keys: q, j, k, space, g.
			tabIndex={0}
			onKeyDown={onKeyDown}
		>
			<div className="markdown-body">
				<div className="markdown-page">
					{view.children.length === 0 ? (
						<p className="markdown-empty">
							Nothing to show yet. Pipe text in, as <code>experiments | markdown</code>, or tell it{" "}
							<code>text</code>.
						</p>
					) : (
						<Blocks blocks={view.children} />
					)}
				</div>
			</div>
			<footer className="markdown-keys">
				<kbd className="markdown-key">q</kbd> quit <kbd className="markdown-key">j</kbd>{" "}
				<kbd className="markdown-key">k</kbd> scroll <kbd className="markdown-key">space</kbd> page
			</footer>
		</article>
	);
}
