---
date: "2026-11-06, 2026-11-07"
scripts: "none"
summary: "`next/`, with today's palette as the example; reading, not a measurement. About 20 makers (Telescope, Raycast, VS Code, fzf, Vertico, Consult, Embark, Linear, Superhuman, Alfred, Core Spotlight, cmdk, Zag, APG, WCAG, NN/g, Ableton, the G1000, Toast) build a picker from the same five parts: a source, a ranker, rows with an id, actions, a preview. They narrow many sources in one box by a key, run Enter as the first action with a key for the rest, and each had to add a setting so rows do not move under the cursor. Today's palette follows the APG combobox but has one source, no ranking, an index selection reset on every key, and a count no screen reader hears (`pop.tsx:159`). Four designs named for the build pass; round 1 built them in today's app and shot 74 states. A won, with D's Ask row and C's pick in a tile; B lost (\"split\" at the top found nothing), and the walk joined them into one `pick`, pressed as a prototype and approved 2026-11-07. Three reading subagents, no model calls of our own, $0 for the reading; the build pass's cost was not counted."
---

# What is Cmd-K made of, if it is a picker and not a search box?

Read 2026-11-06; built, shot and walked 2026-11-06 and 2026-11-07. **This is reading, not a
measurement.** The first draft said nothing ran and nothing was built. Since then a second pass
built the four designs at the end in today's app and shot 74 states, the owner's walk joined three
of them into one `pick`, and a clickable prototype of it on the Design canvas, "Picker guidelines",
was pressed and approved on 2026-11-07
([what came back](#what-came-back-from-the-build-and-the-walk)). It feeds the note
[Pickers](../docs/direction/picker-guidelines.md), decided 2026-11-07.

**The answer.** Every picker read is built from the same five parts: a **source** that hands rows,
a **ranker** that scores them against what was typed, **rows with an id**, **actions** on a row,
and an optional **preview**. Telescope names them finder, sorter, entry, `attach_mappings` and
previewer [t1]. Raycast names them List, filtering, List.Item, ActionPanel and List.Item.Detail
[r1][r2]. Emacs splits them into three packages that only meet through one standard call: Vertico
draws, Consult brings sources, Embark acts [e1][e2][e3]. The makers agree on four more things:

- **Many sources, one box, narrowed by a key.** Consult combines "multiple static and asynchronous
  candidate sources" and narrows with `f SPC` [e3]; Linear narrows its menu with `i `, `p `, `u `
  and four more [l1]; Raycast puts a dropdown beside the search bar [r1].
- **Enter is the first action, a second key opens the rest.** Raycast: Enter for the primary,
  Cmd-Enter for the secondary, Cmd-K "showing all available actions for the selected item" [r2].
  Embark is "a keyboard-based version of a right-click contextual menu", keyed by the row's type
  [e2]. Alfred's Universal Actions do the same over any item [a2].
- **A row that moves under the cursor is a setting each tool had to add.** Telescope's
  `selection_strategy` (reset by default, or `follow`) [t2], fzf's `--track`, which survives a
  reload only with `--id-nth` [z1], VS Code's `keepScrollPosition`, off by default, and
  `activeItems` [v1]. Each needs a stable row id.
- **The box stays a standard combobox.** APG: "DOM focus remains on the combobox" and
  `aria-activedescendant` points at the row [w1]; WCAG 4.1.3's own example is "18 results
  returned", said without moving focus [w4].

They differ on the way back: Raycast keeps a stack and Esc pops one [r3]; Telescope keeps a history
and resumes the last picker [t2]; fzf toggles modes with no stack [z2].

Today's palette (`apps/fabrika/src/window/pop.tsx:519`) follows the combobox and breaks the rest:
it has one source (the desk's commands), no ranking, a selection kept by index and reset on every
key, no actions past Enter, and a result count that a screen reader never hears.

```text
how each tool builds a picker, one line each
Telescope   finder + sorter + previewer + mappings; ~50 builtin pickers; resume; a picker of pickers
Raycast     List > Section > Item; ActionPanel per row, Enter / Cmd-Enter / Cmd-K; push and pop, Esc pops
VS Code     QuickPick: items, activeItems, busy, separators, item buttons; `?` lists the prefixes
fzf         a stream in, a query, a score; --preview, --bind, reload; --track keeps the row
Vertico     completing-read only, about 600 lines; sorts by history, frequency, length
Consult     many sources in one call, each with a :narrow key; async sources; preview by default
Embark      act on the row under the cursor; one keymap per row type
Linear      one command menu; i/p/u/t/l/f/d narrow it; open work first; 500 results at most
Superhuman  Cmd-K does any action and teaches its key; one score filters and sorts
Alfred      Script Filter rows with a uid it learns from; rerun every 0.1 to 5 s; mods per row
Spotlight   apps add items to one on-device index; the system searches it
APG/WCAG    combobox keeps DOM focus; the count is a status message; Esc is the way out
Ableton     type, then narrow by tags; arrows preview each sample as you land on it
G1000       "Nearest": 25 rows before any typing; pick a row, then Direct-to, then confirm
Toast POS   pick the item, then its modifier groups in a fixed order set ahead of time
```

## What was read

Fetched 2026-11-06. Quotes are short and come from the pages as fetched; a few came through a
fetch tool's summary, so the exact wording is close but not guaranteed. Pages that would not load
are listed under what it cannot tell us.

## Pickers in editors and launchers

| Tool | Parts | Rows that arrive late | Actions and the way back |
|---|---|---|---|
| Telescope [t1][t2] | `finder` "is a required field"; each row has `display`, `ordinal` "used for sorting", and `value` | `selection_strategy` "Determines how the cursor acts after each sort iteration": reset by default, or follow, row, closest | `attach_mappings` swaps Enter's action; `builtin.resume` "Lists the results incl. multi-selections of the previous picker"; `builtin.pickers` lists the earlier pickers |
| Raycast [r1][r2][r3][r4] | List, List.Section, List.Item, List.Item.Detail; `searchBarAccessory` a dropdown | `isLoading` shows "a loading bar ... below the search bar"; `filtering: false` lets the extension filter; `throttle` | Enter primary, Cmd-Enter secondary, Cmd-K the whole panel; "When a user presses `ESC`, we automatically pop to the previous component"; Quick AI asks "a one-off question from Root Search" |
| VS Code [v1][v2][v3] | QuickPick: `items`, `activeItems`, `busy`, separators, item `buttons` | `keepScrollPosition` "Defaults to `false`"; `busy` while "loading more data" | Item buttons; a multi-step `title` and `step`; "Type `?` in the input field to get a list of available commands" |
| fzf [z1][z2] | an input stream, a query, a score, `--preview`, `--bind` | "fzf consumes the input stream asynchronously"; `--track` keeps the selection; `reload-sync` "replaces the list only when the command is complete" | Keys bound to actions; CTRL-R and CTRL-F switch between two modes; no stack |
| Vertico, Consult, Embark [e1][e2][e3] | UI, sources and actions in three packages that meet in `completing-read` | Consult's async sources start after `consult-async-min-input` characters | `embark-act` on the row; "`embark-keymap-alist` associates target types with variables containing keymaps"; `embark-collect` turns the candidates into a buffer |

## Apps with a pointer

| App | What it shows |
|---|---|
| Linear [l1] | Results "showing unstarted and in progress issues first", then backlog, done, canceled; "500 results maximum at this time"; prefixes `i p u t l f d` with a space after, typed in the command menu |
| Superhuman [s1] | Cmd-K brings up a box "where you can instantly do any action", and you "learn the shortcut for next time"; a synonym that matched is shown, "Mark Done (Archive)"; typos still match; one score with a per-command "scale" drives both filter and sort |
| Alfred [a1][a2] | `uid` "allows Alfred to learn about the item for subsequent sorting"; without one, the script's order stays; `rerun` from 0.1 to 5.0 s while the query is unchanged; `mods` change a row's action per modifier key; Universal Actions: choose the item, then the action, "over 60 default actions" |
| Core Spotlight [c1] | "index your content so people can find it from Spotlight and Safari"; apps "add items to the on-device index" |
| cmdk [m3] | `shouldFilter={false}` for rows you sort yourself; `Command.Loading` while rows load; "tested with Voice Over and Chrome DevTools" (VoiceOver only) |
| Zag [m1][m2] | combobox: `collection`, `onHighlightChange`, `inputBehavior`; dialog: "Focus is trapped and scrolling is blocked in the modal mode", `restoreFocus`, `closeOnEscape` on by default |

## Outside software

- **Ableton Live's browser** [f1]: "type your desired search term(s) into the search bar", then
  "refine your search by selecting tags". With Preview on, each sample plays as the arrow lands on
  it. It teaches: a typed word and a picked scope narrow together, and a preview follows the
  cursor. What does not carry: a sample plays for free; an agent's answer costs money and seconds,
  so it cannot run on every arrow press.
- **Garmin G1000's Nearest list** [f2] (**secondary**, read from a manual index's snippets): "the 25
  nearest airports" before any typing; "highlight the desired airport, then press the Direct-to
  Key". It teaches: the empty box is already useful and capped, and a row comes first, its action
  second. What does not carry: that list reorders as the plane moves. No public cockpit source was
  found for "keep rows still under the eye"; that rule rests on the editor tools above.
- **Toast's modifier groups** [f3]: "Groups with lower numbers appear before groups with higher
  numbers". Required groups first. It teaches: the order of a row's choices is set ahead of time,
  never by the moment, so hands learn it. What does not carry: a touch grid with no typing, and a
  menu a manager sets once.

## Accessibility

- **APG combobox** [w1]: "DOM focus remains on the combobox"; `aria-expanded` true while the popup
  shows; Down, Up, Enter, Escape. The list example moves "the visual focus indicator", never DOM
  focus.
- **APG listbox** [w2]: "Each option group has an accessible name provided via aria-label or
  aria-labelledby."
- **APG modal dialog** [w3]: "Escape: Closes the dialog"; "When a dialog closes, focus returns to
  the element that invoked the dialog."
- **WCAG 4.1.3** [w4]: "18 results returned" and "No results returned" are its examples of a status
  message, said without focus.
- **WCAG 2.1.2** [w5]: a modal may keep focus "as long as the user knows how to 'untrap' the focus",
  and Esc "is a commonly used 'standard exit method'".
- **WCAG 3.2.2** [w6]: typing in a field "does not automatically cause a change of context". In a
  picker: typing and arrows never run anything; Enter does.
- **NN/g** [n1][n2]: an accelerator must be "additional, alternate ways to accomplish a task"; 0.1 s
  feels instant, past 1 s show that work is going on, past 10 s show progress and a "clearly
  signposted way for the user to interrupt".

## Today's palette

Today's version, read on main at `dd8b5be7`.

| What | Today | Where |
|---|---|---|
| The box | A combobox in a modal dialog over a listbox, options grouped with `role="group"` | `apps/fabrika/src/window/pop.tsx:539`, `:550`, `:568`, `:576` |
| Its one source | The desk's commands from the keys table, grouped Tile, Focus, Workspace, Window | `apps/fabrika/src/window/frame.ts:166`, `frame.tsx:1014` |
| Matching | Every typed word appears in the name or tsh word; table order, no score | `apps/fabrika/src/window/frame.ts:198-203` |
| The selected row | An index `at`; every key resets it to 0; moving wraps | `apps/fabrika/src/window/frame.ts:921`, `:924` |
| Actions | Enter runs the one command; nothing else on a row | `apps/fabrika/src/window/pop.tsx:563`, `frame.tsx:1015-1020` |
| Teaching the key | After a run, the bottom line says `next time: C-b z` | `apps/fabrika/src/window/frame.ts:928` |
| The count | "19 commands" in the footer, which is `aria-hidden="true"`, so no screen reader hears it | `apps/fabrika/src/window/pop.tsx:159`, `:614` |
| Tab | Kept in the box | `apps/fabrika/src/window/pop.tsx:564` |
| Focus back | On close, focus goes back to where it was | `apps/fabrika/src/window/pop.tsx:127-142` |

Checked against the note's ten principles, as decided (the first draft had seven; the walk added
an exact id, `@` for people and agents, and fabsh as a source, and renumbered):

| Principle | Today |
|---|---|
| Q1 five parts, a program writes sources | Breaks: one source, written into the frame |
| Q2 one box, commands first, 5 per group | Half: commands only, grouped |
| Q3 an exact id goes on top | Breaks: no ids |
| Q4 a prefix narrows the box | Breaks: no scope |
| Q5 people and agents: `@` and the Ask row | Breaks: no agent |
| Q6 fabsh is a source | Breaks: no typed line |
| Q7 the selected row never moves | Half: rows never arrive late, but the index model would jump the day they do |
| Q8 Enter, Cmd-Enter, Cmd-K for the rest; Esc pops one | Half: Enter and Esc only |
| Q9 pick is one program | Breaks: the palette is frame code |
| Q10 the accessibility floor | Half: the combobox and focus back follow; the count is hidden from screen readers |

## What this tells us for fabrika

- **R5 already picked the hard part.** The desk keeps one index and ranks once (program
  guidelines, G7 R5, decided 2026-11-06), which is Spotlight's split [c1] and Consult's [e3]. A
  picker framework is that index plus three more pieces every program gets free: a narrowing word,
  actions from its `commands`, and a stable row id.
- **Actions already exist.** G7 says every command is a palette row. Embark's step is the next one:
  the actions on a ticket row are the ticket program's commands, scoped to that row.
- **The agent fits as a source**, the same way Raycast's Quick AI asks from root search [r4]. It never reorders the rows a person can see.
- **Accessibility is mostly there, with one real bug.** The count sits in an `aria-hidden` footer.
  A polite live region fixes it in a few lines.

## Four designs for the build pass

Named here, built and shot by the second pass (step 5 of the guidelines skill). Each pipe line
comes first. `index` and `pick` were made-up names for a sketch: `index` is the desk's one index (G7
R5), `pick` the picker program. `pick` is now the program's name (the note's Q9).

```text
A  one box, grouped         index | pick                     Linear's command menu: commands, then 5 per program, "All 37 tickets"
B  a picker of pickers      pickers | pick                    Telescope: the empty box lists sources; Enter or `t ` steps into one
C  pick is a program        tracker --all | pick | ticket     fzf and Consult: the same picker in a tile, the ticket tile beside it
D  ask beside               index | pick --ask claude         Raycast Quick AI: rows on the left, the agent's answer streams on the right
```

## What came back from the build and the walk

Round 1 built A, B, C and D in today's app and shot 74 states. The owner's walk then joined three of
them into one `pick`, and a prototype of it was pressed through all 34 presses on the canvas.

| Design | Outcome | Why |
|---|---|---|
| A one box, grouped | Won, with D's Ask row and C's tile | One typed word finds commands, tickets and tiles together; "Tickets › test writer" read like Linear's prefix |
| B a picker of pickers | Lost | "split" at the top gives "Nothing matches" while a command and two tickets have that word. Its Esc stack lives on in the note's Q8 |
| C pick is a program | Lost as Cmd-K, kept as Q9 | As Cmd-K it had tickets only and no prefix. The same pick in a tile, the ticket beside it, is Q9. Its footer's "Leave ⌃B ←" was wrong; it is Esc now |
| D ask beside | Its Ask row joined as Q5 | The answer streams under the Ask row, not on the right, so the rows above stay put |

The walk also changed: Recent in the empty box, exact ids on top, the chip shows the program's
name, people and agents behind `@`, fabsh as a source, and Cmd-K's actions in the same box.

Guesses in this write-up that turned out wrong, left in on purpose:

- **Wrong: D's answer on the right.** The four-designs block says the agent's answer "streams on the
  right". The walk kept the answer under its Ask row, so the rows above stay put; the right-hand
  pane lost.
- **Changed: the agent is `claude`.** The first draft's Ask row asked claude. The walk made it your
  default agent, and `@` names any summoned one.
- **Wrong: one box versus a picker of pickers was open.** The draft said it needed a day of use.
  B's shots settled it without one.

## What it cannot tell us

- **The joined pick is not built in the app.** Round 1's shots are of the four separate designs.
  Agents, rooms, fabsh, actions, Recent and `/` have no app shot yet. Whether 5 rows per group is
  right still needs a day of use.
- **The prototype is simpler than the app.** Its tracker and ticket bodies are plain, its answers
  are canned (no model is called), and Recent's rows, the trace rows' 0.7 s delay, the people under
  `@` and the rooms are made up for it. Ticket titles, numbers and states are real.
- **A limit of the canvas, not the design.** In Claude Design's Play mode, Esc leaves Play before
  the prototype sees it.
- **The prototype draws a dim behind the box.** The popovers note rules there is none (the owner,
  2026-11-06); the canvas is off there.
- **Thousands of rows.** No source here was measured. Linear caps at 500 [l1]; whether one desk
  index ranks 10,000 tickets inside 0.1 s [n2] needs a test with real numbers, as R5 already says.
- **A real screen reader run.** VoiceOver and NVDA on the count, the groups and a streamed agent
  answer. cmdk names VoiceOver only [m3].
- **Pages that would not load:** Linear's command menu and keyboard pages (404), Raycast's fallback
  commands and root search pages (404), Apple's HIG Searching page (drawn by script), Blender's
  operator search (403), Ableton's hot-swap text, VS Code's prefix list beyond `?`, WCAG 2.4.3. The
  Linear command menu's actions on a selected issue are from the program guidelines' sources, not
  this read.
- **Spent:** $0 for the reading. No model call beyond the reading agents. The build pass and the
  prototype ran in agent sessions whose cost was not counted here, a gap in this record.

## Links

- [t1] Telescope, developers.md: https://github.com/nvim-telescope/telescope.nvim/blob/master/developers.md
- [t2] Telescope, help file: https://raw.githubusercontent.com/nvim-telescope/telescope.nvim/master/doc/telescope.txt
- [r1] Raycast List: https://developers.raycast.com/api-reference/user-interface/list
- [r2] Raycast ActionPanel: https://developers.raycast.com/api-reference/user-interface/action-panel and https://manual.raycast.com/action-panel
- [r3] Raycast navigation: https://developers.raycast.com/api-reference/user-interface/navigation
- [r4] Raycast AI: https://manual.raycast.com/ai
- [v1] VS Code API types: https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts
- [v2] VS Code quick picks: https://code.visualstudio.com/api/ux-guidelines/quick-picks
- [v3] VS Code user interface: https://code.visualstudio.com/docs/getstarted/userinterface
- [z1] fzf: https://github.com/junegunn/fzf and https://junegunn.github.io/fzf/reference/
- [z2] fzf ADVANCED: https://github.com/junegunn/fzf/blob/master/ADVANCED.md
- [e1] Vertico: https://github.com/minad/vertico
- [e2] Embark: https://github.com/oantolin/embark
- [e3] Consult: https://github.com/minad/consult
- [l1] Linear search: https://linear.app/docs/search
- [s1] Superhuman: https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- [a1] Alfred Script Filter JSON: https://www.alfredapp.com/help/workflows/inputs/script-filter/json/
- [a2] Alfred Universal Actions: https://www.alfredapp.com/help/features/universal-actions/
- [c1] Core Spotlight: https://developer.apple.com/documentation/corespotlight
- [m1] Zag combobox: https://zagjs.com/components/react/combobox
- [m2] Zag dialog: https://zagjs.com/components/react/dialog
- [m3] cmdk: https://github.com/pacocoursey/cmdk
- [w1] APG combobox: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ and its list example
- [w2] APG listbox: https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
- [w3] APG modal dialog: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [w4] WCAG 4.1.3: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- [w5] WCAG 2.1.2: https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html
- [w6] WCAG 3.2.2: https://www.w3.org/WAI/WCAG22/Understanding/on-input.html
- [n1] NN/g accelerators: https://www.nngroup.com/articles/ui-accelerators/
- [n2] NN/g response times: https://www.nngroup.com/articles/response-times-3-important-limits/
- [f1] Ableton Live 12 browser: https://www.ableton.com/en/manual/working-with-the-browser/
- [f2] Garmin G1000 (secondary): https://www.manualslib.com/manual/1392149/Garmin-G1000.html?page=47
- [f3] Toast modifier groups: https://doc.toasttab.com/doc/platformguide/adminUnderstandingModifierGroupDisplay.html
