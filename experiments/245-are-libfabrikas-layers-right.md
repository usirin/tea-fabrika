---
date: "2026-11-09"
summary: "`next/`, `next/packages/libfabrika/src` only. Reading plus counts (imports, exports, 121 commits over four days), code-graph, `structure-sweep score` and one redacted sweep, $0.007. The order of the layers holds; three walls do not. `coordination/` holds four subjects, and three of its files (`process-store.ts`, `recovery.ts`, `recovery-store.ts`) are read only by the app layer. `data/` is two halves, the ledger and the span records. \"The app layer never imports data\" holds only because `coordination/index.ts` re-exports 11 of data's names. 0034's three context folders would put about 3,100 of 9,800 lines in a context the glossary does not give them. Lean, 60%: keep the ladder and move the walls to where the subjects end (ticket 488). Nothing moved."
---

# 245. Are libfabrika's layers the right abstractions?

Read and counted 2026-11-09 on origin/main at `b865c421`. **All claims are about `next/`**, and
only about `next/packages/libfabrika/src`. This is reading plus counts, not a run of the product.
Measured: imports between the 67 non-test files, exports against their users, 121 commits of file
history, and two tool runs (code-graph 0.15.0, structure-sweep 0.3.9 with Jev `jev-1.13.0`). Ticket
488. Nothing moved, and no code changed.

**The answer.**

- **Micro: two layers are one thing, three are not.** `door/` and `app/` each hide one decision.
  `coordination/` holds four subjects with almost no imports between them, `data/` holds two, and
  `transport/` holds two.
- **Macro: the order is right, the walls are not.** The ladder of imports holds and is checked. But
  the wall between `coordination/` and `app/` cuts two subjects in half, `transport/` is not the
  bottom of anything, and the rule "the app layer never imports data" holds only on paper.
- **For the two decisions about to be amended:** [0034](../.decisions/0034-libfabrika-folders-are-bounded-contexts.md)'s
  rule "the layer picks the folder" puts about 3,100 of the 9,800 core lines in a context the
  glossary does not give them. A `Ledger/` folder of layers 2 and 3 would hold 27 files and five
  subjects, and it is the group whose files change together least.

```text
what the folders say                 what the imports and consumers say
transport/     9 files               wire (5 files, 548 lines)     keys (3 files, 548 lines)
data/         14 files               ledger (7, 837)               span records (6, 1,490)
coordination/ 15 files               processes and mailbox (5, 1,274)    members and sessions (5, 1,072)
                                     the runner's own storage (3, 537)   presence (1, 144)
app/           9 files               the program contract (5, 1,297)     the runner (2, 1,900)
                                     the brain's life (2, 93)
door/          4 files               one service, four jobs in one 1,776-line file
```

Parnas already said the two questions are separate. From the last page of "On the Criteria To Be
Used in Decomposing Systems into Modules" (Communications of the ACM, December 1972, page 1058,
read today from a scan): "hierarchical structure and 'clean' decomposition are two desirable but
independent properties of a system structure." Our lint checks the first. Nothing checked the
second until this read.

## 1. What each layer hides

Parnas's test: "one begins with a list of difficult design decisions or design decisions which are
likely to change. Each module is then designed to hide such a decision from the others" (same
page). So for each folder: which decision would a change stay inside?

| Folder | Decisions it hides | One thing? |
|---|---|---|
| `transport/` | The JSON-RPC shapes of a connection and its hello. The bytes of an SSHSIG and a passkey signature. | Two, joined by one import (`hello.ts:4` reads `checkSshsig`) |
| `data/` | How the one log is ordered and stored. How an object keeps its spans, health rows and archive. | Two |
| `coordination/` | The process tree and mailbox as facts on the ledger. Who belongs and what a session may sign. What a process saves between steps and how often a letter is retried. Who is online. | Four |
| `app/` | What a program is, and how one process is stepped. | One, with one stray part (the brain's life) |
| `door/` | Who may do what, stamped with who did it. | One, doing four jobs |

Where the files say it:

- **`data/` is two halves that share a SQL interface and three helpers.** The ledger half
  (`ledger.ts`, `ledger-store.ts`, `ledger-transaction.ts`, `log.ts`, `referee.ts`, `sqlite.ts`,
  `worker-sql.ts`) and the span half (`sink.ts`, `health.ts`, `archive.ts`, `records.ts`,
  `record-part.ts`, `trace.ts`) meet in two places only. The span half reads `Sql` from
  `data/referee.ts:10`. The ledger half reads `short` and `errorClass` from `data/trace.ts:147`
  and `:133`. No ledger file imports a span service, and no span file imports the ledger.
- **Shared names live in the wrong files.** `ProcessId` is declared in `data/trace.ts:12`, the
  span sink's rows, and five `coordination/` files and the door import it from there. `Sql`, the
  object's SQLite, is declared in `data/referee.ts:10` and used by 10 files outside the ledger
  half. Twenty files outside `data/` import from `data/ledger.ts`, most of them only for
  `LedgerError`: `door/store.ts` and `coordination/recovery-store.ts` never touch the ledger.
  These are the shared kernel that `id.ts` started, sitting inside one layer.
- **`coordination/` has three files no other coordination file imports.**
  `process-store.ts` ("A process's own storage ... its saved model, its unfinished turn",
  `coordination/process-store.ts:1`), `recovery.ts` and `recovery-store.ts` are read only by
  `app/` (`runner.ts`, `supervisor.ts`, `program.ts`, `execution.ts`) and by the Workers wiring.
  They are the runner's storage and the supervisor's types.
- **Supervision is cut in half by the wall.** Its policy and states are in
  `coordination/recovery.ts`, its store in `coordination/recovery-store.ts`, its machine in
  `app/supervisor.ts` and its stepping in `app/runner.ts:310-431`. `app/supervisor.ts:1-4`
  imports nothing from `app/`: only tea, Effect, `coordination/process.ts` and
  `coordination/recovery.ts`. [The five layers](../docs/direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)
  put delivery limits (C2) and restarts (C4) in coordination, so the note and half the code agree
  with each other and disagree with the other half.
- **Members and sessions are a subject of their own.** `members.ts`, `text.ts`,
  `authorization.ts`, `client-manager.ts` and `session-manager.ts` reach the process files by three
  names: `From` (a type), `inRunnerSpace` and `inSignalSpace`. Their main reader is the door
  (`door/door.ts` takes 18 names from `coordination/index.ts`, 14 of them from these five files).
- **`transport/waiting.ts` is the door's waiting room,** a list of knocks with a limit and a
  time to live. Only `door/door.ts` imports it.
- **The brain's life is not the app layer.** `app/brain-life.ts` and `app/brain-event.ts` import
  nothing from the library, and only `node/` and `workers/` import them.

## 2. Small front, deep inside?

Ousterhout's measure is what a module offers against what it hides: a deep module has a small
interface over a lot of work, and a shallow one makes the reader learn almost as much as it saves
(A Philosophy of Software Design, the chapter "Modules Should Be Deep"; cited from memory and
from summaries, the book was not re-read for this). Counted by name, in non-test files:

| Folder | Lines | Exported names | Used by another folder |
|---|---|---|---|
| `door/` | 1,938 | 4 | 2 |
| `transport/` | 1,103 | 34 | 13 |
| `data/` | 2,365 | 59 | 32 |
| `app/` | 3,290 | 44 | 38 |
| `coordination/` | 3,087 | 80 | 55 |

- **The door is the deepest module in the library:** two names, `Door` and `ConnectionId`, over
  1,938 lines.
- **`coordination/` has the widest front.** Other folders use 55 of its names, and
  `app/runner.ts` alone imports 34 of them (30 from `coordination/index.ts`, 4 from
  `recovery.ts`). A layer whose one upstairs neighbor needs 34 of its names is not hiding much
  from that neighbor.
- **Eleven of those names are not coordination's.** `coordination/index.ts:43-49` re-exports
  `Appended`, `ParentText`, `Rev`, `InputId`, `LedgerError`, `Sql`, `Archive`, `sha256`,
  `RecordManager`, `SinkError` and `SpanSink` from `data/` and `id.ts`, and `app/` uses all 11.
  The file says why at its top: "so a layer above never imports `./data`". The exam's rule
  (`next/apps/fabrika/src/exam/layers.test.ts:217`, `app: ["coordination", "id"]`) is met by the
  path of the import, not by what the app layer knows. Ousterhout calls this shape a pass-through
  (from memory, the chapter "Different Layer, Different Abstraction").
- **The program contract barely needs coordination.** `program.ts`, `state.ts`, `patch.ts` and
  `execution.ts` take three names from below: `ParentText` and `Rev`, both data's, and
  `Deliveries`, a number from 1 to 32. The runner needs everything; the contract a program author
  writes against needs two ledger shapes.
- **`app/` is one function.** code-graph measures `withLoader` in `app/runner.ts` at 1,492 lines
  and complexity 205. That is a file question, not a layer question, and it is why `runner.ts` is
  the file every count below keeps finding.

Names exported and used by no other folder: 21 in `transport/`, 26 in `data/`, 33 in
`coordination/`, 6 in `app/`. Most are right to be so (the byte helpers in `transport/binary.ts`,
the health tables). They are what a per-folder `internal/` would hold under 0032.

## 3. What changes together

`git log` on the library path only, non-merge commits, 2026-11-06 to 2026-11-09: 121 commits. The
library is four days old on this path, so every number here is small.

- Counting test files, 110 commits touch a core folder: 67 touch one, 35 two, 8 three or four. That
  matches the count this question started from.
- Counting only non-test files, 54 commits: 27 touch one folder, 20 two, 3 three, 4 four. So half
  of the commits that change library code cross a wall.
- By pair, with the three commits over 40 files left out: `app` with `coordination` 14,
  `coordination` with `data` 10, `app` with `data` 4, every other pair 3 or fewer.

The file pairs behind those:

| Pair | Changed together | Of the rarer file's changes |
|---|---|---|
| `app/runner.ts` and `coordination/index.ts` | 8 | 16 |
| `coordination/process-manager.ts` and `coordination/process.ts` | 8 | 10 |
| `app/runner.ts` and `coordination/process-store.ts` | 5 | 5 |
| `app/runner.ts` and `coordination/recovery.ts` | 3 | 3 |

`process-store.ts` and `recovery.ts` never changed without the runner. `coordination/index.ts`
changes with the app layer 8 times in 16, which is the pass-through at work: a new name the runner
needs is first added to the list of re-exports.

`structure-sweep score` grades a file-to-group assignment against co-change, with no model call.
Five assignments were written by hand and scored on the same 33 change sets (59 files):

| Assignment | Groups | Precision | Recall |
|---|---|---|---|
| Today's folders | 7 | 62.6% | 23.1% |
| 0034's three contexts (`Clients`, `Ledger`, `Runtime`) | 5 | 49.4% | 32.1% |
| Today's folders, with the runner's three storage files moved to `app/` | 7 | 64.8% | 23.4% |
| Option B below: the ladder with its walls moved | 9 | 71.9% | 18.9% |
| The 14 subjects of the first code block | 14 | 78.5% | 13.0% |

Precision asks: of the file pairs inside one group, how many ever changed together? Recall asks:
of the pairs that changed together, how many sit in one group? Bigger groups always win recall, so
precision is the one to read. Per folder today: `transport/` 89.3%, `app/` 66.7%, `data/` 60.3%,
`coordination/` 39.6%. `coordination/` is the least cohesive folder, and merging it with `data/`
into one `Ledger/` keeps that 39.6%. One number argues against this write-up: the five member
files score 30% as their own group. They belong together by imports and by reader, not by history.

## 4. A second reader, with the paths hidden

`structure-sweep sweep --redact` shows Jev each file with its path and its import paths replaced
by ids. It was given six groups in the notes' own words (the five layers' transport, data,
coordination and app, plus the door and "host" for platform wiring) and asked where each of the 66
files belongs. It agreed with the folder for 53.

- **The three files of section 1 came back as `app`:** `coordination/process-store.ts` (0.78),
  `coordination/recovery-store.ts` (0.78) and `coordination/recovery.ts` (0.87). Every other
  coordination file came back as coordination.
- **Rules at the edge:** `workers/control.ts` (0.99) and `workers/fetch.ts` (0.96) came back as
  the door, and `workers/record.ts` (0.95) and `node/stage-recording.ts` (0.72) as data.
  [Experiment 244](./244-structure-sweep-on-next.md) flagged the first two for the same reason.
- **Near ties, not findings:** `transport/gateway.ts` as the door (0.46), `transport/waiting.ts`
  as coordination (0.33), `app/brain-event.ts` as coordination (0.58), `node/local-stage.ts` as
  coordination (0.34), `data/worker-sql.ts` as host (0.44), `workers/gateway.ts` as transport (0.60).

Jev's verdicts were right about two times in three in experiment 244, and its confidence does not
protect. So this counts only where the imports already say the same thing, which is the first
bullet. The group descriptions named members and span records inside coordination and data, so
this run could not find those two splits and says nothing about them.

## 5. Against the models we follow

- **OTP groups by application, not by layer.** "A module must only be included in one
  application", and an application is "a component that can be started and stopped as a unit"
  ([applications](https://www.erlang.org/doc/system/applications.html), read today). Kernel "has
  all the code necessary to run the Erlang runtime system: file servers, code servers, and so on"
  ([kernel](https://www.erlang.org/doc/apps/kernel/kernel_app.html)), and "the STDLIB application
  contains no services" ([stdlib](https://www.erlang.org/doc/apps/stdlib/stdlib_app.html)).
  There is an order (everything depends on Kernel and STDLIB), but each unit is a subject.
- **In OTP the supervisor is library code that runs in the tree of the application it serves.**
  The `supervisor` module is in STDLIB and `application` is in Kernel, as the links in
  [our OTP table](../docs/direction/follows/otp.md) show. That is our shape too: the supervisor
  machine is "stepped inside the program's own object". It argues for keeping supervision's parts
  together, on whichever side of the wall.
- **A sync engine's stack stops below coordination.** Replicache names three parts: the client
  store, the application's mutators and subscriptions, and a server with push, pull and poke
  ([how it works](https://doc.replicache.dev/concepts/how-it-works), read today). Our transport and
  data layers are that, and `poke` is the same word. Nothing in it is a process tree or a
  mailbox. So "five layers" is three models stacked: a sync engine (layers 1 and 2), OTP (layer
  3) and Elm (layer 4). Only one sync engine was read; calling its three parts "the usual stack"
  is a guess.
- **Where we match:** one log below everything, an order of dependencies, programs on top.
  **Where we do not:** OTP would not put the span sink and the log in one unit, or membership and
  the process tree in one unit, because neither pair starts, stops or changes together.

## 6. The door, `node/` and `workers/`

**The door** is the glossary's open-host service, and one service is the right front. Its one file
does four jobs:

| Job | Lines in `door/door.ts` | Whose subject |
|---|---|---|
| Admit a connection: `connect`, `challenge`, `initialize` | 433-628 | the door, on transport's hello |
| The waiting room and grants: `knock`, `watch`, `enrollment`, `grant`, `deny` | 629-1062 | members and sessions |
| Route a request: `route`, nine methods (`door/door.ts:233-243`) | 1063-1506 | the door |
| Stamp and check writes for the runner: `accept`, `append`, `sign`, `checkDelivery` | 1507-1733 | the door |

[0032](../.decisions/0032-libraries-take-effects-file-layout.md) already has the shape for this:
`Door.ts` with its parts in `Door/`. The second job is the one that could leave: it is membership
logic that today needs `transport/waiting.ts`, five coordination files and the door's store.

**`node/`** does three jobs: bundle programs (`build.ts`), start and watch the local brain
(`stage.ts`, `local-stage.ts`, with `app/brain-life.ts` as its machine), and queue the stage's
spans (`stage-recording.ts`). All three are host jobs.

**`workers/`** does five: the object-call contracts (`bindings.ts`, `platform.ts`), the Project
and Process objects' wiring (`runtime.ts`, 849 lines), the gateway object (`gateway.ts`), the
program's isolate (`box.ts`, `index.ts`) and two entries with guards (`fetch.ts`, `control.ts`).
The wiring is host work. The guards are door rules at the edge, which experiment 244 judged
acceptable. `runtime.ts` was not read line by line.

0034 already plans two platform packages for these, later. Nothing here argues against that.

## 7. The options

Each tree shows only where files sit. Names stay lowercase here so the trees compare with today;
0032's PascalCase rename applies to any of them.

**Option A: the layers as folders, renamed.** The lean this question started with.

```text
src/  index.ts  id.ts  testing.ts
  transport/      as today
  ledger/         today's data/, all 14 files
  coordination/   as today, all 15 files
  runtime/        today's app/
  door/  node/  workers/
```

- Costs: one rename of two folders. Undoes 0034's three context folders, and nothing else.
- What stays wrong: `ledger/` would be 63% span records by lines. The runner's storage stays under
  coordination. The pass-through stays.
- `runtime/` is a good name for `app/`: 90% sure. `ledger/` for all of `data/` is not: 80% sure.

**Option B: the same ladder, with the walls where the subjects end.** My lean, 60%.

```text
src/  index.ts  id.ts  testing.ts
      sql.ts                the object's SQLite, out of data/referee.ts
      process-id.ts ...     ProcessId, short, errorClass and one storage error, out of data/
  transport/      wire.ts  hello.ts  answer.ts  gateway.ts
                  sshsig.ts  webauthn.ts  binary.ts
  ledger/         ledger.ts  ledger-store.ts  ledger-transaction.ts  log.ts  referee.ts
                  sqlite.ts  worker-sql.ts
  spans/          sink.ts  health.ts  archive.ts  records.ts  record-part.ts  trace.ts
  coordination/   process.ts  process-manager.ts  process-mail.ts  process-id.ts  mailbox.ts
                  gateway-manager.ts
  members/        members.ts  text.ts  authorization.ts  client-manager.ts  session-manager.ts
                  waiting.ts
  runtime/        program.ts  state.ts  patch.ts  execution.ts  entry.ts
                  runner.ts  supervisor.ts  recovery.ts  recovery-store.ts  process-store.ts
  door/           door.ts  nonce.ts  store.ts
  node/  workers/   with brain-life.ts and brain-event.ts beside the stage that runs them
```

- The order: shared names, then `transport`, `ledger` and `spans` side by side, then
  `coordination`, `members`, `runtime`, `door`. Seven rungs, each one subject.
- Costs: 17 files change folder beyond a rename, and four shared names move to the top. The exam's
  row for the app layer must change from `["coordination", "id"]` to allow `ledger` and `spans`,
  and the 11 re-exports at `coordination/index.ts:43-49` go. That is a change to a law, so it
  waits on the owner.
- Undoes: 0034's three folders and its rule that the layer picks the folder. The glossary rows
  that put `ProcessStore`, `RecoveryStore`, `Receipt` and `Supervision` under Ledger. The five
  layers' C2 and C4, in part: delivery limits and restarts would sit with the runner that steps
  them. The other direction is open too: move `app/supervisor.ts` down into coordination, which
  needs no law change since it imports nothing from `app/`. Either way supervision ends up in one
  folder.
- The doubt: four days of history, and coordination is not finished. Claims, leases and the
  registry are not built (hands are a later tier), and they may fill coordination with a second
  real subject. What would settle it: do the 17 moves on a branch, run `pnpm lint:layers` and the
  exam, and read every import that breaks.
- `spans/` is a placeholder name. "Records" is already a context in the glossary, for the docs.

**Option C: 0034 as written, three context folders.**

```text
src/  index.ts  id.ts  testing.ts
  Clients/   transport's 9 files, and the door by its lean
  Ledger/    data's 14 files and coordination's 15, with two layer rows inside
  Runtime/   app's 9 files
```

- Costs: no new decision. Undoes nothing.
- What goes wrong: by "the layer picks the folder", three groups land in a context the glossary
  does not give them. The span records (1,490 lines; the glossary lists `SpanSink` and
  `RecordManager` under Runtime), members and sessions (1,072 lines; `grant tree` and
  `SigningRefused` are under Clients) and the runner's storage (537 lines; read only by Runtime).
  That is about 3,100 of the 9,800 lines in the four layers. `Ledger/` becomes one folder of 27
  non-test files, five subjects and two layer rows that the path does not show.
- If the folders are to be contexts, the glossary should pick them, not the layer. That is
  Option D with capital letters.

**Option D: one folder per subject, the layers only in `layer-rules.json`.**

```text
src/  index.ts  id.ts  testing.ts
  wire/  keys/  ledger/  spans/  processes/  members/  program/  runner/  door/  host/
```

- This is what OTP's applications and 0032's "one concept" point at, and it scores the best
  precision (78.5%).
- Costs: ten folders, some of two or three files. The path no longer shows the order at all.
  Undoes the lean that a folder is a layer, and 0034's three contexts.
- 25% that this is the better end state. It is Option B cut finer, so B does not close it off.

**Option E: split into packages** (`libfabrika-ledger` and so on), as OTP ships applications. Not
now: AGENTS.md records packages for others as later, and 0034 already lists the two platform
packages as later.

**The lean: Option B, 60%.** It keeps what is proven (the order, and the lint that checks it) and
fixes the three places where a wall cuts through a subject. Option A is the cheap half of it and
is fine as a first step, as long as `data/` is not renamed `ledger/` whole. Option C is the one to
avoid as written: 75% sure, for the glossary mismatch and the 27-file folder.

## Cost

| Run | Input tokens |
|---|---|
| sweep, 5-file try | 12,246 |
| sweep, 66 files, redacted | 147,242 |
| **Total** | **159,488** |

At $0.042 per million input tokens, with output free (TypeSafe's model page, as read for
experiment 244 on 2026-11-09), that is **$0.007**. code-graph, `structure-sweep score` and the
counts made no call. The numbers are in
[`results/245-are-libfabrikas-layers-right.json`](./results/245-are-libfabrikas-layers-right.json);
the raw graphs, logs and verdicts stayed under `runs/`.

What each tool added: code-graph confirmed the layer edges (no upward import) and gave the
1,492-line function. `structure-sweep score` gave the precision numbers of section 3. The redacted
sweep gave a second reader for section 1's three files. `move plan` and `pairs` were not run again;
experiment 244 covers them.

## What this cannot tell us

- **Four days of history.** The library's path first appears on 2026-11-06, and 86 of the 121
  commits are from one day. Co-change over so short a time shows how Tier 1 was built, not how the
  code will change once it is in use. The 33 change sets under the precision numbers are few.
- **Commits are steps, not changes.** A pull request here lands as several signed commits (tests,
  build, lead), so one change can count as two or three, and a test never shares a commit with its
  code.
- **Counts by name.** Exports and their users were matched by name with a regular expression. Two
  different things with one name (`State` in `app/program.ts` and in `coordination/process.ts`)
  count as one, and a namespace import counts as one name.
- **What is not built.** Claims, leases, the registry, links and hands are in the notes and not in
  the code. Coordination's shape today is its Tier 1 slice.
- **Not read line by line:** `workers/runtime.ts` (849 lines), `app/runner.ts`'s one function and
  most of `door/door.ts`. The jobs in section 6 come from each file's function names, spans and
  imports.
- **One sync engine and one book from memory.** Replicache was read; Zero, Electric and others
  were not. Ousterhout is cited from memory and summaries.
- **No move was tried.** Option B's cost is counted from imports. What the exam, the dead-export
  check and `exam-paths.json` would say about it is unknown until a branch tries it.
- **Whether a reader finds things faster in any of these trees.** Nobody was timed.
