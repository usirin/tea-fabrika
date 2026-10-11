# 47. Scoring triage on the replay set: the first 5

Triage was judged by eye, one ticket at a time. Now a run of triage on a
replay issue gets numbers, and the numbers come from code.

**The runner** (`src/replay-run.ts`, `N=567`): it clones kamp-us/demlik at
the issue's `shaAtFiling` into a scratch folder outside this repo. The clone
comes from a bare mirror over git's own transport, from one branch pointed at
that commit, so it holds no commit after it: the PR's merge commit is not in
it. The runner installs the packages and seeds the ticket from the replay
file's `rawReport` and `seed.filedBy` (no GitHub read). Then it runs triage
only, as `UNTIL=triage` does, keeps the run in `runs/replay/<n>/` and scores
it. The issue's tests go in the package the PR changed most files of (a tie
goes to the package the report names more), under `test/` when the package
keeps its tests there (structure-sweep's vitest runs only `test/**`). Before
the monorepo move the package is the root, `.`. An existing test in a root
package could not run before this (`runTest` wanted a `./` prefix); now it
can.

It also records what each run cost. `claude -p --output-format json` ends with
a result event that holds `total_cost_usd` and the token counts; `turn` now
reads them and hands them to an `onSpend` hook the host passes in. The machine
never sees them. Jev calls are counted from the sort's Msgs. And it reads each
enricher conversation's transcript for tool calls that reached a path outside
the clone, where the answer could be: none did, in all 5 runs.

**The scorer** (`src/score.ts`, pure, tested) takes the replay record and what
triage ended with. It gives no single score. Each part answers one question:

| Part | Question | How |
|---|---|---|
| Files, per group (src; tests and type tests; docs) | Did the criteria name the files the PR changed? | Ours: `namedFiles` (what example calls import from, existing tests, what other rules name). Theirs: the PR's files, without changesets and generated pages. Precision = ours the PR changed / ours. Recall = theirs we named / theirs. In brackets, recall over the files that existed at filing: nobody can name a test file the PR adds by path. |
| Level | Do the criteria aim at where the fix lives? | Example → runtime; type rule, or unchecked about type → type; unchecked about doc, or an existing test of a doc page → docs; unchecked other → nothing. One level, or `mixed`. 1 for the same, 0.5 when one side is mixed, else 0. |
| Type, priority | Same labels as at close? | The sort triage acted on: Jev under the floors (an unsure priority is p2). Shown beside "always p1". |
| Checked / all | How much of the ticket can a check show? | Criteria a check runs (example, type, existing test) over all criteria. |
| Vetting | Did a draft pass, and on which? | Problems per draft, in order. |
| Caught | Would our checks touch the change? | A proxy: do our checked criteria run or import a file the PR changed (an example's module and what it uses, a type rule's files and imports, an existing test and its page)? Touching a file is not testing the change in it. |

Where triage stopped is shown too: a parked run has no sort, so its type and
priority count as misses.

## Results

5 issues, default knobs (`vet_tries` 3), Opus through `claude -p`, one Jev
sort each where triage got that far.

| # | End | Type ours/theirs | Prio ours/theirs | Level ours/theirs | src P / R | test P / R | docs P / R | Checked / all | Vetting | Caught | Claude $ | Jev |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #296 | triaged | bug / bug | p2 / p2 | mixed / type (0.5) | 100% / 33% | 100% / 33% (50%) | 100% / 100% | 5 / 6 | passed, 1 draft(s) [0] | yes (3) | 0.32 | 1 |
| #333 | parked:needs_decision | - / feature ✗ | - / p2 ✗ | docs / runtime (0) | 25% / 25% (50%) | - / 0% (-) | 100% / 50% (100%) | 0 / 4 | passed, 1 draft(s) [0] | no | 0.24 | 0 |
| #483 | triaged | feature / bug ✗ | p2 / p1 ✗ | mixed / runtime (0.5) | 100% / 100% | 100% / 50% (100%) | - | 2 / 7 | passed, 3 draft(s) [5,2,0] | yes (2) | 1.24 | 1 |
| #567 | parked:enrichment_unvetted | - / feature ✗ | - / p1 ✗ | docs / runtime (0) | - / 0% (0%) | 100% / 50% (100%) | 100% / 50% (67%) | 2 / 3 | failed, 3 draft(s) [1,1,1] | yes (3) | 0.93 | 0 |
| #579 | triaged | chore / bug ✗ | p2 / p1 ✗ | mixed / docs (0.5) | - | 0% / 0% | 25% / 100% | 3 / 3 | passed, 2 draft(s) [1,0] | yes (1) | 0.84 | 1 |

Totals: type 1/5; priority 1/5 (always p1: 3/5); level 1.5/5; vetting
passed 4/5; caught 4/5. Claude $3.58 in all, $0.24 to $1.24 a run; 3 Jev
calls. 30 s to 130 s a run, clone and install included.

Per run:

- **#296** (type bug, before the monorepo move). Named `src/pure/core.ts`,
  the main fix, but not `src/agent/tool.ts` or `src/runtime-types.ts`, which
  the PR also changed. Four type snippets plus the how-to's twin passed vetting
  on the first draft. One rule stayed unchecked: the report's `ok`/`err`
  helpers did not exist at the filing commit (they were on a branch), and the
  enricher said so. Jev said p1 at 0.48, so triage took p2, which is right.
- **#333** (person-filed feature). The enricher asked the owner to choose
  between agent-as-tool and hand-off. Fabrika's triage made that cut itself
  (v1 = await a sub-agent), so this is a park where fabrika went on. It is a
  fair question to ask a person, but the set has no ruling to answer it with,
  so the score ends there. All 4 of its criteria are unchecked; it named
  `src/agent/tool.ts`, which the PR changed, and three files it did not.
- **#483** (runtime bug, two packages; filed by an agent, not a person). Found
  both `jev.ts` files, the trap in the notes, from the report's one line that
  backlog-sweep "may carry its own copy". Needed 3 drafts (5, then 2
  problems). But only 2 of its 7 criteria are checked; the other 5 are
  unchecked `other`. Sorted as a feature.
- **#567** (runtime, 11 files). The report reads as docs that contradict the
  code, and our triage took it that way: two existing doc-page tests and one
  doc rule, no `src` file. Fabrika's triage turned it into a feature after a
  direction comment that the set does not keep. Every draft failed the same
  way: nothing fails on today's code. Out of tries, parked.
- **#579** (docs bug). Named the right page but also three example files the
  PR did not touch (docs precision 25%), and named the page's mirror rows,
  not `pages-typecheck.test.ts`, the test the PR changed. Sorted as a chore.

## What the numbers say about triage today

- **The sort is the weakest part.** Type 1/5 and priority 1/5, below always-p1
  (3/5). On the three that were sorted, Jev was unsure of priority (0.27 to
  0.53), so the floor made each p2. The labels say p1 for most of the set. The
  type misses are bug against feature or chore, a coin flip on these reports
  (Jev's type confidence: 0.44 and 0.74). Five issues are too few to tune on,
  but the floor rule "unsure means p2" is the opposite of this set's prior.
- **A runtime fix with no failing check today stalls.** #567 ran out of tries
  on "nothing fails today", 3 times in a row, the same problem each time. The
  feedback names the problem but not a way out. Either the enricher needs to
  be told how to write a failing example for a change that adds an export, or
  this park should name the option of a person accepting it. #483 shows a
  softer version: 5 of 7 rules unchecked.
- **Files: the main file is found, the rest often not.** On the agent-filed
  reports, src precision is 100% wherever we named src files, but recall is
  33% to 100%, and 0% on #567. Our criteria name few files, and the ones they
  name are right. On #333, the person's report, it is 1 right of 4. Tests the
  PR adds cannot be named by path; recall over existing files is higher on
  every run (brackets).

What the level and caught numbers say is weaker. Level is `mixed` whenever a
ticket has both examples and doc rules, which is most of them, so 0.5 is the
common score. Caught is generous: on #567 it says yes because the doc tests
touch the page the PR changed, though none of those tests fails today.

## Caveats: where the answer can leak in

- 4 of the 5 reports were filed by agents and name files and lines already.
  Finding the main file is easier than from a person's report. #333 is the one
  person-filed run here: 1 of its 4 src files was right.
- #333 and #339 were filed before tea moved to `packages/tea` and fixed after
  it, so the clone has `src/...` at the root and the PR has
  `packages/tea/src/...`. The scorer reads our paths the PR's way, and the
  runner now puts the tests in the root package for these two. #333 itself ran
  before that fix, with `packages/tea`, a folder its clone does not have. It
  changed nothing there: the package never reaches the enricher, and with
  every criterion unchecked, vetting ran no test.
- The package the tests go in is picked from the PR's files. It does not reach
  the enricher's prompt, but it decides where vetting can run tests.
- #567's scope changed in a comment the set does not keep, so its type and
  file scores are partly scoring the missing comment.
- The clone has no later commit, and the transcripts show no reads outside the
  clone. The enricher can still read the repo's own docs at that commit, as a
  person could.
- One run per issue. A second run may well sort or draft differently; these
  are single samples, not rates.

Not done yet: fabrika's own `enriched` scored the same way (the README's
reference line); the stronger "caught" check (run the criteria's checks at
`baseSha` and `mergeSha`); the traps list per issue; the other 17 issues.
