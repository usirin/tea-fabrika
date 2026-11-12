Approved by the lead agent, builds project-window.md (ticket 276); the owner approved this plan on 2026-11-09, amended by the lead 2026-11-09; body c5192fd243d3
Plancheck-Version: 2

```text
A sketch for today's app.

Launch
  saved projects → reopen their windows and attach to their hosts
  none available → welcome page, with no host and no tsh
    "Open a folder to start"
    "Each folder opens in its own window, with its own agents and jobs."
    recent projects: name, faint path, time or "open"
    Open Folder… last

Project window
  project name + chevron → the palette on its projects source
  Cmd-O                 → that same box
  Cmd-K                 → replace its source with commands
  File > Open Project…  → that same box, ⌘O
  File > Open Folder…   → the system folder sheet directly

Pick a project
  real git root → project key
    already opening → join that request
    already open    → restore and focus its window
    otherwise       → its own window, host, desk, ledger, jobs and summons

Close window or Cmd-Q → hosts keep running
Personal settings    → shared across project hosts
Old desk             → checked move once, into the project it served
```

# A window is one project

Ticket 276. Today's version, `apps/fabrika`. Read on main at `2b28a086`, completed 2026-11-09.

This replaces ticket 276's approved plan in full. It keeps that plan's host, folder, restore, migration, socket and settings decisions. It adds the decided A + C look from [project-window.md](docs/direction/project-window.md). Nothing changes in `next/`.

## The shape

### The known way and today's code

Elm comes first. One parent owns the model, handles messages and steps its children. File work and Electron calls are Effects outside the pure update. The project parent steps each project's existing reconnect machine. See [Elm's architecture](https://guide.elm-lang.org/architecture/) and [Elm first](docs/direction/elm-first.md).

OTP keeps separate systems in separate nodes. Today's decided equivalent is one host per project, each with its own storage and connections. This keeps a host alive when its window closes. See [Erlang's distributed systems](https://www.erlang.org/doc/system/distributed.html), [tea-host](docs/direction/tea-host.md) and [the Electron decision](docs/direction/the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart).

Zed shows a welcome page without a folder. VS Code puts recent folders in a quick picker. Linear uses the workspace name at the upper left to reach workspace actions. Fabrika combines those ideas as already decided. Cmd-O opens our box, which adds a press before choosing a new folder. See [Zed](https://zed.dev/docs/getting-started), [VS Code](https://code.visualstudio.com/docs/editing/getting-started/tips-and-tricks) and [Linear](https://linear.app/docs/workspaces).

The code audit confirms the earlier finding:

- `main.ts` holds one `current` window and one host connection. It starts that host at launch. There is no folder picker or project menu.
- `window/desk.tsx` draws `starting` until a desk arrives. There is no welcome page or recent-project list.
- `window/frame.tsx` draws workspaces after the window buttons. It has no project name button.
- `window/frame.ts` has one `Over` slot. Its palette currently selects commands or keys.
- `keys/` contains the real keys editor. `CommandPalette` currently draws it inside Manti's `Dialog`, using that same palette slot.
- `window/pop.tsx` already has the command combobox and listbox. Its rows currently assume a command name, a tsh word and keycaps.

The installed versions are tea 0.25.0, Effect 4.1.2, Manti 0.13.0, Electron 45.2.1, fast-check 4.10.2, Vitest 5.0.5 and Playwright 1.64.1. The tea patch adds schema declarations. The plan uses the installed `Machine.make`, `Cmd.make` and Effect Schema APIs.

### Checked projects and tagged windows

`Project` owns canonical-root checking, identity and path rules. Typed file and git services supply the facts it checks. Electron only carries out its answers.

A project is the real git working-tree root after resolving links. A subfolder selects that root. Linked paths select the same project. Separate clones and worktrees remain separate, even when their remotes match.

The project key is the full SHA-256 of that root. Its durable state lives under `<app-home>/projects/<key>/`. A renderer supplies a recent project's key or asks for the folder sheet. It cannot supply a host address or choose another window's connection.

```ts
// A sketch. Project is the checked domain schema described above.
// Recent keeps a real timestamp. The view formats it as "2 hours ago".
const Recent = Schema.Struct({
	project: Project,
	name: Schema.String,
	path: Schema.String,
	at: Schema.Number,
	open: Schema.Boolean,
});

const Look = Schema.TaggedUnion({
	welcome: {
		recent: Schema.Array(Recent),
		selected: Schema.String,
	},
	project: {
		project: Project,
		name: Schema.String,
		box: Schema.TaggedUnion({
			closed: {},
			open: {selected: Schema.String},
		}),
	},
});

// One list supplies both views. Effect writes each _tag.
const rows = (recent: readonly typeof Recent.Type[]) => [
	...recent.map((r) => Schema.TaggedStruct("recent", Recent.fields).make(r)),
	Schema.TaggedStruct("folder", {}).make({}),
];
```

The welcome case has no project, host link, reconnect child or tsh. It gets welcome props, not today's host-dependent `FrameProps`.

The parent tea machine keeps the saved project records, recent order, restore list, active project, migration state and unfinished opening requests. It reserves a canonical project key before starting a window or host. A second request joins that reservation.

Each project entry has its own reconnect state, ports, ask tracking and notifications. BrowserWindow handles, live wires and Effect scopes stay outside saved data. Existing sender checks select the window entry before forwarding anything. An unrecognized app message never falls through to a host from a welcome window.

The frame's tea state keeps the temporary query and selection. Shared project facts come from the parent. Selection uses a project key, or the folder row's fixed ID. A late change to the recent list does not silently select another project.

### One palette, with a projects source

Use the existing palette slot. Add a tagged source for commands, keys or projects inside it. Do not add a second `projectsOpen` flag.

This follows [layers.md](docs/direction/layers.md), [popovers.md](docs/direction/popovers.md) and [picker-guidelines.md](docs/direction/picker-guidelines.md). Confidence is 90% after reading the code. The cost is extending command-shaped rows to carry project text and actions. It avoids another modal and another focus system.

The projects source uses the shared Manti dialog shell and its own combobox/listbox content. Project rows do not pretend to have tsh commands. Keep project rows at the note's 32px height, in sans, with faint paths. Keep a transparent backdrop and make the desk inert. Today's workspace is inert only when its host link is down, so this change must also enforce inertness under the palette.

Cmd-K and Cmd-O replace the source in that slot. Switching sources keeps the original focus return target. It must run the existing keys editor's close handling when leaving that editor. Existing key-recording and save rules still apply.

The box is titled `Open a project…`. Its field keeps DOM focus. Arrows change the selected option, Enter acts, and Esc closes. The active option has a stable ID. Announce the result count in a polite status region outside the currently hidden footer. Follow the [APG combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) and [modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) patterns.

There is no second modal question to ask now. If the build proves this cannot use the palette slot, it must stop that part and raise the change to `layers.md` with the owner.

### The welcome page, button and rows

Carry every smaller call from the project-window note:

- The welcome page shows the exact heading and subtitle in the opening block.
- Both views read one recent-project row list. The box leaves out its current project.
- A project already open says `open` instead of a time. Enter focuses its window.
- `Open Folder…` is always the last row. It has no ⌘O hint.
- Cmd-O on the welcome page focuses its first row. With no recent projects, that is `Open Folder…`.
- File > Open Project… shows ⌘O and opens the box. File > Open Folder… has no shortcut and opens the system sheet directly.
- File > Open Recent and the native Window menu remain available.

Put the project button after the window buttons, before the workspace list. It has a chevron and the accessible name `Project <name>, switch project`. Its dialog attributes name the palette and say whether it is open.

The native window title and document title name the project too. Equal folder names get the shortest distinguishing parent suffix. Shorten long labels visually while keeping the full accessible name and title.

Keep the centered brand and its existing 24px give-way rule from [top-bar-name.md](docs/direction/top-bar-name.md). Include the new button in that measurement. The button must remain clickable inside the draggable top bar.

The name, role and expanded state support [WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html). The descriptive document title supports [WCAG 2.4.2](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html). VoiceOver still needs a real run.

### Opening, failure and restore

File > Open Folder uses Electron's `showOpenDialog` with `openDirectory`. Attach the sheet to the requesting window. Close the palette before showing it. Cancel leaves the existing project and its work untouched. See [Electron's dialog API](https://www.electronjs.org/docs/latest/api/dialog).

Git failures, missing folders and unreadable folders get distinct plain messages. A non-git folder says `Choose a folder in a git repository` and offers Choose Folder again. Never run `git init`. Never substitute the app's working directory.

Put the opening command in the shared bindings data. Its native menu accelerator follows that data. Read the existing settings reader from the app too, so welcome windows and native menus work without a host. Handle the app command before terminal handling, ordinary popovers and an armed desk prefix can consume it.

Keep one Electron instance per app home. A folder request from another launch uses the same checked opening path. A second launch without a folder focuses the last active project.

Save session changes with a write beside the file and a rename. Save the restore list before quit closes windows. Quit-driven close events cannot empty it. An ordinary close removes that project while another project window remains. Closing the final project keeps it available for the next Dock activation.

Restore each project independently. One missing folder cannot block the others or remove its recent entry. If none can open, show welcome. Minimized existing windows restore before focusing. Quiet launches use the existing inactive-window path throughout.

Each top bar counts only its own project's asks and agents. The Dock badge totals asks from connected project hosts. Notification clicks reopen or focus the project that produced them, including after its window closed.

### Hosts and short sockets

Keep today's app-home choice. This ticket does not move all state into `~/.fabrika`.

Each project's state keeps today's durable formats:

```text
project.json
desk.json
asks.json
history
storage/jobs/
storage/summon/
records/
ledger.sqlite and its SQLite companion files, when local
ledger.json, when connected
host/log
host/restart.json, when present
```

Move sockets and the start lock into a private short system-temp directory. Its identity includes the canonical app home and project key. Check metadata before using it. A name collision is a refusal, never permission to reach another host.

One resolver supplies app, host, CLI, restart and MCP paths. Check both socket names in UTF-8 bytes against `MAX_SOCKET_PATH`, currently 103. Keep directory mode 0700 and socket mode 0600. Separate runtime paths from durable log and restart paths, including directory creation and cleanup.

`startHost` receives a checked project. The child reads and validates its project record. That root reaches `runHost` and `summonManager`. An absent or wrong inherited `FABRIKA_REPO` cannot affect it.

The handshake identifies the project before page traffic is accepted. Raise `PROTOCOL`, currently 2. Keep the existing old-host restart offer. A project mismatch is refused before any ports are relayed.

CLI and MCP commands must select an unambiguous project. Keep explicit project-home use working. An app home with several projects must ask for a project selection instead of guessing the active one.

### Moving the old desk

Keep the approved plan's checked move:

1. Resolve the saved summons' recorded folders. If all name one root, reserve that project. Otherwise reserve the first accepted project. Record which rule chose it.
2. If the legacy host is live, offer the existing explicit restart. Say running jobs stop and saved work stays. Until accepted, leave the host and files alone.
3. After it exits, hold its start lock. Copy durable files to staging. Never copy a live SQLite database.
4. Verify file sizes and digests. Publish by rename. Mark migration complete only after publication and verification.
5. Keep the originals for recovery. A retry resumes the reserved move. It cannot import into another project or overwrite an existing project.

Keep the complete desk, history, asks, all of `storage/`, all records, storage IDs, job numbers and ledger connection. Include private credential files needed by existing saved work. Keep their modes. Do not copy live sockets, PID files or locks.

A saved summon from another root stays saved and appears down with a reason. Never rewrite its original folder or reopen it silently.

An unknown saved shape or failed verification stops the move with a useful recovery message. It never becomes an empty desk. That is the honest exit for a case the old agent would otherwise have had to inspect.

### Shared personal settings

Every project host receives today's `settingsFolder` result. Keys, themes and personal settings keep their existing shared locations. New project homes never become personal settings folders.

Add a cross-process lock around the keybinding read, check, edit and rename. Today's semaphore protects only one host. Two hosts editing different bindings must keep both edits. Undo must refuse a newer version. Every host watches the shared result.

Keep paid-service credentials outside new project folders. In particular, keep the existing app-home Jev key working from its existing shared location. Do not silently enable or copy it per project. Keep each project's ledger address with that project's state.

## One value traced through

The example is the note's Cmd-O in demlik's window.

1. The renderer recognizes the configured opening command before the terminal or an armed prefix handles it.
2. The frame replaces its current palette source with projects. It saves the original focus target and focuses the field named `Open a project…`.
3. The parent supplies recent rows. Demlik is left out. Manti says `open` if its window exists; otherwise it shows its recorded time. `Open Folder…` remains last.
4. Down and Enter on manti close the box and send an app request naming that recent project's key. Main checks the sending page and looks up the checked project.
5. The parent joins an unfinished opening request, restores and focuses the existing window, or reserves the key and creates one window.
6. A new window gets its own ports and reconnect child. Its host handshake must match manti before page traffic flows. Summon then uses manti's checked root.
7. The app writes the opening result and updates recent order. A focus result does not pretend a new host started.

For this route, `source` is `box`. Keep that press source through the asynchronous work. Carry the note's allowed values: `welcome`, `box`, `button`, `menu`, `sheet` and `dock`. Choose it when the request enters, rather than guessing it from the final window.

## What this records

These are private app and host records. Today's tracker facts keep their current format and meaning.

| Record | Keep | Lost if omitted now |
|---|---|---|
| Project opened or focused | Event ID, project key, root then, window ID, `source`, writer, `said`, `at`, result and why | Which folder the press meant and how it was reached |
| Migration | Source format, target key, selection rule, file counts and digests, phase, time and result | Which project got the old desk and whether the move finished |
| Host start | Project key, root, build, PID, settings scope and restart reason | Which repository a surviving host served |
| Summon and turn | Project key, name, folder, session/run ID, model, effort, writer, reported tokens and dollars | What a reused agent name meant at that time |
| Restore and close | Project key, window, source, time and outcome | Whether a window was closed, unavailable or failed to restore |

Keep local paths in private state. Public records and screenshots use repo-relative labels. Keep credentials out of records, URLs, spans and visible errors. Older entries keep unknown facts unknown.

The `source` field lands with the first usable opening flow. Waiting for restore would lose the earlier presses.

## Properties a test checks

“Plant” means a deliberate break that must make the check fail. Keep P1 to P18, with P18 amended for the decided Cmd-O behavior. Generated tests cover internal decisions; Electron scenarios prove the outside route.

| ID | Law | Check | Generator | Plant |
|---|---|---|---|---|
| P1 | The chosen root reaches the actual child and fake harness with the inherited repository absent or wrong | test | fc.record: generated roots and absent or wrong inherited values | Read the inherited repository |
| P2 | Two projects keep separate hosts, ledgers, jobs, summons and ports despite equal tile and agent names | test | fc.array: operations over two generated projects | Reuse one wire or storage home |
| P3 | Repeated, linked and concurrent opens of one canonical root make one host and window | test | fc.array: aliases and interleaved opening requests | Reserve after starting |
| P4 | Subfolders and worktrees resolve correctly; non-git, missing and unreadable folders start no host | test | fc.record: generated working trees, subfolders, links and folder failures | Require a `.git` directory |
| P5 | First launch is welcome without a host or tsh; cancel keeps state | test | fc.array: empty-session opening and cancellation flows | Start the legacy home host at launch |
| P6 | Close and Cmd-Q leave hosts and jobs alive and close only intended windows | test | fc.array: project operations followed by close or quit | Stop a host in a window finalizer |
| P7 | Quit saves the pre-close restore list; reopening deduplicates it | test | @demlik/tea/pbt.arbMsgSequence: opening, focus, close and quit messages | Let quit's close events erase restore |
| P8 | One failed restore leaves other projects usable and keeps its recent entry | test | fc.record: saved projects with independently failing roots | Fail the entire restore batch |
| P9 | Both sockets fit 103 UTF-8 bytes for long roots and homes; distinct app homes stay separate | test | fc.record: long Unicode roots and distinct homes | Count characters or hash only the root |
| P10 | Recovery and stale cleanup affect only the selected project's runtime files | test | fc.array: crashes, stale sockets and restarts across projects | Remove a sibling socket |
| P11 | Migration selects the saved summons' root, else the first accepted project; every write boundary can recover without losing durable files or IDs | test | fc.record: saved files, summon folders and injected write failures | Mark complete before publication |
| P12 | A live legacy host stays untouched until restart is accepted; failed migration preserves its source | test | fc.array: refusal, acceptance and migration failure orders | Copy live SQLite or delete originals |
| P13 | Concurrent key saves preserve independent edits; stale Undo fails | test | fc.array: edits, watcher updates and Undo across two managers | Use only the local semaphore |
| P14 | Counts, notification clicks and sender checks stay project-correct | test | fc.array: equal ticket keys, notices and page messages across projects | Key asks only by ticket number |
| P15 | Equal folder names get distinct titles; full names survive visual shortening | test | fc.record: duplicate basenames, parent paths and widths | Use the basename as identity |
| P16 | A saved summon from another root stays down and keeps its original folder | test | fc.record: saved summons with matching and differing roots | Replace every saved folder |
| P17 | Opening, migration, host, summon, turn and restore records retain the fields above, including each press's source | test | fc.array: successful and failed recorded operations | Write only the latest project list |
| P18 | Cmd-O reaches the projects flow from a terminal, ordinary popover, armed prefix and welcome; quiet opening paths never take OS focus | test | fc.record: focus targets, prefix states and launch modes | Handle opening only inside a tile |
| P19 | A welcome value cannot carry or start a host link; a project window requires a checked Project | type | type | Make project optional on one window type |
| P20 | Welcome shows the exact heading and subtitle, recent names, faint paths and times, with Open Folder… last even when empty | test | fc.array: recent projects and timestamps | Render a tsh placeholder or omit the folder row |
| P21 | Both views use the same row facts; current project is omitted from the box; open projects say `open` | test | fc.record: recent order, current project and open-window set | Build separate lists or show `now` |
| P22 | Query and row updates keep a valid selection; late rows do not change the selected project; Enter acts only on the selected ID | test | fc.array: queries, row changes and selection moves | Keep only a row index |
| P23 | Esc closes only the box and returns focus to its original tile, input or button | test | fc.array: opener kinds and source replacements | Restore focus to the last source's field |
| P24 | Cmd-K, Cmd-O and the project button use one palette slot; tiles are inert under it; no key or outside click reaches a covered tile | test | @demlik/tea/pbt.arbMsgSequence: accepted palette commands, source changes and closes | Add an independent projects modal flag |
| P25 | The project button has a chevron, `Project <name>, switch project`, dialog state and a full title | test | fc.record: project names and open or closed box state | Use an unnamed clickable span |
| P26 | File > Open Project… shows ⌘O; File > Open Folder… opens the sheet directly; the folder row has no ⌘O hint | test | vector: the decided menu labels and default Mac shortcut | Put ⌘O on Open Folder |
| P27 | Cmd-O on welcome focuses its first row without opening another box | test | fc.array: zero or more recent projects | Open a dialog over welcome |
| P28 | The box has a named dialog, combobox, listbox, valid active option and live result count; the system sheet opens after the box closes | test | fc.array: query, navigation, dismissal and folder-pick flows | Leave the count hidden or stack the sheet over the box |
| P29 | [secrets] Credentials never enter app records, host logs, spans, outgoing URLs, visible errors or public capture labels, including encoded forms | test | fc.record: made-up credentials, refusals, failures and generated operation orders | Leak a generated credential into each named output in turn |
| P30 | Project orientation fits the bar; the centered brand disappears first; the project button remains usable | test | fc.record: names, workspace counts and bar widths | Leave the project button out of the overlap check |
| E1 | The built Electron app opens two real temporary git projects, reaches the fake harness, switches, cancels, closes and restores without crossing their work | test | scenario: Playwright on Electron with two temporary git projects and the fake harness | Route both windows to one host |
| E2 | Each promised capture reaches its named layout and state through working keys and clicks | test | scenario: the five-layout capture matrix below | Capture a seeded DOM without opening a project |

Types hold the tagged cases and single palette slot. Existing lint rules hold imports, schemas, tokens and UI state rules. Do not add source-text tests for code shape.

Keep the existing summon permission and hidden-file checks. Replace the inherited-repository expectations in `start-host.summon.laws.test.ts` and `host/main.test.ts`; do not leave contradictory contracts.

## Files and ownership

Line counts below estimate changed or added lines, not final file size. The main files read are currently 552 lines in `main.ts`, 1,163 in `frame.tsx`, 964 in `frame.ts`, 990 in `desk.tsx`, 4,157 in `window.css` and 3,338 in `e2e.ts`.

All paths are repo-relative. New files are marked new.

| Files | Work | Approx. lines | Owner |
|---|---|---:|---|
| `apps/fabrika/src/project.ts`, new; `apps/fabrika/src/projects.ts`, new | Checked project, parent machine, session, opening and shared rows | 450 | build |
| `apps/fabrika/src/project-migration.ts`, new | Reserved, verified and recoverable desk move | 220 | build |
| `apps/fabrika/src/main.ts` | Menus, sheets, project windows, independent links, notices and lifecycle | 260 | build |
| `apps/fabrika/src/start-host.ts`; `apps/fabrika/src/host/main.ts`; `apps/fabrika/src/host/run.ts` | Explicit project, child validation, settings and shared credential location | 100 | build |
| `apps/fabrika/src/host/socket.ts`; `apps/fabrika/src/host/lock.ts`; `apps/fabrika/src/host/stop.ts`; `apps/fabrika/src/attach.ts`; `apps/fabrika/src/cli.ts` | Shared durable and runtime paths, project selection and recovery | 160 | build |
| `apps/fabrika/src/link.ts`; `apps/fabrika/src/wire.ts`; `apps/fabrika/src/host/serve.ts`; `apps/fabrika/src/messages.ts` | Checked project handshake and app-owned opening messages | 120 | build |
| `apps/fabrika/src/host/keybindings.ts`; `apps/fabrika/src/host/settings.ts`; `apps/fabrika/src/desk/keymap.ts`; `apps/fabrika/src/desk/keys.ts` | Shared save lock, hostless reading and configurable opening command | 110 | build |
| `apps/fabrika/src/window/frame.tsx`; `apps/fabrika/src/window/frame.ts`; `apps/fabrika/src/window/desk.tsx` | Tagged welcome route, project button, palette source and key/focus handling | 220 | build |
| `apps/fabrika/src/window/projects.tsx`, new; `apps/fabrika/src/window/pop.tsx` | Welcome view and shared project-row drawing in the palette | 240 | build |
| `apps/fabrika/src/window/window.css` | Welcome, button and project rows on existing tokens | 110 | build |
| `packages/fabrika/src/shell/summon.ts`; `packages/fabrika/src/agents/summon/manager.ts` | Folder-opening guidance, saved-folder refusal and project record context | 60 | build |
| `apps/fabrika/src/project.laws.test.ts`; `apps/fabrika/src/projects.laws.test.ts`; `apps/fabrika/src/project-migration.laws.test.ts`, all new | P1 to P12, P17 and P19 | 900 | tests |
| `apps/fabrika/src/host/project.laws.test.ts`; `apps/fabrika/src/host/settings.shared.laws.test.ts`, both new | Real host isolation, sockets, shared saves and record checks | 400 | tests |
| `apps/fabrika/src/window/projects.laws.test.ts`, new | Shared rows, welcome, selection and look checks | 220 | tests |
| `apps/fabrika/src/start-host.summon.laws.test.ts`; `apps/fabrika/src/host/main.test.ts`; `apps/fabrika/src/link.laws.test.ts`; `apps/fabrika/src/reconnect.laws.test.ts`; `apps/fabrika/src/launch.test.ts` | Replace old launch contract and retain handshake/reconnect behavior | 180 | tests |
| `apps/fabrika/src/window/frame.test.ts`; `apps/fabrika/src/window/frame.laws.test.ts`; `apps/fabrika/src/window/pop.test.ts` | Palette replacement, focus, roles and bar behavior | 220 | tests |
| `apps/fabrika/src/desk/keymap.test.ts`; `apps/fabrika/src/desk/keys.test.ts`; `apps/fabrika/src/host/keybindings.test.ts`; `apps/fabrika/src/keys/machine.laws.test.ts`; `apps/fabrika/src/keys/window.test.ts` | Opening binding, shared edits and keys editor regressions | 120 | tests |
| `apps/fabrika/src/host/host.test.ts`; `apps/fabrika/src/host/one-host.test.ts`; `apps/fabrika/src/host/stop.test.ts`; `apps/fabrika/src/host/restart.test.ts` | Adapt existing host checks to project homes and runtime paths | 100 | tests |
| `packages/fabrika/src/shell/summon.repo.laws.test.ts`; `packages/fabrika/src/agents/summon/manager.test.ts` | Actionable fallback and saved-folder checks | 80 | tests |
| `apps/fabrika/e2e.ts`; `apps/fabrika/summon-e2e.ts` | Real opening route, two projects, restore, assertions and capture steps | 320 | tests |
| `apps/fabrika/projects-e2e.ts`, new | The project capture driver that e2e.ts runs: layouts, migration and their waits | 1100 | tests |
| `apps/fabrika/docs/projects/`, new | Generated screenshots from the approved capture steps | images | build |
| `apps/fabrika/README.md` | Opening, switching, state locations and CLI use | 50 | build |
| `docs/plan/project-window.md`, new; `docs/plan/README.md` | Save this replacement plan and keep its state current | 40 plus this plan | lead |
| `docs/direction/a-window-is-one-project.md`, new; `docs/direction/project-window.md`; `docs/direction/brain-hands-window-agent.md`; `docs/direction/the-frame.md`; `docs/direction/README.md`; `.glossary/TERMS.md` | Bring the approved host decisions into the repo and update current descriptions | 100 | lead |
| `field/notes.jsonl`; `field/runs.jsonl` | Each hand-run step and its findings | 20 | lead |

The exam-path checker was run against the listed paths. Every matched path belongs to `tests`. The test writer also owns any required runner or exam changes discovered during the build. The builder owns product files and generated images.

The lead saves this unsigned draft and runs `plancheck.sh --draft` before approval. No tests, typecheck or app ran during planning. No files were written.

## Screenshots

Use Playwright on the real built Electron app, following `apps/fabrika/e2e.ts`. Each run gets its own short temporary `FABRIKA_HOME`. Keep quiet-launch behavior. Use temporary git repositories and the existing fake harness. Make no paid calls.

The test writer owns the capture steps and assertions. The builder runs them, inspects every image and saves the images under `apps/fabrika/docs/projects/`.

Capture each project state in dark and light at all five layouts:

- One tile filling the window.
- Two tiles side by side.
- Two tiles stacked.
- A 2x2 grid.
- A small 1024x700 app window.

The states are project opened, long or duplicate project name, fake agent summoned, second project with independent work, and restored work. Capture the projects box open over every layout too, including selection, filtering and an already-open project.

Capture welcome at normal and small sizes in both looks. Include empty recent history, populated history, selection and a rejected folder. Welcome has no tiles. Do not invent tiles for those shots.

Capture migration ready and failed, with working recovery actions. Use the five layouts when a project desk is visible; use normal and small when it is a page.

Name images `<state>-<layout>-<look>.png`. Use real project facts. Temporary fixtures are labeled as fixtures. Public paths are repo-relative, with no machine or account names.

Before each capture, verify tile count, placement, theme and state. Press the keys and clicks that reach it. The PR body shows the images and says what squeezes, clips or looks empty. Inspect the native menu, native title, window buttons and real 1024x700 window separately from page captures.

Run VoiceOver on welcome, project button, box selection/count, Esc focus return and the folder sheet. Keep any screen reader limitation explicit.

## How Linear would build these screens

These are inferences from Linear's [workspace controls](https://linear.app/docs/workspaces) and the repo's settled [frame](docs/direction/the-frame.md), [popover](docs/direction/popovers.md) and [project-window](docs/direction/project-window.md) notes. Linear is the builder on fabrika's pieces.

| Screen | How Linear would build it here | Where we differ and why |
|---|---|---|
| Welcome page | The frame owns one clear starting page. Recent projects and Open Folder share one list. No program starts before a project exists. | No sidebar or projects tile. A hostless tile contradicts the approved plan. The empty page must still work with keyboard and pointer. |
| Top-bar button | Put the current place where it can also be changed. Keep the name quiet, readable and clickable, with a chevron. Every project window gets it from the frame. | Fabrika keeps numbered workspaces, its tsh line and the centered brand. The brand gives way first. This preserves the decided frame. |
| Projects box | Reuse the palette, row drawing, focus handling and keyboard behavior. The app opens or focuses another project; the current desk stays intact. | A new folder takes an extra press after Cmd-O. The owner chose that tradeoff. Each different project opens another OS window. |

There is no new tiling clash with Tuval or tmux. Splits, workspaces, jobs and the prefix remain inside each project's host. The project box belongs to the window, so it is not another tiled program.

The existing tmux difference remains: the palette makes the desk inert, while the prefix and F6 keep the exits decided in `layers.md`. This ticket does not reopen that choice.

## Size and pull request order

Split into **two usable pull requests**, ordered by what the person sees first.

1. **Open and switch projects.** Ship the complete welcome page, recent list, name button, box and native menus. Include checked roots, separate hosts and ports, short sockets, safe migration, shared settings, records, correct counts and notification routing. Close and quit leave hosts alive. A launch without an explicit project offers recent projects; choosing one returns to its kept desk. Save restore data from this first PR.
2. **Reopen the last windows.** Add automatic launch and Dock restore through the same opening machine. Include partial failures, the final-window rule, active-window choice, minimized windows and restore screenshots.

PR 1 has no restore control, placeholder or dead action. Its manual opening flow is complete. PR 2 changes launch behavior to fulfill the remaining restore decision. Both PRs have their own tests, build, mutation check and review.

This split keeps the first visible flow together and gives quit/restore ordering its own review. The cost is two rounds of checks and overlap in the opening machine. Confidence in the split is **80%**.

Estimate **12 to 16 agent hours, 65% sure**: about 9 to 12 for PR 1 and 3 to 4 for PR 2. Allow roughly 2,050 product lines, 2,500 test/runner lines and 200 documentation lines, excluding the saved plan and images.

The approved plan's eight-hour estimate was 60% sure. This reading adds the real hostless path, palette row changes and complete A + C checks. Migration and Electron repair remain the largest doubts. The test writer's failure cases and first built captures will settle them. This is an estimate, not a measured result.

After approval, each PR runs the separate plan, tests, build, mutation and review steps. The lead reads the whole diff, checks CI and runs the public-data check before landing.

Use narrow capped tests while working, then the changed-file test run against `origin/main`. Run formatting, lint and one typecheck at the end. Never run the full local suite. Run one Electron app at a time. Mutation uses the fixed sample of about 150 with seed `119120`. The lead records step usage and cost in `field/`.

## What this cannot tell us

- Whether the extra press before a new folder becomes annoying. A week of use can answer that.
- Whether every historical saved desk loads. Unknown data must remain recoverable.
- Whether an interrupted external call can resume safely. Migration preserves saved work and does not replay calls just because a folder opened.
- How restore feels across multiple monitors or after a display disappears. The built-app check must cover those cases.
- How the new names and counts sound in VoiceOver. No screen reader ran during planning.
- Whether the time estimate holds. No implementation, tests or screenshots ran for this plan.

## Open questions

None.

The decided notes answer the product choices. The code supports one palette with a projects source. If the build finds that a second modal is required, that becomes an owner question before it is built. The lean stays one palette, **80% as recorded in the note**, because a second modal would change the settled layer rules.
Plan reformatted by the lead agent, 2026-11-09: format only (one heading level); the owner's approval stands

Amended by the lead agent, 2026-11-09: `apps/fabrika/projects-e2e.ts` gets a tests row. Earlier tests rounds already edited it; PR 603 began enforcing plan owners, and this file had none.
