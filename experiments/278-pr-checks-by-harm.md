---
date: "2026-11-11"
scripts: "none; reading, nothing ran"
summary: "Today's CI plus the lead's two laptop checks, sorted by pipeline strategies' line. Before the merge: the gate (`changes`, `ci-required`, `.github/ci/` tests), `commits`, the cheap `check` job (kept for a green main, 85%), and the tests that guard lasting harm (leak grep and `loosening.sh` and their own tests). After each merge: lane tests (paused programs), today's other tests, `next/` shards while `next/` holds no real data, macOS e2e. Before-merge wall from 268's medians: whole suite 964 to about 200 s, `next/` 316 to about 190, today's 327 to about 190, `.agents/` 455 to about 200 only if the tool checkout moves to a green main. Safe only with a reader of main's red (the 0108 watcher is not built) and a stop on merging over it (nothing stops one today). Three owner calls; 65% on the split. No model, $0."
---

# 278. Which checks must a pull request run before the merge, and which can run after it, sorted by whether a later change can undo the harm?

Read on 2026-11-11, on main at `9dd31f378`. **This is a reading, not a measurement:** no test ran
and no workflow changed. Every number in seconds comes from
[experiment 268](./268-checks-in-five-minutes.md)'s count of the last 40 merged pull requests. It is
about **today's CI** (`.github/workflows/check.yaml`, `commits.yaml` and `.github/ci/`), which checks
both versions, plus two checks the lead runs on the laptop (the leak grep and `loosening.sh`). The
sorting line is [pipeline strategies](../docs/direction/pipeline-strategies.md) (proposed): fix
forward when a later change can undo the harm, stop when it cannot. It decides nothing. It gives the
owner the list to decide from. One agent read; no model call of its own, $0.

**The answer: a pull request needs to run only four kinds of check before the merge.** The gate
itself (`changes`, `ci-required`, the `.github/ci/` tests), the `commits` chain, the cheap `check`
job (typecheck, lint, build), and the few tests that guard lasting harm (the leak grep's and
`loosening.sh`'s own tests, plus the laptop's two hand checks). Everything else guards harm a later
change can undo: the lane tests, today's other tests, `next/`'s shards while `next/` holds no real
data, and the macOS e2e. Those could run in main's run after each merge, which already runs them
all. Before-merge wall time would drop from 964 s to about 200 s on a whole-suite pull request, and
from 316 to 455 s to about 190 to 200 s on the others. It is only safe with three things that do
not exist today: someone reads a red main (the main watcher from 0108 is not built), a red main
stops the next merge, and the laptop's tool checkout moves only to a green main. About 65% sure the
split is right as a whole; the doubt is whether moving a test after the merge counts as loosening,
which is the owner's call.

```ts
// A sketch, not built. Both versions. The note's Harm, put to each check.
const Harm = Schema.TaggedUnion({
  undoable: { what: Schema.String },   // main red for one run; a revert or a fix repairs it
  lasting: { what: Schema.String },    // a published secret, lost work, a loosened law, a broken gate
});

const Check = Schema.Struct({
  name: Schema.String,
  guards: Harm,
  seconds: Schema.optional(Schema.Number), // median from experiment 268
});

const when = (check: typeof Check.Type): "before the merge" | "after each merge" =>
  check.guards._tag === "lasting" ? "before the merge" : "after each merge";

// One case: the lane tests guard today's paused pipeline programs.
when({ name: "lane tests", guards: { _tag: "undoable", what: "a paused program breaks" }, seconds: 304 });
// -> "after each merge"
```

## Every check, sorted

"Breaks on main" is what lands if the check is skipped before the merge. Seconds are 268's medians:
a job's median, or a step's median on the slowest machine. Main's own run on every push already
runs every job, so "after each merge" needs no new job, only a reader for its result.

| Check | Breaks on main if skipped | Undo? | Median s | Proposal |
|---|---|---|---|---|
| `changes` (path classifier, `skillscheck.sh`, `gitignore.mjs`) | the wrong jobs run, or skip, on every later pull request | lasting: it picks which checks guard the lasting harm below | 20 | before |
| `ci-required` (`required.mjs`) | a red job merges anyway; GitHub's ruleset reads only this and `commits` | lasting: the gate for everything else | not measured (no install) | before |
| `.github/ci/` tests (`changes`, `required`, `workflow-lint`, `field-check`, `shard-times`) | a bug in the gate lands and weakens it for the next merges | lasting, by the same reason | not measured | before, only when touched |
| `commits` (p83 to p87, p89: signed links, `build_touched_exam`) | a change whose exam a builder wrote, or with no signed link, lands | lasting: nobody writes their own exam; the squash keeps one commit and the proof sits on the branch | 50 | before (ruleset required) |
| `next/` exam's `commits.ts` and `plant.ts` tests | a broken commit check lands; `commits.yaml` runs main's copy on every later pull request | lasting: it weakens the gate | not measured (inside a `next` shard) | before, only when touched |
| field check (`field-check.ts`) | a misnamed or malformed field row lands | undoable: a row is a file, fixed by a later change | 20 | before; it never sets the wall |
| typecheck (`pnpm typecheck`, in `check`) | type errors on main | undoable | 50 | before (cheap, see below) |
| lint (`pnpm lint`: oxlint, format, layers, dead exports, workflow lint, exact versions, browser bundle) | broken rules on main; a version range in a `package.json` | undoable, except a range: the next install may pull a bad release onto the laptop | 66 | before (cheap) |
| ledgers committed (`unreachable-ledger.json`, `agents-ledger.json`) | a ledger grows without the owner's call | undoable | about 1 | before (inside `check`) |
| promises gate | a formal check's record goes stale | undoable | 4 | before (inside `check`) |
| build (`pnpm build`) | the packages do not build | undoable | 11 | before (inside `check`) |
| leak grep (`leakgrep.sh`, the lead's, before each push) | a private word is published | lasting: the repo is public, and a pushed branch is already published before any merge | not measured (laptop) | before the push, not only the merge |
| `leakgrep*.test.ts` (four files) | a broken leak grep lands, and the next push leaks | lasting | not measured | before, only when touched |
| `loosening.sh` at merge (`chain.ts`) | a narrowed law lands unseen | lasting: nobody writes their own exam; 0066's hourly arm a/b missed in 21 of 33 runs | not measured (laptop) | before |
| `loosening.test.ts` | a broken loosening check lands | lasting | 123 | before, only when touched |
| lane tests (`lane.*.test.ts`, one worker) | today's pipeline programs break | undoable: those programs are paused since 2026-11-05; only `outcome` is read by `drive.ts` | 304 (slowest shard) | after each merge |
| slow `.agents/` files (`box`, `boxrm`, `plancheck`, three `catchup.*`, `catchup.test.ts`) | the laptop's lead tooling breaks once the tool checkout moves | lasting today: `box rm` and gc delete worktrees, so a bug can lose unmerged work. Undoable if the checkout moves only to a green main | 395, 354, 226, 222, 204, 155, 122 (per file) | before today; after each merge with that guard |
| rest of today's tests (`packages/`, `programs/`, `apps/`) | today's app breaks in daily use | undoable, mostly; a file that guards today's stored records may not be (not sorted here) | 465 (slowest shard) | after each merge, with a named list of stored-data files kept before |
| `next` shards (vitest over `next/`, six machines) | `next/` breaks | undoable while `next/` is a lab with no real data; lasting once a person keeps work in its ledger | 163 per shard | after each merge, until `next/` holds real data |
| `next` `e2e.ts` and edges (shard 1) | an empty e2e folder fails; an edge goes unlisted | undoable; edges is advice | 11; edges not measured | after each merge |
| e2e on macOS (Electron, ruler) | the daily app's window rules break | undoable: a revert or fix; the owner's app runs from the checkout | 253 | after each merge |
| aria (in e2e) | nothing: advice only, `continue-on-error` | undoable | 19 | after each merge |
| mutation, hourly (0066, 0123) | already after | undoable: a survivor is a missing test | not in 268 | on a schedule, as now |
| main's full suite on push | already after | | 834 (run level) | after each merge, as now |

Today's three things that guard lasting harm and run off CI (the leak grep, `loosening.sh`, the
hand check of hits) keep their place. Moving them anywhere would walk back 0108's tie-breaker,
"a check that stops lasting harm never leaves the lane."

## Cheap checks: worth keeping before the merge?

Typecheck and lint guard only undoable harm. By the sorting line alone they could move after the
merge. They answer fast: the whole `check` job is 164 s, typecheck 50 s, lint 66 s.

- **For moving them after.** Strict by the rule, and it would cut about 190 s, which is the whole
  floor of the proposed before-merge set. The type errors 269 counted (15 red runs) would still be
  found, on main, one run later.
- **For keeping them before.** A red main costs every other lane, not only this one. A lane that
  merges main in, or whose `--changed` tests import the broken file, goes red on someone else's
  error. 269 counted about 10 PR-hours to type errors only CI found, inside one night. Google keeps
  "only fast, reliable ones" before submit; typecheck and lint are both, and they never set the
  wall in 268. And `ci-required` cannot pass without `check` today, so moving it means changing the
  gate too. 0133 (open, [PR 983](https://github.com/usirin/tea-fabrika/pull/983)) already removes
  the local typecheck because CI's runs on every push, which leans on it staying before the merge.
- **Lean:** keep the whole `check` job before the merge. About 85% sure. It costs about 190 s of
  wall per pull request, which is the price of a main that other lanes can build on. What would
  change it: the merge queue (0107, P43) testing the true merge, which would make main red rarer,
  and a count of how often a type error reaches main.

## What a red after the merge needs to be safe

**The known way first.**

- Google, *Software Engineering at Google*, ch. 23
  ([read 2026-11-11](https://abseil.io/resources/swe-book/html/ch23.html)): presubmit runs "only
  fast, reliable ones"; post-submit "can accept longer times and some instability". A presubmit
  pass has "a very high likelihood (95%+)" of passing the rest. A Build Cop owns a red post-submit,
  and "rolling a change back is often the fastest and safest route"; fixing forward is "a riskier
  proposition". A cultural norm "strongly discourages committing any new work on top of known
  failing tests", though a hard lock is called "probably misguided".
- Chromium's commit queue ([read 2026-11-11](https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md))
  runs the suites a change might affect, and keeps some tests CI-only, after submission, because
  they are too slow or expensive. A footer pulls them into a change's run on request.
- Martin Fowler, *Continuous Integration*
  ([read 2026-11-11](https://martinfowler.com/articles/continuousIntegration.html)): a failed
  integration build "needs to be fixed right away", reverting to "the last-known good build" is
  usually best, the commit build must be quick ("a ten minute build"), and slower tests come after.
- Trunk-based development ([read 2026-11-11](https://trunkbaseddevelopment.com/)): a build server
  checks trunk after each commit; the page names fix forward but says nothing on reverts.
- Merge queues: bors ([read 2026-11-11](https://bors.tech/essay/2017/02/02/pitch/)): per pull
  request CI "only checks each one in isolation", so "check the combination, before it goes to
  master". [GitHub's merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
  runs the required checks against main plus the changes ahead. It is not offered to this repo
  (0107). The original "not rocket science rule" post was not reachable (two addresses gave 404),
  so its wording is not quoted here.

**What exists here today.**

- **Who files the ticket.** 0131 says a red run on main files a ticket naming the merge, and 0108
  names a main watcher that files one ticket when main goes red. Neither is built: no code under
  the repo outside `docs/`, `.decisions/` and `experiments/` mentions a main watcher. 260 found
  "main red that nobody reads". So today, nobody.
- **How fast.** Main's full run takes 834 s at the median (268, run level). A break is visible
  about 14 minutes after the merge, plus the watcher's tick once it exists.
- **What stops a second merge on a red main.** Nothing. The ruleset requires `ci-required` and
  `commits` on the pull request's head, not main's state. 0116 turned off "up to date", and 0097
  lands a green head behind main after lint on the true merge only. So the second and third merges
  land on top of a red main, each one passing its own narrower checks.

**What it would need, from the known way.** Each item is small, and none exists yet:

1. A reader: the main watcher (0108), or a step in main's run that files the ticket (0131), with
   the merge's commit.
2. A stop: the merge script and later the merge queue read main's last run, and while it is red
   land only the fix or a revert. This is Google's norm made code. The doubt is Google's own: a
   hard lock can hold every lane for one slow fix.
3. The tool checkout moves only to a green main. Today the lead pulls main after a merge (lead
   skill) and 0108 moves that to the merge queue; neither waits for main's run. Without this, a
   red merge of lead tooling runs on the laptop at once.
4. A time bound: Google and Fowler both reach for the revert first. 0131 and 0096 pick fix forward
   and revert "unless the fix cannot be found". A bound such as "revert if no fix is open within
   one main run" would close the gap. No source here gives that number.

## What each proposal would change, and what it costs

**In 0106.** Its first bullet, "Tests run on the pull request, before the merge. They do not move
to a schedule." would become: tests that guard lasting harm, and the gate's own tests, run on the
pull request; the rest run in main's run after each merge. Its "A check is never dropped or
loosened to meet the budget" stays, but whether moving a check after the merge counts as loosening
is exactly what the owner rules on. 268 called narrowing `--changed` loosening because it runs
fewer tests on the pull request; this proposal runs fewer too.

**In 0131.** Its binding constraint "A test moves here only for being slow because of real
processes." would become "a test moves here when the harm it guards can be undone", and its title
would widen. "A check against lasting harm never moves here (0108)" stays as it is: it is this
write-up's sorting line. "The list of tests that run only on main is one named place in the repo"
stays, and becomes the list of the before-merge set instead, since that set is the shorter one.

**Wall time before the merge, per kind of pull request.** From 268's medians: `changes` 20 s plus
about 4 s of queue, `check` 164 s, `commits` 50 s, `field` 20 s, a test job's setup about 50 s
(checkout 16, pnpm 4, setup-node 13, install 4, apt 14), `loosening.test.ts` 123 s. The jobs run
side by side, so the wall is the longest chain.

| Kind | Today, median s | Proposed chain | Proposed s |
|---|---|---|---|
| docs | 54 | `changes`, `field`, `commits` side by side | 54 |
| `next/` only | 316 | 24 + 164 (`check`) | about 190 |
| `.agents/` tooling, checkout guard taken | 455 | 24 + 50 + 123 (`loosening.test.ts`, when touched) | about 200 |
| `.agents/` tooling, no checkout guard | 455 | 24 + 50 + 395 (`box.test.ts`), or about 250 after 268's split | about 250 to 470 |
| today's only | 327 | 24 + 164 | about 190 |
| mixed (whole suite) | 964 | max(24 + 164, 24 + 50 + 123) | about 200 |

The leak grep's tests and the `.github/ci/` tests were not timed, so a pull request that touches
them may run longer. Queue would also shrink: fewer jobs per pull request, against GitHub Free's 20
at once, though 268's p90 queue of 270 to 470 s came mostly from main's own runs, which this does
not change.

**What is lost.**

- A break in an undoable area reaches main and stays there for about one main run, 834 s, and
  longer until someone reads it. Every lane that merges main in during that time can go red.
- e2e on macOS no longer protects the owner's daily app before the merge. A broken window reaches
  the laptop when the checkout moves.
- The 95% Google cites is for its own presubmit set. Ours would be narrower than "the tests that
  reach a changed file", so our pass rate on main is not known and may be lower.
- The fix forward costs one more pull request per break, each through every step.
- `next/`'s shards move back before the merge the day a person keeps real work in `next/`'s
  ledger. Someone has to notice that day.

## Owner calls

1. Do tests that guard only undoable harm leave the pull request for main's run after each merge?
   It changes 0106's first bullet and widens 0131. Lean yes, 65%: it is the direction the owner
   named and the known way (presubmit fast, post-submit the rest), but only with calls 2 and 3.
2. Does a red main stop the next merge, except a fix or a revert? Lean yes, 80%: without it a
   red-after-merge stacks up, and nothing today stops it.
3. Does the tool checkout move only to a green main? Lean yes, 75%: it turns the slow lead tooling
   tests from lasting to undoable, which is the difference between about 200 s and about 470 s on
   an `.agents/` pull request.

## What it cannot tell us

- How often main would go red. No count of past pull requests whose own checks would have passed
  under the narrower set but failed on main. A replay of the last 40 pull requests' test results,
  sorted by the split, would settle it.
- The seconds for the leak grep's tests, the `.github/ci/` tests, `ci-required`, and the laptop's
  leak grep and `loosening.sh`. 268 did not time them.
- Which of today's test files guard stored records (today's ledger, job records, saved state). The
  row says "mostly undoable" without sorting them file by file.
- Whether the `commits` chain is truly lasting. The reason given (the squash keeps one commit, the
  proof is on the branch) is a reading of 0098 and P32, not tested. `chain on main` runs as advice
  after the merge, which may recover some of it.
- Whether the four sources' practice transfers to a repo where agents write most changes and two
  people read them. Google's numbers are for its own scale.
- The "not rocket science rule" was not read at its source.
