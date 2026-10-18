# 85. The first real lane: operate on a demlik ticket, through tsh

```toml
# tsh.toml, in a folder outside any repository
repo    = "kamp-us/demlik"
work    = "work"
rubrics = "rubrics"          # fabrika's three review rubrics, copied here
own     = ["<the gh login>"]
model   = "opus"
effort  = "medium"
budget  = 3
rounds  = 2
ship    = "write"
```

```
TSH_TRACE=1 <tea-fabrika>/bin/tsh --json -c 'operate ticket=https://github.com/kamp-us/demlik/issues/710'
```

**Answer: it started from one line and built a good change in 2.5 minutes,
but the loop stopped at the review. It ended `stuck:review` after one round,
$1.15, 11.6 minutes. Nothing merged.** The reviewer handed back a form that
code's form check refused (`stuck:draft_failed`). Why it was refused is lost:
the loop's step, its trace and its kept state all drop the list of problems. A
second, read-only review of the same head gave a clean form ($0.43): all five
criteria met, and one real finding outside them. Ship never ran, so the merge
queue was never reached.

The lane's pull request, [demlik#713](https://github.com/kamp-us/demlik/pull/713),
is still open, with its branch `build/710`, green CI and no comments.

## Who did what

| Part | Whose |
|---|---|
| tsh, the operate loop, build, review, the verdict posting and ship | tea-fabrika's machine, from this repo at 7b762ce, no code change |
| The builder and the reviewer | Claude (`claude-opus-5-5`, effort medium) through the Agent SDK, started by the machine |
| The rubric texts the reviewer read | today's fabrika's review skill (`claude-plugins/fabrika/skills/review/rubrics/` in kamp-us/phoenix at f823447), copied beside `tsh.toml` |
| The checks on the pull request | demlik's own CI (`build.yaml`, job `test-and-build`) |
| The ticket and its criteria | today's fabrika's triage, before this run |

Today's fabrika's agents and ledger did not run. Nobody commented on #710 or
#713 by hand, and nothing was merged.

A harness for this experiment only: `gh` on the PATH was a small script that
wrote each call to a log and refused any direct merge (`mergePullRequest`,
`gh pr merge`, a REST merge). It was never triggered. The log is how the
reads below were checked.

## 1. Setup: one line, and what it took

Yes, a developer can start it from one line, once a config file is written. No
code fix was needed to run. Every item below was worked around with config or
by hand. In the order met, with the time it took:

| # | Friction | Time | Workaround |
|---|---|---|---|
| 1 | `tsh` is not on the PATH. It is `bin/tsh` inside a tea-fabrika checkout, after `pnpm install` there. | 2 min | Called by its path. |
| 2 | `own` is empty by default, so ship would skip every pull request as `not_ours`. | 1 min | `own = [<login>]`, from `gh api user -q .login`. |
| 3 | The default rubrics folder (`<tsh home>/rubrics`) does not exist, and nothing says where real rubrics live. | 3 min, most of it finding them | Copied fabrika's `code.md`, `doc.md`, `skill.md` beside `tsh.toml`; `rubrics = "rubrics"`. |
| 4 | `ship` defaults to `read`. A loop that should merge needs `ship = "write"`. | under 1 min | Set in the file. |
| 5 | Does demlik have a merge queue? Read mode cannot tell (experiment 83), so it was asked of GitHub by hand: `isMergeQueueEnabled` on an earlier pull request, `true`. | 1 min | A read-only query. |
| 6 | `budget` and `rounds` have to be picked to fit a spend cap. Worst case is rounds × (builder + reviewer) × budget. | 1 min | budget 3, rounds 2: worst about $12, likely far less. |
| 7 | Tracing is `TSH_TRACE=1`, an environment variable. It is not a key in `tsh.toml`, so a traced run is not the bare line. | none | Set on the line. |
| 8 | `pnpm trace:up` fails when Jaeger is already up: Docker refuses a second container named `tsh-jaeger`. | 10 s | Jaeger from an earlier session was serving; used it. |

From making the worktree to starting the run: under 4 minutes of commands.
Reading the code first, to know items 2 to 5 existed, took longer than that.
A developer without experiment 83's write-up would have met items 2, 3 and 4
as a skipped or failed run instead.

The base branch is fixed to `main` (experiment 83). demlik's is `main`, so it
did not matter here.

## 2. The loop on real CI

| Phase | Start (UTC) | Wall time | Cost | What happened |
|---|---|---|---|---|
| read ticket | 22:11:54 | 0.6 s | | one GraphQL read |
| copy | | 6.6 s | | clone, worktree `build/710`, `pnpm install` |
| builder | | 139.6 s | $0.70 | 14 turns: Bash 14, Write 1, the form |
| push, open | 22:14:23 | 3.7 s | | branch pushed, pull request #713 opened |
| review: wait on checks | 22:14:27 | 459.8 s | | 16 reads, one every 30 s, until both CI runs were green |
| reviewer | 22:22:09 | 80.9 s | $0.44 | 5 turns: Read 5, the form |
| review ends | 22:23:30 | | | `stuck:draft_failed`, form refused |
| loop ends | 22:23:30 | 696 s in all | $1.15 | `stuck:review`, 1 round |

- **Rounds:** 1 build, 1 review. No round 2: a review that cannot be read ends
  the loop.
- **Hangs:** none. The 7.7-minute wait was CI itself (two `test-and-build`
  runs, 7m35s and 5m39s, both green on the first try).
- **Writes to demlik:** one branch push and one `POST .../pulls`. No verdict
  comment (the loop posts only after a readable review), no enqueue, no merge.
- **Trace:** [`936ede8c368c4935eb9fb0325a239d22`](http://localhost:16686/trace/936ede8c368c4935eb9fb0325a239d22)
  in the local Jaeger: services tsh, operate, build, review; 15 spans.
- **Outcome:** stopped at the review. Pull request open, nothing merged.

### Why it stopped, and what could be learned after

`stuck:draft_failed` after `review_reviewed` means the reviewer did hand back a
form, and `readForm` (`wip/src/stages/review/sheet.ts`) found problems in it:
a criterion with no row or two rows, a pass with a finding, a fail with none,
a finding for a kind of review the change does not owe, and so on. The list of
problems is written into the review's report. Then:

- operate's `step` for a review lists only the open criteria. The report had
  none open, so `says` was `[]`.
- The review's trace span carries the outcome name, not the problems.
- The loop's tidy-up clears each stage's kept state when the loop ends.

So the one fact that says what went wrong was dropped three ways. To get
anything, the same head was reviewed again, read-only, with tsh's `review`
program (it posts nothing and keeps its notes): trace
[`b06d73b88d53011f0e7d2dd6f73a0bc8`](http://localhost:16686/trace/b06d73b88d53011f0e7d2dd6f73a0bc8),
1.5 minutes, 12 turns, $0.43. That form was clean: criteria 1 to 5 met, and
one finding from the rubric's own checks (below), so
`send:builder:review_failed`. The machine would have gone to round 2 on that.

This does not tell why the first form failed. My guess, unchecked: the first
reviewer wrote the README gap as a `review-doc` finding, which this change
(no `.md` files) does not owe. The second reviewer filed the same gap as a
note instead. One sample of each; the reviewer is not deterministic.

## 3. The criteria

Kind: **outcome** says what a user sees; **recipe** says how to check it.
"Met" is the diagnostic review's grade, checked by running the three test
files in the build's copy (`move-other-files`, `move-apply`, `mover`: 28 of
28 passed) and by CI.

| # | Criterion, short | Kind | Met | How |
|---|---|---|---|---|
| 1 | Five-row hand plan, three `.ts` and a `.json` and a `.sh`: one rename commit, all R100, one rewrite commit, second apply commits nothing | outcome | yes | A vitest fixture that calls `applyHandPlan`, not the `move apply` command line. Close to the user's job, one step short of it. |
| 2 | An `import … from "./fixture.json" with { type: "json" }` naming the moved file is rewritten | outcome | yes | Another way: ts-morph cannot move a `.json`, so a new pass (`repointOtherFiles`) re-derives such specifiers. |
| 3 | `new URL("./run.sh", import.meta.url)` is listed as stale and left unchanged | outcome | yes | Another way, and against the ticket's own note: the ticket said `staleRefs` "already works for any file type". It searched only the repo-relative path, which a `./run.sh` does not spell. The builder added a relative-path scan. |
| 4 | A manifest of only non-TS rows: rename commit, no rewrite commit | outcome | yes | As written. |
| 5 | The existing `move-apply` and `mover` tests pass unchanged | recipe | yes | As written: no existing test file changed, and they pass. |

None could not be met as written. Today's criteria style held up: the first
criterion was the user's job with N=5, two file kinds and a repeat run, and
the builder met it.

What the criteria did not cover: the diagnostic review found that a row is now
sent to ts-morph only when it ends in `.ts`, `.tsx`, `.mts` or `.cts`. A `.js`
file in an `allowJs` scope is a source file ts-morph holds, and the README
names that case. Before this change such a row was moved by ts-morph with its
imports rewritten; now it is moved by `git mv` alone and its imports are left
pointing at the old place. Read from the code, not run. Confidence 75%. No
criterion names `.js`, so a review that read only the criteria would have
passed it.

Also not covered by any criterion: demlik asks for a changeset on a change to
a published package, and #713 has none. The builder never saw that rule
(below).

## 4. Which issue fields the lane read

From the code paths the run went through, checked against the `gh` call log
(three reads of #710: one with labels, two of the body alone, none naming a
milestone).

| Field | Read? | Where, and what for |
|---|---|---|
| state | yes | build's ticket read: a closed ticket is skipped |
| title | yes | the builder's prompt, and the pull request's title |
| body | yes, 3 times | build: the criteria and the prompt; review: the criteria, twice (pack read before and after the checks wait) |
| labels | fetched once, one used | build's gate checks only `ready-for:agent`. `type:bug`, `p1`, `class:code` and `status:triaged` came back in the same list and nothing read them. |
| type (`type:bug`) | no | fetched with the labels, never used |
| priority (`p1`) | no | fetched with the labels, never used |
| `class:` (`class:code`) | no | fetched with the labels, never used. Which reviews a change owes is worked out from the changed files' paths, not from the label. |
| status (`status:triaged`) | no | fetched with the labels, never used |
| milestone | no | no query names it |

The trace shows the one `read ticket` Cmd and two `read pull request` Cmds;
it does not record which fields. Not reached in this run: ship's read of the
pull request's body for `Closes #710`, and its read of CODEOWNERS and
`.fabrika.jsonc`.

## 5. When a person was asked or needed

The machine never asked a person: no `ask` outcome came up. A person was
needed six times all the same.

| When | What | Decision or fact? |
|---|---|---|
| setup | the `own` login | fact: `gh api user` answers it |
| setup | where real rubrics are | fact: they live with fabrika's review skill |
| setup | does the repo have a merge queue | fact: `isMergeQueueEnabled` answers it |
| setup | `ship`, `budget`, `rounds`, tracing on | decision |
| after the stop | why the review was refused | fact: the machine had it and dropped it; a person paid $0.43 to get a second opinion, not the answer |
| after the stop | what to do with #713: repair round, or close | decision, though the diagnostic review's `send:builder` is the answer the machine would take |

One more fact nobody was asked and the machine never read: demlik's
`CLAUDE.md` asks for a changeset. The builder runs with `settingSources: []`,
so the repository's own agent instructions are never loaded.

## Findings

- **A refused review form ends the lane, and its reason is thrown away.** The
  problems are in the report, but `step.says` lists only open criteria, the
  span carries only the name, and the tidy-up clears the state. The next
  review of the same head was clean. One retry with the problems shown to the
  reviewer would likely have carried the loop on.
- **The build was quick and right on the criteria.** 2.5 minutes, $0.70, CI
  green first time, five of five criteria met. The review's standing checks
  found a real regression outside them (`.js` under `allowJs`). That is the
  rubric earning its place.
- **The builder does not see the repository's rules.** No changeset, because
  demlik's `CLAUDE.md` is never loaded and no gate checks for one.
- **Setup needs four config values and an environment variable.** `own`,
  `rubrics`, `ship = "write"` and the budget, plus `TSH_TRACE=1`. Two of the
  four (`own`, `rubrics`) are facts the machine could read or ship with itself.
- **`trace:up` is not safe to run twice.** It fails when Jaeger is already up.
- **The ticket's own note was wrong in one place.** It said `staleRefs`
  already handled any file type; for a relative `./run.sh` it did not. The
  builder found and fixed that without being told.
- **The merge queue path is still unproven live.** Ship never ran. Experiment
  83's `merging` phase and the enqueue were not exercised.

## What this cannot tell

- Why the first form was refused. The guess above is a guess.
- How often a reviewer form is refused. One run, one refusal; the second try
  passed. Two samples.
- Whether ship, the enqueue and the merge queue work on demlik. Not reached.
- Whether the `.js` regression is real when run. It was read from the code by
  the reviewer and by me, not shown with a test.
- Cost and time of a whole lane. A round 2 and the queue would add to both.

## What is left behind

- [demlik#713](https://github.com/kamp-us/demlik/pull/713), open, and its
  branch `build/710`. No comment on it, none on #710. Closing or carrying it
  on is the main session's call.
- The run's clone and working copy in a scratch folder outside this repo, and
  the ended run's record in tsh's home.

## Recs

1. **Keep the problems.** Put a refused form's problems in the review step's
   `says` and on the review span (`tea.problems`), and do not clear a stuck
   review's state in the tidy-up. Small. Confidence 90%: this run needed it.
2. **One retry on a refused form.** Run the reviewer again once, showing it the
   problems, before the review ends `stuck`. It is a `refine` with a limit of
   one. Costs one reviewer run (about $0.45 here) on the rare refused form.
   Confidence 70%: one run says the second try works; it might fail the same
   way.
3. **Carry #713 on.** With recs 1 and 2 in, run the lane on #710 again, so a
   round 2 gets the `.js` finding and ship meets the queue live. How a new
   loop treats the open pull request it finds (a fresh round 1 with nothing
   listed open) is untested. Confidence 60% that it merges within two rounds.
4. **Load the repository's agent rules into the builder** (its `CLAUDE.md`),
   or name the rules the build gate checks. Confidence 65%: loading the whole
   file brings rules for today's fabrika's shells that do not fit this builder.
5. **Setup:** `own` defaulting to the signed-in `gh` login, rubrics shipped
   with tsh, a `trace` key in `tsh.toml`, and `trace:up` that does nothing when
   Jaeger is up. Each small. Confidence 80%.
