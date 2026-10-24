# 126. Is the core ready to build on?

The question: the plan is to rebuild the pipeline small, on today's core (`packages/fabrika`),
before the core is cleaned up. Is the core ready for that? Three parts: what a new pipeline needs
from the core, how strong the core's tests are, and which known bugs would bite a real ticket run
in the app.

**Answer: ready after a short list of fixes. Confidence 70%.** The core has the inner loop a
ticket needs (programs that keep their state, a host with a lease, a ledger with limits, an agent
runner, a sandbox, tsh). It does not have the outer jobs (GitHub, asking the owner, running checks,
working copies), and those are the rebuild's to build. Five bugs would stop or strand the first
real ticket run in the app, and each is small or medium.

- **Part 1, what the pipeline needs.** The old pipeline imports 150 names from the core, in 98
  files, over 13 subpaths. Every one is public. 36 of the values are named in no core test, among
  them `createDraft` (the agent runner, 7 files) and `noSpend` (13 files).
- **Part 2, how strong the tests are.** 150 mutants, picked at random with a fixed seed from
  16,669. The repo's own typecheck refuses 79 of them. Of the 71 left, the core's tests kill 35
  (49%). 23 survive and 13 are run by no test. A hand check of 11 survivors found 7 real gaps.
  The old pipeline's tests kill only 4 more.
- **Part 3, known bugs.** Of the seven named bugs, all seven still hold. Three would bite a ticket
  run in the app (lost values at reattach, a background window that takes over, ledgers that
  cannot start from the app's bundle). Two more open items bite too: no default time limit on an
  agent turn, and a one-second lease.
- Spent: $0. No agent call, no model, no Jev, no key. Network: pnpm installs only.

```ts
// The whole idea (experiments/126-core-ready.ts), as a sketch.
// Part 1: count what the old pipeline imports from the core, from its import lines.
contract(); // 98 files, 150 names, 13 subpaths, 0 not public

// Part 2: a fixed sample of the core's mutants. The typecheck goes first, then Stryker.
const sample = shuffled(allMutants /* 16,669 */, 126).slice(0, 150);
for (const m of sample) refused[m.key] = tsc(withMutant(m)) !== 0; // 79 refused: compile errors
stryker({mutate: rangesOf(sample), testRunner: "vitest", coverageAnalysis: "perTest"});
// Of the 71 the typecheck lets through: 35 killed, 23 survived, 13 run by no test.

// Part 3: read each known bug at its line, and say if it bites a ticket run in the app.
```

## Who did what

- **Nothing of a pipeline ran.** No machine of this repo ran on a ticket, and nothing of today's
  fabrika ran (no agent, no ledger).
- **New:** `experiments/126-core-ready.ts` (the counting for parts 1 and 2) and
  `results/126-core-ready.json` (the contract, every sampled mutant, the hand check).
- **Stryker is not in the workspace.** The script copies HEAD (`git archive`) into a scratch folder
  outside the repo, installs from the lockfile, and adds `@stryker-mutator/core` and
  `@stryker-mutator/vitest-runner` 10.1.1 there. Stryker edits that copy in place, never this
  checkout.
- **Part 3 is reading.** The bug list was gathered from `docs/direction/`, the "what it cannot
  tell us" parts of experiments 100 to 125, `field/notes.jsonl` and the code, with read-only helper
  sessions. Two claims were run: the test-limit probe (bug 7) and a bundle of both ledgers with
  esbuild (bug 6).

## Part 1: what a new pipeline needs from the core

This is a consumer-driven contract (Ian Robinson,
[martinfowler.com](https://www.martinfowler.com/articles/consumerDrivenContracts.html)): the user
of a service writes down what it needs, and the service is checked against that list. The old
pipeline (`packages/pipeline/src/stages/` and what they call) is the map of jobs. It does not set
their shape ([rethink, do not port](../docs/direction/rethink-do-not-port.md)).

| Job one ticket needs | Core tool, by public name | Tested in the core | Old pipeline builds its own | Known gap |
|---|---|---|---|---|
| Run an agent inside limits | `createDraft`, `sdkRunner` (`/agents/claude`), `acpProgram` (`/agents/acp`); the ledger's `hold` and `charge` | ledger limits yes (laws 26 to 30); `createDraft` no, its test is the pipeline's `draft.test.ts` | `hosted/agent.ts` applies the limits | Draft and the ACP program never call `hold` or `charge`; no default wall limit |
| Fence the agent in | `/agents/sandbox`: `filesOf`, `fencedEnv`, `toolchain` | no | options put together by hand in builder, planner, reviewer and the ACP harness | |
| Keep state across a restart | `Storage`, `fileStorage`, kept programs, `serve` | yes (`storage`, `kept`, a SIGKILL test, host takeover in one process) | | two ways to keep state, and nothing between them |
| Ask the owner | none | | `asks/` | packs import the `Ask` type from the pipeline |
| Talk to GitHub | none | | about 10 services over `gh` | every error is `{_tag: "unknown"}` |
| A ledger: leases, inboxes, limits | `Ledger`, `layerMemory`, `layerSqlite`, `/local` | yes, 27 laws on 3 stores | | no retry rule for `LedgerUnreachable` (written 4 times); the SQL runs out of Stryker's sight (part 2) |
| Run the checks (tests, lint) | none | | `local-checks.ts`, `hosted/review-local.ts` | |
| Run a command | none | | `child.ts`, `sh.ts`, with two different env rules | |
| Working copies | none | | in the build stage | nothing removes a build copy (suspected) |
| A clock | no service; 51 `Date.now()` in core code | no `TestClock` anywhere in the core | | the fix was decided (a lint ban, `build-on-effect.md`), not built |
| Host and supervise | `serve`, `createHost`, the supervisor, `Monitor`, `Call` | host yes; `Call` and `Monitor` named in no core test | `hosted/children.ts` polls instead of watching | no "result or exit, whichever comes first" block (the 116 hang); a call resends for ever |
| Traces and spend | `agentTrace`, `sdkTrace` (`/agents/trace`), `/otel` | only in the pipeline | | `Spend` has no schema; spend comes only from the SDK's total |
| Settings | none | | three readers | |
| Outside writes that happen once | the outbox, inside programs only | | `hosted/idempotency.ts` | a comment check reads only the first 100 comments |
| tsh and the app | `runTsh`, `Shell` | `Shell` no; most of tsh's tests are in `pipeline/src/tsh/` | | the app lists a fixed set of programs, with no ledger |
| The other moves (Gather, Act, Listen, Check, Judge) | only Draft is in the core | | `primitives.ts`, `combos.ts` | |
| Laws for the core's machines | `/laws` (33 names) | | `laws/tea-host.ts` holds the host, `Call` and `Monitor` laws | the core's own laws live outside it |

- **The core has the inner loop. The outer jobs are missing.** GitHub, asking the owner, checks,
  commands, working copies and settings have no core tool. The old pipeline built each one
  itself. [Where each piece lives](../docs/direction/where-each-piece-lives.md) says a boundary
  such as `CodeHost` is an Effect service at the top level. None of these exist yet. This is the
  rebuild's first work, not a core bug.

### The names, counted

98 pipeline files import the core, 64 of them not tests. 150 distinct names; 0 not public.

| Subpath | Names used, of public | Uses | Files |
|---|---|---|---|
| top level | 88 of 330 | 266 | 52 |
| `agents/claude` | 11 of 19 | 63 | 29 |
| `agents/sandbox` | 10 of 13 | 35 | 23 |
| `agents/acp` | 20 of 48 | 24 | 6 |
| `agents/trace` | 4 of 7 | 9 | 7 |
| `otel` | 3 of 8 | 6 | 5 |
| `laws` | 4 of 33 | 5 | 2 |
| `memory`, `sqlite`, `storage/node`, `local`, `shell`, `http` | 10 of 20 | 16 | 13 |

- **The most used:** `Ledger` (21 files), `defineProgram` (18), `input` (17), `DraftRun` (13),
  `noSpend` (13), `memoryStorage` (12), `output` (12), `start` (12), `Self` (11).
- **36 values the pipeline uses are named in no core test.** Besides `createDraft` and `noSpend`:
  `Shell` (7 files), `jsonSchema`, `sdkRunner`, `Call`, `Monitor`, `createHost`, `hostUpdate`,
  `losesLease`, `filesOf`, `fencedEnv`, `toolchain`, `agentTrace`, `sdkTrace` and others. The
  list is in the results file. A name in no test can still be run by a test through another name.
- **292 of 478 public names are used by nobody** (no pipeline, app, program, pack, tutorial,
  legacy or experiment). Many are result types that callers get by inference.

## Part 2: how strong the core's tests are

### How it was measured

- **The sample.** Stryker's instrumenter, run alone, makes every mutant of
  `packages/fabrika/src`: 16,669 in 79 files. A fixed-seed shuffle (seed 126) takes 150: agents
  18, host 76, program 17, shell 39, in proportion to each folder's size.
- **The typecheck first.** Each sampled mutant is put into the copy alone and the repo's own
  `tsc` runs (TypeScript 7.0.2, with Effect's checks patched in), then the file is put back. A
  mutant `tsc` refuses is a compile error, not a survivor: the repo would never ship it.
  Experiment 121 counted these as survivors; that was wrong.
  - Stryker's own TypeScript checker cannot do this here. TypeScript 7 is the Go port and has no
    compiler API for the checker to load.
  - 0.43 s a mutant, 64 s in all.
- **Stryker on the sample alone.** Stryker 10.1.1, its vitest runner, per-test coverage, 4 workers,
  the core's own tests (249 in 28 files), the repo's 60 s limit. Stryker has no "run these
  mutants" option, so the script narrows it twice:
  - `mutate` ranges, one per sampled mutant;
  - an ignorer plugin that keeps only the code nodes that hold a sampled mutant.
  - A node's other mutants still come along (a condition's `true` and its `false`): 100 more.
    So one sampled mutant ran alone first, with `--incremental`, which writes every test into
    Stryker's incremental file. The script then wrote the 100 into that file as already run.
    Stryker reuses an old result that no new test covers, so the main run reused those 101 and
    ran the 149 others. 9 minutes.
- **The wider run.** The 36 that lived ran again with the old pipeline's tests too (81 files, 1,378
  tests), to see how much of the core is tested only from outside. Their nodes brought 28 more
  mutants, not counted. 11 minutes.

### What came back

| Folder | Sampled | Compile error | Killed | Survived | No test ran it | Killed, of the rest |
|---|---|---|---|---|---|---|
| agents | 18 | 9 | 5 | 2 | 2 | 5 of 9 |
| host | 76 | 43 | 14 | 18 | 1 | 14 of 33 |
| program | 17 | 10 | 4 | 3 | 0 | 4 of 7 |
| shell | 39 | 17 | 12 | 0 | 10 | 12 of 22 |
| **all** | **150** | **79** | **35** | **23** | **13** | **35 of 71 (49%)** |

- **No timeouts.** Stryker alone also had 2 runtime errors; `tsc` refuses both.
- **Typecheck first changes the picture, not the score.** Stryker alone: 70 killed, 42 survived,
  36 run by no test (47%). Of its 78 that lived, 42 are mutants `tsc` refuses. Half of Stryker's
  kills (35 of 70) are mutants `tsc` refuses too.
- **53% of the core's mutants do not typecheck** (79 of 150). Effect's types and the schemas
  carry much of the checking. By mutator: objects 14 of 17 refused, arrow functions 11 of 13,
  conditions 17 of 37, strings 12 of 32.
- **Some code runs where no mutant can be switched on.** The vitest runner turns a mutant on
  inside the test's own process. The ledger's SQL (`rules.ts`, `sqlite-driver.ts`) runs in worker
  threads and in workerd; the Durable Object runs in workerd; the fake agent is a child process.
  11 of the 71 are there: 2 killed (on paths that also run in the process, such as the
  migrations at open), 7 survived, 2 run by no test. Their survival says nothing about their tests. The laws do run that
  SQL, on three stores, out of Stryker's sight.
- **Without those 11: 33 of 60 killed (55%).** Host, the folder with the ledger, goes from 14 of
  33 to 12 of 23.
- **Shell: no survivors, but 10 run by no core test.** Most of tsh's tests are in the old
  pipeline (`pipeline/src/tsh/`).
- **The old pipeline's tests add little.** Of the 36 that lived, they kill 4 (2 in shell, 2 in
  agents), all 4 run by no core test before. 3 more get run but survive. In all 26 survive and 6
  are still run by no test. With them, 39 of 71 (55%).

### The hand check

11 survivors, spread over the folders. Shell had none to check. "Real" is a change a caller would
see that no test catches.

| Mutant | Change | Verdict |
|---|---|---|
| `agents/acp/program.ts:206` | the session's span attributes made `{}` | harmless: only a trace reads `acp.agent` |
| `agents/acp/transcript.ts:441` | `s.phase === "turn"` made `true` | real, display only: while a turn is cancelling, the status line says `turn N` |
| `program/program.ts:1410` | a writer that never started is never ended | real: the reader's input stays open, and the reader waits for good |
| `program/shape.ts:236` | every object goes through the "table" branch | real: fit keeps descriptions under `items` or `anyOf`, and turns arrays into objects |
| `program/shape.ts:228` | `"definitions"` made `""` | harmless: the core writes its definitions under `$defs` (`shape.ts:108`) |
| `host/host.ts:525` | the registry's `claimed` rows ignored | real: a host learns another took its name only at its next renew |
| `host/host.ts:528` | `"lease_expired"` made `""` | real: a waiting host takes over only when its own timer fires |
| `host/memory.ts:648` | the `charge:` key made empty | real: a hold that repeats an earlier charge's id is held again |
| `host/laws.ts:626` | `every` made `some` | real: law T passes a tail that hands events on out of order |
| `host/laws.ts:134` | `late >= 0` made `late < 0` | harmless: only which steps a verdict calls late changes |
| `host/tail.ts:62` | `+=` made `-=` | harmless: only a caller that passes `meters` reads the count |

- **7 of 11 are real.** Two kinds stand out:
  - **the fast paths are not pinned.** The host's two quick ways to see a takeover (525, 528) can
    go, and a slower path (the renew, the claim timer) still passes every test.
  - **the laws themselves are not tested.** A planted mistake that reorders a tail would show 626.
- **The survivors out of sight were not hand-checked as gaps.** One of them, `rules.ts:1314`,
  empties the loop that finds a spent limit, so a spent tree would start more children. A planted
  mistake for it would tell if the laws catch it.

## Part 3: known bugs in the core

The seven named ones first. "Bites" means: would it hurt a real ticket run through a new
pipeline in the app (`apps/fabrika`)?

| Bug | Where it lives | Holds? | Bites a ticket run in the app? | Fix |
|---|---|---|---|---|
| 1. tsh values are lost on kill -9 before the run reads them | core: `shell/execute.ts:209-225` tells line values in memory; reattach starts with `told: {}` (`:511-532`); the job record keeps no told values | yes; field note 2026-10-17-13 is still open | **yes.** Quitting the app is enough: `build ticket=X &`, quit, `attach %n`, and the run starts again with no ticket, unless it had saved it | small to medium |
| 2. The shell's overtime clock uses the real clock | legacy, not the core: `legacy/src/turn.ts:1190-1199`, run on the live clock by `lane-replay.ts:515-533`. The core's shell has no `Date.now` | yes, in legacy | no. Real time is right for a real run; it only blocks a `TestClock` test | small |
| 3. The replay's `askWaitMs` 25 ms uses the real clock | legacy: `lane-replay.ts:492-503` | yes | no. Test only; it makes `replay/` flaky under load | small |
| 4. A program with a window started with `&` takes over the window, and Ctrl-C does not reach it | app and core: `apps/fabrika/src/host.ts:73-84` and `:116-140` put any run with a view in front; tsh hears Ctrl-C only in a foreground wait (`execute.ts:237-245`, `:446-455`) | yes; the app's README says so | **yes,** if the new pipeline has a window and runs as a job. The only way out is to quit the app | small |
| 5. The job storage folder only grows | core and app: `fileStorage(<userData>/storage)` (`apps/fabrika/src/main.ts:130`); `remove` (`program/storage.ts:452-457`) has no caller outside tests | yes | slowly. One ticket works; over weeks the flat folder holds tens of thousands of files | small to medium |
| 6. The ledgers that start a child or a worker cannot find their files when bundled | core: `host/sqlite.ts:59` (`new Worker(new URL("./sqlite-worker.ts", ...))`), `host/local.ts:75` (the daemon beside the file), `local.ts:135` (`process.execPath`, which is Electron in the app) | yes. Bundled with esbuild, both still point at files that are not there | **yes,** once the pipeline needs a lease, limits or a supervisor. The app has no ledger today; the memory ledger works bundled but keeps nothing across a restart | medium |
| 7. A hung test fails at 60 s with vitest's bare message, and its Effect is not stopped | test setup: `vitest.config.ts`; 285 `Effect.runPromise(` calls in the repo's tests (89 in the core's), none passes vitest's `signal` | yes. A probe (limit 1 s): the hung Effect kept running through the later tests and its finalizer never ran. With `{signal}` passed, the finalizer ran at the limit | no. It slows finding core bugs; vitest's message tells you to set a per-test limit, which the repo just removed | small: one shared helper that passes the signal, or `@effect/vitest` |

Other open items that would bite a ticket run, each checked at its line:

- **An agent cannot start from the bundled app** (core). The ACP harness finds its adapters by a
  path that climbs out of the package (`agents/acp/harness.ts:54`, `../../../../../adapters/`).
  It starts children with `process.execPath` (Electron). Suspected for the Agent SDK too: it finds
  its CLI beside its own module unless `pathToClaudeCodeExecutable` is set. Experiment 108 found
  the repo paths and left them. Not run in the app. Medium.
- **No default time limit on an agent turn** (core). `wallMs` is optional (`host/ledger.ts:159`),
  Draft has no turn deadline, and every pipeline agent sets only dollars. A stuck turn shows
  "running" for ever. Small.
- **The default lease is 1 s, renewed every 250 ms** (core, `host/host.ts:368-371`, `:436-437`).
  Experiment 101 saw Claude Code's start stall a host for about 0.5 s, and the host lost its own
  lease. Electron's main thread also draws and passes messages. Small: 3 s and 500 ms.
- **A hold never expires** (core, `rules.ts` hold and charge). A quit mid-turn counts the whole
  hold: experiment 104 counted $12.74 against about $0.25 billed. A ticket can end at its dollar
  limit with money left. Medium.
- **A call resends for ever** (core, `host/call.ts:108-117`): no cap on tries, no deadline. Small.
- **A parent can hang between a child's result and its end** (pipeline, with the gap in the core):
  the core has no "result or exit, whichever comes first" (experiments 115 and 116). Medium.
- **The job table drops a failed write without a word** (core, `shell/execute.ts:66` ignores it).
  A full disk means a job is not kept, and nobody is told. Suspected: a failed last save at quit
  rethrows from a timer. Small.
- **The app and the terminal tsh keep two homes** (`TSH_HOME` or `~/.tsh`, against the app's
  `FABRIKA_HOME` or its data folder). Suspected: one repo with two ledgers, the same ticket
  claimed twice. Small to medium.
- **Every write rewrites the whole record** (core, `program/storage.ts`). Grows with run length
  and with bug 5. Medium.
- **A manual-ack reader that reads more than 5 values before it acks hangs** (core,
  `program/outbox.ts:44`, `WINDOW = 5`). Small.
- **The host and the ledgers read the wall clock** (about 50 places). A laptop that sleeps
  expires leases (suspected). Medium.
- **The builder's sandbox cannot listen on a local port** (field note 2026-10-18-177), so a repo
  whose tests open a port reports red where CI is green. Small.

## Verdict

- **Part 1:** the core covers the inner loop a ticket needs. The outer jobs (GitHub, asks,
  checks, commands, working copies, settings) are not in it, and those are the rebuild's to
  build, as core services.
- **Part 2:** the tests are middling. 49% of the mutants that typecheck are killed (55% of those
  Stryker can see). 7 of 11 hand-checked survivors are real gaps, mostly fast paths and the laws
  themselves.
- **Part 3:** all seven named bugs hold. Three of them bite a ticket in the app (1, 4, 6), and so
  do two other open items (no turn limit, a one-second lease).
- **Overall: ready after a short list of fixes.** Confidence 70%.

The smallest set to fix before the first real ticket in the app:

1. Start the ledgers and an agent from the bundled app (bug 6, and the agent paths). Medium.
2. A background program does not take the window until `attach` (bug 4). Small.
3. Keep told values until the run has read them, and tell them again at reattach (bug 1). Small
   to medium.
4. A default time limit on an agent turn. Small.
5. A longer default lease, 3 s renewed every 500 ms. Small.

- **Why:** each one alone breaks or strands one ticket run. All the rest either wait for weeks
  (bug 5, whole-record writes) or slow work down without breaking a run (bug 7, the clock).
- **What it costs:** about one or two days.
- **Next after those, and cheap:** bug 7's shared helper; tests for the 7 real gaps above; a
  hold that ends with its lease; a call that gives up.
- **The doubt:** fix 1 rests on reading code and an esbuild bundle of the ledgers, not on the
  app's own build. One run of the built app that starts the local ledger and one agent would
  settle it. And part 2's numbers come from 150 mutants, 17 or 18 in the small folders.

## What it cannot tell us

- **It ran nothing live.** No ticket, no app run, no agent. Every app and bundle claim is a code
  read, except the esbuild bundle of the two ledgers.
- **One sample of 150 of 16,669.** agents 18 and program 17 are small; their percentages could
  move 20 points with another seed.
- **The ledger's SQL is out of Stryker's sight.** Its 11 mutants say nothing about its tests.
  Measuring it needs the laws to run that SQL in the test's own process, or a planted mistake per
  survivor.
- **The typecheck filter is a choice.** A mutant `tsc` refuses could still hurt a caller that
  does not typecheck, such as a plain JavaScript user of the built package. Here it counts as a
  compile error, as the repo never ships code `tsc` refuses.
- **Stryker's default mutators only.** One small edit to one expression. A missing line, or two
  edits at once, is not here.
- **The contract is the old pipeline's.** A new pipeline built fresh may need other names. The
  list says which jobs exist, not their shape.
- **The hand check is one reader's.** The verdicts are in the results file, next to the code
  they name, to be checked again.

Cost: $0. Setup about 3 minutes. Typecheck 64 s. Stryker: 9 minutes for the sample, 11 for the
wider run, on one laptop with 4 workers under `nice -n 15`.
