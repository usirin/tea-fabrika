# The guidelines page

The private page "<Area> guidelines" is where the owner presses each principle. Its structure is
the one keybindings, hot reload and modes share. Check every box before you publish.

## Layout

- [ ] One top bar: the title, one line that says which version and "Proposed, not built", and a
  link text naming the note, the experiment and the pull request. A "Skip to the guideline" link
  comes first.
- [ ] Three columns at 1280 wide: the list of views at the left, one view in the middle, the demo
  window at the right. Every view drives the same demo.
- [ ] The list of views: Overview, then the principles numbered 1 to N, then a view for today's
  running example, then Your calls. The current view is marked with `aria-current`, and
  ↑ ↓ or j k move through the list.
- [ ] At 390 wide the columns stack: the list, then the view, then the demo. Nothing is cut off.

## Overview

- [ ] The heading is the whole idea in one sentence, as "Avoid a mode. If you keep one, say it in
  words, and let Escape always leave."
- [ ] A lede: how many principles, that each has one example and one thing to press, and the
  running case by name.
- [ ] The running example traced in steps, as short rows: the press or save, then what each part
  does.
- [ ] One card per principle: its number, its name, its mark, and one line.
- [ ] A line pointing at today's view and at Your calls, with how many picks are open.
- [ ] Three disclosures: "Decided by the owner, DATE" (each decided point), "Built on what is
  settled" (the notes it stands on), "Made up for this page" (every name, number or screen that
  is not real).

## One view per principle

- [ ] A kicker, "Principle N of M", with its mark.
- [ ] The name as the heading, then one sentence that states it.
- [ ] At most one small real table or one code block, when the principle needs it.
- [ ] **Try it:** what to press in the demo, with the keys or buttons named, and what to watch.
- [ ] A **Today** verdict, a word and a glyph first ("follows", "breaks", "half"), then why.
- [ ] **Rules:** each one as "Rule K <name>", its mark and one line. A "Why" disclosure holds
  labeled rows: Why, Source (a short quote), Measured, Linear, Elm or OTP, Holds it (the type, test or refusal
  that enforces the rule: poka-yoke), Cost, Doubt, Try.
  Every rule has a Linear row, or "No Linear answer" with the reason.

## Today's running example

- [ ] A what, today, where table, with `file:line`.
- [ ] The fixes offered, not filed (when the area has one), and the example in the new shape as code.
- [ ] The demo can switch between "Proposed" and "Today", so the owner sees each break.

## Your calls

- [ ] "N picks are open. Each has a lean and how sure it is."
- [ ] Each call: a numbered question, then "NN% Lean: <answer>" or "No lean, the owner picks", then the options side by side,
  each labeled in words (the lean says so), then Why, Cost and Doubt rows.
- [ ] Previous and Next buttons through the calls.

## The demo window

- [ ] A small fabrika window drawn in the page: real tile, program and command names, with a
  setting that changes where it runs or which version it shows, and Start over.
- [ ] A log of what fired, as the ledger or the brain would write it, and a line for what a screen
  reader is told.
- [ ] When the area has one (a key file, a program's source), that file is shown and changes live.

## Marks

- [ ] State colors (below) always come with a word or shape: "done ✓", "running ●", "stuck ✕",
  "your turn". A lean is "Lean · NN%" in a dashed outline. Decided is "Decided" in a solid outline. A
  breaks or follows verdict carries its word and a glyph. The word always carries the meaning.

## Page rules

- [ ] Fonts: the app's sans stack, named fonts first: `Inter, system-ui, -apple-system, "Segoe
  UI", sans-serif`. Mono only for typed code, keys and file text.
- [ ] Tables are real `<table>` elements, or cards. A table is never drawn as text in a mono
  block.
- [ ] The page scrolls; nothing inside it does. Code wraps (`white-space: pre-wrap;
  overflow-wrap: anywhere`), and no box has its own scroll bar.
- [ ] Color is never the only cue (WCAG 1.4.1). Focus shows a ring. Motion stops under
  `prefers-reduced-motion`.
- [ ] Looked at at 1280 and at 390 wide, every view, on the local copy before publishing, and
  again on the published page.
- [ ] The fabrika dark theme is the built-in `fabrika` from `docs/direction/themes.md`: Radix
  3.0.0, gray slate, accent indigo. This is decided (the owner, 2026-11-01), and today's app moves
  to the same values. Keep the palette in this one block, with the values copied from the note's
  `[colors]`, not invented:

```css
:root {
	color-scheme: dark;
	--ground: #111113; /* ground, slate 1: the page */
	--raised: #18191b; /* raised, slate 2: panels and cards */
	--code: #0c0d0e; /* desk, the one value darker than slate 1: a code block */
	--hover: #ddeaf814; /* hover, slate a3 */
	--line: #d3edf81d; /* edge, slate a4: a line that carries no fact */
	--edge: #d6ebfd30; /* slate a6, Radix's subtle border: keys and buttons */
	--edge-strong: #d9edff40; /* slate a7, Radix's UI border: a hovered border, the lean outline */
	--ink: #edeef0; /* text, slate 12: body text and code's own ink */
	--strong: #edeef0; /* text, slate 12: headings, set apart by weight and size */
	--faint: #f1f7feb5; /* faint, slate a11 */
	--focus: #dfebfd6d; /* slate a9: the keyboard ring (below) */
	--turn: #3e63dd; /* turn, indigo 9: the "your turn" fill and its edge, nothing else */
	--on-turn: #ffffff; /* on-turn: text on the turn fill */
	--turn-text: #9eb1ff; /* turn-text, indigo 11: "your turn" as a word */
	--done: #71d083; /* done, grass 11 */
	--running: #ffca16; /* running, amber 11 */
	--stuck: #ff9592; /* stuck, red 11: stuck or broken */
	--font: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
	--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
```

- Three values are Radix steps the note does not name. `--edge` and `--edge-strong` are slate a6
  and a7, Radix's jobs for borders. `--focus` is slate a9, not the note's a8: a keyboard ring sits
  on a code block or a hovered row too, and a8 reads 2.90 to 3.00 there, under the 3:1 of WCAG
  1.4.11. The note's own repair rule steps a8 to a9, which reads 3.47 or more.
- Radix gives text two steps: 12 for text and 11 for low-contrast text. So body and headings are
  both slate 12, and `--faint` is a11.
- "Your turn" is a chip: the `--turn` fill with `--on-turn` text (5.21:1), or the word in
  `--turn-text`. No other color sits on the turn fill.

## Code is highlighted at build time

Every code block on the page is highlighted with `@pierre/highlights` 0.3.0, with the theme the
markdown tile uses, `github-dark-dimmed` (`programs/markdown/src/highlight.ts`). The page is
static, so the build script highlights and inlines the spans. No highlighter goes to the browser.
A token in the theme's own ink gets no color, so the page's `--ink` shows, as in the app.

```js
// build.mjs, the page's build script. Run it from a folder where the package resolves:
//   cd programs/markdown && node <scratch>/build.mjs > <scratch>/index.html
// Node refuses a script on stdin, so run it as a file. A fresh worktree has no node_modules:
// run it from `programs/markdown` in the main checkout, where the package is installed.
import {codeToTokens, isSupportedLanguage} from "@pierre/highlights";
import theme from "@pierre/highlights/themes/github-dark-dimmed";

const escape = (s) =>
	s.replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

// One <pre> of spans. Italic is Shiki's flag 1, bold 2.
const block = (code, lang) => {
	if (!isSupportedLanguage(lang)) return `<pre class="code"><code>${escape(code)}</code></pre>`;
	const {tokens, fg} = codeToTokens(code, {lang, theme, tokenizeMaxLineLength: 1000});
	const lines = tokens.map((line) =>
		line
			.map((t) => {
				const style = [
					t.color && t.color !== fg ? `color:${t.color}` : "",
					(t.fontStyle ?? 0) & 1 ? "font-style:italic" : "",
					(t.fontStyle ?? 0) & 2 ? "font-weight:600" : "",
				]
					.filter(Boolean)
					.join(";");
				return style ? `<span style="${style}">${escape(t.content)}</span>` : escape(t.content);
			})
			.join(""),
	);
	return `<pre class="code" data-lang="${escape(lang)}"><code>${lines.join("\n")}</code></pre>`;
};
```

```css
pre.code {
	background: var(--code);
	color: var(--ink);
	font: 12px/1.6 var(--mono);
	tab-size: 4;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
```

- `lang` is a name the package knows: `ts`, `tsx`, `js`, `json`, `toml`, `sh`. A trace or a plain
  list is `text`, which it reads as plain.
- A code block the demo changes live is built from spans the build made for each state, so the
  browser still runs no highlighter.

## Not the model

The pipeline page (PR 290) is one long column with no list of views, no demo, no Try it, no
Your calls and no disclosures, on a light theme with code in plain mono. Build from the modes
page's shape instead.

## Test browser files

Playwright MCP saves files only under the main checkout's `.playwright-mcp/`. After a check, move
your own files out of it. Never delete anyone else's.
