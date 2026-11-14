---
date: "2026-11-11"
summary: "`next/`, PR 810 at `36e65343c`. Not for `machine.ts`'s faults. The old file is almost all properties already: 148 tests are 71 property laws, 60 plants, 6 reach checks, 9 labeled and 2 unlabeled examples (both check the test's own fixture). A new file of 1,365 lines with 6 properties and 1 `format:` vector, one generator that reads the state it folds, killed 118 of the same 150 Stryker mutants (seed 119120, 958 in the file) against 95, in 2.5 s against 49 s; its first version, written before any result, killed 99. The old file alone kills 10 (schema and Cmd declarations, by its `format:` vectors; 2 after one decode check was added); the new one alone 25, among them the press record, key routing (the old ctx has no keys), pings, knock dial, `dials`, the removed key and a failed `now`'s retry. With the repo's `ignoreStatic: true`, `await import()` inside each test made 21 module-level kills read as survivors. No lint rule or script checks the four labels; only the tests and review skills' prose does. Ran on the host, no Docker; tokens not visible, dollars not measured. About 75% sure; one sample and a writer who had read the old file."
---

# 256. Does the window machine's 4,243-line law file deserve its size, or do far fewer property tests catch the same faults?

Measured on 2026-11-10 and 11, on the branch `fabrikalfa/p14` at `36e65343c` (open PR 810), in a
worktree on the branch `fabrikalfa/exp-law-size`. **Every claim is about `next/`**
(`next/packages/tuval/src/window/`), never today's version. One agent read, wrote and ran. No paid
model was called beyond the agent itself.

**The answer: not for the faults in `machine.ts`.** A second law file of 1,365 lines with 7 tests (6
properties and 1 `format:` vector) killed 118 of the same 150 sampled mutants, against 95 for the
4,243-line file with 148 tests. It runs in about 2.5 s, against 49 s. Its first version, written
before any mutation result came back, already killed 99. The old file's size is not mostly
redundant examples: it is almost all properties already. It is big because of 60 plant tests, 6
reach checks, 7 hand-built list generators added one bug at a time, a hang simulator, and an
integration test of the boot path that `machine.ts` mutants do not reach.

```ts
// The whole idea of the new file: one generator, folded through the real machine, read by a few laws.
const Run = fc.record({ layout, checks, events: fc.array(fc.tuple(event, fc.nat()), { minLength: 10, maxLength: 150, size: "max" }) });

// An event is read against the state the fold has reached: a link Msg goes to the dial the link is on
// (or one off), an "answer" picks one of the Cmds or writes that are really waiting, a view patch
// continues the revision the tile shows. So deep states come from blind runs, no hand-built prefix.
const near = (s: S, by: number): number => Math.max(1, (dialIn(s) ?? s.dials) + by);

// Each law reads every step against something the window does not own.
if (!same(x.next.client, x.client.after)) return "the window's client is not the client machine's own fold";
if (sends.length > 0 && !(goesOnline(x) || msg.type === "now_ok" || msg.type === "resend")) return `${msg.type} wrote a send`;
```

## Step 1: what the old file holds (reading, counted with Babel's parser)

The file has 86 `it` call sites. Loops over layouts and decoders make them 148 tests at run time.

| Kind | Sites | Tests at run time | Lines in `it` bodies |
|---|---|---|---|
| Property laws on the real machine (`propertyTrace` or `fc.assert` over generated runs) | 9 | 71 | 217 |
| Plants: one fixed break planted in the machine, then a property must throw | 60 | 60 | 558 |
| Reach checks ("good thing"): the generated runs met each case, counted | 6 | 6 | 364 |
| Labeled examples: 7 `format:`, 1 `scenario:`, 1 `pinned:` | 9 | 9 | 115 |
| Unlabeled examples | 2 | 2 | 28 |

The rough grep's "about 5 properties, about 10 labeled examples" was wrong: it counted `it.prop`,
and this file runs its properties through `propertyTrace` from `@demlik/tea/pbt` and `fc.assert`.

The two unlabeled examples, in the grouping the brief asked for:

- **One transition each (state, Msg, expected state): 0.**
- **A setup repeated with one value changed: 2.** "the layout's tiles are what opens"
  (`machine.laws.test.ts:1784`) checks `tilesIn` against the test's own fixture over the 4 fixed
  layouts: a check of the test, not of the machine. "plants: stopping at the first page..."
  (`:4222`) runs the test's own `expected`/`holds` oracle on 3 fixed streams: also a check of the
  test.
- **A real scenario of several steps, unlabeled: 0.** The multi-step fixed cases are the labeled
  `scenario:` (`:2568`) and `pinned:` (`:2892`).

Setup against assertions, by hand-drawn line ranges (about plus or minus 30 lines; the `it` body
counts above are exact): 52 lines of header comment; about 1,290 lines of generators, the fold and
trace harness, the hang clock and the boot path's doubles (a made-up brain, key and socket); about
220 lines of plant helpers; about 1,280 lines of law logic outside the `it` bodies (the `laws`,
`viewLaws`, hang, knock and settings checks); 1,282 lines of `it` bodies. 415 of the 4,243 lines
are comments. **The assertion logic is about a third of the file. Setup is another third. Plants
and reach checks are a quarter.**

Seven list generators exist because blind lists missed a case, each named in a comment with its
measured miss rate: `grantedLists` (a new grant going online, "about once in 250 runs"),
`owedLists` (an unanswered send whose dial ended, "0 in 1,500 runs"), `lateLists` (a notice
before its open's answer, "about once in 1,000 runs"), plus `linkLists`, `viewLists`, `pingLists`
and `settingsLists`. The new file's generator reads the state it is folding (the dial the link is
on, the waiting Cmds, the shown revision), so it reached all of those cases without a prefix list.

## Step 2 and 4: the mutation runs (measurement)

**Setup.** StrykerJS 10.1.1 with the repo's settings from `.agents/skills/mutation/scripts/run.sh`
(vitest runner, `perTest` coverage, `timeoutMS` 5000, the 10 s test limit), except: concurrency 3,
no incremental reuse, and on the host in place, since the brief ruled out Docker (see the end). The
sample is the repo's own sampler, `sample.ts`'s `sample()`, over every line of `machine.ts`: 958
mutants, 150 selected at seed 119120, 808 left. Both files ran against the same 150, keyed by
location, mutator and replacement.

**The first run of the old file under-counted it by 21 kills.** With `ignoreStatic: true`, as
`run.sh` has it, the old file read 74 killed, 71 survived, 5 no coverage, 0 ignored. The new file
read 81 killed, 6 survived, 5 no coverage, 58 ignored. The difference is how each loads the
module: the old file loads `./machine.ts` by `await import()` inside each test, so Stryker counts
module-level code (schemas, Cmd definitions) as covered by the first test. It then flips its
"active mutant" switch after that code already ran, so the mutant is never live and reads as
Survived. The new file imports at the top, so the same code is static: ignored with
`ignoreStatic: true`, and reloaded per mutant with `ignoreStatic: false`. To compare fairly, both
were run again with `ignoreStatic: false`, the old file through a copy with one added line,
`import "./machine.ts";` at the top (deleted after). That copy killed all 74 again plus 21 more,
all module-level.

| | Old file | New file, first version | New file, final |
|---|---|---|---|
| Lines (formatted) | 4,243 | 1,001 | 1,365 |
| Tests at run time | 148 | 7 | 7 |
| Properties | 71 (9 sites) | 6 | 6 |
| Labeled examples | 9 | 1 | 1 |
| Time, file alone | 49 s wall, 47.6 s in tests | about 2.4 s wall | 2.5 s wall, 1.9 s in tests |
| Killed of 150 (static on) | 95 + 1 runtime error | 99 + 1 runtime error | 118 + 1 runtime error |
| Survived / no coverage | 49 / 5 | 45 / 5 | 26 / 5 |
| Stryker wall time (static on) | 21 min 24 s | 70 s | 56 s |

The runtime error is the same mutant on both sides (`machine.ts:234`, `Cmd.make`'s options to
`{}`, which throws at load). The 5 no-coverage mutants are lines 269, 473, 567 and 624 on both
sides, plus 286 (a `traceId` copy) on the old side and 572 (the init's `?? []` when the ctx has no
keys) on the new.

**The final version is the first one plus two checks, added after the first comparison came
back.** The wire law now decodes every Msg the runner sends through the machine's own `msg` schema
and every Cmd's input through the schema the window declares for it, refusing unknown keys; the
saved-state law decodes the saved Model the same strict way. That moved 19 mutants. The first
version is the clean comparison, since it was written before any mutation result; the final one
shows what one more property line buys.

## What only one side kills

**Killed by the old file only, against the first version: 10. Against the final: 2.** All 10 are
schema or Cmd declarations, killed by the old file's `format:` vectors:

- `machine.ts:614`, `cmds: [...]` to `[]`: the old file's `format:` test looks up the declared
  `read_settings` Cmd. The new file folds with `applyCell` and never asks tea which Cmds exist.
  The final version's Cmd-input check kills it.
- `:101` `CallError` to `{}`, `:186`, `:191`, `:192`, `:194`, `:199`, `:203` (a Msg's `type`
  literal to `""`): the old vectors decode a good Msg and expect true. The first version decoded
  only refusals. The final version's Msg decode kills these 7.
- **Still old-only in the final:** `:196`, `open_ok`'s `value` struct to `{}`, and `:235`,
  `read_settings`'s input to `{}`. An empty `Schema.Struct({})` in Effect 4.1.2 accepts any object
  and keeps its keys (checked by hand: `decodeUnknownSync(Struct({}))({a: 1})` gives `{a: 1}`),
  so only a vector that feeds a bad value sees it. The old file has those two refusals; the new
  one has neither.

**Killed by the new file only: 14 against the first version, 25 against the final.** These 14
are behavior the old file never checks:

- `:443`, `:459`, `:460`, `:466`, `:467`: the `press` record. The old file has no law for press
  rows at all: its record laws cover persist, reply, connect and view rows. A press row could be
  dropped, lose its `via`, or carry a negative `viewRev` unseen.
- `:268`: `commandFor`, the command a press names. The old file's ctx is `{layout}` with no
  `keys`, so every tile takes no command, key routing never presses, and the press row's command
  is never checked.
- `:286`: a letter's `traceId` copied into its send. The old file's `now` answers never carry a
  `traceId`, so the line has no coverage there.
- `:492`, `dials` past the highest dial; `:494`, the removed key's fingerprint kept for the next
  socket (`rejected`): no old law reads either field or the socket Sub's deps.
- `:497`, a knock written on dial `0`; `:500` and `:513`, the link's `ping` Cmds dropped or
  replaced: the old hang and knocking laws count knocks and watch timers, but never compare the
  window's pings and knock dial with the link machine's own.
- `:622`, `:623`: a failed `now` no longer marked for its retry. The old `now` law checks that a
  failed `now` keeps the press, not that the resend tick asks its time again.
- Final only, 11 more: the `type` literals of `press`, `view`, `resend`, `focus`, `resized`,
  `key`, `keys`, `keys_failed`, `seen`, `knock_ok`, `knock_err` (`:166` to `:201`). No old vector
  decodes those Msgs.

**Live in both: 29 in the final.** 17 are schema bodies set to `{}` or an error list emptied
(`WindowModel` and its fields, `KeyInput`, `Table`, the Cmds' `input`, `ok` and `err`): with
Effect's empty struct accepting anything, only generated bad input would kill the schema bodies,
and neither file generates bad Msgs or bad saved Models; the error lists matter only when tea's
runtime decodes a Cmd's failure, which `applyCell` never does. 4 are the lines no test reaches (269, 473, 567, 624).
The other 8 read as equivalent in these runs: initial `opened`,
`sent` and the leaving-online resets set to `["Stryker was here"]` (a word no letter or pid can
equal), `?.` dropped where the value is always present, and `types: {}` (type-only).

## How the new file avoids an oracle that restates `update`

No law computes the next Model. Each step is checked against:

- **The child machines' own folds.** The trace steps its own `linkMachine` and
  `clientMachineFor(checks)` on the Msg the window owes each one, and the window's `link` and
  `client` must equal them. That is the Elm rule (a parent steps its children) as a law.
- **Library functions the window calls, never its own helpers.** `ProgramClient.sendable`,
  `socketDial`, `timerDeps`, `routeKey` and `Keys.buildTable`. A bug inside one of these is not
  this file's to find; their own laws are in libfabrika and `desktop/`.
- **Counts the trace keeps itself.** Which letters are out on this dial (from the writes and their
  answers), how often each letter was written (for a reply row's `attempts`), the patches each run
  installed, the slots whose time failed, and the last removed key.
- **Values the step's Msg carried in.** A connect row's `ms` and dial, a reply's result, a
  settings failure's reason.
- **Liveness, not deps.** The resend timer is armed exactly while something waits, and firing it
  from that state asks at least one Cmd. That is checked by folding its own Msg, not by
  restating its deps function.

The one place close to a restatement is the connect row's outcome name (online, waiting,
removed, closed, stalled), read off the link before and after. It is the spec's own wording of A8
and the same as the old file's `linkOutcome`.

## Step 5: is every old test a property or a labeled example?

**By form, 146 of 148 pass and 2 do not.** The 71 property laws, 60 plants and 6 reach checks all
fold generated runs. The 9 fixed tests carry `format:`, `scenario:` or `pinned:` with a `reason:`
comment. The two that fail the rule are the unlabeled examples above, at
`machine.laws.test.ts:1784` and `:4222` (the second's title starts with `plants:`, which is no
label). Neither checks the machine: both check the test's own fixture or oracle.

Why nothing caught them (reading):

- **No lint rule reads test titles.** `oxlint-plugins/` has no rule for the four labels: a grep
  for `vector:` finds it only in test fixtures of other rules, never in a rule.
- **`loosening.sh` reads narrowing, not labels.** It compares `numRuns`, fast-check bounds,
  property counts and removed `expect`s between base and head
  (`.agents/skills/lead/scripts/loosening.sh:218-262`). A new test file clears only when
  `clean_new_file` finds no shared-state call or import (`:277-283`, used at `:371`); this
  file's `await import()` makes it a hand-check hit, but that check is about isolation, not labels.
- **The rule lives in prose only.** The tests skill (`.agents/skills/tests/SKILL.md:33-34`) and the
  review skill (`.agents/skills/review/SKILL.md:36-42`) state it; an agent applies it by reading.
  The same tests skill asks for a plant per law (`SKILL.md:19`), which is where 60 of the 148
  tests come from.

## Other things the runs showed

- **Stryker's in-place mode touches the whole checkout.** Each run added `// @ts-nocheck` to 1,339
  tracked files and restored them at the end, and each time left `fixtures/pipeline-lane/codex.mjs`
  with its execute bit dropped (fixed by hand with `chmod 755` after every run). This is why
  `run.sh` uses `IN_PLACE=1` only inside the container.
- **The mutation skill's hand-plant rule is needed for files that `await import()`.** Step 3 of
  `.agents/skills/mutation/SKILL.md` already says a schema made at module load needs a
  hand-planted check before any claim. This run shows the size of the miss: 21 of 150, all false
  survivors, all on a file written before its module existed (the tests skill's habit).

## What it cannot tell us

- **One sample.** 150 of 958 mutants, one seed, one product file. Mutants in libfabrika's link and
  client machines, `keys.ts`, `main.tsx` and the runner were not sampled. The old file's boot test
  (`window boot`, 2 tests, about 7 s) reaches `startWindow` and the runner; nothing here measures
  what it catches there, and the new file has no counterpart.
- **The new file was written by an agent that had read the old one.** The old file's spec work
  (the plan's A5 to A16, the stale-answer and late-open rules) shaped the new laws. A writer who
  reads only the plan might do worse; this run cannot say.
- **No plants in the new file.** Here the mutation run showed each law can fail. In this repo
  mutation runs hourly on main, not per pull request (0066), so a law with no plant could ship
  vacuous until that run.
- **The hang law's real-time bound is not restated.** The new file checks that the window's link
  timer is exactly `timerDeps(link)` and leaves the 10 s detection bound to `Link.laws.test.ts`.
  The old file simulates the clock itself. If the window ever added a timer of its own that held
  the link, the new file would see it only as a deps mismatch.
- **Ran on the host, not in a container.** The brief ruled out Docker; decision 0045 puts a
  mutation step in a container. Stryker's log server listened on the host's loopback, which the
  laptop sandbox allowed without any setting changed. This was an experiment, not a pipeline step.
- **Line counts depend on the formatter.** The new file is 1,001 lines as first formatted and
  1,365 after `oxfmt` and `oxlint --fix` (the blank-line rule). The old file is at the repo's
  format already.

## Cost

This agent's run: tokens not visible to the agent, so dollars not measured. No other model was
called. Stryker on the host: 8 min 50 s, 33 s, 70 s, 21 min 24 s and 56 s of wall time across five
runs.

## Where things are

None of it is on main (decision 0027). The new law file,
`next/packages/tuval/src/window/machine.model.laws.test.ts`, its first version, the sampler
wrapper, the Stryker scripts and the comparison script live on the branch
`fabrikalfa/exp-law-size`. Every Stryker report and the sample are raw results, so they are in the
owner's private archive, not in git. Every number this write-up uses is quoted above.
