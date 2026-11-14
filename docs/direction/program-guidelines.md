---
state: "decided 2026-11-03"
summary: "Both versions: `next/` from Tier 2's desk, today's asks popup as the example. How a program is built and how programs meet. Eight principles: one job and one model that every size draws (G1, decided 2026-11-03); a program says where it is (its `location`) and asks the desk with an `open` Cmd, never naming a tile; open or focus, then land beside; only on a press, with the selection traveling and one thing said; the way back is one key; programs meet on typed pipes; what every program gets for free from `commands`, the desk and the kit; a program's name is one short plain word with one meaning, and a phrase around it is written from the noun (G8, with five names for `asks`, the owner picks). Takes experiment 196's P1 to P8 as rules. Open: where focus goes when a tile you opened closes (the opener, reading order as decided, or the focus history tmux and i3 use), and a Linear peek against a tile. Composing, C1 to C11: one row type on the pipe, a `Schema.Union` of tagged cases kept below the programs; a tree goes flat (`Tree.fromRows`, `Tree.toRows`); a drawer has nothing of its own; a filter is a program; across lines a ticket goes by `open`; a fold two programs need moves below both; `notes` is the notepad you type in; the keys line comes from `commands`. Plus three splits of today's programs: one read-only reader below them, the tracker's ticket page goes after fix 1, and the asks list leaves the frame in `next/`. From experiments 198 and 201."
---

# Programs: one job, a location, and the desk places the tile

**Decided 2026-11-03.** G7's R5 was added and decided 2026-11-06, and call 6 the same day. The owner approved G1 to G8 and calls 1 to 5 with their leans, after a walk
of each part. Call 4 changed in its walk: both forms of `open` are the API, and the line form waits
on a follow-up to experiment 204. The leans' confidence numbers stay as written.
[Composing programs, C1 to C11](#composing-programs-c1-to-c11) was decided 2026-11-02. Calls 6 and 7 moved to experiment 206,
the customization study, and call 8 to experiment 207, the layers study. The asks program is named
**inbox** (G8 below, glossary walk); the sketches still say `asks`, which the rename pass changes.
The composing walk changed two of the rules, G6 R2 and G7 R4, and their text says so.

Names changed 2026-11-03 by the owner's naming pass: `at` became `location` (`AsksAt` became
`AsksLocation`, `reuse: "address"` became `"location"`), `query` inside a tile became `navigate`,
`Workspace.focused` became `recent`, `by: "history"` became `why: "recent"`, `left.to` and
`closed.focus` both became `focus`, `move {by}` became `move {delta}`, `glanceOf` became an inline
`select`, the row's `up` and `key` became `parent` and `id`, the `lines` output and `LineState`
became `rows` and `RowState`, call 1's `Tile.from` became `opener`, and `heirOf` became the words
"else reading order". `glance` stays.

It stands on these, decided before it and not asked again: a process never knows where its tile is, and a tile shows one process
([the desktop layer](./the-desktop-layer.md), W3 and W4); every command is also a tsh word and a
palette row (W5); a line opens in place and folds past 220 by 120
([fold, not tabs](./fold-not-tabs.md#a-line-opens-in-place)); a program declares its keys and modes
beside its commands ([keybindings](./keybindings-are-configurable.md#keys-and-modes-come-from-programs-not-packs),
[modes](./modes.md)); a closed tile's focus goes by reading order, and `C-b ;` returns to the tile
focused before ([tile guidelines](./tile-guidelines.md#a-tile-is-a-region)); the box decides what
crosses, never the program ([programs run in a box](./programs-run-in-a-box.md)).

Built from [experiment 198](../../experiments/198-program-guidelines.md), which read about 20 makers
and tools, four of them outside software, and checked today's asks popup against them, and a private
page, "Program guidelines", with a small fabrika window you can key and click through. Neither is a
measurement. It takes the eight patterns of [experiment 196](../../experiments/196-ask-desk.md#patterns-found)
(the ask desk, on [PR 326](https://github.com/usirin/tea-fabrika/pull/326), not merged), P1 to P8,
and makes them rules for every program.

**Where this note stops.** At a tile's edge. What is inside one tile (its edge, focus mark, title bar,
name, region, live regions, fold strip) is the [tile guidelines](./tile-guidelines.md)'. This note is
about what runs in a tile, how one program reaches another tile, and how the person gets back.

```ts
// A sketch, next/. The asks program in the new shape. Two fields are new: `location` and `reuse`.
// The rest is Tier 1's Program, plus `commands` from modes and `glance` (call 6, moved to experiment 206).
// (updated 2026-11-08 to Program.make: the machine is its own `export const machine = Machine.make(...)`)
const asks = Program.make({
	name: "asks",
	machine, view, refuse, inputs, outputs,          // Tier 1; outputs: {ticket}, for `| ticket`; msg is inferred from machine
	location: {data: AsksLocation, select: (m) => ({ask: m.selected})}, // where it is now
	reuse: "program",                                 // open or focus: one asks tile per workspace
	glance: {data: Glance, select: (m) => ({count: m.queue.length, ask: m.selected})}, // the popup
	commands: {
		next: {send: {type: "move", delta: 1}, keys: ["j", "down"]},
		rec: {send: {type: "answer", answer: {_tag: "rec"}}, keys: "y"},
		not: {send: {type: "against"}, keys: "n"},
		later: {send: {type: "later"}, keys: "h"},
		leave: {send: {type: "leave"}, keys: "escape"}, // only at its top level: see G5
	},
});

// The one way a program reaches another tile: a Cmd to the desk, as a line the person could type.
open({line: "asks --ask a-approve-8 | ticket", from: "t1", via: {_tag: "key", keys: "enter"}});
// the desk answers in words, never with a size
// {_tag: "opened", tile: "t5", how: "new", beside: "t1", folded: ["t6"]}
// {_tag: "opened", tile: "t5", how: "focused"}        a second open: no second tile
// {_tag: "refused", why: "no_press"}                  nobody pressed anything
```

```text
one sitting, traced (next/, a sketch)
C-b a        the top bar's popup: the asks program's glance    focus moves in: "Asks, 3. Approve plan version 2?"
  j          the glance moves the one selection                the asks tile, once open, shows the same ask
  Enter      Cmd open {line: "asks --ask a-approve-8 | ticket", from: "t1", via: key}
             the desk: no asks tile on workspace 1             starts the line; asks in t5 after t1, ticket in t6
             t6 would be under 220px wide                      t6 folds to a strip; t5, the one asked for, stays open
             opened {tile: "t5", how: "new"}                   focus to t5, on a-approve-8; the popup is gone
             the bottom line                                   asks opened in t5, beside t1 · folded t6
  y          answered {answer: {_tag: "rec"}}                  polite: "approve, the rec, for #117. 2 left."
  Esc        at t5's top level: Cmd leave                      focus back, by the focus history (call 1, decided C)
C-b a, Enter again                                             opened {tile: "t5", how: "focused"}
```

## Which version

- **`next/`:** all of it. Programs exist from Tier 1 (`Program` on
  [PR 223](https://github.com/usirin/tea-fabrika/pull/223): name, machine, msg, view; Tier 1 adds
  refuse, inputs and outputs). The desk, which carries out `open`, `leave` and the way back, arrives
  as a program in Tier 2 ([tiers](../plan/tiers.md)). The asks program and its glance come in Tier 5.
  So `location` and the focus history go in with Tier 2's desk, and every program written from then
  on says its location.
- **Today's version (`apps/fabrika`, `programs/*`):** not changed by this note. Today's asks popup
  and its `Enter` are the running example, read on main at `0be502bc`. Four small fixes are offered at
  [a tryout in today's version](#a-tryout-in-todays-version), none filed.

## The shape

```ts
// A sketch, next/. What a program adds: a location, and how open or focus finds its tile.
type Program<S, M, V, T, L> = {
	// name, machine, msg, view, refuse, inputs, outputs: Tier 1. mode, commands: modes.
	readonly location?: {readonly data: Schema.Codec<L, unknown>; readonly select: (tile: T) => L};
	readonly reuse?: "program" | "location";           // left out: "program" (call 2)
	readonly glance?: {readonly data: Schema.Top; readonly select: (tile: T) => unknown}; // call 6
};

// The desk's Cmds, the same for every program. Each is granted, as any start power is (Tier 1, call 20).
// Two forms, one Cmd (call 4). The program form ships first; the line form waits on its follow-up.
const Open = Schema.Union([
	Schema.Struct({program: ProgramName, location: Schema.Unknown, from: TileId, via: Via}), // the program's own location.data decodes it
	Schema.Struct({line: Line, from: TileId, via: Via}),        // Line: what tsh's fit check takes
]);
const Opened = Schema.TaggedUnion({
	opened: {tile: TileId, how: Schema.Literals(["new", "focused", "moved"]),
		beside: Schema.optional(TileId), folded: Schema.optional(Schema.Array(TileId))},
});
const open = Cmd.make("open", {
	input: Open, ok: Opened,
	err: ["no_press", "no_program", "bad_location", "bad_line", "not_allowed"],
});
const leave = Cmd.make("leave", {input: Schema.Struct({from: TileId}), ok: Schema.Null, err: []});

// What the desk keeps, per workspace, to answer "back": the tiles in the order they were focused.
type Workspace = {layout: Split; focus: TileId; recent: ReadonlyArray<TileId>}; // newest first
```

- **Checked by reading, not by `tsc`.** `Via` is the keybindings note's (`key`, `palette`, `word`,
  `click`). `Line` is what tsh already types and checks. `ProgramName` is a name by G8's rules; the
  desk refuses one it does not know (`no_program`) and a location the program's own `location.data`
  does not decode (`bad_location`). `Workspace` is the desktop layer's, with one
  new list, `recent`, which `C-b ;` needs anyway (tile guidelines, "a fact stored from the first
  build").
- **`location` is read from the tile's own machine,** as a mode is ([modes](./modes.md), M2): which
  ask is open is one window's fact, not the shared program's. Its type is always named for its
  program, as `AsksLocation` is, never a bare `Location`, which is the DOM's global.
- **`open` is a Cmd, not an output.** [Tracker views](./tracker-views-are-programs.md#8-the-views-the-facts-and-the-column)
  proposed an `open` output the desk hears. An output is "heard once, by whoever listens" and has no
  answer ([tea-program](./tea-program.md)); the desk must be able to say no, and the opener needs to
  know which tile it got. A Cmd has an `ok` and an `err` (Elm: a one-shot action is a Cmd,
  [Elm first](./elm-first.md)).

## The eight principles

### G1: one job, one model, and every size draws it

**Decided 2026-11-03. Lean, 80%.** The owner took the lean.

- **What it means.** A program does one job and owns its model. Each of its views (a glance in the
  top bar, a full view in a tile, a box inside another program's view) is a `select` on that one
  model. Answering in one is answering in all, and moving the selection in one moves it in all.
- **Rules.** R1 one job: the asks program owns the queue, the selection and the answer, and nothing
  else (Unix). R2 one program, many sizes: 196's P6, lean 75%. R3 a list and a detail fold to one pane
  under about 520px: 196's P7, lean 70%. R4 a second list of the same thing is a bug: it moves into the
  program, lean 80%.
- **Why.** "Write programs that do one thing and do it well" [x6]. Ableton: "The Session and
  Arrangement share the same set of tracks" [f1]. Elm: "all modules should be built around a central
  type" [e2].
- **Linear as the builder.** They define "the behaviors of the main components of the app" once
  [m8], so an issue reads the same in a list, a peek and its page. On our pieces that is one asks
  program whose row, detail and action bar are the same in the popup, the tile and the ticket's ask
  box, and a ticket drawn by the ticket program, never a copy inside asks.
- **Elm.** One model, many views. A view is a function of the model; a smaller size is another
  function, not another model.
- **Accessibility.** WCAG 3.2.4: the same function is "identified consistently" [w2], so `y` is "Take
  rec" in every size.
- **What holds it.** `glance.select` and `view.select` take the same model type, so a glance cannot
  keep a state of its own. A law: an answer in the glance shows in the tile's next view.
- **Doubt and cost.** Whether `y` in a small popup is safe for a plan, as 196 asked. A program with
  three views costs two more `select`s and their tests.
- **Today: breaks.** The asks list is the frame's menu (`apps/fabrika/src/window/frame.tsx:433`); the
  ask box is the tracker's (`programs/tracker/src/window.tsx:783-826`). Two codes, and the menu cannot
  answer.

### G2: a program says where it is; the desk says where its tile is

**Decided 2026-11-03. Lean, 80%.**

- **What it means.** Every program has a `location`: a small value that says where it is, as a URL
  does. Its flags start it there (`asks --ask a-approve-8`). Inside its tile it moves with
  `navigate`, and the tile keeps a back stack of locations (ticket 7). To reach another tile it asks
  the desk with `open`. It never names a tile, a size or a side.
- **Rules.** R1 a location is data, lean 80%. R2 inside a tile, a program moves with `navigate`, and
  back returns, lean 80% (tracker views, ticket 7). R3 across tiles, a program asks with `open`,
  and the desk answers in words, lean 85%. R4 an open names a program and a location, or is a
  line the person could have typed, checked the same as typing it (call 4, decided).
- **Why.** Plan 9: "Most applications work fine in a plumbing environment without knowing about it at
  all" [x3]. Android sends an intent, not a window [x4]. Our desktop layer already says a process
  "never knows where its tile is".
- **Linear as the builder.** Every Linear page has a URL, and one command menu opens "pages or run
  actions" [l6]. On our pieces: every program has a location, so the palette, back, saved state and a
  link in a comment can all reach it; and `open` is the one way a program asks for a tile. Where we
  differ: Linear's router owns the whole screen; our desk owns placement, and the program never sees
  a tile.
- **Elm and OTP.** Elm's `Browser.application` turns a URL into a route and moves with `pushUrl`;
  `location` is the route and `navigate` the push. OTP: send to a registered name, the desk, never
  to a pid you guessed [o1].
- **Accessibility.** The location names the tile for a screen reader: `asks, t5, ask 1 of 3`, beside
  the tile guidelines' `tileName`. WCAG 2.4.3, focus order keeps meaning.
- **What holds it.** No tile id or pixel size in any program type. The program form's location is
  decoded by that program's own schema (`bad_location`). The line form takes a `Line`, so tsh's fit
  check refuses a line whose pipes do not fit before anything starts (`bad_line`).
- **Doubt and cost.** Whether every program has a location worth keeping (a tsh tile's is its
  line). One field per program and one schema.
- **Today: half.** The tracker takes a `query` (`frame.tsx:452`), a location in all but name;
  `next/` calls it `navigate`. The frame, not the desk, picks the tile, and the asks list has no
  location.

### G3: open or focus, then land beside

**Decided 2026-11-03. Lean, 80% on open or focus; 65% on where it lands.**

- **What it means.** The desk looks first: a tile on this workspace that shows the same program (or
  the same location, by `reuse`) is focused, unfolded and taken out of a zoom, and sent the new
  location with `navigate`. Only if none is found does the line start, beside the focused tile.
- **Rules.** R1 open or focus: 196's P1, lean 90%. R2 what counts as the same: `reuse`, lean 65% (call
  2). R3 where it lands: half of the focused tile's share, after it; in a row a sibling, in a column a
  new nested row; a zoom ends first: 196's P2, lean 65% (call 3). R4 the one asked for stays open: past
  220px, the line's other windows fold first, then the others in its row, the opener last: 196's P2,
  lean 70%. A folded window's space goes to the open tile before it, so the asks tile takes what its
  ticket gave up. The demo's first draft spread that space over the whole row, and a side-by-side
  desk then folded an unrelated tile too; giving it to the neighbor folds only the ticket, in every
  layout the demo has, at 1440x900 and at 1024x700.
- **Why.** Emacs's first try "tries to display buffer by finding a window that is already displaying
  it" [x1]. OTP's start answers `already_started` with the pid [o1]. i3: "Get me to the next open VIM
  instance" [k3], and a new window goes "beside the existing window" [k3].
- **Linear as the builder.** Linear has one triage page per team, so it never makes two. On our pieces
  open or focus is one piece of the desk that every program gets, with one field to say what counts
  as the same. Placement is tmux's and i3's, not Linear's: Linear does not tile (W5). Where Linear's
  answer clashes, see call 7, moved to experiment 206.
- **OTP.** `whereis` then `start_child`, in one step so two presses cannot race into two tiles [o1].
  The desk is the registry.
- **Accessibility.** WCAG 2.4.11: a focused tile "is not entirely hidden" [w2]: focus never lands on a
  strip or under a zoom.
- **What holds it.** Two laws on the desk: after any `open`, at most one tile per `(program, reuse
  key)` on a workspace; and the focused tile is never folded or covered by a zoom.
- **Doubt and cost.** 196's: side by side in a 2x2 gives a 355px tile, one pane. About 150 lines with
  laws in the desk, 3 agent hours.
- **Today: half.** The focus half exists: `go` focuses a tile and ends a zoom (`desk.ts:548-556`), and
  `opensOf` finds the tile that shows the ticket (`frame.ts:365-374`). The open half says "nowhere".

### G4: only on a press; focus and the selection travel together; say it once

**Decided 2026-11-03. Lean, 85%.**

- **What it means.** Nothing opens or takes focus unless the person pressed or clicked something just
  before. A new ask is a count in the top bar, never a tile. When a press does open, the popup closes,
  the new tile takes focus on the same selection, and the person hears one thing.
- **Rules.** R1 only on a press: an `open` carries the `via` of the press, and the desk refuses one
  with none (`no_press`), lean 85%. R2 the handoff: 196's P3, lean 85%. R3 what is said: the focus move
  speaks for itself; an answer is a polite status; the bottom line names the tile: 196's P5, lean 80%.
  R4 one letter per move, with `from` and `via`, lean 85% (what the ledger records).
  One exception to R2, decided 2026-11-03 in the [layers](./layers.md) walk (call 2): a peek opens
  the tile beside and leaves focus on the list; Enter still moves focus in.
- **Why.** WCAG 3.2.1, focus "does not initiate a change of context" [w2]. i3 gives a window out of view
  "the urgency hint" instead of focus [k3]. The dark cockpit: when all is well, "all annunciators on
  the overhead panel will be extinguished" [f4].
- **Linear as the builder.** Linear's inbox counts and never opens on its own; Enter opens and Space
  peeks (**secondary**, [l6]). On our pieces: the top bar's count is the only signal, `Enter` is the
  only open, and the selection is one model, so there is nothing to hand over.
- **Elm.** No Cmd without a Msg: an update runs only on a message, and the press is that message. The
  desk checks that a press is behind the Cmd, since Msgs from a window may be late
  ([Elm first](./elm-first.md), a program may say no).
- **Accessibility.** 3.2.1, 3.2.2 and 3.2.5 (change on request, AAA) [w2]; 4.1.3 for the polite
  status. Needs a real VoiceOver run: whether the new focus and the polite status are both read, and
  in which order (196).
- **What holds it.** `open`'s `err` has `no_press`. A law: no step that is not a press moves focus.
- **Doubt and cost.** An agent asking to show its work in a tile (Tier 5) has no press behind it; it
  asks through the top bar, like an ask. About 40 lines in the desk.
- **Today: half.** Only a press moves focus, and a new ask is a dot (`frame.tsx:191,268`). But no
  selection travels, and a `go` is not said.

### G5: the way back is one key, and it works the same in every program

**Decided 2026-11-03. Lean, 70%, on the rules. The close is call 1.**

- **What it means.** `Esc` peels a program from the inside out: a note, then a picked part, then the
  one-pane detail. At its top level a program may send `leave`, and focus goes back. Between tiles,
  `C-b ;` always returns to the tile focused before. Inside a tile, back walks its own locations.
- **Rules.** R1 `Esc` peels; at the top a program may bind `leave`: 196's P4, lean 70% (call 5). R2
  closing a tile: the clash, call 1. R3 `C-b ;`, the tile focused before: decided in the tile
  guidelines, and its history is recorded from the first build. R4 back inside a tile: ticket 7, lean
  75%.
- **Why.** Emacs's `display-buffer` "saves information about what it did in the window's quit-restore
  parameter" [x1]. tmux: "Select the last (previously selected) pane" [k2]. APG: "When a dialog closes,
  focus returns to the element that invoked the dialog" [w4].
- **Linear as the builder.** Linear has one stack, the browser's, and `Esc` closes a peek back to the
  list. On our pieces there are two scopes: back inside a tile (ticket 7) and back between tiles (`C-b
  ;`), each one key, the same in every program, because the desk owns both.
- **OTP.** No OTP answer for focus. The desk monitors a tile's process and hears `DOWN`; what it
  focuses next is our rule.
- **Accessibility.** 2.4.3, focus order [w2]; 2.1.2, no keyboard trap: the prefix and F6 work in every
  program (modes, M4).
- **What holds it.** The `recent` list on a workspace, and one function that picks where focus goes.
  A law: a close never leaves focus on nothing.
- **Doubt and cost.** Under 80%: a person who closes the asks tile after answering may want the ticket
  beside it, not the opener (196). About 40 lines for the list and `C-b ;`, 1 agent hour.
- **Today: half.** A popover puts focus back (popovers, rule 3). Between tiles, `C-b ;` is not built
  (`apps/fabrika/src/desk/keys.ts:80-113`), and a close goes by reading order (`desk.ts:415`).

### G6: programs meet on typed pipes, never by calling each other

**Decided 2026-11-03. Lean, 85%.**

- **What it means.** A program never imports, starts or calls another program. It sends an output;
  a line wires it. The ticket follows the asks on a pipe, `asks | ticket`. Each program also runs
  alone, from its flags.
- **Rules.** R1 no calls between programs, lean 85%. R2 the ticket follows on a pipe inside one line
  only, lean 80% (196's "the ticket tile follows by pipe"); across lines, a ticket goes by `open`
  (C6, decided 2026-11-02), since a pipe joins one chain and cannot fan in. R3 one program runs alone and in a line, lean 85%
  ([agents are programs](./agents-are-programs.md): `claude` opens a window by hand and prints in a
  pipe, as `isatty` splits it). Closing one window ends one process: decided
  ([fold, not tabs](./fold-not-tabs.md#a-lines-windows-close-one-by-one)).
- **Why.** "Write programs to work together" and the "Rule of Composition" [x6]. A Eurorack module
  patches into any other because the standard is tiny: "1 volt" per "one octave" [f2].
- **Linear as the builder.** Linear is one app with one model, so it has no pipes. Its issue view is
  one component, used in triage, inbox and peek [m8]. On our pieces that is the ticket program on a
  pipe beside the asks, not a second ticket view inside them.
- **Elm and OTP.** Two Elm programs share nothing and meet through ports; OTP processes share nothing
  and meet through messages. tsh lines are the one named exception in [Elm first](./elm-first.md).
- **Accessibility.** 1.3.1, relationships in words: the region's name says `pipe A, 1 of 2, sends to
  ticket` (tile guidelines).
- **What holds it.** It should be `layer-rules.json`: a program package imports no other program
  (`pnpm lint`). Today it is not: the file has one `programs` layer, so nothing checks it (experiment
  201's audit). The fit check refuses a pipe whose types do not match.
- **Doubt and cost.** Closing the asks tile leaves the ticket tile, as the pipe rules say; a person
  who wanted both gone presses twice. Nothing new to build.
- **Today: half.** The pipe follows for `tracker | ticket | runs` (`programs/ticket/src/index.ts:23`),
  but `ticket`, `runs` and `map` import `@tea-fabrika/tracker` and run its whole machine (their
  `package.json`s; experiment 201's audit, split 1). The asks list is on no pipe.

### G7: what every program gets for free

**Decided 2026-11-03. Lean, 80%.**

- **What it means.** A program writes its model, its views and its commands. The rest comes from the
  desk and the kit, the same in every program.

```text
a program writes          it gets, written once for all
commands                  the action bar's buttons with each key on them (P8), palette rows, tsh words,
                          rows in the key file, the keys panel, aria-keyshortcuts
mode(state)               the mode's word on the bottom line and the title, its status line, Esc out (modes)
location                  open or focus, back inside the tile, C-b ; between tiles, a saved place
its views                 the tile's frame, name, region, empty word and focus home (tile guidelines)
its machine               a process id, a trace, saved state, hot reload, a job to attach to
                          (agents are programs, saved state, hot reload)
```

- **Rules.** R1 the buttons come from `commands`, so a key and its button cannot drift: 196's P8, lean
  75%. R2 the desk's pieces are not the program's: lean 85%. R3 the kit holds view helpers, not parts
  that keep state: list and detail, the row, the action bar, lean 75%. R4 what two programs both need
  moves below both: a view piece into the kit, and a fold into the domain package (C9, decided
  2026-11-02), lean 80% ([reuse before special rules](../../.decisions/0421-reuse-before-special-rules.md)).
- **R5, things to find (decided 2026-11-06).** A program hands the desk the rows it can be found by,
  as a pure function of its model, the way `view` is one. The desk keeps one index, matches and ranks
  once for every program, and keeps the last rows of a program that is not running. Picking a row is
  `open program location` (G3). The other way, the desk asking each program on every key (VS Code's
  workspace symbols), was weighed and lost: every program would match its own way, and the box waits
  on the slowest. The known way is Apple's Spotlight, where apps hand their items to one index
  ([Core Spotlight](https://developer.apple.com/documentation/corespotlight)).

  ```ts
  // a sketch
  index: (model: Model) => ReadonlyArray<SearchableItem>
  // SearchableItem (Core Spotlight's word): {location: "#193", title: "lane stalls at the test writer", hint: "running"}
  ```

  Still open: whether Cmd-K is one box for commands and things (Linear's command menu), lean 70%,
  commands first; and how a program with thousands of rows does, which only a test with real numbers
  settles.
- **Why.** VS Code: "By default, commands show in the Command Palette", and a contributed key shows in
  the shortcuts list [x5]. Ableton's Key Map mode: "assignable elements of the interface become
  highlighted" [f1]. A cockpit's soft keys ring the page they act on [f4]. Elm: "Just write the helper
  functions you need" [e2].
- **Linear as the builder.** Linear's command menu lists every action with its key, and its main parts
  behave one way everywhere [m8]. On our pieces that is `commands` feeding every surface, and the
  list-and-detail, row and action bar as view helpers any program calls with its own model.
- **Elm.** The kit is helpers around a type, not components with their own state [e2]. Where we leave
  Elm: the desk gives open or focus and the keys from outside the program, as Elm's runtime gives
  `Browser.application` its URL handling.
- **Accessibility.** 2.1.1, every command by keyboard; 2.5.3, a button's name holds its visible text;
  3.2.3, the same parts in the same place [w2]; `aria-keyshortcuts` only names the key [w5].
- **What holds it.** No program writes a footer of keys by hand: the action bar takes `commands`. A law:
  every command has a palette row and a tsh word.
- **Doubt and cost.** Whether a program with many commands wants all on its bar: a `bar: true` per
  command would pick. About 200 lines for the kit, 3 agent hours, in Tier 2.
- **Today: half.** Every tile gets its frame and name. The popup's footer is typed by hand
  (`frame.tsx:421-426`), and the palette lists the desk's commands only (`frame.tsx:968-973`).

### G8: a program's name

**Decided 2026-11-03. Lean, 75%.** The owner walked it on 2026-11-03 and took the lean.

```text
where one name shows (both versions)
tsh line          asks --ask a-approve-8 | ticket
title bar         asks
accessible name   asks, t5, pipe A, 1 of 2, sends to ticket       tile guidelines, tileName
top bar item      3 asks                                          a phrase made from the noun
```

- **What it means.** The name is the word a person types, reads in the title bar and hears first on
  entering the tile. It is one word with one meaning, and it says what is in the tile.
- **Rules.** R1 a noun for what the tile shows (`jobs`, `runs`), plural for a list and singular for
  one (`experiments`, `experiment`), or a verb for a tool that does one thing to its input
  (`compare`, as Unix's `diff`), lean 80%. R2 short and whole: small letters, about 2 to 9 of them,
  no abbreviation, lean 70%, advice only. R3 one meaning: no tsh built-in, stage, stream, state word
  or Cmd already has it, checked with `rg` under `docs/direction/` and `next/`, lean 85%. R4 a phrase
  around the name is written from the noun, never by gluing a number or a verb onto the name, lean
  75%.
- **Why.** POSIX: "Utility names should be between two and nine characters", in "lowercase letters"
  and digits ([Utility Syntax Guidelines 1 and 2](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html)).
  tmux names a window by what runs in it: its default rename format reads `#{pane_current_command}`
  ([tmux(1)](https://man.openbsd.org/tmux.1), `automatic-rename`). A Neovim plugin sets "a custom
  'filetype'" on its buffers ([lua-plugin](https://neovim.io/doc/user/lua-plugin/)), but plugins
  often take brand names (Telescope) that say nothing, which R1 rules out. VS Code: "Keep the length
  of names to a minimum" ([views](https://code.visualstudio.com/api/ux-guidelines/views)), and its
  views are plain nouns, Explorer, Search, Extensions ([UI](https://code.visualstudio.com/docs/getstarted/userinterface)).
  macOS names an app for what it holds: Reminders, "to track and organize your to-dos"
  ([guide](https://support.apple.com/guide/reminders/welcome/mac)).
- **Linear as the builder.** Its sidebar is plain nouns: "The Inbox is your notification center"
  ([Inbox](https://linear.app/docs/inbox)); "Triage is a special inbox for your team"
  ([Triage](https://linear.app/docs/triage)). On our pieces the program's name is that sidebar word
  and the tsh word at once.
- **Elm and OTP.** Elm: "Use human readable names", and a module name does not come back in its
  functions ([design guidelines](https://package.elm-lang.org/help/design-guidelines)): asks'
  commands are `next` and `rec`, never `askNext`. OTP's example registers a server under its
  module's name, `gen_server:start_link({local, ch3}, ch3, [], [])`
  ([gen_server](https://www.erlang.org/doc/system/gen_server_concepts.html)). Ours too: the tsh
  word, the tile's name and the desk's `reuse` key are one word.
- **Accessibility.** The name opens every tile's accessible name and its region label, so a landmark
  list is a list of program names (tile guidelines). WCAG 2.4.6: labels "describe topic or purpose";
  2.5.3: the visible name is inside the accessible name. An abbreviation is spelled out or said
  wrong by a speech engine. Needs a VoiceOver run on `tsh` and `ps`.
- **What holds it.** Code already refuses a built-in's name, two programs with one name, and any
  letter but small letters, digits and `-` (`packages/fabrika/src/shell/programs.ts:23-33`). R1 to R4
  are taste, checked on every pull request with the industry's names rule and `rg`.
- **Doubt and cost.** R2's 9 is an old POSIX shell number, so it is advice: two names here break it.
  Nothing to build.

Today's names against it, one line each:

```text
compare       keep: a verb, as diff
counter       keep: a demo
experiment    doubt: 10 letters, and one letter from experiments, so a slip opens the other
experiments   doubt: 11 letters; the pair is R1's own example, so R2 gives way here
map           doubt: also Effect's map, a wayfinding map and a Map; it shows the programs' wires
markdown      keep: the format is the job
pipeline      doubt: also the package @kampus/pipeline and the whole chain of stages
runs          keep
ticket        keep
trace         keep: OpenTelemetry's word
tracker       keep: issue tracker; but its machine's drawing says tickets (src/index.ts:158)
tsh built-ins keep: jobs, ps, tell, close, stop, attach, programs, help, exit; tell is ours
asks          now `inbox` (decided 2026-11-03, below); the top bar glued a verb on it, "1 asks you"
```

**The running example: `inbox`.** Today it is the frame's menu, not a program (G1); in `next/` it is
the inbox program (Tier 5). **Decided 2026-11-03** in the glossary walk
([`.glossary/TERMS.md`](../../.glossary/TERMS.md), inbox in the tracker): the asks program is named
**inbox**, as Linear's Inbox, "your notification center" ([Inbox](https://linear.app/docs/inbox)).
It is a person's list of things waiting, the open asks first, and the owner's desk is the inbox.
This reverses this note's earlier ruling that `inbox` was out because a ledger stream is called an
inbox: [We follow DDD](./we-follow-ddd.md) decided that a word has one meaning inside its own
context, so the ledger keeps `inbox` for the stream and the tracker uses it for the list, and the
context map names the boundary. The count's item is written from the noun (R4).

```text
name    top bar     its accessible name        what the word means here
inbox   3 in inbox  "inbox, 3 wait on you"     tracker: a person's list of things waiting; ledger: a stream
```

- **Why not `asks`, `questions`, `decisions` or `waiting`.** `asks` was the first lean (45%), but
  "an ask" is office slang, and an ask is what an agent or a step puts to a person, which the inbox
  lists. `questions` would clash with the close question, `decisions` with the review stage's
  rulings, and `waiting` is an adjective that breaks R1.
- **What it costs.** Words and one rename pass over the ask desk, this note and the app; the item's
  label gets its R4 fix whatever the name. Nothing is built.

## The smaller calls

### 1. Where focus goes when a tile you opened closes

**Decided 2026-11-03: C, the focus history. Lean C, 65%.** It reopens the 2026-11-01 reading-order rule (B) for every close; A and B stay as the options weighed.

```ts
// A: the opener. A new fact on the tile, written at open time.
type Tile = {id: TileId; shows: Pid; opener: TileId | null};
closed("t5") // focus -> t5.opener if open, else reading order

// B: reading order, as decided in the tile guidelines (today's close, desk.ts:415).
closed("t5") // focus -> the next open tile after t5, else the one before

// C: the focus history, as tmux's window_lost_pane and i3's con_next_focused do.
closed("t5") // focus -> the newest tile in workspace.recent that is still open, else reading order
```

- **A, the opener (196's P4).** APG's dialog rule and Emacs's `quit-restore` [w4][x1]. Cost: a second
  close rule beside reading order, and an `opener` that goes stale when the opener closes first.
- **B, reading order (decided 2026-11-01).** Predictable with no memory, one rule. Cost: after
  answering asks, focus lands on the tile after the asks tile: its ticket when that is open, else the
  next tile in the row. The line opens after the opener, so B never gives the opener back. The demo
  shows it in all four layouts, at both window sizes.
- **C, the focus history.** What our declared defaults do: tmux takes the front of `last_panes`, then
  the pane before, then after [k5]; i3 walks its focus stack [k6]. It gives the opener back in the
  common case with no rule per program, and it is the same list `C-b ;` reads. Cost: it changes a
  decided rule for every close, and the history can point somewhere old after a long time in one tile.
- **Why C.** It matches tmux and i3, which AGENTS.md names as the defaults for tiling, and it needs no
  fact beyond the one the tile guidelines already store. **Doubt:** the owner chose reading order
  knowing it; nobody has pressed the three. The page's demo has all three; a week of use settles it.

### 2. What counts as the same tile

**Decided 2026-11-03. Lean `reuse: "program"` by default, 65%.**

```ts
reuse: "program"   // one tile of this program per workspace; a new location goes to it by navigate
reuse: "location"  // one tile per location: ticket #7 and ticket #8 side by side
```

- "program" is Android's `singleTask` and i3's criteria focus [x4][k3]; "location" is Vim's
  `useopen` per buffer [x2]. **Doubt:** reusing loses the old place, which Android warns about [x4];
  the tile's own back stack (G5 R4) keeps it. A person can always split and type a second.

### 3. Where a new tile lands

**Decided 2026-11-03. Lean "beside, half the focused tile's share", 65%** (196's P2).

```text
beside      half of the focused tile's share, after it      keeps the rest of the desk as it was
column      the whole column the focused tile is in          a full list and detail in a 2x2; hides more
zoom        the new tile zoomed                              all of it; hides everything else
```

### 4. An open is a program and a location, or a line

**Decided 2026-11-03: both forms are the API.** The lean was "a line", 75%; the owner kept both. An
earlier draft here said the lean "a line" was taken, which was wrong.

```ts
open({program: "inbox", location: {ask: "a-approve-8"}, from, via}) // ships first
open({line: "asks --ask a-approve-8 | ticket", from, via})          // ships when its bar is met
```

- **The line form's bar.** A typed line gets the same type check and the same error words as typing
  it in tsh. A line built at run time goes through `unchecked(line)`, and the desk checks it.
- **Where it stands.** [Experiment 204](../../experiments/204-typed-lines.md) got the same words on
  37 of 40 fixed lines. The 3 gaps are checks the type cannot see: `ticket --ticket 0` and
  `ticket --ticket 1.5` (an integer, at least 1) and `asks --ask a-approve-1.5` (the `AskId`
  pattern). The compiler lets those through and the run-time check refuses them, never the other
  way. A follow-up experiment closes them, and the line form waits on it to ship.

### 5. `Esc` at a program's top level

**Decided 2026-11-03. Lean "a program may bind `leave`", 70%.**

```text
a program binds it     asks: Esc at the top goes back; a terminal keeps Esc for vim
the desk always        breaks every terminal program that uses Esc
never                  only C-b ; goes back; Esc at the top does nothing
```

### 6. A glance view in the top bar

**Moved to experiment 206, the customization study (2026-11-03). Not decided here.**

**Decided 2026-11-06 (the product walk, step 4).** The top bar's glance is a slot a program fills.
Any program may offer a glance view; the person picks which program fills the slot, and the default
is `inbox`. Its quick look and its tile read one queue (G1: one model, every size draws it). How many
slots, and where the person picks, stay with the customization study.

**Lean "any program may have one; the person picks which show", 65%** (196's flag).

- It changes the program shape by one optional view. Tracker, runs and spend could each want one.
  **Doubt:** a top bar with four glances is noise; one, the asks, may be all a person keeps.

### 7. A look over the desk, or a tile beside

**Moved to experiment 206, the customization study (2026-11-03). Not decided here.**

**No lean, the owner picks. It is a clash with Linear.**

```text
Linear's answer   Space peeks over the list; Esc closes it; the list stays focused  [l6], secondary
tmux and i3       a look is a split, or nothing                                      [k2][k3]
fabrika today     a popover is the only thing over the desk (popovers)
```

- A peek would be a glance in a popover, never a tile; anything you work in is a tile. Taking Linear's
  peek means a second kind of thing over the desk, beside popovers.

### 8. Is a side panel a program?

**Moved to experiment 207, the layers study (2026-11-03). Not decided here.**
[Layers](./layers.md#8-is-a-side-panel-a-program) records it as still open; it waits on a day of use
with `ticket | trace`.

**Lean, 65%, a guess until it is walked:** a block about the same thing is a section of that
program's view; a block about another thing is another program's tile.

```text
ticket's properties    same thing (this ticket's own folds)    a section of ticket's view
live agent panel       another thing (a run, trace's job)      ticket | trace, two tiles
```

- **Why:** G1 (one job per program) and G6 (programs meet on typed pipes). The guidelines skill
  already turns a sidebar that opens a detail into its own tile. Linear's issue sidebar holds that
  issue's own properties, which is the same thing.
- **Where it meets a note:** [tracker views](./tracker-views-are-programs.md) (proposed) puts both
  a properties panel (5.2) and a live agent panel (5.4) inside the ticket's view. Under this lean
  the first stays as a section and the second becomes a tile.
- **The word:** no part of the frame is called a panel (the glossary walk, PR 362). Whether
  "panel" names anything inside a view waits on this call, now experiment 207.
- **Doubt:** a ticket that always opens with its run beside it is two tiles every time. A day of
  use with `ticket | trace` would settle whether that is noise.

## Composing programs: C1 to C11

**Decided 2026-11-02.** The owner walked each rule, the count's label and the audit's three splits,
and took each lean. The confidence numbers stay as written, and each doubt names what settles it.

Built from [experiment 201](../../experiments/201-composing-programs.md): an outline and a board,
split into small programs joined by pipes and shot in today's app, and a read-only audit of where
one of today's programs holds a second program's job. Neither is a measurement. The rules hold in
both versions. Today's code moves to them only when a daily fix or a tryout touches it; `next/`
builds them from the start.

```text
tracker --all | outline | ticket       a source sends rows, a drawer draws them, Enter sends a ticket on
asks | board --by whose | ticket       another source, another drawer, the same row type and the same ticket
tracker --all | notes | outline        notes is a filter here: rows in, rows out
```

### C1: one row type on the pipe, kept below the programs

**Decided 2026-11-02. Lean, 80%.**

```ts
// A sketch. One Schema.Opaque per kind of row, each a Schema.TaggedStruct, joined in one Schema.Union.
// Effect Schema writes `_tag`. Never `kind`. The tags are decided; the class names and the fields
// (round 2's row, experiment 201) are not, and get settled when the code is written.
class TicketRow extends Schema.Opaque<TicketRow>()(
	Schema.TaggedStruct("ticket", {
		id: Schema.String, parent: Schema.NullOr(Schema.String), text: Schema.String,
		ticket: TicketNumber, state: RowState, sub: Schema.String, meta: Schema.NullOr(Schema.String),
	}),
) {}
class NoteRow extends Schema.Opaque<NoteRow>()(
	Schema.TaggedStruct("note", {id: Schema.String, parent: Schema.NullOr(Schema.String), text: Schema.String}),
) {}
const Row = Schema.Union([TicketRow, NoteRow /* , ask, lane, step: one case each */]);

// A drawer matches every case. A new kind of row is a new case, so the compiler points at every drawer.
const glyph = (row: typeof Row.Type) => Match.valueTags(row, {ticket: (t) => t.state, note: () => null});
```

- One type, so `tracker | board` and `asks | board` need one board, as Unix has text lines and
  Eurorack has one volt per octave (G6). It lives below every program, so no program imports
  another to get it.
- A ticket row always has its number and a note row never has one: the cases make the wrong row
  impossible to build.
- **Doubt:** each new kind of row (a pull request, an agent) is a change every drawer must take.
  The compiler finds each one; a busy week of new kinds would show the cost.

### C2: a tree goes flat on a pipe

**Decided 2026-11-02. Lean, 75%.**

```ts
// A sketch. On the pipe: rows, depth first, each naming the row above it in `parent`.
{_tag: "note", id: "note:ship", parent: null, text: "Ship the pipeline: PR 10, then 11a and 11b, then ticket 141, then 117 resumes"}
{_tag: "ticket", id: "ticket:141", parent: "note:ship", text: "Trace becomes the ticket's view",
	ticket: 141, state: "running", sub: "test_writer running", meta: "#141"}

// In a program's memory it is a tree again. Statics on a Schema.Opaque, no `xOf` names.
const tree = Tree.fromRows(rows); // each row with the rows under it; a row whose `parent` is missing goes to the top
const back = Tree.toRows(tree);   // depth first, ready to send
```

- Today's shape check (`fromEffect`, `packages/fabrika/src/program/shape.ts`) refuses a schema that
  refers to itself, so a nested tree did not load on a pipe. OpenTelemetry spans go flat with a
  parent id for the same reason, and so does today's trace program.
- **Doubt:** the other way is to teach the shape check `Schema.suspend`. A second tree that wants
  the pipe would settle it.

### C3: a tree and a board are two programs, not two modes

**Decided 2026-11-02. Lean, 85%.** This is G1 R1.

```text
tracker --all | outline              its own model: open, zoom, only
tracker --all | board --by whose     its own model: only, and the done fold
```

- They share the row type and the kit's helpers, and no model. Want both? Put them side by side.
- **Doubt:** a person who flips between tree and columns often may want one key, not two tiles.

### C4: a drawer has nothing of its own

**Decided 2026-11-02. Lean, 80%.** This sharpens G6 R2.

```text
outline | ticket                     "No rows yet. Pipe some in: tracker | outline."
tracker --all | outline | ticket     Enter on 117 sends 117 on `ticket`; the ticket tile shows 117
```

- The line a person types has three stages: a source, a drawer, the ticket.
- **Doubt:** three words is longer to type than one; a saved line or a palette row may be wanted.

### C5: a filter is a program, rows in and rows out

**Decided 2026-11-02. Lean, 80%; `asks` as a filter, 65%.** This is G6 R3.

```text
notes | outline                      notes alone: a source
tracker --all | notes | outline      notes in a line: a filter that places the tickets in your notes
tracker | asks | board               asks as a filter: keeps only the rows that wait, needs no ledger of its own
```

- **Doubt:** whether `asks` keeps a source of its own for the top bar's count, which runs with no
  line. The `next/` asks program (Tier 5) settles it.

### C6: across lines, a ticket goes by `open`

**Decided 2026-11-02. Lean, 65%.** This changes G6 R2: the ticket follows on a pipe inside one line
only.

```ts
// Inside one line: tracker --all | outline | ticket. Enter sends the number down the pipe.
// Across lines: asks | board --by whose has no pipe to that ticket tile, so Enter asks the desk (G3).
open({line: "ticket --ticket 176", from: "t2", via: {_tag: "key", keys: "enter"}});
// {_tag: "opened", tile: "t3", how: "focused"}   the ticket tile already there, sent 176 by navigate
```

- A pipe joins one chain and cannot fan in, so two lines cannot share a ticket tile by pipe.
- **Doubt:** people may want one ticket tile per line. A day of real use settles it.

### C7: a filter never reads around the pipe

**Decided 2026-11-02. Lean, 75%.**

```text
tracker | notes | outline            143 is done and left upstream, so notes shows "Ticket 143", never a made-up title
tracker --all | notes | outline      the whole row for 143 comes down, title and all
```

- A filter that read the ledger to fill the gap would be a second tracker (G1 R4).
- **Doubt:** "Ticket 143" alone reads like a note heading in the shots. A ticket glyph on the stub
  would say what it is.

### C8: a source sends after each change

**Decided 2026-11-02. Lean, 70%.**

```ts
// A sketch, today's version. tea's runtime has no state subscription, so a source sends after its own dispatch.
yield* runtime.dispatch(msg);
yield* send("rows", Tree.toRows(/* the tree in runtime.getState() */));
```

- `notes` did this in round 2. The tracker's `rows` output was declared there (round 2 called it
  `lines`), but its main does not send it yet.
- **Doubt:** this may belong in fabrika's `serve`, sending a view of the state on every change, as a
  window's `watch` does. The plan settles it.

### C9: a fold two programs need moves below both

**Decided 2026-11-02. Lean, 70%.** This changes G7 R4: folds move down too, not only view pieces.

```ts
// Today (apps/fabrika/src/asks.ts:13): the host's asks fold imports a program to learn what waits on you.
import {headOf, words} from "@tea-fabrika/tracker";
// Decided: the fold lives with the ticket facts in packages/pipeline/src/tickets/, and the tracker
// and the asks both read it there. No program imports another.
```

- `headOf` is today's name. It gets a new name, as a static on the data it reads, when that code is
  touched ([schema classes](./schema-classes-not-of-helpers.md)).
- **Doubt:** where a fold that only two programs read should live, if not the domain package. The
  first one that is not about tickets settles it.

### C10: `notes` is the notepad, and its window is where you type

**Decided 2026-11-02, option c. The lean was 55%; the owner picked.**

```text
notes                                its window is the tree you type in, drawn with the kit's shared tree piece
notes | outline                      outline stays a drawer: it draws, it never writes
tracker --all | notes | board        notes feeds other programs
```

- Pipes go one way, so writing happens in the program that owns the rows. The tree piece is the
  kit's, so `notes` and `outline` draw a tree the same way (G7 R4).
- **Doubt:** typing in `notes` and reading in `outline` is two tiles for some people. A week of
  real notes settles it.

### C11: the keys line comes from `commands`

**Decided 2026-11-02. Lean, 80%.** This is G7 R1, in the shape of [modes](./modes.md#the-shape):
`{send, keys, mode?}`. No new fields.

```ts
// A sketch, the board.
commands: {
	only: {send: {type: "only"}, keys: "y"},
	done: {send: {type: "done"}, keys: "d"},
},
// keys line: "y only · d done". Each word is the command's name.
// refuse(model, {type: "done"}) says no while there is no done column, so the line shows "y only".
```

- Round 2's board offered `d show done` with no done column. A line made from what the program
  would take fixes it.
- **Doubt:** a command's name must now read well as a word on screen. The first program with a
  long name shows whether that holds.

### The count's label

**Decided 2026-11-02. Lean, 60%.**

```text
Waits on you · 3 asks, 1 note
```

- The outline counted 4 and the top bar and the board 3. The fourth was your own note marked
  "you". It stays in the filter, and the label names the split.
- **Doubt:** a second split (asks, notes, stuck runs) may make the label long. Real use settles it.

### The audit's three splits

The audit read today's version only and found 16 second jobs in 5 places
([experiment 201](../../experiments/201-composing-programs.md#the-audit)). The owner took the top
three.

**Split 1: one read-only reader below the programs. Decided, 85%.** The tracker's folds and its
steps list move to `packages/pipeline/src/tickets/`, and the steps come from the pipeline's own
`STEPS`, not a copy.

```text
before   tracker | ticket | runs      ticket and runs each run the tracker's whole machine: the whole ledger, GitHub every 2 minutes, write power
after    tracker | ticket | runs      the same line; ticket, runs and map read through one small read-only reader
```

- **Doubt:** the tracker's 9 steps against the pipeline's 11 may be on purpose. Then it is one
  mapping in the domain package, and the split is smaller.

**Split 2: the tracker's ticket page goes, after this note's tryout fix 1. Decided, 75%.**

```text
before   tracker                      Enter swaps the tile to the tracker's own ticket page
after    tracker | ticket             Enter sends the number down the pipe; the ticket tile follows
         tracker                      Enter, with no ticket tile: opens ticket --ticket N beside (fix 1)
```

- Before fix 1, this split is worse: Enter would do nothing you can see.
- **Doubt:** a quick look in place, as Linear's Space peek (call 7, moved to experiment 206), may beat a tile beside. A week
  of use with fix 1 settles it.

**Split 3: the asks list leaves the frame. Decided, 80%, in `next/` only; today gets fix 1.**

```text
before   (top bar) C-b a, Enter       the frame sends a query into a tile it finds by the name "tracker"
after    asks | ticket                next/: the asks program, its glance in the top bar, the ticket on a pipe
today    (top bar) C-b a, Enter       opens ticket --ticket N beside, through the desk's open (fix 1)
```

- **Doubt:** the Dock badge reads the count off the desk today, so it needs a new source when asks
  leaves the frame.

## What the ledger records

In `next/`, the desk is a program with its own log (Tier 1 detail, call 20), so these are its letters.

```ts
// A sketch, next/. Effect Schema writes each _tag. `sentAt` is the window's own clock, never used to decide (`said` until 2026-11-05).
{_tag: "open", line: "asks --ask a-approve-8 | ticket", from: "t1", via: {_tag: "key", keys: "enter"}, sentAt}
{_tag: "opened", tile: "t5", how: "new", beside: "t1", folded: ["t6"]}
{_tag: "left", tile: "t5", focus: "t1", why: "recent"}
{_tag: "closed", tile: "t5", focus: "t1", why: "recent"}
{_tag: "refused", why: "no_press", from: "t1"}
```

- **Lost if not recorded now:** `from` and `via` at the moment of the open, and which way back a person
  used. Neither can be worked out later. They are what call 1 needs to be settled by data, not taste.
- Derived later, from these: how often an open is a focus, which programs open which, time in a tile
  before `leave`.

## A tryout in today's version

Offered, not filed. Each is small and stands alone.

| Fix | What changes | Size |
|---|---|---|
| `Enter` with nowhere to go opens `ticket --ticket N` beside the focused tile | a desk Msg `open {line, from}` that reuses `openLine`; `opensOf` gains a fourth answer (ticket 102 is next to it) | about 90 lines with tests, 2 agent hours |
| `C-b ;` and the focus history | decided in the tile guidelines, not built; a list on the workspace | about 40 lines, 1 agent hour |
| The popup's footer and row keys from one table | `ASKS_FOOT` and the row's `H` from one list of commands | about 30 lines, 0.5 agent hours |
| `go` is said | a polite "ticket #7, t2" on a focus move from the popup | about 15 lines, 0.25 agent hours |

## Where this differs from settled notes

- **[Tile guidelines](./tile-guidelines.md), decided.** Call 1's A or C changes its close rule. Its
  `C-b ;` is used here as is. The tile's insides are its, not this note's.
- **[Popovers](./popovers.md), settled.** It says the asks list "never opens a new tile: the app has no
  path for that yet". This note is that path; the popover rules do not change.
- **[Tracker views](./tracker-views-are-programs.md), proposed.** Its `open` output becomes a Cmd with
  an answer, and its `query` becomes `navigate`, the way a location moves.
- **[Fold, not tabs](./fold-not-tabs.md), decided.** A line opens in the tile it was typed in. An open
  from a popup has no such tile, so it lands after the focused tile, which keeps its program, and the
  tile asked for stays open while the others fold (196's P2).
- **[Modes](./modes.md), decided.** `commands` is used as is; `leave` is one more command a program may
  bind. A `glance` view would be one more optional field (call 6, moved to experiment 206).

## What it costs

In `next/`, spread over Tier 2 (the desk) and Tier 5 (the asks). Estimates from reading, not a build.

| Piece | Lines | Agent hours |
|---|---|---|
| `location`, `reuse`, and `navigate` with a back stack per tile | 120 | 2.5 |
| The desk's `open`, `leave`, open or focus and placement, with laws | 150 | 3 |
| The focus history, `C-b ;` and the close rule | 40 | 1 |
| The kit: list and detail, row, action bar from `commands` | 200 | 3 |
| The desk's letters and refusals | 40 | 0.75 |

About 550 lines and 10 agent hours. The cost of not doing it: each program that opens a tile writes
its own, as today's frame does for the asks.

## What it cannot tell us

- **Nothing ran in the app.** The page's demo is a browser sketch of the desk; its checks prove the
  drawing, not `desk.ts`.
- **No screen reader ran.** The order of a focus move and a polite status needs VoiceOver and NVDA.
- **Which way back a person expects.** Three branches, on paper and in the demo. A week of use with
  the letters above settles call 1.
- **"The same tile" for programs other than the asks.** Only the asks were walked.
- **tmux's and i3's close rules come from their source,** read by a fetch tool, not run.
- **Linear's app was not seen logged in,** and its peek page did not load.
- **`next/` has no desk yet.** Every `next/` claim is a sketch on the decided notes.
- **The composing rules ran in a stand-in host.** Round 2's pipes went through the real fit check
  and each drawer's own step and view, but no program's main ran and nothing was typed in tsh. The
  audit ran nothing at all (experiment 201).
