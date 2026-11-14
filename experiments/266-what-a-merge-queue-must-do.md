---
date: "2026-11-11"
scripts: "none; reading, nothing ran"
summary: "Today's lead tooling, plus how others queue merges (Rust bors, bors-ng, Zuul, GitLab trains, GitHub's queue, Mergify, Aviator, Graphite), and how phoenix and demlik use GitHub's queue (squash, `ALLGREEN`, 5 to build and 5 to merge, 5-minute wait). The rule all of them follow: test the exact tree that will land, on the main it lands on, before main moves. On 2026-11-10, 147 merges landed and 23 touched code. One full CI run is 16 jobs and GitHub Free runs 20 at once, so running merges side by side does not fit. So: stage 1 lands one change at a time; stage 2 batches 4 or 5 and splits a red batch in halves; stage 3 has the queue sign a link from the checked tree to the landed tree, closing 0098's gap. Workflows cost $0 above the plan, but they keep control state as a position in code (0037, 0046). Lean, about 75%: a tea machine in one Durable Object, with alarms. The owner kept \"no Workflows\" and chose one queue program plus one merger per change, talking by mail; the cheap lane moved to the \"better\" stage. Decided as 0107, 0110 and 0111. No model, $0."
---

# 266. What must a merge queue do, and how should fabrika's own be built?

Read on 2026-11-11. **This is reading, not a measurement.** Nothing was changed on GitHub or in
any repo, no model was called beyond the one agent that read, and it cost $0. It is the research
the owner walked before [0107](../.decisions/0107-fabrika-provides-the-merge-queue.md) (fabrika
provides the merge queue), [0110](../.decisions/0110-merge-queue-is-fabrika-programs.md) (it is
built as fabrika programs) and [0111](../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md)
(its first stage is Tier 1 row P43). It was written as the source for the queue's spec and moved
here from a scratch file on 2026-11-11 ([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)).

**Versions.** Claims about "today" mean today's lead tooling (`.agents/skills/lead/scripts/`),
which lands changes for both versions. Claims about the queue to build are about `next/`. Here
"stage" means only the merge queue's own three build-out stages, as 0110 names them: works,
better, secure.

**The answer: test the exact tree that will land, on the main it will land on, before main
moves.** Every queue read follows that one rule. For this repo, at this pace and on GitHub Free,
that means: stage 1 lands one change at a time, in order; stage 2 batches 4 or 5 and splits a red
batch in halves, and does not run merges side by side, because one full CI run is 16 jobs and the
free plan runs 20 at once; stage 3 has the queue sign its own link from the checked tree to the
landed tree. The research leaned toward one Durable Object holding a tea machine, with an alarm
for every wait, and away from Cloudflare Workflows, at about 75%. The owner kept "no Workflows"
and changed the shape: one queue program plus one merger per change, talking by mail (0110; see
[Where the decisions went another way](#where-the-decisions-went-another-way)).

```text
the rule      test the exact tree that will land, on the main it will land on, before main moves
              (Graydon Hoare's "not rocket science rule", the rule every queue below follows)
stage 1       one worker, one entry at a time: bring the PR up to date, wait for its checks on that
              head, squash pinned to that head; main moves only through the queue
stage 2       batches of up to 4 or 5, split in halves on red; not speculation, because our Free
              runners fit about one full CI run at a time (20 jobs, and one run is 16)
stage 3       a signed entry: who enqueued it, which tree was tested, and the queue's own link
              in the signed chain from the head's tree to the landed tree
where         a tea machine in a Durable Object that wakes on a call, a check event or an alarm
              (0105), with the steps as plain Effects; not Cloudflare Workflows for the queue itself
```

The numbers it rests on, read from this repo on 2026-11-11:

- Merges to main per day: 133 on 2026-11-09, 147 on 2026-11-10, 70 so far on 2026-11-11
  (`git log origin/main --first-parent`). Of the 147 on 2026-11-10, only **23 touched code**; 124
  were Markdown or `field/` rows only. So "about 30 merges a day" holds for code, and the queue also
  has to carry about 120 cheap ones.
- Pull request `check` runs, last 25 green: 0 to 24 minutes, code pull requests about 7 to 24
  (`gh run list -w check`). Main's push runs: 13 to 24 minutes, and 2 of the last 40 were red,
  the "main red for one CI run" cost that
  [0097](../.decisions/0097-a-green-pull-request-lands-without-catching-up.md) accepted.
- One full `check` run was 16 jobs: `changes`, `field`, `check`, `e2e` (macOS), `test` x6, `next`
  x6 (`.github/workflows/check.yaml`). Rechecked on main 2026-11-11: those 16, plus a small
  `ci-required` job that reads the others' results, so 17. GitHub Free gives **20 concurrent
  jobs, 5 of them macOS** ([Actions limits](https://docs.github.com/en/actions/reference/limits)).

## 1. How the known queues work

Behavior only. None of these is proposed as a tool to adopt.

### The rule they all follow

Graydon Hoare named it for monotone and then Rust's bors: "automatically maintain a repository
of code that always passes all the tests." A bot keeps a queue of approved changes, merges the
next one onto main in a scratch branch, tests that exact merge, and moves main only if it passed
([the post](https://graydon2.dreamwidth.org/1597.html); the fetch returned 404 on 2026-11-11, so the
quote is from memory and the link should be checked).

### GitHub merge queue

- **Which repos have it:** "Pull request merge queues are available in any public repository owned
  by an organization, or in private repositories owned by organizations using GitHub Enterprise
  Cloud"
  ([Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue),
  the page's product note). A personal-account repo like this one does not.
- **States:** queued, then in a group being built, then merged or removed. The reasons it removes
  one: a failing check on its group, a CI timeout, a person removing it, a branch rule it cannot
  resolve ([Merging with a merge queue](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request-with-a-merge-queue)).
- **How it tests the merged state:** a temporary branch `gh-readonly-queue/<base>/pr-N-<sha>`
  holding the base, every pull request ahead in the queue, and this one. CI runs on the
  `merge_group` event, which is "separate from the `pull_request` and `push` events"; without it
  the required check never reports and the merge fails. When the checks pass, "the temporary branch
  `main/pr-2` will be merged in to the target branch" (same page).
- **Batching and speculation:** each pull request's branch includes the ones ahead, so the queue
  runs several such branches at once ("build concurrency", 1 to 100) and merges up to "merge
  limits" (min and max, 1 to 100) together, waiting at most a set time for the minimum. The ruleset
  API names these `max_entries_to_build`, `max_entries_to_merge`, `min_entries_to_merge`,
  `min_entries_to_merge_wait_minutes` (0 to 360), `check_response_timeout_minutes` (1 to 360) and
  `grouping_strategy` `ALLGREEN` or `HEADGREEN` ([REST rules](https://docs.github.com/en/rest/repos/rules)).
  `HEADGREEN` is "only merge non-failing pull requests" turned off: a pull request that failed may
  still land if the last one of its group passed, which hides flaky failures.
- **On red:** the failing pull request is removed, and every group built on it is rebuilt without
  it. No bisecting: the queue already tested each prefix.
- **Priority:** "jump to the top", which rebuilds every group in progress.
- **Merge method:** merge, rebase or squash. The squash commit is authored by the pull request's
  author and committed by GitHub (phoenix's last 3 queue merges: committer `GitHub`, signature
  valid). The enqueue call (`enqueuePullRequest`) takes only `pullRequestId`, `jump` and
  `expectedHeadOid` (GraphQL schema, read 2026-11-11): **no commit message and no trailers**; the
  repo's squash defaults (`COMMIT_OR_PR_TITLE`, `COMMIT_MESSAGES` here) decide them.
  `expectedHeadOid` is the head pin.
- **What it records:** the pull request's timeline says when it joined, left and why. Nothing on
  wait time per state, group size or which base was tested is kept for analysis.

### Rust's bors (rust-lang/bors, which replaces homu)

From [its design doc](https://github.com/rust-lang/bors/blob/main/docs/design.md) and
[command list](https://bors-prod.rust-lang.net/help):

- **States:** `r+` is a tentative approval until the pull request's own CI passes, then it is
  queued. Then an auto build runs, then success (main moves) or failure. `retry` clears a failed
  build so the queue tries again; `r-` and `cancel` take it out.
- **How it tests:** merges the pull request with the latest main in `automation/bors/auto-merge`,
  pushes that commit to `automation/bors/auto` where CI runs, and "if all tests pass, the base
  branch is fast-forwarded to the merge commit." So **the commit tested is the commit that lands.**
  Two branches, because GitHub cannot set a branch and merge into it in one call.
- **One at a time:** "Only one auto build runs at a time to ensure that each PR is tested against
  the same branch state it will be merged into."
- **Batching:** by hand. A person makes a rollup pull request of several `rollup`-eligible ones
  (`never`, `iffy`, `maybe`, `always`), and after it merges bors runs "unrolled" builds of each
  member for performance data.
- **Priority:** `p=<n>`; `treeclosed=<n>` closes the queue to everything below priority n.
- **Outside faults:** a refresh every few minutes cancels CI that runs past `timeout`, rechecks
  mergeability and syncs its database with GitHub. It reads the "workflow completed" webhook and
  never the "check suite completed" one, which can arrive first and give a wrong answer.
- **What it records:** every try and auto build in its database, with commands handled one at a
  time to avoid races.

### bors-ng (the older bot)

From [its docs](https://bors.tech/documentation/): `bors r+` tests and pushes, `try` tests only,
`p=` sets priority ("PRs with different priorities are never batched together"), `single on`
turns batching off for one pull request, `retry` reruns. Settings: `max_batch_size`,
`timeout_sec`, `block_labels`, `use_squash_merge`, `cut_body_after`. It batches by default and,
from memory (a guess), splits a failed batch in half; the docs page does not say so. Its public
instance "is being phased out in favor of GitHub Merge Queues."

### Zuul (OpenStack) speculative gating

From [gating](https://zuul-ci.org/docs/zuul/latest/gating.html) and
[pipeline settings](https://zuul-ci.org/docs/zuul/latest/config/pipeline.html):

- In a dependent pipeline it "assumes that all jobs will succeed and tests them in parallel":
  change 3 runs on main + 1 + 2 + 3 while 1 and 2 still run. If 1 fails, the changes behind it
  are tested again without it.
- **Window:** jobs start only for the first `window` changes (default 20), with `window-floor`
  default 3 and an optional ceiling. It grows when changes merge and shrinks when they fail,
  linear or exponential, like TCP's congestion window.
- **Dependencies:** `Depends-On:` footers across projects, in order.

### GitLab merge trains

From [merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/): each merge request's
pipeline runs on main plus every one ahead of it, "a maximum of 20 pipelines in parallel" by
default. On a failure, "GitLab removes that merge request from the merge train," and the
pipelines behind it restart. A failed train pipeline cannot be retried; you add the merge request
again. "Merge immediately" skips the train and costs a restart of it. Premium and Ultimate only.

### Mergify, Aviator, Graphite (behavior only)

- **Mergify** ([lifecycle](https://docs.mergify.com/merge-queue/lifecycle/),
  [batches](https://docs.mergify.com/merge-queue/batches/)): states Queueing, Queued,
  Validating, Merged, Dequeued; dequeue reasons `checks-timeout`, `checks-interrupted`,
  `checks-failed`, `conflict-with-base-branch`. Batches by `batch_size` (a fixed size or a min/max
  range) and `batch_max_wait_time`. **On red it splits:** the batches after it are canceled, the
  first n-1 pull requests are cut into up to `max_parallel_checks` parts tested on top of each
  other, and the last one is not tested again; it stops after
  `batch_max_failure_resolution_attempts`. `max_checks_retries` reruns checks for flaky failures.
  Priority rules move an entry.
- **Aviator** ([parallel mode](https://docs.aviator.co/mergequeue/concepts/parallel-mode)): a
  draft pull request per queued one, holding everything ahead of it, capped by "max bot builds in
  parallel". On red the drafts after it close and the queue restarts without the failed one. If a
  later draft goes green while an earlier one is stuck, it merges everything up to that point. A
  stuck one is dequeued after a set number of minutes. Skip the line resets every draft.
- **Graphite** ([merge queue](https://graphite.com/docs/graphite-merge-queue)): stack-aware, and
  when a stack was already tested on that exact change it lands by fast-forward with no new CI.
  It cannot run beside GitHub's own queue.

### What they share

| Queue | Tests the merged state by | On red | Batches | Priority |
| --- | --- | --- | --- | --- |
| Rust bors | one merge commit, fast-forwarded if green | that one fails; next one starts | rollups by hand | `p=`, tree closed |
| GitHub | `gh-readonly-queue` branch with all ahead | remove it, rebuild the rest | yes, groups | jump |
| Zuul | speculative, window 20, floor 3 | retest those behind without it | implicit | none listed |
| GitLab | pipeline on main + all ahead | remove it, restart those behind | implicit, 20 parallel | merge immediately |
| Mergify | draft pull request per batch | split the batch, drop the bad one | `batch_size` | priority rules |

Every one records less than we want: none keeps per-state wait times, the base each test ran on
and the reason each entry left as data a later question can read.

## 2. How phoenix and demlik use GitHub's queue

Both sibling repos are owned by an organization, so they have GitHub's queue.

- **Rulesets** (`gh api repos/kamp-us/<repo>/rulesets/<id>`, read 2026-11-11): both have
  `merge_queue` with `merge_method SQUASH`, `grouping_strategy ALLGREEN`, `max_entries_to_build 5`,
  `max_entries_to_merge 5`, `min_entries_to_merge 1`, `min_entries_to_merge_wait_minutes 5`,
  `check_response_timeout_minutes 60`, and `strict_required_status_checks_policy false` (the
  queue replaces "up to date"). phoenix requires 4 checks (`ci-required`, a leak scan, a skill
  check, a governance check); demlik requires `test-and-build`.
- **How checks reach the queue:** phoenix adds `merge_group:` to every workflow that makes a
  required check, and reads the base from `github.event.merge_group.base_sha` and the head from
  `github.event.merge_group.head_sha` ([phoenix 0132](https://github.com/kamp-us/phoenix/blob/main/.decisions/0132-merge-queue-for-base-freshness.md)).
  demlik has no `merge_group:` at all: its `build.yaml` runs on `push` to `"**"`, which matches
  the `gh-readonly-queue/main/...` branch, so the check lands on the group's sha that way.
- **What phoenix's ship step expects** ([0132](https://github.com/kamp-us/phoenix/blob/main/.decisions/0132-merge-queue-for-base-freshness.md),
  [0313](https://github.com/kamp-us/phoenix/blob/main/.decisions/0313-a-queue-dwell-is-a-wait-not-a-park.md),
  [0048](https://github.com/kamp-us/phoenix/blob/main/.decisions/0048-ship-it-merge-actor.md)):
  - ship enqueues with `gh pr merge --squash --auto` and succeeds on "enqueued and green", not
    "merged"; the merge and the ticket close happen later.
  - `allow_auto_merge` must be on, or every enqueue jams (their outage, phoenix issue 1817, about
    8 pull requests stuck).
  - Ship then reads the queue once per driver pass: `landed`, `unresolved` (still queued),
    `ejected` (back to build) or `parked`. A long stay in the queue is a wait with its own budget
    of 3 re-reads, never a call to a person. One pull request sat 13 m 45 s against a 480 s
    horizon and landed fine.
  - A required check's name is frozen: renaming it hangs every queued merge.

So a queue that a ship step can use must answer "is this entry queued, landed, sent back with a
reason, or stuck", read once and cheaply, with the head it was pinned to.

## 3. What today's lead scripts do that a queue must keep

All of this is today's lead tooling, run on the laptop. Rechecked against main on 2026-11-11:
every script named is still there, and `catchup.sh` is still shell (its port is due under
[0113](../.decisions/0113-no-shell-or-python-scripts.md)).

| Job | Where today | Keep in the queue? |
| --- | --- | --- |
| One lock while it fetches, merges, signs, pushes | `catchup.sh` (`catchup.lock`) | yes: the queue is the single writer of main |
| Merge main in as the bot, sign that merge as `lead`, push with notes | `catchup.sh`, `botpush.mjs` | yes in stage 1 (it is "bring up to date") |
| Leak grep on the net change and on each commit sent | `botpush.mjs` → `leakgrep.sh` | yes, before any push; fails closed |
| Wait for `check`, `e2e`, `commits`, `next (1..6)` on the exact sha, up to an hour; a skipped job counts as done | `catchup.sh` | yes, as an event wait with a limit |
| Trust `commits` only as one `pull_request_target` run of main's `commits.yaml`, made by GitHub Actions, for this ticket | `catchup.sh` | yes: it is the security core of the check |
| Lint on the true merge when main moved after the checks | `freshmain.ts` (0049, 0097) | stage 1 makes it unneeded for code (main cannot move under the entry); stays for the cheap lane |
| Squash pinned to the head (`--match-head-commit`, or REST `sha` when `gh` says BEHIND) | `catchup.sh` (0049) | yes: `CodeHost.merge(pr, head)` |
| Land a gh stack bottom-up | `catchup.sh` → `gh stack merge` (0004) | yes, one entry per stack |
| Size line against 600 product lines, advice only | `sizecap.ts` (0087) | record it on the entry |
| Close each ticket the body names, `fabrika close ticket <N>`, with a comment naming the merge | `catchup.sh` `close_named` (0015) | yes, after "landed" is confirmed on main |
| Keep the checked head as `refs/keep/pr/<n>`, remove boxes and the lane's worktree | `catchup.sh` `sweep` | stays on the laptop; the queue only says "landed" |
| Loosening check and the lead's hand check | `loosening.sh`, before `catchup.sh` (0014) | **before** enqueue: a gate on who may enqueue, not a queue step |
| Pull the main checkout after merges | by hand | once per burst, after the queue goes idle, not per merge |

The signed chain ([0098](../.decisions/0098-the-signed-chain-covers-the-branch-not-main.md)):
step links live as git notes on `refs/notes/fabrika`; "CI decides from the signature, never from
the author, the message or a trailer" (`next/apps/fabrika/src/exam/commits.ts:3`). So the squash
commit's author and message do not matter to the chain, which is good news for any queue. When
read, the post-merge `chain` asked `last.to === trees.get(squash)`: the last link must end at the
landed tree. On main on 2026-11-11 that line is `commits.ts:366`, and it also accepts
`last.to === placed.head`, the head that was checked, which is 0098's rule in code. When a pull
request lands behind main without a catch-up (0097), the landed tree is never signed by anyone:
the gap 0098 states in its costs ("the chain no longer proves the squash's tree by itself"). A
queue can close it: stage 3 below.

Failures seen on 2026-11-10 (rows in `field/findings.jsonl` and `field/notes.jsonl` on main; no
merge notes dated 2026-11-11 were on main when read, only findings):

- Finding `2026-11-10-f22`: main moved during the hour-long wait, GitHub refused the squash, the
  script exited, and a second run by hand was needed. Pull requests 665 and 702 each carry two
  "Merge main into" commits from two runs. Cost: one more full CI run per retry.
- Finding `2026-11-10-f08`: 12 of 20 merges landed behind main because the admin role bypasses
  the up-to-date rule; one put an unformatted file on main (pull request 743), red until pull
  request 742. This is what `freshmain.ts` was built for.
- Finding `2026-11-10-f36`: `field/runs.jsonl`'s `merge=union` works only in local git, so
  GitHub calls a pull request with a run row DIRTY whenever main adds rows, starts no
  `pull_request` checks, and the script waits an hour for checks that never come. (Rows are files
  now, [0090](../.decisions/0090-each-field-row-is-a-file.md), which removes most of this.)
- Notes `2026-11-10-06` and `-11`: `commits` said `broken_chain` only because main moved (the
  reason for 0098).
- Notes `2026-11-10-08`, `-09`, `-15`: a whole-tree format sweep (pull request 736) conflicted
  with every lane in flight, 26 to 130 files; `catchup.sh` aborts on a conflict and the lead merged
  by hand. A queue cannot fix that; it must send the entry back with the conflicted files and the
  step that owns each.
- 0097's context: about 20 finished pull requests stood in one line after a CI outage, each caught
  up and re-tested for about 13 minutes, so the line was hours long.

## 4. A proposal in three stages

Settled notes this touches, and where it walks one back:

- [The ledger behind a service](../docs/direction/ledger-behind-a-service.md) says
  "`CodeHost.enqueue(pr, head)` // the queue lives with the code". Our own queue **moves the
  queue out of `CodeHost`** into a fabrika program; `CodeHost` keeps the parts only the host can
  do. That is a walk-back of one line and needed its own decision (0107 made it).
- [The ship step's rules](../docs/direction/ship-stage-rules.md): "a branch behind main ships as
  it is ... the merge queue tests it on top of main" and the queue-wait limit
  `stuck:queue_silent` hold as they are; our queue becomes that queue.
- 0049, 0097 and 0098 accepted "main can be red for one CI run" as the cost of having no queue.
  Stage 1 removes that cost for code pull requests. 0049 and 0097 would be superseded; 0098 stays.
- 0004 (squash, gh stacks) and 0014 (who merges) stay.

### Stage 1: works

The smallest queue that lands this repo's pull requests.

```text
one worker, entries in arrival order, one code entry in flight
  bring up to date   merge main into the head as the bot, sign as lead, leak grep, push
                     (skip when the head already holds main)
  test               wait for the required checks on that exact head (event, limit 60 min)
  merge              CodeHost.merge(pr, head, squash); main has not moved, because only the
                     queue moves it, so the landed tree is the tested tree
  confirm            the squash is on main; its tree equals the tested merge tree
  close              close named tickets; say "landed"
back to the lane     conflict (with files), a red required check, a moved head
retried              outside faults: a 5xx, a rate limit, a check that never started
                     (`startup_failure`), a fetch that fails; up to 3, with backoff, by alarm
```

The cheap lane. 124 of 147 merges a day touch only Markdown or `field/`, and CI already skips the
heavy jobs for them (`.github/ci/changes.mjs`). Putting each behind a 15-minute code test would
cost about 30 hours of waiting a day. So the research gave stage 1 two kinds of entry, decided by
the same classifier CI uses: a `light` entry (the paths CI skips) may land while a code entry is
testing, after lint on its true merge (today's 0097 rule, kept for this kind only). A code entry's
final check then allows main to have moved by light entries only. This was a lean, about 70% sure:
a known shape (bors `rollup=always` for trivial pull requests) but not one any queue read does
automatically. What would settle it: replaying the last two days and counting how often a light
merge would have broken a code entry's lint. (0110 put the cheap lane in the "better" stage
instead.)

Stage 1 changes no workflow and no ruleset: CI runs on `pull_request` as today, on the head the
queue pushed. The ruleset's admin bypass stays the owner's switch.

States, as a tea machine sketch (one machine per file, 0046; `_tag` written by Schema). A sketch,
not built; 0110's merger states replace it:

```ts
// sketch: next/.../queue/Entry.ts, one entry's control state
type Entry =
  | { _tag: "queued"; pr: number; head: Sha; kind: "code" | "light"; at: DateTime }
  | { _tag: "updating"; pr: number; head: Sha; base: Sha }
  | { _tag: "testing"; pr: number; head: Sha; base: Sha; tree: Sha; until: DateTime }
  | { _tag: "merging"; pr: number; head: Sha; tree: Sha }
  | { _tag: "landed"; pr: number; squash: Sha; at: DateTime }
  | { _tag: "returned"; pr: number; reason: "conflict" | "checks_red" | "head_moved" | "checks_silent"; paths?: string[] }
  | { _tag: "waiting"; pr: number; from: Entry["_tag"]; attempt: number; until: DateTime; reason: "host_fault" | "ci_never_started" };

type Msg =
  | { type: "enqueue"; pr: number; head: Sha; by: Actor }
  | { type: "updated"; head: Sha; base: Sha; tree: Sha }
  | { type: "conflicted"; paths: string[] }
  | { type: "checks"; head: Sha; result: "green" | "red" | "pending"; runs: RunFact[] }
  | { type: "merged"; squash: Sha; tree: Sha }
  | { type: "fault"; reason: string }
  | { type: "alarm"; at: DateTime };
```

```ts
// sketch: next/.../queue/Queue.ts, the queue that steps its entries (Elm: the parent steps children)
type Queue = {
  lease: { holder: string; until: DateTime } | null; // stage 2; stage 1 has one worker
  order: ReadonlyArray<number>;                         // pull request numbers, arrival order
  entries: Record<number, Entry>;
  main: Sha;                                            // main as the queue last moved it
};
```

Data shape. Facts lost forever if not written when they happen:

- `enqueuedAt` (`arrivedAt` from the referee) and `by`, the actor that enqueued it.
- For each state change: the state, `arrivedAt`, and the writer's `sentAt` (two clocks, as the
  ledger has them). Wait time per state is the first question later analysis asks.
- The `base` each test ran on, the merge `tree`, and each check run's id, name, start, end and
  conclusion. Without them nobody can tell later whether a red main came from a clash or a flake.
- The `reason` an entry left, and `attempt` for each retry with its fault.
- The squash sha and whether its tree equaled the tested tree.
- Derived things wait: queue length over time, throughput, p90 wait.

Where it could run in `next/`:

- A program `pipeline/queue` in the pipeline pack ([0083](../.decisions/0083-every-program-in-a-pack.md),
  [0084](../.decisions/0084-own-pack-listed-by-path.md)), with its settings
  (`[pack.pipeline.settings] queue.batch`, `queue.timeout`) as `fabrika.toml` values
  ([0069](../.decisions/0069-choices-are-settings.md)).
- Its model in a Durable Object, one per repo and base branch. It wakes on a call (enqueue), on a
  check event, or on an alarm, does one step, sets the next alarm and sleeps
  ([0105](../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md)). A retry with
  backoff is an alarm, never `Effect.sleep` or a `Schedule` inside a wake.
- No webhook reaches a laptop, so on the laptop "wait for checks" is an alarm that reads checks
  every 30 to 60 seconds while an entry is testing, and none while the queue is idle. 60 minutes
  of testing at 30 s is 120 reads, well inside GitHub's API limits.
- The steps that need a git checkout (merge main in, sign, leak grep, push) run as hands on the
  laptop, not in the object. The object asks; the hands answer with a Msg.

What `CodeHost` must offer (stage 1):

```ts
// sketch
CodeHost.pr(pr)                       // head sha, base, state, mergeable, is it in a stack
CodeHost.checks(head)                 // check runs on a sha: name, app, status, conclusion, times
CodeHost.workflowRuns(head, path)     // to trust `commits` only as main's pull_request_target run
CodeHost.merge(pr, head, "squash")    // pinned: a moved head is an error, never a merge
CodeHost.mergeStack(pr)               // gh stack merge, head read again first
CodeHost.mainHead()                   // to confirm the squash landed
// git work (merge main in, push notes and branch) goes through a git service on the hands,
// not CodeHost; `Worktrees` vs `CodeHost` is an open question in ledger-behind-a-service.
```

Plus `Ci` (checks leave `CodeHost`,
[services and our own CI](../docs/direction/services-and-our-own-ci.md)): `checks(head)` may move
there. (0110 decided it: the merger reads checks only through `Ci`.)

Throughput of stage 1 for code: 23 to 30 entries a day at about 15 minutes each (p50 about 10,
p90 about 22) is 6 to 8 hours of serial testing a day, about a third of the day. Calm days pass.
A burst does not: 20 finished pull requests after an outage take about 5 hours (20 x 15 min),
which is the 2026-11-11 line again. That is what stage 2 is for.

### Stage 2: better

Batches, not speculation, because of runner capacity:

- Speculation (Zuul, GitHub's build concurrency, GitLab's 20 parallel) runs several full CI runs
  at once. Our full run is 16 jobs and the free limit is 20 concurrent jobs, 5 macOS. Two
  speculative runs at once would queue on GitHub's side and gain little, and they would also
  starve the pull request runs. Speculation pays only with our own runners (services and our own
  CI) or a slimmer queue run.
- A batch of up to k code entries merged onto main in order, tested once. Green: all land,
  squashed one by one in order, each pinned (the final trees equal the tested tree only after the
  last). Red: split in halves and test each half on top of main, like Mergify's split
  ([batches](https://docs.mergify.com/merge-queue/batches/)), until the bad entry is alone, then
  return it. Keep `ALLGREEN`: never land a pull request whose own test went red.
- Numbers: 20 entries in a burst with k = 5 is 4 runs, about 1 hour if green, against 5 hours in
  stage 1. A red batch of 5 costs about log2(5), so 2 or 3, more runs. Main's push runs were red
  2 of 40 times, so a batch of 5 would split about 1 time in 4 if clashes were independent (a
  guess; it needs the replay). k = 4 or 5 matches phoenix's and demlik's 5. Wait at most 5 minutes
  to fill a batch, as they do.
- A flaky test is fixed, never rerun until green ([0036](../.decisions/0036-a-flaky-test-is-fixed.md)).
  So a red batch is split, not retried. Only outside faults are retried.

A lease: the worker holds a lease on the queue (holder, `until` by the referee's clock), so a
laptop worker and a cloud worker never both move main. In the object, the lease is the object
itself (one instance of it is one writer); it matters when the worker is a laptop program.

Priority: one level above normal for a fix to a red main (bors `p=`), and a "closed" switch that
stops everything below it (bors `treeclosed`). Jumping rebuilds the batch in flight, as GitHub
warns, so it is rare and recorded with who did it.

New facts to record: `batch` id and its members, each split and its result, the priority and
who set it, and the queue's length when each entry joined.

`CodeHost` additions: none beyond stage 1; the batch is a local merge pushed to a branch of the
queue's own, such as `<bot>/queue/<n>`. That needs a `push` trigger on that branch prefix in
`check.yaml` and `commits.yaml` (when read, both ran on push to main only; rechecked 2026-11-11,
still so), or the batch is opened as a draft pull request, as Aviator and Mergify do.

### Stage 3: secure

- **Who may enqueue:** only an actor holding a lead-signed "ready" fact for that ticket and head:
  every step passed, CI green, leak grep clean, loosening checked (0014). The queue checks that
  fact; it does not redo the judgment.
- **Who may skip the line:** the owner, and the lead for a red-main fix, each recorded.
- **What a signed entry proves:** the queue signs one link with its own key, from the head's tree
  to the tree it tested and landed, with the base it tested on. Then the post-merge chain in
  `commits.ts` can end at the squash's tree again (`last.to === trees.get(squash)`), which closes
  the gap 0098 named. That needs a new role beside `tests`, `build`, `lead` (`commits.ts:24`,
  `ROLES`, rechecked 2026-11-11), and its key in `allowed_signers`.
- The `commits` check keeps running from main's own copy (`pull_request_target`). If the queue
  ever tests on its own branch, that run must also come from main's copy, never the batch's: a
  `merge_group` or `push` run would execute the pull request's version of the workflow.

## 5. Could the queue be built on Cloudflare Workflows?

What is on the table, read from the installed code:

- **Cloudflare Workflows** ([limits](https://developers.cloudflare.com/workflows/reference/limits/),
  [retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/),
  [events](https://developers.cloudflare.com/workflows/build/events-and-parameters/),
  [pricing](https://developers.cloudflare.com/workflows/reference/pricing/)): `step.do` with
  retries (default 5 retries, 10 s delay, exponential; up to 10,000), `step.sleep` up to 365 days,
  `step.waitForEvent` with a default timeout of 24 hours. Paid plan: 10,000 steps per workflow
  (up to 25,000), 1 MiB per step result and event, 1 GB state per instance, 50,000 concurrent
  instances, completed state kept 7 days (up to 30). Price: 500,000 steps a month included, then
  $0.80 per 100,000; storage 1 GB-month included; step and storage billing starts 2026-08-10.
  An idle or sleeping instance uses no CPU. Local runs: "Wrangler runs an emulated version of
  Workflows" ([local development](https://developers.cloudflare.com/workflows/build/local-development/)).
- **Effect's `effect/workflow`** in effect 4.1.2: `Workflow`, `Activity` (with `retry`),
  `DurableClock`, `DurableDeferred`, `DurableQueue`, and `WorkflowEngine.layerMemory` ("keeps
  state only in memory and is not suitable for production"). Every module is marked
  `@stability unstable` (`node_modules/effect/dist/workflow/index.d.ts`).
- **Alchemy** (read in the installed `@alchemy.run/cloudflare` 2.0.0-beta.84; main's lockfile had
  moved to beta.85, not read then): `Cloudflare.Workflows` offers two `WorkflowEngine` layers for
  Effect workflows. `NativeEngine` runs them on Cloudflare Workflows. `DurableObjectEngine` runs
  each execution as one Durable Object with "its journal in that instance's SQLite", replays from
  the top, and suspends on a `DurableClock` or `DurableDeferred` until it fires
  (`src/Workflows/DurableObjectEngine.ts`, `NativeEngine.ts`). A local provider maps the workflow
  onto "the local workerd workflow engine" with state under the worker's local storage
  (`src/Workflows/Workflow.ts:1290` in beta.84; in beta.85, installed on 2026-11-11, the phrase is
  at line 1395). So both paths go through Alchemy (0042) and both run on the laptop with no cloud
  account.

What fits a workflow: **one entry's landing.** Bring up to date, wait for checks (a
`DurableDeferred` completed by a check event, or `waitForEvent`), merge pinned, confirm, close
tickets, each an activity with retries for outside faults. A crash in the middle resumes at the
step it was on. That is a real gain over `catchup.sh`, which starts over.

What does not fit: **the queue itself.** Order, one code entry at a time, batching, splitting,
priority and the lease are shared state that many events change, not a list of steps. A workflow
instance has no view of the others, so a workflow-only queue still needs one single writer that
holds the order, which on this platform is a Durable Object. Also:

- [0037](../.decisions/0037-implicit-state-machines-made-explicit.md) says control state is one
  named type, "never flags, a position in code or an order two parties assume", and
  [0046](../.decisions/0046-one-tea-machine-per-file.md) says it is a tea machine. A workflow's
  journal is a position in code: "where am I" is "which step ran last". An entry's states would
  live there, not in a Model a test can read.
- `effect/workflow` is unstable, and Alchemy's engines are beta.
- Replay means every step must be safe to run twice and every step's code must stay the same
  while instances are in flight; a deploy mid-landing is a hazard the object design does not have.

Compared with a Durable Object holding a tea machine plus alarms:

| | Workflow per entry (+ an object for the queue) | One object, tea machine, alarms |
| --- | --- | --- |
| Control state lives in | split: journal per entry, order in the object | one Model, read by tests and the window |
| Crash in a step | resumes at that step | the object reloads its Model; the alarm fires again |
| Retries | `step.do` / `Activity.retry` | an alarm per retry, a counter in the Model |
| Waits for checks | `waitForEvent` / `DurableDeferred` | a check Msg, or an alarm that reads checks |
| Fits 0037, 0046, 0105 | 0037 and 0046 only if the workflow carries no control state | yes |
| Laptop with no account | yes, through Alchemy's local engine | yes, through Alchemy's local runtime |
| Pieces | two platform products | one |

Cost by stage, on the Workers Paid plan fabrika already assumes (owner, 2026-11-06):

- **Stage 1:** about 30 code and 120 light entries a day. Object: a few wakes per entry plus one
  read alarm every 30 to 60 s while testing; under 100,000 requests a month against 1 million
  included ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)), so
  $0 above the plan. Workflows: about 10 steps per entry, 150 entries a day, about 45,000 steps a
  month against 500,000 included, $0 above the plan.
- **Stage 2:** batches lower both. Still $0 above the plan on either.
- **Stage 3:** signing happens on the hands, not on the platform. $0.
- On the laptop: $0 either way. The real cost is GitHub Actions minutes, which are free for a
  public repo, and their concurrency.

So money does not pick between them; the design rules do.

**Lean, as the research gave it:** a tea machine in one Durable Object for the queue, alarms for
every wait and retry, steps as plain Effects run inside a wake or by the hands, and no Cloudflare
Workflows in stage 1. About 75% sure. Why: it keeps control state in one Model (0037, 0046), fits
0105 directly, and is one platform piece instead of two. Cost: we write resume logic ourselves (a
Model reload is cheap here, since each step is one call and the Model says which). Doubt: if one
landing grows to many slow steps on the hands, a durable step list may read better than a Model
with many states. What would settle it: build stage 1 as a machine, count its states, and try one
entry's landing as an `effect/workflow` on `DurableObjectEngine` beside it; pick the one whose
crash test is simpler.

## Where the decisions went another way

The owner walked this research on 2026-11-11. Kept in the record as the research gave it:

- **"One Durable Object holds the queue and every entry's state" was not taken.** Decided instead
  (0110): one queue program holds the order and the batch, and one small merger per change lands
  it; they talk by program mail ([0103](../.decisions/0103-a-program-may-mail-another-by-name.md)),
  and crash safety is a program rebuilding from its saved inputs under a supervisor, OTP's shape.
  The settling run the lean asked for (an `effect/workflow` landing beside a machine) was not
  needed: 0110 rules out Workflows and `effect/workflow` in every stage.
- **"Light entries in stage 1" was moved.** 0110 puts the cheap lane for docs and field rows in
  the "better" stage, with batches and the wait-time record.
- **Which checks a change needs** was left to the classifier CI uses. 0110 makes it the pipeline
  pack's setting `queue.checks`, one list per kind of change, empty by default, and the queue
  refuses a change whose kind names no check.
- **A landed tree that differs from the checked tree** was a "confirm" step here. 0110 makes it a
  stop that waits for a person's `resume` (jidoka), not a setting.

## What it cannot tell us

- Whether light entries landing under a code entry would ever break it. It needs a replay of
  the last two days' merges.
- The real red rate of a batch. Main's 2 red of 40 push runs is all this has; how many pull
  request runs go red on their first try was not measured.
- The Graydon Hoare quote: the post's URL returned 404 on 2026-11-11, so the quote is from memory.
- bors-ng's split-in-half on a red batch: from memory, not on its docs page.
- Graphite's batching and bisecting: on a page not read; Aviator's batching: same.
- Whether GitHub's squash of a pull request gives exactly the tree a local `git merge` gives in
  every case; stage 1's "confirm the tree" step is there because this could not prove it.
- Alchemy beta.85, which main pins, was not read for the Workflows reading; the installed beta.84
  was.
- How `check.yaml`'s `--changed "$BASE"` would behave on a queue branch with no `pull_request`
  base: it would run the full suite (13 to 24 minutes, like main), so a stage 2 queue run is
  slower than a pull request run unless it passes its own base.
- No field notes dated 2026-11-11 about merging were on main when read, so the 2026-11-11 line is
  read from 0097's and 0098's context only.
- The merge counts and run times are as of 2026-11-11 and were not rechecked when this moved.
