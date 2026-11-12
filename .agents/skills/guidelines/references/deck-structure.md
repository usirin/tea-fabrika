# The guidelines deck and its prototype

The private "<Area> guidelines" is one Design canvas with the design system installed
([drawn on Claude Design](../../../../docs/direction/design-on-claude-design.md)). It holds a deck
that walks the story, the way a designer presents work, and ends in a clickable prototype of the
pick. Check every box before you publish.

```text
<Area> guidelines, one Design canvas
  the deck       1280x720 slides, one idea each: question, settled, makers, today,
                 principles, designs, rounds, proof, presses, calls, limits
  the prototype  the pick at five layouts, then each other design at one tile,
                 every key and click the principles name wired to a state
  the evidence   step 5's real shots, uploaded, on the proof slides beside the prototype
```

## What Claude Design gives us

Read in the Design and Slides types' own docs on 2026-11-06. These set the shape below.

- **A Design artboard can be pressed.** Its script holds state (`setState`), and markup takes
  handlers such as `onClick="{{ pick }}"`. An artboard marked `"is_interactive": true` gets a Play
  button. Each artboard keeps its own state, so a flow that shares state is one artboard with one
  `<sc-if>` per screen.
- **Artboards link.** `<a href="Next.dc.html">` moves Play to that artboard. That is how the deck
  pages forward and back. `<dc-import>` mounts one artboard inside another with props, which is how
  a slide shows the prototype at a given state.
- **No page-wide key handler.** The type forbids a global keydown handler. Keys reach a handler on
  a focused element only. So the prototype's window takes focus, and keys go to it. Slides page
  by their links, not by arrow keys.
- **No `<iframe>`.** The real build's DOM cannot be framed in, which is fine: the prototype is built
  on the system's real parts, not lifted.
- **The type tells an agent not to check its own render.** So the blocking check is the owner's
  look, with the real shots beside the prototype.
- **The Slides type cannot hold a prototype.** Its live embed is a sandboxed page of 16 KB at most
  that viewers cannot click or type into, and it cannot load the system's bundle. So the deck is
  slides drawn as artboards on the canvas, not a Slides artifact.
- **Not yet tried:** focusing the window when Play opens it (a ref and `componentDidMount`, which
  the format lists). If it does not take, the first click on the window gives it the keys, and
  the line under the window says so.

## Why it looks like this

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

The ask desk's demo was redrawn by hand, and it drifted from the built screen: boxed buttons in
the selected row where the build has quiet words, a different header, a made-up row, and a footer
that wrapped to two lines. The next pages lifted the built DOM instead, which could not drift, but
a press nobody had captured said "not shot", and the owner turned that down on 2026-11-06. The
prototype keeps both lessons: it is built from real parts, so a button is the button, and it is
held to the real shots, so it cannot drift unseen.

The finalists page also showed four truly different designs. The ask desk and typography pages
showed rounds of one design: versions of a single idea. Rounds refine a pick; they do not replace
the choice between ideas. The liked pages could also be pressed: the tile page took clicks and
keys, and the chat window moved between its states.

## The canvas

Follow the canvas type's own instructions for every file. These boxes are ours, on top.

- [ ] The design system is installed, as the canvas type says: its `tokens.json` copied in and its
  record in the canvas's index. Each artboard loads the system's files after `support.js`, in the
  order its README gives.
- [ ] The first slide is `Main.dc.html`, and the canvas launches focused on it, so the owner meets
  the story first.
- [ ] Rows read top to bottom: the story, the principles, the designs, the proof, the calls, then
  the prototype rows. A title note above each row names it.
- [ ] Every slide is marked `"is_interactive": true`, since its Back and Next links work in Play.

## The plain walk page

This checklist applies to the owner's plain page and its single-file HTML copy. The canvas
still follows its type's rule against an agent checking its own canvas render. Its blocking
check remains the owner's look at the proof slides.

- [ ] One selected design per screen. Today's version is on the left, the selected design on
  the right, with a label on each. The page never packs three or four frames into one row.
- [ ] The distinct designs from step 5 remain available. The walk switches designs between
  screens or steps instead of squeezing them all into the same view.
- [ ] Both screens use their real dimensions at 1:1 size. No zoom, scaling or smaller layout
  makes them fit. The page scrolls when the pair needs more space.
- [ ] Real parts, real words and states, and working keys and clicks match step 9's prototype
  rules. A missed press is fixed before the page is sent.
- [ ] Lead captured the plain page at 1440x900 and looked at the capture. Left and right order,
  sizes, scrolling and the selected design are right. Clipping or crowding is fixed.
- [ ] One HTML copy contains all styles, scripts, fonts, images and real parts inline. The
  owner's side panel needs no other file or server.
- [ ] Lead opened that copy and checked its keys, clicks and states before sending it. The
  1440x900 look and the inline-copy check do not apply to the canvas.

## The slides

Each slide is a 1280x720 artboard with one idea. A proof slide may be wider, as the two screens
side by side need.

- [ ] Every slide has Back and Next links at the bottom right and its number, "3 / 14". The links
  are `<a href>` styled as buttons, never a `<button>` inside an `<a>`.
- [ ] Slide text uses the system's tokens for color and font, and one slide scale of four sizes:
  40 for a title, 26 for a lead line, 20 for body, 16 for a label. Inside an app window, every text
  takes one of the six text styles and no size is set by hand.
- [ ] One idea per slide. A longer why goes in a sticky beside the slide, not on it, and its full
  text lives in the experiment.
- [ ] Tables are real `<table>` elements, at most one per slide. Code sits only where a principle
  needs it, highlighted as below.

The slides, in order:

- [ ] **The question.** The title, "Proposed, not built" (or "Approved DATE, not built"), the scope
  line from step 1, and the names of the page, the experiment and the pull request. No hero
  heading and no lede.
- [ ] **What is settled.** Each decided point with its source, marked "Decided".
- [ ] **How the makers do it.** The plain way they agree on, one line per tool, and the two or three
  tools from another field with what each teaches. Where it clashes with a goal of ours, one line.
- [ ] **Today.** The running example's real shot, with each principle it follows or breaks,
  "follows", "breaks" or "half", each with a word and a glyph.
- [ ] **One slide per principle.** Its number, name and kind (law, lint or taste), its mark ("Lean ·
  NN%" or "No lean, the owner picks"), the one sentence that states it, its rules as one line each,
  the Linear row in one line, and **Try it:** "press X in the prototype, watch Y", with the state
  it starts from.
- [ ] **One slide per design.** Its tsh pipe line on top, such as `outline | ticket`, its shot at one
  tile, its prototype beside it (mounted with `<dc-import>`), and one or two plain lines on why it
  lost or won, tied to a principle or a shot ("lost on T2: the rec sits under the question, see the
  2x2 shot"). At least 3 distinct designs from step 5, with Today before them and Linear's closest
  screen after.
- [ ] **The rounds of the pick.** Each round's shot, what changed and what still looks off.
- [ ] **The proof.** Each prototype state beside its step 5 shot, at the same size and scale, one
  layout per slide, the shot marked "shot". These are what the owner looks at.
- [ ] **Every press.** The press checklist (below), as a table.
- [ ] **Your calls.** "N picks are open. Each has a lean and how sure it is." Each call: a
  numbered question, "NN% Lean: <answer>" or "No lean, the owner picks", the options side by side
  labeled in words, then why, cost and doubt. Once decided, the title becomes "Decided" and each
  pick shows its "Decided · NN%" mark.
- [ ] **What it cannot tell us,** and "Made up for this deck": every name, number or screen that is
  not real.
- [ ] **The prototype,** last: the pick at one tile, big, with one line on how to use it ("Click the
  window, then press the keys from the principle slides").

## The prototype

```js
// A sketch, read from the Design type's format docs on 2026-11-06, not yet run on a canvas.
// The pick's prototype artboard: one model, one update, one view. Screens and keys are made up.

// update: one row per press in each screen. A press with no row is a bug, never a label.
function update(m, press) {
	switch (`${m.screen} ${press}`) {
		case "list j":
			return { ...m, row: Math.min(m.row + 1, m.rows - 1), why: null };
		case "list Enter":
		case "list click:row":
			return { ...m, screen: "detail", why: null };
		case "detail Escape":
			return { ...m, screen: "list", why: null };
		case "list Escape":
			return { ...m, why: "nothing to close, the app ignores it" };
	}
	return null;
}

class Component extends DCLogic {
	frame = React.createRef();
	componentDidMount() {
		this.frame.current?.focus();
	}
	renderVals() {
		const m = this.state.m ?? { screen: this.props.start ?? "list", row: 0, rows: 3 };
		const press = (p) => {
			const next = update(m, p) ?? { ...m, why: `${p}: no row, a bug in the prototype` };
			this.setState({ m: next, last: `${p} to ${next.screen}${next.why ? `, ${next.why}` : ""}` });
		};
		return {
			frame: this.frame,
			onKey: (e) => press(e.key),
			isList: m.screen === "list",
			isDetail: m.screen === "detail",
			last: this.state.last ?? "Click the window to give it the keys",
		};
	}
}
```

```html
<!-- The view: the window is one focusable element; the screens are real parts inside it. -->
<section tabindex="0" aria-label="outline, prototype" ref="{{frame}}" onKeyDown="{{onKey}}">
	<sc-if value="{{isList}}" hint-placeholder-val="{{true}}">…real parts from window.Fabrika…</sc-if>
	<sc-if value="{{isDetail}}" hint-placeholder-val="{{false}}">…</sc-if>
</section>
<p>{{last}}</p>
```

- [ ] One artboard per design and layout, each marked `"is_interactive": true`. The pick has all
  five layouts from step 5 (one tile, side by side, stacked, 2x2, about 1024x700). Each other
  design has one tile at least. One prototype file per design takes `start` and `layout` props, so
  the layout artboards and the proof slides mount it with `<dc-import>`.
- [ ] The screen from step 5, not a small toy: real tile, program and command names, and the real
  chassis around it, at its real size. Its words, names and keys are copied once from step 5's
  saved states. A keys line comes from its program's `commands` table plus `refuse`.
- [ ] Real parts: Manti's and ours, mounted from `window.Fabrika` by name. Layout is plain markup
  on the system's tokens. No font size, color or `--manti-*` token is set by hand, and every text
  takes one of the six text styles.
- [ ] The update is a table of presses: every key and click the principles name has a row in every
  state where it matters, and every other key the screen takes has one too. A press the app ignores
  is a row that says why.
- [ ] The window is one focusable element with its own key handler. It takes focus when Play opens
  it, a click on it gives the keys back, and a ring shows while it has them. No page-wide key
  handler. Real parts that take keys themselves keep doing so.
- [ ] A log line under the window answers every press: the key or click and the state it reached,
  or why the app ignores it. Start over (`0`) goes back to the state the artboard opened in.
- [ ] A line for what a screen reader is told about the focused part.
- [ ] What Manti cannot draw yet is a gap tag where it would be (the chat window's dashed "gap G1"
  tags), and the press still moves the state. Today an edit inside a `TreeView` row is one:
  Manti's `TreeView` takes string labels only.
- [ ] Shown at its real size. A slide that needs it smaller scales it as a whole, never lays it out
  again.

## The press checklist

The agent fills it from the prototype's update table and the principles' Try it lines and keys
tables, without rendering. The owner presses each row in Play during the look.

- [ ] One row per key or click a principle names: the press, the state it starts from, the state
  it reaches, the principle and Try it line it serves, and "shot" when that state has a real
  step 5 shot.
- [ ] Every row is ticked. A row with no state is a bug: fix the prototype and add the state, and
  shoot that state in the real build. It never ships as a label.
- [ ] A key the browser keeps for itself (such as Cmd-W) cannot reach the window: its row says so,
  and a click on its menu item in the prototype stands in.
- [ ] Every state has a real shot, and the owner looked once at this round, each proof slide's two
  screens side by side. Any difference in words, boxes or sizes sends the round back: fix the
  prototype, not the shot.

## Marks

- [ ] State colors always come with a word or shape: "done ✓", "running ●", "stuck ✕",
  "your turn". A lean is "Lean · NN%" in a dashed outline. Decided is "Decided" in a solid outline. Once decided,
  a lean's mark reads "Decided · NN%", with the number kept, as the experiment keeps its numbers. A
  breaks or follows verdict carries its word and a glyph. The word always carries the meaning.
- [ ] Color is never the only cue (WCAG 1.4.1). Focus shows a ring. Colors come from the system's
  tokens, never a palette typed by hand.

## Code is highlighted at build time

A code block on a slide is highlighted with `@pierre/highlights` 0.3.0, with the theme the
markdown tile uses, `github-dark-dimmed` (`programs/markdown/src/highlight.ts`). A script makes
the spans once, and they go into the slide's markup. No highlighter runs in the artboard. A token
in the theme's own ink gets no color, so the system's text color shows, as in the app.

```js
// highlight.mjs. Run it from a folder where the package resolves:
//   cd programs/markdown && node <scratch>/highlight.mjs
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

- `lang` is a name the package knows: `ts`, `tsx`, `js`, `json`, `toml`, `sh`. A trace or a plain
  list is `text`, which it reads as plain.
- Code wraps (`white-space: pre-wrap; overflow-wrap: anywhere`), and no box has its own scroll bar.

## Test browser files

Playwright MCP saves files only under the main checkout's `.playwright-mcp/`. After a check, move
your own files out of it. Never delete anyone else's.
