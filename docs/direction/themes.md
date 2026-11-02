# People bring their own themes

**Decided 2026-11-01 by the owner**, after [experiment 177](../../experiments/177-themes.md). Each
person picks the colors they see. The default way in is a Radix pick. A theme file people already
use (Base16, Base24, Ghostty) is the other way in, and it keeps its own colors, even though they are
not Radix steps. `next/` builds this. Nothing is built yet.

```toml
# ~/.fabrika/fabrika.toml, the person's own settings
theme = "nord-fabrika"   # a file in ~/.fabrika/themes/; leave the line out for "fabrika"
```

```text
~/.fabrika/
  fabrika.toml               the pick: theme = "<name>"
  themes/nord-fabrika.toml   one theme, a full set of named colors: Nord, imported and repaired
  keybindings.toml           the person's keys, from the keybindings note
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
- **A theme that repair changes gets a name of its own: `<name>-fabrika`.** If import has to change a
  color so it reads, Nord is saved as `~/.fabrika/themes/nord-fabrika.toml` and shown as
  `nord-fabrika` in the picker, never under `nord`. A theme that needs no repair keeps its name. So
  repair happens once, at import, and lands in a real file a person can open. Its `[repaired]` table
  says what came in and what changed. This is the Linux distro habit for a patched package: Debian
  adds `+deb13u1` to a stable update
  ([Developer's Reference 5.5.1](https://www.debian.org/doc/manuals/developers-reference/pkgs.en.html)),
  and Ubuntu adds `ubuntu1` the first time it changes a Debian package
  ([version string format](https://ubuntu.com/project/docs/how-ubuntu-is-made/concepts/version-strings/)),
  so nobody takes their version for the upstream one.
- **The terminal's per-cell check never renames anything.** It happens as the terminal draws and
  never changes a file ([below](#4-a-brought-theme-that-fails-contrast-proposed)).
- **Where it lands in the plan.** Tier 1 reads its config files and keeps today's styling as its
  named exception. Reading theme files and the `themes` program are both in Tier 2, beside the other
  first programs. The approved Tier 1 does not grow.
- **Which version.** `next/` builds it. In today's version, the study's tryout (its spike, kept as
  `experiments/177-themes/spike.patch`) lands only if the owner picks it.
- **Today's app moves to the built-ins (decided 2026-11-01 by the owner).** Radix's colors are
  trusted over our hand-made ones, so today's app drops its oklch grays in
  `apps/fabrika/src/window/window.css` and takes the `fabrika` and `fabrika-light` values below.
  Tracker ticket 144 holds the token-by-token mapping. The guidelines pages use the same values
  ([PR 291](https://github.com/usirin/tea-fabrika/pull/291)). This moves values only: theme files
  and the `themes` program stay in `next/`.

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

These are sketches of the shape proposed below. Every number was computed by
`experiments/177-themes/rules.py`, which runs this note's rules on the files experiment 177 kept
(`experiments/177-themes/schemes/`); the experiment says how to run it. They are
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
# fixed for every pick: done grass, running amber, stuck red, and the palette's
# red, grass, amber, blue, purple and cyan, in that order

[colors]
desk = "#0c0d0e"      # no gray step is darker than 1: the one bend, see below
ground = "#111113"    # gray 1
raised = "#18191b"    # gray 2
hover = "#ddeaf814"   # gray a3
edge = "#d3edf81d"    # gray a4, the bend color principles already records
focus = "#d9edff5d"   # gray a8
text = "#edeef0"      # gray 12
faint = "#f1f7feb5"   # gray a11
turn = "#3e63dd"      # accent 9: your turn
on-turn = "#ffffff"   # Radix's own rule for text on step 9
turn-text = "#9eb1ff" # accent 11
done = "#71d083"      # step 11
running = "#ffca16"   # step 11
stuck = "#ff9592"     # step 11
closed = "#f1f7feb5"  # gray a11: no hue, the word says closed

[terminal]
foreground = "#edeef0"
background = "#111113"
cursor = "#edeef0"
selection = "#d9edfe25" # gray a5
palette = [ ... ]     # 16 Radix steps: gray 3 (black, a fill); the six at 9, 9, 9, 9, 11, 9;
                      # gray 12, gray 11; the six at 11; gray 12
```

```text
text 15.15   faint 8.71   turn-text 8.53   done 9.26   running 11.49   stuck 8.35   closed 8.71
focus 3.01   turn 3.62   on-turn 5.21   edge 1.31 (carries no fact, see below)
terminal: every color but black (0, a fill) 4.82 or more on the background
moved by repair: 0
```

**The built-in `fabrika-light`:** the same pick, `look = "light"`. Two colors are a step up from
the dark one, because repair would move them there: `running` is amber 12, since amber 11 reads 4.38,
and `focus` is slate a9, since a8 reads 1.90. With those written in, repair moves nothing: text
15.58, faint 5.81, done 4.82, running 10.81, stuck 4.96, focus 3.27. In the terminal, white and bright
white (7 and 15, slate 8 and 7) are fills, and every other color reads 4.65 or more on the
background. The cost: running reads brown, not amber.

**A Base16 file, mapped in:**

```toml
# ~/.fabrika/themes/nord-fabrika.toml (a sketch), imported from base16-nord.yaml
format = 1
name = "nord-fabrika" # repair changed it, so not "nord"
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
focus = "#787e88"     # repaired
text = "#e5e9f0"      # base05
faint = "#b6bbc4"
turn = "#81a1c1"      # base0D
on-turn = "#000000"   # black or white, whichever reads more on turn
turn-text = "#89a9c9" # base0D, repaired
done = "#a3be8c"      # base0B
running = "#ebcb8b"   # base0A
stuck = "#eb8991"     # base08, repaired
closed = "#b6bbc4"    # the faint gray

[terminal]
foreground = "#e5e9f0"
background = "#2e3440"
cursor = "#e5e9f0"
selection = "#434c5e" # base02
palette = [ ... ]     # the Tinted Theming roles, base00 to base0F; never repaired

[repaired]            # what import changed, by our color name; `now` is the value in [colors]
turn-text = { was = "#81a1c1", now = "#89a9c9", why = "under 4.5:1 on raised" }
stuck = { was = "#bf616a", now = "#eb8991", why = "under 4.5:1 on raised" }
focus = { was = "#727882", now = "#787e88", why = "under 3:1 on ground" }
```

```text
text 9.23   faint 5.83   done 5.51   running 7.20   (all over raised, the worst of the three)
changed by repair at import, written into nord-fabrika.toml:
  stuck      #bf616a -> #eb8991   2.75 -> 4.56, over raised
  turn-text  #81a1c1 -> #89a9c9   4.18 -> 4.59, over raised
  focus      #727882 -> #787e88   2.81 -> 3.06, over the ground
terminal: never changed; 6 of 16 under 4.5 on the background (2 under 3:1), so text in
  those colors is lifted per cell when drawn; cursor 10.26
bottom line, at import: Imported Nord as nord-fabrika: 3 colors changed to stay readable
```

The study measured Nord's `stuck` at 2.83 over raised with its own ladder. This note's ladder puts
raised a little lighter, so it reads 2.75 here.

`[repaired]` is keyed by our names, not by `base08`, since `focus` is mixed and has no Base16 key of
its own. `was` is the value the mapping gave, and `now` must match `[colors]`, so the decoder refuses
a file where they differ.

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
	repaired: Schema.optional(Repaired), // what import changed: was, now, why, by color name
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
    0.012, 0, 0.059, 0.091, 0.467, 0.656. The study's spike mixed the same way, from today's ladder.
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
- **A shared file is mapped once, at import.** Repair runs then too. The `themes` program writes
  `themes/<name>.toml`, or `themes/<name>-fabrika.toml` when repair changed a color, and
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

A brought theme must never make the app unreadable. The `themes` program repairs it at import, into
`<name>-fabrika`, and does not refuse it.

What is checked, at import and again on every load:

| Names | Against | Bar |
|---|---|---|
| `text`, `faint`, `turn-text`, `done`, `running`, `stuck`, `closed` | the worst of desk, ground and raised | 4.5:1, [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| `on-turn` | `turn` | 4.5:1 |
| `focus`, `turn` | the ground (focus is drawn inside the tile) | 3:1, [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| terminal text, per cell, when drawn | that cell's own background | 4.5:1 |
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
  - A guess: a pick has no upstream file anyone could mistake it for, so it is written with its
    steps already chosen and keeps its name. If the owner wants `-fabrika` there too, it costs
    nothing.
- **A shared file moves lightness only,** along each color's own hue, away from the background
  first, as iTerm2's minimum contrast moves text and never the background. Black or white text
  reaches 4.5:1 on any ground, so it always ends readable.
- **The terminal's palette is never changed. Its text is kept readable per cell, when it is drawn.**
  Each cell's text moves, lightness only, against that cell's own background, and the background
  never moves. So ANSI black stays black where a program paints a bar with it, and only black text
  on that same black is lifted.
  - This is how terminals do it. [Ghostty's `minimum-contrast`](https://ghostty.org/docs/config/reference#minimum-contrast)
    sets "the minimum contrast ratio between the foreground and background colors", from 1 to 21,
    and leaves emoji and images alone. Its docs do not say per cell, but its
    [cell shader](https://github.com/ghostty-org/ghostty/blob/main/src/renderer/shaders/glsl/cell_text.v.glsl)
    applies it to each glyph against that cell's background. [iTerm2's minimum contrast](https://iterm2.com/documentation-preferences-profiles-colors.html)
    shifts "text colors that are similar to their background colors closer to black or white", and
    "never modifies background colors".
  - The bar is 4.5:1, the same as the app's text. Ghostty suggests 1.1 to stop invisible text and
    calls 3 or more good, so ours is stricter on purpose: one bar for every word on the desk.
  - The two built-ins need it only where a fill color is used as text: black (0) in `fabrika`, the
    two whites (7, 15) in `fabrika-light`. Every other color reads 4.5 on the background as written.
  - The check, run over every pair a program can draw (the default text and the 16, on the default
    background and the 16, 273 pairs): in the study's unreadable test (every color near one gray),
    16 of 16 colors read under 3:1 and all 273 pairs under 4.5:1. Per cell, all 273 reach 4.5.
  - The cursor stays a theme check, at 3:1 on the terminal's background, and moves like `focus`.
    Ghostty leaves the cursor glyph out of minimum contrast too. In the unreadable test it goes from
    1.07 to 3.05.
  - ghostty-web 0.4 has no minimum contrast. We try it first as a `pnpm patch` to ghostty-web and
    offer it upstream. Until one lands, the terminal draws the file's colors as they are, and the
    `themes` program counts the colors under 4.5 before a person picks.
  - Sure: 75%. Doubt: the cost of one more contrast step per cell in ghostty-web's renderer, and
    upstream's answer. A patch measured with four full terminals, as the study's swap was, settles
    the first.
- **The file brought in is never changed.** Repair writes a new file, `<name>-fabrika.toml`, with
  `[repaired]` saying what changed. Import keeps only the original's hash, as above.
- **A file in `themes/` that fails at load is not applied.** That is a file written or edited by
  hand, since import never writes one that fails. The app keeps `fabrika` and says once:
  `theme mine: stuck under 4.5:1; using fabrika`. The `themes` program offers to import it as
  `mine-fabrika`. Sure: 70%. Doubt: a person tuning their own file may want it shown anyway, as they
  edit it.
- **A file that does not decode is not applied.** A value that is not a color, a missing name or
  broken TOML: the app keeps `fabrika` and says why.

What the study's files need, from the same script. No palette is changed in any of them.

| Theme | App colors moved | Terminal colors under 4.5 on the background, lifted per cell |
|---|---|---|
| `fabrika`, `fabrika-light` | 0 | 1 and 2, the fills |
| Nord (Base16) | 3 | 6 |
| Solarized Light (Base16) | 7 | 14 |
| Catppuccin Mocha (Base24) | 1 | 2 |
| Dracula (Ghostty) | 1 | 2 |
| Catppuccin Latte (Ghostty) | 6, and the cursor | 14 |
| Unreadable on purpose | 9, and the cursor | 16 |

When a person meets it:

- **In the `themes` program, before they import.** The preview lists what repair will change, for
  example `stuck #bf616a -> #eb8991`, the name it will be saved under, and how many terminal colors
  are lifted per cell.
- **At import, when repair changed anything.** The bottom line says so once, in one line:
  `Imported Nord as nord-fabrika: 3 colors changed to stay readable`. The file's `[repaired]` lists
  them.
- **At load, when a file is refused.** The bottom line says once: `theme nord: ground is not a
  color; using fabrika`. The `themes` program shows the same reason.
- There is no prompt on opening the app.

Sure: 75%, and 75% on the terminal (its doubt is above). Doubts: which measure gates, WCAG or APCA,
is open (Radix promises APCA). Repair changes colors the person chose: Solarized Light and Latte lift
most of their terminal text when drawn, so a "keep my colors" switch may be wanted. A `-fabrika`
file is a copy: when the scheme's author ships a new version, it must be imported again. A real person using a
brought theme for a week settles both.

### 5. Two names nobody has set yet (proposed)

Both are guesses. Nothing above sets them, and no other tool was found that answers them.

- **A repaired cursor.** A guess: it gets its own row in `[repaired]`, keyed `cursor`, and the
  import line names it apart from the app colors. Latte, from the same script:

  ```toml
  [repaired]
  # ... the six app colors, as for Nord
  cursor = { was = "#dc8a78", now = "#c67665", why = "under 3:1 on background" }
  ```

  ```text
  Imported Catppuccin Latte as catppuccin-latte-fabrika: 6 colors and the cursor changed to stay readable
  ```

  - Why: no app color is named `cursor`, so the key cannot be misread, and one table stays the one
    place a person looks. For this row, `now` must match `[terminal]`'s `cursor`, not `[colors]`.
    The line says "the cursor" apart because the note says the terminal's colors are never changed,
    and this is the one that is. A cursor-only repair still renames the file, since import changed
    a color.
  - Sure: 60%. Doubt: a `[repaired.terminal]` table may read clearer once a second terminal color
    can move. None can today.
- **A pick made in the picker.** A guess: it is named by what was picked, `<gray>-<accent>`, with
  `-light` for the light look, as `fabrika-light` is: `mauve-iris`, `mauve-iris-light`. Slate and
  indigo are `fabrika` and `fabrika-light`, so that pick writes only the `theme` line and no file.
  It keeps its name, as the guess in point 4 says.
  - Why: the name says what the file holds, no prompt asks for one, and two picks never share a
    file. VS Code and Zed have no answer to copy, since their pickers only choose themes that
    already exist.
  - Sure: 55%. Doubt: the built-ins were named `fabrika` on purpose, not by their scales, so the
    owner may want a person to name a pick. Asking costs one text box in the picker.

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
  The contrast numbers come from `experiments/177-themes/rules.py` on the study's files, not from a
  screen: alpha colors were composited by hand, and nothing was drawn. Per-cell contrast was
  worked out over every pair, never drawn, so its cost is not known. `next/` has no window that shows a theme yet.
