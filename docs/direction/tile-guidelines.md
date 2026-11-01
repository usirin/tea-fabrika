# A tile stays quiet, says every fact in words, and every part is reached by keys

Decided 2026-11-01 by the owner, not built yet. This is about today's version, and `next/` reads it
as a lesson. It holds the written rules for every part of a tile, each tested against how Linear
would build it. [Pipe colors](./pipe-colors.md) and [color principles](./color-principles.md) came
first, and this note applies them.

```tsx
// A sketch. One region per open tile. Color decorates; a letter, a shape or a word says the fact.
<section className="tile focused" data-pipe="sky" aria-current="true"
         aria-label="tracker, t2, pipe A, 1 of 2, sends to ticket">
	<header className="titlebar">
		<span className="slot" aria-hidden="true">A</span> {/* a plain tile: a dot */}
		<h2 className="name">tracker</h2>
		<span className="tid" aria-hidden="true">t2</span>
	</header>
	<Body /> {/* the one place focus lands: a terminal or a view */}
</section>
```

- **Which version.** Every "today" claim is about `apps/fabrika` on main at this commit. `path:line`
  points at that code.
- **Tuval (layer 5).** `next/` is not in the tree yet, so carry-over rests on
  [the desktop layer](./the-desktop-layer.md). The rules name roles, tokens and facts, never
  Electron. A tile kept after a crash (`keep: "failed"`) follows the empty state's rule.
- **Not yet shot.** `apps/fabrika/shots.ts:235` only shoots 1440x900. Layout claims come from CSS
  arithmetic at 1024x700: one tile 1016x632, side by side 506x632, stacked 1016x314, 2x2 506x314.
  Nobody has looked at them in the built app.

## The bar

Subtle, accessible without apology, and never hard on the eyes. These are one bar, so no rule may
trade one for another.

- **Subtle:** a tile does not compete with its contents. A mark with no job goes.
- **Accessible:** WCAG 2.2 AA holds by default, with no setting needed. A preference only goes above
  that floor.
- **Easy on the eyes:** no full-chroma lines, no large bright areas, no motion on a tile, no pure
  white.
- **How it decides:** when a quiet color cannot carry a fact, add a word or a shape. Do not add more
  color.

## What Linear does

- **Lines.** Separators had "quietly proliferated", so the 2026 refresh rounds them, softens their
  contrast and uses fewer. Its principles: "Don't compete for attention you haven't earned" and
  "Structure should be felt not seen" ([refresh][r26]).
- **Theme.** Three inputs replace 98 variables: base color, accent color, contrast. It uses LCH, and
  the contrast input gives very high-contrast themes for accessibility ([2024 redesign][r24]).
- **Opacity.** The 2024 work explored opacities of black and white ([2024 redesign][r24]). Our alpha
  steps match that idea.
- **Hue.** The 2026 palette moved from "a cool, blue-ish hue" toward a warmer gray
  ([refresh][r26]). Slate differs. That is decided, so this is only a note.
- **Hover and selected.** Two states. Hover or arrow keys highlight an issue, `X` selects it for bulk
  actions, and a checkbox shows near the left edge on hover ([select issues][sel]). Fill values are
  not documented.
- **Status icons.** Name, color and description are editable (search index of
  [issue status](https://linear.app/docs/configuring-workflows); the page did not load). Shapes are
  not documented. *Inferred from linear.app's markup, read 2026-10-31:* the shape differs by status,
  the status icon is `aria-hidden` beside its word, and a priority icon is `role="img"` named "Medium
  Priority".
- **Panels and split.** Layouts are list, board, timeline, split and fullscreen, with side panels for
  meta properties ([2024 redesign][r24]). Split puts a list beside the focused issue
  ([2022 changelog](https://linear.app/changelog/2022-01-20-linear-preview-new-sidebar-and-team-icons)).
  Sidebars are slightly dimmer ([2026 changelog][cl26]).
- **Density.** It keeps "that rich density of information" ([refresh][r26]), after testing condensed
  to spacious ([2024 redesign][r24]). No density setting is documented.
- **Group or relationship.** Group headers are sticky with a count, and sub-issues nest under parents
  ([display options][disp]). A colored edge for a group is not documented. The refresh removed
  colored team icon backgrounds ([refresh][r26]).
- **Not documented anywhere we could find:** border values, row and header heights, focus rings,
  split gutters, empty and loading states, and an accessibility statement. Linear's site stylesheet
  did not load on 2026-10-31, so this note adds no new measurements.

Where Linear and the tiling tools differ. Linear has no tiling, so tmux and Tuval stay the defaults.

- **Focus.** Linear highlights a row (fill inferred); tmux [colors the active border][tmux]. So the
  edge changes, and so does the title's wash. The tile's body stays plain.
- **Title bar.** tmux's `pane-border-status` is an option; Tuval and [the fold note](./fold-not-tabs.md)
  put a bar on every tile. "Felt not seen" argues for less, but the bar is what lets the resting edge
  be this quiet.
- **Resize.** Tuval's separators are tab stops. tmux has only keys. We take tmux's answer (see
  [How sure](#how-sure-and-what-would-change-it)).

## Tokens

- **A tile is ours, not a Manti part.** Manti 0.13.0's `Card` has radius and padding tokens and no
  edge states, so the tile's tokens point at Manti's names ([UI on Manti](./ui-on-manti.md)).
- **Manti has no name for a resting edge.** It has `--manti-border` and `--manti-border-strong`. We
  try `--manti-border-subtle` with a pnpm patch first, as `patches/@manti-ui__react@0.13.0.patch`
  already does for types. A pull request to Manti brings evidence from that try, and asks the owner
  first.
- **The resting edge is slate a4 on every tile, plain or pipe.** It is the one bend
  [color principles](./color-principles.md#the-steps-and-their-jobs) records. The box does not change
  with a pipe: the title carries it. Only focus and hover take the pipe's color.
- **`--text-faint` takes a11, not a10.** Today it is `--n-9`, 5.29:1 on the tile's ground
  (`apps/fabrika/src/window/window.css:36`), so nothing fails yet. Once Radix's values arrive, its
  nearest step is a10 (`#e5edfd7b`), and that is 4.45:1, short of 4.5. So it goes straight to a11. The
  faint step and the name then share a color, and rank goes by position.

```css
/* A sketch. Radix Colors 3.0.0, dark alpha, over the ground #111113. */
:root {
	--tile-edge: #d3edf81d;       /* slate a4: --manti-border-subtle (new) */
	--tile-text: #f1f7feb5;       /* slate a11: --manti-text-muted, and --text-faint */
	--tile-text-on: #fcfdffef;    /* slate a12: --manti-text, and the letter */
	--tile-wash: #d8f4f609;       /* a2 */
	--tile-wash-on: #ddeaf814;    /* a3 */
	--tile-edge-hover: #d9edff40; /* a7: --manti-border */
	--tile-edge-on: #d9edff5d;    /* a8: --manti-border-strong */
	--tile-edge-loud: #f1f7feb5;  /* a11, only under more contrast */
}
[data-pipe="sky"]    { --tile-wash: #1171fb18; --tile-wash-on: #1184fc33; --tile-edge-hover: #2badfe8b; --tile-edge-on: #1db2fea9; --tile-edge-loud: #7cd3ffef; }
[data-pipe="pink"]   { --tile-wash: #f420bb12; --tile-wash-on: #fe37cc29; --tile-edge-hover: #fd62c87b; --tile-edge-on: #ff68c8a2; --tile-edge-loud: #ff8dcc; }
[data-pipe="teal"]   { --tile-wash: #12fbe60c; --tile-wash-on: #00ffe61e; --tile-edge-hover: #2efde85f; --tile-edge-on: #32ffe775; --tile-edge-loud: #0afed5d6; }
[data-pipe="violet"] { --tile-wash: #853ff916; --tile-wash-on: #8354fe36; --tile-edge-hover: #9879ff83; --tile-edge-on: #977dfea8; --tile-edge-loud: #baa7ff; }
[data-pipe="lime"]   { --tile-wash: #78f7000a; --tile-wash-on: #9bfd4c1a; --tile-edge-hover: #b6ff6f57; --tile-edge-on: #b6fd6d6c; --tile-edge-loud: #d1fe77e4; }
[data-pipe="plum"]   { --tile-wash: #f22ff211; --tile-wash-on: #fd4cfd27; --tile-edge-hover: #f07cfd70; --tile-edge-on: #ee84ff95; --tile-edge-loud: #f19cfef3; }

.tile, .strip { outline: 1px solid var(--tile-edge); outline-offset: -1px; } /* box-shadow dies in forced colors */
.titlebar, .strip { background: var(--tile-wash); color: var(--tile-text); } /* no line under the title */
.tile.focused { outline-color: var(--tile-edge-on); }
.tile.focused .titlebar { background: var(--tile-wash-on); }
.tile.focused .name { color: var(--tile-text-on); font-weight: 500; }
.tile.closing { outline-style: dashed; } /* keeps its step and its color */
.strip:hover { outline-color: var(--tile-edge-hover); }
.strip:focus-visible { outline: 2px solid var(--tile-edge-on); outline-offset: -2px; color: var(--tile-text-on); }

@media (prefers-contrast: more) {
	:root { --tile-edge: #d9edff5d; --tile-text: #fcfdffef; } /* slate a8 at rest, slate a12 text */
	.tile.focused { outline: 2px solid var(--tile-edge-loud); outline-offset: -2px; }
}
@media (forced-colors: active) { /* the wash is gone; the letter, the dot and the words stay */
	.tile, .strip { outline-color: CanvasText; }
	.tile.focused, .strip:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
	.slot { color: CanvasText; }
}
```

## The wash, in numbers

Computed from the package's hex, composited over `#111113`. The name at rest and the id are a11. The
letter, and the name when focused, are a12. The bars are
[1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), 4.5:1 for text, and
[1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), 3:1 for a needed state.

| Color | a11 on rest wash | a12 on rest wash | a11 on focused wash | a12 on focused wash | Focus edge on ground | Focus edge on focused wash |
|---|---|---|---|---|---|---|
| slate | 8.68 | 15.25 | 8.08 | 13.86 | 3.02 | **2.99** |
| sky | 8.62 | 15.12 | 7.67 | 13.04 | 4.07 | 3.60 |
| pink | 8.77 | 15.52 | 7.96 | 13.73 | 3.55 | 3.30 |
| teal | 8.60 | 15.08 | 7.56 | 12.81 | 3.87 | 3.64 |
| violet | 8.72 | 15.38 | 7.79 | 13.29 | 3.25 | **2.92** |
| lime | 8.70 | 15.31 | 7.76 | 13.19 | 3.60 | 3.44 |
| plum | 8.74 | 15.44 | 7.87 | 13.50 | 3.58 | 3.33 |

- **All text clears 4.5:1 by far.** The lowest is 7.56.
- **Two values are under 3:1.** Violet's focus edge is 2.92 on the focused title, as
  [pipe colors](./pipe-colors.md) says. Slate's is 2.99, which that note did not record. Both hold
  along the rest of the tile (3.25 and 3.02). Each crosses only 20px of title, and whether that passes
  needs a look at the built tile.
- **The wash carries no needed fact, and it could not.** Rest against ground is 1.05 to 1.08, focused
  against ground 1.19 to 1.29, focused against rest 1.11 to 1.19. The letter, the dot and the edge do
  that work.
- **Color blindness, simulated.** The standard 2009 matrices at full severity, on the focused wash, in
  OKLab, so a sketch and not a study. Normal vision's closest pair is pink and plum, 0.013. Deuteranopia:
  sky and violet, 0.006. Protanopia: pink and plum, 0.013. Tritanopia: sky and teal, 0.010. So to some
  people some pipes look the same, and the letter tells them apart.

## The rest, in numbers

| What | Step | Contrast | Holds? |
|---|---|---|---|
| Resting edge | slate a4 | 1.31 on ground | Only because the title bar identifies the tile |
| Focused against resting edge | a8 against slate a4 | 2.31 plain; 2.48 to 3.11 in a pipe | Under the 3:1 [1.4.1][c141] allows, except sky, so it needs a second cue |
| Strip hover | a7 | 2.05 plain; 2.39 to 3.04 in a pipe | Fine for hover, never for focus |
| Strip ring, on the strip's wash | a8, 2px | 3.03 plain; 3.18 to 3.94 in a pipe | Yes, plain by 0.03 |
| Faint text, on ground | a11, not a10 | 9.07; a10 was 4.45 | Yes |

## A tile is a region

A `<section>` with a name is a [region landmark, and each needs a unique label][apgl]. Today's `Tile`
is one, and the id makes it unique (`apps/fabrika/src/window/desk.tsx:477-484`). The rest changes.

- **Moving between regions**
  - Prefix keys stay the main way, as in tmux: `C-b h j k l` and arrows today. Add `C-b o` for the next
    tile and `C-b ;` for the tile focused before, both as [tmux][tmuxk] means them. Both are free in
    `apps/fabrika/src/desk/keys.ts:80-113`.
  - F6 and Shift-F6 cycle the open tiles, then the bars. They do not stop on strips; Tab does.
    [APG's window splitter][apgs] names F6 as optional, and [VS Code][vsc] uses it to move across its
    parts.
  - Four clashes.
    - A terminal program bound to F6 loses it.
    - [Chrome on Windows and Linux](https://support.google.com/chrome/answer/157179) uses F6. So a
      browser client lists F6 in its `cannot` keys ([the desktop layer](./the-desktop-layer.md)), and
      `C-b o` remains.
    - Mac laptops need Fn for F6 by default.
    - NVDA or JAWS in browse mode may eat a bare letter after `C-b` on a view's root, which needs a
      real run. No `role="application"` until a run says so.
  - A terminal keeps Tab for tsh, and `C-b` or F6 leaves it.
    [2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) allows that when the way
    out is told (`C-b ?`).
  - Elsewhere Tab moves normally, and desk focus follows DOM focus. Today Tab can leave a tile while
    its edge stays lit, since the desk's page has no focus handler
    ([2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html),
    [2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)).
  - Tab onto a strip does not open it and does not move desk focus, since desk focus is always on an
    open tile ([the fold note](./fold-not-tabs.md)). The strip shows its ring, and the tile's edge
    stays lit until Enter, Space or a click.
- **Where focus lands.** Fold or close: the next open tile in reading order
  (`apps/fabrika/src/desk/desk.ts:415`, `heirOf`). Unfold: the first tile it opens. A popover: back
  where it was ([popovers](./popovers.md)).
  - In the tile, focus goes to its last inner spot, else its body. A terminal lives outside React and
    keeps its state. A view is drawn again and loses it: `desk.tsx:736` goes to the view's root. Rule:
    remember the spot per tile, by a stable key.
  - A view's root keeps `tabindex="-1"`, never a tab stop.
- **What a screen reader hears on entering**
  - One function, `tileName`, beside `hereWord` in `apps/fabrika/src/window/frame.ts`, so the words
    cannot drift. Program first, so a landmark list scans well:
    `tracker, t2, pipe A, 1 of 2, sends to ticket`, then `, zoomed`, `, asking` or `, closing`.
  - Today's `a window of the line typed in t2` (`desk.tsx:475`) gives no order and no neighbor.
    `aria-current` stays, for browse mode.
  - The name in the bar is an `h2`, a second way in. A run should confirm it adds use and not chatter.
- **Landmark noise.** One `main` on `.workspace`, one region per open tile. A 2x2 desk is 4 regions, 1
  main and today's 2 navs (`apps/fabrika/src/window/frame.tsx:194,211`).
  - Today a tsh tile is 2 regions (`apps/fabrika/src/window/terminal.ts:78-80` adds `t2 screen`), and a
    program tile adds a `<main>` (`desk.tsx:438`).
    [HTML allows one visible `main`, with no sectioning ancestor](https://html.spec.whatwg.org/multipage/grouping-content.html#the-main-element).
    A covered tile also keeps its terminal text exposed under the view (`desk.tsx:505-506`), so a
    covered terminal goes `inert`.
  - A folded tile is not a region. It is a button in place, which is right. APG sets no limit on
    regions, so what is too many needs a run at 8 and 16 tiles.
- **The terminal inside**
  - ghostty-web gives each one `role="textbox"` and the same name, `Terminal input`. Rename it per
    tile.
  - `.screen-text` is right not to be live, since it is rewritten whole (`terminal.ts:75-80`). But
    output is silent, and today's only path to it is browse mode.
  - `C-b [` ([tmux's copy mode][tmuxk]) moves focus to the text, like [VS Code's buffer key][vsc]. It
    stops being a region of its own. A job that ended speaks politely.
- **[Forced colors](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors).**
  `box-shadow` becomes `none`, so today every tile edge, focus state and strip edge vanishes
  (`window.css:216,292,297`), and `.strip:focus-visible` also sets `outline: none` (`:251`). The wash
  goes too, which is fine: the letter stays. It is mainly a Windows setting, so it hits the browser
  client. Playwright can emulate it on a Mac.
- **[More contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast).** No
  rule today. It is our answer to Linear's contrast input. Resting edge slate a8, text a12, focus edge
  its color's a11 at 2px. Which macOS setting maps to it needs a run.
- **Reduced motion.** A tile has no motion, and that is the rule. State changes are instant.
- **Zoom.** Page zoom scales px and `area` comes in CSS px, so folding reacts. At 200% in 1024x700, 2x2
  tiles are about 250x140, above the 220x120 minimum. At 400%
  ([1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)) a tile fills the width and the
  rest fold, unless the layout counts as the two-dimensional exception. The terminal canvas under zoom
  is unchecked.

## What a screen reader is told

One polite and one assertive region, in the page from boot, since
[a region made with its content may not speak](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions).
`desk.tsx:508` makes one with its content today. The assertive one is `role="alert"`. If focus moves
there, say nothing. Never mirror a screen. Join bursts into one line
([4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).

| Event | Region | Words |
|---|---|---|
| Asking | Assertive | `close t2? (y/n)` |
| Closing | Polite | `t2 closing` |
| Program ends, unfocused tile | Polite | `tracker in t2 ended` |
| A job ends | Polite | `job in t2 ended` |
| Fold; zoom; resize | Polite | `ticket folded`; `t2 zoomed`; `t2 at 42%` |
| Prefix armed | Polite | `prefix` |
| Output, typing, focus moves | None | Nothing |

## The fold is the pattern to copy

The claim mostly holds, by reading the code and not by a run. Other parts should copy these:

- **A real `<button>` with real text.** Enter and Space come free.
- **Its name says the action and holds what you see:** `open map, t4` contains `map` ([2.5.3][c253]).
- **It sits where the tile was,** so reading order matches the layout. Folded content leaves the tree,
  with no hidden region or stale text.
- **One fact drives it:** a boolean on the tile, a folded container worked out, and "nothing open"
  refused by `fold` and `checkTree`.
- **Focus always has a home,** and Tab reaching a strip does not open it. Programs know nothing about
  it, so none can break it.

Gaps found:

- **Focus ring.** `outline: none` with box-shadow only (`window.css:247-252`), so invisible in forced
  colors. A plain strip's focus edge is `--n-7`, 1.50:1, under 3:1. A pipe's strip does not even get
  that: `.strip[data-tint]` (`:383-387`) has the same weight and comes later, so its edge never
  changes, and only its text brightens.
- **Name.** It says nothing of the pipe (`desk.tsx:617`). A folded column says `open map · runs, c4`,
  and `c4` is shown nowhere.
- **The way in does not match.** The title bar's name teaches a pointer gesture (see Title bar).
- **State.** `folded` does not check `closing` (`apps/fabrika/src/desk/desk.ts:395`), so folding a
  closing tile hides that. No announcement on fold.
- **Target size.** 22 and 20px pass [2.5.8][c258] only by the spacing exception, with no room to spare.
- **`aria-expanded`: no gap.** The button goes when the tile opens, so
  [disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) does not fit. A run should confirm
  that.

## The parts

Layouts means one tile, side by side, stacked, 2x2 and 1024x700. Sizes and gaps stay as they are today:
4px between two open tiles (`window.css:262-269`), 2px each side of a strip (`:228-241`). Tiles do not
touch.

### Edge

- **Job:** show where a tile ends. **Linear:** softer, fewer lines ([refresh][r26]); no colored edge
  documented.
- **Rule:** one 1px `outline`, slate a4 at rest on every tile. Nothing draws a second line around it.
- **Tokens:** `--tile-edge`, proposed `--manti-border-subtle`; more contrast slate a8; forced
  `CanvasText`.
- **Cue and keys:** not a required cue, since the title bar identifies the tile. **Layouts:** same in
  all.
- **Breaks:** `window.css:216,292,371,385-386` use box-shadow; `:68-74` and `:342-364` are the old
  oklch tints. Today's rest is `--n-5`, 1.20:1.

### Focused state

- **Job:** say which tile takes the keys. **Linear:** highlight by hover or arrows ([select
  issues][sel]); no tiling answer.
- **Rule:** one per workspace. Edge to a8, title wash to step 3, name to step 12 at weight 500. The
  tile's body stays plain.
- **Tokens:** `--tile-edge-on`, `--tile-wash-on`, `--tile-text-on`; more contrast a11 at 2px; forced 2px
  `Highlight`.
- **Cue and keys:** weight 500 and the terminal's solid cursor are the non-color cues. ghostty-web
  already draws the cursor hollow when blurred (`patches/ghostty-web@0.4.0.patch`). A view has no
  cursor, so there the weight stands alone. `aria-current="true"` and the region's name. `C-b` keys and
  F6 move it. **Layouts:** same in all. One tile still shows it. 2x2 is the thin spot, at 1px and
  3.02:1.
- **Breaks:** today's focus is `--n-9` (`window.css:41,296-298`), 5.29:1, with a text step and no weight.
  That is stronger than a8, so a8 is quieter on purpose. `:379-381` and `:463-467` drop focus on a
  closing tile.

### Hover

- **Job:** say what a pointer can do. **Linear:** hover highlights a row ([select issues][sel]). tmux
  does nothing, and a tile keeps tmux's answer.
- **Rule:** hovering a tile changes nothing. Only title bar text, strip and gap answer. Hover never moves
  focus.
- **Tokens:** bar text `--tile-text-on`; strip `--tile-edge-hover`, a7 in its own color; gap slate a7.
- **Cue and keys:** brighter text and the cursor's shape. Each hover has a keyboard twin. Nothing for a
  screen reader. **Layouts:** same in all. At 2x2 a lit edge would flicker as the pointer crosses tiles.
- **Breaks:** `window.css:247-252` draws hover and keyboard focus the same on a strip, at `--n-7`.

### Title bar

- **Job:** name the tile and hold its marks. **Linear:** headers made consistent ([2026
  changelog][cl26]); heights not documented.
- **Rule:** a `header`, not a `button`, 20px, no tab stop. Slot, name, state word, then the id at the far
  right. Id and state are never cut; the name cuts first. A double-click still folds, and `C-b f` is the
  key way. A press still takes no focus. No line under it, on any tile: color replaces, it does not add
  ([principle 6](./color-principles.md#the-eight)). Mono, as it is today (`window.css:315`).
- **Tokens:** `--tile-wash`, `--tile-text`, `--manti-text-sm`.
- **Cue and keys:** `C-b f` folds and the palette lists it. Dropping the button drops a dead tab stop.
  **Layouts:** the 220px minimum holds about 22 mono characters between the slot and the id, so `ticket
  #7` fits, and a question cuts the name. 506px has no squeeze.
- **Breaks:** `desk.tsx:488-498` is a button with no click or key action; `:491` its name lacks the
  visible `tracker` ([2.5.3][c253]) and teaches a double-click; `window.css:312` is the line under it;
  `:302-318` has no ellipsis rule.

### Program name

- **Job:** say what runs here. **Linear:** the current view is "presented more clearly"
  ([2024 changelog](https://linear.app/changelog/2024-03-20-new-linear-ui)); no wording rule documented.
- **Rule:** the same words as the bottom line (`tileWord`): `ticket #7`, `tracker`, `tsh`.
- **Tokens:** `--tile-text` at rest, `--tile-text-on` focused; `--mono`.
- **Cue and keys:** it is a word, first in the region's name. **Layouts:** ellipsis first when narrow,
  whole at 506px and up.
- **Breaks:** `desk.tsx:499` uses `nameOf` (`:415`), so the bar says `ticket` where
  `frame.ts:175` says `ticket #7`.

### Tile id

- **Job:** the handle other text uses, as in `close t2?`. **Linear:** not documented.
- **Rule:** far right, tabular digits, never cut, never below a11.
- **Tokens:** `--tile-text`, on rest wash or focused wash.
- **Cue and keys:** a word, `aria-hidden` in the bar since the region's name says it. **Layouts:** same
  in all, and it stays when the name cuts.
- **Breaks:** `window.css:469-478`: the closing note covers it. Its own color passes today (`:320-323`,
  `--n-9`, 5.29:1).

### Pipe marker

- **Job:** say this tile is in a pipe, and which. **Linear:** not documented for this. Nearest are
  nesting, group headers and status words.
- **Rule:** title wash, one of six colors, and a letter in a12. A plain tile shows a dot in the same slot,
  so a name never moves when a tile joins or leaves a pipe. The wash was chosen by eye, and the letter is
  the second cue. [Pipe colors](./pipe-colors.md) holds the values, the order and the reasons.
- **Tokens:** `--tile-wash`, `--tile-wash-on`, `--tile-text-on` for the letter; `--tile-text` for the dot;
  forced `CanvasText`.
- **Cue and keys:** letter and dot hold without color. Both are `aria-hidden`; the region's name says
  `pipe A, 1 of 2, sends to ticket`. **Layouts:** same in all. On a strip the letter turns with the name.
- **Breaks:** `desk.tsx:499` has no mark, so tint is the only visual cue. The bottom line names a pipe only
  for the focused tile (`frame.ts:430`), and the top bar shows one pipe when two are open
  (`frame.ts:207-219`).

### Asking marker

- **Job:** say this tile waits for y or n. **Linear:** not documented.
- **Rule:** words in the bar's state slot and on the bottom line ([popovers](./popovers.md)), one
  announcement. `role="alert"`, not `alertdialog`: no dialog opens and no focus moves. No accent.
- **Tokens:** `--tile-text-on`; separator slate a8.
- **Cue and keys:** words. `y`, `n` or a click answers. Assertive once. **Layouts:** fits at 506px. At
  220px the name cuts first and the question shows.
- **Breaks:** `desk.tsx:502` sits inside a button whose `aria-label` hides it; `frame.tsx:736` uses
  `alertdialog` with no focus moved, while [the pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
  moves focus in.

### Fold strip

- **Job:** keep a folded tile in its place and open it. **Linear:** a
  [collapsible sidebar](https://linear.app/changelog/unpublished-collapsible-sidebar) only; no in-place
  fold, so [our fold note](./fold-not-tabs.md) stands.
- **Rule:** the pattern above, the same wash and letter as its tile, a name that carries the pipe and
  `closing`, and a real focus ring. A strip for a folded column takes a pipe's wash only when all its tiles
  are in that one pipe.
- **Tokens:** `--tile-wash`; text `--tile-text`, hover `--tile-text-on`; edge as Edge, hover a7; ring a8,
  2px.
- **Cue and keys:** a word, read sideways. Enter, Space or a `C-b` direction opens it. Tab stops on it; F6
  skips it. **Layouts:** upright 22px side by side, lying 20px stacked. A pipe of 3 in 506px folds two,
  since each would be 167px.
- **Breaks:** see the gaps above.

### Closing state

- **Job:** say the tile waits for its programs to end. **Linear:** not documented.
- **Rule:** a dashed edge at its own step and color, and the word `closing` in the state slot. No extra
  box. A closing tile at rest is dashed at a4, so faint that the word does the work.
- **Tokens:** `--tile-edge` or `--tile-edge-on`, dashed; word `--tile-text`.
- **Cue and keys:** dash and word; dashes survive forced colors. `C-b x` asks to stop it. Polite once, plus
  the region's name. **Layouts:** same in all. At 220px the word stays.
- **Breaks:** `window.css:379-381,463-467` drop tint and focus; `:469-478` a raised box covers the id;
  `desk.tsx:507-511` a live role made with its content.

### Empty and loading

- **Job:** never leave a blank tile. **Linear:** not documented. "Show empty groups" is a list option only
  ([display options][disp]).
- **Rule:** one word where the content will start. No spinner, no skeleton. The bar shows the program from
  the first frame.
- **Tokens:** `--tile-text`; `--manti-text-base`.
- **Cue and keys:** words. Focus lands on the body and stays when the view arrives. Silent unless it fails
  (`role="alert"`, as `desk.tsx:447` does). **Layouts:** same in all.
- **Breaks:** none today: `desk.tsx:445` says `starting`, at `--text-faint` (`window.css:491-494`). It must
  move to a11 with the token.

### Resize gap

- **Job:** space tiles and let you resize them. **Linear:** panels resize by dragging an edge
  ([newsletter, seen as a search
  result](https://newsletter.linear.app/issues/linear-changelog-my-issues-online-status-resizable-sidebars-240683));
  gutter not documented.
- **Rule:** 4px, empty at rest, a line on hover. `C-b C-arrow` and `C-b M-arrow` resize
  ([tmux][tmuxk]), and the palette lists them, a
  [2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) alternative. A resize says its
  percent. No focusable separators: `hr` stays decorative.
- **Tokens:** `--tile-edge-hover`, slate a7 on hover; slate a8 while dragging.
- **Cue and keys:** cursor and line. macOS takes Ctrl-arrows by default, so `M-` matters. **Layouts:** 4px
  in all but one tile, which has none.
- **Breaks:** `desk.tsx:584-589` not focusable, no value; `apps/fabrika/src/desk/keys.ts:80-113` no resize
  key, so [2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) fails. 4px fails [2.5.8][c258]
  alone: hit area 8px, with the palette as the equivalent.

### Bottom status line

- **Job:** say more about the focused tile, as tmux's status line does. **Linear:** not documented. Its meta
  goes in side panels ([2024 redesign][r24]).
- **Rule:** it adds to the title and never holds the only copy of a fact. Mono
  ([popovers](./popovers.md)).
- **Tokens:** `--tile-text`; prompt `--tile-text-on`; `--manti-text-sm`; no line above it.
- **Cue and keys:** words. F6 stops here. Focus moves are not announced from it. **Layouts:** one line in
  all. At 1024 a long `hereWord` plus a job can run out, and `bare` hides it, so title marks must stand
  alone.
- **Breaks:** `frame.tsx:742` the prefix word is not live; `frame.tsx:736` as above. Its color passes today
  (`window.css:693`, `--n-10`, 6.93:1).

### Zoomed and lost link

- **Zoomed.** Linear has a fullscreen layout ([2024 redesign][r24]); no marks documented. Rule: the word
  `zoomed` in the state slot and the region's name, polite once. `desk.tsx:792-801` shows no mark and says
  nothing.
- **Lost link.** Linear: not documented. Rule: dim and `inert` together (`desk.tsx:777`), and the top bar says
  why with `role="status"` (`frame.tsx:295`). Inactive parts sit outside 1.4.3 and 1.4.11. No break found,
  though `filter` in forced colors is unchecked (`window.css:510-513`).

## How sure, and what would change it

It is decided. These say what would change it, for each pick under 80%.

| Pick | How sure | Doubt | What settles it |
|---|---|---|---|
| Resting edge a4 | 70% | Low vision at 2x2, at 1.31:1 | A look at each step on the built app, and a low-vision user |
| Focus name at weight 500 | 75% | Too faint at 12px, and a mono font with no medium weight shows no change | A blur test on the built app |
| F6 does not stop on strips | 70% | Finding folded tiles from a terminal | A keyboard run with a screen reader |
| Resize by keys only | 70% | APG expects a separator | A keyboard run with a screen reader |
| Strip ring a8 | 75% | 3.03 is thin on a 22px strip, and it shares its step with the focused tile's edge | A look at the built app, with both in view |
| Title bar in mono | 70% | [Popovers](./popovers.md) puts `t2` in sans | A shot beside a popover |
| `C-b [` for a terminal's text | 70% | Reading one long block of text | A VoiceOver run |

The rest stand at 80% or more: `--text-faint` at a11 85%, `header` not `button` 85%, one `main` 90%, F6 with
`C-b o` and `C-b ;` 80%, desk focus following DOM focus 80%, `role="alert"` 80%, `--manti-border-subtle` by
patch 80%, no line under the title 85%. The wash, the letter and the six colors keep
[their own numbers](./pipe-colors.md).

## What it costs

Built as one change with the wash from [pipe colors](./pipe-colors.md). About 410 changed lines with their
tests, and 8.5 agent hours. These are estimates from reading the code, not from a build.

| Piece | Lines | Agent hours |
|---|---|---|
| Radix values, six colors, letter and dot, counted per workspace; `--line-*` and `[data-tint]` go | 90 | 2 |
| Edge, focus, hover and closing as `outline`, no title line, forced colors, more contrast | 40 | 0.5 |
| Title bar as `header`, `tileWord` in it, state slot, ellipsis | 30 | 0.5 |
| One `main` (`window.css:426-457,2144`, and `scroll.test.ts` pins `main.program`), one region per tile, `tileName` | 40 | 0.75 |
| Two live regions from boot, `role="alert"`, the words | 30 | 0.5 |
| Keys below | 100 | 2 |
| Desk focus follows DOM focus, last inner spot per tile | 30 | 0.5 |
| `--text-faint` to a11: 71 uses in `window.css`, and `editor/screen.ts:107` copies it by hand | 5 | 0.5 |
| `--manti-border-subtle` by pnpm patch | 5 | 0.2 |
| Shots: stacked, 2x2, small window, forced colors (`shots.ts:235`) | 40 | 1 |

What the keys need, as a sketch:

```ts
// apps/fabrika/src/desk/keys.ts: new kinds of command. A sketch.
type Does =
	| {readonly kind: "cycle"; readonly to: "next" | "previous"} // C-b o, F6, Shift-F6
	| {readonly kind: "back"} // C-b ;, the tile focused before
	| {readonly kind: "read"} // C-b [, the terminal's text
	| {readonly kind: "resize"; readonly to: Direction; readonly by: 1 | 5}; // C-b C-arrow, C-b M-arrow

// keyName drops Shift today, so F6 and Shift-F6 share one name (keys.ts:186-194). It needs:
keyName({key: "F6", ctrl: false, alt: false, meta: false, shift: true}); // "<s-f6>"
// A bare F6 is not after the prefix, so it joins the keys the desk takes (hold.ts):
// {takes: {all: false, keys: ["<c-b>", "<f6>", "<s-f6>"]}}
```

`C-b ;` needs one new fact on a workspace, the tile focused before. It is only known at the moment focus
moves, so it is stored from the first build.

## What this cannot tell us

- **No screen reader ran.** VoiceOver on the Electron app must settle what it says entering a region,
  `aria-current`, whether polite text survives a focus move, the `alert` on y/n, and the terminal's
  textbox. NVDA and JAWS, for the browser client, must settle bare letters after `C-b` in browse mode, and
  whether 8 and 16 regions are noise.
- **No keyboard run.** Tab and Enter on a strip, the Tab mismatch, and the ring beside a lit edge all come
  from reading code.
- **Layouts were not shot in the built app.** Only 1440x900 was. AGENTS.md asks for stacked, 2x2 and
  small-window shots, and forced colors can be emulated. The tiles here were judged on a mockup.
- **Contrast is computed from Radix's sRGB hex.** P3 values may differ a little, and a8's 3.02 has almost
  no room. Today's numbers are worked out from `window.css`'s oklch, not read from a screen. The color-blind
  figures are a simulation on one thin band.
- **Linear's logged-in app was not seen.** This rests on its writing, its docs and one page's markup, read
  2026-10-31. "Not documented" means we did not find it, not that it is absent.
- **Tuval's carry-over is on paper,** as `next/` does not exist here yet. Electron's page zoom was not
  checked either.
- **Rank by position is untested.** With faint, the id and the name at rest all at a11, nobody has looked at
  whether a busy program view still reads in order.

[r24]: https://linear.app/now/how-we-redesigned-the-linear-ui
[r26]: https://linear.app/now/behind-the-latest-design-refresh
[cl26]: https://linear.app/changelog/2026-03-12-ui-refresh
[sel]: https://linear.app/docs/select-issues
[disp]: https://linear.app/docs/display-options
[tmux]: https://man.openbsd.org/tmux.1
[tmuxk]: https://man.openbsd.org/tmux.1#DEFAULT_KEY_BINDINGS
[vsc]: https://code.visualstudio.com/docs/configure/accessibility/accessibility
[apgl]: https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/
[apgs]: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
[c141]: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
[c253]: https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
[c258]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
