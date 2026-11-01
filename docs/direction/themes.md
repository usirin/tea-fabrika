# People bring their own themes

**Decided 2026-11-01 by the owner**, after [experiment 177](../../experiments/177-themes.md). Each
person picks the colors they see. The default way in is a Radix pick. A theme file people already
use (Base16, Base24, Ghostty) is the other way in, and it keeps its own colors, even though they are
not Radix steps. `next/` builds this. Nothing is built yet.

```toml
# ~/.fabrika/fabrika.toml, the person's own settings
theme = "nord"   # a file in ~/.fabrika/themes/; leave the line out for the default
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

- The built-in themes ship as files in the same TOML shape. They are the first rows of the list the
  picker shows. The default pick is one of them.
- A person's own files come after. A guess, to match keys: a file with a built-in's name wins over
  the built-in, as a later row does.
- One difference from keys: a theme is a full set, so a file is not merged with the default. On the
  lean below, a file with a color missing does not load
  ([what the app does](#4-a-brought-theme-that-fails-contrast-proposed)).

## The answer each way in gives

These are sketches of the shape proposed below. The numbers are WCAG contrast over each theme's own
ground. The Nord numbers come from experiment 177's results, on today's version.

**A Radix pick, written out by the `themes` program:**

```toml
# ~/.fabrika/themes/slate-indigo.toml (a sketch)
format = 1
name = "slate-indigo"
look = "dark"

[from.radix]
version = "3.0.0"   # a new Radix version changes a pick's colors, so it is kept
gray = "slate"
accent = "indigo"

[colors]
ground = "#111113"    # slate 1
raised = "#18191b"    # slate 2
hover = "#ddeaf814"   # slate a3
edge = "#d3edf81d"    # slate a4, the one bend color principles records
focus = "#d9edff5d"   # slate a8
text = "#edeef0"      # slate 12
faint = "#f1f7feb5"   # slate a11
turn = "#3e63dd"      # indigo 9: your turn
turn-text = "#9eb1ff" # indigo 11
done = "#71d083"      # grass 11
running = "#ffca16"   # amber 11
stuck = "#ff9592"     # red 11

[terminal]
foreground = "#edeef0"
background = "#111113"
palette = [ ... ]     # 16 colors, built from steps 9 and 11
```

```text
text 16.25   faint 9.07   turn-text 9.15   done 9.93   running 12.32   stuck 8.95
moved by repair: 0   every value a Radix step
```

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
ground = "#2e3440"   # base00
text = "#e5e9f0"     # base05
turn = "#81a1c1"     # base0D
done = "#a3be8c"     # base0B
running = "#ebcb8b"  # base0A
stuck = "#bf616a"    # base08
# ... the other names, mapped once at import

[terminal]
foreground = "#e5e9f0"
background = "#2e3440"
palette = [ ... ]    # the Tinted Theming roles, base00 to base0F
```

```text
text 10.26   terminal colors under 3:1: 2
moved by repair, in the app only, never in the file:
  stuck  #bf616a -> #e8868d   (2.83 where it is used)
  turn-text, faint gray and closed: 3 more, each a small move in lightness
off Radix: 14 of the 16 terminal colors are more than 0.02 in OKLab from the nearest Radix color
```

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

- **What the app does.** On every load, each text color is checked against the background it sits on:
  4.5:1 for text ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)),
  3:1 for a needed edge such as focus
  ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). A color under the
  bar moves along its own hue, lightness only, until it reads. The ground never moves. iTerm2's
  minimum contrast works the same way.
- **It always ends readable.** Black or white text reaches 4.5:1 on any ground, so the worst case
  ends there.
- **The file stays the person's.** Repair happens in the app, in memory. It never rewrites the file.
- **A Radix pick moves up its own scale**, from step 11 to 12, so a pick stays on Radix steps. The
  study found light accent 11 on gray 3 under 4.5 in 66 of 150 picks.
- **A file that does not decode is not applied.** A value that is not a color, a missing name or
  broken TOML: the app keeps the built-in default and says why in one line.
- **The terminal palette is only counted.** ghostty-web has no minimum contrast yet. We ask upstream
  for one, as Ghostty, iTerm2 and xterm.js have. Moving a palette color would change what a
  program's colors mean.

When a person meets it:

- **In the `themes` program, before they pick.** The preview lists what repair moved, for example
  `stuck #bf616a -> #e8868d`, and how many terminal colors are under 3:1.
- **For a hand-edited file, at load.** The bottom line says once: `theme nord: ground is not a color;
  using the default`. The `themes` program shows the same reason. There is no prompt on opening the
  app.

Sure: 75%. Doubts: which measure gates, WCAG or APCA, is open (Radix promises APCA). And repair
changes a color the person chose, so a "keep my colors" switch may be wanted. A real person using a
brought theme for a week settles both.

## The color principles a brought theme gives up

[Color principles](./color-principles.md) asks a theme to keep the principles or say which it gives
up.

- **Principle 5, every value a Radix step.** A brought theme gives it up on purpose. The default and
  every Radix pick keep it.
- **Principle 2, a color means one thing.** Kept by the mapping: done, running and stuck come from
  the file's green, yellow and red, and pipes stay Radix. A Radix pick can break it with an accent
  near a state color: 14 of 25 accents sit within 25 degrees of one. The picker offers the 11 clear
  ones first (blue, cyan, indigo, iris, mint, pink, plum, purple, sky, teal, violet), and warns on
  the rest.
- **Principle 1, accessible.** Kept by repair, above.

## What this cannot tell us

- Whether anyone beyond the owner wants a brought theme. No user has picked one.
- How a brought theme looks with Radix pipe washes on it. Nobody has looked.
- Whether repair feels like the app overruling the person. Nobody has used it for long.
- Every number is from today's version, on one Mac, in experiment 177. `next/` has no window that
  shows a theme yet.
