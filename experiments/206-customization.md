---
date: "2026-11-07, 2026-11-08"
scripts: "none"
summary: "Both versions, mostly `next/`; reading and a lab build, not a measurement. About 13 makers (Linear, macOS, Raycast, VS Code, Zed, tmux, i3, i3status, Ableton, WCAG, Erlang `pg`, Elm) agree: a program offers, the person places, the frame draws. Leans: one glance slot, picked by palette row or settings line (65%); a program never adds its own top bar item (70%); the inbox tile shows asks, then agents' lines, as two groups (65%), and \"Open all\" is the inbox's `open` command on its toolbar (75%); placement is the person's per-program rule, beside by default (70%). Call 7, float or unfold, was a clash with Linear. Step 5 (2026-11-08) built four designs in today's app and shot 21 states at eight layouts (210 headless shots); the owner picked D1 (the inbox's glance in the top bar) with D3 (one list in two groups, the look unfolds in place, a place rule may float it), and named the second group Messages. Note: [Customization](../docs/direction/customization.md). $0."
---

# What may a person change about where programs show, and what may a program claim for itself?

Read 2026-11-07; designs built and shot 2026-11-08. **This is reading, not a measurement.**
Steps 1 to 4 of the [guidelines skill](../.claude/skills/guidelines/SKILL.md) on 2026-11-07, step
5 (four designs in today's app, shot at eight layouts) on 2026-11-08, when the owner picked D1 with
D3. No note and no Design canvas exist yet; they will
be the note "Customization" and the canvas "Customization guidelines". It takes the calls parked
here by [program guidelines](../docs/direction/program-guidelines.md) (calls 6 and 7),
[the ask desk](../docs/direction/ask-desk.md) (the inbox tile), [layers](../docs/direction/layers.md)
(the float as the person's opt-in) and [the frame](../docs/direction/the-frame.md). A tag such as
`[v1]` points at [the links](#links).

**Scope.** The top bar's right side (the glance slot and the items), the inbox program's two
views, and the rule that says where a program's tile lands. The rest of the chassis (the
workspace list, the line, the status bar, each tile's title bar, the desk's split rules) stays as
it is.

**The answer.** The makers agree on one shape: **a program offers, the person places, the frame
draws.** VS Code lets an extension add a status bar item or a view, but tells it to "Limit the
number of items added" [v1] and lets "Views ... be rearranged by the user" [v2], with a reset to
the default [v4]. macOS and Raycast let an app add a menu bar extra, but the person removes and
orders it, and "macOS has the final say" [a1][r1]. i3 and Zed put placement in the person's
config, never the app's: `for_window [class="XTerm"] floating enable` [i1], `"dock": "right"`
[z1]. Linear lets an integration add content (mentions, comments, delegation) and no chrome at
all [l4]. Nobody read lets a program pick its own spot on a shared bar and keep it against the
person.

Today's example, the asks list in the top bar, follows half of this:

- **It follows:** the frame draws the bar; no program adds anything to it. One key opens the
  list, and `Enter` goes to the ticket's own tile rather than opening anything new.
- **It breaks:** every item is hard-coded in the frame, so a program cannot offer a glance and the
  person cannot pick one. The list holds asks only, so a line an agent sent with no summon (decided
  2026-11-07, [PR 477](https://github.com/usirin/tea-fabrika/pull/477)) has nowhere to land. Its
  footer is typed by hand. There is no "Open all" and no inbox tile.

```text
how each tool read handles "who puts what where", one line each
Linear      integrations add content, not chrome; favorites are the person's own sidebar list
macOS       an app adds a menu bar extra; the person Command-drags it, or drags it out
Raycast     a command in menu-bar mode fills an extra; the person runs it to turn it on
VS Code     an extension adds views and items; the person drags them; Reset Location undoes it
Zed         each panel has a "dock" and a "button" setting; the person's settings file picks
tmux        the person writes status-right, any command's output; a split names its side
i3          for_window and assign are the person's rules; i3status's "order +=" lists modules
Ableton     the person shows or hides each view; the Info View explains whatever is hovered
```

## Step 1: what is settled

Each line is decided and is not asked again, unless it says leaned or open.

| Point | State | Source |
|---|---|---|
| The top bar's glance is a slot a program fills; any program may offer a glance; the person picks; the default is `inbox`; its glance and its tile read one queue | decided 2026-11-06 | [program guidelines, call 6](../docs/direction/program-guidelines.md#6-a-glance-view-in-the-top-bar) |
| How many glance slots, and where the person picks | **open, here** | the same |
| A look over the desk, or a tile beside (call 7) | **open, here**, a clash with Linear | [program guidelines, call 7](../docs/direction/program-guidelines.md#7-a-look-over-the-desk-or-a-tile-beside) |
| A look unfolds in place, not Linear's float; a peek keeps focus on the list; a float is a whole tile lifted, only when the person asks (206's `place = "float"`) | decided 2026-11-03 | [layers](../docs/direction/layers.md), L2, L6, calls 2 and 3 |
| A process never knows where its tile is; a program asks the desk with `open`, by program and location or by line | decided 2026-11-03 | [program guidelines](../docs/direction/program-guidelines.md), G2, call 4 |
| Open or focus, then land beside, half the focused tile's share | decided 2026-11-03 | G3, calls 2 and 3 |
| Nothing opens or takes focus without a press | decided 2026-11-03 | G4 |
| The inbox program has two views: the glance (popover) and a tile, a list beside a detail, folding to one pane under about 520px; `Enter` on a row or "Open all" opens the tile; open or focus | decided 2026-11-02 | [ask desk, one asks program](../docs/direction/ask-desk.md#one-asks-program-two-views), Q2 |
| What the inbox tile shows beyond asks, and where "Open all" sits | **open, here** | the brief; the ask desk names "Open all" but no place for it |
| A line from an agent nobody summoned lands as an inbox row; the person replies inline on that row; nothing opens a tile on its own | decided 2026-11-07 | [PR 477](https://github.com/usirin/tea-fabrika/pull/477), not merged at this reading; shared tiles, smaller call 2 |
| A program's buttons come from `commands` (the toolbar), so a key and its button cannot drift | decided 2026-11-03 | G7 R1, C11 |
| The top bar stays mono, words joined by ` · `, no item backgrounds | decided | [the frame](../docs/direction/the-frame.md#which-version), [popovers](../docs/direction/popovers.md) |
| The items (agents, sync, host), the workspace list and the line have no note that owns them | proposed only | [the frame, nobody decides these yet](../docs/direction/the-frame.md#nobody-decides-these-yet) |
| Whether a program adds its own top bar item | **open, here**; nobody has touched it | none |
| Whether a side panel is a program | open, leaned 65% (a guess) | [layers, call 8](../docs/direction/layers.md#8-is-a-side-panel-a-program); not this study |
| Eight layouts for every shot | decided 2026-11-07 | [UI verification](../docs/direction/ui-verification.md), U3 |

Open pull requests on the same area: [PR 477](https://github.com/usirin/tea-fabrika/pull/477)
(shared tiles and the `@` grammar) decides the inbox row for an agent's line and leans, 70%,
that a reply to a person's own talk goes to the inbox only when it ends in a real question.

## Step 2: today's asks list, the running example

All of it is today's version, read on main at `94a5b803`. `next/` has none of these parts yet.

| What | Today | Where |
|---|---|---|
| The asks item in the top bar | Hard-coded by the frame, beside agents, sync and host, each its own block | `apps/fabrika/src/window/frame.tsx:260-275`, `:277-343` |
| The key | `C-b a` shows the asks list | `apps/fabrika/src/desk/keys.ts:133`; `window/frame.ts:883-884` |
| What lies over the desk | One `Over` value: none, asks, jobs, palette or an item's lines | `window/frame.ts:729-740` |
| What an inbox row can be | An `Ask` of kind `"ask"` or `"stuck"` only | `apps/fabrika/src/asks.ts:49-62` |
| The list | A menu, one row per ask, set-aside ones under Later; you answer in the ticket's tile | `window/frame.tsx:433-478` |
| The footer | Typed by hand: Move, Open, Later, Close | `window/frame.tsx:426-431` (`ASKS_FOOT`) |
| `Enter` on a row | Focuses the tile that shows the ticket, else turns the tracker to it, else says "no tile shows #N · the tracker opens it" | `window/frame.ts:412-425` (`opensOf`, `nowhereNote`) |
| Where a new tile lands | A split puts it beside the focused tile and focuses it; the program has no say | `apps/fabrika/src/desk/desk.ts:587-592` |

Checked against the shape the makers share:

| Point | Today | Why |
|---|---|---|
| The frame draws the bar | passes | Every item is the frame's own (`frame.tsx:260-343`) |
| A program offers a glance | breaks | No program can; the list is the frame's menu, not the inbox program's view |
| The person picks what shows | breaks | Nothing to pick; the items appear when their data exists |
| The inbox holds every "waits on you" row | breaks | `kind` is `"ask" | "stuck"` (`asks.ts:57`); an agent's line has no row |
| Keys and buttons from one table | breaks | `ASKS_FOOT` is typed by hand (`frame.tsx:426`) |
| Nothing opens on its own | passes | `Enter` only focuses or turns a tile that exists (`frame.ts:412-421`) |
| Placement is not the program's | passes, by having no placement at all | `desk.ts:587-592` splits beside; no program can ask for a tile |

## Step 3: what was read

### The tools people use daily

| Tool | What it says | Tag |
|---|---|---|
| Linear, favorites | "Favorites are personal shortcuts which appear in your sidebar", "above Your Teams"; folders by drag. | [l1] |
| Linear, inbox | "You'll receive an Inbox notification for key events on your subscribed issues." "The Priority tab separates notifications that need your attention from other updates." "From the list view you can take Inbox-related actions such as deleting or snoozing notifications." "Click into the notification to view the individual issue in a special Inbox view." | [l2] |
| Linear, triage | "Open the issue to review it and take one of the following issue actions"; one key each (1, 2, 3, H). | [l3] |
| Linear, apps | Agents "can be @mentioned, delegated issues through assignment, create and reply to comments." No sidebar or top bar extension point was found. | [l4] |
| Linear, peek | "a quick way to glance over the focused issue in issue lists similar to Quicklook in macOS." "Peek is active while you hold down Space, or you can quickly press Space once to toggle it on." | [l5] |
| Linear, the sidebar | Whether a person can hide or reorder its items: **not found**; its docs page 404s. A guess that it can stays a guess. | none |
| macOS menu bar | "To rearrange status menus, press and hold the Command key while you drag an icon." "You can choose which items to show in the menu bar." Apple's HIG page did not render for the reader, so its menu bar extra lines are not quoted. | [a1] |
| Raycast | A command whose `mode` is `menu-bar` fills an extra. "Running the command activates its menu bar item." "macOS has the final say on whether a given menu bar extra is displayed." It refreshes on an `interval`. | [r1] |
| Raycast, notes | A setting, "Show Notes Toggle Button in Menu Bar": the person turns the extra on. | [r2] |
| VS Code, status bar | "Items that relate to the entire workspace (status, problems/warnings, sync) go on the left." "Limit the number of items added, as other extensions contribute to the same area." Don't "Add more than one item (unless necessary)". | [v1] |
| VS Code, views | "Extensions can contribute custom View Containers." "Views can also be rearranged by the user or moved to another View Container." "Keep the number of Views to a minimum." | [v2] |
| VS Code, panel | Don't "Use for Views that are meant to be always visible since users often minimize the Panel." | [v3] |
| VS Code, layout | "At any time, you can drag and drop views and panels into the Primary or Secondary Side Bar." "View: Reset View Locations", and the keyboard's "View: Move View". | [v4] |
| VS Code, peek | "we embed the result inline"; "the peek window is closed if you press Escape". | [v5] |
| VS Code, contribution points | A view is listed under a container key such as `explorer`; "The `contextualTitle` is used when the view is moved out of its default view container." | [v6] |
| Zed | Per panel: `"dock": "right", // Position of the dock (left, right)` and `"button": true, // Show/hide button in the status bar`. "Individual status bar icons can be hidden." | [z1] |
| tmux | In a format, "#(uptime) will insert the system's uptime": the person writes the status line from any command. "A window may be split into panes using the split-window command." That `-b` puts the pane before is **secondary** (read from a summary of the man page). | [t1] |
| i3 | "for_window [class="XTerm"] floating enable." "To automatically make a specific window show up on a specific workspace, you can use an assignment." "Floating windows are always on top of tiling windows." That i3bar shows each line of a status command is **secondary**. | [i1] |
| i3status | "you can specify which "modules" should be used (the order directive)", as `order += "memory"`. | [i2] |

The plain way they agree on: **a program may offer a part; the person decides if it shows, in
what order and where; the default is small and resettable.** No tool read lets a program decide
its own place against the person. The two that let a program add to a shared bar (VS Code, macOS)
both warn about crowding and give the person the last word.

Where it clashes with a goal of ours: fabrika wants every program to get its parts for free (G7).
"Offer, not add" keeps that: the part is free to offer, and the person's yes puts it on screen.

### Outside software

| Field | What it teaches | What does not carry | Tag |
|---|---|---|---|
| Ableton Live, a music tool | "You can show or hide the browser using the dedicated Show/Hide Browser toggle." "The Info View displays the name and function of whatever element of the UI that you hover over." Each view is the person's to show; the app never adds a view by itself. | A studio has one person and one session. Live's views are fixed, not added by plug-ins. | [f1][f2] |
| A cockpit's multifunction display | **Not read.** The FAA's handbook page refused the reader (HTTP 403). The idea that a pilot picks the MFD's page while the primary display stays fixed is a **guess** here, and nothing below leans on it. | | none |

### The rules and the runtimes

| Source | What it says | Tag |
|---|---|---|
| WCAG 3.2.3 Consistent Navigation (AA) | Repeated parts "occur in the same relative order each time they are repeated, unless a change is initiated by the user." "Users may initiate a change in the order by ... setting preferences." | [w1] |
| WCAG 3.2.5 Change on Request (AAA) | "Changes of context are initiated only by user request." | [w2] |
| WCAG 1.4.13 Content on Hover or Focus (AA) | Dismissible, hoverable, persistent. | [w3] |
| WCAG 2.4.11 Focus Not Obscured (AA) | A focused component "is not entirely hidden due to author-created content." | [w4] |
| WCAG 4.1.3 Status Messages (AA) | Status "can be presented to the user by assistive technologies without receiving focus." | [w5] |
| WCAG 2.4.3 Focus Order (A) | Focus moves "in an order that preserves meaning and operability." | [w6] |
| Erlang `pg` | "Joins single process or multiple processes to the group." "Returns all processes in the group." "If a member terminates, it is automatically removed from the group." | [o1] |
| Elm guide | "Actively trying to make components is a recipe for disaster in Elm." A part is a view function a parent calls, not an object that places itself. | [e1] |

## Step 4: each call, three ways

### Call 6: how many glance slots, and where the person picks

```ts
// A sketch, next/. The person's choice is data the frame holds; a program only offers.
type Glance = {program: ProgramName}; // which program fills the one slot
const settings = {glance: {program: "inbox"}}; // the default, as decided 2026-11-06
// Offered: every running program whose definition has a `glance` view joins the group "glance".
// Picked: the palette row "Show tracker in the top bar", or the settings file's `glance` line.
```

```text
one slot, one program, picked by the person     macOS's own list, i3status's order, Zed's "button"
one slot per offering program                   VS Code's status bar; each extension adds one
a slot per program the person adds               macOS extras, Raycast's menu-bar mode
```

- **Lean: one slot, 65%.** The person picks which program fills it, in two places that write the
  same setting: a palette row ("Show tracker in the top bar", a sketch) and the settings file's
  `glance` line, as i3status's `order` and Zed's `button` do [i2][z1]. No drag on the bar: the
  bar is mono words, and a drag has no key form (2.1.1). **Why one:** VS Code's own rule, "Add more
  than one item (unless necessary)" [v1], and the decided default is one program, `inbox`.
  **Doubt:** a second program (spend, runs) may earn a count of its own, and four glances is
  noise. A week with the slot switchable says whether anyone switches. **Cost:** one setting, one
  palette row per offering program, about 60 lines in the frame (a guess).
- **Linear as the builder.** Linear puts the person's own list in the sidebar, favorites "above
  Your Teams" [l1], and no app can add to it [l4]. On our pieces: the `glance` view is a part every
  program can offer for free (G7), the slot belongs to the frame, and which program fills it is
  the person's, like a favorite. Where we differ: Linear's inbox is a page, not a glance; we keep
  the popover because the count already lives in the top bar (the ask desk).
- **Elm or OTP.** Elm: the frame is the parent, and it calls the chosen program's `glance` view
  with that program's model; the program never draws itself into the bar [e1]. OTP: offering is
  `pg:join(glance, Pid)`; the frame reads `get_members(glance)` for the palette rows, and a program
  that stops leaves the group, so its row goes on its own [o1]. If the picked program is not
  running, the slot falls back to `inbox` (a guess, to weigh in step 5).
- **Accessibility.** 3.2.3: the bar keeps one order, and the person's pick is the "change
  initiated by the user" the criterion allows [w1]. 1.4.13 for the popover [w3]. A switch of the
  slot says so as a status, never by moving focus (4.1.3) [w5]. A screen reader run checks the
  item's name says which program fills it.
- **Today: breaks.** The asks item is the frame's own (`frame.tsx:260-275`); nothing to pick.
- **Shots needed:** yes.

### Whether a program adds its own top bar item

```text
offers, the person places    a program's definition may have a glance; it shows only if picked
adds itself                  a running program puts an item on the bar, as a VS Code extension can
never                        the bar holds only the frame's items and the one slot
```

- **Lean: a program offers, it never adds itself; 70%.** The bar holds the frame's items (agents,
  sync, host) and the one glance slot. A program's way onto the bar is its `glance`, picked by the
  person. **Why:** every tool read that lets apps add to a shared bar (VS Code, macOS, Raycast)
  also hands the person the last word, or warns about crowding [v1][a1][r1]; Linear lets apps add
  none [l4]. A program that adds itself breaks 3.2.3's same-order rule the moment it starts [w1].
  **Doubt:** an agent running a long job may want a live mark without being the glance. The
  agents item (`frame.tsx:277-290`) already counts agents, so that need may be met. **Cost:**
  nothing new beyond call 6.
- **Linear as the builder.** No app adds to Linear's chrome [l4]; agents show up in the work
  (mentions, comments). On our pieces: an agent's line shows up as an inbox row (PR 477), which is
  the work, not the bar.
- **Elm or OTP.** Elm: only the parent places children; a child that places itself is the
  "component" the guide warns about [e1].
- **Accessibility.** 3.2.3 [w1]; a bar that grows as programs start also shifts every later item,
  which a person who navigates by position loses.
- **Today: passes,** by having no way for a program to add one.
- **Shots needed:** one set only, the bar at 1024x700 with one more item, to show what squeezes.

### The inbox tile: what it shows, and where "Open all" sits

```ts
// A sketch, next/. One queue, two kinds of row since 2026-11-07. Names beyond `_tag` are a sketch.
type Row =
	| {_tag: "ask"; ask: AskId; rec: Rec}             // y, n, h: answer, against, later
	| {_tag: "line"; from: AgentName; text: string}; // r: reply inline on the row (PR 477)
type Inbox = {rows: ReadonlyArray<Row>; selected: RowId | null};
// The tile: a list beside a detail (decided). Asks first, then lines, as Linear's Priority tab.
// "Open all" is a command of the inbox program, so it is a toolbar button, a palette row and a word.
const commands = {open: {send: {type: "open"}, keys: "o"}}; // "o" is made up
```

- **Lean, what it shows: one list, two groups, 65%.** "Your turn" (asks and stuck runs) on top,
  then "Lines" (an agent's line nobody summoned). The detail shows the selected row: an ask's rec
  and folded evidence (A2, decided), or a line with its inline reply box. The glance shows the
  same rows and the same groups. **Why:** Linear's inbox has a "Priority tab [that] separates
  notifications that need your attention from other updates" [l2], and "you can take
  Inbox-related actions" from the list itself [l2], which is PR 477's inline reply. One queue
  keeps G1 (one model). **Doubt:** groups or a tab. Linear uses a tab; a tab hides the second
  group, and a line nobody reads goes stale. Step 5 shoots both. **Cost:** a second row kind and a
  reply box in the row, about 150 lines (a guess).
- **Lean, where "Open all" sits: it is a command, not a link, 75%.** It is the inbox program's
  `open` command, so it is a button on the glance's toolbar (G7 R1, keys printed on it), a palette
  row and a tsh word, and the hand-typed footer goes. With a row selected, `Enter` opens the tile
  on that row (decided Q2); with none, the button opens it on the first. **Why:** G7 R1 already
  builds the buttons from `commands`, and VS Code reaches even layout moves as commands ("View:
  Move View") [v4]; a link only in the footer has no key and no palette row. **Doubt:** the toolbar in a small popover may crowd; the
  shots at 1024x700 tell.
- **Linear as the builder.** Linear would keep one inbox and act in the list [l2]. On our pieces:
  the inbox program owns both kinds of row; the ticket stays its own program on the pipe
  (`inbox | ticket`); a line's thread opens only when the person asks (PR 477). Where we differ:
  Linear opens "a special Inbox view" for one item [l2]; we put the detail beside the list.
- **Elm or OTP.** Elm: `Row` is a tagged union and the detail is one `case` on it; the reply box is
  the model's draft. OTP: a line lands in the person's mailbox; the inbox is that mailbox drawn
  (PR 477, every `@name` a mailbox address).
- **Accessibility.** A new row is a status message, never a focus move (4.1.3) [w5]; nothing opens
  on its own (3.2.5) [w2]. The groups are labelled groups in the listbox; `aria-selected` stays the
  selected-row mark (ask desk Q4). A VoiceOver run checks the group names are read.
- **Today: breaks.** `kind` is `"ask" | "stuck"` (`asks.ts:57`), there is no tile, and the footer
  is typed (`frame.tsx:426`).
- **Shots needed:** yes.

### How a program says where it opens

```ts
// A sketch, next/. The program says nothing about placement. The person may, per program.
type Place = "beside" | "float" | "zoom"; // "beside" is G3, decided; "float" is layers' opt-in
const settings = {place: {trace: "float"}}; // as i3's for_window, Zed's "dock"
open({program: "trace", location: {run: "r-3"}, from: "t2", via}); // unchanged: no place in it
```

- **Lean: a program never says where; the person's settings may, per program; 70%.** The default
  is G3's beside. A place rule is keyed by program name, as i3's `for_window` is by class [i1] and
  Zed's `dock` by panel [z1], and `View: Reset View Locations` has its twin: a palette row that
  clears a program's rule [v4]. **Why:** G2 already says a program "never names a tile, a size or
  a side", and layers says a float is "only when the person asks for it". VS Code's contributed
  view names only a default container [v6], and the person can move it. **Doubt:** whether
  `"zoom"` belongs at all, and whether a rule per program or per program and location. **Cost:**
  one setting map, read once in the desk's open path (about 50 lines, a guess).
- **Linear as the builder.** No Linear answer: Linear does not tile, and its pages all fill one
  place. The nearest is its peek, which floats by default [l5].
- **Elm or OTP.** Elm: the place map is in the desk's model and the open's update reads it; the
  program's model never sees it. OTP: a supervisor's child spec belongs to the supervisor, not the
  child; the place rule is the desk's child spec for a program.
- **Accessibility.** 2.4.11: a float must never hide the focused tile entirely [w4]; layers' L5
  law holds that. 2.4.3: focus order with a float open [w6].
- **Today: passes,** by having none: `desk.ts:587-592` always splits beside.
- **Shots needed:** yes, beside next to float.

### Call 7: a look over the desk, or a tile beside

**No lean, the owner picks. It is a clash with Linear.**

Layers decided the default on 2026-11-03: a look unfolds in place, and focus stays on the list.
What is left here is whether Linear's float comes back as an opt-in, and how far.

```text
A: unfold only        a look is always a strip beside; no float exists      layers L6, tmux, i3, VS Code's inline peek [v5]
B: float, opt-in      unfold by default; a person's place rule may say      layers' "206's place = float", i3's for_window [i1]
                      float for a program, and its look floats
C: Linear's float     Space floats the look over the list by default        Linear's peek, "similar to Quicklook" [l5]
```

- **A** keeps one way to look and nothing covering a tile you did not ask about. It undoes
  layers' promise that a float is "the person's opt-in".
- **B** is what layers already wrote down for 206. It adds a second layer to build and test, and
  every float needs the 2.4.11 law [w4].
- **C** walks back layers L6 and call 3, both decided. It is Linear's answer as it ships.
- **Linear as the builder.** Linear floats [l5]. Our pieces say beside (G3, fold not tabs, L5).
  That is the clash.
- **Shots needed:** yes, B and C beside A.

## The shots step 5 should take

The eight layouts of [UI verification U3](../docs/direction/ui-verification.md#u3-eight-layouts-and-the-content-states-both-looks-every-time):
one tile, side by side, stacked, 2x2 (each at 1440x900), the small window at 1024x700, 200% text
zoom on the 2x2, the smallest tile the desk allows, and reflow at 320 CSS px. Dark first, then
light. Each beside today's app and the closest Linear image.

| Call | States to shoot | Layouts |
|---|---|---|
| 6, the glance slot | the slot filled by inbox; by tracker; the palette row that switches it; the popover open | all eight; the bar matters most at 1024x700 and 200% zoom |
| A program's own item | the bar with one extra item | 1024x700 and 200% zoom only |
| The inbox tile | asks and lines as groups; as two tabs; a line selected with its reply box; an ask selected; empty; long list; the glance with the toolbar and "Open all" | all eight; the reply box at the smallest tile and reflow |
| Where a program opens | `trace` beside; `trace` with a float rule; the reset row | side by side, 2x2, 1024x700, smallest tile |
| 7, the look | A, B and C from the same list, focus on the list | all eight; B and C must show what they cover in the 2x2 |

## Step 5: four designs, and the pick

Built 2026-11-08 in today's app, on a local lab branch that is never merged. Each design ran in the
real renderer behind `?design=d1..d4`, with the design package's tokens and the real chassis, and
was shot with headless Chromium on the built renderer, as `apps/fabrika/shots.ts` does (no
Electron, no host). 21 states at the eight layouts above, dark at every layout and light at one
tile and the 2x2: 210 shots. The shots and the lab stay on that branch, not in the repo.

```text
design   pipe line            what makes it different
today    none                 the frame's own asks menu; asks only
D1       inbox (top bar)      the inbox's glance: a popover, two groups, reply in the row, Open all with its key
D2       inbox | ticket       the slot is a count; the inbox tile has two tabs; the ticket opens beside it
D3       inbox                one list, two groups; Space unfolds the look under the row; a place rule may float it
D4       inbox                the same list; Space floats the look over the next rows, as Linear's peek
```

| Design | States shot | Leans it follows or breaks |
|---|---|---|
| D1, the glance | closed, popover, reply in the popover, the slot set to tracker, the palette row, empty | Follows call 6 (one slot, the person picks it), groups, "Open all" as a command |
| D2, tabs beside | Your turn tab, Messages tab, reply, empty, `trace` floated by a rule | Breaks the groups lean (tabs). Follows "a program never says where" |
| D3, unfold | groups, the look unfolded, the look floated by a place rule, reply, a long list | Follows groups, layers L6 and call 7 B |
| D4, float | groups, the look floated, reply | Walks back layers L6 and call 3, both decided; Linear's answer as it ships |

**The pick (owner, 2026-11-08): D1 with D3.** The inbox program has two views: its glance in the
top bar's one slot (D1) and its tile (D3). One list in two groups, Your turn on top, then
Messages. Space unfolds a look in place under the row; a person's place rule may make it float,
which settles call 7 as **B**. "Open all" is the inbox's own command with its key.

- **D2 lost** on the groups lean: two tabs hide one group behind a press, and Linear's own
  Priority split keeps asks on top in one list.
- **D4 lost** on layers L6 and call 3: its float covered the rows under the selected one at every
  layout, and in the 2x2 it covered most of the tile.
- **The second group is Messages,** not Lines: what an agent or a person sends you (owner,
  2026-11-08, [PR 496](https://github.com/usirin/tea-fabrika/pull/496)).

What changed in two rounds:

- D3 and D4 dropped the "Inbox" heading inside the tile; the tile's title bar already says it.
- D4's float sat over its own row; it moved under the row.
- D1's popover ran off the window at 320 px (WCAG 1.4.10). It is now never wider than the window
  less 16 px.
- In a tile under 420 px the footer wrapped to three lines. It now keeps Move and Open, and the
  rest stay in the palette.

Still off, for the build plan:

- D1's slot words ("2 your turn · 2 messages") are cut at 320 px. A shorter word at that width,
  or the count alone, is the build's call.
- Today's trace program draws "5 min" over "10 min" in a narrow tile. Not this study's; filed as
  its own ticket.

Made up in the lab: the stuck run on #12 and its title, both agent messages (builder on #7, scout
on #9), the long list's tickets 20 to 33, the reply text, and the palette rows' words. Ticket #7,
its ask and its trace are the stand-in's (`@tea-fabrika/tracker/seven`). In the lab, Approve,
No, Send and Later draw their keys but write nothing, since there is no host.

## What this tells us for fabrika

- One shape covers four of the five calls: a program offers, the person places, the frame draws.
- Call 6 and "a program's own item" are one call seen twice: if a program never adds itself, the
  glance slot is its only door onto the bar.
- The inbox is the person's mailbox drawn, now that it holds lines as well as asks. Linear's
  Priority split is the known way to keep asks on top.
- Placement belongs to the person's settings, which makes layers' float opt-in concrete, and
  leaves call 7 as the one real clash.

## What it cannot tell us

- The shots ran headless on the built renderer, not in Electron, and no screen reader ran. The
  look is checked by eye beside today's app; nothing was measured.
- Linear's sidebar settings were not found; its docs page 404s. The claim that Linear lets no app
  add chrome rests on the developer docs not naming a place, which is absence, not a statement.
- Apple's HIG page did not render, so macOS is read from its support guide only.
- tmux's `split-window -b` and i3bar's status command are secondary. The cockpit was not read.
- Whether anyone switches the glance slot, and whether lines crowd out asks, need a week of use.
- The settings file's shape is a sketch; no note decides where the person's settings live.

Dollars spent: $0 in model calls beyond this session. No probe ran.

## Links

- [l1] https://linear.app/docs/favorites
- [l2] https://linear.app/docs/inbox
- [l3] https://linear.app/docs/triage
- [l4] https://linear.app/developers/agents.md and https://linear.app/docs/agents-in-linear
- [l5] https://linear.app/changelog/2019-09-23-improved-peek
- [a1] https://support.apple.com/guide/mac-help/customize-the-menu-bar-mchlp1446/mac
- [r1] https://developers.raycast.com/api-reference/menu-bar-commands
- [r2] https://manual.raycast.com/notes
- [v1] https://code.visualstudio.com/api/ux-guidelines/status-bar
- [v2] https://code.visualstudio.com/api/ux-guidelines/views
- [v3] https://code.visualstudio.com/api/ux-guidelines/panel
- [v4] https://code.visualstudio.com/docs/configure/custom-layout
- [v5] https://code.visualstudio.com/docs/editing/editingevolved
- [v6] https://code.visualstudio.com/api/references/contribution-points
- [z1] https://zed.dev/docs/visual-customization
- [t1] https://man.openbsd.org/tmux.1
- [i1] https://i3wm.org/docs/userguide.html
- [i2] https://i3wm.org/docs/i3status.html
- [f1] https://www.ableton.com/en/live-manual/12/live-concepts/
- [f2] https://www.ableton.com/en/live-manual/12/first-steps/
- [w1] https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html
- [w2] https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html
- [w3] https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- [w4] https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [w5] https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- [w6] https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- [o1] https://www.erlang.org/doc/apps/kernel/pg.html
- [e1] https://guide.elm-lang.org/webapps/structure.html
