# 177: Can people bring their own themes?

## Since this was written (2026-11-01)

The findings below are unchanged. These things changed after them.

- **It led to a decision.** [Themes](../docs/direction/themes.md) records it: people bring their
  own themes, and a Base16, Base24 or Ghostty file may keep its own colors. The pick is
  `theme = "<name>"` in `~/.fabrika/fabrika.toml`, and each theme is `~/.fabrika/themes/<name>.toml`.
  This replaces the study's lean that the pick lives on the person's ledger object (section 3).
  The built-in themes are named `fabrika` (dark, the default) and `fabrika-light`. They are the
  slate and indigo pick measured here; the shot file names below keep the old words.
- **Themes are TOML.** The theme examples here are TypeScript values, and the results are JSON.
  Theme files are now TOML. A shared file is still read in its own format and mapped in.
- **Pipe colors are now six fixed names.** [Pipe colors](../docs/direction/pipe-colors.md) set sky,
  pink, teal, violet, lime and plum, with a title wash and a letter. That replaces this study's
  `lines` and `tint` (section 2, and the tint table). The Radix pick's default lines were amber,
  blue, teal, violet, ruby and grass (`177-themes/radix.ts`). Amber, ruby and grass sit on running,
  stuck and done, so they break "a color means one thing"
  ([color principles](../docs/direction/color-principles.md), principle 2).
- **Its contrast counts use old steps.** The `own` and `shift` maps put faint text on a10 and the
  faint border on a5 (`177-themes/radix.ts`). [The tile rules](../docs/direction/tile-guidelines.md)
  now take a11 for faint text and a4 for the resting edge. The 201 counts were not run again.
- **Two values are off Radix steps, and the study does not call them bends.** Color principles now
  says every value is a Radix step, and a bend is written down with its reason. The `shift` map's
  sunken ground is `#0c0d0e`, which is no step (main's tile notes measure over slate 1, `#111113`).
  Repair moves colors off their steps too. The study calls `#0c0d0e` a custom value, but that rule
  came after it.
- **Display P3 is still open on main.** The study's type is hex only. Pipe colors and color
  principles both still list Display P3 as not decided, so "hex only" is not settled either way.
- **Tile work already covers part of the cost.** The tile rules (decided, not built) move faint
  text to a11, which is the `window.css` change this study names under "The cost in text". They
  also draw edges with `outline` instead of `box-shadow`, and write a tile's tokens as Radix values.
  So parts of the first and third steps in [the recommendation](#the-recommendation) are now
  planned there.

**Yes, and it costs little.** A real shared theme swapped live on the built app, terminal included,
with no restart and no flash. Today's version, on a spike that does not land.

```ts
// Sketch. A theme is a value, and only colors. The window owns it. The program never sees it.
const theme = decodeTheme(fromTinted(file)); // refused unless every color is a hex
applyTheme(theme); // one task: every token, every terminal, then a frame
```

- **Recommendation:** a theme is stored as a full set of values. A Radix pick (a gray and an accent)
  is the best way to make one, and the default. A shared file is the other way. Both write out to
  the same shape. Each person owns their choice. More in [the recommendation](#the-recommendation).
- **Exploration only.** Nothing here decides a direction. No product code lands.
- **Which version.** Everything measured is today's version (`apps/fabrika`, `programs/*`,
  `@manti-ui` 0.13.0). `next/` is not on main yet, so what is said about it is design, marked (next).

## What came back

Measured in the real app (Playwright on Electron, temp `FABRIKA_HOME`, this one Mac) and in the same
built page in a headless Chromium tab with the real views of ticket #7.

| Question | Answer (today) |
|---|---|
| Swap, four tiles and a screen of text | Task P50 10.8 ms, P95 11.9. Two frames 33.3 ms: nothing dropped |
| Swap with 2,000 colored lines more | Task P50 17 ms, P95 19.6. Two frames 33.3 ms |
| Swap, four terminals each holding 1 MiB | Task P50 85.8 ms, P95 89.2. Two frames 115.7 ms: about 5 frames, once, on a person's action |
| Tokens alone, 910 elements, no terminal | Task P50 12 ms, P95 18 |
| Page and terminal change together | Yes. In the swap's own task both are already new |
| Terminal colors | All 16 exact on the canvas, in 12 theme and layout runs. Screen text kept. A new tile wears the theme |
| Answers in replayed bytes | No extra keys reach tsh (`\x1b[6n` tried) |
| Start with a kept theme | Applied before first paint (mark at 133 ms, first paint at 172) |
| Back to the app's own look | No inline style left |
| Two people, one desk, same messages | Two tabs, two grounds: `#1e1e2e` and `#eff1f5` |

Shots: [one](./177-themes/shots/app-solarized-one.png),
[side by side](./177-themes/shots/app-solarized-side-by-side.png),
[stacked](./177-themes/shots/app-solarized-stacked.png),
[2x2](./177-themes/shots/app-solarized-2x2.png),
[small](./177-themes/shots/app-solarized-small.png), all from the real app. With ticket #7's views:
[default](./177-themes/shots/tab-default-2x2.png), [Mocha](./177-themes/shots/tab-mocha-2x2.png),
[Solarized](./177-themes/shots/tab-solarized-2x2.png),
[a piped line](./177-themes/shots/tab-mocha-line.png).

## What stays hardcoded and breaks (today)

The token audit is good news. Programs hold 0 hex and 0 color functions in their `tsx` and `css`, and
only 4 `var(--…)` in `tsx`. They use class names drawn from one shared `window.css`. Six things broke
anyway:

- **The host writes colors into terminal bytes.**
  - `apps/fabrika/src/editor/screen.ts` has a `PALETTE` of 24-bit colors.
  - On a light theme "Experiments" is near-white on cream ([shot](./177-themes/shots/app-solarized-small.png)).
  - It also breaks "the theme is the viewer's": bytes are shared by everyone on the desk.
  - Fix: the host sends a tone or a palette index, and the client picks the color.
- **The code highlighter is GitHub Dark Dimmed, inline.**
  - `programs/markdown/src/highlight.ts`. On light themes a span reads at 1.41 (Solarized) and 1.34
    (Latte) ([shot](./177-themes/shots/tab-latte-code.png)).
  - Fix idea, not tried: Shiki-style CSS variables, or Base16's roles.
- **ghostty-web 0.4 cannot change colors live.**
  - The option warns "not yet fully supported". OSC 4, 10 and 11 are refused.
  - The spike resets and replays up to 1 MiB of kept bytes, and reaches for two private fields. That
    is what costs the 86 ms.
  - Better: ask upstream for a palette call. Doubt on the replay: it re-runs old bytes.
- **Themes found old token mistakes.**
  - `.tracker button.tracker-primary` uses `--ink` on `--key`. That is 2.68 in the app's own look,
    1.05 on Mocha, 1.04 on Latte. "approve" is a blank button in the
    [Mocha shot](./177-themes/shots/tab-mocha-2x2.png).
  - `--wire`, `--border-strong` and `--key` are used as text in the top bar, under 3:1 in every look:
    `.sep` 1.56 and `.num`, `.seg.plain`, `.quiet`, `.pipe` 2.14 in the default.
  - These are non-text tokens used as text, so repair cannot catch them. They need role pairs and a
    lint rule.
- **Shadows and the scrim are `rgb(0 0 0 / …)`.** They do not change on light.
- **The tracker's note box looks unstyled in every look.** It is a dark bar even on the
  [unreadable test](./177-themes/shots/tab-unreadable-2x2.png).

By layout, in the shots:

- One tile and side by side: nothing squeezes. App side by side shows an error line only because the
  temp home has no experiment 170, which is not the theme's fault.
- Stacked: fine.
- 2x2: fine, but the map's text is tiny in every look.
- Small: the map's legend wraps and the tracker scrolls. Same in every theme.
- A piped line: the ticket's title clips, same as the default.

## 1. How others do it

- **VS Code:** a JSON file, `colors` and `tokenColors`, with hex values. Webviews get `--vscode-*`
  variables and a body class. It keeps the last theme in storage "for a flicker-free startup". We
  copied that. [Docs](https://code.visualstudio.com/api/extension-guides/color-theme),
  [source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/themes/browser/workbenchThemeService.ts).
- **Ghostty:** `palette = 0=#…`, `background`, `foreground`, and `theme = dark:X,light:Y`. Its docs
  warn a theme file can set any option. [Docs](https://ghostty.org/docs/features/theme).
- **iTerm2:** `.itermcolors`. Minimum contrast moves the text, never the background. The
  [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) repo also ships the
  Ghostty format (MIT). [Docs](https://iterm2.com/documentation-preferences-profiles-colors.html).
- **Zed:** JSON in `~/.config/zed/themes`, `{mode: system, light, dark}`, plus overrides. [Docs](https://zed.dev/docs/themes).
- **Linear:** went from 98 variables to three inputs: base, accent, contrast, worked out in LCH.
  Share by one line of colors. [How](https://linear.app/now/how-we-redesigned-the-linear-ui),
  [2020](https://linear.app/changelog/2020-12-04-themes). Its custom-themes doc page gave 404, so
  "not synced across devices" is from a search snippet only. Doubt.
- **Obsidian:** a `theme.css` with 400+ variables. Arbitrary CSS, so it can do anything, which is the
  hole we do not want. [Docs](https://docs.obsidian.md/Themes/App+themes/Build+a+theme).
- **tmux:** no theme file. Options only: `window-style`, `status-style`, and in the man page's
  current text a `theme` option with `dark-theme-*` and `light-theme-*` colors. [Man page](https://man7.org/linux/man-pages/man1/tmux.1.html), read in part.
- **Base16 and Base24 (Tinted Theming):** a flat YAML of `base00` to `base0F`, with named roles, and
  hundreds of schemes. [Styling guide](https://github.com/tinted-theming/home/blob/main/styling.md).
- **DTCG design tokens 2025.10:** JSON `$value`, `$type`. A community report, read only in part. It
  names tokens, it does not give a set of roles, so it does not save us anything here.
- **Radix Colors and Radix Themes:** see [the Radix section](#a-radix-pick-next-to-full-values).

**What to adopt.** Read Base16, Base24 and Ghostty's file as they are. Do not invent a file format
people must write. Fabrika's own shape is what those read into. This run read five real files in
about 130 lines. Sure: 90%.

## A Radix pick, next to full values

Today's version, `@radix-ui/colors` 3.0.0. The owner is trying Radix on another branch, so this was
tested on its own: 8 picks, 8 layouts, 4 ways to map, about 1,650 text elements per pick. The scale
values are kept whole in `177-themes/schemes/`.

**My pick: store full values, and make Radix the default way to make them.** A pick can always be
written out as full values. Most full values can never be said as a pick. So only one direction
works. Sure: 85%.

```ts
// Sketch: the one shape, two ways in. The pick is kept, so nothing is lost by writing it out.
const pick = fromRadix("slate", "indigo", "dark"); // { from: {kind: "radix", version: "3.0.0", ...}, grays, ... }
const file = fromTinted(mochaYaml); // { from: {kind: "file", format: "base24", hash}, grays, ... }
applyTheme(pick); // the same call
```

| | A Radix pick (gray + accent) | Full values |
|---|---|---|
| Size of the choice | 2 words, 300 picks over dark and light | About 60 colors |
| Light and dark | Both come together | A theme is one or the other |
| Contrast | Promised on step 2 of its own scale: Lc 60 and Lc 90 in APCA | Nobody promises. Repair needed |
| A shared theme | Cannot be said | Yes |
| Terminal | No palette; we build one | Yes, the file's own |
| Tuning one color | Docs say no | Yes |
| Wide gamut | Yes, 28 to 29 of 300 accent steps need it | Hex only, unless the type grows |

What a pick cannot do, measured:

- **Say a shared theme.** For the nearest Radix color to each of a theme's 16 terminal colors, 9 to
  14 are off by more than 0.02 in OKLab (a rule of thumb for "you can tell"), worst 0.08. Radix's
  page says scales are "not intended to be customised", and that custom colors go beside them as
  extra scales. [Composing a palette](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette).
- **Keep our meanings by itself.**
  - `window.css` says the accent means your turn, red stuck, amber running, green done.
  - 14 of 25 accents sit within 25 degrees of a status hue, red and tomato among them.
  - See [red](./177-themes/shots/radix-slate-red-dark-shift-2x2.png): your turn looks like stuck.
  - A picker should warn, or offer the 11 clear ones: blue, cyan, indigo, iris, mint, pink, plum,
    purple, sky, teal, violet.
- **Give a terminal palette.** Built from steps 11 and 9: ink 15.15 and 2 colors under 3:1 in dark,
  ink 16.39 and 3 under 3:1 in light.
- **Promise WCAG.**
  - Light accent 11 on gray 3 is under 4.5 in 66 of 150 picks, down to 3.95. Dark never is.
  - White on step 9, Radix's own rule, is under 4.5 for 15 of 25 accents, down to 2.97 (orange).
  - Radix promises APCA on step 2, so this is not a broken promise. It does mean repair stays on
    for picks too, or we pick APCA as our measure. Open.

What full values cannot do:

- Promise anything, so repair is required. Real themes needed it: 1 token moved on Mocha, 7 on
  Solarized, 6 on Latte.
- Hold wide gamut or alpha with a hex-only type. See the shape below.
- Follow the system's light or dark alone. That takes a choice of two themes, as Ghostty and Zed do.

**How the app should map the steps.** This matters more than the choice of scale.

| Map (slate + indigo, dark) | Kinds of text under 4.5, over 8 layouts | How it looks |
|---|---|---|
| The app's own look, for comparison | 36 | The baseline |
| `naive`: `--n-k` = step k | 259 | [Lighter, faint text fails](./177-themes/shots/radix-slate-indigo-dark-naive-2x2.png) |
| `lift`: naive, text steps moved until they read | 40 | Passes, still too light |
| `own`: as `@radix-ui/themes` 3.3.0 uses steps | 201 | [Right roles, one step light](./177-themes/shots/radix-slate-indigo-dark-own-2x2.png) |
| `shift`: `own`, one step darker | 201 | [Closest to today](./177-themes/shots/radix-slate-indigo-dark-shift-2x2.png) |

- **Why step for step loses the look.** The ladders differ. In OKLCH lightness:
  - Today, `--n-1` to `--n-12`: .15 .18 .21 .23 .26 .28 .32 .40 .63 .70 .79 .94
  - Slate dark, 1 to 12: .18 .21 .25 .28 .31 .35 .40 .49 .54 .58 .77 .95
  - Grounds and borders come out lighter, and the two faint text grays come out darker. So the page
    gets lighter while its faint text gets harder to read.
  - The six grays are equally far from today (mean 0.057 to 0.059), so a different gray will not fix
    it. Chroma is not the issue either: slate's grounds are 0.004, the same as today.
- **How Radix uses its own steps.** Read in `@radix-ui/themes` 3.3.0's CSS:
  - Dark: background gray-1, solid panel gray-2. Light: both are white, not gray-1.
  - Hover a3 (27 uses as a background), then a4, a5. Borders a5 to a8.
  - Primary text 12, secondary a11, placeholder a10, disabled a8.
  - 80% of its gray uses are alpha steps (233 of 291). Alpha sits on whatever is behind it, so a
    tinted tile just works.
- **`shift` is the best one here.**
  - It puts today's `--n-2` near gray-1 (.178 and .18). Radix's page calls steps 1 and 2
    interchangeable for backgrounds.
  - `--n-1`, the sunken ground, has no step, so it needs one custom value beside the scale.
  - Shots: [one](./177-themes/shots/radix-slate-indigo-dark-shift-one.png),
    [side by side](./177-themes/shots/radix-slate-indigo-dark-shift-side-by-side.png),
    [stacked](./177-themes/shots/radix-slate-indigo-dark-shift-stacked.png),
    [small](./177-themes/shots/radix-slate-indigo-dark-shift-small.png),
    [line](./177-themes/shots/radix-slate-indigo-dark-shift-line.png). Nothing new squeezes.
  - Sure it looks right: 70%, from shots at this size. The doubt: only the owner's eye settles
    "cool". The [clickable page](../apps/fabrika/docs/themes/mockup.html) uses this map.
- **The cost in text.**
  - Today has four text levels, and Radix has two plus a placeholder.
  - `own` and `shift` show 201 against 36 because `--text-faint` became a10, which is near 4.4 on
    gray-1. Radix keeps a10 for placeholders. We use faint for real words.
  - So real words in `--text-faint` should move to a11, or the app drops a level. That is a real
    design change to `window.css`, not a color swap.
- **Light.** Use `own`, with white behind: [2x2](./177-themes/shots/radix-slate-indigo-light-own-2x2.png),
  [small](./177-themes/shots/radix-slate-indigo-light-own-small.png). The top bar's misused tokens get
  worse here, as listed above.

**Radix's setup, in our world:**

- Its CSS selector is `.dark, .dark-theme`, so loading its files means a class on the root, next to
  Manti's `data-theme` and `color-scheme`. Three switches that must agree.
- Setting values with `setProperty` needs no class, and no file at the client. The written-out theme
  needs none of the package at all; only the picker does. All scales cost 131 KB of JS, 29 KB gzipped.
- It ships hex and display-p3, not OKLCH. The app's `oklch(from …)` and `color-mix(in oklch, …)`
  take either.

**The pipe tint, tried both ways.** The formula from the other branch is
`oklch(from <gray> l <chroma> <hue>)`. Faint text on a piped tile's ground, chroma 0.03 being my
guess:

| Look | Plain tile | Today's `color-mix` | Relative form |
|---|---|---|---|
| App's own | 5.31 | 5.00 to 5.04 | 5.26 to 5.34 |
| Mocha | 4.83 | 4.39 to 4.51 | 4.74 to 4.86 |
| Solarized | 4.61 | 4.34 to 4.41 | 4.45 to 4.65 |
| Latte | 4.55 | 4.25 to 4.38 | 4.46 to 4.61 |
| Slate + indigo, dark | 5.35 | 4.94 to 5.15 | 5.28 to 5.40 |

The relative form keeps the gray's lightness, so it holds the text's contrast on every look, light
included. It follows any gray, so it suits a theme. It needs the line's hue as a number, which code
can read from the line color. So `lines` in a theme stays a list of colors. Sure: 85%.

## 2. The data shape

```ts
// Sketch. Only `Solid` reaches a terminal; `Layer` is for what sits on a surface.
const Solid = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/));
const Layer = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{8}$/));
const Paint = Schema.Union([Solid, Layer]);

const From = Schema.Union([
	Schema.Struct({kind: Schema.Literal("file"), format: Schema.Literals(["base16", "base24", "ghostty"]), hash: Hash, bytes: Schema.String}),
	Schema.Struct({kind: Schema.Literal("radix"), version: Schema.String, gray: Schema.String, accent: Schema.String, map: Schema.String}),
]);

const Theme = Schema.Struct({
	format: Schema.Literal(1),
	name: Name,
	by: Schema.String,
	look: Schema.Literals(["dark", "light"]),
	from: From,
	made: Schema.Struct({tokens: Schema.Int, moved: Schema.Array(Moved)}), // which token list, what repair did
	grays: Twelve(Paint), // --n-1 to --n-12, written out
	accent: Schema.Struct({soft: Paint, softer: Paint, fill: Solid, hover: Solid, text: Solid, on: Solid}),
	done: Solid,
	running: Solid,
	stuck: Solid,
	lines: Six(Solid), // one per tsh line; a tile reads its hue
	services: Six(Solid), // the trace's bars
	tint: Schema.Int, // how strong a line's color is, 0 to 100
	code: Code, // the highlighter's roles, once it has them
	terminal: Schema.Struct({foreground: Solid, background: Solid, cursor: Solid, selection: Solid, ink: Solid, palette: Sixteen(Solid)}),
});

// The choice is a fact, kept apart from the theme, in the person's own object (next).
const Chosen = Schema.Struct({by: Person, dark: Hash, light: Hash, follow: Schema.Literals(["system", "dark", "light"]), at: At, said: Said, window: Schema.NullOr(WindowId)});
```

- **One example of a pick written out:**

```ts
{ from: {kind: "radix", version: "3.0.0", gray: "slate", accent: "indigo", map: "shift"},
  look: "dark", grays: ["#0c0d0e", "#111113", "#18191b", "#ddeaf814", /* ... */ "#edeef0"], /* ... */ }
```

- **The spike's shape differs on purpose.** It stores a ground and an ink, and the page derives the
  ladder. Radix showed that is wrong: a pick has 12 real steps, and derivation would need a version
  field to replay. So write out and keep the source. The spike was not changed to this.
- **Fact lost forever if not recorded now:**
  - the file's bytes and hash, its format, its author;
  - who chose, when (`at` from the referee, `said` from their own clock), from which window;
  - the pick and the Radix version, since a new version changes a pick's colors silently;
  - which token list it was made for, and what repair moved.
- **Can wait, since it rebuilds from those:** the applied tokens, the cache, contrast numbers.
- **Keep out of deciding code:** `said`, the same as in a ledger entry.

## 3. Where it lives and who owns it

**Per person. Not per machine, and not per repo.** The test is the viewer: two people on one desk see
their own colors, shown above with two tabs on one desk's messages. A repo that set the colors would
be choosing for someone else's eyes.

```ts
// Elm's answer, as a sketch. The window is the parent and owns the value.
type Msg = { type: "theme_chosen"; theme: Theme | null } | { type: "theme_changed"; theme: Theme };
// update returns a Cmd that sets tokens and repaints terminals. A Sub hears the ledger.
// A program's Model never holds a theme: it gets ambient tokens, as a child gets the page's CSS.
```

- **(next) The store is the person's object on the ledger:** the window dials the brain as that
  person, reads `Chosen` and the theme, and hears changes by Sub. No file at the client, so a browser
  tab works the same.
- **(next and today) A local copy for first paint:** localStorage, as VS Code does. Only a cache.
- **(next) `~/.fabrika/themes/*` is only a way in:** hands read a file and post the value. A client
  never reads it.
- **(today) The spike is only a probe:** no pipe from host to window, and localStorage alone. It
  proves the page, not the store.
- **A second window (not built):** every window hears the same object, so it follows. Desktop has one
  window today. A per-window override is one nullable field, left for later since it loses no data.

**A clash to name:** where a person's object lives is written as "one per person" in
[we use the tools we build](../docs/direction/we-use-the-tools-we-build.md), and nothing yet says a
program may store a setting there.

## 4. Third-party programs

(today) A program is token-clean only because all its class names are in the app's `window.css`. A
third party has no way to ship CSS, and no token contract. And a program's window runs in the desk's
own page, so it can break the theme for everyone in that window. A sandbox is an open question.

What the SDK must give authors, in order:

1. The token names, typed, with what each means, and a role pair (`on`) for each surface.
2. Manti's parts, which already follow the tokens.
3. An oxlint rule against raw colors in a program, plus one against a non-text token used as text.
4. A theme picture in tests: render in dark, light and an ugly theme, sweep contrast.
5. `readColors()` and `onTheme` for canvas views. The terminal is the first client.
6. A rule for bytes: tones or palette indexes, never RGB.

## 5. Contrast and safety

- **Contrast: repair, do not refuse.** Move text along its own hue until it reads, as iTerm2 does, and
  record it.
  - The [unreadable test](./177-themes/shots/tab-unreadable-2x2.png): every color near one gray, 7
    tokens moved, and only the top bar's misused tokens stay under 3:1, of 313 checked.
  - Real themes need it, even hand-tuned ones: Solarized's `--done` is 2.97 before.
  - Terminals have no minimum contrast in ghostty-web. Solarized has 8 palette colors under 3:1, and
    Latte 9. Ghostty, iTerm2 and xterm.js all offer one, so ask upstream.
- **Safety: only colors get in.**
  - A file is read by a pure function that keeps color keys only.
  - The decode refused `url(x)`, `red`, `var(--x)`, `#fff`, `#ABCDEF` and `#12345678`. Readers
    normalize case and short forms. `#12345678` needs its own `Layer` type above.
  - Values go through `setProperty`, never CSS text, and only onto a fixed list of color names.
  - Free-form values are not safe: `url()` in a token is real. Keep hex only. Keep the desk's CSP on
    every way the page is served.
  - The rest of the hole list is private, by the rule for this kind of list.

## 6. Live switching

A swap costs 11 to 19 ms in the cases people live in, under one frame. The worst case is about 5
frames, once, on a person's action, only with full terminals. No restart and no flash, by three
things:

1. One task, so no frame sees half of it.
2. A small blocking script first in `<head>`, since the bundle boots 133 to 150 ms after first paint.
3. The kept theme read before terminals are made.

The blocking script is a CSP question: it is `script-src 'self'`, so it passes.

## The recommendation

**Build it in this order.** Sure overall: 85%. Doubts are named per step.

| Step | Why | Size | Sure |
|---|---|---|---|
| Fix the misused tokens in `window.css` | Bugs today, in the default too | About 20 lines, 0.5 agent hours | 95% |
| Host sends tones, not RGB | Needed for "the viewer's choice" | About 60 lines, 1 agent hour | 90% |
| Move to the written-out `Theme` and Radix picks, on the `shift` map | The default look on real scales | About 300 lines, 2 to 3 agent hours | 70%: only the owner's eye settles it |
| Read Base16, Base24 and Ghostty files | People already own a terminal theme | About 150 lines, 1 agent hour | 90% |
| Code highlighter on roles | Light themes need it | About 100 lines, 1 to 2 agent hours; not tried | 65%: untested with `@pierre/highlights` |
| Terminal: palette call upstream, replay until then | Removes private fields and the 86 ms | One issue, then about 30 lines | 75%: upstream's answer unknown |
| Store on the person's object | Tab and second window | (next) about 200 lines, 2 agent hours | 75%: depends on the object's shape, not built |

**Should fabrika's theme be Manti's? No.** Manti has no terminal palette, line colors or trace colors,
and no way to apply a theme object at run time. Its five presets are a few inputs scoped by
`data-manti-theme`. (today) `theme.css` maps `--manti-*` from our names, so Manti follows every swap
already, with no change. Sure: 85%.

**What Manti could take, by PR, tried with a pnpm patch first (not tried in this run):**

1. A documented input of 12 grays and an accent, so `theme.css` shrinks. Radix's 12 steps would fit
   it as they are.
2. Role pairs in `mantiTokenContract`, so a lint can check text against its surface.
3. `mantiTokens` as the base of the SDK's typed token names.

**What `next/` should do (next).** Same value, same shape. Name the protocol first: a `Chosen` fact and
a theme value over the door, which a browser tab can use. Hands and the host never hold a color.
Tokens in `next/` should be Radix's role names from day one, so a theme is not a mapping job. Do not
port the spike: its first-paint trick and replay are lessons, not code.

## Clashes with what is settled

- [`docs/direction/ui-on-manti.md`](../docs/direction/ui-on-manti.md): the app "wears our own token
  values, never a theme of Manti's or of another project". Users' themes need that sentence narrowed:
  the default stays ours. Radix values as the default would need it changed too.
- The same note says nobody has drawn light. Now it is drawn, on the
  [light map](./177-themes/shots/radix-slate-indigo-light-own-2x2.png).
- [`docs/direction/one-fabrika-toml-per-repo.md`](../docs/direction/one-fabrika-toml-per-repo.md):
  `~/.fabrika/fabrika.toml` holds "their own settings", but a browser client has no files. So a theme
  choice cannot live only there. That note also says state is not settings, so this fits as state.
- A theme in a repo's `.fabrika` would clash with the viewer's choice. Do not add one.
- The header of `window.css` holds what each color means. A shared theme must map onto those, which
  `Theme`'s roles do, and which a Radix accent can break.
- Radix's "not intended to be customised" clashes with tuning a pick. Keep custom values beside the
  scale, as `shift` does for `--n-1`.
- Private notes hold a few lines saying "no theme, one look" for the app and programs, and a line
  leaving the tint's strength open. Nothing settled a theme system or program storage.

## How to run it

```sh
pnpm --filter @kampus/fabrika-app-old build
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/177-themes.ts        # all of it
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/177-themes.ts radix  # no window at all
```

- It needs the spike commit on this branch. The same change is in `177-themes/spike.patch`.
- No model, no key, $0. About 2 minutes for each.
- Answers in `results/177-themes.json`. A subset of the shots is kept in `177-themes/shots/`, since
  all of them come to more than 7 MB.
- The theme files are in `177-themes/schemes/`, each with its MIT license.
- The Radix part was run last and in a tab only; the Electron part was not run again after it.

## Skipped

- Second window sync, and a real pipe from host to window. The script hands the page its theme.
- Firefox and Safari. Chromium only, as asked.
- A Manti patch, and a code-highlighter fix.
- Wide gamut: values measured, never shown. Hex only on this run's screens.
- The clickable page's terminal in the app's own look uses Ghostty's default palette from memory,
  since the app sets none.

## What this cannot tell us

- **Whether anyone wants it beyond the owner.** No user has picked a theme here.
- **Whether `shift` is "cool".** That is the owner's eye on a real screen, not a contrast number.
- **Other machines.** All timing is one Mac, and frame numbers on a slow laptop could be double.
- **Real long sessions.** Replay was fed made-up lines, not a day of a real tsh with a full-screen
  program. Old bytes that do something odd when run twice were tried for one sequence only.
- **The store.** Nothing went over a ledger, so sync, conflict and offline are untested.
- **WCAG against APCA.** Radix promises APCA, and this run measures WCAG. Which one should gate a
  fabrika theme is open.
- **Third-party programs.** None exists to break anything. Section 4 is reasoning from code.
