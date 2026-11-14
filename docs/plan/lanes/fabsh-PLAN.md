Approved by the lead agent, builds 0275, 0276, 0170 and S1 of the summon guidelines, with its leans for the owner to read; body 315f75026377
Plancheck-Version: 3

# fabsh in a tile: a regular program that takes a line, echoes each letter at once, and starts a program, in next/

```ts
// The whole idea, next/ only. A sketch. fabsh is one more program; its line rides the ephemeral lane.
// 1. A letter: the tile draws it now, and sends the whole line as one ephemeral frame. Never saved.
{ method: "process.draft", params: { pid: "fabsh:1", m: { text: "hel", cursor: 3, n: 7 } } }
// 2. The process keeps it in memory and confirms it. The window drops its pending edit 7.
{ result: { text: "hel", cursor: 3, n: 7 } }
// 3. Every view, color and Tab reads one list of spans from one pure reader (S1).
read("hlep x", known) // { spans: [{ start: 0, end: 4, role: "unknown", reason: "no_word" }, ...] }
// 4. Enter: the whole line is one saved letter, the one thing that decides (0275).
press({ type: "submitted", line: "help" }) // in the log; the scrollback shows help's answer
// 5. Slice 2: a program word is a start, caused by that letter, so it is checked against its member.
startChild({ program: "fabrika/counter", name: "counter:1" }) // then the desk shows it in a tile with its keep
```

All of this is about `next/` only. Today's version, and its `tsh`, are not touched (0432, 0525).

## Read this first: what the owner should see before approving

- **One lean reads 0275's words narrowly, and could be read as walking part of it back.** 0275 says
  the shell's "line editor state [is] in its model". This plan keeps the line being typed in the
  process's memory, beside its saved model, never inside it. The saved model holds only what
  submitted lines made. The reasons are two decided rules that cannot both hold otherwise: the
  ephemeral lane's "show it, never save it, never decide with it"
  (`docs/direction/a-local-first-sync-engine.md:222`), and 0229's "drop the views, replay the log
  and compare" test, which a model changed by unsaved frames would fail. The process still holds
  the line, steps it, checks it and confirms it, which is what 0275's decision bullets ask. **The
  lead's lean, for the owner to read, 75%.** It is open question 3.
- **No lean loosens a law.** No existing test or lint rule is weakened.
- **S1 is still proposed.** The plan README asks the owner to walk S1 of the summon guidelines
  before `fabsh` is built (`docs/plan/README.md:100-102`), and no decision file records that walk.
  Slice 1 builds S1 as Tier 1's lead's reading puts it (`docs/plan/tier-1.md:77-80`). The tests step
  may start; the build of the reader waits on the owner's walk (open question 1).
- **Slice 2's build waits on ticket 953's slice 2.** Today a start is checked by an exact
  program-to-program grant, and the `starts` setting is empty by default (0170's context,
  `next/packages/libfabrika/src/processes/ChildrenLedger.ts`). So every start
  fabsh asks for today answers `forbidden`. Adding a grant for fabsh would break 0170's binding
  constraint ("No program is trusted to start others because of which program it is"). So no grant
  for fabsh is ever added, and slice 2 lands after 953's start check does.

## The lead's amendments, approved with the plan

These bind the steps. Where they and a line below differ, these win.

- **A1, open question 3 goes on as a lean.** The lead reads it as a design call between two decided
  rules, not a walk-back of 0275: what 0275 decides (the shell runs in the brain, the process holds
  and confirms the line, only a submitted line is kept) all holds. The lean stays recorded as "the
  lead's lean, for the owner to read", in this plan and the pull request, and the lane goes on.
- **A2, S1 is built now.** The lane's brief names S1 as in scope, and Tier 1's lead's reading puts
  it in fabsh's first build (`docs/plan/tier-1.md:77-80`). The reader's build does not wait on the
  owner's walk; open question 1 stays recorded as the lead's lean, for the owner to read.
- **A3, the look.** fabsh is a `next/` window, so the look step that "Pick the look before the PR"
  asks of today's app does not gate this lane. The build picks the four role tokens' values from the
  design package's existing palette, the shots show them, and open question 5 stays the lead's lean
  for the owner to read.
- **A4, slice 2's start.** Slice 2 is built through today's `start_child`, with no grant for fabsh,
  ever (0170, L21). Its laws that need a start to succeed on a real instance (L26, L28) need ticket
  953's start check; until 953's slice lands on origin they are written and marked owed to 953, and
  the slice says so. Slice 2 starts only after the lead reads the desk branch: if the desk lane does
  not bring a tile that follows `keep` (P18 slices 2 to 4), slice 2 waits for it and the lane
  reports that, rather than building a stub (0159).
- **A5, the base.** The branch is made from the desk lane's branch once it exists, and this plan is
  refreshed against it as a dated amendment here before the tests step starts.

- **A5's refresh, 2026-11-14, against the desk lane's branch at ad6cd78** (merged in at 6b3d33e).
  The desk lane's slice S1 brings 0170's start check: a start a member's letter caused is checked
  against that member with `mayStart` (`next/packages/libfabrika/src/access/StartRule.ts`), whose
  first rule lets any member start any program, and `stop_child`. It does not bring the
  `fabrika/tezgah` program, a tile that shows a process chosen at run time, `show`, or a tile's
  monitor and `keep` (P18 slices 2 to 4). So: slice 1 is unchanged and keeps its fixed `fabsh:1`
  tile. For slice 2, the desk's S1 now does what this plan waited on ticket 953's slice for: a
  start from fabsh's submitted step is checked against that letter's member, with no grant for
  fabsh, so L20, L21, L22, L23, L24 and L28 can be built on this branch now. Slice 2's tile half
  (L25, L26, L27: `show`, `keep` on `DOWN`) still waits for the desk lane's tile pieces, as A4 says.

- **A6, slice 2 is cut in two, 2026-11-14.** Slice 2a lands now: a program word (`counter`,
  `counter as <name>`, `pack/program`) starts it through `start_child` in the submitted step, the
  answer (`started`, `already_started`, `already_present`, each refusal) shows in the scrollback in
  words, the runner built-in Cmd `programs` gives fabsh the names it can start, and the built-in
  `programs` lists them. Its laws are L20, L21, L22, L24, L28, and L23 without its `show` part:
  every start answer reaches the scrollback once, and a resend adds nothing. Slice 2b waits for the
  desk lane's tile pieces (a tile that shows a process chosen at run time, `show`, a monitor and
  `keep`): the `show` letter to the desk and L23's `show` part, `exit`, L25, L26 and L27. Until 2b,
  a started program runs and fabsh names it, but no tile shows it; the pull request says so.
  2a's `says()` and reader never mention 2b's words, so no "not yet" line ships.

- **A7, L28's second half and the init ask, 2026-11-14.** On a real instance a letter's step and its
  `start_child` run inside the letter's own delivery, before `process.send` answers, so no outside
  move can remove the writer's key between input and step. L28 keeps its first half; its second
  half is held by the desk lane's runner law (a non-member sender's start is `forbidden`, Desk S1 L2
  in `runtime/StartChildTest.ts`) and by L23 (fabsh says each refusal, `forbidden` included, in
  words). And the library's stepper drops the Cmds `init` returns (`runtime/Program.ts`, `init`), so
  fabsh cannot ask `programs` in `init`; when it asks is the build's choice, held by L28: fabsh
  knows its table before a person's first line, and no start ever comes from that answer (L20).

## The answer first

One ticket, two slices, each its own pull request, in the order the owner sees them.

- **Slice 1, fabsh in a tile.** A new program, `fabrika/fabsh` (`next/programs/fabsh`). The tile
  draws each letter at once and the process confirms it. Each word shows its role in color, with
  its reason in words for anything the reader refuses. Tab completes a word. Enter saves the whole
  line as one letter, and the process answers it in the tile's scrollback. Built-ins in this
  slice: `help`, `clear`, `history`. Underneath, the library gains the ephemeral lane's first
  client-to-process frame, `process.draft`: a window sends it, the gateway checks the session and
  a budget of its own, and the runner keeps the newest value in memory and answers it. Nothing of it
  is saved.
- **Slice 2, start a program from fabsh.** A program word (`counter`, or `counter as notes2`)
  becomes `start_child` in the step of the submitted letter, so the start's cause is the member's
  input (0170, 0262). The answer shows in the scrollback. fabsh then mails the desk one `show`
  letter, and the desk opens the process in a tile beside fabsh's, which follows its `keep`. Built-ins
  `programs` and `exit` come with it, and a runner built-in Cmd, `programs`, gives fabsh the names
  it can start. fabsh holds no start permission of its own (0170).
- **Not here:** pipes, `summon`, `@name`, `join`, `ps`, `jobs`, history search. Each has its own
  ticket (0159's order).

## How others do it

- **mosh** (Winstein and Balakrishnan, "Mosh: An Interactive Remote Shell for Mobile Clients",
  USENIX ATC 2012; not fetched this session). The client echoes keys speculatively and the server
  confirms; its State Synchronization Protocol sends the newest state of the screen, never a stream
  of keystrokes, so a lost packet is healed by the next one. This plan takes both: speculative echo,
  and a frame that carries the whole line, which an at-most-once lane needs.
- **Phoenix LiveView** (hexdocs, "Form bindings"; not fetched): the client is the source of truth
  for a focused input's value, and the server's render never overwrites it while it has focus. This
  plan takes that rule for the line: while the person types, the tile draws its own line, and an
  echo only clears a pending edit.
- **Liveblocks presence and Yjs awareness** (their docs; not fetched): state beside the durable
  document that is broadcast and never stored. This repo already decided the same lane, with its
  rule (`docs/direction/a-local-first-sync-engine.md:222-241`), and names "fast streams such as
  terminal bytes" as its cargo. The draft frame is that lane's first client-to-brain frame.
- **fish and Nushell** (fish docs, "Syntax highlighting"; Nushell book, "Thinking in Nu"; not
  fetched, cited by S1 as [f2] and [n1]). The line is parsed as it is typed, and colors, completion
  and errors read the parse. S1 takes this, and so does this plan: one `read`, many readers.
- **Erlang/OTP's shell** (the `shell`, `group` and `edlin` modules; read from memory, not fetched).
  The shell is a process that evaluates; line editing (`edlin`) runs in the I/O server on the
  terminal side, and the shell gets a finished line. 0275 put the line's state in the process
  instead, so this plan splits it the way the browser forces: the native input edits (as `edlin`
  does), and the process holds and confirms the line.
- **bash and readline** (bash manual, `HISTSIZE`, default 500; not fetched): history is a list of
  submitted lines with a cap. fabsh keeps the same cap.
- **tmux** (man page; not fetched): `split-window <command>` starts a command in a new pane beside
  the current one, `remain-on-exit` is 0276's `keep`, and `history-limit` defaults to 2000 lines.
- **Elm.** The reader is a pure function of the line, the view a pure function of the model, and
  the tile's optimistic line is derived, never stored (0167's binding constraint).
- **Effect and tea, installed:** `effect` 4.1.2, `@demlik/tea` 0.25.0 (both with a local patch),
  `fast-check` 4.10.2, `vitest` 5.0.5, `playwright` 1.64.1 (the workspace catalog). Every machine here is a tea machine on the Effect engine (`@demlik/tea/effect`'s
  `Machine.make` and `Cmd.make`), as `next/programs/checklist/src/tile.ts` is.

## What is decided, in one place

- [0275](.decisions/0275-the-shell-is-a-regular-program.md): fabsh is a regular program in
  the brain; the window draws letters at once and the process confirms; a submitted line is a Msg in
  the log and keys typed mid-line are not; every window does speculative echo, with a test that the
  drawn letter and the process agree.
- [0432](.decisions/0432-next-has-fabsh-rethought-from-tsh.md): rethought from tsh, never
  copied. Today's tsh was read only for its jobs: its 12 built-ins
  (`packages/fabrika/src/shell/grammar.ts:83`) and its line editor note
  (`docs/direction/the-gui-is-electron-first.md:200-230`).
- [0159](.decisions/0159-fabsh-pipes-summon-join-first.md): fabsh in a tile comes right after
  the window and the desk; done is seen in the Electron app and a browser tab; no thin slice or stub.
- [0276](.decisions/0276-a-tile-shows-one-process.md): a tile shows one process, monitored as
  OTP monitors, and follows `keep` (`never`, `failed` by default, `always`).
- [0167](.decisions/0167-focus-moves-in-the-window-first.md): an optimistic update keeps
  server state and pending mutations apart and derives the rest. This plan uses the same shape for
  the line, and answers 0167's open "how the server's answer is matched to a pending mutation" for
  drafts with a count, `n`.
- [0170](.decisions/0170-a-start-is-checked-against-its-sender.md): a start is checked against
  the member whose input caused it; fabsh holds no permission of its own; the first rule lets any
  member start any program.
- S1 of [the summon guidelines](docs/direction/summon-guidelines.md#s1-one-grammar-typed-tokens-every-view-reads-it)
  (proposed, 85%): one grammar, spans with roles, every view reads them; a law that every character
  sits in at most one span and a refused line has exactly one `unknown` span at its refusal.
- [The desktop layer](docs/direction/the-desktop-layer.md), W2 and W3, and the glossary's `line
  (runtime)` row: "Each program in a line shows in a tile (decided Nov 3)".
- The ephemeral lane (`docs/direction/a-local-first-sync-engine.md:222`, glossary row `ephemeral
  lane`): at-most-once, show it, never save it, never decide with it.
- [Elm first](docs/direction/elm-first.md), [0046](.decisions/0046-one-tea-machine-per-file.md),
  [0461](.decisions/0461-every-ui-part-is-on-manti.md) (Manti's `Input`),
  [0456](.decisions/0456-one-design-package-both-versions.md) (one design package),
  [0069](.decisions/0069-choices-are-settings.md), [0209](.decisions/0209-schemas-are-effect-schema.md),
  [0214](.decisions/0214-unions-are-tagged-with-tag.md).

Choices this plan makes because a note already answers them
([the open questions test](.agents/skills/plan/SKILL.md#the-open-questions-test)):

- **The frame carries the whole line, not one key.** The ephemeral lane is at-most-once, so a lost
  key would corrupt a key-by-key line forever; a whole-line frame is healed by the next (mosh).
  0275's `{type: "keys", data: "l"}` is marked a sketch in the desktop layer note.
- **The line is a native input.** Manti's `Input` (0461) gives IME, dead keys, paste, selection and
  screen reader editing for free; the colored spans sit in an `aria-hidden` layer behind its
  transparent text. History recall (Up, Down) is predicted by the tile from the view's history, by
  the same pure function the process uses.
- **One frame in flight per tile.** A newer edit replaces the queued one, so the send rate is
  bounded by the round trip and by typing, and the newest line is always the last frame sent.
- **The draft is memory only.** A Durable Object's memory is lost on sleep
  (`.patterns/durable-objects-sleep.md`). The tile keeps its line while it has focus (LiveView's rule)
  and sends it again with the next edit, so a wake heals at the next key. A wake never loses a
  submitted line: that is a letter.
- **Caps, from their makers' defaults.** History 500 lines (bash `HISTSIZE`), scrollback 2,000
  entries (tmux `history-limit`), a line no longer than one letter's row (`INPUT_BYTES`,
  `next/packages/libfabrika/src/processes/Children.ts:24`). Are they settings (0069)? Not here: a
  program gets no service (`next/packages/libfabrika/src/runtime/Program.ts:1-4`), and the caps are
  checks in its saved model's schema, which must decode the same on every wake. A per-person
  history size is a later setting, once programs can read one.
- **The draft budget is a setting.** Draft frames spend their own gateway budget,
  `gateway.draft-limit`, declared once beside `gateway.limit`
  (`next/packages/libfabrika/src/settings/Declarations.ts:71`). Typing at 10 keys a second would
  spend the whole 600-a-minute `gateway.limit` and starve presses. Its default is open question 6.

## The shape

### The draft frame in the library (slice 1)

```ts
// runtime/Program.ts: a program may declare one draft. Its value is shown and never saved.
type Spec<...> = {
  // ...today's fields...
  readonly draft?: {
    readonly schema: Schema.Codec<D, Schema.Json>;     // what one frame carries, and what the echo answers
    readonly refuse: (draft: D) => Refusal | null;     // the program's own no, on every frame
  };
};

// gateway/Gateway.ts: one new method, beside process.send and view.open.
// params: { pid: string, m: Json }. Checked like a send's session and key, then routed, never recorded.
type DraftAnswer =
  | { readonly ok: Json }                              // the process's newest draft: the echo
  | { readonly err: "no_draft" | "bad_draft" | "rate_limited" | "not_granted" | "ended" | "refused"; readonly reason?: string };

// runtime/Runner.ts: under the process's permit, as every turn is.
//   decode m with draft.schema -> refuse(m) -> keep it in memory as the process's newest draft -> answer it.
//   No ledger append, no letter, no checkpoint, no watcher publish, no span per frame.

// client/WindowMachine.ts: a tile machine may now send a second Cmd besides press.
type TileOut = { type: "press"; m: ProgramMsg } | { type: "draft"; m: Json };
// the parent writes Call.draft { pid, m }, at most one in flight per tile, and hands the answer
// back to that tile as its Msg { type: "echoed", value } or { type: "echo_refused", reason }.

// transport/ClientRows.ts: one row per submitted line, never one per frame (the view row's rule).
draft: { pid: Schema.String, frames: Count, echoes: Count, slowest: Ms }
```

### fabsh, the program (`next/programs/fabsh/src/program.ts`)

```ts
export const Draft = Schema.Struct({
  text: Line,                       // Line: a string that fits one letter row, no newline
  cursor: Schema.Int,
  n: Schema.Int,                    // the tile's own count, so an echo names the edit it confirms
});

const Entry = Schema.TaggedUnion({
  answered: { line: Line, says: Schema.Array(Schema.String) },               // a built-in's lines
  refused: { line: Line, start: Schema.Int, end: Schema.Int, reason: Reason }, // S1: one unknown span
  // slice 2:
  starting: { line: Line, id: Schema.String, program: Schema.String, name: ProcessName },
  started: { line: Line, process: ProcessId, name: ProcessName, fresh: Schema.Boolean },
  failed: { line: Line, reason: StartRefusalOrPresent },
});

export const Model = Schema.Struct({
  history: Schema.Array(Line).check(Schema.isMaxLength(500)),     // submitted lines, newest last
  scroll: Schema.Array(Entry).check(Schema.isMaxLength(2_000)),
  programs: Schema.Array(Schema.String),                         // slice 2: what may be started
});

export const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("submitted"), line: Line }), // the one write port a person uses
  // slice 2: start_child_ok, start_child_err, programs_ok, send_ok, send_err (Cmd answers)
]);

// The states, explicit (0037): a scrollback entry is answered or refused at once, and a start is
// `starting` until its answer moves it to `started` or `failed`. Nothing else decides.
export const fabsh = Program.make({
  name: "fabrika/fabsh",
  machine: fabshMachine,
  state: { v: 1, upgrades: [] },
  view: (m) => ({ history: m.history, scroll: m.scroll, programs: m.programs }),
  refuse: (_m, msg) => (msg.type === "submitted" && msg.line.includes("\n") ? { reason: "bad_line" } : null),
  inputs: { submitted: { description: "a line typed in the tile", personOnly: true } },
  draft: { schema: Draft, refuse: (d) => (d.cursor < 0 || d.cursor > d.text.length ? { reason: "bad_cursor" } : null) },
  outputs: {},
  writes: {},
  wake: () => null,
});
```

`submitted` is `personOnly`: a line is a person's, and 953's sender check reads its writer.

### The reader (`next/programs/fabsh/src/read.ts`)

```ts
export const Role = Schema.Literals(["verb", "keyword", "name-new", "word", "unknown"]); // S1's names, the subset this ticket needs
export const Reason = Schema.Literals(["no_word", "extra", "no_name", "bad_name", "ambiguous"]);
export const Span = Schema.Struct({ start: Schema.Int, end: Schema.Int, role: Role, reason: Schema.optionalKey(Reason) });
export type Known = { readonly builtins: ReadonlyArray<string>; readonly programs: ReadonlyArray<string> };

/** Pure. The process, the tile's colors, Tab and the error mark all call this, never a regex of their own. */
export const read: (line: string, known: Known) => { readonly spans: ReadonlyArray<Span>; readonly expects: ReadonlyArray<Role> };
/** Pure. Tab: the word at the cursor, completed from what `read` expects there. */
export const complete: (draft: Draft, known: Known) => Draft | null;
/** Pure. Up and Down over history; the tile predicts with it and the process uses it too. */
export const recall: (draft: Draft, history: ReadonlyArray<string>, to: "back" | "forward") => Draft;
```

The grammar, for this ticket (a sketch, the S1 subset):

```text
line      blank | builtin | run
builtin   'help' [word] | 'clear' | 'history'            slice 1
        | 'programs' | 'exit'                            slice 2
run       program ['as' name]                            slice 2: program is a verb, `as` a keyword, name a name-new
program   word                                           checked: one program in `known`, by its last part or whole
name      word                                           checked: ProcessName
```

### The tile (`next/programs/fabsh/src/tile.ts`) and its view

```ts
// The window side, one tea machine (0046). Server state and pending edits apart; the drawn line derived.
const TileModel = Schema.Struct({
  echoed: Draft,                  // the newest echo: the server state
  mine: Draft,                    // what the person's input holds now
  flight: Schema.NullOr(Schema.Int), // the n of the one frame in flight
  queued: Schema.Boolean,         // an edit came while a frame was in flight
  frames: Count, echoes: Count, slowest: Ms, // for the one client row per line
});
// drawn(m) = m.mine while it has focus or any edit is pending; else m.echoed (LiveView's rule).
// Msgs: edited {text, cursor}, tab, recall {to}, enter, echoed {value, ms}, echo_refused {reason}, blurred.
// Cmds: draft {m: Draft}, press {m: {type: "submitted", line}}.
```

The view (`window.tsx`, on Manti): a `role="log"` scrollback above, one labeled Manti `Input` below
with the colored span layer behind it, and one polite status line that says each unknown span's
reason in words ("`hlep` is not a built-in or a program"). Role colors come from four new tokens
in the design package, picked by the look step (open question 5). An unknown span also gets a wavy
underline, so color is never the only cue (WCAG 1.4.1).

### Slice 2: the start, the desk and 953

```ts
// In the submitted step, never in a Cmd answer's step: its parent must be the member's own input.
submitted: (s, m) => {
  const run = toRun(read(m.line, known(s)));                 // { program: "fabrika/counter", name: "counter:1" } or a refusal
  return run._tag === "refused"
    ? [push(s, Entry.cases.refused.make(...)), []]
    : [push(s, Entry.cases.starting.make({ line: m.line, id, ...run })), [startChild({ program: run.program, name: run.name })]];
},
start_child_ok: (s, m) => [settle(s, m), [send({ to: "tezgah:1", m: { type: "show", process: m.value.process } })]],
```

- **A program word.** A bare word resolves to the one program in `programs` whose last part
  matches (`counter` is `fabrika/counter`); `pack/program` always works; two matches is `unknown`
  with `ambiguous`. With no `as`, the name is `<program>:1`, so the start is whereis then start
  (`processes/Children.ts:1-3`): `started` and `already_started` both show the process, which is
  0276's open-or-focus for free. `already_present` (known, not running) and each `StartRefusal`
  (`runtime/StartChild.ts:28`) is a `failed` entry with its reason in words.
- **`programs`**, a runner built-in Cmd like `start_child`: it answers the names the loader can
  start. fabsh asks it at init and after each start, so the reader can mark an unknown word
  before Enter. It is asked outside the submitted step on purpose: no start ever comes from its
  answer (law L20).
- **953's swap.** Until ticket 953's slice 2 lands, `ChildrenLedger` checks `StartGrant` and answers
  fabsh `forbidden`. Once it lands, the same `start_child` is checked against the sender of the
  submitted letter through `Senders.sender(parent, process)` and `StartProgram`, with no change in
  fabsh: the answer and the refusals keep their shape (0170's binding constraint). fabsh holds no
  grant, before or after. Slice 2's build waits for that swap; its laws L20 and L21 are written so
  they hold on both sides of it.

### What fabsh needs from the desk, and the seam if it is missing

The desk lane builds `fabrika/tezgah` on P18's branch and is not pushed yet. P18's own row puts
monitors and `DOWN` on a tile in its slice 2, tiles that read only their part in slice 3, and
`keep` and closing a tile in slice 4 (`docs/plan/tier-1.md:732`).

| fabsh needs | Owned by | Used in | If it is not there yet |
|---|---|---|---|
| A tile that hosts a process by id, chosen at run time | P18 slice 3 and the desk lane | slice 1 (default tile), slice 2 | Slice 1: one fixed tile, `fabsh:1`, in the page's list and the bootstrap, as `checklist:1` is today (`next/apps/fabrika/src/entry/views.ts:6`, `runtime.ts:39`). The desk lane removes it when tezgah starts fabsh as a new tile's default (0275) |
| A new tile starts fabsh as its default process, as tezgah's child | the desk lane | slice 1 wiring, slice 2 mail | Nothing: the fixed tile stands in. Being tezgah's child lets fabsh mail it with no host grant (`processes/ProgramMailLedger.ts:122`) |
| `show {process}`: open a process in a tile beside the tile that shows the sender, focused (G3 R3, G4 R2) | the desk lane | slice 2 | The seam is one input on tezgah, `show`, about 40 lines with two laws. If the desk lane has merged without it, slice 2 adds it in tezgah's program file and the desk lane's reviewer reads that part |
| The tile's process monitor and `keep` on `DOWN` | P18 slices 2 and 4, inside the desk | slice 2 | Slice 2 waits: a tile that does not follow `keep` would be a stub (0159) |
| A program's window found by its program, not by a fixed name | P18 slice 3 | slice 2 (counter in a tile) | Slice 2 waits |

So slice 1 needs nothing from the desk lane, and slice 2 needs the desk lane, P18 slices 2 to 4 and
953's slice 2. The plan is refreshed against the desk branch once it exists.

## One value traced through

A person types `hlep`, fixes it to `help`, and presses Enter, in a browser tab on the local
instance.

1. `h`: Manti's `Input` fires a change. The tile's update sets `mine = {text: "h", cursor: 1, n: 1}`
   and draws it in the same update (law L5). It returns `draft({m: mine})`; the parent writes
   `Call.draft {pid: "fabsh:1", m}` with JSON-RPC id 41.
2. `l`, `e`, `p` arrive while frame 1 is in flight. Each sets `mine` and `queued = true`; no new frame
   (law L12). The reader runs on every draw: `read("hlep", known)` gives one span
   `{start: 0, end: 4, role: "unknown", reason: "no_word"}`. The span layer underlines it and the
   status says "`hlep` is not a built-in or a program".
3. The gateway gets `process.draft`: the session is live, the key still belongs, the draft budget
   has room. It calls the Project's runner for `fabsh:1`'s process under its permit. The runner
   decodes `m` with `Draft`, runs fabsh's draft `refuse` (null), keeps it in memory and answers
   `{ok: {text: "h", cursor: 1, n: 1}}`. Nothing is appended; the ledger's rev does not move (L6).
4. The tile gets `echoed {value, ms: 9}`: `echoed = h/1`, `flight = null`, and since `queued`, it
   sends frame `{text: "hlep", cursor: 4, n: 4}`. The drawn line is still `mine`.
5. The person moves back and fixes the word. Frames follow; the last echo is
   `{text: "help", cursor: 4, n: 7}`, equal to `mine`. Nothing is pending. The span is `verb`.
6. Enter: the tile returns `press({m: {type: "submitted", line: "help"}})` and one frame
   `{text: "", cursor: 0, n: 8}`, and writes one client row
   `draft {pid: "fabsh:1", frames: 4, echoes: 4, slowest: 12}`.
7. The press is a normal letter: the gateway stamps its writer (0261) and saves it. fabsh's
   `submitted` step reads the line again with `read` (the process decides, the tile only predicted),
   pushes `help` to history, and adds `answered {line: "help", says: ["help    the words fabsh knows", ...]}`.
   The view patch reaches the tile; the scrollback shows it, and the log's polite region reads it.
8. If the brain slept between steps 5 and 6, the memory draft is gone, and that changes nothing:
   step 6's frame sets it again, and the submitted letter carries the whole line.

## Ask how Linear would do it: the fabsh tile

- **What Linear would build.** Linear's command menu (Cmd-K) and its filter bar are its typed
  surfaces: one quiet input, results under it, each typed token shown as a chip of its kind, errors
  inline in words, no chrome, every action reachable from the keyboard. Asked as fabrika's builder:
  fabsh is the program that owns "type a line", and it composes as a tile like any program, so a
  person can put it beside the tile it starts. The roles are the piece every line gets for free,
  as S1 says: a future `summon` line is colored by the same spans.
- **Where we follow it.** One input, no border box inside the tile's own edge (the tile already
  draws one: "No extra containers"), quiet role colors from tokens, a reason in words, nothing
  that moves focus without a press (G4).
- **Where we differ, and why.** Linear's menu is a modal that closes after one action; fabsh is a
  tile that keeps its scrollback, because a shell's value is the record of what you ran (bash,
  tmux). Linear shows chips; fabsh colors spans in place, because chips would move the text under
  the cursor while typing. Linear does not tile; where a fabsh start opens a tile, tmux's
  `split-window` and the program guidelines' G3 decide where (`docs/direction/program-guidelines.md:205`),
  as W5 already says the prefix wins over Linear's keys.
- **The picker (0514) later reads the same `read`.** A fabsh line in the picker is a "Run" row
  only when fabsh's parser accepts it (`docs/direction/picker-guidelines.md:249-272`). That is not
  built here; the reader is exported from `@kampus/fabsh` so it can be.

## Laws

Each law is a property (generated inputs) or a labeled scenario. "Plant" is the change that must
turn it red. Slice 1 is L1 to L19; slice 2 is L20 to L28.

| id | law | kind | generator | plant | slice |
|---|---|---|---|---|---|
| L1 | For any line and any known lists, `read`'s spans are sorted, inside the line, never share a character, and cover every non-space character (S1) | test, 1000 runs | fc.string: graphemes up to 300, mixed with built-in words, `as` and runs of spaces | let two spans share a character | 1 |
| L2 | The process refuses a submitted line exactly when `read` gives it an `unknown` span, and the `refused` entry holds the first such span's start, end and reason; any other line runs (S1) | test, 500 runs | fc.array: 1 to 6 words drawn from built-ins, `as`, valid names and junk, joined by 1 to 3 spaces | run a line that has an unknown span | 1 |
| L3 | The tile's span layer and its status read only `read`'s output: for any line, the drawn spans and the stated reasons equal `read`'s spans and reasons | test, 300 runs | fc.string: up to 120, with built-in words | color a word by its own regex | 1 |
| L4 | 0275's agreement: for any run of edits, recalls, Tabs, Enters, lost frames, lost echoes, redials and process wakes, once the last edit is echoed the drawn line equals the process's draft | test, 300 runs | @demlik/tea/pbt.arbGuidedSequence: edits, recalls, tabs, enters, frame and echo drops, redials, wakes | let a focused tile follow a stale echo | 1 |
| L5 | A letter is drawn in the update that takes it, before any answer: the drawn line after an `edited` Msg is that Msg's text | test, 200 runs | fc.string: up to 80 | draw only what was echoed | 1 |
| L6 | A draft is never saved: for any edits carrying a planted marker, the ledger, the process's stream, its checkpoint, the span sink and every client row hold no draft text, and the ledger rev does not move | test, 200 runs | fc.string: up to 200, each with a planted marker word | append a draft as a letter | 1 |
| L7 | The saved fold does not depend on drafts: folding only the saved letters gives the same saved model as the live process that also took drafts (0229's replay compare) | test, 300 runs | @demlik/tea/pbt.arbMsgSequence: submitted letters and draft frames interleaved | keep the draft in the saved model | 1 |
| L8 | Every frame passes the program's draft check: a draft longer than one letter row, holding a newline, or with its cursor outside the text is refused and changes nothing | test, 200 runs | fc.record: text up to twice the cap, cursor from -2 to length + 2 | skip the check on a frame | 1 |
| L9 | A program's `draft` takes a schema and a check, its echo is typed as that schema, and a draft check that returns a Cmd does not compile | type | type | widen the draft check's return to a tuple with Cmds | 1 |
| L10 | The gateway answers a draft only for a live session whose key still belongs and a process whose program declares a draft, and answers `not_granted`, `ended` or `no_draft` before any step | test, 200 runs | fc.record: key kept or removed, session live or ended, program with or without a draft | step before the membership check | 1 |
| L11 | Draft frames spend `gateway.draft-limit` and never `gateway.limit`: after any number of drafts in one window a press still passes when its own budget has room, and a draft past its budget answers `rate_limited` while the tile keeps drawing | test, 100 runs | fc.record: 0 to 3000 drafts and 0 to 600 presses in one window | count drafts in the main budget | 1 |
| L12 | At most one draft frame is in flight per tile, and the newest edit is always the last frame sent | test, 300 runs | fc.commands: edit, echo, drop, redial, blur | send a frame per edit | 1 |
| L13 | A submitted line is the whole line as typed, and the process takes it from the letter, never from its draft | test, 200 runs | fc.string: up to 200 | read the memory draft at submit | 1 |
| L14 | The caps hold: history keeps the newest 500, scrollback the newest 2,000, and a line longer than one letter row is refused `too_long` with the reason shown | test, 200 runs | fc.array: 0 to 3000 submitted lines up to twice the row | grow history past 500 | 1 |
| L15 | Tab completes only a word `read` expects at the cursor, extends to the candidates' longest common prefix, and changes nothing when there is none | test, 300 runs | fc.record: line, cursor, known built-ins and programs | complete from every known word | 1 |
| L16 | The line is a labeled textbox, the scrollback a `role="log"`, and each unknown span's reason is in the line's accessible description (WCAG 1.4.1) | test | scenario: render the tile with `hlep`, then with `help x` | drop the reason text | 1 |
| L17 | One suite, browser and headless, on a real local instance: type `hlep` key by key, each letter shows before its echo, the reason shows, fix it, Enter, `help`'s answer is in the scrollback; a reload keeps scrollback and history | test | scenario: one local instance, a Chromium tab, and Headless.start, as client-protocol's suite runs | draw only echoes in the tab | 1 |
| L18 | Host-only: L17's suite on the real built Electron app | test, host-only | scenario: the Electron backend, once P19 slice 3 lands | the same plant as L17 | 1 |
| L19 | The window writes one `draft` client row per submitted line, with frames, echoes and the slowest echo, and no draft text | test, 100 runs | fc.string: up to 200, with a planted marker | write one row per frame | 1 |
| L20 | A start comes from the submitted step: for any program line, the step that returns `start_child` is the submitted letter's own step, so its parent is the member's input | test, 200 runs | fc.record: a table of 1 to 6 programs and a program line | start from the `programs` answer's step | 2 |
| L21 | fabsh holds no start permission: no `starts` grant has fabsh as its source in the app's settings, their generated defaults, or any fixture this lane adds | test | scenario: read the app's built settings and this lane's fixtures | add a grant from fabsh | 2 |
| L22 | Words to a start: a bare word resolves to the one program whose last part matches, `pack/program` always resolves, two matches is `ambiguous`, no `as` names `<program>:1`, and `as` needs a ProcessName | test, 300 runs | fc.record: tables of 0 to 6 programs over 2 packs, and lines over them | pick the first match | 2 |
| L23 | Every start answer reaches the scrollback once: `started` and `already_started` show the process and send the desk one `show` per start id, a resend sends none, and `already_present` and each refusal show their reason in words | test, 200 runs | fc.constantFrom: started, already_started, already_present and each StartRefusal | send `show` again on a resend | 2 |
| L24 | The `programs` Cmd answers exactly the loader's table names, sorted | test, 100 runs | fc.uniqueArray: 0 to 12 program names | answer a cached list | 2 |
| L25 | `exit` ends fabsh's own process with `normal`, and its tile follows `keep` | test | scenario: `exit` in a tile with keep failed, then keep always | exit with another reason | 2 |
| L26 | On a real local instance, browser and headless: `counter` opens counter:1 in a tile beside fabsh's, a press there lands, `counter` again shows the same tile, a crash fault keeps the tile with its reason, and `exit` closes fabsh's tile | test | scenario: one local instance, Chromium and Headless.start, the chaos program's fault for the crash | show the process in fabsh's own tile | 2 |
| L27 | Host-only: L26's suite on the real built Electron app | test, host-only | scenario: the Electron backend, once P19 slice 3 lands | the same plant as L26 | 2 |
| L28 | With 953 landed and `starts` empty, a member's line starts any program, and a line whose writer's key was removed before its step shows `forbidden` in words | test | scenario: one instance, a person and an agent key, the key removed between input and step | treat no sender as allowed | 2 |

New or changed laws, for the reviewer: all of these are new; none changes an existing law. No
law reads a `seen` value to decide.

## Files

In `next/`, each file placed by [`next/AGENTS.md`](next/AGENTS.md)'s libfabrika test: the
draft frame, its gateway method and the tile's second Cmd are pieces any client needs, so they are
in libfabrika; the reader, the program, the tile and the view are fabsh's own and live in its
package, where the picker can import them later.

| file | owner | product lines expected | slice | what changes |
|---|---|---|---|---|
| next/packages/libfabrika/src/runtime/Program.ts | build | 45 | 1 | the optional `draft` declaration and its checks |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 90 | 1 | the draft step under the process's permit, memory only, and its answer |
| next/packages/libfabrika/src/runtime/Entry.ts | build | 15 | 1 | the runner's `draft` call on its contract |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 70 | 1 | `process.draft`: session and key checks, its own budget, routing, no record |
| next/packages/libfabrika/src/settings/Declarations.ts | build | 15 | 1 | `gateway.draft-limit` |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 10 | 1 | the draft call on the Project's contract |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 30 | 1 | route a draft to the process's runner, pass the new budget |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 95 | 1 | `Call.draft`, one in flight per tile, the echo back to its tile, the client row |
| next/packages/libfabrika/src/runtime/Window.ts | build | 15 | 1 | a tile machine's `draft` Cmd beside `press` |
| next/packages/libfabrika/src/transport/ClientRows.ts | build | 8 | 1 | the `draft` record case |
| next/programs/fabsh/package.json | build | 30 | 1 | the new package `@kampus/fabsh`, exports `.`, `./read`, `./window` |
| next/programs/fabsh/tsconfig.json | tests | tests | 1 | its type check, as checklist's |
| next/programs/fabsh/src/program.ts | build | 200 | 1 | the program and its machine (slice 2 adds about 110) |
| next/programs/fabsh/src/read.ts | build | 170 | 1 | `read`, `complete`, `recall` (slice 2 adds about 40) |
| next/programs/fabsh/src/tile.ts | build | 110 | 1 | the tile machine |
| next/programs/fabsh/src/window.tsx | build | 170 | 1 | the view on Manti (slice 2 adds about 30) |
| next/packages/tuval/src/window/style.css | build | 50 | 1 | the line, its span layer and the scrollback |
| packages/fabrika-design/tokens/color/role-verb.toml | tests | 10 | 1 | a role token, value from the look step |
| packages/fabrika-design/tokens/color/role-keyword.toml | tests | 10 | 1 | a role token |
| packages/fabrika-design/tokens/color/role-name.toml | tests | 10 | 1 | a role token |
| packages/fabrika-design/tokens/color/role-unknown.toml | tests | 10 | 1 | a role token, a status hue never alone |
| next/apps/fabrika/src/table.ts | build | 1 | 1 | `fabrika/fabsh` in the program table |
| next/apps/fabrika/src/runtime.ts | build | 1 | 1 | `fabsh:1` in the bootstrap, the seam until tezgah starts it |
| next/apps/fabrika/src/entry/views.ts | build | 8 | 1 | the `fabsh:1` tile beside `checklist:1`, the seam |
| next/apps/fabrika/package.json | build | 1 | 1 | the `@kampus/fabsh` dependency |
| boundary-rules.json | tests | tests | 1 | `next/programs/fabsh` is a `next-program` |
| pnpm-lock.yaml | tests | tests | 1 | the new workspace package |
| next/programs/fabsh/src/read.laws.test.ts | tests | tests | 1 | L1, L2, L15 |
| next/programs/fabsh/src/program.laws.test.ts | tests | tests | 1 | L2, L7, L13, L14 |
| next/programs/fabsh/src/tile.laws.test.ts | tests | tests | 1 | L4, L5, L12, L19 |
| next/programs/fabsh/src/window.laws.test.ts | tests | tests | 1 | L3, L16 |
| next/packages/libfabrika/src/runtime/Program.types.test.ts | tests | tests | 1 | L9 |
| next/packages/libfabrika/src/runtime/RunnerDraft.laws.test.ts | tests | tests | 1 | L6, L7, L8 |
| next/packages/libfabrika/src/gateway/GatewayDraft.laws.test.ts | tests | tests | 1 | L10, L11 |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | tests | 1 | L12, L19, at the parent |
| next/apps/fabrika/e2e/fabsh.test-support.ts | tests | tests | 1 | L17's suite and its two backends |
| next/apps/fabrika/e2e/fabsh.test.ts | tests | tests | 1 | L17 and L18; slice 2 adds L26 and L27 |
| next/packages/libfabrika/src/runtime/Programs.ts | build | 30 | 2 | the `programs` built-in Cmd |
| next/packages/libfabrika/src/runtime/Programs.test.ts | tests | tests | 2 | L24 |
| next/programs/fabsh/src/start.laws.test.ts | tests | tests | 2 | L20, L21, L22, L23, L25 |
| next/apps/fabrika/src/fabsh-start.laws.test.ts | tests | tests | 2 | L28, after 953 |
| next/programs/tezgah/src/program.ts | build | 40 | 2 | only if the desk lane leaves `show` out: the one input, the seam |
| .glossary/TERMS.md | build | docs | 1 | rows `draft (fabsh)` and `echo`, under Clients |
| docs/plan/tier-1.md | build | docs | 1 | step 3's row and the fabsh line in what done means (0013) |
| docs/plan/README.md | build | docs | 1 | where we are now |

## Host-only laws, shots and the look

- **Host-only laws:** L18 and L27, the suites on the real built Electron app. They need P19's
  Electron client (P19 slice 3, not on main), so they are owed until it lands, and the fabsh row is
  not done until they pass (0159's third amendment). When they run, they run before the first
  review, and on the owner's Mac only after the lead reads their signal and launchd lines and the
  owner says yes ([0178](.decisions/0178-host-only-laws-run-first.md)). Nothing else here
  needs the real machine: the browser and headless suites run in CI's end-to-end job.
- **The look step, before slice 1's pull request opens:** 3 or 4 designs of the fabsh tile (role
  colors, the line, the scrollback), shot next to Linear's command menu, and the owner picks one
  ([the guidelines skill, step 5](.claude/skills/guidelines/SKILL.md#5-build-3-or-4-designs-and-look-at-them-next-to-linear)).
- **Shots, never committed** ([0160](.decisions/0160-pr-shots-are-never-committed.md)):
  Playwright on the real built app, a test home of its own in a temp folder, written under `runs/`
  and attached by the lead with alt text. States: an empty line; `hlep` with its reason; `help`'s
  answer in the scrollback; the link lost with a typed line still drawn; slice 2 adds counter
  opened beside fabsh and a crashed tile kept with its reason. Layouts: one tile filling the window,
  two side by side, two stacked, a 2x2 grid, and a small app window at 1024x700. With the desk
  branch underneath, the layouts come from tezgah's splits. Without it, the fixed page makes only
  two side by side and the small window; the other three are owed to the desk lane's merge, and the
  pull request says so.

## Records

- **Saved:** each submitted line, as a letter, with its writer, `parent`, `traceId`, `sentAt` and
  `seen` (0261, 0262, 0225). The scrollback and history are its fold. Slice 2's start keeps its
  `started` line, and after 953 its `member`.
- **Recorded wide, on the client:** one `draft` row per submitted line: frames sent, echoes
  received, the slowest echo in ms. Client clocks are measurements, never authority
  (`next/packages/libfabrika/src/transport/ClientRows.ts:26-29`). It holds no text.
- **On spans:** the submitted letter's existing span; the gateway's draft budget refusals as a
  count on the session's span. No span per frame, since a span per key at typing speed would load
  the span sink for no decision.
- **Never recorded, on purpose:** the keys and the text typed mid-line (0275, the ephemeral lane's
  rule).
- **What fact is lost if it is not recorded now:** how fast the echo is on real use. The 14 ms in
  0275 is from experiment 150 on a fake delay. The `draft` row is the only place that number can
  come from, and rows written before it exists never get it, so it lands in slice 1. The text typed
  and abandoned is lost by design.

## Validation

- The tests step and the build step run `pnpm format`, `pnpm lint`, and narrow vitest paths under
  `nice -n 15 pnpm exec vitest run --maxWorkers=3`: the fabsh package's laws, `RunnerDraft`,
  `GatewayDraft`, `WindowMachine.laws`, `Program.types`.
- The lead, outside any box, runs the changed set and one type check, since the lockfile changes
  and makes the changed set the whole suite: the lead runs the narrow paths of the touched tests
  and of the tests that read the lockfile's packages, then CI is the full check.
- CI's end-to-end job runs `next/apps/fabrika/e2e/fabsh.test.ts` (L17, then L26). New test files
  land in CI's shard table at 1 s each until measured (see the shard finding of 2026-11-13).

## Size

1. Slice 1, fabsh in a tile: about 1,170 lines. The library's draft frame and its gateway method
   are about 390; the fabsh package is about 650; style, tokens and wiring about 130. It needs only
   P18 slice 1, already on this branch.
2. Slice 2, start a program: about 250 lines, plus about 40 in tezgah if the desk lane leaves
   `show` out. It needs ticket 953's slice 2, the desk lane, and P18's slices 2 to 4.

How sure: 55%. The doubt is the runner's permit and the Project-to-Process call for a frame that
saves nothing, which no code path does today, and how much of tile hosting the desk lane already
brings. Agent hours, at 600 lines an hour: about 2 for slice 1 and 0.5 for slice 2, before steps.

Estimate: 8 steps, $20

## What this cannot tell us

- How the echo feels on the cloud instance. Experiment 150 measured 14 ms on a fake 80 ms delay in
  a browser desk, not this design; the `draft` row will measure it.
- Whether a second window on the same workspace should see the line being typed. This plan echoes
  a draft only to the window that sent it; the ephemeral lane could fan it out, as tmux mirrors a
  pane, but nothing here decides that.
- Whether Manti's `Input` with a span layer behind it reads well in VoiceOver and in an IME. Law
  L16 checks the accessible tree, not a real screen reader run; that run is owed with the shots.
- What the desk lane already offers. The seam table is written against P18's branch as it is.
- Whether the draft budget's default fits real typing (open question 6).

## Open questions

1. **S1's walk.** Should slice 1 build S1's spans and roles now, as the lead's reading in Tier 1
   puts it (`docs/plan/tier-1.md:77-80`), before the owner's walk of S1 that the plan README asks
   for? The lead's lean, for the owner to read: yes, with the five roles above, 85%, the note's own
   number. The doubt S1 names: whether roles pay for themselves before a second keyword-heavy
   command. Here they also carry the error mark and Tab, so they do.
2. **Which built-in words fabsh has now** (listed as not decided in 0159). The lead's lean, for the
   owner to read: `help`, `clear` and `history` in slice 1; a program word with `as`, `programs` and
   `exit` in slice 2; `ps`, `jobs`, `tell`, `stop` and `attach` with their own tickets, 75%. The
   doubt: `ps` is the shell's most used look at running work, and the process list it reads exists
   (`processes/ProcessManager.ts:87`), but a program has no Cmd to read it yet.
3. **Where the line being typed lives** (flagged at the top). The lead's lean, for the owner to
   read: in the process's memory, beside its saved model, on the ephemeral lane, never in the saved
   model, 75%. The doubt: 0275's words say "in its model", and the owner may have meant the saved
   model, which would need 0229's replay test to skip the line and the ephemeral lane's rule to bend.
4. **Where a started program shows.** The lead's lean, for the owner to read: a new tile beside
   fabsh's, with focus moving to it on the Enter that asked (G3 R3, G4 R2, tmux's `split-window`,
   the glossary's "each program in a line shows in a tile"), 70%. The other reading: fabsh's own
   tile shows it, as the desktop layer's `attach build:7` example does, which loses the shell from
   that tile until the program ends.
5. **The role colors.** The lead's lean, for the owner to read: four new tokens in the shared design
   package (`role-verb`, `role-keyword`, `role-name`, `role-unknown`), with values picked by the
   owner in the look step, and `unknown` always paired with an underline and words, 70%. The doubt:
   whether existing text tokens (primary, faint) and one status hue are enough, which the look step
   settles.
6. **The draft budget's default.** The lead's lean, for the owner to read: 1,200 frames per
   60-second window per key, twice a fast typist's 10 keys a second (about 120 words a minute in
   Dhakal and others, "Observations on Typing from 136 Million Keystrokes", CHI 2018; not fetched),
   60%. A frame per round trip at most keeps real use well under it. The `draft` client rows measure
   it, and the number is changed by one setting.

## Findings

```json
{"_tag":"finding","id":"2026-11-14-tier-1-fabsh-start-question-settled","date":"2026-11-14","by":"plan","model":null,"rule":"doc_drift","location":{"path":"docs/plan/tier-1.md","line":206},"says":"Tier 1's step 2 still lists how fabsh may start any program, when a start right names one exact pair, as open with no decision found, and the walks table repeats it for step 2, but decision 0170 (2026-11-13) settled it: a start is checked against the member whose input caused it, and fabsh holds no permission of its own.","proof":"docs/plan/tier-1.md:206 says 'How `fabsh` may start any program when a start right names one exact pair (open; no decision found)', and docs/plan/tier-1.md:330 lists 'how `fabsh` may start any program' as an owner walk before step 2; .decisions/0170-a-start-is-checked-against-its-sender.md, status accepted, date 2026-11-13, decides 'A start is checked against the member whose input caused it' and 'fabsh and the desk hold no start permission of their own'.","cost":"A planner or the owner may spend a walk on a settled call, or plan a fabsh grant that 0170 forbids.","head":"aca53a7ad0004c1f4d609f34c32fe698d385047d","ticket":null,"pr":null}
```
