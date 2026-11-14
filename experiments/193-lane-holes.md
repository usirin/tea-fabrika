---
date: "2026-11-02"
scripts: "`193-lane-holes.ts`, `results/193-lane-holes.json`"
summary: "Today's version. The real lane reducer driven through every outcome each step can say: 153 (step, outcome) pairs, 17 questions with 38 picks, 14 other doors; 99 pairs stop the lane, 22 ask a person. Classed by hand: 33 need a person, 77 a step could fix, 10 dead ends, 21 cannot happen. Of the 87 holes, 7 a self-fix PR takes, 75 the jidoka table already names as later work, 5 are new; reading found 7 more. Worst: the merge step stops on every ship send, and a restart on `no_review` runs ship into the same answer; a retried step writes under its first try's run id, so the ledger keeps `run_failed` and drops the real end and its cost; 83 stops say only `step_stuck`, and none is written to the ticket. Every stop ticket 117 hit is a row. Classes and new holes 80 to 90% sure, the exam side tree hole 70%. No model, $0."
---

# Every way the lane stops, and which a step could fix

Run 2026-11-02 on `main` at `b00a4837`. **Today's version only** (`packages/pipeline`), not
`next/`. A script drives the real lane reducer through every outcome each step can hand it, every
pick of every question it asks, and its other doors (`193-lane-holes.ts`). Then each stop and each
question got a class by hand, and the ticket 117 ledger was read against the table. No model, no
key, no network, $0.

## The answer

**87 holes in the table: 7 a self-fix PR already takes, 75 the jidoka table already names as later
work, and 5 new. Reading the code around the table found 7 more new holes, and confirmed the 4
known ones.** The table is whole by construction: 153 (step, outcome) pairs, 17 questions with 38
picks, and 14 other doors. 99 pairs stop the lane and 22 go to a person.

The worst five, each as "the lane does X, a person must Y":

1. **The merge step stops on every ship send, and a restart can loop.** Ship answers
   `send:reviewer:no_review` on the lane's own pull request (a head moved, or a criterion was
   reworded). The lane stops `stuck:sent_back`. Typing the line again reads main, finds it fresh,
   and runs ship again, which says `no_review` again. A person cannot move it from outside: the
   lane reads only the verdicts it posted, never a GitHub review (`github.ts:21`). It moves once
   main does, since a restart that merges main in goes back to review.
   Ticket 117 reaches this step next. Jidoka rows 62 and 63, later work; the PR 10 draft asks
   whether to take them (its question 3).
2. **A step that broke once and then worked is recorded as broken.** The retry is the same Act,
   so it writes under the same run id, and the ledger keeps the first write of a key. The ticket
   keeps `stuck:run_failed` with an empty carry, and silently drops the real end, its carry and
   its cost. A person sees a failure that did not happen, and a restart folds the wrong carry. New.
3. **The ticket never says the lane stopped.** 83 of the 99 stops say only `stuck:step_stuck`,
   14 say `stuck:sent_back`, and neither is written to the ticket. Nor is the cause of a crash.
   A person must open the pipeline tile to learn that the lane stopped, and why. New.
4. **The exam pull request (known, PR 10).** It is not formatted, nothing reviews it, any ship
   send at `exam_merge` stops the lane, and its stand-in review breaks when its head moves.
   Ticket 117 hit all of this. A person formatted it by hand, and is waiting now.
5. **The mutants job can stop the lane at review.** Its new tests can turn the checks red, or
   leave them not run. The guard at the next step stops with `stuck:checks_red`, though a
   restart would send the same lane to build. A test it wrote that kills no mutant also stops,
   with no second try. A person must type the line again or read why. New.

```text
153 pairs + 38 picks + 14 doors, each classed (unique keys)
  needed       33   only a person can decide
  fixable      77   a step the lane already has could fix it, no judgment
  dead_end     10   stops with no way on but a restart, though a step should take it
  unreachable  21   cannot happen, or an end that is not a hole
holes = fixable + dead_end = 87
  a PR in 1 to 10    7    six exam_merge sends (PR 10 draft), build still_red (PR 3)
  a later ticket    75    named in docs/direction/jidoka-and-andon.md, not built
  new                5    mutants not_killed, run_failed; main read failed; two guard stops
off the table        7 new, plus the 4 known (one of them, the cost, is off the table)
```

## How the table was made

The script imports the lane's own code and drives it. It copies none of its rules.

```ts
// experiments/193-lane-holes.ts, the core of it.
const running = (step: LaneStep, round: number, sendBack?: boolean): Lane => {
	const held = heldAt(round, sendBack);
	const asked = runStep({number: 7, count: held.count, step, round, carry: held.carry, intent: `lane/7/5/${step}`});
	return {...held, phase: "running", step, asked} as Lane;
};
const [next] = lane.update.lane_step_ok(s, runStep.ok(s.asked, {outcome, carry: {}}, 0));
// next.phase: "running" (a step), "asking" (a person), "releasing" or "over" (a stop or an end)
```

- **Where the outcomes come from.** Each step's stage list, as exported (`SORT_NAMES`,
  `PLAN_NAMES`, `TEST_WRITER_NAMES`, `BUILD_NAMES`, `MUTATION_NAMES`, `REVIEW_NAMES`,
  `SHIP_NAMES`). Exam, push and the mutants job export only a schema, so the script reads the
  names off the schema's union. The lane's step bodies make 9 more outcomes inline in
  `program.ts`, listed by hand in `MADE` with file:line.
- **Three rounds each.** Every pair runs at round 1, at the last round (3), and with
  `[build] send_back = false`. Only the sends that go back to build or the test writer change.
- **Every pick.** Each question the rows reached is answered with each pick its real question
  offers, through `lane_answered`.
- **The doors.** The ticket read, the claim and a restart's claim, a step that cannot run twice,
  a question that cannot be written, a restart's read of main with each of its six answers, and
  the guard on a step after build.
- **The classes are by hand,** in `CLASS`. A stop the table does not name prints as `unclassed`,
  and the run fails on a class for a row that does not exist. This run: 0 unclassed.

## Where each step's stops go

| Step | Pairs | Go on | Ask | Stop or end | Needed | Fixable | Dead end |
|---|---|---|---|---|---|---|---|
| triage | 13 | 2 | 1 | 10 | 3 | 4 | 0 |
| plan | 9 | 0 | 3 | 6 | 2 | 3 | 0 |
| exam | 7 | 3 | 1 | 3 | 1 | 2 | 0 |
| exam_merge | 25 | 2 | 2 | 21 | 2 | 16 | 2 |
| test_writer | 14 | 3 | 3 | 8 | 3 | 8 | 0 |
| build | 20 | 3 | 4 | 13 | 5 | 5 | 2 |
| mutation | 8 | 5 | 1 | 2 | 1 | 2 | 0 |
| mutants | 5 | 2 | 1 | 2 | 1 | 2 | 0 |
| review | 21 | 5 | 2 | 14 | 3 | 8 | 2 |
| push | 5 | 0 | 2 | 3 | 0 | 3 | 0 |
| merge | 26 | 0 | 2 | 24 | 3 | 17 | 2 |

- Ship runs twice, at `exam_merge` and at `merge`, so those two steps hold 45 of the 106 stops and ends.
- What the lane does with a stop, by its own words: 83 `stuck:step_stuck`, 14
  `stuck:sent_back`, 1 `stuck:checks_not_run`, 1 `stuck:merged_elsewhere`. The step's own word
  survives only in `said`, on the tile.
- The dead ends: a `skip:closed`, `skip:merged` or `skip:draft` at build, review, merge and
  `exam_merge` stops as `step_stuck` where it should end (jidoka row 13), and the two guard stops.
- `build stuck:checks_not_run` is a stop by design (PR 4): the checks could not run even once
  more. A restart runs them at mutation (`machine.ts:84`).

## The new holes

Each with its owning step, a one-line fix lean, and how sure.

| Hole | Owner | Fix lean | Sure |
|---|---|---|---|
| A retry keeps the failed try's end (`machine.ts:1306-1309`, `program.ts:1386`, `:1515`; first write wins, the ledger keeps a key's first write, `fabrika/src/host/rules.ts:587-588`) | the lane | A retry is a new run: `r-<step>-<count>-<try>`, or the failed try writes no `ended` | 90% |
| The lane's own stop is not on the ticket (`program.ts:1291-1298`); a send turned into a stop says nothing (`talk.ts:23-27`); a crash's cause goes only to the tile (`program.ts:1518`) | the lane | A `stopped` fact, or one comment, with the stop, the step's word and the cause | 90% |
| The guard stops a step after the mutants job on red or unrun checks (`machine.ts:926-944`; checks written at `program.ts:1080`). PR 4 wrote this as its choice (`machine.ts:39`) | build checks | Route red as `send:builder:checks_red` and run unrun checks, as a restart already does (`machine.ts:1266`, `program.ts:1371`) | 80% |
| Mutants `stuck:not_killed` and `stuck:run_failed` stop at once (`test-writer/mutants.ts:120-131`) | mutants | Back to the writer once with the mutant; run once more | 75% |
| A restart's read of main that fails stops `step_failed` (`machine.ts:1278`) | the work service | Wait and read again, in the service | 85% |
| The exam's side tree is made once and reused (`work.ts:405-415`, `tools.ts:306`): a second exam landing, after a plan restart, commits on top of the old rule changes, on an old main | exam | Start the side tree from main on each first landing of a plan version | 70% |
| The input key misses the pull request heads (`program.ts:1404-1416`): 117's two `exam_merge` runs share one key though the exam head moved | the lane | Add the exam and lane pull request heads to `Inputs` | 85% |

Three smaller ones, recorded and not ranked:

- **Every fact on ticket 117 has the same writer.** The lane's code writes and the person's
  answers both say `kind: user` with one id. The fact type tells an answer from an end today,
  but the writer is lost. A lane writer kind, at 60%.
- **Ticket 117's lane runs are not in `field/runs.jsonl`.** Its 10 runs, about 7.9 million
  tokens in, have no row; the notes have 2026-11-01-32 to -34 and 2026-11-02-17 only.
- **A review post reads only 100 comments** before it looks for its own marker
  (`operate/writes.ts:62`). Past 100 it can post twice. Low.

## The known four, as the code shows them

Listed as known, not planned again. The PR 10 draft takes the first three.

- **1. The exam PR is not formatted.** PR 1 formats the test writer's, the mutants job's and the
  builder's files, not the exam's (`tools.ts:304-307`).
- **2. Every send at `exam_merge` stops.** `after()` turns any `send` from a step with no route
  into `stuck("sent_back")` (`machine.ts:571`). The table shows six reachable sends there:
  `checks_red`, `conflicts`, `ejected`, `bot_comment`, `behind`, `no_review`.
  `review_failed` cannot happen, since the exam's one review always passes.
- **3. Nothing reviews the exam PR.** The lane answers `governance: passed` for any exam pull
  (`pulls.ts:212`) and gives it one criterion, a person's yes, at the side tree's head
  (`pulls.ts:427-447`). Both count only at the head the lane pushed: `laneFactsOver` marks the
  review `missing` at any other head (`github.ts:49`). On 117 the hand format commit moved the
  head from `39041df` to `27bec63`, so ship said `no_review`.
- **4. Codex runs cost $0.** Five of 117's Codex runs (two plans, one exam, the test writer and
  the build) say `usd: 0` and `listUsd: null`, with 0.6 to 2.2 million tokens in each.

## Each pull request, against the rule

AGENTS.md asks every pull request for: plan, test writer, build, mutation, one review, each by
its own agent. The question here is narrower: what the lane does to each of its two pull requests.

| Check | Exam PR | Main PR |
|---|---|---|
| Formatted by code | No (PR 10, part 1) | Yes, PR 1 |
| Checks run by code before ship | No; only ship reads them, and red stops the lane | Yes, PR 4, and a guard on each step after build |
| One review by its own agent | No, a stand-in (PR 10, part 2) | Yes; but ship's later `no_review` stops the lane |
| Mutation | No; rule files, may not apply | Yes, the mutation step and the mutants job |
| The owner's yes | Yes, the `exam_merge` question | Yes, the `merge` question |

## Ticket 117's real stops, mapped

Read from the ticket's ledger, read-only. Every stop it hit is a row in the table.

| Run | What it said | Row | Class |
|---|---|---|---|
| r-plan-2, r-plan-8 | `ask:owner:questions` | plan, to the `approve` question | needed |
| r-exam-3 | `skip:no_rules_change` | goes on to the test writer | none |
| r-build-5 | `done`, checks never ran | jidoka row 47, now PR 4 | fixed |
| r-mutation-6 | `stuck:tests_red` | now `send:builder:tests_red`, to build round 2 | fixed, PR 3 |
| r-exam-9 | `ask:owner:check_change` | exam, to the `exam_merge` question | needed |
| r-exam_merge-10 | `send:builder:checks_red` | exam_merge, stop `sent_back` | known 1 and 2 |
| r-exam_merge-12 | `send:reviewer:no_review` | exam_merge, stop `sent_back` | known 3 |

## Five things looked for in the code

- **A crash a person sees only as a crash.** `Effect.die` at `program.ts:1132` (review not
  over), `:1269` (ship not over), `:1656` (the lane not over), and `Effect.orDie` on a restart's
  dispatch (`:1645`). Inside a step, `Effect.exit` catches a die, writes `stuck:run_failed`, and
  the retry follows; the cause reaches only the tile (new hole above). `:1656` and `:1645` end the
  program itself.
- **A carry field read with `need(...)` that a restart may not have.** `examPr` (`:828`),
  `head` (`:840`, `:1047`, `:1104`), `base` and `head` (`:1008`, `:1200`), `pr` and `head`
  (`:1241`). Since PR 5 each end keeps its carry, so a restart has them. The fold's own list
  (`restart.ts:45-55`) has no `examPr` and no `pr`, so only an end with no carry loses them, and
  the retry hole above writes exactly that: a retried exam that worked leaves `carry: {}`, and a
  restart at `exam_merge` fails "the exam has no pull request" twice.
- **A GitHub write with no guard on a rerun.** Opening a pull request finds its own first
  (`github.ts:170-176`); a review post looks for its marker (`operate/writes.ts:63`); an enqueue
  and a merge find their own first (`code-host-github-writes.ts:72`, `:164`); ticket comments
  are keyed by run. The holes: the 100-comment read, and the exam side tree. The exam branch is
  never deleted (`github.ts:190-192`, on purpose).
- **"Record wide" facts not recorded.** Cost on Codex (known 4); the lane's own stop and the
  crash cause; a retry's real end; the pull request heads in the input key; a lane writer kind.
- **Steps that loop.** A restart at `merge` on `no_review` runs ship into the same answer
  (worst 1). A restart before the test writer that reads `conflicts` goes to build round 2; it
  cannot happen, since those restarts start the branch again from main (`program.ts:288-290`).

## What this cannot tell us

- **Whether a row can happen on a real repo.** The script drives the reducer with each outcome a
  stage may say. It does not prove a stage can say it there. The unreachable class rests on
  reading, and three of its rows (`build stuck:no_criteria`, `criteria_unknown`,
  `skip:not_ready`) have no law behind them yet.
- **How often each hole bites.** One real ticket ran. It hit 2 of the 87 table holes, both known,
  and all four known holes. Nothing here weighs the other 85.
- **Whether the retry hole has bitten.** No run on 117 failed once and then worked. The code and
  the ledger's rule say what would happen; no fact shows it yet.
- **The exam side tree hole is read, not run.** No lane has landed an exam twice.
- **The classes are one reader's.** "Fixable" means a step the lane has could take it without
  judgment. Another reader may move a handful of rows between fixable and needed, mostly the
  spend asks and `fails_on_base`.
- **The PR 10 draft is not decided.** Where this says PR 10 takes a hole, it means the draft as
  written today.
