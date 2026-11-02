# Modes

**Decided 2026-11-01.** The owner approved the six principles, the shape and the smaller
calls below with their leans, after a walk of each part. The leans' confidence numbers stay as
written, so a later run can test the least sure ones. Decided before that walk: a mode's keys get their own section in
the person's key file, named by its program, `[mode.terminal.copy]`, with its keys in
`[mode.terminal.copy.keys]`; every command carries its program's name, `desk.split`; the load
refuses a mode with no way out (WCAG 2.1.2); and a command's field is called `mode`, the same word
as the program's `mode`. The shape, which the owner shaped and now approved: a program gets one
new field, `commands`, and one `mode` read from state, and no mode is `null`.

Built from [experiment 184](../../experiments/184-modes.md), which read how about fifteen makers
and tools do modes and checked today's info mode against them, and a private page, "Mode
guidelines", with a mode you can enter and leave. Neither is a measurement. It builds on the
note "Keybindings are configurable", on its own branch in
[PR 282](https://github.com/usirin/tea-fabrika/pull/282).

```ts
// A sketch, next/, Tier 2. Today's info mode (C-b i), written with the two new fields.
type Desk = {focus: TileId; info: {_tag: "off"} | {_tag: "on"; explained: string | null}};
type DeskMsg = {type: "info"; on?: boolean} | {type: "split"}; // and the rest

const desk = defineProgram({
	name: "desk",
	// machine, msg, view, refuse: as today
	mode: (d: Desk) => (d.info._tag === "on" ? "info" : null), // read from state, never a flag
	commands: {
		info: {send: {type: "info"}, keys: "<prefix>i", global: true}, // toggles; works in any mode
		exit: {send: {type: "info", on: false}, keys: "escape", global: true, mode: "info"},
		split: {send: {type: "split"}, keys: "<prefix>|", global: true},
	},
});
```

```text
one press traced: C-b i, then Escape
C-b i    the prefix, then i         did {does: "desk.info", via: {_tag: "key", keys: "ctrl+b i"}}
         desk's update              info = {_tag: "on", explained: null}, so mode(d) is "info"
         the bottom line            INFO · point at anything, or tab to it         esc leaves
         the status region says     "Info mode on. Escape leaves."
escape   global, mode "info"        did {does: "desk.exit", ...}; info off; mode(d) is null
```

## Which version

- **`next/`:** all of it. Tier 1 has one real mode, the notes tile's reading and editing
  ([Tier 1's detail](../plan/tier-1-detail.md)), and it is the first test. The desk, its info mode
  and a resize mode arrive with the desk in Tier 2.
- **Today's version (`apps/fabrika`):** not changed by this note. Its info mode is the running
  example, read on main. Four small fixes are offered at
  [a tryout in today's version](#a-tryout-in-todays-version), none filed.

## The shape

### One field, `commands`, and one `mode`

```ts
// A sketch, next/. Types checked by a probe in experiment 184.
type Key = string; // "escape", "<prefix>i", spelled as the keybindings note spells keys

type Command<TileMsg, Mode extends string> = {
	readonly send: TileMsg; // the Msg this command is; an argument is a value in it
	readonly keys: Key | ReadonlyArray<Key>; // the default; the person's file lays over it
	readonly global?: true; // works with any tile focused
	readonly mode?: Mode | ReadonlyArray<Mode | null>; // where it works; absent: see M2
};

type Program<S, M, V, T, TileMsg, Mode extends string = never> = {
	// name, machine, msg, view, refuse: as today, and the tile's own machine from Tier 1
	readonly mode?: (tile: T) => Mode | null; // null: no mode
	readonly commands?: Readonly<Record<string, Command<NoInfer<TileMsg>, NoInfer<Mode>>>>;
};
```

- **One new field.** No separate keys, global, modes or actions fields. A command is its Msg, its
  keys and where it works. A command with an argument is a Msg with a value:
  `"focus-left": {send: {type: "focus", to: "left"}, keys: "<prefix>h", global: true}`.
- **Typed.** The probe in experiment 184 ran it under `--strict`: a `send` that is not a Msg the
  program takes fails to compile, a `mode` that `mode()` cannot return fails, and a program with no
  `mode` cannot name one.
- **The name of the field on a command is `mode`.** Decided by the owner, for symmetry with the
  program's `mode`.
- **Today's `defineProgram`** on [PR 223](https://github.com/usirin/tea-fabrika/pull/223) has
  `name`, `machine`, `msg` and `view`. Tier 1 adds `refuse` and a tile machine. `commands` and
  `mode` come after, with the desk in Tier 2; Tier 1's notes tile can use them first if it is
  ready.

## The six principles

### M1: no mode first

**Lean, 75%.** A mode is the last tool, not the first.

```text
the job                                   the tool
one command                               a command: a key, the palette, a tsh word
one choice, then back                     the prefix, or a popover: one key and done
a peek while you hold a key               a held modifier, as Shift
several commands in a row on one thing    a mode: copy, select, resize, editing, info
```

- **Why.** Tesler: a mode has "no role other than to place an interpretation on operator input",
  and people get "stuck" in it. Apple: "Present content modally only when there's a clear
  benefit." NN/g: "Same input, different results."
- **The test** is the last row: will a person press several commands in a row in it, on one thing,
  where the same keys would otherwise mean something else? Copy mode, a resize, Tier 1's editing
  and info mode pass. A single confirm does not.
- **The prefix is already a one-key mode,** as tmux's `switch-client -T`: "After that key, the client
  is returned to its default key table". So are Helix's minor modes and Figma's tool keys.
- **No held letter.** Raskin's quasimode "cannot be forgotten", but a held letter repeats into a
  terminal, a window that loses focus never hears the key come up, and Sticky Keys turns a hold
  into a toggle, which is a mode again. Only modifiers. 60% on this part.
- **Today's info mode passes,** for a pointer: you point at many parts in a row.

### M2: a mode is state, in the tile's own machine

**Lean, 75%.**

- **The Elm answer:** a mode is model state, and `mode(state)` reads it. The window keeps no mode
  flag of its own, and nothing sets "the mode" from outside.
- **Whose model:** the tile's own machine, on the window side, never the shared program. Tier 1
  already decided this for which note is open: "A process is shared by every window, so with one
  open note there, a phone opening a note would move the laptop's too." A mode is the same kind of
  fact. With two people in Tier 3, one person's copy mode must not move the other's view.
  tmux differs: copy mode is the pane's, so two clients on one pane share it.
- **So `send` is a Msg for the tile's machine.** The tile's update sends on to the program what is
  shared, as Tier 1's notes tile sends a save. A program with no tile machine takes its program
  Msg directly. **This refines the shape the owner saw,** where `send` was a Msg the program's
  `msg` schema accepts.
- **No mode is `null`.** Fabrika never names a base mode. tmux calls it `root`, i3 `default`, Vim
  and Helix `normal`; with `null`, nobody has to agree, and most programs have no `mode` at all.
- **Where a command works:**

```text
a command with                   works when
no mode, not global              its program's mode is null
no mode, global                  in every mode: the prefix keys and the palette always work
mode: "info"                     its program is in info mode
mode: [null, "select"]           with no mode, and in select mode
```

- **Why the global row.** The no-trap rule already keeps the prefix and F6 in every mode, so the
  desk's prefix keys keep working in info mode with nothing written. Without that row, every desk
  command would need `mode: [null, "info"]`.
- **The doubt.** A mode that only adds a few keys to a list, as Linear's select does, needs
  `mode: [null, "select"]` on each tile command that should keep working. If a real program needs
  more than a handful, the other branch wins: a command with no mode works in every mode unless the
  mode's own command takes the key, as Hydra's pink. Its cost: the safe default flips, so `e` could
  fire while editing. Writing notes' editing and a list's select in Tier 2 settles it.
- **Today's info mode passes,** with one gap: `explained` can hold text while `info` is false. The
  union above makes that state unsayable.

### M3: you always see it, in words

**Lean, 85%.**

```text
no mode     t3 notes · reading                                      C-b ? keys
info        INFO · a workspace, named by what it holds               esc leaves
copy        COPY · v select · y yank · / search                      q or esc leaves
editing     EDITING · t3 notes                                       mod+enter saves · esc saves
```

- **The bottom line leads with the mode's name, as a word,** then its keys, then the way out at the
  right. Today's prefix line already does it: `PREFIX`, its keys, `esc cancels`. Helix shows `NOR`,
  `INS`, `SEL`; Vim's `'showmode'` puts it "on the last line"; i3's bar has a binding mode
  indicator.
- **A second cue where the eye is.** Tesler: feedback "displayed where the user is almost certain
  to be looking". NN/g: "Redundancy in indicators is a wise idea." A tile's mode also shows in its
  title bar, `t2 terminal · copy`, and its name for a screen reader gets `, copy mode`, beside the
  tile guidelines' `, zoomed`.
- **Never color alone.** WCAG 1.4.1. Helix's `color-modes` is off by default. Under forced colors a
  wash and a shadow vanish and a word stays (the tile guidelines found this).
- **Shown with the bars hidden,** as the armed prefix already is.
- **A screen reader is told.** One small `role="status"` region says "Info mode on. Escape leaves."
  on entering and "Info mode off." on leaving, and nothing on each hover. WCAG 4.1.3 wants it read
  "without receiving focus". `status` is polite by default. **Needs a real run:** VoiceOver and NVDA
  with focus in a terminal's text box, and NVDA in browse mode.
- **The palette and tsh show the same rows.** In a mode, the palette lists that mode's commands
  first, in a group named for it, with its way out on top. A command that cannot run now is left
  out, never shown dead. A tsh word for a mode's command, typed when its tile is not in that mode,
  is refused in words: "notes.done works while editing; t3 is reading." 70% on both.
- **Today's info mode** shows the word `INFO` first, which is right. It breaks the rest: hidden with
  the bars (`desk.tsx:815`), never told to a screen reader (`frame.tsx:869`), and blind to keyboard
  focus (`desk.tsx:437`).

### M4: you always get out

**Escape leaves every mode, lean 85%. The no-trap refusal is decided.**

- **Escape leaves,** in every mode a program defines, beside any other key it picks. Helix,
  tmux's emacs table, i3's example, Linear's selection and Transient's `C-g` all do. Tesler's "How
  do I get out of this mode?" is the question this answers.
- **The prefix and F6 work in every mode,** so a mode can never keep the keys (2.1.2).
- **The load refuses a mode with no way out.** Decided in PR 282: "copy mode would have no way out;
  keep at least one key on exit."
- **Leaving keeps your work.** Apple: "if closing the view could result in the loss of
  user-generated content, be sure to explain the situation". In Tier 1's editing, Escape does what
  Done does: it saves, then reads. Linear saves as you type, so Escape loses nothing there either.
  65%: a person who pressed Escape to cancel expects no save. The draft is never lost either way.
- **No timer.** A mode waits as long as it takes (WCAG 2.2.1).
- **Today's info mode** never traps, since it takes no keys. But Escape does nothing
  (`desk.tsx:415` closes only what lies over the desk).

### M5: one mode per program, never a stack

**Lean, 70%.**

- **One per program.** `mode()` returns one value, so a program cannot be in two at once. A step
  inside a mode is state inside it: copy mode with a selection running is still copy mode.
- **Two programs, two modes, at most.** The desk can be in info mode while a tile is in copy mode.
  One Escape leaves one: the desk's first, since it covers the window, then the tile's. The bottom
  line names the next one.
- **Why.** Apple: "Let people dismiss a modal view before presenting another one." Transient lets
  menus stack and needs `C-q` to leave them all; we do not want a second key for that.
- **A popover is not a mode.** It has its own edge, focus moves into it, and Escape and a click
  outside close it, one at a time ([popovers](./popovers.md)). Keys go where focus is. This answers
  the question PR 282 left open, as a lean.

### M6: a mode stays where it lives

**Lean, 70%.**

```text
the event          a tile's mode (copy, editing)          the desk's mode (info, resize)
focus moves        stays with its tile; its title says so  stays on
another window     not there: each window its own          not there
hot reload         stays if the model still reads; else null, and the bottom line says so
app restart        gone: window state is not kept           gone
```

- **Focus.** tmux keeps copy mode per pane. Leaving a mode because focus moved would be a change
  nobody asked for (WCAG 3.2.1 is about focus starting changes). The title bar word keeps it seen.
  PR 282's page leaves copy mode on a tile move; this differs.
- **Hot reload.** The window's machine keeps its model, and `mode()` reads it again. If the new
  code cannot read the old model, the tile starts fresh, its mode is null, and the status region
  says "Left copy mode: the program changed." 65%. The hot reload guidelines, being written now,
  may settle it.
- **Today's info mode passes all of this:** per window, kept across focus, gone on reload.

## How a press finds its command

**Lean, 70%.**

```text
1  the platform's keys, such as Cmd-Q           never ours
2  the prefix and F6                            every mode; the next key looks up the prefix rows
3  global commands for a mode that is on        the desk's resize or info mode wins over a tile
4  the focused tile's commands, for its mode     with no mode: its rows with no mode
5  global commands with no mode                 palette.open
6  the focused tile's own content               the terminal, the text box
```

- Each command is checked against **its own program's** mode, so `palette.open` works while notes
  is editing, and `e` does not fire in the text box.
- A key no command takes goes to the tile's content, as today. In copy mode the terminal's own view
  ignores typed keys; that is the program's choice, not the router's.
- Step 4 before 5 is PR 282's rule: a tile key beats a pack's global key while its tile has focus.

## The person's file

The section is decided (K7, K8 in PR 282). Open: with command names unique per program, should a
mode's command also be writable as a flat row?

```toml
# A: a mode's command is written only in its section. Lean, 70%.
desk.info = "<prefix>i"

[mode.desk.info.keys]
exit = ["escape", "q"]
```

```toml
# B: a flat row sets the command wherever it works; a section narrows it to one mode.
desk.info = "<prefix>i"
desk.exit = ["escape", "q"]      # in every mode exit works in
```

- **A, why.** It is what the owner picked K8 for: the file says where a key works, so nobody guesses.
  A flat `desk.exit` would not say which mode. The load refuses one and points at the section:
  "desk.exit works only in a mode; write it under [mode.desk.info.keys]."
- **A, cost.** A command for several modes, such as one `exit` for info and resize, gets one row
  per section. A command for `[null, "select"]` gets a flat row and a section row; the keys program
  shows both and offers to move both.
- **B, why.** Shorter, and one row moves a command everywhere. **B, cost:** it gives up K8's reason,
  and a reader cannot see a mode's keys in one place.
- **`enter` goes away.** With `commands`, entering is a command like any other, so it is a flat row,
  `terminal.copy = "<prefix>["`, not `enter` in the section. A mode can then have several ways in,
  as tmux's copy mode does. 70%.

## Can the desk have a mode of its own?

**Yes, lean 75%, and info mode is the test.**

- **What it needs:** the desk as a program (Tier 2), a window-side machine that holds its mode
  (Tier 1 already keeps focus in the window's machine), and step 3 above, so a window-wide mode
  wins over the focused tile.
- **Resize** fits i3's binding mode: `h j k l` and arrows move an edge, Escape and Enter leave. In
  the file it is `[mode.desk.resize.keys]`. While it is on, the prefix still works.
- **Info** takes no keys but Escape, so the desk's prefix keys keep working through the global row
  in M2.
- **The doubt.** Escape in info mode no longer reaches a tile: a tsh user with vi keys in their
  shell loses it while info mode is on. Use will tell.

## What the ledger records

**Nothing new.** Data shape first: what fact is lost if not recorded now?

- **The mode itself is window state.** Like which note is open, it is not on the ledger and not in
  program storage. A reload starts with no mode.
- **Entering and leaving are commands,** so PR 282's `did` rows, with `via` and the referee's `at`,
  already record them. How long a mode lasted, and an enter followed at once by an exit (a likely
  slip), rebuild from those rows.
- **Lost, and fine to lose:** a mode left by a reload or a hot swap, which is not a `did`. Nothing
  decides on it.

## A tryout in today's version

Not filed. Four fixes the owner may pick, each small, from experiment 184:

- Show the bottom line in info mode even with the bars hidden, as the armed prefix already is
  (`window/desk.tsx:815`).
- Put the mode's words in a `role="status"` region (`window/frame.tsx:869`).
- Explain on `focusin` too, not only `pointerover` (`window/desk.tsx:437`).
- Let Escape leave info mode (`window/desk.tsx:415`).

**Size:** about 60 to 100 lines with tests, about 1 agent hour. An estimate from reading the code.

## Where this differs from settled notes

- **PR 282, K7:** `enter` in a mode's section becomes a flat row for the entering command.
- **PR 282, the notes sketch:** its separate `keys`, `global` and `modes` fields become one
  `commands` field, and its `{_tag: "normal"}` becomes `null`. Its `tableFor` reads the tile's
  `mode()`.
- **PR 282's page:** moving to another tile leaves copy mode there; M6 keeps it.
- **PR 282's open question,** whether popovers are modes: M5 says no, as a lean.
- **The shape the owner saw:** `send` is a Msg for the tile's machine, not the program's, so a
  mode stays per window (M2).

## What it costs

- A tile machine for any program with a mode. Tier 1's notes tile has one already.
- One status region in the window, and a mode word in the bottom line, the title bar and the
  tile's name.
- The router's six steps, with tests for each.

## What it cannot tell us

- No screen reader was run. Whether a polite status is heard with focus in a terminal is open.
- No mode was built. The `[null, "select"]` cost is a guess until a real list program has select.
- Whether people forget a tile is in a mode once they move away.
- Whether Escape-saves in editing surprises people who meant cancel.
