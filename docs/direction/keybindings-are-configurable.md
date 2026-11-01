# Keybindings are configurable

**Decided 2026-11-01 by the owner:** every keybinding is configurable from day one, the prefix
included; the prefix is a setting of its own; the bindings live in the person's own TOML file,
written command to key inside tables (a tryout); fabrika ships a program to change them; and
Tier 1 reads the file while that program arrives in Tier 2. **The table names, the key spelling,
the command names, what a clash from the program does and live reload are proposed,** each with a
lean below.

Built from [experiment 182](../../experiments/182-keybindings.md), which read how about twenty
tools do it, and a clickable page, "Keybinding guidelines", a private page with twelve rules
you can press. Neither is a measurement.

```toml
# ~/.fabrika/keybindings.toml: only what you changed. The defaults ship with the app.
prefix = "ctrl+a"          # a setting, as tmux's `set -g prefix C-a`

[keys.prefix]              # the table names are a lean: see "Tables" below
fold  = "g"                # command = key; the left side is a tsh word
zoom  = ["z", "enter"]     # several keys
close = []                 # unbound: the key goes on to the program
```

```ts
// next/: a press is turned into a command in the window. Only the finished command travels.
// C-a then g, in a window on a Mac:
{type: "did", does: "fold", via: {_tag: "key", keys: "ctrl+a g"}}
```

## Which version

- **`next/`:** true from the first window in Tier 1. Tier 1 has no desk and few keys (`e` on a
  note is one), and it reads every key it has from the file. The desk, its prefix keys and the
  keybindings program arrive in Tier 2.
- **Today's version (`apps/fabrika`):** not changed by this note. Its rule adds only fixes, the
  UX the owner picks, and tryouts. See [a tryout in today's version](#a-tryout-in-todays-version).

## What was decided

### K1: every binding is data

- A binding is a row: a command word, a table, and its keys. No key is wired into a handler.
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
- TOML refuses the same key twice in one table. With command to key (K6), that means one
  command cannot be written twice in a table; two commands on one key can be, so the load
  checks for it.

### K3: a program for keys

fabrika ships a built-in program to search the bindings, press a key to rebind one, see clashes,
and write `keybindings.toml`. **Its name is proposed: `keys`.** Today's `C-b ?` already opens a
panel called keys, so the word is one people have met.

```text
keys      search "fold"
  fold        C-b f      default
  > Enter     press a key...   (g)
  fold        C-b g      yours     the file gets  fold = "g"
  needs a look:  zoom has no key (palette and tsh only)
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

### K5: the prefix is a setting

Decided by the owner today.

- The prefix is configurable, like any other key: `prefix = "ctrl+a"`, at the top of the file.
- It is a setting, not a row. tmux does the same: `prefix` is an option, "Set the key accepted as
  a prefix key", changed with `set -g prefix C-a`
  ([tmux(1)](https://man.openbsd.org/tmux.1)). A setting holds one value, so there is always
  exactly one prefix.
- The load refuses a root binding on the prefix's own key, with a plain reason: "ctrl+a is your
  prefix, so it cannot also run split."
- The no-trap rule stays: the load refuses a table with neither the prefix nor F6.

### K6: command to key, a tryout

Decided by the owner today, as a tryout.

```toml
prefix = "ctrl+a"

[keys.prefix]
split = "|"
zoom  = ["z", "enter"]   # several keys
close = []               # unbound
```

- The owner's sketch wrote the table as `[prefix]`. TOML cannot hold that next to
  `prefix = "ctrl+a"`, so the table name is still open: see "Tables" under
  [what is proposed](#what-is-proposed).
- The person's file holds only what they changed. The defaults ship with the app.
- A command takes one key or a list. An empty list unbinds, and there is no `noop` word.
- A command's description comes from the command itself, never from the file. VS Code's
  `keybindings.json` carries none either.
- **The cost, named by the owner.** Key to command (`"|" = "split"`) makes "one key does one
  thing" impossible to break, since TOML rejects a repeated key. Command to key gives that up. So
  the load refuses a key claimed by two commands in one table and names both, and the keys
  program shows the reverse view: what does this key do.
- **We differ from everyone read.** Yazi writes a list of entries, `{ on = [ "g", "d" ], run =
  "cd ~/dev" }` ([Yazi keymap](https://yazi-rs.github.io/docs/configuration/keymap/)). Alacritty
  writes `{ key = "N", mods = "Control|Shift", action = "CreateNewWindow" }` in a `bindings` list
  ([Alacritty](https://alacritty.org/config-alacritty.html)). Rio writes `[[bindings.keys]]` entries
  with `key`, `with` and `action` ([rio-bindings(5)](https://man.archlinux.org/man/rio-bindings.5.en)).
  Helix writes key to command, `C-s = ":w"` under `[keys.normal]`
  ([Helix remapping](https://docs.helix-editor.com/remapping.html)). None writes command to key.
  **Why we try it anyway:** a person edits by command ("what is zoom on?"), and the file reads the
  same way the keys program lists it, one row per command.
- **What flips it back to key to command:** two-commands-on-one-key refusals turning up often in
  real files.

## Commands are the protocol

Name the protocol first: **a key press maps to a named command, in the client.** The window holds
the table as a value, runs the prefix itself (W5 in [the desktop layer](./the-desktop-layer.md#w5-keys)),
and sends one finished command. A key never crosses the wire.

```ts
// A sketch, next/. The table is a value the window is handed; the window never reads a file.
type Binding = {does: Command | "ignore"; keys: string[]}; // keys: [] is unbound
type Keys = {
	prefix: string; // "ctrl+a": a setting, never a binding
	tables: {root: Binding[]; prefix: Binding[]};
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
| The last way out of a tile | WCAG 2.1.2, no keyboard trap | The load refuses a table with neither the prefix nor F6 |

- **To change Quit's key,** a person uses System Settings, Keyboard, App Shortcuts, which can
  give any menu item of any app a new key. fabrika never has to own it.
- **Cmd-W is a binding,** `ignore = ["mod+w"]` by default in `[keys.root]` (today's "nobody"). A
  person can bind it in the app. Cmd-K is a binding too.
- **Screen reader keys** (Control-Option for VoiceOver, Insert or Caps Lock for NVDA) get a
  warning, not a refusal: a person without a screen reader may want them.

## What is proposed

| Question | Lean | How sure |
|---|---|---|
| Tables | tmux's names, `root` and `prefix`, under one parent: `[keys.root]` and `[keys.prefix]` | 60% |
| Key spelling | `ctrl+b`, `mod+k`, `shift+f6`, as VS Code, Zed, Ghostty, kitty and Windows Terminal write it | 65% |
| Command names | the tsh word, `split`, or quoted when it has spaces, `"split --to down"`, decoded by a schema; an unknown word fails with its line | 75% |
| Swallowing a key | `ignore` is a command, as Ghostty's: `ignore = ["mod+w"]` eats the key; `[]` lets it go on | 75% |
| A clash | your key beats a default on the same key. From the keys program, the new binding wins, said in words with the command that lost its key, and undo | 70% |
| A bad file | keep the last good table and name the line; with none yet, the defaults load and the line shows | 70% |
| Live reload | on save, at the next key, no restart, as VS Code and Ghostty | 80% |
| Matching | the character a press types first, Option folded in; the key's place for Ctrl and Cmd on a non-Latin layout | 60% |

- **Tables, why and cost.** tmux's names. They cannot sit at the top as `[root]` and `[prefix]`:
  TOML refuses `prefix = "ctrl+a"` and a `[prefix]` table in one file. smol-toml 1.9.1, the
  parser in this repo's lockfile, answers "trying to redefine an already defined table or
  value". One parent fixes it, as Helix's `[keys.normal]` does. The other branch keeps
  `[root]` at the top and renames the second table, such as `[after_prefix]`, which loses tmux's
  word. The doubt is popovers: their keys (arrows, `J`, `K`, Esc) may need a third table.
  Building the asks popover on the table settles it.
- **Spelling, why and cost.** Most tools write `ctrl+b`. Our prose and tmux say `C-b`, so there
  are two spellings for one key. The keys program shows each platform's own (⌃B on a Mac, Ctrl+B
  on Windows), so a person rarely types either.
- **Command names, why and cost.** One name to learn: the tsh word is the palette entry and the
  binding. It costs a schema for every word. W5's `split_right` was a sketch; this replaces it.
- **No `when` clauses.** VS Code's are powerful, but [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)
  already refuses a config that decides what happens next. Tables by mode do the same job.
- **A clash, why and cost.** In the person's own file, two commands on one key in one table are
  refused at load (K6). Against a default, the person's key wins, as VS Code's rows over its
  defaults. From the keys program, VS Code and Ghostty let the later binding win. A silent win is
  a key that stops working with no reason, so we say it. The doubt: whether undo is enough, or a
  clash should ask first. A week of use would tell.
- **The load refuses,** each with its reason in plain words: a bare printable key in the root
  table (it would stop typing in tsh, and WCAG 2.1.4 wants a one-letter key only where focus
  is); a bare letter as the prefix; a root binding on the prefix's own key; a key claimed by two
  commands in one table, naming both; and a table with no way out of a tile.
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
- Whether F6 and the prefix are heard as the way out of a tsh tile with NVDA in browse mode.
