---
state: "decided 2026-11-01, contrast and its open points decided 2026-11-07, APCA leaned"
summary: "`next/`, Tier 2. A theme is the person's own config: one TOML file per theme in `~/.fabrika/themes/`, picked by `theme = \"<name>\"` in `~/.fabrika/fabrika.toml`, as Helix, Zed and Ghostty do. A theme is a full set of named colors. A Radix pick is the default way in; a Base16, Base24 or Ghostty file is the other, read in its own format, mapped in, and it keeps its own colors. A built-in `themes` program picks with a live preview and imports files. A theme that repair changes is saved as `<name>-fabrika`, never under its upstream name. A theme that fails contrast is nudged at load (`fix = \"nudge\"`, the default): one checker shared with the token build, lightness only in OKLCH, text, icon and border colors only, capped with fabrika's own value past the cap, never rewriting the file; `fix = \"off\"` shows it as written with the same warnings. Proposed: the data shape, live switching, what a third-party program gets. Today's app moves to the built-in `fabrika` and `fabrika-light` values (ticket 144). *Changed 2026-11-07: a theme sets only global tokens; built-ins are generated from the token files; `turn` becomes `turn-fill`, focus slate a9. Decided 2026-11-07: a Radix pick is only a gray and an accent, checked over all 300 in the token build; `fix` covers app colors, terminal text per cell and the cursor; `[theme] contrast` sets the text floor, 4.5 up to 21, never lower; a repaired cursor gets its own `[repaired]` row. Leaned: WCAG 2.2 now, APCA as a second floor after a measurement.*"
---

# People bring their own themes

**Decided 2026-11-01 by the owner**, after [experiment 177](../../experiments/177-themes.md). Each
person picks the colors they see. The default way in is a Radix pick. A theme file people already
use (Base16, Base24, Ghostty) is the other way in, and it keeps its own colors, even though they are
not Radix steps. `next/` builds this. Nothing is built yet. **Point 4, a theme that fails
contrast, decided 2026-11-07 by the owner:** the app nudges it at load, or shows it as written.

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
  says what came in and what changed. *Changed 2026-11-07: repair now also runs at every load, as
  the nudge, and never writes a file ([point 4](#4-a-theme-that-fails-contrast-decided-2026-11-07));
  import still writes this repaired file, decided 2026-11-07: a person can open it and read what
  changed.* This is the Linux distro habit for a patched package: Debian
  adds `+deb13u1` to a stable update
  ([Developer's Reference 5.5.1](https://www.debian.org/doc/manuals/developers-reference/pkgs.en.html)),
  and Ubuntu adds `ubuntu1` the first time it changes a Debian package
  ([version string format](https://ubuntu.com/project/docs/how-ubuntu-is-made/concepts/version-strings/)),
  so nobody takes their version for the upstream one.
- **The terminal's per-cell check never renames anything.** It happens as the terminal draws and
  never changes a file ([below](#4-a-theme-that-fails-contrast-decided-2026-11-07)).
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
  - The window follows the system's look: each token is `light-dark(<fabrika-light>, <fabrika>)`
    under `color-scheme: light dark`. `packages/fabrika-design/src/themes.ts` (P31; it was
    `apps/fabrika/src/themes.ts`) holds both themes for the terminal and the window's frame.
  - **Added 2026-11-01, approved by the owner from the design review:** a line or fill token is
    never a text color. Eight rules drew text in `--wire` (slate a8), `--border-strong` (slate a7)
    or `--key` (indigo 9), which read as low as 1.54 on a row. Those words now take `--text-faint` (slate a11)
    or `--turn` (accent 11, a11 in light). The tokens stay for the lines and fills they draw.
    `apps/fabrika/src/window/colors.test.ts` (it was `themes.test.ts`) holds every `color:` token to 4.5:1 on the desk, the ground,
    raised and hovered and selected rows, in both looks.
  - The one named exception: white on the hovered turn fill (indigo 10) in dark reads 4.28. The
    owner kept Radix's step; tracker ticket 153 tracks it.
  - **Decided 2026-11-02 by the owner, from the screenshot review of ticket 144:** text takes
    Radix's two text steps only. Slate 12 is for titles and main lines. Slate a11, the look's low
    step, is for secondary, muted and faint text alike. Rank comes from weight and size, not a third
    gray. So `--text-secondary` and `--text-muted` both point at `--text-faint`.
    - What changed: dark `--text-secondary` was slate 11, a third gray between a11 and 12, and a11
      read stronger than a slate 11 title on dark rows. Four main lines (a tracker ticket row's and pull
      request row's titles, a palette command's name, a trace row's name) drew in the low step and
      now draw in slate 12.
    - Kept low on purpose: a set-aside row's title. Set aside is a state, not a rank, and its
      dashed ring is the second cue.
    - `apps/fabrika/src/window/colors.test.ts` holds it: every gray text token is slate 12 or the one low
      step, every listed main line is slate 12, and a row's title reads at least as strong as the
      text beside it, at rest, hovered and selected.

## The same rule as keybindings

Themes and keys follow one rule: **user config, with the defaults as the first rows.** See
[keybindings are configurable](./keybindings-are-configurable.md). Both live in the person's home,
`~/.fabrika/`, and each setting has one home there.

- The built-in themes are `fabrika`, the dark default, and `fabrika-light`. They ship as files in
  the same TOML shape, and they are the first rows of the list the picker shows. *Changed
  2026-11-07 ([design language](./design-language.md), call 5): the built-in theme files are
  generated from the token files, not written by hand.*
- A person's own files come after. A guess, to match keys: a file with a built-in's name wins over
  the built-in, as a later row does.
- One difference from keys: a theme is a full set, so a file is not merged with the default. On the
  lean below, a file with a color missing does not load
  ([what the app does](#4-a-theme-that-fails-contrast-decided-2026-11-07)).

## The answer each way in gives

These are sketches of the shape proposed below. Every number was computed by
`experiments/177-themes/rules.py`, which runs this note's rules on the files experiment 177 kept
(`experiments/177-themes/schemes/`); the experiment says how to run it. They are
WCAG contrast ratios, each over the worst of the backgrounds the color sits on (desk, ground and
raised for text; the ground for focus and the turn fill; the fill for `on-turn`). No number here was
read off a screen.

**The built-in `fabrika`, a Radix pick, written out:**

*Changed 2026-11-08: design foundations PR 1 builds slate a9 focus in both looks and the
`turn-fill` name in today's version. The sketch follows those values. Dark focus contrast below
is recomputed from a9 over the ground, with the same 8-bit alpha rounding as the app's laws.*

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
desk = "#0c0d0e"      # no gray step is darker than 1: a bend, see below
ground = "#111113"    # gray 1
raised = "#18191b"    # gray 2
hover = "#ddeaf814"   # gray a3
edge = "#d3edf81d"    # gray a4, the bend color principles already records
focus = "#dfebfd6d"   # gray a9 in both looks; was a8 #d9edff5d in dark
text = "#edeef0"      # gray 12
faint = "#f1f7feb5"   # gray a11
turn-fill = "#3e63dd" # accent 9: your turn
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
focus 3.68 (a9; was 3.01 at a8)   turn-fill 3.62   on-turn 5.21   edge 1.31 (carries no fact, see below)
terminal: every color but black (0, a fill) 4.82 or more on the background
moved by repair: 0
```

**The built-in `fabrika-light`:** the same pick, `look = "light"`. Four colors are a step up from
the dark one:

- `running` is amber 12, since amber 11 reads 4.38. Repair would move it there.
- **Changed 2026-11-01, approved by the owner from the design review of ticket 144:** `done` is
  grass 12 (`#203c25`), `stuck` red 12 (`#641723`) and `turn-text` indigo a11 (`#002bb7c5`). This
  note had them at step 11. Step 11 passes on the desk, the ground and raised, but the window also
  draws these words on hovered and selected rows, and there step 11 fails: grass 11 reads 3.77, red
  11 3.88 and indigo 11 4.47 on a selected row. Grass a11 and red a11 fail there too (4.05, 4.15),
  so step 12 is the nearest that passes. Indigo a11 is the same step 11, see-through, and passes.

Focus is slate a9 in both looks, since a8 reads 1.90 on the desk in light and 2.82 on a selected
row in dark.

```toml
# fabrika-light's [colors], the three that changed
turn-text = "#002bb7c5" # accent a11; was accent 11, #3a5bc7
done = "#203c25"        # step 12; was step 11, #2a7e3b
stuck = "#641723"       # step 12; was step 11, #ce2c31
```

```text
over desk, ground and raised:   text 15.58  faint 5.81  turn-text 5.79  done 11.51  running 10.81
                                stuck 11.83  focus 3.27
also over hovered and selected rows, the worst:  faint 5.32  turn-text 4.93  done 9.02  stuck 9.26
```

With those written in, repair moves nothing. In the terminal, white and bright white (7 and 15, slate
8 and 7) are fills, and every other color reads 4.65 or more on the background. The terminal keeps
grass 11 and red 11, since its colors sit on its own background, never on a row. The cost: running
reads brown, not amber, and done and stuck read close to black next to body text, so the word and
the mark carry the state more than the hue does.

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

Each point is a lean from experiment 177, for the owner to settle. Point 4 was settled on
2026-11-07, and its heading says so.

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
- **Changed 2026-11-07 ([design language](./design-language.md), calls 3 to 6):**
  - **A theme sets only global tokens; part tokens follow them.** A tile or popover token is never
    in a theme file. It points at a global token, so it changes when the theme does.
  - **`turn` becomes `turn-fill`, and focus is one slate a9 token everywhere** (call 4). `turn`
    meant the fill here and the text in `window.css`; now each token means one thing.
  - **The `[colors]` keys take the global token names in call 6's rename pull request.** Until then
    this note keeps today's names (`turn`, `faint`, `edge` and the rest), so the sketches above
    still say `turn`.
- **Seven tokens have no theme name.** `--surface-selected`, `--border`, `--border-strong`,
  `--wire`, the keyboard ring `--focus`, `--turn-fill-hover` and `--scrim` are in the design
  package's `tokens.css` but not among the fifteen colors above, so a brought theme could not set
  them. Found in P31; Tier 2 meets it. *Changed 2026-11-07: a part token among them follows a
  global one and needs no theme name; which are global is settled in call 6's rename.*
  *Changed 2026-11-09: an imported theme derives six of them (all but `--focus`) from its own
  palette ([0009](../../.decisions/0009-imported-themes-derive-their-grays.md)).*
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

### 4. A theme that fails contrast (decided 2026-11-07)

**Decided 2026-11-07 by the owner.** A theme must never make the app unreadable, and a person can
still see their theme exactly as written. One setting picks which:

```toml
# ~/.fabrika/fabrika.toml
theme-fix = "nudge"   # the default
# theme-fix = "off"   show the theme exactly as written, with a warning line
```

Each setting is its own line beside `theme = "<name>"`, as Ghostty keeps `minimum-contrast` beside
`theme`. A `[theme]` table can't be used: TOML refuses a key and a table with the same name
(decided 2026-11-09; the examples before said `[theme]` with `fix` and `contrast`).

```ts
// A sketch, in packages/fabrika-design: the one checker. The token build calls it on the
// built-in themes, and the app calls it when it loads a person's theme.
const Fix = Schema.Literals(["nudge", "off"]);

class Moved extends Schema.TaggedClass<Moved>()("moved", {
	token: TokenName, // a text, icon or border token, never a background
	on: TokenName, // the background of the pair that failed
	was: Hex,
	now: Hex, // same hue and chroma in OKLCH, the smallest lightness move that reaches the floor
	from: Schema.Number, // the ratio before, on final values
	to: Schema.Number,
}) {}
class Builtin extends Schema.TaggedClass<Builtin>()("builtin", {
	token: TokenName,
	now: Hex, // fabrika's own value for the look: `fabrika` for dark, `fabrika-light` for light
	why: Schema.Literal("past_cap"),
}) {}
const Change = Schema.Union([Moved, Builtin]);

// pairs and floors come from the token files, the same ones the build reads
declare const check: (theme: Theme, pairs: Pairs, version: RepairVersion) => ReadonlyArray<typeof Change.Type>;
```

```text
theme "dusk": 2 colors moved, 1 uses fabrika's
  text-faint on surface   2.9 -> 4.5
```

**`nudge`** runs when the app loads a person's theme:

- **One checker.** It uses the same contrast function, and the same pairs and floors from the token
  files, that the build uses for the built-in themes. One function, called in both places.
- **It moves text, icon and border colors only, never a background,** since one background sits
  under many pairs.
- **It moves lightness only, in OKLCH.** It keeps hue and chroma, so the color still reads as the
  person's pick, and takes the smallest move that reaches the floor.
- **It is capped.** Past the cap, that one token uses fabrika's own built-in value for the theme's
  look (`fabrika` for dark, `fabrika-light` for light), and says so. The cap's size is set from
  fixture themes, not guessed. It is an open number until then.
- **It checks final values.** A translucent token is composited onto its backdrop first.
- **It shows what moved,** once at load, and through a check command, as in the sketch above.
- **It never rewrites the person's file.** The repaired values are derived each time the theme
  loads.

**`off`** shows the theme as written, and still prints the same warning lines.

Also decided:

- **An agent that writes a theme runs the check, and fixes its own file before the file lands.**
  The nudge is the safety net for files nobody checked.
- **A few real Base16 and Ghostty themes are kept as test fixtures,** each asserting how much it
  moves, so a change to the checker cannot quietly move everyone's colors. Experiment 177's kept
  schemes (`experiments/177-themes/schemes/`) are the candidates.
- **The repair math is versioned.** A new version is a change the fixtures show.
- **When the OS high-contrast mode (forced colors) is on, the person's theme is dropped.** The
  system's colors win.
- **A color picked in the app's color picker goes through the same check.**
- **Import still writes its own copy.** Importing Nord writes `nord-fabrika.toml` with the fixes
  and a `[repaired]` table in it, so a person can open the file and read what changed. The nudge
  is for a file the person wrote; it finds nothing to move in an imported copy.
- **What stays from the proposal:** backgrounds never move (desk, ground, raised, hover, and the
  terminal's background). `edge` is not checked and never moves: it carries no needed fact, at
  1.31:1 in `fabrika` by design, the bend [color principles](./color-principles.md) records.
  `focus` is checked like text, to 3:1, since it is the one line a person must see. A file that
  does not decode (a value that is not a color, a missing name, broken TOML) is not applied: the
  app keeps `fabrika` and says why.
- **Changed 2026-11-07:** a file in `themes/` that fails at load is no longer refused. The proposal
  kept `fabrika` and offered to import it as `<name>-fabrika`; now the nudge repairs it at load, or
  `off` shows it as written. That answers the proposal's doubt that a person tuning their own file
  may want it shown anyway.

The pairs and floors checked today, before they move into the token files (this note's names; the
token files use the global token names after call 6's rename):

| Names | Against | Floor |
|---|---|---|
| `text`, `faint`, `turn-text`, `done`, `running`, `stuck`, `closed` | the worst of desk, ground and raised | 4.5:1, [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| `on-turn` | `turn` | 4.5:1 |
| `focus`, `turn` | the ground (focus is drawn inside the tile) | 3:1, [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| the terminal cursor | the terminal's background | 3:1 |

What the study's files would need, from `experiments/177-themes/rules.py`. These counts come from
the proposal's older repair, which moved away from the background without a smallest-move rule or
a cap, so the fixtures re-measure them under the nudge:

| Theme | App colors moved | Terminal colors under 4.5 on the background |
|---|---|---|
| `fabrika`, `fabrika-light` | 0 | 1 and 2, the fills |
| Nord (Base16) | 3 | 6 |
| Solarized Light (Base16) | 7 | 14 |
| Catppuccin Mocha (Base24) | 1 | 2 |
| Dracula (Ghostty) | 1 | 2 |
| Catppuccin Latte (Ghostty) | 6, and the cursor | 14 |
| Unreadable on purpose | 9, and the cursor | 16 |

When a person meets it:

- **At load, when the nudge moved anything,** or when `off` shows a theme that fails: the lines
  above, once.
- **Any time,** through the check command.
- **In the `themes` program, before they pick or import:** what the nudge would move.
- **At load, when a file does not decode:** `theme nord: ground is not a color; using fabrika`.
- There is no prompt on opening the app.

The points this decision left open, each decided 2026-11-07 unless marked:

- **A Radix pick is only a choice of gray and accent. Decided 2026-11-07.** The token files say
  which step each token takes. The token build checks every pick ahead of time: all 6 grays and 25
  accents, dark and light, the 300 picks the study ran. A step that fails is fixed once, in the
  token file. So a pick always passes at runtime, and the nudge never sees one.

  ```ts
  // A sketch: the token build's check over every pick, with the same checker the app uses.
  const picks = grays.flatMap((gray) =>
  	accents.flatMap((accent) => looks.map((look) => ({ gray, accent, look }))),
  ); // 6 x 25 x 2 = 300
  const failing = picks.flatMap((pick) => check(fromTokens(pick), pairs, version));
  // the build fails while `failing` is not empty; the fix is a step in the token file
  ```

  - **Changed 2026-11-07.** This replaces the proposal below, which moved steps per pick:
- **(Old text) A Radix pick steps up its own scale,** one step at a time, solid or alpha: 11 to 12, a8 to a9,
  9 to 10 or 11, so a pick stays on Radix steps and the nudge finds nothing to move. Run over all
  300 picks (6 grays, 25 accents, dark and light), this always ended on a Radix step. 275 of the
  300 needed a move: every light pick moves `running` (amber 11 to 12) and `focus` (a8 to a9). So
  the built-ins are written with those steps already. A guess: a pick has no upstream file anyone
  could mistake it for, so it keeps its name.
- **The terminal and the cursor fall under the same switch, and the floor is a setting. Decided
  2026-11-07.**

  ```toml
  # ~/.fabrika/fabrika.toml
  theme-fix = "nudge"      # or "off": app colors, terminal text per cell and the cursor, together
  theme-contrast = 4.5     # the text floor everywhere; may be raised (7 is WCAG AAA), never lowered
  ```

  ```ts
  // A sketch, in packages/fabrika-design.
  const Contrast = Schema.Number.check(Schema.isBetween({ minimum: 4.5, maximum: 21 }));
  // a number under 4.5 is raised to 4.5 with one line; a value that is not a number fails to
  // decode, one line says so at load, and the default is used
  const ThemeSettings = Schema.Struct({ fix: Fix, contrast: Contrast });
  // the same schema gives the JSON Schema, so a TOML editor plugin flags a bad value while typing
  const jsonSchema = Schema.toJsonSchemaDocument(ThemeSettings);
  ```

  ```text
  fabrika.toml: theme-contrast = 3 is under 4.5; using 4.5
  ```

  - `nudge` also lifts terminal text per cell against that cell's own background, lightness only.
    It never changes the terminal's palette or any background, the Ghostty and iTerm2 way cited
    below. `off` shows all of it raw.
  - Non-text stays at 3:1: `focus`, `turn` and the cursor.
  - `contrast` is decoded with Effect Schema as a number from 4.5 to 21. A number under 4.5, say 3,
    loads raised to 4.5, and one line says so, at load and in the check command, as above. A value
    that is not a number fails to decode: one line at load says so, and the default is used. The
    person's file is never rewritten.
  - A JSON Schema is generated from the same Effect Schema (`Schema.toJsonSchemaDocument` in Effect
    4.1.1), so TOML editor plugins that read JSON Schema flag the value while typing.
  - The terminal has no contrast setting of its own. It reads the same `contrast`.
  - **Changed 2026-11-07.** The text below set a fixed 4.5 bar for the terminal and kept the cursor
    a separate theme check. Now one switch covers all three, and the bar is `contrast`. The rest
    of the per-cell rule stands as written:
- **(Old text) The terminal's palette is never changed. Its text is kept readable per cell, when it is drawn.**
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
  - The cursor stays a theme check, at 3:1 on the terminal's background. Ghostty leaves the cursor
    glyph out of minimum contrast too. In the unreadable test it goes from 1.07 to 3.05.
  - ghostty-web 0.4 has no minimum contrast. We try it first as a `pnpm patch` to ghostty-web and
    offer it upstream. Until one lands, the terminal draws the file's colors as they are, and the
    `themes` program counts the colors under 4.5 before a person picks.
  - Sure: 75%. Doubt: the cost of one more contrast step per cell in ghostty-web's renderer, and
    upstream's answer. A patch measured with four full terminals, as the study's swap was, settles
    the first.
- **The contrast math: two floors, both always. Decided 2026-11-07.** Text needs WCAG 4.5:1 (or
  the person's raised `contrast`) and APCA Lc 60. Non-text needs WCAG 3:1 and APCA Lc 15. The one
  contrast function computes both, so the token build and the nudge change together.

  ```ts
  // A sketch: the one function both callers use.
  declare const passes: (fg: Hex, bg: Hex, floor: Floor) => boolean;
  const text: Floor = { wcag: 4.5, apca: 60 }; // wcag rises with the person's `contrast`
  const nonText: Floor = { wcag: 3, apca: 15 };
  ```

  - The measurement (today's version, on main): 387 of today's color pairs, 365 text and 22
    non-text, from `packages/fabrika-design/src/themes.test.ts` and
    `apps/fabrika/src/window/colors.test.ts`, with apca-w3 0.1.9.
  - 19 text pairs passed WCAG but failed APCA Lc 60, all in the dark look: status colors on
    hovered or selected rows, one button label, and 4 terminal colors. No non-text pair failed
    Lc 15.
  - Why these levels: APCA's
    [bronze simple mode](https://readtech.org/ARC/tests/bronze-simple-mode/) asks Lc 60 for
    content text and Lc 75 for body text, and
    [Why APCA](https://git.apcacontrast.com/documentation/WhyAPCA) gives Lc 15 for non-text that
    must be seen. Radix
    [promises](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
    steps 11 and 12 reach Lc 60 and Lc 90 only on step 2 of the same scale, so a hovered or
    selected row is outside that promise.
  - **Wrong:** the earlier lean said non-text Lc 30. APCA's own non-text minimum is Lc 15.
  - **Changed 2026-11-07.** The old text said: "Which measure the one function uses, WCAG or
    APCA, is still open (Radix promises APCA). The nudge uses whatever the token build uses, so
    the choice is made once." The last part still holds.

- **Radix is the primitive layer only. Decided 2026-11-07.** Primitives are Radix steps, solid
  and alpha, so 24 per scale. A semantic token may name a scale and a floor instead of a fixed
  step. The build picks the faintest step that passes both floors on every background in its `on`
  list, per look.

  ```toml
  # tokens/color/text-stuck.toml (a sketch)
  type = "text"
  on = ["surface", "surface-hover", "surface-selected"]
  floor = 4.5
  [colors]
  scale = "red"   # the build picks the step, per look
  ```

  - This walks back the [color principles](./color-principles.md)' rule that each Radix step
    keeps its job (11 for quiet text, 12 for strong). Radix's roles become a starting point.
  - If a token keeps landing on a step that is too bright, a finer step may be added to the
    primitive layer, with its reason written beside it as a bend, and only then.
  - Doubt: a status color may land on different steps in different places and look uneven. Shots
    at the design PRs settle it.

### 5. Two names nobody has set yet (one decided 2026-11-07, one proposed)

Both were guesses. Nothing above sets them, and no other tool was found that answers them. The
cursor's is decided; the picker's stays proposed.

- **A repaired cursor. Decided 2026-11-07,** as sketched: it gets its own row in `[repaired]`, keyed `cursor`, and the
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
- **Principle 1, accessible.** Kept by the nudge, above, unless the person sets `theme-fix = "off"`.

## What this cannot tell us

- Whether anyone beyond the owner wants a brought theme. No user has picked one.
- How a brought theme looks with Radix pipe washes on it. Nobody has looked.
- Whether the nudge feels like the app overruling the person. Nobody has used it for long, and
  `off` is the way out.
- How big the nudge's cap is. It is set from the fixture themes, and none is kept yet.
- The live-switching and Nord-at-2.83 numbers are from today's version, on one Mac, in experiment 177.
  The contrast numbers come from `experiments/177-themes/rules.py` on the study's files, not from a
  screen: alpha colors were composited by hand, and nothing was drawn. Per-cell contrast was
  worked out over every pair, never drawn, so its cost is not known. `next/` has no window that shows a theme yet.
