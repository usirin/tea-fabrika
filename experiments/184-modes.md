# How do makers handle modes, and what does today's info mode teach?

Read 2026-11-01. **This is reading, not a measurement.** One small type probe ran on a scratch
copy, outside the repo; everything else is what public docs, one paper and today's code say. It
feeds [modes](../docs/direction/modes.md), a proposed note, and a private page, "Mode guidelines",
with a mode you can enter and leave.

**The answer.** The makers agree on more than they disagree. Avoid a mode when you can. When you
keep one, show it in words where the person is already looking, give it one plain way out, and
never stack one on another. Tesler said it in 1981 and Apple's guidelines still say it. The tools
differ only on details: what the base is called, whether keys from outside the mode still work,
and whether a mode stays when focus moves. Today's info mode (`C-b i`) follows half of this and
breaks the other half:

- **It follows:** the bottom line leads with the word `INFO`, so it is never color alone; it is
  window state in a plain model; it never traps, since every key still works.
- **It breaks:** Escape does not leave it; with the bars hidden (`C-b B`) it is on with no sign at
  all; a screen reader is never told; and it explains only what the pointer is over, so a
  keyboard user cannot use it.

```text
how each tool read does modes, one line each
Tesler     a mode "has no role other than to place an interpretation on operator input"; avoid it
Raskin     a quasimode (hold Shift) cannot be forgotten; a mode can
Vim        'showmode' puts "-- INSERT --" on the last line; Escape goes back to Normal
Helix      NOR, INS, SEL in the status line; minor modes go back after one command
tmux       copy mode is a pane's; key tables are a client's; the base table is "root"
i3         "The only predefined binding mode is default"; its example leaves on Escape
Zellij     locked mode gives every key to the pane; Ctrl g unlocks
Transient  a menu of keys on screen; C-g quits only the innermost, so menus stack
Linear     x selects; a bulk toolbar shows at the bottom; Esc deselects everything
Apple HIG  "Present content modally only when there's a clear benefit"
```

Which version: the tools are outside the repo. "Today's code" means today's version
(`apps/fabrika`, on main). The sketches are for `next/`, where nothing about modes is built.

## What was read

About 25 public pages, one paper (Tesler 2012, as a PDF), and seven files of today's code. Quotes
are short and checked against the page or file as fetched. A claim found only on a secondary page
is marked **secondary**. One found nowhere is marked **guess**.

## The thinkers

- **Larry Tesler.** In a 1981 Smalltalk article he defined a mode as "a state of the user
  interface that lasts for a period of time, is not associated with any particular object, and has
  no role other than to place an interpretation on operator input." His 2012 history names the
  harm: if letter keys "are typed in command mode but the user thinks the system is in text mode,
  unintended and sometimes disastrous results ensue." And: "Users often get 'stuck' in a mode. An
  oft-heard question is, 'How do I get out of this mode?'" He is not absolute. Modes "can be good
  when they support a metaphor like picking up a brush, and when feedback identifying the current
  mode is displayed where the user is almost certain to be looking." [t1]
- **Jef Raskin**, in *The Humane Interface* (2000). A mode is a state in which the same action gives
  a different result. A quasimode is kept only while the person holds it, like Shift, so it
  "cannot be forgotten." Caps Lock is his example of the bad kind. **Secondary:** the wording here
  comes from the Raskin Center's page and Wikipedia's summary of the book, not the book. [t2]
- **Don Norman.** "Design rules based on analyses of human error" (CACM, 1983) names mode errors and
  their cures: remove the mode, or mark it plainly, or give each mode its own commands, each with a
  cost. **Secondary:** the full text is behind ACM's paywall; the summary is from its abstract and
  course notes. [t3]
- **Nielsen Norman Group** ("Modes in User Interfaces", 2019): a mode means "Same input, different
  results". "Mode slips happen because the system doesn't clearly indicate its status to the
  user." Their advice: show the mode with more than one cue, since "Redundancy in indicators is a
  wise idea"; name each mode; avoid a mode where a slip is costly. Quasimodes prevent slips but are
  harder to find and slower for long runs of actions. [t4]

## Keyboard tools

| Tool | The base | How you see it | How you leave | Keys from outside |
|---|---|---|---|---|
| Vim | Normal | `-- INSERT --` on the last line | Escape | the mode's own map only |
| Helix | normal | `NOR`, `INS`, `SEL` in the status line | Escape; minor modes after one command | the mode's own table |
| tmux | the `root` table | copy mode: a position in the pane's top right | `q` (vi) or Escape (emacs) | the prefix still works |
| i3 | `default` | the bar's binding mode indicator | what the config binds; its example uses Escape and Return | none: "all bindings from the current mode are released" |
| Zellij | normal | the status bar | `Ctrl g` in its own example | locked mode passes every key to the pane |
| Transient, Hydra | the editor | a menu of keys on screen | `C-g` one level, `C-q` all | Hydra: a foreign key leaves, or runs, or warns, by color |

- **Vim.** `'showmode'` is on by default: "If in Insert, Replace or Visual mode put a message on
  the last line." [k1]
- **Helix.** The status line's `mode` element shows "The current editor mode", as `NOR`, `INS` and
  `SEL`. `color-modes`, "Whether to color the mode indicator with different colors depending on
  the mode itself", is off by default: the word is the cue, and color is extra. Minor modes "are
  accessible from normal mode and typically switch back to normal mode after a command"; the
  sticky view mode "can be exited using the escape key". [k2]
- **tmux.** Copy mode is a pane's state (the format `pane_in_mode`), and "In copy mode an indicator
  is displayed in the top-right corner of the pane". Key tables are a client's
  (`client_key_table`). "The root table is used for keys pressed without the prefix key."
  `switch-client -T` makes a one-key mode: "After that key, the client is returned to its default
  key table (normally root)." That is what tmux's prefix is. [k3]
- **i3.** "When you switch to another binding mode, all bindings from the current mode are released
  and only the bindings defined in the new mode are valid". "The only predefined binding mode is
  default". It warns: "it is advisable to define bindings for switching back to the default mode."
  Advised, never enforced. Its own example names a mode by its keys, `Launch: [f]irefox
  [t]hunderbird`, so the bar's indicator is the hint. [k4]
- **Zellij.** Its keybindings page binds `"Ctrl g" { SwitchToMode "locked"; }` in normal and back
  in locked. Locked mode gives every key to the pane. Its config now ships an `unlock-first`
  preset beside `default`. [k5]
- **Kakoune.** Object first, then verb: you see the selection before you change it. After a prefix
  such as `g`, an info box lists "the recognized keys". [k6]
- **Emacs Transient.** A prefix "activates a transient keymap", shown "until the menu is exited".
  Menus stack: "Pressing C-g while a nested transient is active only quits the innermost
  transient", and `C-q` "always exits all transients". [k7]
- **Emacs Hydra**, "make Emacs bindings that stick around". By default a foreign key leaves: "the
  hydra state will stop and the foreign key will do whatever it was supposed to do". Its colors
  change that: amaranth warns and stays, pink runs the key and stays. [k8]

## Apps with a pointer

- **Apple's HIG on modality.** "Present content modally only when there's a clear benefit."
  "Always give people an obvious way to dismiss a modal view." "Make it easy to identify a modal
  view's task", with a title. "Let people dismiss a modal view before presenting another one."
  And on data: "if closing the view could result in the loss of user-generated content, be sure
  to explain the situation and give people ways to resolve it." [g1]
- **Linear.** Select with `X`, or Shift and a click; "Common bulk actions will show up at the
  bottom", in a "bulk action toolbar"; "Press `Esc` to deselect everything". Nothing is selected
  when a list opens. [g2]
- **Figma.** A tool key, such as `R`, draws one shape and goes back to the Move tool, unless
  "Keep tool selected after use" is on; `V` or Escape gets back. A one-shot mode by default.
  **Secondary:** from Figma's community forum; Figma's help pages read did not say it. [g3]
- **Superhuman.** Its help says every shortcut is in Cmd-K, and that Mail's shortcuts cannot be
  changed. Lists of its keys show `X` to select, as Linear. **Secondary:** no official page on
  selection was found. [g4]

## Accessibility

- **2.1.2 No Keyboard Trap.** If focus can move into a part by keyboard, it can move away by
  keyboard, and "if it requires more than unmodified arrow or tab keys or other standard exit
  methods, the user is advised of the method". A mode that keeps the keys is this case. [a1]
- **2.4.7 Focus Visible.** A keyboard user always sees where focus is. A mode that moves focus
  (copy mode moving into the text) must keep a ring. [a2]
- **3.2.1 On Focus** and **3.2.2 On Input.** "When any user interface component receives focus, it
  does not initiate a change of context." A mode that turns on or off when focus moves is a change
  people did not ask for. The definition is narrow: "A change of content is not always a change
  of context." Entering a mode by a key is not a change of context. [a3]
- **4.1.3 Status Messages.** A status message must be "programmatically determined through role or
  properties" so it is read "without receiving focus". `role="status"` is a listed way (ARIA22).
  Per MDN, `status` has "an implicit aria-live value of polite and an implicit aria-atomic value of
  true", and "Do not give focus to the status when its content updates." [a4]
- **1.4.1 Use of Color.** Color is never the only cue. Helix's default, word first, is the model.
- **Forced colors.** The tile guidelines found that `box-shadow` and washes vanish under forced
  colors, while a word stays. So a mode cue that is only a wash or a shadow fails there. [a5]
- **What needs a real screen reader run.** Whether VoiceOver and NVDA read a polite status when
  focus sits in a terminal's text box (ghostty-web gives it `role="textbox"`); whether NVDA's
  browse mode hears it; and whether a tile's name with ", copy mode" added is read on entering.
  None of that was run.

## Today's info mode

Read on main, today's version. It is the one mode in today's app besides the prefix itself.

```ts
// apps/fabrika/src/window/frame.ts, today's version, abridged
export interface Frame {
	readonly over: Over; // the palette, a list or an item's lines; one at a time
	readonly info: boolean; // "Info mode: the bottom line explains whatever the pointer is over."
	readonly explained: string | null; // what info mode says now
	readonly bare: boolean; // both bars hidden
	readonly note: string | null;
}
// shown(f, "info") is {...f, info: !f.info, explained: null}: C-b i toggles it
// "explain" sets explained only while f.info is true
```

| What | Today | Where |
|---|---|---|
| Enter | `C-b i`, the tsh word `info`, a click on "C-b i info" in the bottom line, or the palette | `desk/keys.ts:106`, `desk/words.ts:98`, `window/frame.tsx:839-847` |
| What it does | the bottom line explains what the pointer is over; tooltips go quiet | `window/desk.tsx:437-441`, `window/frame.tsx:105-106` |
| How it shows | the bottom line reads `INFO · point at anything to see what it is`; the right item reads `C-b i info off` | `window/frame.tsx:807-813`, `:847` |
| Keys inside | every key works as before; info mode takes none | no key case reads `frame.info` |
| Leave | `C-b i` again, the click, the word. Not Escape: Escape closes only what lies over the desk | `window/desk.tsx:415-418` |
| Focus change | stays on; nothing in `frameUpdate` turns it off | `window/frame.ts:775-797` |
| Window switch | each window's own: the frame is the page's own model, "Elm's `Browser.sandbox`" | `window/frame.ts:39-41` |
| Reload | gone; the frame is not saved | `window/frame.ts:693-699` |

Checked against the six principles of the note:

| Principle | Today's info mode | Why |
|---|---|---|
| 1 No mode first | passes, for the pointer | you point at many parts in a row, the mode's one job. Tooltips already explain one part; info mode keeps the words still in one place |
| 2 A mode is state | passes, with one gap | a plain value in a pure update. The gap: `explained` can hold text while `info` is false, a state that should not exist; a union (`off`, or `on` with `explained`) makes it unsayable |
| 3 You always see it | **breaks three ways** | with `C-b B` the bottom line is hidden unless the prefix is armed (`desk.tsx:815`), so info mode is on with no sign; the bottom line is a plain `footer` with no live region (`frame.tsx:869`), so a screen reader is not told; only `pointerover` explains (`desk.tsx:437`, added at `:835`), never keyboard focus (WCAG 2.1.1) |
| 4 You always get out | half | no trap, since every key still works; but Escape, the way out everywhere else, does nothing |
| 5 Never stacked | passes | one boolean; the palette over it is a dialog, and tooltips stay quiet under it |
| 6 It stays where it lives | passes | per window, kept across focus, gone on reload |

Three fixes would make it pass, all small and none built here: show the bottom line in any mode
even with the bars hidden, as the armed prefix already does; put the mode's words in a
`role="status"` region; explain on `focusin` too. Escape as a way out is the fourth. Today's
rule takes fixes the owner picks, so these are offered, not filed.

## Tier 1's own mode

Tier 1's notes tile has two modes, reading and a plain text box, "as Obsidian's reading and
editing views split them" ([Tier 1's detail](../docs/plan/tier-1-detail.md)). In reading, `e`
edits; in editing, `e` types an e. That is a mode by every definition above. It lives in the
tile's own machine, since "a process is shared by every window". So the first real `next/` mode is
already planned, and it is tile-level and per window.

## A type probe

The note proposes one new field, `commands`, and one `mode` read from state. A probe on a scratch
file, outside the repo, checked the types with the repo's TypeScript 7.0.2 and `--strict`:

```ts
// Passes: every send is a Msg desk takes; every mode is a value mode() returns.
mode: (d: Desk) => (d.info._tag === "on" ? "info" : null),
commands: {
	info: {send: {type: "info"}, keys: "<prefix>i", global: true},
	exit: {send: {type: "info", on: false}, keys: "escape", global: true, mode: "info"},
}
// Refused, each by the compiler:
exit: {send: {type: "info", on: false}, keys: "escape", mode: "resize"}, // not a mode desk has
zoom: {send: {type: "zoom"}, keys: "<prefix>z"},                         // not a Msg desk takes
add:  {send: {type: "add"}, keys: "a", mode: "select"},                  // counter has no mode
```

`NoInfer` keeps the commands from widening the program's Msg and mode types. Not kept: it is
thirty lines, and the note shows the shape.

## What this tells us for fabrika

- **The known way is the plain one.** Every maker read says the same four things: avoid it, show
  it, one way out, no stacking. We follow it, with no custom twist.
- **The base has no agreed name.** tmux says `root`, i3 `default`, Vim and Helix `normal`. Ours is
  `null`, no mode, so nobody has to agree on a word. Most programs never have a mode at all.
- **Keys from outside a mode split the tools.** i3, Helix and Vim release the base keys; tmux keeps
  its prefix; Hydra lets each mode pick. Our rule must keep the prefix and F6 in every mode (the
  no-trap rule), so we sit with tmux.
- **Where a mode lives matters more than the tools show.** In tmux, two clients on one pane share
  its copy mode. With two people in Tier 3, one person's mode must not move the other's view. Tier
  1 already answered this for which note is open: the window's machine. A mode goes there too.
- **The prefix is already a mode,** a one-key one, and today's bottom line already shows it right:
  `PREFIX`, its keys, `esc cancels`. Every mode should look like that.

## What it cannot tell us

- No screen reader was run. The status and live region claims are from WCAG and MDN.
- No mode was built or used. Whether Escape as a way out from info mode annoys a tsh user with vi
  keys in their shell is unknown.
- Whether people forget a tile is in a mode once focus has moved. tmux keeps the mode per pane, and
  nothing here measured slips.
- Raskin's and Norman's words are from secondary pages, and Figma's and Superhuman's are from forums
  and lists, as marked.
- Whether a hold-to-explain quasimode would beat info mode. Nobody tried it.

## Links

- [t1] Larry Tesler, "A Personal History of Modeless Text Editing and Cut/Copy-Paste", *interactions*
  19(4), 2012, [doi:10.1145/2212877.2212896](https://doi.org/10.1145/2212877.2212896)
- [t2] [The Raskin Center, "Modes are harmful"](https://raskincenter.org/ideas/modes-are-harmful/);
  [Wikipedia, "Mode (user interface)"](https://en.wikipedia.org/wiki/Mode_(user_interface)); Jef
  Raskin, *The Humane Interface*, Addison-Wesley, 2000
- [t3] Donald A. Norman, "Design rules based on analyses of human error", CACM 26(4), 1983,
  [doi:10.1145/2163.358092](https://doi.org/10.1145/2163.358092)
- [t4] [Page Laubheimer, "Modes in User Interfaces: When They Help and When They Hurt Users", NN/g, 2019](https://www.nngroup.com/articles/modes/)
- [k1] [Vim `'showmode'`](https://vimhelp.org/options.txt.html#%27showmode%27)
- [k2] [Helix keymap](https://docs.helix-editor.com/keymap.html), [Helix editor config](https://docs.helix-editor.com/editor.html)
- [k3] [tmux(1)](https://man.openbsd.org/tmux.1)
- [k4] [i3 user's guide, binding modes](https://i3wm.org/docs/userguide.html#binding_modes)
- [k5] [Zellij keybindings](https://zellij.dev/documentation/keybindings), [Zellij's default config](https://github.com/zellij-org/zellij/blob/main/zellij-utils/assets/config/default.kdl)
- [k6] [Why Kakoune](https://kakoune.org/why-kakoune/why-kakoune.html)
- [k7] [Transient manual](https://github.com/magit/transient/blob/main/docs/transient.org)
- [k8] [Hydra](https://github.com/abo-abo/hydra)
- [g1] [Apple HIG, Modality](https://developer.apple.com/design/human-interface-guidelines/modality)
- [g2] [Linear, Select issues](https://linear.app/docs/select-issues)
- [g3] [Figma forum, shape tool and the Move tool](https://forum.figma.com/ask-the-community-7/why-doesn-t-the-mouse-switch-to-selection-after-using-shortcut-r-to-create-a-graphic-i-have-to-press-v-or-esc-to-switch-it-to-selection-mode-14475)
- [g4] [Superhuman, Shortcuts and Cmd+K](https://help.superhuman.com/article/478-superhuman-command)
- [a1] [WCAG 2.2, 2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)
- [a2] [WCAG 2.2, 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- [a3] [WCAG 2.2, 3.2.1 On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html), [3.2.2 On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html)
- [a4] [WCAG 2.2, 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [MDN, ARIA status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role)
- [a5] [Tile guidelines](../docs/direction/tile-guidelines.md)
