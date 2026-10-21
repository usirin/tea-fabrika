# 105. The plan lane, as a dry run

The question: does one lane parent take a plan of 2 to 3 tasks to ONE pull
request on tea-host, under faults (step S4)?

- The lane is a tea machine, `lane:<n>`. It runs no agent. Every piece of
  work is a child under a name made from the lane's counts.
- Every child is a program on tea-host, with its agent as its own child, as
  in 104. Every outside write goes through 104's gate.
- The world is fake: a fake GitHub with a real bare git repository on disk,
  the ledger in Miniflare, and scripted agents. Nothing was written to any
  real repository.
- The answer key is demlik's own #700, built by hand as draft pull request
  #708: three tasks, each touching the files its commit touched there.

**Answer: yes with scripted agents. With real agents (haiku), partly: the
third real pass merged one pull request with every law held, but only after
the owner removed one of its two tasks. Haiku did not carry a whole #700 plan,
and its task split matched #708 on far fewer than 80% of files.**

- Scripted, 12 runs (3 scenarios, a kill scenario at two points, 3 runs
  each): 12 of 12 held every law.
  - One pull request each time, merged, every live criterion met at the head
    it merged at, every covered ticket closed.
  - 0 rebases, 0 force-pushes, 0 refused pushes. The code host's checks ran
    once per pull request.
  - 0 commits made twice, 0 review rows recorded twice, 0 late writes, 0
    writes without a key.
  - Two hosts started on the same plan at once: exactly one held the lane,
    3 of 3.
  - A stuck task: the owner was asked at round 3, and again at round 4.
  - Files per task match #708: 100%. That is by construction in the
    scripted world, so it says little (see "Holes").
- Real (haiku, effort low), 3 passes, each fixing what the one before
  found. About $0.84 counted in all, of a $5 cap:
  - pass 1 stopped `stuck` on one `unseen` review;
  - pass 2 had both tasks removed, then reviewed an empty change;
  - pass 3: one pull request, merged, every live criterion met at its head,
    closes #700, CI once, 0 rewrites. Task 1 passed in round 2. Task 2 was
    still one open item after 6 rounds; the owner was asked at round 4, said
    "keep going 2", was asked again at round 6, and removed it.
  - Files per task against #708: 7% found, 25% right. Far under 80%.
- The runs and the laws found 9 bugs or design faults. All are fixed:
  - the one-holder law looked at nothing unless `DEBUG=1`;
  - no task built the plan's own criteria, so every plan paid one extra
    round and one extra last review;
  - one `unseen` row from a reviewer ended the whole lane;
  - the live reviewer read a clone that did not hold the head it judged;
  - `deliver` in tsh planned at the clone's old main, not main as fetched;
  - with every task removed, the lane ran a last review of nothing. It now
    ends `skip:emptied`;
  - the harness's "removed task's files are left" law counted a file that
    was in the workspace before the plan. It now checks the task's own
    commits;
  - found by the laws (each new machine now has a laws spec, as every
    machine must): a task's commit carried the builder's summary as it
    came, and the pull request carried the planner's summary as it came.
    A "Fixes #2" in either would close #2 on merge. Both are made inert now,
    as the one-ticket build's text is.

Confidence 70%. The lane did what it should in every run. The doubt is the
real side: one pass merged, with half its plan removed. See "Holes".

## The pieces (S4)

All of it is in `packages/fabrika/src/pipeline/`.

- **Plan-level criteria.** A plan has a `goal`: a job and criteria of the
  whole plan, numbered in the same book after every task's
  (`stages/plan/ids.ts`). A criterion's owner is a task or `plan`
  (`ids.ts`, `Owner`). The plan check sends back a plan of two or more tasks
  with no goal.
- **`Story.from`.** A story may name the ticket it came from, and the plan
  shows it. The tickets the pull request closes do not come from the
  planner's words: they are the plan's ticket and every fold on the ledger.
- **A fold is a fact.** Sort's fold writes `folded` on the plan
  (`asks/ledger.ts`). The lane reads it and plans again before more work.
  This closes 111's open hole.
- **Task build on `plan/<n>`.** `stages/task/` and `hosted/task.ts`: one
  task, one round, one commit on the plan's branch, keyed
  (`Fabrika-Key: lane:700:t2:r1:build`), pushed from where the branch stood,
  never forced.
- **Catch up by merge.** `stages/catchup/` and `hosted/catchup.ts`. Before
  each round, and before each last review: is main in the branch? If not,
  merge it. A conflict only in `pnpm-lock.yaml` is solved by code: main's
  lockfile, then `pnpm install --lockfile-only`. Any other conflict goes to a
  builder agent, which edits only the conflicted files. A removed task's
  commits come off by revert, the same way.
- **Local review.** `hosted/review-local.ts`: the review machine, unchanged,
  over a copy of the branch at one commit, with the repository's checks run
  there (`code-host-local.ts`). A task's review judges its own criteria. The
  last review judges the whole book.
- **The lane.** `stages/lane/` (machine and a pure `next`), hosted in
  `hosted/lane.ts`. Each step it reads the facts and the code host, then
  picks one:
  - the owner first: a closed plan ends it; an open ask waits;
  - no plan yet: plan it (version 1 waits on the owner like any other);
  - a ticket folded in: plan again (the new version waits on the owner);
  - a removed task: revert its commits;
  - every task removed: end `skip:emptied`;
  - a task not done: one round (catch up, build, review). The last task's
    rounds are also told the plan's own criteria not passed yet;
  - every task done, met at the head, not behind main: open the pull
    request, then ship;
  - else: one last review over the whole book, after a catch-up. A plan
    criterion it failed sends one round to the last task.
  - Caps: 12 rounds a task, 4 last reviews, 3 ship runs. Past a cap the lane
    stops `stuck:no_end`, never loops.
- **One pull request.** It opens only once every live criterion passed at
  the head. Its body ends with one `Closes #N` per covered ticket. The last
  review's verdict is posted on it as one keyed comment. So CI runs once, on
  the head that merges, even when the last review sends a task back.
  - This orders one step differently from
    `docs/direction/done-is-per-criterion.md` ("the PR is opened, CI runs,
    and the final review checks..."): here the last review runs before the
    pull request opens. CI still runs once, and a reopened task does not
    cost a second CI run.
- **`deliver plan=<ticket>` in tsh.** `hosted/deliver.ts` serves the lane and
  every child it names. `hosted/deliver-program.ts` is the program. Run again
  after a crash, or from a second shell, it serves the same names: the lane
  goes on from its journal, and no child starts twice. tsh lists it when
  `tsh.toml` names the repository and the run's picks name a check (107's
  install, then `[[checks.run]]`).

### What 107 already had

107 landed while this ran. Where the two overlapped, 105 now uses 107's:

- `planAtMain` (107): `deliver` plans at main as fetched now.
- `setup.install` and `setup.run` (107): `deliver`'s checks at each head.
- `INSTALL` (107): the install's check name.

Two pieces stay apart, on purpose:

- **Taking main in.** 107's `takeMainIn` is inside the one-ticket build on
  GitHub (`stages/build/github.ts`). It merges main when ship said
  `behind`, and gives up on any conflict. 105's catch-up is the lane's own
  child: keyed, taken over cleanly, and it solves conflicts (code for the
  lockfile, an agent for the rest). Both merge and never rebase. They share
  no code because one is a step of the old single-ticket build, and the
  other is a child on tea-host. When the one-ticket build becomes a lane of
  one task, `takeMainIn` can go.
- **Local checks.** 107's `withLocalChecks` runs checks at a pull request's
  head on GitHub. 105's `localCodeHost` runs them at a branch's head with no
  pull request. Both keep their runs in the same fold (`check-runs.ts`).

### The laws

Every tea machine has a laws spec (`laws/standard.test.ts`). The three new
ones are walked like the others, every order of messages to a depth bound:

- **Task** (`laws/task.ts`): a push goes out only after the gate let the
  task through, from the base it read; the commit closes no ticket; a
  builder Msg counts only for the run asked for; runs stay under the limit.
- **Catch-up** (`laws/catchup.ts`): a push goes from the branch as read,
  takes in the main it read with every conflict resolved, or only reverts;
  the lockfile never goes to the resolver; a resolver Msg counts only for
  the merge asked about.
- **Lane** (`laws/lane.ts`): a child's name always means the same job (a
  name started again is how a taken-over lane finds its child); no work
  starts while the owner has an ask open; the pull request opens only at a
  met head with main in, and closes exactly the plan's tickets; the lane
  ends done only on its pull request merged; a child's end counts only for
  the child running; rounds stay under the cap.
- Planted mistakes (`laws/plan-lane.test.ts`): 7, each caught by the law
  it aims at. Not every law has a plant yet.

## Scripted runs

`experiments/105-the-plan-lane-dry-run.ts`. One Miniflare ledger and one
fake GitHub run in the harness process. Each host is its own process, in its
own process group, and is killed whole. Lease 1 s.

- **The fake GitHub** keeps GitHub's rules: one open pull request per
  branch, a push that is not a fast-forward is refused, checks run when a
  pull request opens or its head moves, a queued pull request lands only if
  its head passed and was tested on main as it is.
- **The workspace** is a small pnpm workspace shaped like demlik's: the
  package `structure-sweep` and a package it may depend on.
- **The scripted agents work from marks.** Each criterion ends with
  `(mark:<m>)`. The builder writes `// mark:<m>` into the file that mark
  belongs to, which is a file the task touched in #708. The reviewer passes a
  criterion only when an added line carries its mark. A scenario bends one
  rule.
- **The harness plays the owner.** It approves each plan version and answers
  a stuck task as the scenario says.

| Scenario | What bends | Runs held | Children | Agent turns | Rounds t1 / t2 / t3 | Last reviews |
|---|---|---|---|---|---|---|
| A | all of the below | 3 / 3 | 22 | 17 | 2 / 2 / 1 | 2 |
| B | task 3 never meets one criterion | 3 / 3 | 28 | 18 | 1 / 2 / 4 | 2 |
| C | host killed inside task 2's build turn | 3 / 3 | 13 | 10 | 1 / 1 / 1 | 1 |
| C2 | host killed after task 2's push, before its done row | 3 / 3 | 13 | 9 | 1 / 1 / 1 | 1 |

- **A, the happy path with every bend:**
  - task 1's first review fails: a second round (`t1` 2);
  - #707 is filed while task 1 builds. Sort folds it in. The lane plans
    version 2 (10 criteria, from 9) and waits on the owner;
  - #711 is filed. Sort closes it as a duplicate of #709;
  - main moves with a lockfile change while version 2 waits. The next
    catch-up (`t1:r2`) met a conflict in `pnpm-lock.yaml` only, checked by
    `git merge-tree` on its two parents. Code made the lockfile again, with
    no agent turn;
  - task 3 drops task 2's marks from a file they share. Task 3's own review
    passes. The first last review fails task 2. The lane sends one round to
    task 2, and the second last review passes;
  - the pull request closes #700 and #707. It landed once, tested on main.
  - Two hosts started the lane at once. One held it, 3 of 3.
- **B, a stuck task:**
  - task 3 leaves 1 open after each of rounds 1, 2, 3. The stall rule asks
    the owner at round 3 (`no_progress`);
  - the owner says "keep going 1". Round 4 leaves 1 open. The rule asks
    again (`ran_out`). The owner removes task 3;
  - task 3's commits come off by revert. No file of task 3's is left at the
    merged head;
  - the last review fails the plan's own criterion (task 3 was building
    it), sends one round to task 2, then passes. Tasks 1 and 2 ship.
- **C and C2, a kill and a takeover:**
  - 0 commits twice, 0 review rows twice, 1 pull request;
  - wasted agent turns: C2 is the control's count (9; the kill falls after
    the push, so nothing is run again). C, killed inside the turn, takes 10:
    1 wasted turn.
- **exp 91's world laws** held in all 12 runs: one lane per ticket (no
  write from a fence that did not hold the lease), landed only after it was
  tested with main, only a passed head lands, a stuck task leaves an ask,
  the lane ends.
- **Before the goal fix**, each happy path ran one more round on task 3 and
  one more last review: C took 18 children and 13 turns, now 13 and 10.

## Real runs (haiku)

`ONLY=real`: C's world with no kill, Claude Code haiku at effort low as
every agent, the fake GitHub, no real repository. The harness approves each
plan version. Asked about a stuck task, it says "keep going 2" the first
time and removes the task the second (pass 1 and 2 removed it at the first
ask). Spend is what the SDK reported, counted by the ledger.

| Pass | Code | Time | Children | Turns | Plan | Ended | Counted |
|---|---|---|---|---|---|---|---|
| 1 | before the `unseen` and reviewer fixes | 1,607 s | 34 | 26 | 2 tasks, 19 criteria | `stuck:review_failed` | $0.32 |
| 2 | before the `emptied` fix | 898 s | 23 | 15 | 2 tasks, 7 criteria | `stuck:review_failed` | $0.18 |
| 3 | all fixes | 1,582 s | 29 | 23 | 2 tasks, 12 criteria | `done`, PR merged | $0.34 |

- **Pass 1:**
  - task 1 took 5 rounds, task 2 took 6;
  - task 2's 6th review ended `unseen` (the reviewer could not judge), and
    the lane took that as a stuck review and stopped;
  - the stall rule never asked: the open list kept getting shorter.
  - Fixed: an `unseen` review is a round with its work still open. And the
    reviewer's clone did not hold the head it was judging: it now fetches
    and reads the branch at that head.
- **Pass 2:**
  - task 1 failed the same criterion 3 rounds running. The reviewer named
    the same real fault each time: two rows of a plan that name the same
    target both pass the check, and the second silently overwrites the
    first. The builder did not fix it;
  - the rule asked at round 3 (`no_progress`). The owner removed task 1;
  - task 2: the same, on a moved file's own imports never added to the
    target package's dependencies. Removed too;
  - both reverted, then a last review of an empty change, `stuck`.
  - Fixed: a plan with every task removed ends `skip:emptied`.
- **Pass 3:**
  - task 1 passed in round 2 (1 open, then 0);
  - task 2's open list went 5, 1, 1, 1, 2, 1. The rule asked at round 4
    (two stalls in a row). "Keep going 2". Asked again at round 6
    (`ran_out`). Removed. Its 6 commits came off by 6 reverts;
  - the last review passed 8 of 8 at the head;
  - pull request #800 (fake): merged once, tested on main, CI once, closes
    #700; 0 rewrites, 0 refused pushes, 0 commits twice, 0 review rows twice,
    0 late or unkeyed writes;
  - the harness first said "a removed task's files are left". A false
    alarm: the file was in the workspace before the plan, and the tree at
    the merged head equals task 1's last commit exactly. The law now checks
    that each removed build commit has its revert in the merged history, and
    that a file only the removed task touched reads as on main.
- **What blocked task 2 at the end was not a criterion.** In rounds 4 and 6
  every criterion passed; the one open item was a fault the reviewer found
  outside them. That is the rule as decided ("a real problem no criterion
  covers becomes a new criterion"), and it is what made task 2 cost 6
  rounds.
- **Files against #708:** 7% of #708's files found, 25% of touched files
  right. Haiku split #700 into 2 tasks where #708 has 3, and built around
  `cli.ts` and `apply.ts` where #708 added `workspace.ts`, a changeset,
  the README and the manifest work. Pass 1 was 17% / 50%, pass 2 0%.
- **Per turn:** a build $0.01 to $0.045, a review $0.004 to $0.013.

## Holes and findings

- **The scripted file match is by construction.** The scripted builder
  writes each mark into a file #708's commit touched. 100% there proves the
  harness, not a model. The real pass is the only real measure, and it
  failed the 80% bar: 7% / 25%.
- **Haiku at effort low did not carry #700.** In 3 passes, 2 of 6 tasks
  passed (task 1 of pass 1 in 5 rounds, task 1 of pass 3 in 2). The reviewer's reasons were real faults, named the same way each
  round, so the builder is the weak side. A stronger builder is the next
  measure; it would tell the model from the lane.
- **Only one real pass merged, and with half its plan.** The real side of
  "one PR for the whole plan" is shown once, for one task.
- **The caps disagree with a decision.** `done-is-per-criterion.md` says
  only the stall rule stops a loop. The lane keeps three backstops: 12
  rounds a task, 4 last reviews, 3 ship runs. None fired in any run (the
  rule asked at round 3 or 4). Last reviews and ship runs have no stall rule
  of their own yet, so those two caps are the only stop there. To settle:
  drop the round cap, and give last reviews the stall rule.
- **The harness plays a patient owner.** "Keep going 2, then remove" is one
  policy. Pass 2's "remove at the first ask" removed both tasks.
- **The real plan names its own tasks.** The harness's laws for tasks name
  `t1` to `t3`; a real plan's `t2` is not #708's task 2, so the per-task file
  match compares unlike tasks.
- **A ticket folded in while the plan is being planned** may cost one more
  plan version: the lane plans again for it after the owner's answer.
- **A child with no outcome row** leaves the lane waiting. Every child
  writes one today, but nothing times the wait out.
- **The lockfile is made again only for pnpm.** Another lockfile conflict
  goes to the agent like any other file.
- **`keptFrom`** (which criteria a new plan version keeps) matches by the
  words of a criterion. A reworded criterion is a new one, and is judged
  again.
- **The harness plays the owner and the router.** It answers asks by
  writing the answer fact, and it casts sort's job for each new ticket.
  Nothing in tsh does either yet for a lane.
- **The reviewer's clone is per plan, per host.** Two lanes of one plan on
  one host would share it. Only one host holds a lane, so this does not
  happen today.
- **An `unseen` last review** reads again under the cap of 4. It is not
  sent to a task: no criterion failed.
- **Noise in every run:**
  - `RuntimeDiscardedError` on stderr when `deliver` closes its scope on the
    host started after the end. Harmless: the lane is over.
  - tea's `stop-save` error, "store conflict expected version N found N",
    about 2 per child, after the child's outcome is written. Nothing is
    lost, but it hides real errors in the log.
- **The volta pnpm shim is slow** when `HOME` is changed. The harness puts
  the real binaries first on the path.
- **`deliver` never deletes `plan/<n>`** after the merge (107's hole too).

## Next

- A lane for one ticket, with one task, to replace the one-ticket build and
  its `takeMainIn`.
- Asks and the sort router in tsh, so a person can drive a lane end to end.
- Real runs at a size haiku can carry, and with a stronger builder, to tell
  the model from the lane.

## Run it

```sh
node experiments/105-the-plan-lane-dry-run.ts
```

- `ONLY`: `A,B,C,C2` (the default) or `real`.
- `REPEAT=3`, `TTL_MS=1000`, `WAIT_MS=240000`, `DEBUG=1` keeps every host's
  lines.
- `PNPM_DIR`: a folder with the real `pnpm` binary, put first on the path.
- Real agents: `ONLY=real`, with a Claude Code token in
  `CLAUDE_CODE_OAUTH_TOKEN`. `CAP_USD=4.5` stops the run at that much
  counted. `KEY=<name>` keeps it under another results key. It writes to no
  real repository.
- Results: `results/105-the-plan-lane-dry-run.json`.
