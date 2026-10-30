# markdown: `@tea-fabrika/markdown`

Draws any markdown it is told, as `glow` or `less` draws it in a terminal: in a window of its
own. Not for experiments alone. Each text told replaces the one shown; it ends on quit, as `q`
ends `less`. The fabrika app lists it and knows its window.

```ts
import {Root} from "@tea-fabrika/markdown/root";

Root.fromMarkdown("# Hi\n\nSome *text*.\n\n- a\n- b");
// {type: "root", children: [
//   {type: "heading", depth: 1, text: "Hi"},
//   {type: "paragraph", text: "Some *text*."},
//   {type: "list", ordered: false, items: ["a", "b"]}]}
```

```text
tsh> markdown --text "# Hi"               a window with one heading
tsh> experiment --n 170 | markdown        the page, drawn
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/markdown` | `src/index.ts` | `markdown`, the program: flag `text`, inputs `text` and `quit`, one machine `page`, and its `view`, the blocks. No React. |
| `@tea-fabrika/markdown/root` | `src/root.ts` | `Root` and `Block`: markdown read into blocks, in mdast's names (the syntax tree remark uses). |
| `@tea-fabrika/markdown/window` | `src/window.tsx` | `MarkdownWindow`, its window: each block as one HTML element. The `q` key sends quit. |

- The reader is small and reads the markdown this repo writes. It is not CommonMark: no nested
  lists, no setext headings, no HTML, no reference links, and inline marks (`**`, links) stay as
  typed. The known way is `mdast-util-from-markdown`; adding it is a dependency to choose.
- A pipe's end does not end it: a person reads, then quits.
- In a terminal, with no window, it draws nothing: tsh's printer cuts a text past 24 characters
  (experiment 170).
