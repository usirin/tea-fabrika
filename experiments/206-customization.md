# What can a person change about fabrika, where does that choice live, and how does a program say what it lets a person change?

Read 2026-11-03. **This is reading, not a measurement.** Nothing ran but reads of today's code,
the notes, and public docs. It is phase 1 of a guidelines study (steps 1 to 4 of the guidelines
skill): the settled check, one running example, the known way and the three tests. It will feed a
note, "Customization", and a Design canvas, "Customization guidelines". Neither exists yet. The
designs (step 5) wait for the owner's look at this draft.

Two calls from [PR 332](https://github.com/usirin/tea-fabrika/pull/332) (program guidelines,
proposed) move into this study: call 6, a glance view in the top bar, and call 7, a look over the
desk or a tile beside. The owner asked that lualine's model be weighed first: programs offer
pieces, and the person picks what shows in each place.

**The answer.** The makers agree on one plain shape, and lualine is its clearest form.

- **Programs offer pieces; the person places them.** lualine has fixed places (sections `a` to
  `z`, a tabline, a winbar, an inactive copy of each) and pieces it calls components: `mode`,
  `branch`, `diagnostics`, or any function [n1]. i3status picks modules with `order +=` [i3],
  tmux fills `status-left` and `status-right` [t1], VS Code has two sides and lets an extension
  add an item [v2] [v3], and macOS keeps menu bar extras on the trailing side [a1].
- **A piece is data; the bar draws it.** A lualine component returns a string [n1]. An i3bar block
  is `full_text` plus a `short_text` "used in case the status line needs to be shortened" [i2]. The
  bar owns the look, the order and the squeeze. A piece never draws its own corner of the frame.
- **The person decides, and nothing relies on a piece being there.** Apple says to let people, not
  the app, "decide whether to put your menu bar extra in the menu bar", and "Avoid relying on the
  presence of menu bar extras" [a1]. Linear lets a person "reorder items, hide items you don't use
  often" and pick "a count or dot" [l1].
- **A program declares what can be set, with types and defaults.** VS Code's
  `contributes.configuration` [v1], Raycast's `preferences` [r1], Obsidian's settings tab [o2] and
  Stream Deck's manifest [f1] all do it. lualine is the exception: it declares nothing, since its
  config is code.
- **The person's own choices live in the person's file; a project's live in the project's.** Zed
  keeps `theme` and `vim_mode` out of project settings [z1]. VS Code keeps some settings "only in
  user settings" [v4]. Linear keeps a person's display options personal until someone presses "Set
  as default" [l3].
- **A look can float, in the tiling tools too.** PR 332's call 7 said tmux and i3 answer "a split,
  or nothing". That was wrong. tmux has floating panes since 3.7 and modal panes since 3.8
  [t2], and i3 has floating windows and a scratchpad that shows "as a floating window" [i1]. Neovim opens a split or
  a float with the same call, and an `enter` flag says whether focus moves [n3].

Today's running example (the asks in the top bar while two `tsh` tiles run) follows the shape in
one way and breaks it in three. It follows it: the asks item is data the frame draws, and hides at
zero. It breaks it: every top bar item is wired by hand in one component; a person can only hide
both bars at once; and today's app reads no settings file of the person's at all, so ticket 191's
`[desk]` settings have no reader yet.

```text
how each tool lets a person choose what shows, one line each
lualine     fixed places a..z, tabline, winbar, inactive copies; components are names or functions
Neovim      'statusline', 'winbar', 'tabline' are options; a float and a split are one call
tmux        status-left, status-right, status-format[]; #() runs a command; floating panes since 3.7
i3 / sway   bar { status_command }; blocks with full_text and short_text; clicks go back on stdin
VS Code     settings.json; contributes.configuration; status bar items with id, side and priority
Zed         settings.json, user and .zed/; status_bar and title_bar show_* switches
Raycast     manifest preferences, typed, required ones asked first; menu-bar commands
Linear      personal sidebar: reorder, hide, count or dot; display options personal until shared
macOS       menu bar extras: people choose; the system hides some when space is short
Obsidian    .obsidian per vault; addStatusBarItem; a settings tab per plugin
Stream Deck a plugin's manifest lists actions; a person puts them on keys
G1000       four data fields on the map bar, picked from a list; one key restores the defaults
```

## Which version

- **Today's version:** the running example is the frame in `apps/fabrika` and today's keys in
  `apps/fabrika/src/desk/keys.ts`, read on main at `d60a005e`. Every `file:line` is there.
  Tracker ticket 191 (the `[desk]` settings) is today's version too.
- **`next/`:** the program shape (`glance`, `location`, `reuse`) is PR 332's, proposed, on its
  own branch. The person's file and how a tab reads it are the keybindings and themes notes',
  decided. `next/` has no frame yet; it is not on main.
- **The scope, in one line:** what a person can change in the frame (the top bar, the bottom line,
  glances), where a look opens on the desk, where each choice is kept, and how a program says what
  it lets a person set. The look (colors, type) is settled and stays. Each tile's title bar is
  settled by the tile guidelines; a change there is a question for the owner, not part of this.

## Step 1: what is settled

### Decided

| Point | Source |
|---|---|
| A person's home is `~/.fabrika/`: `fabrika.toml` (their own settings), `keybindings.toml`, `themes/`. A repo's is `.fabrika/fabrika.toml`. One spelling. | [one fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md):13-35 |
| State is not settings. The desk and the asks live on the ledger, not in either folder. | same note, :57 |
| Three load rules: an empty file changes nothing, an unknown key is an error, a value out of range fails and names the key. | same note, :174-177 |
| A knob is a number, a name, or a pick between paths the code already has and tests. No `when`, no steps in config. | same note, :170-173; [keybindings](../docs/direction/keybindings-are-configurable.md):507 |
| A pack only one person wants goes in `~/.fabrika/fabrika.toml`. | one fabrika.toml per repo, :152 |
| A theme is the person's own config; a repo that set colors "would choose for someone else's eyes". `theme = "<name>"`; a `themes` program with live preview writes the pick. | [themes](../docs/direction/themes.md):22-42 |
| Every binding is data; keys live in their own file because the app writes it; a `keys` program; keys come from programs; live reload; a bad file keeps the last good table. | keybindings K1 to K3, :316-357, :475-490 |
| What else a mode section holds: later, "what the bottom line shows while you are in it" (60%). | keybindings, :481 |
| A tab has no files: the hands read the person's file and post it to the person's object on the ledger; a window hears it by a Sub (70%). | keybindings, :441-454 |
| Tier 1 reads the config files; the `keys` and `themes` programs are Tier 2. | [tiers](../docs/plan/tiers.md):38, themes :55 |
| The bars stay mono and tmux-like. One thing over the desk at a time. Escape closes and puts focus back. | [popovers](../docs/direction/popovers.md):10, :164-195 |
| The top bar's icon and name take no room and give way first. | [top bar's name](../docs/direction/top-bar-name.md):23-33 |
| A tile's title bar holds slot, name, state word and id, in that order. | [tile guidelines](../docs/direction/tile-guidelines.md):349-357 |
| The bottom line adds to the title and never holds the only copy of a fact. | same note, :469-476 |
| One asks program, two views: a glance in the top bar and a list and detail in a tile. The top bar keeps the count. | [ask desk](../docs/direction/ask-desk.md):127-149 |
| Every size of a program is a `select` on one model, so a glance keeps no state of its own (G1, decided 2026-11-03). | PR 332, program guidelines G1 |
| A process never knows where its tile is. Every command also has a tsh word and a palette row, so losing a key never loses a command. | [the desktop layer](../docs/direction/the-desktop-layer.md) W3, W4, W5 |
| The box decides what crosses; a program can only ask for Cmds. | [programs run in a box](../docs/direction/programs-run-in-a-box.md):27-60 |
| Saved views go on the person's desk first; sharing one is a later fact. | [tracker views are programs](../docs/direction/tracker-views-are-programs.md):239 |
| Try both ways of PR 332's calls 2 and 3 behind `[desk] reuse` and `place` in `~/.fabrika/fabrika.toml`; defaults `program` and `beside`; live reload; each open records which it used. Owner, 2026-11-03. | tracker ticket 191 |
| Record wide: every measure we can, if it does not slow the work and holds no secret. | AGENTS.md, 2026-11-01 |

### Leaned (proposed, not settled)

| Point | Source |
|---|---|
| Any program may have a glance; the person picks which show, 65%. Doubt: four glances are noise. | PR 332, call 6 |
| A look over the desk or a tile beside: no lean, a clash with Linear. | PR 332, call 7 |
| What every program gets for free (palette rows, keys, the action bar). | PR 332, G7 |
| "Glance" keeps the ask desk's meaning, 60%. "Bottom line" becomes "status bar", 65%. A top bar "item" is VS Code's status bar item. | [PR 353](https://github.com/usirin/tea-fabrika/pull/353), the frame |
| A program's settings' font size scales all six text styles (a Linear row, not a rule). | [typography](../docs/direction/typography.md):133-135 |

### Measured before

- [Experiment 177](./177-themes.md): a shared theme swapped live in 11 to 19 ms, terminals
  included, with no restart. A settings swap is a value change, and that is cheap.
- [Experiment 182](./182-keybindings.md): the known way for keys is defaults first and the
  person's rows over them. The same rows-over-defaults shape fits every setting.

### Untouched

- Which top bar and bottom line items a person may show, hide or move. No note says.
- How a program says what a person may set, beyond keys and modes. `listing` names a program's
  flags, inputs and outputs, "and which have a status line" ([tea-program](../docs/direction/tea-program.md):50),
  but nothing says flags have person defaults.
- A settings program for anything but keys and themes.
- Text size as a setting. Typography leaves a 200% zoom test open (typography.md:355).
- A floating tile. No note has one; a popover is the only thing over the desk.
- Who may not hide what: whether a lost link or a question asked can ever be hidden.

### Open pull requests on the area

- [PR 332](https://github.com/usirin/tea-fabrika/pull/332), program guidelines: calls 2, 3, 6 and 7.
  Calls 6 and 7 move here. Calls 2 and 3 are already a setting (ticket 191).
- [PR 353](https://github.com/usirin/tea-fabrika/pull/353), the frame: names all 49 parts. Its
  names decide this study's config keys (`bottom line` or `status bar`, `item`, `glance`).

## What was read

Tags are in [links](#links). Quotes were checked against the page as fetched on 2026-11-03.

### The model to weigh first: lualine and Neovim

- **Places are fixed; their contents are the person's.** "Lualine has sections as shown below",
  `A | B | C` on the left and `X | Y | Z` on the right, and "Each sections holds its components
  e.g. Vim's current mode" [n1]. The defaults are `mode`; `branch`, `diff`, `diagnostics`;
  `filename`; then `encoding`, `fileformat`, `filetype`; `progress`; `location`.
- **The same pieces go in every place.** The tabline config "is exactly the same as that of the
  statusline", and "Any lualine component can be placed in winbar" [n1]. Each place has an
  inactive copy: `inactive_sections` and `inactive_winbar`, drawn for windows without focus.
- **A piece is a name, a function or a variable.** A Lua function that returns a string is a
  component: `sections = { lualine_a = { hello } }` [n1]. A plugin offers a piece by offering a
  function; the person's config pulls it in. Nothing is declared.
- **Per kind of window.** "lualine extensions change statusline appearance for a window/buffer with
  specified filetypes", and "By default no extensions are loaded to improve performance" [n1]. An
  extension is just another `sections` table plus `filetypes`.
- **When a piece shows.** `cond` is a "Condition function, the component is loaded when the
  function returns `true`" [n1]. `disabled_filetypes` turns lualine off per kind of window.
  `globalstatus` gives one bar "at bottom of neovim instead of one for every window".
- **How often it draws.** It "refreshes itself based on timer and some events"; the minimum gap
  is 16 ms, "~60fps" [n1].
- **Neovim under it.** `'statusline'`, `'winbar'` and `'tabline'` are plain options;
  `'laststatus'` says when a status line shows: `0` never, `1` with two windows, `2` always, `3`
  one for all [n2]. `nvim_open_win` "Opens a new split window, floating window, or external
  window"; "Floats are drawn over the split layout", and `enter` says whether focus moves [n3].
- **What carries over.** Places are the frame's; pieces are the programs'; the person's file says
  which piece goes where, for focused and unfocused tiles alike. **What does not:** lualine runs
  any function the person names, in the editor's own process. Ours run in a box, so a piece must
  be data a program sends, not code the frame runs.

### Bars and status lines

- **tmux** [t1]. `status-left` is "Display string (by default the session name) to the left of
  the status line"; `status-right` the same on the right. `status` shows "or specify its size", up
  to five lines, each from `status-format[]`. "The last line of a shell command's output may be
  inserted using #()", and `status-interval` redraws "every 15 seconds" by default. "Sessions which
  do not have a particular option configured inherit the value from the global session options."
- **tmux 3.7 and 3.8** [t2]. 3.7 (2026-06-26) added floating panes, "panes which sit above the
  layout". 3.8 (2026-09-09) brought "Many improvements to floating panes", modal panes ("a
  window can have one modal pane and it prevents interaction with the other panes"), and
  `break-pane` "can float a tiled pane, join-pane can tile a floating pane". `display-popup` stays:
  "A popup is a rectangular box drawn over the top of any panes."
- **i3 and sway** [i1] [i2] [i3] [i4]. "i3bar can run a program and display every line of its
  stdout output on the right hand side of the bar." `position top|bottom`, `mode dock|hide|invisible`,
  `workspace_buttons yes|no`. A block's `short_text` "will be used in case the status line needs to
  be shortened", and with `click_events` the bar writes each click back to the program's stdin.
  i3status: "you can specify which 'modules' should be used (the order directive)". Sway is "a
  drop-in replacement" that "works with your existing i3 configuration".
- **VS Code** [v2] [v3]. The status bar "displays information and actions that relate to your
  workspace", in "Primary (left) and Secondary (right)". "Limit the number of items added, as other
  extensions contribute to the same area." An item is made with an `id` ("Must be unique within the
  extension"), a side and a priority: "Higher values mean the item should be shown more to the
  left." Hiding items from the status bar's menu is in the app but was not found in the pages read
  (**guess** from use).
- **macOS menu bar extras** [a1]. People, not the app, "decide whether to put your menu bar extra
  in the menu bar". "Typically, people add a menu bar extra to the menu bar by changing a setting
  in an app's settings window." "When menu bar space is constrained, the system prioritizes the
  display of menus and essential menu bar extras." "Avoid relying on the presence of menu bar
  extras": people can hide one, and the app's Dock menu is there anyway.
- **Obsidian** [o1]. A plugin calls `addStatusBarItem()`; "Custom status bar items are not
  supported on Obsidian mobile apps." Nothing on the page says a person can hide one.

### Settings files and declared settings

- **VS Code** [v1] [v4] [v5]. `contributes.configuration`: "Contribute settings that will be
  exposed to the user", typed by JSON Schema; an `enum` makes "a dropdown menu"; a `scope`
  (`application` is user settings only, the default is `window`). "Workspace settings are specific
  to a project and override user settings", and some "can only be defined in user settings". The
  Settings editor is a view of `settings.json`. Layout: drag views "into the Primary or Secondary
  Side Bar"; "right-click on any action and select its Hide command"; "View: Reset View Locations".
- **Zed** [z1]. The Settings Editor "is the primary way to configure Zed". "Project settings take
  precedence over user settings for that project only", but "Settings that affect the editor
  globally (like `theme` or `vim_mode`) only work in user settings." `status_bar` and `title_bar`
  hold `show_*` switches, such as `show_branch_name`.
- **Raycast** [r1] [r2]. "Extensions can contribute preferences that are shown in Raycast
  Preferences > Extensions"; commands "inherit" them and may override. Types: `textfield`,
  `password`, `checkbox`, `dropdown`, `appPicker`, `file`, `directory`. `required` means it "must be
  entered by the user before the extension is usable". A command with `mode: "menu-bar"` puts an
  item in the menu bar, and an `interval` refreshes it in the background.
- **Obsidian** [o2] [o3]. "By adding a settings tab you can provide an easy-to-use interface for
  the user to update their plugin settings"; `loadData()` and `saveData()` keep it. The
  configuration folder "contains all the settings files pertaining to your vault", and a second
  folder name gives a second profile.
- **Linear** [l1] [l2] [l3]. Personal sidebar: reorder, hide, a More menu, "count or dot";
  "right-click on a specific item to update it or select Customize sidebar". Preferences: font
  size, pointer cursor, theme, a default home view. Display options: "Your selections will persist
  even if you navigate away"; "Set as default" makes them the workspace's.
- **Linear's peek** [l4], **secondary**: the doc page returned 404 on both fetches. Search
  summaries of it say Space toggles a preview of the focused item, holding Space shows it while
  held, and only the key opens it.

### The Elm and OTP answers

- **Elm** [e1]. "Flags are a way to pass values into Elm on initialization", checked by a decoder,
  so the program gets "exactly what you expect". A later change arrives as a Msg through a Sub.
  The parent writes `view` and calls each child's view where it wants it: the child never knows its
  place.
- **OTP** [e2]. An application reads `get_env/3` with a default, and `config_change/3` "is called
  by an application after a code replacement, if the configuration parameters have changed". The
  defaults ship with the application; the release's config lays over them.

### Accessibility

- **2.1.4 Character Key Shortcuts** (A) [w3]: a single-key shortcut needs a way to "turn the
  shortcut off", to "remap the shortcut", or is "only active when that component has focus".
  Speech input can fire letters by accident. The keybindings note already meets it; a glance's `y`
  and `n` must be focus-only too.
- **1.4.4 Resize Text** (AA) [w2]: "text can be resized without assistive technology up to 200
  percent without loss of content or functionality". A bar that holds a person's picks must drop
  pieces by a rule at 200%, not clip them.
- **1.4.12 Text Spacing** (AA) [w1]: line height 1.5, paragraph spacing 2, letter spacing 0.12,
  word spacing 0.16, "no loss of content or functionality". "How such changes are achieved is up to
  the user." A one-line bar with fixed height fails this unless it can wrap or drop.
- **2.4.11 Focus Not Obscured** (AA) [w4]: a focused part "is not entirely hidden due to
  author-created content". A float that leaves focus on the list must not cover the focused row.

### Outside software

- **Stream Deck** (people who run live video) [f1]. A plugin's manifest lists its actions, each
  for a `Keypad` or an `Encoder`, with an optional settings page per action. A person puts actions
  on keys; the drag itself is from the app, not the page read (**secondary**). It teaches the
  split cleanly: the plugin offers, the person places, and the plugin never picks its key.
- **Garmin G1000** (pilots) [f2], **secondary**, read through manual mirrors. The map bar has four
  fields; a pilot picks each from a fixed list, and a defaults key restores all four. The flight
  instruments themselves are not configurable. It teaches the limit: a few places, a closed list,
  one way back to the defaults, and the parts that keep you safe are not on the list.
- **What does not carry over:** both are hardware with a fixed number of places. Our bars are
  text and shrink with the window, so the squeeze rule matters more than the count.

### The plain way they agree on

1. The frame owns a few fixed places (left and right of each bar). Programs offer pieces. The
   person's file says which piece goes in which place, in what order.
2. A piece is data with a short form; the frame draws it, orders it and drops it when space runs
   out, by a priority.
3. Defaults ship and work with no file. The person's rows lay over them. One key or command puts
   the defaults back.
4. A program declares its settings with a type and a default; one settings view lists them all
   and writes the same file a person edits by hand.
5. Some things the person cannot remove, because they keep the person safe. Nothing a person can
   hide is the only way to a job.
6. The person's look and layout are the person's; the project's file never sets them.

**Where it clashes with a goal of ours, in one line:** lualine lets a person put anything
everywhere, and our settled tile title bar and "the bars stay as they are" say some places are
not open.

## Today's frame: the running example

The case: the owner watches ticket 117's asks from the top bar while two `tsh` tiles run, then
presses `C-b a` to answer one.

### What today has, and where

| What | Today | Where |
|---|---|---|
| The asks item | `1 asks you`, with a dot for one not seen; gone at zero | `apps/fabrika/src/window/frame.tsx:255-272`, `frame.ts:232` |
| The other top bar items | agents, sync, host, in that order, always | `frame.tsx:273-343` |
| Opening the glance | `C-b a` opens the asks list, a popover | `apps/fabrika/src/desk/keys.ts:102`, `frame.tsx:433` |
| The popover's keys | a footer typed by hand | `frame.tsx:421` (`ASKS_FOOT`) |
| Hiding | `C-b B` hides both bars; the bottom line comes back mid-key, in a mode, or with a note | `keys.ts:107`, `frame.ts:704`, `frame.ts:745-746` |
| The bottom line | here word and job on the left; note, keys and info on the right | `frame.tsx:787-850` |
| The prefix | `<c-b>`, a constant | `keys.ts:25` |
| The look | follows the system, `light-dark()` per token | `apps/fabrika/src/window/window.css:6` |
| The person's settings file | none; the home is Electron's `userData`, and it keeps state: `desk.json` and a connection file | `apps/fabrika/src/main.ts:102`, `apps/fabrika/src/host/run.ts:165`, `apps/fabrika/src/host/connection.ts:144` |
| tsh's settings | `tsh.toml`; its values "become the defaults of the programs' flags", and "a flag on a line still wins" | `packages/pipeline/src/tsh/config.ts:26-27`, `:48` |
| The repo's settings | `.fabrika/fabrika.toml`, read by tsh | `packages/pipeline/src/settings.ts` |

### The same case against the plain way

- **1, fixed places, programs offer pieces: breaks.** The four items are written one by one in
  one component (`frame.tsx:255-343`). No program offers one; the asks item is the frame's own.
- **2, data with a short form, dropped by priority: half.** The asks item is data (`asksWord`) and
  goes at zero, as the Dock badge does. Nothing drops when the bar is short; only the icon and name
  give way (`top-bar-name.md`).
- **3, defaults with rows over them: breaks.** No row can be laid over anything: there is no file.
  Ticket 191's `[desk]` settings need a reader of `~/.fabrika/fabrika.toml` first, and today's app
  has none ([one fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md):105 lists
  the home as "not built yet").
- **4, declared settings: half.** tsh already treats settings as flag defaults (`config.ts:26`),
  which is the declared shape in all but name. The app has nothing like it.
- **5, safety parts stay: follows.** The close question, the prefix line and a mode bring the
  bottom line back even when hidden (`frame.ts:746`), and the host's link item is a live status
  (`frame.tsx:307`).
- **6, the person's own: half.** `C-b B` is one person's choice, but it is state for this window
  and is lost on restart. Whether that is right is a small call.

## Step 4: the leans tested three ways

The leans handed to this study and found in step 1. Each is tested against Linear as the builder,
Elm or OTP, and accessibility. The design-specific tests wait for step 5.

### L1: programs offer pieces, the person places them (lualine's model)

```toml
# A sketch. ~/.fabrika/fabrika.toml. Places are the frame's; pieces are programs' glances.
[top]
right = ["asks", "agents", "sync", "host"]      # today's order, as the default rows

[bottom]
right = ["keys", "info"]
```

- **Linear as the builder, on our pieces.** Linear's sidebar is this shape: fixed places, the
  person reorders and hides, and picks count or dot [l1]. Built as fabrika programs: each program
  that has a `glance` offers one piece; the frame owns the places; the person's file and a right
  click on the item both write the same rows. The piece every program gets for free is a place in
  the bar, a "hide" and "move" on its item, and a row in the settings view. Where we differ: Linear
  owns every item itself; ours come from programs, some from a repo.
- **Elm.** The frame is the parent. It holds the person's picks in its model (flags, then a Sub)
  and calls each program's `glance` view in the place the picks say. The program never knows its
  place, as W3 already says of tiles. Elm's own answer, with no exception needed.
- **OTP.** The frame monitors each glance's process; a process that dies shows a calm word in its
  place, never a gap the person reads as "nothing waits".
- **Accessibility.** The bar is a `toolbar` or a set of `status` regions; a person's order is the
  reading order, so 1.3.2 holds by construction. Moving an item must work by keys (2.1.1). A real
  VoiceOver run is needed for a bar whose items change at runtime.
- **Tested against each place.**
  - **Top bar: holds.** Its right side is VS Code's secondary side and lualine's `x y z`. The
    workspaces and the line stay the frame's own, as the left of tmux's bar.
  - **Bottom line: half.** Most of it is the frame's voice: the close question, `PREFIX`, a
    mode's word. Only its right side at rest is open. Keybindings already asks whether a mode's
    bottom line is the person's or the program's (60%).
  - **Glances: holds.** A glance is lualine's component. PR 332's call 6 lean becomes "a program
    offers a glance; the person's rows place it".
  - **Tile title bars: clashes.** lualine's winbar and `inactive_winbar` are the closest, and the
    tile guidelines fix the title bar's parts. Opening it is the owner's call.
  - **The desk: does not fit.** lualine has no desk. The layout is state the person makes by
    acting (split, fold), and state is not settings. What fits is the desk's two knobs, `reuse`
    and `place` (ticket 191), which are settings.
- **How sure:** 75% for the bars and glances. The doubt is PR 332's: a top bar with four glances is
  noise. A week of ticket 191's record, plus a glance press count, settles it.

### L2: a piece is data; the frame draws it, with a short form and a priority

```ts
// A sketch, next/. PR 332's glance field, plus what the bar needs to squeeze it.
glance: {
	data: AsksGlance,                                   // Schema: {count, unseen}
	select: (m) => ({count: m.queue.length, unseen: m.unseen}),
	short: (g) => `${g.count}`,                         // i3bar's short_text: "3" when the bar is short
	priority: 90,                                       // VS Code's: higher stays longer
}
```

- **Linear as the builder.** Linear's items all look alike because one team draws them. On our
  pieces: the frame draws every glance from its data, so a repo's program cannot bring its own
  font, color or box into the bar.
- **Elm.** `select` is a view of the one model (G1), so the glance keeps no state. The frame turns
  the data into marks.
- **Why it matters here more than in lualine.** A program in a box sends data, never markup, so a
  repo's program cannot draw a fake "approve" in the top bar. The box rule and the frame rule
  agree.
- **Accessibility.** 1.4.4 and 1.4.12: at 200% text or with wide spacing, the bar uses each piece's
  short form, then drops the lowest priority whole, as the icon and name do now. Never a clip.
  Each dropped piece stays reachable by its key and the palette (W5).
- **How sure:** 80%. The doubt: whether `short` and `priority` are worth two fields when only the
  asks glance exists. Five layouts in step 5's shots settle it.

### L3: some parts are not the person's to hide, and nothing hidden is the only way

- **Linear as the builder.** Linear keeps the inbox count even when the sidebar is trimmed; a
  More menu holds what is hidden [l1]. On our pieces: a lost link, a question asked, a mode's word
  and the prefix line are the frame's, outside every person's rows, like the G1000's flight
  instruments [f2]. A hidden glance keeps its key, its palette row and its tile.
- **OTP.** A supervisor's restart rule is not up to the child. Here: the link's state is not up to
  the person's rows.
- **Accessibility.** 3.2.3, consistent navigation: the fixed parts sit in the same place for
  everyone. 4.1.3: a hidden glance still sends its status to the status region when it matters,
  such as a new ask. Whether that is noise needs a VoiceOver run.
- **The doubt.** Whether the asks count may be hidden. The dark cockpit says hide at zero; a
  person who hides it at three may miss a plan approval. 70%, and the owner picks.

### L4: where each choice lives

```text
~/.fabrika/fabrika.toml   the person's: theme, [top], [bottom], [desk] reuse and place, [program.<name>]
~/.fabrika/keybindings.toml  the person's keys (decided)
.fabrika/fabrika.toml     the project's: checks, agents, packs. Never the look or the bars
the ledger                state the person makes by acting: the desk's layout, saved views
```

- **Linear as the builder.** Linear keeps display options personal and lets one press share them
  [l3]. On our pieces: the person's file, posted to the person's object on the ledger by the
  hands, as keys already are. A shared default for a project is a later fact.
- **Elm and OTP.** Elm flags at start, then a Sub; OTP `get_env/3` with a default, then
  `config_change/3`. Both keep defaults in the program and the person's values over them.
- **Accessibility.** A person's text size and spacing must reach every window, a tab included, or
  1.4.4 holds on the Mac and fails in a tab. The settled tab path covers it.
- **How sure:** 85%. It is the decided split for keys and themes, applied to the rest. Zed and VS
  Code agree [z1] [v4].

### L5: a program says what a person may set through its flags

```toml
# A sketch. A setting is a default for a flag the program already has. A line's flag still wins.
[program.tracker]
show = "mine"          # `tracker` alone now means `tracker --show mine`

[program.asks]
glance = "dot"         # count or dot, as Linear's sidebar
```

- **Why flags.** A program already has a command line's shape, and its flags are a schema
  ([tea-program](../docs/direction/tea-program.md), programs run in a box). tsh already treats
  `tsh.toml` values as "the defaults of the programs' flags" (`config.ts:26`). So no second schema:
  `listing` already gives the settings view every type, default and description.
- **Linear as the builder.** One Preferences page, not a page per feature [l2]. On our pieces: one
  `settings` program that reads each program's listing and writes the person's file, beside `keys`
  and `themes`. Every program gets its settings rows for free.
- **Elm.** Flags decoded at `init`; a later change is a Msg. A program never reads a file.
- **OTP.** `get_env(App, Par, Def)`: the default ships with the code.
- **Accessibility.** The settings view is a form: every field labeled (1.3.1, 3.3.2), keys only
  (2.1.1).
- **The doubt.** Not every setting is a flag. A glance's count or dot is about a view, not a
  start. 65%; the owner picks whether a program may declare a setting that is not a flag.

### L6: change it where you see it, and in one place

- **Linear as the builder.** "Right-click on a specific item to update it or select Customize
  sidebar" [l1]; VS Code: "right-click on any action and select its Hide command" [v5]. On our
  pieces: a key on a focused bar item (and a right click) offers hide and move; the `settings`
  program shows all of it; both write the same file; live reload, as keys. One command restores
  the defaults, as VS Code's "Reset View Locations" and the G1000's defaults key.
- **Elm.** The bar item sends a Msg; the settings program writes the file; the hands post it; the
  frame hears it. One path, two doors.
- **Accessibility.** The hide and move must be reachable without a mouse (2.1.1), and the item
  must say it has a menu (`aria-haspopup`, as `frame.tsx:264` does today).
- **How sure:** 75%. The doubt: two writers (a click and a hand edit) can race. The keybindings note
  already takes "last write wins, both shown" at 70%.

### L7: where a look opens is a placement, and a float is a tile

PR 332's call 7, under lualine's model. The question: may "where a look opens" be the person's
setting? It holds, if a float is one more value of the `place` setting ticket 191 already has.

```toml
# A sketch. Ticket 191's setting, with one more value.
[desk]
place = "beside"   # "beside", "column", "zoom", or "float": over the desk, focus stays on the list
```

```text
asks | ticket, with place = "float", traced (a sketch)
C-b a, Enter   the asks tile opens beside, as G3 says
  j            the selection moves; the ticket floats over the right half; focus stays on the list
  j            the float follows the selection (G1: one model)
  Enter        the float joins the layout as a tile (tmux 3.8: join-pane tiles a floating pane)
  Esc          the float closes; focus never moved
```

- **Holds, because the tiling tools float too.** tmux 3.8 floats a pane and tiles it back [t2];
  i3 toggles floating per window and shows the scratchpad "as a floating window" [i1]; Neovim opens a
  split or a float with one call and an `enter` flag [n3]. A float is the same tile, placed
  differently. Linear's peek is a float that keeps focus on the list [l4], **secondary**.
- **What it costs.** Two kinds of thing over the desk: a popover (the frame's menus) and a float
  (a program's tile). The popovers note says one thing at a time. A rule keeps that: at most one
  float per workspace (tmux: one modal pane), a popover sits above it, and Esc peels the popover
  first, then the float (G5). The desk grows a floating layer, its z-order and its focus rule:
  about 200 lines and 3 agent hours, a **guess**.
- **Where it clashes.** G4 R2 says the new tile takes focus. A peek keeps focus on the list. With
  one model the float follows the selection, so it is coherent, but it is a named exception to G4.
- **Elm.** The float is a tile in the desk's model with `float: true`; the view draws it last. No
  new program kind.
- **Accessibility.** 2.4.11: a float that keeps focus on the list must not cover the focused row,
  so it takes the side away from the selection, or the list scrolls. The float needs a name ("ticket
  117, preview") and a polite status when it opens. A real VoiceOver run is needed: whether a
  preview that does not take focus is announced at all.
- **Lean:** `float` is one value of `place`, never the default, 65%. Default stays `beside`. The
  doubt is the cost of a second floating thing; a week of ticket 191's record, with `float` tried,
  settles it.

### The data rule: what is lost forever if not recorded now

| Fact | Lost if not written when it happens? | Lean |
|---|---|---|
| Which `place` and `reuse` each open used | yes; ticket 191 already records it | keep, as decided |
| A press on a glance, with `via: {_tag: "glance"}` and which glance | yes: it is the only way to learn which glances people use, and PR 332's doubt needs it | record, 80% |
| Each settings change: `by`, `at`, `said`, and how (`file`, `settings`, `item`) | yes; the file keeps only the result | record, as keybindings records a binding change, 80% |
| The settings in force when a window drew, as a hash | yes for a shot or a bug report later | record on load, as `code.loaded` does in hot reload, 70% |
| Which glances were dropped for space, at what width | no: it rebuilds from the width and the rows | derive later |

## Four directions for step 5

Each starts with its config line and its pipe line. None is built. The owner picks which to build
and shoot. The look follows the settled notes in every one.

1. **Places and pieces, lualine's way.** The frame owns `left` and `right` of each bar; the
   person's rows place any program's glance; a right click and the `settings` program write them.
   A look opens where `[desk] place` says, `float` included.
   `[top] right = ["asks", "runs", "agents", "sync", "host"]`, and `asks | ticket` with
   `place = "float"`.
2. **Show or hide, the menu bar's way.** Programs' glances sit in one fixed order, by priority; the
   person only shows or hides each one and picks count or dot. A look is Linear's peek: Space on a
   row floats the ticket, Esc closes it, the list keeps focus.
   `[top] hide = ["sync"]`, `[program.asks] glance = "dot"`, and `asks | ticket --peek`.
3. **The bar runs a line, i3bar's and tmux's way.** The top bar's right side is a tsh line of
   glances, each a program run small; clicks go back to it, as i3bar's do. A look is always a tile
   beside, as PR 332's G3.
   `[top] right = "asks --glance; runs --glance"`, and `asks | ticket` beside.
4. **The frame decides, one glance.** Today's items stay as they are; only the asks glance can be
   hidden or set to a dot. A look is a tile beside. The baseline the others are shot against.
   `[program.asks] glance = "count"`, and `asks | ticket` beside.

### The clashes the owner must pick

- **Everywhere, or the bars only.** lualine opens every place, title bars included (winbar). The
  tile guidelines fix the title bar, and popovers says the bars stay as they are. Lean: the bars'
  right sides and the glances only, 70%.
- **What can never be hidden.** Lean: a lost link, a question asked, a mode's word and the prefix
  line. The asks count is the open one: hideable or not.
- **Two kinds of floating thing.** A float tile beside popovers, against "one thing over the desk
  at a time". Lean: allow one float per workspace, under the popover, 65%.
- **A peek that keeps focus.** It is Linear's answer and an exception to G4's "the new tile takes
  focus". No lean; the owner picks.
- **The names in the file.** `[bottom]` or `[status_bar]` waits on PR 353's rename (65%). `glance`
  stays, by the owner's naming pass.
- **Settings that are not flags.** Whether a program may declare one (L5). 65%.

## What this tells us for fabrika

- Ticket 191 needs a reader of `~/.fabrika/fabrika.toml` in today's app first. The same reader
  carries the bar rows and the program defaults, so build it once, with the three load rules.
- A glance is lualine's component, sent as data. That one rule makes call 6 safe for repo
  programs in a box.
- Give each glance a short form and a priority, so the bar passes 1.4.4 and 1.4.12 by dropping,
  not clipping.
- A program's settings are its flags' defaults. tsh already does this; the app and `next/` can
  read the same rows from the person's file.
- Call 7 is a placement, not a new kind of thing: `float` as one value of `place`. PR 332's table
  for call 7 was wrong about tmux and i3, and should say so.
- Record glance presses and settings changes from the first build. Nothing else can tell whether
  four glances are noise.

## What it cannot tell us

- **Whether people will customize at all.** No data. Linear and macOS ship good defaults first;
  the record above would show it after a week.
- **Whether a float annoys more than a split.** Nobody has used one here. tmux's floating panes
  are about four months old in a release, so there is little in user reports to read.
- **Linear's peek in its own words.** Its doc page was 404; what it does is from search summaries,
  **secondary**.
- **VS Code's hide on a status bar item.** Not found in the pages read, a **guess** from use.
- **Stream Deck's drag and the G1000's fields** are from an app's behavior and manual mirrors, not
  the makers' pages, **secondary**.
- **Whether today's app zooms text.** Electron's default menu has zoom roles, so `Cmd =` likely
  works, but nobody pressed it here: a **guess**. A 200% check in step 5's shots settles it.
- **Screen readers.** Nothing was run. A bar whose items a person moves, and a float that does not
  take focus, both need a VoiceOver run.

## Dollars

$0. Reading only: public pages, today's code on main, the notes, two open pull requests' diffs and
tracker ticket 191. No model call, no Jev, no test run.

## Links

The model to weigh first:

- [n1] https://github.com/nvim-lualine/lualine.nvim/blob/master/README.md
- [n2] https://neovim.io/doc/user/options.html (`'statusline'`, `'winbar'`, `'tabline'`, `'laststatus'`)
- [n3] https://neovim.io/doc/user/api.html (`nvim_open_win`, floating windows)

Bars and status lines:

- [t1] https://man.openbsd.org/tmux.1
- [t2] https://github.com/tmux/tmux/blob/3.8/CHANGES and https://github.com/tmux/tmux/blob/3.8/tmux.1
- [i1] https://i3wm.org/docs/userguide.html
- [i2] https://i3wm.org/docs/i3bar-protocol.html
- [i3] https://i3wm.org/docs/i3status.html
- [i4] https://swaywm.org/
- [v2] https://code.visualstudio.com/api/ux-guidelines/status-bar
- [v3] https://code.visualstudio.com/api/references/vscode-api (`createStatusBarItem`)
- [a1] https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
- [o1] https://docs.obsidian.md/Plugins/User+interface/Status+bar

Settings:

- [v1] https://code.visualstudio.com/api/references/contribution-points
- [v4] https://code.visualstudio.com/docs/configure/settings
- [v5] https://code.visualstudio.com/docs/configure/custom-layout
- [z1] https://zed.dev/docs/configuring-zed
- [r1] https://developers.raycast.com/information/manifest
- [r2] https://developers.raycast.com/api-reference/menu-bar-commands
- [o2] https://docs.obsidian.md/Plugins/User+interface/Settings
- [o3] https://obsidian.md/help/Files+and+folders/Configuration+folder
- [l1] https://linear.app/changelog/2024-12-18-personalized-sidebar
- [l2] https://linear.app/docs/account-preferences
- [l3] https://linear.app/docs/display-options
- [l4] https://linear.app/docs/peek (404 when fetched; **secondary**)

Elm and OTP:

- [e1] https://guide.elm-lang.org/interop/flags.html
- [e2] https://www.erlang.org/doc/apps/kernel/application.html

Accessibility:

- [w1] https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- [w2] https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html
- [w3] https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- [w4] https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html

Outside software:

- [f1] https://docs.elgato.com/streamdeck/sdk/references/manifest
- [f2] https://www.manualslib.com/manual/1065320/Garmin-G1000.html?page=20 (a manual mirror; **secondary**)
