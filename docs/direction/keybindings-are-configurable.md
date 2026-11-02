# Keybindings are configurable

**Decided 2026-11-01 by the owner:** every keybinding is configurable from day one, the prefix
included; the prefix is a setting of its own, and bindings write `<prefix>` for it, as Vim's
`<Leader>`; the bindings live in the person's own TOML file, as one flat list written command to
key (a tryout); every command carries its program's name, `desk.split`; each mode gets a section
of its own with a keys sub-section, named by its program, `[mode.terminal.copy]`; fabrika ships a
program to change them; and Tier 1 reads the file while that program arrives in Tier 2. **What
else a mode section holds, the key spelling, how a command's word is written, what a clash from
the program does, live reload, and that keys and modes come from programs, not packs, are
proposed,** each with a lean below.

Built from [experiment 182](../../experiments/182-keybindings.md), which read how about twenty
tools do it, and a clickable page, "Keybinding guidelines", a private page with twelve rules
you can press. Neither is a measurement.

```toml
# ~/.fabrika/keybindings.toml: only what you changed. The defaults ship with the app.
prefix       = "ctrl+a"                        # a setting, as tmux's `set -g prefix C-a`
desk.split   = "<prefix>|"                     # program.command = key; <prefix> as Vim's <Leader>
desk.zoom    = ["<prefix>z", "<prefix>enter"]  # several keys
palette.open = "cmd+k"                         # pressed alone
desk.detach  = []                              # unbound: the key goes on to the program
```

```ts
// next/: a press is turned into a command in the window. Only the finished command travels.
// C-a then g, in a window on a Mac:
{type: "did", does: "desk.fold", via: {_tag: "key", keys: "ctrl+a g"}}
```

## Which version

- **`next/`:** true from the first window in Tier 1. Tier 1 has no desk and few keys (`e` on a
  note is one), and it reads every key it has from the file. The desk, its prefix keys and the
  keybindings program arrive in Tier 2.
- **Today's version (`apps/fabrika`):** not changed by this note. Its rule adds only fixes, the
  UX the owner picks, and tryouts. See [a tryout in today's version](#a-tryout-in-todays-version).

## What was decided

### K1: every binding is data

- A binding is a row: a command word and its keys. No key is wired into a handler.
- The defaults are just the first rows. A person's rows lay over them.
- A person can rebind or unbind any of them. The few limits are in
  [keys that cannot be taken away](#keys-that-cannot-be-taken-away), and each one is a
  platform's or a law's, not ours.
- **Why:** one shape for defaults and changes. Today's `keys.ts` is already rows, and tmux,
  Ghostty, kitty, VS Code, Zed and Windows Terminal all work this way.

### K2: TOML, in a file of its own

- The config is TOML, not JSON, keybindings included.
- Bindings live in `~/.fabrika/keybindings.toml`, not inside `fabrika.toml`.
- **Why a file of its own:** the app writes this file when someone rebinds by pressing a key. A
  file of its own keeps the app out of the settings a person writes by hand. VS Code keeps
  `keybindings.json` apart from `settings.json` for the same reason, and Zed keeps `keymap.json`
  apart from `settings.json` and has its keymap editor write it.
- **Why the home folder:** a key is the person's, like a theme. A repo that rebound your keys
  would choose for your hands. This does not change
  [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md); keys are simply not in it.
- TOML refuses the same key twice. With command to key (K6), that means one command cannot be
  written twice; two commands on one key can be, so the load checks for it.

### K3: a program for keys

fabrika ships a built-in program to search the bindings, press a key to rebind one, see clashes,
and write `keybindings.toml`. **Its name is proposed: `keys`.** Today's `C-b ?` already opens a
panel called keys, so the word is one people have met.

```text
keys      search "fold"
  desk.fold   C-b f      default
  > Enter     press a key...   (g)
  desk.fold   C-b g      yours     the file gets  desk.fold = "<prefix>g"
  needs a look:  desk.zoom has no key (palette and tsh only)
```

What it takes from each tool studied:

- **VS Code's Keyboard Shortcuts editor:** one list of every command, with or without a key; a
  search that matches a command or a key; a box that "listens for key presses"; "Show Same
  Keybindings" for clashes; a source column that says default or yours.
- **Zed's keymap editor:** the program writes the same file a person edits by hand, and a hand
  edit shows in the program at once.
- **Ableton Live's Key Map mode:** a mode that marks every part that can take a key, then one
  click and one press. Live marks them in red; ours needs a second cue, such as a key cap on each
  part, since color is never the only cue.

### K4: the tiers

Decided by the owner today. **Tier 1 reads the file.** **The keybindings program is in Tier 2,**
since that is where the desk arrives as a program with split, close and prefix keys, so the
program arrives with the keys it edits. The `themes` program, and reading theme files, is in Tier
2 too. Both are now in [the tiers](../plan/tiers.md).

### K5: the prefix is a setting, and `<prefix>` stands in for it

Decided by the owner today.

- The prefix is configurable, like any other key: `prefix = "ctrl+a"`, at the top of the file.
- It is a setting, not a binding. tmux does the same: `prefix` is an option, "Set the key
  accepted as a prefix key", changed with `set -g prefix C-a`
  ([tmux(1)](https://man.openbsd.org/tmux.1)). A setting holds one value, so there is always
  exactly one prefix.
- A binding writes `<prefix>` where the prefix goes, as Vim's `<Leader>`: "the special string
  '<Leader>' can be used. It is replaced with the string value of 'g:mapleader'", set with
  `let mapleader = ","` ([`:help mapleader`](https://vimhelp.org/map.txt.html#mapleader)). So
  `desk.split = "<prefix>|"` follows the prefix when it moves.
- One difference from Vim: Vim reads `mapleader` "at the moment the mapping is defined", so a
  later change leaves old mappings alone. Ours rebuilds the whole table from the file on every
  load, so a new `prefix` moves every `<prefix>` binding at once.

### K6: one flat list, command to key, a tryout

Decided by the owner today, as a tryout.

```toml
# ~/.fabrika/keybindings.toml
prefix       = "ctrl+a"
desk.split   = "<prefix>|"
desk.close   = "<prefix>x"
desk.zoom    = ["<prefix>z", "<prefix>enter"]
palette.open = "cmd+k"
desk.detach  = []       # unbound
```

- One flat list, one row per command. With program names (K9), TOML's dotted keys make each
  program a table, `desk` and `palette`, but the file still reads as one list. It is valid TOML:
  smol-toml 1.9.1, the parser in this repo's lockfile, reads it. An earlier sketch with a
  `[prefix]` table next to `prefix = "ctrl+a"` was not ("trying to redefine an already defined
  table or value"); that clash is gone.
- A key with `<prefix>` is pressed after the prefix. A key without it, like `cmd+k`, is pressed
  alone.
- The person's file holds only what they changed. The defaults ship with the app.
- A command takes one key or a list. An empty list unbinds, and there is no `noop` word.
- A command's description comes from the command itself, never from the file. VS Code's
  `keybindings.json` carries none either.
- **The cost, named by the owner.** Key to command (`"|" = "desk.split"`) makes "one key does one
  thing" impossible to break, since TOML rejects a repeated key. Command to key gives that up. So
  the load refuses a key claimed by two commands and names both, and the keys program shows the
  reverse view: what does this key do.
- **The load refuses,** each with a plain reason:
  - an unknown `<...>` word: "`<leader>` is not a word here; did you mean `<prefix>`?"
  - a key claimed by two commands in the same place: "`<prefix>x` is on both desk.close and
    desk.detach." The global keys, each program's tile keys and each mode are checked apart (K7,
    K9).
  - `prefix` set to a key that is also bound alone: "ctrl+a is your prefix, so it cannot also
    run desk.split."
  - a program named with a word the file keeps for itself (K9): "`mode` is a word this file
    keeps, so no program can be called mode."
  - no way out of a tile, the no-trap rule: "with neither `<prefix>` nor F6 left, a terminal tile
    would keep your keys." A mode with no key on `exit` is refused the same way (K7).
  - and, as before, a bare printable key pressed alone (it would stop typing in tsh, and WCAG
    2.1.4 wants a one-letter key only where focus is), and a bare letter as the prefix.
- **We differ from everyone read.** Yazi writes a list of entries, `{ on = [ "g", "d" ], run =
  "cd ~/dev" }` ([Yazi keymap](https://yazi-rs.github.io/docs/configuration/keymap/)). Alacritty
  writes `{ key = "N", mods = "Control|Shift", action = "CreateNewWindow" }` in a `bindings` list
  ([Alacritty](https://alacritty.org/config-alacritty.html)). Rio writes `[[bindings.keys]]` entries
  with `key`, `with` and `action` ([rio-bindings(5)](https://man.archlinux.org/man/rio-bindings.5.en)).
  Helix writes key to command, `C-s = ":w"` under `[keys.normal]`
  ([Helix remapping](https://docs.helix-editor.com/remapping.html)). None writes command to key,
  and none read keeps one flat list with a stand-in for the prefix; Vim's `<Leader>` is the
  nearest.
  **Why we try it anyway:** a person edits by command ("what is zoom on?"), and the file reads the
  same way the keys program lists it, one row per command.
- **What flips it back to key to command:** two-commands-on-one-key refusals turning up often in
  real files.

### K7: a mode is a section, with its keys inside

Decided by the owner today. Modes are bigger than keys, so each gets a section of its own. The
top of the file stays the flat list for normal use.

```toml
prefix     = "ctrl+a"
desk.split = "<prefix>|"

[mode.terminal.copy]
enter = "<prefix>["          # how you get in, written like any key

[mode.terminal.copy.keys]
select = "v"                 # inside a mode, the program is already named
yank   = "y"
exit   = ["q", "escape"]
```

- It is valid TOML: smol-toml 1.9.1 reads it as `mode.terminal.copy.enter` and
  `mode.terminal.copy.keys`.
- **The program that owns a mode defines what it does.** Copy mode belongs to the terminal. The
  person's file sets only how you get in and the mode's keys. Inside a mode's keys, a command is
  the mode's own word, `yank`, since the section already names the program.
- **A key in a mode applies only in that mode.** So `v` there never clashes with a top-level key.
  The two-commands check runs per mode.
- **The no-trap rule covers modes.** The load refuses a mode with no way out, so `exit` cannot be
  emptied: "copy mode would have no way out; keep at least one key on exit."
- `mode` becomes a word the file keeps for itself: a program named `mode` would mix its commands
  into the modes table (K9). K9 lists every such word.
- **How others do modes.** Helix keeps a table per mode, `[keys.normal]` and `[keys.insert]`
  ([Helix remapping](https://docs.helix-editor.com/remapping.html)). tmux's copy mode "uses one
  of two key tables", `copy-mode` or `copy-mode-vi` ([tmux(1)](https://man.openbsd.org/tmux.1)).
  Zellij writes a block per mode, `normal { bind "Ctrl g" { SwitchToMode "locked"; } }`
  ([Zellij keybindings](https://zellij.dev/documentation/keybindings)). Vim keeps one map command
  per mode, `:nmap` and `:vmap` ([`:help map-modes`](https://vimhelp.org/map.txt.html#map-modes)).
  We follow Helix's and Zellij's shape: a named block per mode, holding its keys.

### K8: a mode is named by its program

Decided by the owner on 2026-11-01.

```toml
[mode.terminal.copy]         # [mode.<program>.<mode>]
enter = "<prefix>["

[mode.terminal.copy.keys]    # [mode.<program>.<mode>.keys]
yank = "y"
```

- A mode's section is `[mode.<program>.<mode>]`, and its keys sit in
  `[mode.<program>.<mode>.keys]`. Copy mode is `[mode.terminal.copy]`.
- **Built-in programs get no short form.** There is no `[mode.copy]`, even though the terminal
  ships with the app.
- **Why:** explicit is better for configuration. The file says whole names, so a reader never
  guesses which program a mode belongs to. And packs from strangers cannot clash: two packs that
  both call a mode `select` sit under two program names.
- **The cost:** a longer header. A person writes one rarely, and the keys program writes it for
  them.

### K9: every command carries its program's name

Decided by the owner on 2026-11-01.

```toml
prefix       = "ctrl+a"       # words the file keeps: prefix, mode, ignore
ignore       = ["mod+w"]
desk.split   = "<prefix>|"
desk.close   = "<prefix>x"    # today's close-tile
desk.zoom    = ["<prefix>z", "<prefix>enter"]
desk.fold    = "<prefix>f"
keys.open    = "<prefix>?"    # today's C-b ?
palette.open = "cmd+k"
```

- A command is `<program>.<word>`, and the word is the program's own.
- **Owners, for the commands in this note:** `desk` owns split, close, zoom, fold and detach.
  `palette.open` opens the palette. `keys.open` opens the keys program.
- **It ends a naming clash.** Today's tile close is the tsh word `close-tile`, because tsh's own
  `close %n input` already ends a job's input (`desk/keys.ts`, today's version). With program
  names they are `desk.close` and `tsh.close`, and neither has to bend.
- **TOML's dotted keys make each program a table.** smol-toml 1.9.1 reads the block above as
  `{desk: {split, close, zoom, fold}, keys: {open}, palette: {open}}`, so the file still reads as
  one list (K6) and the load reads one table per program. A word with spaces is quoted after the
  dot: `desk."split --to down" = "<prefix>-"` reads as `{desk: {"split --to down": ...}}`. Run
  once on a scratch copy, outside the repo.
- **One TOML catch, from the same run:** a `[desk]` table after a `desk.split` line is refused
  ("trying to redefine an already defined table or value"). So the keys program writes dotted
  rows only, and the load names the line when a person mixes both.
- **Words the file keeps for itself:** `prefix`, `mode` and `ignore`. No program may take one of
  those names. A program called `prefix` or `ignore` would clash with that row: the run refused
  `prefix.x` after `prefix`, and `ignore.x` after `ignore`. One called `mode` is worse, since TOML
  does not refuse it: the run read `mode.x = "y"` beside `[mode.terminal.copy]` as one `mode`
  table, so the load could not tell a command from a mode. So the load refuses such a program and
  says why: "`mode` is a word this file keeps, so no program can be called mode." `ignore` stays
  a bare word, as Ghostty's, since it belongs to no program.
- **The two-commands check** runs once over the global keys and once per program table. A key
  claimed twice inside `desk` is refused; `j` in one program's tile keys and `j` in another's is
  not a clash, since only one tile has focus (see
  [keys come from programs](#keys-and-modes-come-from-programs-not-packs)).
- **The industry does this.** VS Code's command ids carry their owner's name,
  `workbench.action.quickOpen` and `editor.action.commentLine`
  ([VS Code key bindings](https://code.visualstudio.com/docs/configure/keybindings)). Zed's
  actions do too, `workspace::ActivatePane` and `editor::Indent`
  ([Zed key bindings](https://zed.dev/docs/key-bindings)). Ours writes a dot, which TOML reads as
  a table.

## Commands are the protocol

Name the protocol first: **a key press maps to a named command, in the client.** The window holds
the table as a value, runs the prefix itself (W5 in [the desktop layer](./the-desktop-layer.md#w5-keys)),
and sends one finished command. A key never crosses the wire.

```ts
// A sketch, next/. The table is a value the window is handed; the window never reads a file.
type Key = {_tag: "alone"; key: string} | {_tag: "after_prefix"; key: string}; // "<prefix>z"
type Program = string; // "desk", "terminal"; never prefix, mode or ignore (K9)
type Command = `${Program}.${string}`; // "desk.split": the program's name, then its word
type Binding = {does: Command | "ignore"; keys: Key[]}; // keys: [] is unbound
type Mode = {
	enter: Key[]; // how you get in, written like any key
	bindings: {does: string; keys: Key[]}[]; // the mode's own words, "yank"; must keep a key on exit
};
type Keys = {
	prefix: string; // "ctrl+a": a setting, never a binding
	global: Binding[]; // work anywhere: desk.split, palette.open (proposed, below)
	tiles: Record<Program, Binding[]>; // only while that program's tile has focus (proposed, below)
	modes: Record<Program, Record<string, Mode>>; // [mode.terminal.copy]; what a mode does is its program's
};
type Via = {_tag: "key"; keys: string} | {_tag: "palette"} | {_tag: "word"} | {_tag: "click"};
type Did = {type: "did"; does: Command; via: Via};
```

- **A browser tab can be this client.** It holds a value and listens to `keydown`. Nothing here
  needs a file, a socket or Node.
- **One table, shown everywhere.** The keys program, the palette (Cmd-K), the bottom line after
  the prefix, tooltips and what a screen reader is told all read the same rows. Linear and
  Superhuman teach keys this way: the palette shows each command's key.
- **Losing a key never loses a command.** Every command is also in the palette and is a tsh word
  (W5, 85%).

## Keys and modes come from programs, not packs

**Proposed 2026-11-01, a lean.** Program level, 80% sure. The clash rule, 70%.

```text
a program says    its commands, its default keys, its modes, side by side
a pack is         only the package programs ship in; remove it, and its keys and modes go too
tile keys         only while that program's tile has focus; two programs cannot clash
global keys       rare; load order: the app, then packs, then you
a pack never      takes an app key, the prefix or F6
two packs, one    global key: both lose it, and the keys program says so
```

- **A program declares its keys and its modes beside its commands.** A pack is only the package
  programs ship in ([add-on packs are programs](./packs-are-programs.md)). Remove a pack, and its
  programs go, with their keys and modes. No row is left pointing at a command that is gone.
- **Tile keys** work only while that program's tile has focus, so two programs cannot clash on
  one. This is how the editors read do it. Zed scopes a binding by context: "If it is set, the
  binding is only active when the context matches" ([Zed key bindings](https://zed.dev/docs/key-bindings#contexts)).
  VS Code does it with a `when` clause, such as `focusedView`, "the identifier of the currently
  focused view" ([when clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts)).
  A tile key on the same key as a pack's global key wins while its tile has focus, as Zed's
  "bindings that match on lower nodes in the context tree win".
- **Global keys** work anywhere, and they are rare: the desk's prefix keys, the palette, the keys
  program. They load in order: the app's, then each pack's, then the person's file, which wins
  over both, as K6's rows lay over the defaults.
- **A pack never takes an app key, the prefix or F6,** neither as a global key nor as a tile key.
  The load leaves that pack key unbound and says so in the keys program; the command stays in the
  palette. The prefix and F6 are the no-trap rule's; an app key is one the app's own programs
  ship.
- **Two packs on one global key both lose it,** and the keys program names both until the person
  picks one. VS Code differs: its rules "are evaluated from bottom to top" and "the first rule
  that matches both the `key` and `when` clause, is accepted"
  ([VS Code key bindings](https://code.visualstudio.com/docs/configure/keybindings)), so the rule
  loaded later wins with no message. A silent win is what K6 refuses in a person's own file.
- **Why, and how sure.** Program level, 80%: every editor read scopes keys by focus, and the packs
  note already says a pack is programs in a package, so a key has no other owner to sit on. The
  clash rule, 70%. The doubt: it is untested; nobody has loaded two packs that want one key. A test
  with two fake packs would settle the shape, and real use would tell whether "both lose it"
  annoys more than a silent win.
- **What it costs.** A pack that wants one key across all its programs ships a tiny program that
  holds only that key. And after a clash, a pack's key sits unbound until the person picks one.

### What a program bringing a mode looks like

A sketch. **Made up:** the `notes` program, `Note`, `NoteId`, `NotesMode`, `tableFor`, the note
id `n12`, the words `open`, `next`, `select`, `toggle` and `archive`, and the `keys`, `global` and
`modes` fields.
`Program.define` is today's name in `packages/fabrika`; its `next/` shape is not built.

```ts
// A sketch, next/. The mode lives in the program's model: the Elm answer.
type NoteId = string & {readonly _brand: "NoteId"};
type NotesMode = {_tag: "normal"} | {_tag: "select"; picked: NoteId[]};
type Model = {notes: Note[]; at: NoteId; mode: NotesMode};

const notes = Program.define("notes", {
	keys: {open: "enter", next: "j"}, // tile keys: only while a notes tile has focus
	global: {}, // none; most programs need none
	modes: {
		select: {
			enter: "x", // a tile key that enters the mode
			keys: {toggle: "space", archive: "e", exit: ["escape", "x"]},
		},
	},
	init,
	update, // `notes.select` sets mode to {_tag: "select", picked: []}; `notes.exit` sets it back
	view,
});

// The window reads the focused tile's mode to pick the table. It keeps no mode flag of its own.
const tableFor = (keys: Keys, program: Program, mode: {_tag: string}) =>
	mode._tag === "normal" ? keys.tiles[program] : keys.modes[program][mode._tag].bindings;
```

The person moved `archive` to `a`, and nothing else:

```toml
[mode.notes.select.keys]
archive = "a"
```

One press traced, then the rest of the run:

```text
notes tile has focus, mode normal
x        notes' tile keys    did {does: "notes.select", via: {_tag: "key", keys: "x"}}
         notes' update       mode = {_tag: "select", picked: []}
         the window reads    table: [mode.notes.select.keys]
space    toggle              picked = [n12]
a        archive             n12 archived (the default was e)
escape   exit                mode = {_tag: "normal"}; table: notes' tile keys again
```

- `x` both enters and leaves the mode, and that is no clash: one sits in notes' tile keys, the
  other in the mode's table (K7).
- **The no-trap rule covers a pack's modes too.** A program that ships a mode with nothing on
  `exit`, or a person's file that empties it, is refused at load, as K7 says for copy mode.

### The doubt left: a mode no tile owns

- A resize mode, which moves the edges between tiles, belongs to no single tile. i3 ships one in
  its default config as a binding mode ([i3 binding modes](https://i3wm.org/docs/userguide.html#binding_modes)).
- Lean: such a mode belongs to the desk, `[mode.desk.resize]`. That works only once the desk is a
  program, which is Tier 2 ([the tiers](../plan/tiers.md)). Until then it has no program to name it.
- **75% sure.** The doubt: whether every mode that spans tiles is the desk's, or a window needs a
  home of its own. Building resize in Tier 2 settles it.

## What is lost if not recorded now

Two facts, and both are small.

- **How a command was reached:** `via` on each `did`, key, palette, word or click, and which keys.
  Nothing else knows it later, and it is the only way to learn which keys people use and which
  commands nobody finds. It is the client's claim, so no deciding code reads it.
- **Who changed a binding, when and how:** each change to a person's keys is written with `by`,
  the referee's `at`, the writer's own `said`, the window it came from, and `how` (`"pressed"` or
  `"file"`). The file alone keeps only the result.

The table itself loses nothing: it rebuilds from the file or the person's object.

## A browser tab has no files

`~/.fabrika/keybindings.toml` is on the Mac. A tab cannot read it. Proposed, the same path as
themes in experiment 177 (on its own branch):

```text
the hands      read the file, decode it, post the value to the person's object on the ledger
a window       hears the value by a Sub, and swaps its table at the next key
a tab          the same; and the keys program in a tab writes the value, and the hands write the file
first paint    a local copy, for paint only
```

- **Lean: 70%.** The doubt: two writers, the file and the program, can race. The last write wins
  with both shown in the keys program; a test with both at once would settle it.

## Keys that cannot be taken away

Each limit is a platform's or a law's. The keys program shows them in a "not ours" group.

| Key | Why | What happens |
|---|---|---|
| Cmd-Q on a Mac | Apple: Cmd-Q quits. [PR 278](https://github.com/usirin/tea-fabrika/pull/278): a terminal that canceled it typed `q` | Always quits, with any focus, an armed prefix or a popover open. In `next/`, quitting stops the brain |
| Cmd-H, Cmd-Tab, Cmd-Space, Option-Cmd-Esc, Mission Control | the system's; some never reach the app | Never touched |
| Ctrl-C in a tile, everywhere | the program in the tile owns it | Goes to the program. On Windows and Linux, Ctrl is not the app's modifier inside a tile |
| Cmd-W, Cmd-T, Cmd-N in a Chrome tab | Chromium keeps them in a normal tab | A binding on one stays in the file and is off in a normal tab, said in the keys program; an installed app window gets it |
| The last way out of a tile | WCAG 2.1.2, no keyboard trap | The load refuses a file that leaves neither `<prefix>` nor F6 |

- **To change Quit's key,** a person uses System Settings, Keyboard, App Shortcuts, which can
  give any menu item of any app a new key. fabrika never has to own it.
- **Cmd-W is a binding,** `ignore = ["mod+w"]` by default (today's "nobody"). A
  person can bind it in the app. Cmd-K is a binding too.
- **Screen reader keys** (Control-Option for VoiceOver, Insert or Caps Lock for NVDA) get a
  warning, not a refusal: a person without a screen reader may want them.

## What is proposed

| Question | Lean | How sure |
|---|---|---|
| What else a mode section holds | only `enter` and `keys` for now; later, what the bottom line shows while you are in it | 60% |
| Key spelling | `ctrl+a`, `mod+k`, `shift+f6`, as VS Code, Zed, Ghostty, kitty and Windows Terminal write it, not Vim's `<C-a>` | 70% |
| A command's word | after the program's name (K9), the tsh word, `desk.split`, or quoted after the dot when it has spaces, `desk."split --to down"`, decoded by a schema; an unknown word fails with its line | 75% |
| Swallowing a key | `ignore` is a command, as Ghostty's: `ignore = ["mod+w"]` eats the key; `[]` lets it go on | 75% |
| A clash | your key beats a default on the same key. From the keys program, the new binding wins, said in words with the command that lost its key, and undo | 70% |
| A bad file | keep the last good table and name the line; with none yet, the defaults load and the line shows | 70% |
| Live reload | on save, at the next key, no restart, as VS Code and Ghostty | 80% |
| Matching | the character a press types first, Option folded in; the key's place for Ctrl and Cmd on a non-Latin layout | 60% |
| Where keys come from | the program, not the pack: tile keys while its tile has focus, rare global keys loaded app, then packs, then you ([above](#keys-and-modes-come-from-programs-not-packs)) | 80% |
| Two packs on one global key | both lose it, and the keys program names both; a pack never takes an app key, the prefix or F6 | 70% |
| A mode no tile owns, such as resize | the desk's, `[mode.desk.resize]`, once the desk is a program in Tier 2 | 75% |

- **A mode section, why and cost.** `enter` and `keys` are all a person needs to set today. The
  bottom line while in a mode is the next thing a person may want to change, since today's
  bottom line after `C-b` already lists keys. The doubt: whether that text belongs to the
  person's file or to the program that owns the mode. Whether popovers (arrows, `J`, `K`, Esc)
  are modes too is open; building the asks popover settles it.
- **Spelling, why and cost.** Most tools write `ctrl+a`, and a person who does not use Vim reads
  it. Vim writes `<C-a>`, and our prose and tmux say `C-a`, so there are two spellings for one
  key. The doubt: `<prefix>` is already Vim's angle-bracket style, so `"<prefix>ctrl+x"` mixes
  two styles in one string. The keys program shows each platform's own (⌃A on a Mac, Ctrl+A on
  Windows), so a person rarely types either.
- **A command's word, why and cost.** One name to learn: the tsh word is the palette entry and
  the binding, with its program's name in front in the file. It costs a schema for every word.
  W5's `split_right` was a sketch; this replaces it. The doubt: how the program's name shows in
  tsh and in the palette. Building the palette in Tier 2 settles it.
- **No `when` clauses.** VS Code's are powerful, but [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)
  already refuses a config that decides what happens next. A section per mode (K7) and tile keys
  scoped by focus do the same job, with no clause a person writes.
- **A clash, why and cost.** In the person's own file, two commands on one key are refused at
  load (K6). Against a default, the person's key wins, as VS Code's rows over its
  defaults. From the keys program, VS Code and Ghostty let the later binding win. A silent win is
  a key that stops working with no reason, so we say it. The doubt: whether undo is enough, or a
  clash should ask first. A week of use would tell.
- **Live reload, why and cost.** A swap is a value change. Experiment 177 swapped a theme in 11 to
  19 ms. An armed prefix is disarmed by a swap. Cheap, and how sure: 80%.
- **Matching, why and the doubt.** On German, French and Turkish-F Macs, `|` needs Option, so
  today's `keyName` names it `<a-|>` and split cannot be pressed (experiment 182's probe). The
  doubt: what Chromium puts in `event.key` for Ctrl on a Russian layout. A run on a real layout
  settles it.
- **No timers.** The prefix waits for the next key as long as it takes (WCAG 2.1.1). Today's
  prefix already does.

## Where this differs from settled notes

- **W5 says a binding on a key the backend cannot have fails at load.** With one file for the app
  and a tab, a whole-file failure would be wrong in one of them. Proposed: that binding is off in
  that window only, and said. The owner to pick, 80% (was 65%): no app read refuses a file, and
  VS Code's source turns such keys off per window
  ([experiment 182](../../experiments/182-keybindings.md#apps-with-a-desktop-and-a-web-version)).
- **[The GUI is an Electron app first](./the-gui-is-electron-first.md) lists "keys a project
  cannot rebind" as later.** Keys are the person's now, not a project's, so that item becomes
  "keys a person cannot rebind", which is the table above.
- **[Tile guidelines](./tile-guidelines.md) notes that `keyName` drops Shift,** so Shift-F6 reads
  as F6 and Cmd-Shift-W as Cmd-W. The table needs Shift kept.
- **Linear lets nobody rebind,** and opens its keys list on a bare `?`. Ours is `C-b ?`, since a
  tile eats `?`. W5 already lets the prefix win where Linear's keys clash with ours.

## A tryout in today's version

Not filed. A tryout the owner may pick: today's `apps/fabrika` reads `~/.fabrika/keybindings.toml`
at start.

- What it touches: `desk/keys.ts` takes the table as a value instead of a constant;
  `window/desk.tsx`, `window/pop.ts` and `window/frame.ts` stop hardcoding Cmd-K, the popover keys
  and the six keys shown after the prefix; a decoder for the file; tests.
- **Size:** about 300 to 400 lines with tests, about 2 to 3 agent hours. An estimate from reading
  the code, not a build.
- What it would teach `next/`: whether people rebind at all, and which keys.

## What it costs

- A schema for every command word, and a decoder for the file.
- A keys program in Tier 2, with search, capture and a clash view.
- Every place that shows a key reads the live table, so none can hardcode one.

## What it cannot tell us

- No keyboard was switched and no screen reader was run. The layout claims come from CLDR's
  files and a probe of today's code; the screen reader clashes come from their docs.
- Whether people rebind at all. Linear and Figma ship without it. The owner's decision settles
  that we offer it, not that it gets used.
- How the file and the keys program behave when both write at once.
- Whether two packs ever want one global key. Nothing loads a pack in `next/` yet, so the clash
  rule is a guess from how the editors read do it.
- Whether F6 and the prefix are heard as the way out of a tsh tile with NVDA in browse mode.
