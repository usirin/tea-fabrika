---
date: "2026-11-01"
summary: "Reading, plus one probe. The makers record what code cannot work out again and replay the rest. `seen` is half decided already as A3's `saw`, which is the view's counter and on window Msgs only; one `seen` on every entry, decided 2026-11-01 at 85%. Today's lane passes the sync test: 300 lists at seed 190, 2,783 stops, 0 breaks in 88 ms; a planted field the schema drops broke 300 of 300. A version on saved state clashed with a decided note; the owner picked branch A, a number and a chain of named upgrades, at 60%. All six principles and the smaller calls decided 2026-11-01, each with its lean. No model, $0."
---

# Saved state, replay and what a writer saw: what do the makers do, and what holds for us?

Read 2026-11-01, against `main` at `7896ef38` and `next/` at PR 223's head `7c1d0730`. Mostly
reading, plus **one probe that ran**: GGPO's sync test on today's lane machine
(`190-saved-state.ts`, kept). It feeds [saved state, replay and what a writer saw](../docs/direction/saved-state.md),
a note the owner decided on 2026-11-01 with every lean and S3's branch A (it was proposed when this
was written), and a private page, "Saved state guidelines". It takes the top five ideas of
[experiment 189](./189-games-study.md) and checks each against what is settled.

## The answer

**The makers agree on one rule: record what code cannot work out again, and replay the rest.**
Games record inputs (GGPO, Riot), sync engines record what each writer had seen (Automerge's
`deps`, Git's parents), and durable workflows record each answer and each named patch (Temporal).
Everything else is folded again from those. Our notes already say this for drafts and facts.
Three of 189's five ideas fit inside what is decided; one clashes with a decided note; one is
already half built under another name.

- **`seen` is half decided already, as `saw`.** [A3](../docs/direction/the-cloud-is-one-more-host.md#a3-how-a-window-shows-a-process)
  (decided 2026-10-31) says "Every Msg from a window carries `saw: <rev>`", and PR 223 built it.
  But that `saw` is the view's own counter (the process inbox's `pos`), sits inside the program's
  Msg, and is on window Msgs only. An agent's write, a process's step and a hands' write carry
  nothing. The lean: one `seen` on D3's envelope, the log's `rev`, on every entry.
- **The sync test ran, and today's lane passes it.** 300 Msg lists at seed 190, a stop at each of
  2,783 steps, every phase reached: 0 breaks, in 88 ms. A planted field the schema does not keep
  broke 300 of 300 lists at the first step after the claim. It is one per-step law in tea's own
  `propertyInvariant` shape, so today's lane laws and `next/` can share it.
- **The version clash is real but smaller than 189 says.** The decided note's own words leave the
  door open: "A version only matters if old state must be carried forward, and tea's `upcast` is
  the place for that, when it comes." Hot reload's H3 carries state forward, so "when it comes" is
  Tier 1. Both branches go to the owner.
- **A step's declared reads fit code steps, not agent steps.** Bazel's sandbox is the known way;
  an agent picks its own files, so its key stays a hand list.
- **A first-divergence report is the P6 fold law's failure message,** written for a person. It
  costs little once the law exists.

```text
how each maker read keeps what cannot be worked out again, one line each
GGPO          save, load, advance one frame; the sync test rolls back every frame and compares
Riot (LoL)    records the server's inputs; logs a value only when it changes; "only the first divergence" matters
Factorio      a desync writes both saves and the log; migrations run once each, by name
Minecraft     a data version on every saved file; fixers keyed by that number
Unreal        a GUID and an int32 version per subsystem, saved with the asset
Erlang        code_change gets the old version; an appup names the upgrade, {advanced, Extra}
Elm           a Decoder reads saved data; oneOf tries several shapes
Automerge     every change lists the changes it depends on (deps)
Git           a commit names its parent commits
Kubernetes    a write names the resourceVersion it read; a stale one gets 409 Conflict
Temporal      patched() puts a marker in the history; replay against new code throws on a mismatch
Protobuf      no version: add fields, never reuse a number
Bazel         an action sees only its declared inputs; the cache maps an action's hash to its result
```

## What was read

- The sources 189 read and quoted (GGPO's site, Riot, Factorio, Minecraft, Unreal, Erlang,
  Bevy, Valve) are cited through 189 here, tagged, and not fetched again, except GGPO's
  developer guide and Erlang's appup cookbook, which were fetched today.
- New today: Automerge, Git, Kubernetes, Temporal (two pages), Protobuf, Bazel, fast-check and
  Elm's `Json.Decode` source. Each quote below was checked against the page text as fetched.
- Not readable: Lamdera's Evergreen docs (the page draws itself in a browser; nothing came back),
  and ShareDB's docs did not say what 189's summary implied, so neither is used. Axon's upcaster
  docs were found only through a search summary: **secondary**.
- Our side: the notes the brief named, today's `ledger.ts`, `memory.ts`, the lane machine and its
  laws on main, and PR 223's `next/` (`log.ts`, `process.ts`, `program.ts`, `window/machine.ts`,
  the counter).

## Recording what a writer saw

| Maker | What it records | Who checks it |
|---|---|---|
| Automerge [i1] | each change's `deps`: "The changes this change depends on" | readers order changes by it |
| Git [i2] | a commit names "the parent commits if any" | anyone; a parent must exist |
| Kubernetes [i3] | a write carries the `resourceVersion` it read | the server: "returns a `409 Conflict`" if stale |
| Valve [g8] | the shooter's view time, rewound by the server | the server bounds it (`sv_maxunlag`); **secondary** in 189 |
| Today's ledger | `expected`, the stream's count the writer read | the ledger refuses a stale one, then forgets the number |
| PR 223 (`next/`) | `saw`, the view's counter, inside window Msgs only | nobody; "each program decides" |

- **The plain way:** a single-leader log turns a version vector into one number. Automerge and
  Git need a set of parents because they have no leader. We have one referee (D1), so the last
  rev a writer had folded is the whole causal past it knew. This is my reading, not a quote.
- **Two uses, kept apart by the makers.** Kubernetes uses the number to decide (a conditional
  write) and does not keep it. Automerge and Git keep it and decide nothing with it. D1 already
  chose "`append` stays plain", so `seen` is the second kind: kept, bounded, never a lock.
- **The clash with a goal:** none. The data-shape rule names "what they saw" among write-time
  facts, and D3 has no field for it.

## Saving, loading and going on

- **GGPO [g1]:** the game gives three callbacks, `save_game_state`, `load_game_state` and
  `advance_frame`. "When running in a synctest session, GGPO will execute a 1 frame rollback for
  every frame of your game." It compares the two runs "and raises an error if they differ", and
  "you can diff the log of the initial frame vs the log of the rollback".
- **Temporal [i5]:** "Replay succeeds only if the Workflow Definition is compatible with the
  provided history from a deterministic point of view." A mismatch throws
  `DeterminismViolationError`.
- **fast-check [i9]:** model-based tests use `commands`, "an enhanced version of the array",
  which "can efficiently shrink failing scenarios". Our laws use tea's `@demlik/tea/pbt` on top
  of fast-check instead; it gives each law `{prev, msg, next, cmds}` per step (tea 0.21.0,
  `pbt/index.d.ts:190-195`).
- **Elm:** no maker answer for a sync test. Elm's model is a value, and elm-hot keeps it across a
  reload; the round trip is ours to check.

## Versions on saved state

| Maker | Version on the save | Upgrades |
|---|---|---|
| Minecraft [g2] | "a positive integer" data version on every file | fixers keyed by number, one step at a time (189's reading) |
| Unreal [g3] | "a unique GUID key with an int32 version number" per subsystem | the code reads by version |
| Factorio [g4] | the names of migrations already applied | each runs once, in a fixed order |
| Erlang [e1] [e2] | `vsn`, or "the checksum of the Beam file" if none | `code_change(OldVsn, ...)`; "`Vsn` is fetched from the 'original' version of the module, that is, the version you are upgrading from" |
| Temporal [i4] | "Using `patched` inserts a marker into the Event History" | a named patch per change |
| Axon [i10] | a revision beside the event type | upcasters from revision x to x + 1; **secondary** |
| Protobuf [i6] | none: "Adding new fields is safe"; "The same field number must not used again" | none needed while changes stay additive |
| Elm [e3] | none: `oneOf`, "Try a bunch of different decoders" | the decoder guesses by shape |

- **The plain way, for state carried forward:** a number and a chain (Minecraft, Unreal, Erlang,
  Axon), or a set of names already run (Factorio, Temporal).
- **The plain way, for messages that only grow:** no number; add fields, never reuse one
  (Protobuf). That is what T4 and D3 already do for ledger entries.
- **So the makers split by job,** not by taste. Entries grow additively and need no number. A
  saved model that a new shape replaces is the case every engine numbers.

## Declaring reads and writes

- **Bazel [i7]:** "Without action sandboxing, Bazel doesn't know if a tool uses undeclared input
  files". Its sandbox "runs processes in a working directory that only contains known inputs".
  Its remote cache keeps each action's result under the action's hash [i8] (a paraphrase; that
  page was read only through a summarizing reader).
- **Bevy [g7]:** a system's parameters say what it reads and writes, and the scheduler runs
  systems in parallel by that (189's quote).
- **Effect:** a step's requirements (`R`) already list the services it uses. That is the list
  for free, for a code step. It says nothing about which files an agent opens.

## Finding the first divergence

- **Riot [g5]:** logs a value only "on frames where the value changes", because "only the first
  divergence really matters"; logs, not checksums, since a checksum says that a split happened,
  not where.
- **Factorio [g6]:** a desync report "contains both the player's and server's copy of the save
  game" plus the log, and "does not state the cause".
- **GGPO [g1]:** diff the two logs of a frame.

## Today's ticket 117, stopped and restarted

The running example is ticket 117's lane, which stopped `stuck:step_stuck` at mutation and
restarts from its own state once the self-fix plan lands. Today's version unless it says `next/`.

| What | Today | Where |
|---|---|---|
| An entry's fields | `pos, stream, rev, writer, kind, at, data, id`: no writer's clock, nothing on what was read | `packages/fabrika/src/host/ledger.ts:182-191` |
| A stale write | `append(stream, expected, ...)` refuses when the stream moved | `ledger.ts:308-317`, `memory.ts:126` |
| The read number after that | not kept: the row is built without it | `memory.ts:127-136` |
| What `rev` means | the stream's count; `pos` is the log's place (D3 has these the other way round) | `memory.ts:125-130` |
| The lane's saved model | `Lane`, a schema union on `phase`, seven phases | `packages/pipeline/src/stages/pipeline/machine.ts:234-271` |
| Boot from a save | `init: (loaded) => [loaded ?? {phase: "idle"}, []]`; `resume` sends the kept Cmd again | `machine.ts:652`, `machine.ts:659-662` |
| The lane's laws | `propertyInvariant`, a law per step, `{numRuns: 300, seed: 7}` | `machine.laws.test.ts:105`, `:124` |
| A step's key | `intentOf("lane", number, count, step)`: by place, not by input | `machine.ts:513` |
| A saved state on load | decoded by its schema, refused if it does not fit; no version | `packages/fabrika/src/program/storage.ts:76`, `:497` |
| `next/`: what a window saw | `saw: model.views[pid]?.rev ?? 0`, the inbox `pos` of that view | PR 223, `next/src/window/machine.ts:185-189` |
| `next/`: the entry | `id, stream, pos, rev, at, by, said, kind, body`: `said`, no `seen` | PR 223, `next/src/data/log.ts:15-25` |

Checked against each idea:

- **`seen` on every entry: breaks** today (no field; `expected` decides and is dropped), **half**
  in `next/` (`saw` on window Msgs, the view's counter, not checked).
- **The sync test: passes** on today's lane, measured below.
- **A version on saved state: follows the decided rule** (the schema is the check). It would
  break 189's idea, by design.
- **Declared reads: breaks.** The key is by place (`machine.ts:513`); P7's input key is planned
  for PR 5, written but not read.
- **First-divergence report: not built.** PR 5's fold law is planned; its failure today would be a
  vitest deep-equal diff of two whole carries.

## The probe: GGPO's sync test on today's lane

```ts
// 190-saved-state.ts, the law in one block. `straight` is the run that never stopped.
for (let k = 0; k < msgs.length; k++) {
	const loaded = decode(JSON.parse(JSON.stringify(encode(straight.states[k])))); // the Lane schema
	const resumed = foldEvents(lane, undefined, loaded, msgs.slice(k)); // through init(loaded)
	same(resumed.states, straight.states.slice(k)) && same(resumed.cmds, straight.cmds.slice(k));
}
```

| Machine | Lists | Stops | Broke | First break | Time |
|---|---|---|---|---|---|
| `lane`, today's | 300 | 2,783 | 0 | none | 88 ms |
| `lane` with a planted field the schema drops | 300 | 1,200 | 300 | step 3, right after the claim | 27 ms |

- Seed 190, lists of the three opening Msgs plus 1 to 60 random ones, the same Msg table as
  `machine.laws.test.ts`. Every phase was reached: running 1,253 times, releasing 497, over 275,
  asking 158.
- Run on Node 26.12.0, tea 0.21.0, Effect 4.1.1 (the installed one; Tier 1's text says 4.0.6),
  in a worktree, under `nice -n 15`. No model, no key, $0. The script is kept.
- **What it shows:** today's `Lane` schema keeps every field the reducer reads, and `init` plus
  the rest of the list rebuilds the same run. **What it does not show:** that `resume` after a
  real crash does the right thing in the program, since the probe never crashes a Cmd mid-flight.

## What this tells us for fabrika

1. **`seen` goes in D3 now,** before Tier 1's first real note. It is cheap, and it is the one fact
   here that is gone for good if the first entries lack it.
2. **The sync test becomes a shared law,** one helper over tea's `Step`, in `next/`'s kit and in
   today's laws.
3. **The version question is the owner's,** with two branches: a number and a chain, or keep the
   schema as the only check and a shape guess for the rare case.
4. **Declared reads are for code steps;** agent steps keep P7's hand list and its property test.
5. **The divergence report is the fold law's failure message,** then a live check once D5 makes
   two folds of one log.

## What it cannot tell us

- **Whether `seen` will be read.** Nothing reads it in Tier 1 except the referee's bound. Record
  wide says that is fine; the cost is one field.
- **Whether the sync test finds a bug in `next/`.** It ran on one machine of today's version, which
  passed. `next/`'s machines are not on main.
- **How often a shape changes.** Nobody has counted shape changes per program, so the version
  branch rests on what engines do, not on our data.
- **Whether a lane in `next/` will look like today's.** It is not designed.
- **Several sources are second hand** (Valve and Axon), and Lamdera, the Elm-world answer most
  likely to back a version chain, could not be read.
- **This study's own agent time** was about 2 agent hours of one session; no model was called
  for the probe.

## Links

- [g1] GGPO developer guide: https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md
- [g2] Minecraft data version, via [189](./189-games-study.md#1-save-systems-and-checkpoints): https://minecraft.wiki/w/Data_version
- [g3] Unreal FCustomVersion, via 189: https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FCustomVersion
- [g4] Factorio migrations, via 189: https://lua-api.factorio.com/latest/auxiliary/migrations.html
- [g5] Riot, fixing divergences, via 189: https://www.riotgames.com/en/news/determinism-league-legends-fixing-divergences
- [g6] Factorio wiki, desync, via 189: https://wiki.factorio.com/Desync
- [g7] Bevy ECS, via 189: https://bevy.org/learn/quick-start/getting-started/ecs/
- [g8] Valve lag compensation, via 189, **secondary**: https://developer.valvesoftware.com/wiki/Lag_Compensation
- [e1] Erlang gen_server, via 189: https://www.erlang.org/doc/apps/stdlib/gen_server.html
- [e2] Erlang appup cookbook: https://www.erlang.org/doc/system/appup_cookbook.html
- [e3] Elm Json.Decode: https://package.elm-lang.org/packages/elm/json/latest/Json-Decode#oneOf
- [i1] Automerge binary format: https://automerge.org/automerge-binary-format-spec/
- [i2] Git objects: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
- [i3] Kubernetes API concepts: https://kubernetes.io/docs/reference/using-api/api-concepts/
- [i4] Temporal TypeScript versioning: https://docs.temporal.io/develop/typescript/workflows/versioning
- [i5] Temporal TypeScript testing: https://docs.temporal.io/develop/typescript/testing-suite
- [i6] Protobuf proto3 guide: https://protobuf.dev/programming-guides/proto3/
- [i7] Bazel sandboxing: https://bazel.build/docs/sandboxing
- [i8] Bazel remote caching: https://bazel.build/remote/caching
- [i9] fast-check model-based testing: https://fast-check.dev/docs/advanced/model-based-testing/
- [i10] Axon event versioning, **secondary**: https://docs.axoniq.io/reference-guide/axon-framework/events/event-versioning
