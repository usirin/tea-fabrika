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
  labeled rows: Why, Source (a short quote), Measured, Linear, Elm or OTP, Cost, Doubt, Try.
  Every rule has a Linear row, or "No Linear answer" with the reason.

## Today's running example

- [ ] A what, today, where table, with `file:line`.
- [ ] The fixes offered, not filed, and the example in the new shape as code.
- [ ] The demo can switch between "Proposed" and "Today", so the owner sees each break.

## Your calls

- [ ] "N picks are open. Each has a lean and how sure it is."
- [ ] Each call: a numbered question, then "NN% Lean: <answer>", then the options side by side,
  each labeled in words (the lean says so), then Why, Cost and Doubt rows.
- [ ] Previous and Next buttons through the calls.

## The demo window

- [ ] A small fabrika window drawn in the page: real tile, program and command names, with a
  setting that changes where it runs or which version it shows, and Start over.
- [ ] A log of what fired, as the ledger or the brain would write it, and a line for what a screen
  reader is told.
- [ ] When the area has a file (a key file, a program's source), that file is shown and changes
  live.

## Marks

- [ ] A lean is "Lean · NN%" in a dashed outline. Decided is "Decided" in a solid outline. A
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
- [ ] Looked at at 1280 and at 390 wide, every view, before publishing.
- [ ] The fabrika dark theme, the values from `apps/fabrika/src/window/window.css` `:root` (the
  names `theme.css` maps Manti onto), copied, not invented:

```css
:root {
	color-scheme: dark;
	--ground: oklch(0.178 0.004 260); /* --surface, n-2: the page */
	--raised: oklch(0.205 0.004 260); /* --surface-raised, n-3: panels and cards */
	--code: oklch(0.15 0.003 260); /* --surface-sunken, n-1: a code block, as the markdown tile */
	--line: oklch(0.256 0.004 260); /* --border-faint, n-5 */
	--ink: oklch(0.79 0.002 260); /* --text-secondary, n-11: body text and code's own ink */
	--strong: oklch(0.94 0.001 260); /* --text-primary, n-12: headings */
	--faint: oklch(0.625 0.004 260); /* --text-faint, n-9 */
	--focus: oklch(0.79 0.002 260); /* --focus, n-11 */
	--font: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
	--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
```

## Code is highlighted at build time

Every code block on the page is highlighted with `@pierre/highlights` 0.3.0, with the theme the
markdown tile uses, `github-dark-dimmed` (`programs/markdown/src/highlight.ts`). The page is
static, so the build script highlights and inlines the spans. No highlighter goes to the browser.
A token in the theme's own ink gets no color, so the page's `--ink` shows, as in the app.

```js
// build.mjs, the page's build script. Run it from a folder where the package resolves:
//   cd programs/markdown && node --input-type=module < <scratch>/build.mjs > <scratch>/index.html
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
