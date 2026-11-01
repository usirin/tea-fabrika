# People bring their own themes

**Decided 2026-11-01 by the owner**, after [experiment 177](../../experiments/177-themes.md). Each
person picks the colors they see. The default way in is a Radix pick. A theme file people already
use (Base16, Base24, Ghostty) is the other way in, and it keeps its own colors, even though they are
not Radix steps. `next/` builds this. Nothing is built yet.

```toml
# ~/.fabrika/fabrika.toml, the person's own settings
theme = "nord"   # a file in ~/.fabrika/themes/; leave the line out for "fabrika", the default
```

```text
~/.fabrika/
  fabrika.toml          the pick: theme = "<name>"
  themes/nord.toml      one theme, a full set of named colors
  keybindings.toml      the person's keys, from the keybindings note
```

## Decided

- **A theme is the person's own config.** It lives in their home, `~/.fabrika/`, not in a repo's
  `.fabrika/`. A repo that set colors would choose for someone else's eyes.
- **One file per theme:** `~/.fabrika/themes/<name>.toml`. The pick is one line,
  `theme = "<name>"`, in `~/.fabrika/fabrika.toml`. This is how
  [Helix](https://docs.helix-editor.com/themes.html) does it (`~/.config/helix/themes/<name>.toml`,
  and `theme = "<name>"` in `config.toml`). [Zed](https://zed.dev/docs/themes)
  (`~/.config/zed/themes`, a `theme` setting) and [Ghostty](https://ghostty.org/docs/features/theme)
  (`$XDG_CONFIG_HOME/ghostty/themes`, `theme = <name>`) do the same.
- **Our theme files are TOML.** A shared file someone brings, like Base16 YAML or a Ghostty theme, is
  read in its own format and mapped in.
- **A theme is a full set of named colors.** Nothing is worked out from two or three inputs while
  the app runs.
- **Two ways in.** A Radix pick (a gray and an accent) is the default. A shared theme file is the
  other. Both end as the same shape.
- **Each person owns their choice.** Two people on one desk see their own colors.
- **fabrika ships a `themes` program.** It is a picker with a live preview. It writes the pick line,
  and it imports a shared file into `themes/`. This is how VS Code's
  [Color Theme picker](https://code.visualstudio.com/docs/configure/themes) works (arrow keys preview
  each theme, the choice goes into `workbench.colorTheme` in user settings), and Zed's
  [theme selector](https://zed.dev/docs/themes) too (moving through the list "will change the theme
  in real time", Enter saves it to the settings file).
- **Where it lands in the plan.** Tier 1 reads its config files and keeps today's styling as its
  named exception. Reading theme files and the `themes` program are both in Tier 2, beside the other
  first programs. The approved Tier 1 does not grow.
- **Which version.** `next/` builds it. In today's version, the study's tryout (its spike, kept as
  `experiments/177-themes/spike.patch`) lands only if the owner picks it. Nothing else is built or
  filed for today's version.

## The same rule as keybindings

Themes and keys follow one rule: **user config, with the defaults as the first rows.** See
[keybindings are configurable](./keybindings-are-configurable.md). Both live in the person's home,
`~/.fabrika/`, and each setting has one home there.

- The built-in themes are `fabrika`, the dark default, and `fabrika-light`. They ship as files in
  the same TOML shape, and they are the first rows of the list the picker shows.
- A person's own files come after. A guess, to match keys: a file with a built-in's name wins over
  the built-in, as a later row does.
- One difference from keys: a theme is a full set, so a file is not merged with the default. On the
  lean below, a file with a color missing does not load
  ([what the app does](#4-a-brought-theme-that-fails-contrast-proposed)).

## The answer each way in gives

These are sketches of the shape proposed below. Every number was computed by a script that runs
this note's rules on the files experiment 177 kept (`experiments/177-themes/schemes/`). They are
WCAG contrast ratios, each over the worst of the backgrounds the color sits on (desk, ground and
raised for text; the ground for focus and the turn fill; the fill for `on-turn`). No number here was
read off a screen.

**The built-in `fabrika`, a Radix pick, written out:**

```toml
# ~/.fabrika/themes/fabrika.toml (a sketch); picked by theme = "fabrika", or by no theme line
format = 1
name = "fabrika"
look = "dark"

[from.radix]
version = "3.0.0"   # a new Radix version changes a pick's colors, so it is kept
gray = "slate"
accent = "indigo"

[colors]
desk = "#0c0d0e"      # no Radix step is darker than slate 1: the one bend, see below
ground = "#111113"    # slate 1
raised = "#18191b"    # slate 2
hover = "#ddeaf814"   # slate a3
edge = "#d3edf81d"    # slate a4, the bend color principles already records
focus = "#d9edff5d"   # slate a8
text = "#edeef0"      # slate 12
faint = "#f1f7feb5"   # slate a11
turn = "#3e63dd"      # indigo 9: your turn
on-turn = "#ffffff"   # Radix's own rule for text on step 9
turn-text = "#9eb1ff" # indigo 11
done = "#71d083"      # grass 11
running = "#ffca16"   # amber 11
stuck = "#ff9592"     # red 11
closed = "#f1f7feb5"  # slate a11: no hue, the word says closed

[terminal]
foreground = "#edeef0"
background = "#111113"
cursor = "#edeef0"
selection = "#d9edfe25" # slate a5
palette = [ ... ]     # 16 Radix steps: slate 11, red 9, grass 9, amber 9, blue 9, purple 11,
                      # cyan 9, slate 11, slate 11, then red, grass, amber, blue, purple, cyan 11,
                      # slate 12
```

```text
text 15.15   faint 8.71   turn-text 8.53   done 9.26   running 11.49   stuck 8.35   closed 8.71
focus 3.01   turn 3.62   on-turn 5.21   edge 1.31 (carries no fact, see below)
terminal: every color 4.82 or more
moved by repair: 0
```

**The built-in `fabrika-light`:** the same pick, `look = "light"`. Two colors are a step up from
the dark one, because repair would move them there: `running` is amber 12, since amber 11 reads 4.38,
and `focus` is slate a9, since a8 reads 1.90. With those written in, repair moves nothing: text
15.58, faint 5.81, done 4.82, running 10.81, stuck 4.96, focus 3.27, and every terminal color 4.65 or
more. The cost: running reads brown, not amber.

**A Base16 file, mapped in:**

```toml
# ~/.fabrika/themes/nord.toml (a sketch), from base16-nord.yaml
format = 1
name = "Nord"
look = "dark"

[from.base16]
file = "base16-nord.yaml"
sha256 = "bf0620d47f232657..."   # the bytes it was mapped from
by = "arcticicestudio"

[colors]
desk = "#2a303c"      # mixed from base00 toward base05, as below
ground = "#2e3440"    # base00
raised = "#353b47"
hover = "#3d434f"
edge = "#444a55"
focus = "#727882"
text = "#e5e9f0"      # base05
faint = "#b6bbc4"
turn = "#81a1c1"      # base0D
on-turn = "#000000"   # black or white, whichever reads more on turn
turn-text = "#81a1c1" # base0D
done = "#a3be8c"      # base0B
running = "#ebcb8b"   # base0A
stuck = "#bf616a"     # base08
closed = "#b6bbc4"    # the faint gray

[terminal]
foreground = "#e5e9f0"
background = "#2e3440"
cursor = "#e5e9f0"
selection = "#434c5e" # base02
palette = [ ... ]     # the Tinted Theming roles, base00 to base0F
```

```text
text 9.23   faint 5.83   done 5.51   running 7.20   (all over raised, the worst of the three)
moved by repair, in the app only, never in the file:
  stuck      #bf616a -> #eb8991   2.75 -> 4.56, over raised
  turn-text  #81a1c1 -> #89a9c9   4.18 -> 4.59, over raised
  focus      #727882 -> #787e88   2.81 -> 3.06, over the ground
terminal: 6 of 16 under 4.5 (2 under 3:1), all 6 moved; cursor 10.26
bottom line, once: theme nord: 3 colors and 6 terminal colors moved so they read
```

The study measured Nord's `stuck` at 2.83 over raised with its own ladder. This note's ladder puts
raised a little lighter, so it reads 2.75 here.

The Base16 roles are the [Tinted Theming styling guide](https://github.com/tinted-theming/home/blob/main/styling.md)'s:
base00 the ground, base05 the text, base08 red, base0A yellow, base0B green, base0D blue.

## Proposed

Each point is a lean from experiment 177, for the owner to settle.

### 1. The data shape (proposed)

```ts
// A sketch, in next/: the decoder for one theme file. Effect Schema, read from the parsed TOML.
const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}([0-9a-f]{2})?$/));
const From = Schema.Union([
	Schema.Struct({ radix: Schema.Struct({ version: Schema.String, gray: Gray, accent: Accent }) }),
	Schema.Struct({ base16: Shared }),
	Schema.Struct({ base24: Shared }),
	Schema.Struct({ ghostty: Shared }),
]); // exactly one table under [from]; the decoder turns it into a tagged union
const Theme = Schema.Struct({
	format: Schema.Literal(1),
	name: Name,
	look: Schema.Literals(["dark", "light"]),
	from: From,
	colors: Colors, // every name the window uses, each a Hex; none optional
	terminal: Terminal, // foreground, background, cursor, selection, palette of 16
});
```

- **The names.** Fifteen colors, plus the terminal's own.
  - Backgrounds, never moved by repair: `desk` (behind the tiles), `ground` (a tile), `raised` (what
    opens over the desk), `hover`.
  - Lines: `edge` (a tile at rest) and `focus` (the focused tile).
  - Text: `text`, `faint`, `turn-text`, and the state words `done`, `running`, `stuck`, `closed`.
  - The turn fill and its text: `turn` and `on-turn`.
  - `closed` has no hue of its own. It is the faint gray, and the word says closed. Every free hue
    is taken by a state or a pipe, so a hue for closed would break "a color means one thing". Today's
    `--closed` is a hue, so this is a change.
  - The terminal: `foreground`, `background`, `cursor`, `selection` and a `palette` of 16.
- **How a 16-color file fills the names.** A Base16, Base24 or Ghostty file names a background, a
  foreground and 16 hues, and none of our grays. So:
  - `ground` is the background and `text` the foreground (Base16 base00 and base05).
  - `desk`, `raised`, `hover`, `edge`, `focus` and `faint` are mixed in OKLCH from the background
    toward the foreground, each at the place it sits in `fabrika`'s own ladder. In a dark theme that
    is desk -0.026, raised 0.045, hover 0.096, edge 0.136, focus 0.403, faint 0.766; in a light one
    0.012, 0, 0.059, 0.091, 0.271, 0.656. The study's spike mixed the same way, from today's ladder.
  - `turn` and `turn-text` are the blue (base0D, Ghostty's palette 4), `done` the green (base0B, 2),
    `running` the yellow (base0A, 3) and `stuck` the red (base08, 1). `on-turn` is black or white,
    whichever reads more on `turn`. `closed` is `faint`.
  - So Base16 and Ghostty map the same way. The cost: Base16's own grays, base01 to base04, are not
    used. Sure: 65%. Doubt: on a theme whose base01 to base04 were tuned by hand, our mix may look
    off. A look at real themes side by side settles it.
- **One value in `fabrika` is not a Radix step: the dark `desk`, `#0c0d0e`.** Radix has nothing
  darker than step 1, and the tile's ground is step 1. This is a bend from
  [color principles](./color-principles.md) principle 5, written here with its reason. The light
  desk is slate 2. `on-turn` is white, which is Radix's own rule for text on step 9, not a step.
- **Full values, and the source is kept.** A pick can always be written out as values. A shared
  theme can never be said as a pick. So one shape works for both, with `[from]` saying where it came
  from. Sure: 85%, the study's number.
- **The source table names its kind**, `[from.radix]` or `[from.base16]`, so no `kind` key is typed
  and a file cannot be two kinds at once.
- **A shared file is mapped once, at import.** The `themes` program writes `themes/<name>.toml` and
  keeps the original's format, author and sha256 in `[from]`, not the original itself. One theme is
  one file. The cost: a new version of a scheme needs the original again, and the hash only says
  whether it changed. Sure: 70%.
- **Pipe colors are not in a theme.** The six pipe colors stay Radix's alpha scales on every theme,
  since alpha sits on any ground. A Base16 file has red, yellow and green as states, and the study's
  own mapping made lines from them, which breaks "a color means one thing". Sure: 65%. Doubt: a pipe
  wash in Radix sky may look foreign on a warm theme. A look on real themes settles it.
- **Values are hex for now.** Whether a theme may hold Display P3 is still open on main
  ([pipe colors](./pipe-colors.md), [color principles](./color-principles.md)). Adding it later
  loses no data, since hex stays valid.
- **What we give up from the study.** It kept the choice as a fact on the ledger: who picked, when,
  from which window. A line in a file keeps only the latest pick. No deciding code reads that
  history, so this is fine for a setting. Sure: 75%.
- **Not now:** a dark and light pair that follows the system, as Zed and Ghostty have
  (`theme = "dark:X,light:Y"` in Ghostty). Adding it later loses no data.

### 2. Live switching (proposed)

The Elm answer: the window is the parent and holds the theme in its Model. A program's Model never
holds a theme. It gets the tokens the page has, as a child gets the page's CSS.

```ts
// A sketch, in next/.
type Msg =
	| { type: "theme_changed"; theme: Theme } // the hands saw a file change
	| { type: "theme_refused"; name: string; why: string };
// update returns one Cmd: set every token, repaint every terminal, in one task.
```

- **The hands watch the files, and the window hears them.** A browser tab has no files, so the hands
  read `~/.fabrika` and send the theme over the door. A window never reads a file
  ([a browser is always a client](./a-browser-is-always-a-client.md)).
- **One task, no restart.** The study measured 11 to 19 ms a swap in the cases people live in, and
  about 5 frames at worst, with four terminals holding 1 MiB each.
- **No flash at start.** The last theme is kept in local storage and applied before first paint, as
  VS Code does. It is only a cache.
- **The terminal needs a palette call upstream.** ghostty-web cannot change colors live, so until it
  can, the window resets and replays kept bytes, as the study's spike did.

Sure: 80%. Doubt: nothing went over a real door or a second window in the study.

### 3. What a third-party program gets (proposed)

A program never sees a theme file and never sets a theme. It gets, in this order:

1. The token names, typed, with what each means and the background each sits on.
2. Manti's parts, which already follow the tokens.
3. An oxlint rule against raw colors in a program, and one against a non-text token used as text.
4. A theme check in its tests: render in dark, light and one ugly theme, and sweep contrast.
5. `readColors()` and `onTheme` for views that draw on a canvas. The terminal is the first one.
6. A rule for bytes: tones or palette indexes, never 24-bit colors. Bytes are shared by everyone on
   a desk, and a theme is the viewer's.

Sure: 75%. Doubt: no third-party program exists yet, so this is reasoning from today's code.

### 4. A brought theme that fails contrast (proposed)

A brought theme must never make the app unreadable. The app repairs it and does not refuse it.

What is checked, on every load:

| Names | Against | Bar |
|---|---|---|
| `text`, `faint`, `turn-text`, `done`, `running`, `stuck`, `closed` | the worst of desk, ground and raised | 4.5:1, [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| `on-turn` | `turn` | 4.5:1 |
| `focus`, `turn` | the ground (focus is drawn inside the tile) | 3:1, [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| the 16 terminal colors | the terminal's background | 4.5:1 |
| the terminal cursor | the terminal's background | 3:1 |

What repair does:

- **Backgrounds never move:** desk, ground, raised, hover, and the terminal's background.
- **`edge` is not checked and never moves.** It carries no needed fact. It is 1.31:1 in `fabrika`
  by design, the bend [color principles](./color-principles.md) records, and the title bar and the
  focus edge carry the tile instead. Moving it would break that look on every theme.
- **`focus` moves like text, to 3:1.** It is the one line a person must see.
- **A Radix pick steps up its own scale,** one step at a time, solid or alpha: 11 to 12, a8 to a9,
  9 to 10 or 11. `on-turn` takes white or slate 1, whichever reads. Run over all 300 picks (6 grays,
  25 accents, dark and light), this always ended on a Radix step, with no value off the scale. 275
  of the 300 needed a move: every light pick moves `running` (amber 11 to 12) and `focus` (a8 to
  a9). So the built-ins are written with those steps already, and repair moves nothing in them.
- **A shared file moves lightness only,** along each color's own hue, away from the background
  first, as iTerm2's minimum contrast moves text and never the background. Black or white text
  reaches 4.5:1 on any ground, so it always ends readable.
- **The terminal's 16 colors are repaired too,** each as text on the terminal's background, at 4.5:1.
  In the study's unreadable test (every color near one gray), 16 of 16 were under 3:1; after
  repair all 16 read, and the cursor goes from 1.07 to 3.05.
  - The cost, said plainly: a color that a program uses as a fill moves too. Color 0, black in a
    dark theme, sits near the background on purpose. In `fabrika`, slate has no step between 4.45
    (slate 10) and 9.06 (slate 11), so black, white and bright black all end on slate 11, and a
    program that paints a black bar gets a gray one.
  - The real fix is contrast per cell, so only text moves: Ghostty's `minimum-contrast`, iTerm2's
    minimum contrast and xterm.js's `minimumContrastRatio` all work that way. ghostty-web has none,
    so we ask upstream. When it lands, the palette is no longer moved.
- **The file stays the person's.** Repair happens in the app, in memory. It never rewrites the file.
- **A file that does not decode is not applied.** A value that is not a color, a missing name or
  broken TOML: the app keeps `fabrika` and says why.

What the study's files need, from the same script:

| Theme | App colors moved | Terminal colors moved |
|---|---|---|
| Nord (Base16) | 3 | 6 |
| Solarized Light (Base16) | 7 | 14 |
| Catppuccin Mocha (Base24) | 1 | 2 |
| Dracula (Ghostty) | 1 | 2 |
| Catppuccin Latte (Ghostty) | 6 | 14, and the cursor |
| Unreadable on purpose | 9 | 16, and the cursor |

When a person meets it:

- **In the `themes` program, before they pick.** The preview lists what repair moved, for example
  `stuck #bf616a -> #eb8991`, and the terminal colors it moved.
- **At load, when repair moved anything.** The bottom line says so once, in one line:
  `theme nord: 3 colors and 6 terminal colors moved so they read`. The `themes` program lists them.
- **At load, when a file is refused.** The bottom line says once: `theme nord: ground is not a
  color; using fabrika`. The `themes` program shows the same reason.
- There is no prompt on opening the app.

Sure: 75%, and 60% on the terminal. Doubts: which measure gates, WCAG or APCA, is open (Radix
promises APCA). Repair changes colors the person chose: Solarized Light and Latte lose most of their
terminal colors as designed, so a "keep my colors" switch may be wanted. A real person using a
brought theme for a week settles both.

## The color principles a brought theme gives up

[Color principles](./color-principles.md) asks a theme to keep the principles or say which it gives
up.

- **Principle 5, every value a Radix step.** A brought theme gives it up on purpose. The default and
  every Radix pick keep it.
- **Principle 2, a color means one thing.** Kept by the mapping: done, running and stuck come from
  the file's green, yellow and red, pipes stay Radix, and closed has no hue. A Radix pick can break
  it two ways, since its accent says your turn:
  - An accent near a state color. 14 of the 25 Radix accents sit within 25 degrees of grass, amber
    or red, on step 9 in OKLCH.
  - An accent that is a pipe color. The six are sky, pink, teal, violet, lime and plum
    ([pipe colors](./pipe-colors.md)).
  - That leaves six: blue, cyan, indigo, iris, mint and purple. The picker offers those first, and
    warns on the rest.
  - A doubt: cyan sits 4 degrees from sky and mint 4 from teal, iris 10 from violet, and indigo, the
    default, 21 from violet. A pipe's letter tells them apart (principle 3), but on a desk the
    accent may look like a pipe. A look on a real desk settles it.
- **Principle 1, accessible.** Kept by repair, above.

## What this cannot tell us

- Whether anyone beyond the owner wants a brought theme. No user has picked one.
- How a brought theme looks with Radix pipe washes on it. Nobody has looked.
- Whether repair feels like the app overruling the person. Nobody has used it for long.
- The live-switching and Nord-at-2.83 numbers are from today's version, on one Mac, in experiment 177.
  The contrast numbers come from a script on the study's files, not from a screen: alpha colors were
  composited by hand, and nothing was drawn. `next/` has no window that shows a theme yet.
