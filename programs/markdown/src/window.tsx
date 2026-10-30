import type {WindowProps} from "@kampus/fabrika";
import type {markdown} from "./index.ts";
import type {Block} from "./root.ts";

// The markdown program's window: its blocks drawn as HTML, one element each, in the page's own
// order. It holds no state and sends only `quit`, on the `q` key, as less does.

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

const same = (s: string) => s;

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function Drawn({block}: {readonly block: Block}) {
	switch (block.type) {
		case "heading": {
			const H = HEADINGS[block.depth - 1] ?? "h6";
			return <H>{block.text}</H>;
		}
		case "paragraph":
			return <p>{block.text}</p>;
		case "list": {
			const items = keyed(block.items, same).map((k) => <li key={k.key}>{k.value}</li>);
			return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
		}
		case "code":
			return (
				<pre>
					<code data-lang={block.lang ?? undefined}>{block.value}</code>
				</pre>
			);
		case "blockquote":
			return <blockquote>{block.text}</blockquote>;
		case "table":
			return (
				<table>
					<thead>
						<tr>
							{keyed(block.head, same).map((k) => (
								<th key={k.key}>{k.value}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{keyed(block.rows, (r) => r.join("|")).map((row) => (
							<tr key={row.key}>
								{keyed(row.value, same).map((k) => (
									<td key={k.key}>{k.value}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			);
		case "thematicBreak":
			return <hr />;
	}
}

export function MarkdownWindow({view, send}: WindowProps<typeof markdown>) {
	return (
		<article
			className="markdown"
			aria-label="markdown"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the q key, as less does.
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "q") send({type: "do", value: {kind: "quit"}});
			}}
		>
			{keyed(view.children, (b) => JSON.stringify(b)).map((k) => (
				<Drawn key={k.key} block={k.value} />
			))}
		</article>
	);
}
