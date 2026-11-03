# The guidelines page

The private page "<Area> guidelines" is a mockup round first and a write-up second. Its first
screen copies the mockup pages the owner liked: "Tile design guidelines", "Pipe marker: three
finalists", "Pipe colors: how many", "Color principles" and "Chat window for claude and codex:
mockup". The guidelines fold under the mockup, in the order keybindings, hot reload and modes
share. Check every box before you publish.

## Why the page looks like this

Measured on 2026-11-02, each page rendered at 1280x800 from its live source. The guideline pages
that came out as text soup had one design, a small demo and the words on the first screen. The
liked pages had several designs, a big real-looking screen and one line of words.

| Page | Designs you can switch | Mockup's share of the first screen | Words on the first screen, outside the mockup |
|---|---|---|---|
| Pipe marker: three finalists | 4, keys 1 to 4, "1 Today" first | about 89% | one line: the design, where it came from, its doubt |
| Tile design guidelines | 6 layouts in a list, 2 rare picks in menus | about 75% | the title and one caption line |
| Pipe colors: how many | 3 counts in a list | about 66% | one line |
| Chat window mockup | 10 states, 5 layouts, 2 programs, with keys | about 64% | one status line, and gap tags on the screen |
| Ask desk guidelines, before | Proposed or Today | about 24%, popup closed | a 3-line heading, two paragraphs, a 6-row table |
| Program guidelines | Proposed or Today | about 14% | a heading, a paragraph, a 7-row table, 16 buttons |

The ask desk's demo was also redrawn by hand, and it drifted from the built screen: boxed buttons
in the selected row where the build has quiet words, a different header, a made-up row, and a
footer that wrapped to two lines. The chat window mockup took its tokens from the app's
`window.css`. That is the start of the rule below: the demo is lifted, not redrawn.

The finalists page also showed four truly different designs. The ask desk and typography pages
showed rounds of one design: versions of a single idea. Rounds refine a pick; they do not replace
the choice between ideas. The liked pages could also be pressed: the tile page took clicks and
keys, and the chat window moved between its states.

## The first screen

- [ ] At 1280x800 the mockup fills about two thirds of the screen or more, opened in the state the
  study is about (the popup open, not the screen before it).
- [ ] Above it, one line only: the title at body size, "Proposed, not built" (or "Decided DATE, not
  built"), and link text naming the note, the experiment and the pull request. No hero heading and
  no lede. A "Skip to the guidelines" link comes first.
- [ ] One caption line for the design on screen: what it is and its doubt, as the finalists page
  writes "Today: tint only. From the fold note. Doubt: no cue but hue."
- [ ] What the build cannot show yet is a gap on the page, named where it would be (the chat
  window's dashed "gap G1" tags), never drawn as if it worked.

## The switches

They pass the Linear test: a list for what you change all the time, a menu for a rare change,
keys to move, and long text closed until asked.

- [ ] **Design:** Today, then each distinct design from step 5, then the rounds of the one picked,
  then Proposed and Linear, as a list at the left. Keys 1 to N.
- [ ] At least 3 distinct designs, each lifted and pressable, each with a why-not line: one or two
  plain lines on why it lost, tied to a principle or a shot ("lost on T2: the rec sits under the
  question, see the 2x2 shot"). The pick says why it won in the same way.
- [ ] Each design's tsh pipe line sits above its mockup, such as `outline | ticket`: one program per
  tile, each part that is another program's job in its own tile.
- [ ] **Layout:** the five from step 5 (one tile, side by side, stacked, 2x2, about 1024x700), as a
  list. `L` steps through them.
- [ ] **State:** what the study opens, such as the popup or the card. `S` steps through them.
- [ ] **Compare:** `C` puts two designs side by side at the same layout, as "Color principles" put
  "too loud", "ours" and "ours, focused" in one row.
- [ ] A rare change is a menu. No row holds more than about five buttons: rows of buttons were
  called overwhelming.
- [ ] Each view has a hash name, such as `#proposed-popup-side`, so a link opens that view. The
  keys are printed once, in one quiet line.
- [ ] At 390 wide the lists become menus above the mockup, and the mockup scales to the width as a
  whole. Nothing is cut off.

## The demo

- [ ] The screen from step 5, not a small toy drawn for the page: real tile, program and command
  names, and the real chassis around it.
- [ ] Lifted, not redrawn (step 9 of the skill): the built `window.css`, unchanged, and the DOM
  step 5 saved. Each design, layout and state is its own frame document. The page owns only what
  sits around the frame and the small script that passes presses out of it.
- [ ] Clickable. The keys and clicks the app takes work inside the demo, and each one moves to the
  saved state the real app reaches with that press. The states come from pressing the real build
  (step 5 saves each one), never from editing a saved DOM by hand.
- [ ] **Not shot.** A press with no saved state shows a short caption, "↓: not shot", where the
  result would be, and the screen stays as it is. A press the app ignores says "no change in the
  app". Nothing is faked to fill the gap.
- [ ] Focus shows: the demo has a ring when it takes the keys, and the app's own focus or selected
  row shows inside it. Start over (`0`) goes back to the state the view opened in.
- [ ] A log of what fired, one line per press (the key, the state it reached, or "not shot"), and a
  line for what a screen reader is told about the focused part.
- [ ] When the area has one (a key file, a program's source), that file is shown and changes live.
- [ ] Shown at its real size, scaled down as a whole. Never laid out again to fit the page.
- [ ] A round with no saved DOM shows its real shot, marked "shot". A shot takes no presses.
- [ ] The blocking check passed for every state a press can reach that has a step 5 shot: each
  frame beside its shot, at the same size and scale, with no difference in words, boxes or sizes.
  A state with no step 5 shot is named as unchecked. The side-by-sides are saved and named in the
  walk.

## Under the mockup: the guidelines, folded

- [ ] The whole idea in one sentence, at body size and weight, as "Avoid a mode. If you keep one,
  say it in words, and let Escape always leave."
- [ ] One row per principle: its number, its name, its mark and one line. Its body is folded, and
  opens on a click or `Enter`.
- [ ] Then, each folded: the smaller calls ("Your calls", or "Decided" once decided), today's running
  example, "Decided by the owner, DATE", "Built on what is settled" and "Made up for this page"
  (every name, number or screen that is not real).
- [ ] At most one table per section, and none on the first screen. Code sits only inside a fold.

## Inside a principle's fold

- [ ] One sentence that states it, and its mark.
- [ ] At most one small real table or one code block, when the principle needs it.
- [ ] **Try it:** "press X in the demo, watch Y", with the key named, and the design, layout or
  state it starts from.
- [ ] A **Today** verdict, a word and a glyph first ("follows", "breaks", "half"), then why.
- [ ] **Rules:** each one as "Rule K <name>", its mark and one line. A "Why" disclosure holds
  labeled rows: Why, Source (a short quote), Measured, Linear, Elm or OTP, Holds it (the type, test or refusal
  that enforces the rule: poka-yoke), Cost, Doubt, Try.
  Every rule has a Linear row, or "No Linear answer" with the reason.

## Today's running example, folded

- [ ] A what, today, where table, with `file:line`.
- [ ] The fixes offered, not filed (when the area has one), and the example in the new shape as code.
- [ ] A line pointing at the mockup's Today design, so the owner sees each break.

## Your calls, folded

- [ ] "N picks are open. Each has a lean and how sure it is." After the owner decides, this fold
  becomes "Decided": it shows each pick with the option chosen and its "Decided · NN%" mark, and
  no open count.
- [ ] Each call: a numbered question, then "NN% Lean: <answer>" or "No lean, the owner picks", then the options side by side,
  each labeled in words (the lean says so), then Why, Cost and Doubt rows.

## Marks

- [ ] State colors (below) always come with a word or shape: "done ✓", "running ●", "stuck ✕",
  "your turn". A lean is "Lean · NN%" in a dashed outline. Decided is "Decided" in a solid outline. Once decided,
  a lean's mark reads "Decided · NN%", with the number kept, as the note keeps its numbers. A
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

The pipeline page (PR 290) now has views, the fabrika palette and highlighting, so its look is
no longer the reason to avoid it. It is still not the model for the structure: it has no demo, no
Try it and no disclosures. Fold the guidelines in the modes page's order, and take the pipeline
page's palette as a second reference. Neither is the model for the first screen: the mockup
pages above are.

## Test browser files

Playwright MCP saves files only under the main checkout's `.playwright-mcp/`. After a check, move
your own files out of it. Never delete anyone else's.
