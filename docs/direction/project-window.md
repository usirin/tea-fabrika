---
state: "decided 2026-11-08"
summary: "Today's version, ticket 276. A window with no project shows a welcome page: \"Open a folder to start\", one line, the recent projects (name, faint path, time) and Open Folder… last. In a project window the name in the top bar is a button with a chevron, as Linear's workspace name, and opens a box of recent projects over the tiles, Open Folder… last. Cmd-O opens that box; File > Open Folder stays the system's sheet. Not taken: a projects tile and a rail. Built from experiment 237."
---

# The project window: a welcome page first, then the name is a switcher

**Decided 2026-11-08.** The owner picked A + C after a walk of four designs, for today's version
(ticket 276): the first run is A's welcome page; in a project window the project's name in the top
bar is C's button with a chevron, which opens C's box; and Cmd-O opens that box too (option b),
with Open Folder… as its last row. File > Open Folder stays the system's folder sheet. Not taken:
B (a projects tile) and D (a rail).

Built from [experiment 237](../../experiments/237-project-window-look.md), which read how Zed, VS Code
and Linear do it and shot four designs in today's app. Neither is a measurement. It shapes the look
of [a window is one project](./brain-hands-window-agent.md) and changes one line there (below).

```ts
// A sketch, today's version. One window's look, as a tagged model the frame draws.
type Recent = {name: string; path: string; at: string}; // path is drawn faint; at as "2 hours ago"
type Look =
	| {_tag: "welcome"; recent: Recent[]; selected: number} // no project, no host, no tsh
	| {_tag: "project"; name: string; box: {_tag: "closed"} | {_tag: "open"; selected: number}};

// The rows, in both places: the recent projects, then one last row.
const rows = (recent: Recent[]) => [...recent.map((r) => ({_tag: "recent", ...r})), {_tag: "folder"}];
```

```text
In demlik's window, the person presses Cmd-O.
1. The box opens over the tiles, in the palette layer: "Open a project…", focus in its field.
2. Rows: tea-fabrika, manti, tea-fabrika-keys-look, phoenix (the recent ones), then Open Folder….
3. Down, Enter on manti: the app opens manti's window, or focuses it if it is open. The box closes.
4. Or Enter on Open Folder…: the box closes and the system's folder sheet opens.
5. Esc closes the box; focus goes back to the tile it came from.
```

## Which version

- **Today's version:** built with ticket 276's plan, amended for this look. That plan was approved
  by the lead agent and is not in the repo yet; "the plan" below means it, and its build pull
  request brings its words in. The frame draws the
  welcome page, the button and the box; the app (`main.ts`) opens windows and the folder sheet.
- **`next/`:** nothing yet. When `next/` gets windows, this is the lesson to rethink, not code to
  port: the place you are in is named top left and switches, and an empty window is one page.

## The four principles

### P1: the first run is a welcome page

**Decided 2026-11-08.**

- A window with no project shows a centered "Open a folder to start", one subtitle line ("Each
  folder opens in its own window, with its own agents and jobs."), the recent projects (name, faint
  path, time) and Open Folder… as the last row. No tile, no host, no tsh.
- Why: the plain way. Zed: "When you open Zed without a folder, you see the welcome page in the
  main editor area." VS Code's Welcome page has Start and Recent.
- Linear would keep an empty state to one clear action, and this does.
- What holds it: the `welcome` case carries no project, so no host link can be made from it (the
  plan's tagged welcome and project cases).
- Doubt: none on the shape. The top bar over the empty page reads as a second ground; the build
  checks it in the shots.

### P2: the project's name is a button that switches

**Decided 2026-11-08.**

- In a project window, the name sits after the window buttons, sans, with a chevron: Linear's
  workspace switcher. A click opens the box (P3). The brand stays centered
  ([top bar name](./top-bar-name.md)).
- Why: Linear, "Click on your workspace name in the top left corner." The place you are in is
  where you change it.
- Accessible name: "Project demlik, switch project", a button that opens a dialog (WCAG 4.1.2).
  The native window title also names the project (WCAG 2.4.2).
- Cost: it changes the plan's "plain label" into a button.

### P3: one box for switching and opening, on Cmd-O

**Decided 2026-11-08** (option b).

- Cmd-O, or a click on the name, opens one box over the tiles: "Open a project…", the recent
  projects, Open Folder… as the last row. Open Folder… opens the system's folder sheet. File >
  Open Folder still opens that sheet directly.
- Why: one key to learn for both jobs, and the box is the welcome page's list again, so the two
  places read the same.
- The box is not a second modal. Lean, 80%: it is the palette, the one desk-wide modal
  ([layers](./layers.md), L4), opened on a projects source with Open Folder… as a command row, as
  the keys panel is the palette on another source ([popovers](./popovers.md)). So Cmd-K and Cmd-O
  never stack: one replaces the other. Sans, 32px rows, Esc closes, an APG combobox with a listbox,
  as [the picker note](./picker-guidelines.md) asks. If the build finds it must be a second modal,
  that changes layers.md and goes to the owner.
- Where it differs from the known way: VS Code and Zed open the sheet on Cmd-O, and VS Code keeps
  Open Recent on its own key (⌃R). The lead leaned that way at 65%; the owner picked the box.
- Doubt: a new folder takes one more press (Cmd-O, then Open Folder…). A week of use settles it.

### P4: the frame draws, the app opens

**Decided 2026-11-08,** as the plan already holds.

- The welcome page, the button and the box are the frame's. Opening a window, focusing one that is
  open, and the system's folder sheet are the app's (`main.ts`). One row list feeds both places.
- Elm: the plan's parent machine holds opening state and steps each window's machine; the look is
  a view of it.

## The smaller calls

Leans the build plan carries; each follows from P1 to P3.

```text
File > Open Folder…   the system sheet, no key: Cmd-O belongs to the box         lean, 85%
the box's menu item   File > Open Project… ⌘O, so the key shows in the menu      lean, 80%
welcome page, Cmd-O   moves focus to the first row: the page is the box's list   lean, 70%
Open Folder… row      no ⌘O hint on it any more                                 lean, 90%
a row already open    says "open", not a time; Enter focuses its window          lean, 85%
the current project   left out of the box, as C's shots do                       lean, 70%
```

The 70% calls hang on how the page and the box feel side by side; the build's shots settle them.

## Not taken

- **B, a projects tile.** A tile with no host behind it on the first run clashes with the plan: no
  tsh and no fake tiles before a project is open.
- **D, a rail.** A new column in the chassis that costs about 220px in every layout, all day, and
  lists other windows inside this one.

## What the ledger records

Nothing new beyond the plan's "Project opened or focused" record. Lean, 85%, carried by the build
plan: its `source` names the press, `welcome`, `box`, `button`, `menu`, `sheet` or `dock`. Lost if not recorded now: which way
people reach a project, the fact that would tell whether P3's one key was right.

## Where this differs from settled notes

- [Brain, hands, window, agent](./brain-hands-window-agent.md) said Cmd-O opens a new window per
  folder, as VS Code. Changed 2026-11-08: Cmd-O opens the box; the old words stay there, marked.
- Ticket 276's plan said a plain label in the top bar, and switching through File > Open Recent and
  the Window menu. The label is now a button, and the box switches too; the menus stay.

## What it costs

Inside ticket 276's build: the box and the button in `frame.tsx` and `window.css`, the welcome page,
and the menu rows in `main.ts`. A guess, about 150 lines more than the plan had, under an agent hour.

## What it cannot tell us

- Whether the extra press for a new folder grates in daily use.
- How it sounds in VoiceOver: no screen reader ran.
- How the welcome page looks in light mode: only dark was shot.
