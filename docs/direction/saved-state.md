---
state: "decided 2026-11-01"
summary: "`next/` first. Six principles: every entry says the last rev its writer had folded (`seen`, bounded by the referee, before Tier 1's first real note); every machine passes GGPO's sync test; a saved model carries its shape's number and a chain of named upgrades (branch A, which walks back \"no version number on each machine\" for carried state); a code step's key is built from its declared reads; the first place two folds part is written down; a replay re-runs code, never an agent."
---

# Saved state, replay and what a writer saw

**Decided 2026-11-01 by the owner.** After a walk, the owner approved all six principles and the
five smaller calls, each with its lean, S3's branch A included. Each lean keeps its number: one
under 80% is decided but still names its doubt and what would settle it. It stands on points the
owner already decided, each named where it is used: D3's entry with `said` and `at` (2026-10-30; renamed `sentAt` and `arrivedAt` by the owner on 2026-11-05), A3's
`saw` on window Msgs (2026-10-31), hot reload's H2 and H3 (2026-11-01), "no version number on each
machine" ([an old host is named, then restarted](./an-old-host-is-named-then-restarted.md),
2026-10-25), the pipeline guidelines' P4 to P7 (2026-11-01), and record wide (2026-11-01). The
owner approved [experiment 189](../../experiments/189-games-study.md) and asked for this study over
its top ideas, `seen` first.

Its decided rules are in: [0225](../../.decisions/0225-entries-carry-what-writers-saw.md),
[0226](../../.decisions/0226-every-machine-passes-sync-test.md),
[0227](../../.decisions/0227-saved-state-carries-shape-number.md),
[0228](../../.decisions/0228-code-step-keys-from-reads.md),
[0229](../../.decisions/0229-diverged-names-first-difference.md),
[0230](../../.decisions/0230-replay-reruns-code-only.md).

Built from [experiment 190](../../experiments/190-saved-state.md), which read about twenty makers
and ran GGPO's sync test on today's lane, and a private page, "Saved state guidelines". Neither is a
measurement of `next/`; the one probe ran on today's version. Tags such as [g1] and [i3] are
experiment 190's links.

```ts
// A sketch, next/. Ticket 117's lane, kept the way this note proposes.
// S1: every entry says the last rev its writer had folded. Code fills it; the referee bounds it.
{id: "c-3", stream: "ticket:117", pos: 9, rev: 412, arrivedAt: "23:12:04", by: "mac@owner",
 sentAt: "23:10:01", seen: 409, _tag: "commented", body: {text: "also fix the label"}}
// S2: one law every machine runs. Stop at any step, load, go on: the same run as no stop.
syncTest(lane, {state: Lane, msgs: laneMsgs, seed: 190});
// S3, branch A: a saved model carries its shape's number and a chain of named upgrades.
// S5: the fold and the saved model disagree, so the first place they part is written down.
{_tag: "diverged", body: {case: "fold_vs_saved", rev: 407, path: "carry.exam", fold: "5d38d582", saved: null}}
```

```text
One comment, while build round 2 runs on ticket 117:
1. The window shows ticket 117's view, built from the log up to rev 409.
2. The owner writes "also fix the label" and presses send. The window puts seen: 409 on the letter.
3. The door stamps by. The referee's head is 411; seen 409 is not past it, so it appends at rev 412.
4. Build's head landed at rev 410. So the ticket can say, by a fold: written before round 2's head.
5. P5's `during` (the run that was live) is the run live at rev 409: a fold, not a stored field.
```

## Which version

- **`next/`:** all six principles. S1 is time-bound: Tier 1's order of work says "Words and fact
  shapes are settled before real facts get written, which is the first real note"
  ([Tier 1](../plan/tier-1.md#the-order-of-work), item 6). Nothing from `next/` is on main; PR 223
  has `saw` on window Msgs.
- **Today's version:** two tryouts are offered for the self-fix plan's PR 5 (below). Today's ledger
  gets no `seen`: today's lane keeps P5's `during`, and today's ledger goes when `next/` takes over.

## The shape

```ts
// next/packages/libfabrika/src/data/log.ts, a sketch: D3's entry with one more field.
const Rev = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Entry = Schema.Struct({
	id: Schema.String,
	stream: Schema.String,
	pos: Rev, // place in its stream
	rev: Rev, // place in the whole log
	arrivedAt: Schema.String, // the referee's clock: decides
	by: Schema.String, // stamped by the door
	sentAt: Schema.String, // the writer's clock: shown, never decides
	seen: Rev, // the last rev the writer had folded: bounded by the referee, may refuse a stale act
	_tag: Schema.String,
	body: Schema.Unknown,
});
// What a writer hands in. `seen` is required, so a writer cannot forget it.
export type Line = {readonly by: string; readonly sentAt: string; readonly seen: number; readonly _tag: string; readonly body: unknown};

// The referee, inside the one call that appends (D1): one check, nothing else.
const place = (head: number, line: Line) =>
	line.seen > head ? {_tag: "refused", why: "seen_ahead"} : {_tag: "placed", rev: head + 1};
```

- **Checked:** `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` is how today's code writes a
  count (`packages/fabrika/src/agents/acp/session.ts:18`), on Effect 4.1.1 as installed. PR 223's
  entry (`next/src/data/log.ts:15-25`) has every field above except `seen`, and `kind` for `_tag`
  until ticket 32.
- **Not checked:** the sketch was not compiled; `next/` is not on main.

## The six principles

### S1: every entry says what its writer had seen

**Decided 2026-11-01, 85%.** One field, `seen`, on D3's envelope: the log's `rev` of the newest entry folded into
what the writer acted from.

- **Who fills it:** libfabrika, never a program's author.
  - A window: the `ledger` rev of the view the act came from. PR 223 already keeps it on each view
    (`next/src/window/machine.ts:17-23`).
  - An agent, through MCP: the newest `ledger` rev any read answered it from.
  - A process: the rev of the letter it is stepping.
  - The referee's own entries (expired, dead): its head.
- **The referee's check:** `seen ≤ head`, in the same call that places the entry. Otherwise
  `seen_ahead`, and nothing is written. No lower bound and no "never goes back" check per writer:
  one key may run several windows, and a reload starts low.
- **What it may decide:** a bounded claim, not a proven one. A writer can claim any number up to
  the head. So a program may refuse a stale act with it, as A3's `saw` does now; leases, limits,
  money and grants use `arrivedAt` and fences only. That is why it may sit in deciding code's types,
  where `sentAt` may not.
- **Against `sentAt` and `arrivedAt` (D3, `said` and `at` until 2026-11-05):** three facts of one
  entry. `arrivedAt` is the referee's clock and decides. `sentAt` is the writer's clock, unchecked, shown. `seen` is the writer's place in the log,
  bounded by the referee.
- **Against P5's `during`:** in `next/`, `during` is a fold: the run live at `seen`. So `next/`
  stores `seen` and derives `during`, which also answers "what the person saw", P5's own reason.
- **Against today's `expected`:** today's `append(stream, expected, ...)` refuses a stale write
  and then forgets the number (`packages/fabrika/src/host/ledger.ts:308-317`,
  `memory.ts:126-136`). D1 keeps `next/`'s append plain, so `seen` is not a lock: it decides
  nothing at the referee except its bound. A note's `base` stays the notes program's own check.
- **Why:** "Kubernetes uses that `resourceVersion` information so that the API server can detect
  lost updates and reject requests made by a client that is out of date with the cluster" [i3].
  Automerge keeps "The changes this change depends on" on every change [i1]; Git keeps "the
  parent commits" [i2]. With one referee, that set of parents is one number.
- **Linear:** no Linear answer we could read: Linear does not publish what a write records about
  the client's place in its sync. A guess, marked as one: its client knows its own sync position.
- **Elm or OTP:** neither has it. An Erlang message carries what the sender puts in it. We leave
  both here on purpose: the known way is the sync engines'.
- **What holds it:** `Line` requires `seen`, so a writer that leaves it out does not compile. A law
  on the log: for any interleaving of writers, every entry has `seen < rev`. A window law: a press
  carries its view's `ledger`.
- **The doubt:** nothing reads it in Tier 1 except the bound, and an agent's "newest rev it was
  answered from" may overstate what it read. What would settle it: in Tier 1's notes, count saves
  whose `seen` is older than the note's last change.
- **Cost:** the field, the column, the check, three fillers and the tests: 50 to 80 lines, about
  0.1 to 0.15 agent hours at 600 lines an hour.
- **Today's ticket 117:** breaks. An entry has no field for it (`ledger.ts:182-191`).

### S2: every machine passes the sync test

**Decided 2026-11-01, 85%.** For any Msg list, with a fixed seed, at every step: encode the model with its state
schema, through text, decode it, boot with `init(loaded)`, fold the rest, and compare every later
model and Cmd with the run that never stopped.

```ts
// A sketch: one law in tea's own Step shape, so any law file can use it.
export const syncTest = <S, M, C>(machine: Machine<S, M, C>, opts: {state: Schema.Codec<S, unknown>; msgs: fc.Arbitrary<M[]>; seed: number}) => ...
```

- **What it holds at once:** P4 and P6 (a resume from the save is the same run), C4 (a restart is
  `init(loaded)`), H2 (a swap to the same code keeps the run). H3 needs a two-code version: old
  code saves, new code's `migrate` loads; the same helper with a `to` machine.
- **Why:** GGPO's sync test "will execute a 1 frame rollback for every frame of your game" and
  "raises an error if they differ" [g1]. Temporal replays a history against new code, and "Replay
  succeeds only if the Workflow Definition is compatible with the provided history" [i5].
- **Measured, today's version:** today's lane passes it. 300 lists at seed 190, a stop at each of
  2,783 steps, every phase reached: 0 breaks, 88 ms. A planted field the schema drops broke 300 of
  300 ([experiment 190](../../experiments/190-saved-state.md#the-probe-ggpos-sync-test-on-todays-lane)).
- **Where the helper lives:** decided 2026-11-01, 70% (smaller call 4), in tea's `@demlik/tea/pbt` beside `propertyInvariant`,
  taking `encode` and `decode` as plain functions, so tea takes on no convention of ours. Until tea
  ships it, a 40 to 60 line helper in libfabrika's test kit, deleted when tea has it.
- **Today's lane laws use the same shape:** `propertyInvariant` with a law per `{prev, msg, next,
  cmds}` (`machine.laws.test.ts:105`, `:124`), so the probe drops in as one more law file.
- **Linear:** no Linear answer: this is a test practice, not product behavior.
- **Elm or OTP:** Erlang's restart hands `init` the saved state; this checks that hand-off. Elm has
  no restart.
- **What holds it:** a machine's laws list gets the sync test by default, and a machine leaves it
  only by name, with a reason, as [every machine has laws](./every-machine-has-laws.md) asks.
- **The doubt:** a model that holds a function, a Date or a cache would fail it, rightly. Fixing
  what it finds is the unknown cost. One run over `next/`'s machines after PR 223 lands settles it.
- **Cost:** the helper, 40 to 60 lines, and one line per machine: under 0.2 agent hours.
- **Today's ticket 117:** follows. Its lane passes.

### S3: saved state carries its shape's number and a chain of named upgrades

**Decided 2026-11-01, 60%: branch A.** It walks back part of a decided note, for state carried
forward: [an old host is named, then restarted](./an-old-host-is-named-then-restarted.md) and
[hot reload](./hot-reload.md)'s H3 now say so.

A saved model is carried forward by hot reload (H2, H3) and by a restart (C4). Today's rule,
decided 2026-10-25: "No version number on each machine. The schema is the check. A version only
matters if old state must be carried forward, and tea's `upcast` is the place for that, when it
comes." H3 carries state forward, so "when it comes" is now.

```ts
// Branch A, decided: a number and a chain of named upgrades. The schema is still the last check.
export const state = {
	v: 3,
	schema: Schema.Struct({count: Schema.Number, step: Schema.Number}),
	upgrades: [
		{name: "n_to_count", from: 1, run: (m: {n: number}) => ({count: m.n})},
		{name: "add_step", from: 2, run: (m: {count: number}) => ({...m, step: 1})},
	],
};
// saved {v: 1, model: {n: 7}} -> n_to_count, add_step, then decode, then:
{_tag: "state.upgraded", body: {program: "counter", from: 1, to: 3, ran: ["n_to_count", "add_step"]}}

// Branch B, not picked: the rule before. One upcast from the shape before, chosen by looking.
export const upcast = (raw: unknown) => (isRecord(raw) && "n" in raw ? {count: raw.n} : raw);
// a model two shapes back that no upcast fits: refused, [Restart counter-1]
```

| | Branch A, a number and a chain | Branch B, the schema alone |
|---|---|---|
| What it undoes | "No version number on each machine", for carried state; H3's shape guess | nothing |
| The known way | Minecraft, Unreal, Erlang's `vsn`, Factorio and Temporal by name, Axon (secondary) | Elm's `oneOf`, Protobuf's "Adding new fields is safe" |
| Two shapes that look alike | told apart by the number | guessed; may pick wrong |
| A process three shapes behind | runs each step in order | refused, then restarted |
| What it records | `v` on each saved model; `state.upgraded` with `ran` | nothing new |
| Cost | 60 to 100 lines and a law (from every old number, the chain decodes); about 0.15 agent hours | none |

- **Why A:** every engine that carries state forward numbers it, and hot reload makes a shape
  change an everyday event in Tier 1's dev loop. Erlang names this case: "`Vsn` is fetched
  from the 'original' version of the module, that is, the version you are upgrading from" [e2].
- **Why only 60%:** Tier 1's states are small and a dev process is cheap to restart. Protobuf
  shows that additive change needs no number, and most of our shape changes may be additive.
- **What would settle it:** in Tier 1's first two weeks, count shape changes per program, and
  processes that crossed more than one shape at once. None crossing two: reopen it for branch B.
- **The saved model carries its `build`, decided 2026-11-01, 85%** (smaller call 5). H6 puts
  `build` on every entry; a saved model in the object's storage is not an entry. With `build`, a
  version can be worked out later from the code kept by hash
  ([experiment 173](../../experiments/173-worker-loader.md)), so a switch to branch B later loses
  no fact for good. Without it, the shape a model was saved in is gone.
- **Linear:** no Linear answer: Linear does not publish how its client upgrades a saved local
  store.
- **Elm or OTP:** both branches cite one. Elm decodes and fails, never guesses (B's spirit, though
  `oneOf` is a guess). OTP passes the old version to `code_change` (A).
- **Older code meeting a newer shape stops, decided by the owner 2026-11-08 (P15).** When code
  meets saved state whose `v` it does not know, because a newer fabrika saved it, that process
  stops. Nothing is deleted or rewritten. The tile says the state was saved by a newer fabrika and
  offers Restart after an update. There is no downgrade chain. It is the same rule as a full disk:
  fail loudly, never drop data.

  ```ts
  // A sketch: the code knows v 1 to 3; the saved model says v 4. P15's plan names the fact.
  // saved {v: 4, model: {...}} -> no upgrade runs, no decode, the process stops
  // the saved model is left as it was
  // the tile: "Saved by a newer fabrika." [Restart after an update]
  ```

### S4: a code step declares what it reads, and its key is built from that

**Decided 2026-11-01, 65%.** Effect's requirements already list the services a code step may call; a step that
calls one not listed does not compile. Each read's answer is recorded, and P7's key is the hash of
those recorded reads. An agent step's key stays P7's hand list of what its brief named.

```ts
// A sketch: in tea, a code step's reads are the Gather Cmds it sent, each with input and answer.
// key = sha256 of [["pull_read", {number: 117}, "sha256:9a1f..."], ["main_read", {}, "92740b74"]]
```

- **Why:** Bazel: "Without action sandboxing, Bazel doesn't know if a tool uses undeclared input
  files" [i7]. P7's own doubt is "an input left out of the key". A list made by the type system
  cannot leave one out.
- **Writes too, decided 2026-11-01, 60%:** each step lists the fact kinds it writes, and a law checks that every
  step's needs are some earlier step's writes (F.E.A.R.'s preconditions and effects, from 189).
  Then P4's resume point is a lookup. Listing the twelve steps' needs and writes by hand first
  settles whether the map is clean.
- **Linear:** no Linear answer: Linear never skips work because its inputs did not change (P7).
- **Elm or OTP:** Elm's answer: a read is a Cmd, and a Cmd is data, so the list is already there.
- **What holds it:** the types, and P7's property test that changing any read changes the key.
- **The doubt:** an agent picks its own files, so the agent steps, the costly ones, keep the hand
  list. The gain is only on code steps.
- **Cost:** 100 to 200 lines in `next/`'s lane, 0.2 to 0.35 agent hours, after that lane is designed.
- **Lost if it waits:** nothing, if each Gather's answer is recorded, as record wide already asks.
- **Today's ticket 117:** breaks. A step's key is its place, `intentOf("lane", number, count, step)`
  (`machine.ts:513`).

### S5: when two folds that should agree do not, say the first place they part

**Decided 2026-11-01, 75%.** One fact and one bundle: the case, the field path, both values, and the rev of the
fact that last set that field in the fold.

```ts
// A sketch. The fold notes, per field, the rev that last changed it, so the report can name it.
{_tag: "diverged", body: {case: "fold_vs_saved", lane: "L1", rev: 407, path: "carry.exam", fold: "5d38d582", saved: null}}
```

- **Why:** Riot logs a value only "on frames where the value changes", because "only the first
  divergence really matters" [g5]. Factorio's report "contains both the player's and server's copy
  of the save game" [g6]. GGPO: "diff the log of the initial frame vs the log of the rollback" [g1].
- **Tied to P6 and PR 5:** [the self-fix plan's PR 5](../plan/pipeline-self-fix.md#pr-5-a-stuck-lane-restarts-from-the-step-that-broke)
  has the law "the fold of a lane's facts equals its saved `Held`, at every point a lane can stop",
  and a restart that names a field no fact proves. The report is that law's failure message in a
  test, and the same function at a live restart: write both copies before resuming, since the
  restart replaces the saved one.
- **In `next/`:** D6's "drop the views, replay the log and compare" test, and later D5's local
  copies, use the same report.
- **Linear:** no Linear answer.
- **Elm or OTP:** none; OTP's `sys:get_state` reads a state, it does not compare two.
- **What holds it:** a law: on a planted mismatch, the report names the planted path and rev.
- **The doubt:** how often the fold and the save will part on real lanes. If never, it is
  insurance. PR 5's law will show it.
- **Cost:** 100 to 200 lines, 0.2 to 0.35 agent hours; about 40 of them fit in PR 5.
- **Lost if it waits:** the two copies at the moment of a live mismatch, since the restart writes
  over the save.

### S6: a replay re-runs code, never an agent

**Decided 2026-11-01, 90%.** An agent's draft, a person's words and a check's result are recorded inputs. A
replay folds them and re-runs code only.

- **Why:** a game records each player's input because it cannot work it out again [g1]; Temporal
  replays workflow code against recorded results [i5]. An agent run is not repeatable and costs
  money ([an agent run keeps its content](./an-agent-run-keeps-its-content.md)).
- **What holds it:** a replay runs with the agent service swapped for a Layer that answers only
  from recorded facts and fails on a call it has no record for.
- **Linear:** agree, as P6's Linear row reads: an agent rebuilds its context from its Agent
  Activities, not from comments.
- **Elm or OTP:** Elm's debugger replays Msgs, not their effects (from memory, not checked today).
  We follow it.
- **The doubt:** a draft whose content was deleted on a person's request cannot be replayed; that
  replay stops and says so.
- **Cost:** the Layer, 30 to 50 lines, under 0.1 agent hours.
- **Today's ticket 117:** half. The lane's facts keep outcomes, not drafts; a replay of 117 cannot
  re-run review on the builder's text.

## The smaller calls

All five decided 2026-11-01, each with its lean.

1. **Where A3's `saw` goes.** Decided 2026-11-01, 70%: (b).

   ```ts
   // (a) keep both: the program's view counter in the Msg, the log's rev on the envelope
   {m: {type: "plus", saw: 41}, seen: 409}
   // (b) one number: the Msg loses saw; a program that cares reads letter.seen
   {m: {type: "plus"}, seen: 409}
   ```

   (b) walks back where A3 puts it ("Every Msg from a window carries `saw: <rev>`"). Why: one
   number for one idea, filled by code, checked by the referee. PR 223's counter keeps `saw` and
   never reads it (`next/src/programs/counter/program.ts:5-11`). Doubt: a program that compares
   with its own inbox `pos` needs one more lookup.
2. **The name.** Decided 2026-11-01, 70%: `seen`. `saw` is already a body field with other types: an object on a
   grant, a hash on an ask ([one ask](./one-ask-and-one-meter.md)). One word at two levels would
   mean two things. `base` stays the note's version. **No Linear answer.**
3. **An agent's `seen`.** Decided 2026-11-01, 65%: the newest rev any read answered it from, against the rev its
   brief was built at. The first is what it could have known; the second undercounts a mid-run read.
4. **Where the sync helper lives.** Decided 2026-11-01, 70%: tea's `pbt`, as an issue in demlik; a stopgap in
   libfabrika's test kit.
5. **`build` beside each saved model.** Decided 2026-11-01, 85%, under S3 (above).

## What the ledger records

- **New on every entry:** `seen`. **Lost for good if not recorded now:** for each entry written
  without it, what its writer had seen. The deadline is Tier 1's first real note.
- **New beside each saved model:** `build`. Lost without it: which code, so which shape, wrote it.
- **New only when it happens:** `diverged`, with both values.
- **From S3's branch A:** `v` on each saved model, and `state.upgraded` with `ran`.
- **Derived, so it waits:** `during`, staleness views, how far behind a writer was.

## A tryout in today's version

Offered for the self-fix plan's PR 5, not filed:

- **The sync test as one more lane law file:** experiment 190's script, made a law. About 70 lines,
  0.1 agent hours. It already passes.
- **The fold law's failure names the first field, both values and the rev:** about 40 lines, 0.1
  agent hours.
- **Not offered:** `seen` in today's ledger. Today's lane keeps `during` (PR 8).

## Where this differs from settled notes

- **[A3](./the-cloud-is-one-more-host.md#a3-how-a-window-shows-a-process):** `saw` leaves the Msg
  for the envelope as the log's rev (smaller call 1). PR 223 changes with it.
- **D3 ([the five layers](./a-local-first-sync-engine.md#layer-2-data-decided-2026-10-30)):** one
  more envelope field. Additive.
- **[Tier 1 detail](../plan/tier-1-detail.md#what-fact-is-lost-forever-if-we-dont-record-it-now):**
  "`saw` on a letter" and "the letter's `by`, `at`, `said` and `saw`" become `seen`.
- **P5's `during` ([pipeline guidelines](./pipeline-guidelines.md)):** in `next/`, a fold over
  `seen`. Today's lane keeps it as written.
- **[An old host is named, then restarted](./an-old-host-is-named-then-restarted.md):** S3's
  branch A undoes "No version number on each machine" for state carried forward. That note says
  so in a dated line.
- **[Hot reload](./hot-reload.md) H3:** branch A replaces the shape-guess upcast with a numbered
  chain. H3's sketch is marked as replaced.
- **P7:** for code steps, the key's list comes from recorded reads, not by hand.
- **Experiment 189:** its map called `seen` "nothing decided". It was half decided, as `saw`.

## What it costs

| Principle | Lines | Agent hours | When |
|---|---|---|---|
| S1 `seen` | 50 to 80 | 0.1 to 0.15 | before Tier 1's first real note |
| S2 sync test | 40 to 60, plus a line per machine | under 0.2 | with Tier 1's first machines |
| S3 branch A | 60 to 100 | about 0.15 | with hot reload |
| S4 declared reads | 100 to 200 | 0.2 to 0.35 | with `next/`'s lane |
| S5 divergence report | 100 to 200 | 0.2 to 0.35 | 40 lines in PR 5, the rest later |
| S6 replay Layer | 30 to 50 | under 0.1 | with the first replay |

About 380 to 690 lines in all, under 1.3 agent hours, at experiment 187's 600 lines an hour.

## What it cannot tell us

- **Whether anyone reads `seen`.** The case for it is record wide and the data-shape rule, not a
  reader.
- **Whether `next/`'s machines pass the sync test.** Only today's lane ran.
- **How often a shape changes,** which is what S3 turns on. Nobody has counted.
- **What Linear does** for a writer's sync position or a saved store's upgrade: not published.
- **Lamdera,** the Elm-world tool most likely to back a version chain, could not be read.
