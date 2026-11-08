# Replay a machine run through today's code (phase 1)

**Today's version** (`@kampus/fabrika-old`, `programs/trace`, `apps/fabrika`). Nothing in `next/`
changes. Approved by the lead agent, builds
[a JobRecord holds its trace](../direction/a-job-record-holds-its-trace.md#every-step-is-kept-and-the-tile-opens-it)
and the owner's split of 2026-11-08: tea owns what a recording is, its diff and its replay; fabrika
owns where a recording is kept and how it looks. The owner's brief asked the build to pick the
start's shape and say why; that choice is below, with its reason.

```ts
// A person opens any past machine run in `trace` and presses "Replay through current code".
// Nothing is wired per program, and no Cmd runs.
replayed {row: "machine:[tally:…, count, total]", answer: {_tag: "matches", steps: 3}}
replayed {row, answer: {_tag: "parts", n: 2, msg: {type: "add", n: 2},
                        path: "state.total", recorded: 3, replayed: 4}}
replayed {row, answer: {_tag: "refused", n: 1, msg: {type: "add", n: 1}, state: "add", accepts: []}}
replayed {row, answer: {_tag: "cannot", why: "no_start", n: null}}   // recorded before starts were kept
```

## The Elm answer

Elm's debugger imports a history and folds its Msgs through `update` again from the history's
own initial model, keeping only the model and dropping the Cmds:

- Ref: elm-lang/virtual-dom 2.0.4, `src/VirtualDom/Debug.elm:244-251` — "initialUserModel =
  History.initialModel model.history" and "pureUserUpdate msg userModel = Tuple.first
  (userUpdate msg userModel)".

tea's `replayTrace` is the same: it folds `msgs` from `loaded` "without calling init, Cmd
handlers, Store operations or Sub runners" (tea 0.26.0, `dist/persistence/index.d.ts`). What Elm
keeps that we did not: the initial model. Today no row keeps where a machine run started
(`programs/trace/src/trace.test.ts`, "shows the first step's state before as the machine's
start, which no row keeps"). Step 1 below keeps it.

## 1. Every start of a kept machine run is kept

`runKept` already hears the boot (`packages/fabrika/src/program/kept.ts`, `booting.onBoot`), and
drops it. It now writes it, in the same ordered queue as the steps, so a start always lands before
the steps after it.

```ts
// A new call on the record, beside `step`
{op: "start", run, program, machine, id, at, state}   // state: as the kind's schema encodes it

// A new table, written by the record, never replaced
starts: {run, machine, id, n, after, program, at, body, by}
//   n      1, 2, 3 … per machine run: which start this was
//   after  how many steps of this machine run the record held when it came: the record counts,
//          the writer does not say (0 for the first start)

// Read beside the steps
JobTrace.starts: Start[]   // {run, program, machine, id, n, after, at, state, by}, by run, machine run and n
```

**The shape picked, and why.**

- **Every boot, not only the first.** A restart boots from the kept state, and the kept state can
  be one step behind or ahead of the step rows: the step write and the save are two writes, and a
  crash can land between them. With only the first start kept, a replay across that restart would
  fold from the wrong state and blame today's code for it. With every start kept, the adapter sees
  it: start 2's state is not the state step `after` left, and it answers `cannot restarted`, never
  a guess. This is the repo's "record wide" (AGENTS.md, "Record wide, read later": "record every
  measure we can, even if nothing reads it yet") and "data shape first": a restart's boot state is
  a fact lost forever if it is not written then. The brief said "once per machine run"; this keeps
  that one and the later ones.
- **Its own table, not a step with no Msg.** tea's own JSONL puts the boot first in its own kind
  of line (`{kind: "boot", state}` then `{kind: "step", msg, state}`, `Recorder.toJSONL` in tea
  0.26.0). A step row with a null Msg would make every reader of `steps` (the tile, `stepBytes`,
  the patch chain) learn a special case.
- **It names its program.** The replay needs the program's code, and a run id does not reliably
  name its program (`keeping.id` can be anything, such as `lane:700`; `program.ts` makes
  `${program.name}:${uuid}` only when none is given). The program that boots the machine knows its
  own name (`refsOf(program, …)` in `packages/fabrika/src/program/refs.ts`), so it writes it.
- **The state whole, never a patch.** One row per boot is small next to the steps.
- **A record read by older code still decodes.** `RecordRead.starts` decodes a missing key as `[]`
  (`Schema.withDecodingDefaultKey`), as `RunRecord.deadLetters` does.

While here: tea 0.26.0's `observe` hands each transition's Cmds (`observe(observer: (msg, state,
cmds?) => void)`), so `runKept` takes them from there and drops its second fold
(`foldUpdates(machine, before, [msg]).cmds`). A test pins that a step's Cmds are the ones its
transition started.

## 2. The adapter: one machine run's rows to a tea `Trace`, and the answer

Pure, on the package's top level (no platform): `packages/fabrika/src/host/replay.ts`.

```ts
// A sketch.
export const Replayed = Schema.TaggedUnion({
	matches: {steps: Schema.Int},
	parts:   {n: Schema.Int, msg: Schema.Unknown, path: Schema.String,
	          recorded: Schema.Unknown, replayed: Schema.Unknown},   // path starts "state" or "cmds"
	refused: {n: Schema.Int, msg: Schema.Unknown, state: Schema.String,
	          accepts: Schema.Array(Schema.String)},
	cannot:  {why: Schema.Literals(["no_start", "no_code", "state_refused", "restarted", "threw"]),
	          n: Schema.NullOr(Schema.Int), detail: Schema.String},
});

// The code: the kept machines of the programs a host lists, by program and machine name.
replayOf(code, {starts, steps}): Replayed
//   no start, or the first start's `after` is not 0   cannot no_start  ("recorded before its start was kept")
//   no program or no machine of that name             cannot no_code   (detail: which)
//   a start's or a step's state its schema refuses    cannot state_refused (n: the step, 0 for a start)
//   a later start whose state is not what step `after` left   cannot restarted (n: after)
//   today's update throws                             cannot threw (detail: its message)
//   else: Trace {loaded: first start's state, msgs, finalState, steps: [{msg, state, cmds}]}
//         replayTrace(kind.machine, trace)  ->  matches | parts (n = divergence.at.index + 1) | refused
```

- States are decoded with the kind's own state schema (`Kind.state`), as storage reads them. Msgs
  and Cmds go in as the record keeps them (their JSON): no kept machine in today's code has a Msg
  schema (no `Machine.make` outside `next/` and tests; every kept machine is a `defineMachine`).
- `n` is the record's step number, from 1. `parts` names the step, the path and both values;
  `replayTrace` compares a step's State first and its Cmds after (`firstDivergence(recorded.state,
  state, "state") ?? firstDivergence(recorded.cmds, cmds, "cmds")`), so the path says which.

## 3. The button, in `trace`

```ts
// The program's new input, and the machine's Msgs
replay   {row}                          // a machine run's row: replay it through today's code
replayed {row, steps, answer: Replayed} // the Cmd's answer

// Model gains one field: the replay asked last, and its answer once it came
replay: {row: RowKey, steps: Int, answer: Replayed | null} | null
//   look      clears it; got keeps it while that machine run's step count is the same, else clears it
//   replay    a row that is no machine run in the record changes nothing
```

- A Cmd (`Cmd.make` from `@demlik/tea/effect`) carries the machine run's rows; its handler asks a
  `Replayer` service, built once from the host's program list (`layerReplayer(entries)`). No
  `Replayer` given (a test, the shots): it answers `cannot no_code`, as `factsRunner` answers a
  ticket with no ledger (`programs/trace/src/index.ts`).
- The app hands `trace` a `Replayer` over the same list a tile's tsh lists (`tshList` in
  `apps/fabrika/src/tsh.ts`). The lane's stage programs run in the pipeline's own runner and are
  not in that list, so their machine runs answer `cannot no_code` and name the program.
- **Where the button sits:** in the machine run's detail, not inside its row. The row is already a
  button (open, choose); a button inside a button is invalid, and a screen reader reads it as one
  control (WAI-ARIA 1.2: a `button`'s children are presentational). The row carries the answer as
  words with an icon: "matches at every step", "parts at step 2", "no cell for step 1".
- The answer shows in the detail as text in a `role="status"` region, so it is read out when it
  comes. The parting step's row says "parts from the recording", the refused one "no cell in
  today's code". Color is never the only cue (WCAG 1.4.1).
- The first step's "before" is now the kept start (`{kind: "kept", state}`), and its changes are
  shown against it. A record with no start still says `{kind: "start"}`.

**How Linear would build it, on our pieces.** The action lives where the object is open: the
detail panel's header, with a keyboard shortcut, and the answer comes back as one line in place,
never a modal. A list row gets an icon and a word, never a second action. We match that. Where we
differ: Linear has no replay; the step list and before/after layout come from Elm's debugger and
Redux DevTools, as the tile already does.

**Shots**, from the built app, as `apps/fabrika/e2e.ts` drives it: matches, parts, refused and
`cannot no_start`, each in one tile, two side by side, two stacked, a 2x2 grid and a 1024x700
window, saved in `programs/trace/docs/`, each looked at and named in the PR.

## 4. Proof on a real run

`seq --to 3 | tally` through a real tsh, the host's job table and `sqliteRecords` (the app's own
pieces, as `packages/fabrika/src/shell/trace/records.test.ts` runs them), then replayed:

- (a) through `tally`'s own `count`: `matches`, 3 steps
- (b) through a `count` whose `add` adds `n + 1`: `parts`, n 1, path `state.total`, recorded 1, replayed 2
- (c) through a `count` with no `add`: `refused`, n 1, accepts `[]`
- `seq --to 25 | tally`, 25 Msgs, replayed twice: the same answer both times, deep equal

Plus: a record with steps and no start answers `cannot no_start`; a restart whose boot state is not
the last step's answers `cannot restarted`; a kept state the schema now refuses answers `cannot
state_refused`.

## Steps, by hand

Plan (this file, the lead agent), test writer, build, mutation (a fixed-seed sample of about 150,
seed 119120), one review, each its own agent, each logged in `field/runs.jsonl`. The `commits`
check wants signed step notes (P32); no agent here can sign, so the owner signs.

## Doubts

- **A Msg or Cmd whose JSON is not itself** (a `Date`, a class instance, a `Redacted`) replays as
  its JSON, so a replay can part where the live run did not. 85% sure no kept machine today has
  one: their Msgs come from inputs and Cmd answers decoded by Effect schemas into plain data. The
  answer names the path and both values, so such a case is seen, not hidden. What would settle
  it: replaying every machine run of a week of real records through unchanged code.
- **Size of a start row** for the tracker's big state: one per boot, so small next to the steps.

## What this cannot tell us

- Whether a replay that matches means the code is right: it means today's code makes the same
  states and Cmds from the same Msgs, nothing more.
- Records written before this lands have no starts, so none of them can be replayed.
