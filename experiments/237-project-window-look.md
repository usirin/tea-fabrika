---
date: "2026-11-08"
scripts: "none"
summary: "Today's version, ticket 276; reading plus four designs shot in today's app (84 states, dark), not a measurement. Zed and VS Code show a welcome page with Open Folder and Recent; Linear names the place top left as a switcher. The owner picked A's welcome page plus C's name button and box, with Cmd-O opening the box (the lead had leaned to the system sheet at 65%). $0."
---

# What should a project window show before and after a project is open?

Read and shot 2026-11-08. **This is reading, not a measurement.** Four designs were built and shot
in today's app on a local branch; nothing was timed or counted. It feeds
[the project window](../docs/direction/project-window.md), decided the same day, and builds the look
of ticket 276 ("a window is one project",
[brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)).

Step 5 ran: a local branch on main's build (the project build had not landed), dark, four designs
over the real chassis, one stand-in model with four views. 84 states were shot: today's launch at
five layouts, and per design the first run, a selected row and opening at one tile and the small
window, then a project window and Cmd-O at all five layouts, plus Cmd-O with a row selected for B,
C and D. Every state has a real shot. Not shot: the system's folder sheet and the native window
title, which a page shot cannot hold. The shots stay off the repo: the made-up project rows show
home-folder paths.

**The answer.** The makers agree on the empty window: one centered welcome, one Open Folder action
and a Recent list, the folder's name with its path faint beside it (Zed, VS Code). They split on
the window's name: editors put it in the native title only, Linear puts the place you are in at the
top left as a button that switches. The owner took both: A's welcome page for the first run, and
C's name-with-chevron button and box in a project window, with Cmd-O opening that box.

```text
Zed      no folder: welcome page in the editor area, Open Folder; Cmd-O opens a folder
VS Code  Welcome page: Start (Open Folder…), Recent (name, faint path); Open Recent is a quick pick (Ctrl-R)
Cursor   a VS Code fork; its welcome is VS Code's (guess: the fetched docs say nothing)
Linear   the workspace name top left is a button; a menu switches workspaces (O then W)
today    a tsh tile at once in a window called "fabrika"; no project named anywhere
```

## What was read

Fetched 2026-11-08; quotes checked on the fetched page unless marked.

| Source | What it says |
|---|---|
| Zed, getting started | "When you open Zed without a folder, you see the welcome page in the main editor area." It offers "quick actions to open a folder". "Once you open a folder or file, the welcome page disappears." |
| VS Code, tips and tricks | Open Recent "Displays a Quick Pick dropdown with the list from File > Open Recent", "Keyboard Shortcut: ⌃R". |
| VS Code, workspaces | "You can open a workspace by using the File > Open Folder... menu, and then selecting a folder." |
| VS Code, the Welcome page's layout | Start and Recent, name then parent path. From memory of the product, not the fetched docs: secondary. |
| Linear, workspaces | "Click on your workspace name in the top left corner." "Hover over Switch workspace." Its picture: the name with a chevron, top left, and a menu of workspaces with a check on the current one. |
| Apple HIG, the menu bar | The page body did not load. File > Open Recent is a macOS convention: secondary. |

## Today's window

| What | Today | Where |
|---|---|---|
| The window | one window, titled "fabrika" | `apps/fabrika/src/main.ts:193` |
| The host | starts at once, on whatever `FABRIKA_REPO` says | `apps/fabrika/src/main.ts:394` |
| A project's name | nowhere on screen | the frame's top bar, `apps/fabrika/src/window/frame.tsx` |
| What you learn about projects first | summon's error, "no repository is set for summoned agents" | `packages/fabrika/src/shell/summon.ts:116` |

Against the decided shape: the welcome page breaks (there is none), the name in the top bar breaks
(none), one box for switching and opening breaks (no switching at all), and the chassis passes (it
stays as it is).

## The four designs

Each design is one view of the same model: `{phase: first | project, recent, selected, opening}`.

- **A, a welcome page.** First run: a centered "Open a folder to start", the subtitle "Each folder
  opens in its own window, with its own agents and jobs.", five recent rows (name, faint path,
  time) and Open Folder… as the last row. In a project window, a plain name after the window
  buttons. Close to what Linear would ship. Off: the top bar is a darker band over an empty page,
  and the row of a project already open says "now" where "open" is meant.
- **B, a `projects` tile.** A program whose one job is to list projects. First run is the chassis
  with one `projects` tile. No for the first run: a tile with no host behind it breaks the plan's
  "no host and no tsh" and "do not draw fake tiles", and the list leaves half the tile empty.
- **C, a box.** In a project window the name is a button with a chevron, as Linear's workspace
  name. A click or Cmd-O opens a box over the tiles, "Open a project…", with the recent rows and
  Open Folder… last. It fits 2x2 and the small window. As a first run it is a box over nothing.
- **D, a rail.** A "Projects" column on the window's left. No: it costs about 220px in every layout,
  2x2 in the small window is cramped, "where you are" and "picked" share one fill, and it lists
  other windows inside this one.

The lead's lean before the walk was A's welcome plus C's button and box, about 65% sure, with the
doubt on Cmd-O: the plan, VS Code and Zed open the system's folder sheet on Cmd-O, and VS Code puts
Open Recent on its own key. The owner picked the other branch: Cmd-O opens C's box (option b).

## What this tells us for fabrika

- The first run is a page, not a tile and not a box: it is the plain way, and it starts nothing.
- The project's name belongs where Linear puts a workspace, as a button that switches. That moves
  switching into the window instead of leaving it to File > Open Recent and the Window menu alone.
- One key, Cmd-O, for both switching and opening, with Open Folder… as the box's last row. File >
  Open Folder still opens the system's sheet. This leaves VS Code and Zed on one key, on purpose.

## What it cannot tell us

- No one used it for a day. Whether Cmd-O → box → Open Folder… feels slower than a direct sheet for
  a new folder is a guess; a week of use settles it.
- No VoiceOver run: the button's name, the box's spoken count and the window title change.
- The shots ran over today's host and tsh, with made-up projects and times, while the machine's
  load sat at 45 to 95; opening did not start a real project host.
- What Linear does in its desktop app beyond the one doc page and its picture.

## Links

Dollars: $0, no model was paid for. Tags: `today`, `ticket-276`, `look`, `project-window`.

- [the project window](../docs/direction/project-window.md)
- [brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)
- [popovers](../docs/direction/popovers.md), [layers](../docs/direction/layers.md),
  [top bar name](../docs/direction/top-bar-name.md)
- [Zed, getting started](https://zed.dev/docs/getting-started),
  [VS Code tips](https://code.visualstudio.com/docs/getstarted/tips-and-tricks),
  [Linear workspaces](https://linear.app/docs/workspaces)
