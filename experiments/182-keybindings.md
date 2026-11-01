# How do others make keys configurable, and what bites?

Read 2026-11-01. **This is reading, not a measurement.** One small script ran against
today's key code; everything else is what public docs and source say. It feeds
[keybindings are configurable](../docs/direction/keybindings-are-configurable.md).

**The answer.** The plain known way is tmux's: a prefix key, a few named key tables, and
`bind` and `unbind` lines whose right side is a command word. Every tool read keeps its
defaults as rows and lays the person's own rows over them. Three things bite us harder than
the rest:

- **Unbinding can lock a person in.** A terminal tile takes every key. If a person unbinds
  the prefix and F6, nothing gets them out, and WCAG 2.1.2 fails. "Any key can be unbound"
  needs one exception: the table must keep a way out of a tile.
- **Our own split key is unreachable on three Mac layouts.** On German, French and Turkish-F
  Macs, `|` needs Option. Today's `keyName` then names the press `<a-|>`, and nothing is
  bound to that. The probe below shows it.
- **A browser tab is not one list.** In Chromium's source, an installed app window reserves no
  keys at all, and fullscreen reserves only the way out of fullscreen. Only a normal tab keeps
  Cmd-W and the rest.

```text
how every tool read does it, in one line each
tmux       bind-key -T prefix | split-window -h      a table, a key, a command word
Ghostty    keybind = ctrl+a>n=new_window             a sequence, an action
VS Code    {"key": "cmd+k cmd+s", "command": "...", "when": "..."}   rows, bottom wins
Ableton    press KEY, click the thing, press a key   bind by pointing
Linear     Cmd-K, then ? for the list                fixed keys, taught by the palette
```

Which version: the tools are outside the repo. Where this says "today's code" it means
today's version (`apps/fabrika`, read on PR 278's branch). Where it says W5 it means the
decision for `next/` in [the desktop layer](../docs/direction/the-desktop-layer.md#w5-keys).

## What was read

About 45 public pages and two source files, each in the links at the end. Quotes are short,
checked against the page as fetched. Anything not found on a page is marked **guess**, or
**unread** when the page could not be fetched.

## Tiling and terminals

| Tool | Where keys live | Remove a key | Wait after the first key | Reload |
|---|---|---|---|---|
| tmux | key tables: `root`, `prefix`, any named one | `unbind-key`, `-a` for all | forever; `repeat-time` only for `-r` keys | `source-file`, no default key |
| Zellij | modes: normal, locked, pane, tab and more | `unbind` in a mode | stays in the mode | on save (**guess**, not on the pages read) |
| Ghostty | `keybind = trigger=action` | `unbind` passes the key on; `ignore` swallows it | "an indefinite amount of time" | `reload_config` action |
| kitty | `map` lines | map with no action | `map_timeout` | ctrl+shift+f5, or SIGUSR1 |
| WezTerm | `keys` table in Lua | `DisableDefaultAssignment` | leader has a timeout setting | on save |

- **tmux** binds into the `prefix` table by default, and keys "pressed without the prefix
  key" live in `root`. `prefix` is an option, so a person changes it in one line, or sets it
  to `None`. An error in the config is shown "in the first session created", and tmux
  "continues to process the rest of the configuration file". There is no reload key; the man
  page's own example binds one with `source-file`. [r1]
- **Zellij** found the same clash we have: it "intercepts certain keys that we as users
  expect to be sent to the applications running inside Zellij", such as Ctrl-O, which Vim
  uses. Since 0.41 it ships an "Unlock-First" preset: press Ctrl-G first, then the key. That
  is a prefix by another name. [r2] [r3] [r4]
- **Ghostty** has two verbs where most have one. `unbind` removes a binding and the key is
  "sent through to the child command if it is printable". `ignore` means "do nothing, ignore
  the key input". Today's code has the same split: Cmd-W is owned by "nobody", so it is
  swallowed, while an unbound letter goes to tsh. Ghostty also says "physical keys always
  match with a higher priority than Unicode codepoints", and "duplicate triggers will
  overwrite previously set values". [r5] [r6] [r7]
- **kitty** keeps a `kitty_mod` alias, so one line moves every default from Ctrl-Shift to
  something else, and `clear_all_shortcuts` drops every default above it. [r8]
- **WezTerm** says of its leader: "other keypresses will be swallowed and NOT passed through
  to the terminal", and `phys:` matches the US position of a key. [r9]

## Modal editors

- **Vim and Neovim** keep seven mapping sets by mode (Normal, Visual, Select,
  Operator-pending, Insert, Command-line, Terminal). `<Leader>` is a variable, so a person
  moves every leader binding at once. An ambiguous key waits one second (`timeoutlen`). [r10]
- **which-key** "helps you remember your Neovim keymaps, by showing available keybindings in
  a popup as you type", after a 200 ms pause, with each row's text from its `desc`. [r11]
  Today's bottom line after `C-b` is the same idea, with a fixed list of six.
- **Emacs** reserves space for the person: "Don't define C-c letter as a key in Lisp
  programs", and F5 to F9 alone "are also reserved for users to define". It also says don't
  bind `C-h` after a prefix, so `C-h` can list what the prefix offers. [r12]

## Editors and tools

- **VS Code** keeps the person's rows in `keybindings.json`, over the defaults. A `-` before
  a command removes a default. "Rules are evaluated from bottom to top", and "the first rule
  that matches both the key and when clause, is accepted". The file "is watched", so an edit
  takes effect at once. Its editor "lists all available commands with and without keyboard
  shortcuts", has "Show Same Keybindings" for clashes, and a box that "listens for key
  presses" to record one. Scan codes like `[KeyA]` give keys "that do not change with the
  change of the keyboard layout". [r13] In a browser, VS Code moves its own keys: Ctrl-W
  "closes the current tab in browsers", so it offers Ctrl-Shift-Alt-N and others. [r14]
- **Zed** keeps a JSON array of binding blocks, each with a `context`. `null` as the action
  makes a key "do nothing in a given context". "Bindings that match on lower nodes in the
  context tree win", and a later binding wins over an earlier one. A sequence waits one
  second. Its keymap editor writes the same file a person edits by hand. [r15]
- **Figma** does not let a person rebind (an open forum request asks for it). What it does
  well is teach: a shortcuts panel along the bottom, where "shortcuts you've already used are
  highlighted", and "you can continue working while the keyboard shortcuts panel is
  visible". For layouts it reads "the character associated with each positional key code",
  saw "over 2.5k distinct layouts" in 30 days, and chose to "maintain motor memory" by
  position for pairs like zoom in and out. [r16] [r17] [r18]
- **Raycast**: **unread.** Its hotkey manual page returned 404.
- **Linear** teaches keys and does not let a person change them, as far as its public docs
  go. "Press Cmd + K on Mac or Ctrl + K on Windows, then type the page or action you need."
  "Press ? to see the full list of shortcuts." Sequences such as `G` then `I` open a page. Its
  docs say nothing about changing shortcuts, and a 2019 changelog says it fixed them for
  non-US layouts itself. [r19] [r20] [r21]
- **Superhuman**: "one shortcut rules them all: Cmd+K". The palette is where a person does
  any action and also learns the shortcut for next time. It "must be the one place where
  users can find every command", opened by the same key from anywhere. [r22]

## Ableton Live: bind by pointing

The owner already took folding from Live, so this got a close read. [r23] [r24]

```text
Cmd-K (Ctrl-K)   enter Key Map mode: every part that can take a key lights up
click a part     pick what to bind
press a key      that key now drives it
Cmd-K again      leave the mode; the bindings work
```

- "Only the controls that are shown with a red overlay are available for mapping." Keys
  "assigned to switches will toggle switch states".
- The Mapping Browser lists every mapping for the mode: what it drives, its path and name,
  and a min and max. It only shows while a mapping mode is on. A mapping is deleted with
  Backspace.
- MIDI Map mode is the same with blue, for a hardware controller.
- "Keys that become part of remote control assignments can no longer be used as input" for
  the computer MIDI keyboard. So a key does one thing, and Live says so.
- **Not on the pages:** what happens when a key is pressed that is already bound, and where
  the mapping is saved. **Guess:** it moves to the new part, and it is saved with the Set.
- **For us:** the mode is the lesson. It answers "what can I bind?" by showing it, not by
  listing it. Red alone would fail WCAG 1.4.1 here, so our version needs a second cue, such
  as a key cap drawn on each part that can take one.

## Platforms

- **Apple** says "people generally expect to rely on the standard keyboard shortcuts", "don't
  repurpose standard keyboard shortcuts for custom actions", "prefer the Command key as the
  main modifier", and "avoid using the Control key as a modifier", since the system uses
  Control for focus and screenshots. It warns that on a French keyboard Option-5 makes `{`.
  Cmd-Q quits the app, Cmd-W closes the front window, Cmd-H hides. [r25] [r26]
- **A person can already change Cmd-Q on a Mac.** System Settings, Keyboard, App Shortcuts
  lets anyone give any menu item of any app a new key. That is the system's way, and it means
  fabrika never has to own Quit's key. [r27]
- **Windows** lists Ctrl-C copy, Ctrl-W close, and F6 and Shift-F6 to move between panes. It
  warns that some keys move by language: "in the Spanish version of Windows, Ctrl+N is used
  for bold instead of Ctrl+B". A key shown in a tooltip is told to screen readers through
  `AcceleratorKey`, but setting it "doesn't enable keyboard functionality". [r28] F6 "must be
  implemented explicitly", each F6 region needs "a clear accessible name", and "Shift+F6
  should traverse the same cycle in reverse order". [r29]
- **Windows Terminal** is the closest twin to us: `{"keys": "ctrl+shift+c", "id":
  "Terminal.CopyToClipboard"}`. A key set to `unbound` "will pass to the underlying
  terminal", for programs such as Vim. Every action is in the command palette. [r30]
- **GNOME**: use the standard keys, "try to use Ctrl in combination with a letter", leave
  Super to the system, and "do not use Alt for shortcut keys, as this may conflict with access
  keys". "Don't assign shortcuts for everything." [r31] Its page says nothing on terminals.
  Ctrl-Shift-C for copy in a terminal is a convention seen in Windows Terminal; for GNOME
  Terminal it is **unread**.
- **What that means for Cmd and Ctrl.** On a Mac, Cmd is the app's and Ctrl can go to the
  terminal. On Windows and Linux, Ctrl is both the app's and the terminal's, so Ctrl-C has to
  stay with the program in the tile. Terminals solve this with Ctrl-Shift. A prefix solves it
  too, since only one key is taken.

## Accessibility

| Rule | What it asks | What it means for a tile desk |
|---|---|---|
| WCAG 2.1.4 Character key shortcuts (A) | a one-character key can be turned off, remapped to include a non-printable key, or works only on focus | a bare letter in the root table is out; `C-b z` and a popover's `J` are fine |
| WCAG 2.1.1 Keyboard (A) | everything by keyboard, "without requiring specific timings" | the prefix never times out |
| WCAG 2.1.2 No keyboard trap (A) | focus can leave by keyboard, and a non-standard way out is told | the way out of a terminal tile must survive any rebinding, and be shown |
| WCAG 1.4.1 Use of color (A) | color is never the only cue | a "can be bound" glow needs a second cue |

- **2.1.4** names speech input users, "whose dictation is interpreted as strings of letters",
  and people "prone to accidentally hit keys". It counts characters, not keys, and it covers a
  sequence of character keys too. So Linear's `G` then `I` is in scope; `C-b` then `z` starts
  with Ctrl and is not, by our reading (**a reading, not a ruling**). It also means a person
  must not be able to make the prefix a bare letter. [r32]
- **2.1.1** rules out keys that must be pressed "within a short period of time", and asks us
  to assume "modifier key locking may be turned on", meaning Sticky Keys. A prefix that waits
  forever passes both. Today's prefix waits forever (`until: null` in `desk.ts`). The repeat
  window (`REPEAT_MS = 500`) is fine because pressing the prefix again does the same. [r33]
- **2.1.2**: focus can be moved away "using only a keyboard interface", and if that takes more
  than arrows, Tab or a standard exit, "the user is advised of the method". Its own example is
  an applet whose exit key is told "prior to the applet" and inside it. [r34] A tsh tile keeps
  Tab, so `C-b` and F6 are the way out, and [tile guidelines](../docs/direction/tile-guidelines.md)
  already says the bottom line tells it. Once keys are data, that told text must come from the
  live table, and a table with no way out is a table to refuse.
- **ARIA APG** says "it is essential to avoid conflicts with keys that perform system level
  functions": any modifier with Tab, Enter, Space or Escape; Meta with any single key; Alt with
  a function key; and for assistive tech, Caps Lock, Insert or Scroll Lock with anything, and
  on a Mac Control-Option with anything. It also says "do not use keyboard shortcuts as a
  substitute for access via navigation". It does not mention remapping. [r35]
- **F6 is the known way between regions.** APG lists "F6 (Optional): Cycle through window
  panes" for a window splitter. More than one `region` landmark needs "a unique label", and
  screen readers "exploit landmark roles to provide keyboard navigation". [r36] [r37]
- **`aria-keyshortcuts`** takes space-separated combinations, modifiers first, "exactly one
  non-modifier key" each. It "has no effect on the functionality of the page", so the table
  still does the work. MDN warns that overriding a screen reader's keys "can completely shut
  down access", and asks for shortcuts "both visible to sighted users and made available to
  assistive technology". [r38] The ARIA 1.2 spec's own section was **unread**: the fetch
  stopped before it.
- **VoiceOver** uses Control-Option, or Caps Lock, as its key. VO-K is keyboard help, and
  VO-Tab passes the next key through. A binding on Control-Option-anything collides. [r39]
- **NVDA** uses Insert, or Caps Lock, as its key, and NVDA-F2 passes the next key through. In
  browse mode on web pages, single letters jump: `h` headings, `k` links, `f` form fields. Focus
  mode passes keys to the page, and Escape goes back. [r40] So after `C-b`, the `f` in `C-b f`
  (fold) or the `h` in `C-b h` (focus left) may go to NVDA, not to us, when NVDA is in browse
  mode. **Needs a real NVDA run.** JAWS: **unread.**
- **What needs a real screen reader run:** VoiceOver and NVDA on the prefix then a letter, in
  browse and focus mode; whether each tile as a region is too many landmarks; whether the
  bottom line's told way out is heard when focus enters a tsh tile.

## Mechanics that bite

- **`event.key` is the character, `event.code` is the place.** MDN: you "can't use the value
  reported by `KeyboardEvent.code` to determine the character", and the key at `KeyQ` is `'`
  on Dvorak and `A` on AZERTY. [r41] UI Events: `key` depends on "the user's current locale
  setting, modifier state, and any system-level keyboard mapping overrides". [r42]
- **Option makes characters on a Mac.** On a US Mac, Option-A types `å`. Ghostty warns that
  `option+a` "may still produce å" even when Option is remapped. [r7] On German, French and
  Turkish-F Macs, `|` needs Option, by the CLDR layout files. [r43]
- **A browser keeps some keys.** Chromium's `IsReservedCommandOrKey` says: "In Apps mode, no
  keys are reserved." In fullscreen, all commands except leaving fullscreen "should be
  delivered to the web page". In a normal tab it asks a separate list, `IsReservedCommand`,
  which lives in another file and was **unread**. That Ctrl-W and Ctrl-N are kept there is
  from VS Code's browser page [r14], not from Chromium's source. [r44] The Keyboard Lock API gets more keys, but "only when
  JavaScript-initiated full screen is active", since Chrome 130 with a permission, and only
  keys "granted access by the underlying operating system". [r45] [r46] It is experimental in
  MDN. [r47]
- **Electron sees every key first if we ask.** `before-input-event` fires "before dispatching
  the keydown and keyup events in the page", and its `preventDefault` stops "the page keydown
  and keyup events and the menu shortcuts". [r48] So W5's `electron = {cannot: ["Cmd-Q",
  "Cmd-H"]}` is a choice we make, not a limit Electron sets. Electron's own docs warn that
  `globalShortcut` on macOS has "a long-standing bug" with non-QWERTY layouts. [r49] The
  accelerator page was **unread**.
- **How our terminal gets its keys (today's version).** `apps/fabrika` uses ghostty-web 0.4.0.
  Its key handler lets only Cmd-C and Cmd-V (and Ctrl-V) pass. Every other key is encoded from
  `event.code`, the place, then cancelled with `preventDefault`. That cancel is what kept
  Cmd-Q from the menu in the bug PR 278 fixes. For the text it sends, it uses `event.key` only
  when it is one ASCII character. **Read from code, not run:** a non-ASCII key with a modifier
  may reach the program with no text.
- **The kitty keyboard protocol** fixes the old terminal mix-ups ("ctrl+i is the same as
  tab") and reports a "base layout key", the key's place on a US PC-101 board. Alacritty,
  foot, Ghostty, iTerm2, WezTerm and xterm.js are among those that speak it. [r50] Whether
  ghostty-web 0.4.0 speaks it is **unverified**: its README and bundle do not mention it.

## Our own evidence

Today's version keeps keys in `apps/fabrika/src/desk/keys.ts` (read on PR 278's branch). It is
already data: about 37 rows of `{key, does, repeats, name}`, a `PREFIX` of `<c-b>`, and a
`wordOf` that turns each row into a tsh word (`split --to down`, `focus --to left`). The host
sends the table to the window, which draws the keys panel from it. What is not data yet:

- `apps/fabrika/src/window/desk.tsx` hardcodes Cmd-K and Escape.
- `apps/fabrika/src/window/pop.ts` hardcodes the popover keys.
- `apps/fabrika/src/window/frame.ts` hardcodes the six keys shown after the prefix.
- `keyName` drops Shift, so Cmd-Shift-W is Cmd-W and Shift-F6 is F6.
- A `Press` has no `code`, so a binding by place cannot be written.

The Cmd-Q bug ([PR 278](https://github.com/usirin/tea-fabrika/pull/278)): with a tsh tile
focused, Cmd-Q typed `q` instead of quitting. The terminal cancelled the key, and Electron only
offers the menu a key the page left alone. The fix asks `keyOwner` first: on a Mac, every
Command key belongs to the system and the menu, except Cmd-K (the app's) and Cmd-W (nobody's).
That is already a table of who owns which key.

### The probe

`keys.ts` from PR 278's branch, run on Node 22 with type stripping. The `key` values are what
the CLDR layout files say each layout types, not what a browser reported. Not kept in the
repo: it is twenty lines over a copied file.

| Layout | Press | `keyName` | Bound to |
|---|---|---|---|
| US | Shift-\ for `\|` | `\|` | split |
| German Mac | Option-7 for `\|` | `<a-\|>` | nothing |
| French Mac | Option-Shift-L for `\|` | `<a-\|>` | nothing |
| Turkish-F Mac | Option-6 for `\|` | `<a-\|>` | nothing |
| Turkish-F Mac | Option-5 for `[` | `<a-[>` | nothing |
| French Mac | Shift-& for `1` | `1` | workspace 1 |
| Russian Mac | Ctrl on the B key, if reported as `и` | `<c-и>` | the prefix never arms |
| Turkish-F Mac | Ctrl-Shift on the `i` key, `İ` | `<c-i̇>`, two code points | nothing |
| Turkish-F Mac | Ctrl-Shift on the `ı` key, `I` | `<c-i>` | same name as US Ctrl-I |
| US Mac | Cmd-Shift-W | `<m-w>` | owner "nobody", like Cmd-W |

- **Split cannot be pressed on three common Mac layouts.** The fix is small: when Option made
  a printable character, name the character and drop the `a-`. That is what Ghostty's "match
  any presses that produce that codepoint" does. [r7]
- **`toLowerCase` is not Turkish.** `"İ".toLowerCase()` is `i` plus a combining dot, and
  `"I".toLowerCase()` is `i`, where Turkish wants `ı`. `toLocaleLowerCase("tr")` gives `i` and
  `ı`. Lower-casing a key name is the wrong move; keep the character as typed.
- **The Russian row is the doubt.** The CLDR file says Ctrl-B on a Russian Mac sends control
  code 2, the same as US. What Chromium puts in `event.key` there was not checked. If it is
  `и`, a binding by character fails and the fallback has to be by place (`code`), as Ghostty and
  kitty do.

## What this tells us for fabrika

- **The plain known way is tmux's shape, with Ghostty's two verbs and VS Code's overlay.** A
  prefix, named tables, rows of key to command word, defaults first and the person's rows
  over them. That is the shape `keys.ts` already has. Confidence 80%: every terminal read
  converged on it, and it matches W5.
- **Bind by pressing, like Ableton.** A mode that shows what can take a key, then one press.
  VS Code's "listens for key presses" box is the same idea in a list. Confidence 70%: nobody
  in the tiling world does it, so there is no prior art for a tile desk.
- **Teach like Linear and Superhuman,** with one table behind Cmd-K, the keys list, the bottom
  line and `aria-keyshortcuts`. Confidence 85%.
- **No `when` clauses.** [One fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md)
  already refuses a config that "decides what happens next". Tables by mode, as tmux and
  Zellij do, cover the same need. Confidence 75%: VS Code shows `when` is powerful, and the
  cost is a file that becomes code.
- **Characters first, places second.** Match the character a press makes; fall back to the
  place (`code`) for Ctrl and Cmd on a non-Latin layout. Ghostty does the reverse (places win).
  Confidence 60%: the doubt is the Russian row, and a real-layout run in Chromium settles it.

## What it cannot tell us

- No keyboard was switched. Every layout row is from CLDR's files, not from a browser's
  `event.key`, so the probe shows what our code does with those characters, not what a browser
  hands it.
- No screen reader was run. Every NVDA and VoiceOver clash above is from their docs.
- Raycast, JAWS, Chromium's `IsReservedCommand` list, the ARIA 1.2 section on `aria-keyshortcuts`, Electron's accelerator page and
  GNOME Terminal's copy key were not read.
- Whether Linear lets a person change keys is from the absence of docs, not a statement.
- How Ableton handles a key pressed twice in Key Map mode is a guess.
- Whether people want to rebind at all. Linear and Figma ship without it and do fine. The
  owner's decision settles that for us; this reading does not.

## Links

- [r1]: https://man.openbsd.org/tmux.1
- [r2]: https://zellij.dev/documentation/keybindings-modes
- [r3]: https://zellij.dev/documentation/keybindings
- [r4]: https://zellij.dev/tutorials/colliding-keybindings/
- [r5]: https://ghostty.org/docs/config/keybind
- [r6]: https://ghostty.org/docs/config/keybind/sequence
- [r7]: https://ghostty.org/docs/config/reference
- [r8]: https://sw.kovidgoyal.net/kitty/conf/
- [r9]: https://wezterm.org/config/keys.html
- [r10]: https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/map.txt
- [r11]: https://github.com/folke/which-key.nvim
- [r12]: https://raw.githubusercontent.com/emacs-mirror/emacs/master/doc/lispref/tips.texi
- [r13]: https://code.visualstudio.com/docs/configure/keybindings
- [r14]: https://code.visualstudio.com/docs/setup/vscode-web
- [r15]: https://zed.dev/docs/key-bindings
- [r16]: https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard
- [r17]: https://forum.figma.com/suggest-a-feature-11/customizable-shortcuts-35580/
- [r18]: https://www.figma.com/blog/behind-the-scenes-international-keyboard-shortcuts/
- [r19]: https://linear.app/enablement/guide/navigating-linear
- [r20]: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- [r21]: https://linear.app/changelog/2019-06-20-international-keyboard-shortcut-improvements
- [r22]: https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- [r23]: https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/
- [r24]: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- [r25]: https://developer.apple.com/design/human-interface-guidelines/keyboards
- [r26]: https://support.apple.com/en-us/102650
- [r27]: https://support.apple.com/guide/mac-help/create-keyboard-shortcuts-for-apps-mchlp2271/mac
- [r28]: https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-accelerators
- [r29]: https://learn.microsoft.com/en-us/windows/apps/design/accessibility/keyboard-accessibility
- [r30]: https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions
- [r31]: https://developer.gnome.org/hig/guidelines/keyboard.html
- [r32]: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- [r33]: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- [r34]: https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html
- [r35]: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- [r36]: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
- [r37]: https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/
- [r38]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts
- [r39]: https://support.apple.com/guide/voiceover/general-commands-cpvokys01/mac
- [r40]: https://download.nvaccess.org/documentation/userGuide.html
- [r41]: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
- [r42]: https://www.w3.org/TR/uievents-key/
- [r43]: https://github.com/unicode-org/cldr/tree/release-40/keyboards/osx (files `de-t-k0-osx.xml`, `fr-t-k0-osx.xml`, `tr-t-k0-osx.xml`, `ru-t-k0-osx.xml`)
- [r44]: https://github.com/chromium/chromium/blob/main/chrome/browser/ui/browser_command_controller.cc
- [r45]: https://wicg.github.io/keyboard-lock/
- [r46]: https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock
- [r47]: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API
- [r48]: https://www.electronjs.org/docs/latest/api/web-contents
- [r49]: https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts
- [r50]: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
