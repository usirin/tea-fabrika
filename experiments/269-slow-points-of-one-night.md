---
date: "2026-11-11"
scripts: "none; a count of our own logs, not an experiment run"
summary: "Today's lead tooling, 2026-11-10 21:00 to 11-11 10:00. 16 ranked slow points: apt outage 38 PR-hours, the serial merge line about 28 PR-hours before the outage, overnight parks 10.7 lane-hours, box setup 10.9, the gc Docker hang 8.4, a needless plan-writer lock 7.2 h, lead pickup 6.0, a plan table missing a file about 5.5 plus $42, 15 typecheck reds only CI found, 10 conflict aborts, a checkout 36 commits stale (12 fixes never ran), the askdesk7 loop 6 h and $15, Codex no-progress $5.40, 48 red `commits` runs. Per-lane table for 26 lanes. Seven items are told at length in 260. One night. No model, $0."
---

# 269. Where did the time go on the night of 2026-11-10, ranked, and what is the smallest fix for each?

Counted on 2026-11-11, on main. **This is a count of our own logs, not an experiment run.** The
window is 2026-11-10 21:00 to 2026-11-11 10:00, Pacific. **All of it is today's lead tooling**
(`chain.ts`, `drive.ts`, `box.sh`, `catchup.sh`, plus hand-run lander shells kept outside the repo)
running lanes for both `next/` and today's app. Sources: the lanes' chain records (step start and
end, outcome, box), each box's first agent event and prompt file time (box ready), the step cost
rows (minutes, dollars), the lander's log, the lead's own log of the night, `gh pr list`,
`gh run list` (900 runs) and `gh run view` for all 91 failed or canceled `check` runs. The working
files stayed outside git ([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).
One agent counted; no model call of its own, $0.

[Experiment 260](./260-lane-queue-or-scheduled-job.md#what-the-wrong-home-cost) already carries
seven of these (the apt outage, the merge line, the gc hang, box setup, the plan lock, the lead's
pickup and the stale checkout) as the cost of work in the wrong home. This write-up keeps the whole
ranked list, the per-lane table, and the items 260 does not hold.

**The answer: the night lost most to two things nobody in a lane could fix: CI's apt mirrors
(38 PR-hours) and a merge line that reran full CI on every catch-up (about 28 PR-hours before the
outage).** Then come lanes parked overnight for the owner (10.7 lane-hours), a fixed box setup per
step (10.9), and the Docker hang inside box cleanup (8.4). Most smallest fixes were one change each,
and several were already merged but never ran, because the checkout the lanes ran from was 36
commits stale.

| # | Slow point | Lost | Unit |
|---|---|---|---|
| 1 | CI apt outage, 05:46 to 08:20 | 38 | PR-hours (measured overlap) |
| 2 | Serial merge line, full CI rerun on every catch-up | about 28 before the outage, 20 to 45 more draining after | PR-hours (measured + estimate) |
| 3 | Lanes parked for the owner overnight (budget stops, design calls) | 10.7 | lane-hours |
| 4 | Fixed box setup, about 3 min per step | 10.9 | lane-hours |
| 5 | Docker `ps` hang inside box gc, 21:13 to 02:00 | 8.4 | lane-hours |
| 6 | Plan writers run one at a time (a lock nobody needs) | 7.2 | hours of plan latency |
| 7 | The lead's pickup after an `ask` or `stuck` | 6.0 | lane-hours |
| 8 | Plan files table missed a file (`not_owner`, asks, send:plan) | about 5.5, plus $42 | lane-hours |
| 9 | Type errors only CI could find | about 10 (15 red runs) | PR-hours (estimate) |
| 10 | Merge conflicts in the line | about 10 (10 aborts) | PR-hours (estimate) |
| 11 | The main checkout is 36 commits stale, so 12 tooling fixes never ran | at least 3, and it multiplies 4, 9 and 12 | lane-hours (floor) |
| 12 | askdesk7 review/build loop with no host run | 6 h wall, 85 agent min, $15 | lane-hours |
| 13 | Slow and timed-out tests | about 2.5 | lane-hours, plus 3 CI reds |
| 14 | Landing jams before the one lander (04:39) | about 1.3 | hours with no landing |
| 15 | Steps that end with no commit, unsigned bases, Codex turns ending early | about 1.6 | lane-hours |
| 16 | `commits` check red on branches behind main | 48 red runs, little wall time | runs |

How it was counted. A lane-hour is one lane not moving for one hour. A PR-hour is one open pull
request not merged for one hour. They are different units, so the order mixes them; inside each
unit it is exact. "Measured" means summed from timestamps; "estimate" says how.

## Per lane

Wall is first start in the window to pull request opened (or to 10:00). Agent is first agent event
to step end. Setup is step start to first agent event. Parked is the end of an `ask` or `stuck` step
to the next start, lead and owner together. Rounds back counts steps that sent work back.

| Lane | Wall h | Agent min | Setup min | Parked min | Rounds back | PR |
|---|---|---|---|---|---|---|
| askdesk7 | 8.8 (from 21:00) | 85 | 303 | 109 + 34 | 11 | 888 |
| errcause | 7.0 | 148 | 37 | 221 + 13 | 7 | 924 |
| p14b | 5.8 | 191 | 42 | 114 | 6 | 912 |
| settings1 | 5.5 | 135 | 115 | 165 | 6 | 901 |
| sm6 | 4.3 | 49 | 15 | 194 | 0 (2 stops) | 911 |
| p34c2 | 3.7 | 167 | 60 | 15 | 0 (lost 2 tests runs) | 896 |
| p34cs2 | 3.1 | 141 | 51 | 58 | 9 | 926 |
| p13b | 2.6 | 106 | 98 | 47 | 5 | 887 |
| p41s1 | 1.75 | 92 | 14 | 0 | 1 | 929 |
| p40s1 | 1.65 (no PR) | 71 | 13 | 2 | 1 | none |
| t688 | 1.5 | 43 | 19 | 29 | 0 (4 parks) | 905 |
| p39s1 | 1.4 | 59 | 22 | 1 | 1 | 917 |
| t682 | 1.35 | 72 | 9 | 0 | 0 | 910 |
| svc1 | 1.25 | 52 | 20 | 3 | 1 | 891 |
| audite, audith, testwin2 | 1.2 each (no PR) | 47, 43, 39 | 5, 13, 17 | 0 | 1, 2, 3 | none |
| sm1 to sm5 | 0.8 to 1.15 | 25 to 42 | 10 to 40 | 0 | 0 to 1 | 879 to 885 |
| svc4 (Codex) | 1.0 (no PR) | 10 | 18 | 12 | 5 | none |
| t681, svc3, auditi | 0.85, 0.7, 0.5 | 39, 18, 16 | 12, 10, 5 | 0, 12, 8 | 1, 0, 0 | 899, 904, 921 |

Why steps went back or stopped, grouped (each step counted once, 216 steps in the window):

- Review found a real defect: 22 (p34cs2 4, settings1 2, p14b 2, p13b 2, testwin2 2, others 1).
  These are the system working.
- Plan gap (`not_owner`, a file outside the table, `send:plan`): 15 (settings1 2, errcause 3, t688
  2, svc4 2, p34c2, svc1, p39s1, p40s1, p34cs2, p13b, auditi).
- askdesk7's host loop: 9 reviews in a row said "host laws not run" to a build that cannot run them.
- Budget stop ([0076](../.decisions/0076-a-lane-stops-at-its-budget.md)): 9 (p34cs2 3, p14b 2,
  settings1, sm6 backstop, errcause, svc4).
- Tool fault: 7 (npm registry from a box, `not_formatted` on collect, an offline install that
  emptied `node_modules`, Docker socket refused in a box, `cannot lock ref`, a duplicate box name,
  `no_answer`).
- Type error found late: 5 lane rounds (p14b 2, settings1 2, p13b) plus 15 CI reds (item 9).
- Step said done with no commit, or the base was not signed: 5 (errcause, p14b 2, p34cs2, sm6).
- Size cap asks: 3 (p34cs2 2, settings1). Leak check: 2 (errcause). Test timeout: 1 (p34c2).
- Merge conflicts and signing problems show up in the merge line, not in lane rounds.

## Per pull request

100 pull requests were opened or merged in the window. 43 code pull requests merged. 30 were open
at 10:00, 7 of them held for the owner (877, 888, 889, 900, 917, 925, 929).

- Opened to merged, code pull requests merged before 05:46: 32, median 0.92 h, total 40.7 h.
- Code pull requests merged after the outage: 11, median 3.1 h, total 34.6 h.
- 210 `check` runs for these 100. Docs-only ones used one each; code ones used 2 to 10 (880 used
  10, 887 used 9, 875 used 7, 873 and 899 used 6).
- Red `check` runs by cause (whole window, 272 runs): 181 green; apt outage about 38; real test
  failure 20; lint 17; typecheck 15; canceled by a newer push 16 to 37.
- `commits`: 48 red of 285, nearly all `broken_chain` on a branch behind main. The lander saw one
  (911 at 09:31).
- 10 aborted catch-ups on conflicts with main (887, 901 twice, 924, 912, 910, 915 and others).
- A `check` run took 12.5 min median, 15.4 min at p90 (code runs only). Where that time goes is
  [experiment 268](./268-checks-in-five-minutes.md).

Not split per pull request: time waiting in the line against time in CI. The lander logged only the
end of each attempt.

## The merge line and the lead

Merges per hour, code only: 00h 4, 01h 6, 02h 3, 03h 4, 04h 8, 05h 6 (about 5 an hour before the
outage); 05:46 to 08:20, none (one docs pull request, 903); 08:21 to 10:00, 10 (about 6 an hour,
three landers from about 09:10). The one lander, from 04:39, spent about 8.4 min per merge before
the outage (8 merges and 7 failed attempts in 67 min) and about 13 min after. Every catch-up merged
main in, pushed a new head and waited for a full CI run, so the line could not go faster than one
pull request per CI run. The lander's log holds 20 merges, 29 reds and 10 conflict aborts; 20 of the
29 reds came between 05:58 and 07:01 and were the outage.

Mistakes the lead's own log admits, with cost:

- The main checkout was not pulled after 01:44: 36 commits behind by 10:00, 12 of them lead tooling
  (871 host step, 876 faster start, 873, 893, 894, 895 heartbeat, 898 host typecheck, 906, 908,
  909, 905, 875). Every lane since ran the old `chain.ts` (item 11).
- Duplicate plan writers twice (about 07:00 and 08:49), from the hidden lock in item 6.
- p39s1's chain started twice (one died on the box name, `box_failed`, 3 min).
- Wrong plan file for askdesk7 (`plan_unapproved`, about 10 min).
- A regex repair broke a `patches/@demlik...` path in t688's plan: tests2 lost 25 min and $3.88.
- A lead note placed after `## pr` in p13b's brief: three rounds (04:08 to 04:24) changed nothing,
  plus an 11.6 min gap.
- svc3 started on a ticket another pull request held (`shared_ticket`, 12 min).
- zsh did not split `$p`: an early waiter never ran 871 to 876.
- Nine waiter shells at once before the one lander: the two jams in item 14.
- `loosening.sh` run against origin/main, not the merge base: false "removed law" hits.
- Time stamps ran four hours fast for part of the night.

Done by hand, with counts: 25 plan body hashes and 16 "amended" notes; 29 loosening hand checks
posted; 25 lane restarts noted, 33 measured; 13 commits signed as lead for an agent; 39 re-queue
attempts after a red or a conflict; 15 tickets closed by hand in one batch (19 of 20 merges had no
`fabrika close ticket` line); 4 pull requests (871, 873, 875, 880) that declared a new script's
`?raw` read in `flow/host.test.ts` after a red; orphaned `docker ps` calls killed 4 times (about 20
at 07:27); 7 ticket numbers checked because the tracker tool lagged; at least 3 lane state heads and
branches set by hand before a restart.

Plan writers (Codex): 35 plans, run time 2 to 24 min, most 5 to 10 (svc1's 67 and t682's 34 were
reruns). 3 plans described work already merged (auditg1 by 703, auditg24 by 704, auditg26 by 706).
At least 16 of about 26 lanes needed a lead change to their plan before or during the lane.

Machine load: lanes with a step running at once went 3 to 4 until 01:00, 11 at 02:00, 13 at 02:30,
3 at 04:00 to 05:00 (slots empty while lanes waited on the owner), 10 at 05:30, 4 to 6 from 06:30,
9 at 09:00. Box launch (prompt written to first agent event) was 2.5 min median at 02:00 with 13
lanes and 1.6 to 1.8 min when quiet: load adds about half a minute per step. `docker ps -aq passed
its 30 s limit` appears 58 times in chain logs (about 29 min); Docker Desktop hung again near 07:27
and was restarted near 07:55. Load was about 15 after the three landers started.

## Each slow point, with the smallest fix

Items 1, 2, 5, 6, 7 and 11 are told at length in
[experiment 260](./260-lane-queue-or-scheduled-job.md#what-the-wrong-home-cost); their fixes are
below in short. "Was in flight" is as of 10:00 on 2026-11-11.

1. **CI apt outage.** GitHub's Ubuntu mirrors stopped answering. First apt failure 05:46 (main),
   last 07:51 (PR 920), first green after it 08:20 (PR 914, run 43054491811): 2 h 34 min with no
   code merge, 38.1 PR-hours over 25 open pull requests, about 38 red runs, 20 wasted catch-ups. Was
   in flight: PR 914 (mirror fallback) merged; an agent making `apt.sh` skip the install when the
   tools exist. Smallest fix: the lander re-queues a pull request whose red step is `apt packages`
   or `chromium` and waits 10 min, instead of logging red. Later: cache the browser and the `.deb`s
   ([268](./268-checks-in-five-minutes.md), fix 4).
2. **Serial merge line.** 32 pull requests merged before the outage spent 27.9 PR-hours beyond a
   0.4 h ideal (open to merged minus one CI run and 10 min). 23 queued at 08:20 at about 6 an hour:
   20 to 45 more PR-hours draining (estimate). Smallest fix: land PR 933,
   [0097](../.decisions/0097-a-green-pull-request-lands-without-catching-up.md) (a green pull
   request lands without a second run); it was red on `test (5)`, fix that first. Later: a merge
   queue that batches ([0107](../.decisions/0107-fabrika-provides-the-merge-queue.md)), with the
   hourly run on main ([0066](../.decisions/0066-mutation-runs-on-a-schedule.md)) catching what a
   skipped rerun misses.
3. **Lanes parked for the owner overnight.** sm6 141 min (backstop $6 after one $6.50 step),
   settings1 108, p14b 89, errcause 197 (exam-owner rule, PR 877), askdesk7 109 (layer exception):
   644 min, 10.7 lane-hours, most ended between 05:18 and 05:26, right after the owner's
   fix-forward call ([0096](../.decisions/0096-the-lead-fixes-forward-while-the-owner-is-away.md)).
   After it, budget stops still cost about 50 min (p14b 21, p34cs2 13 and 10, svc4). Smallest fix:
   a plan's `Estimate:` line must give at least $8 per tests step (sm6's stop came from a $3
   estimate against a $6.50 step), checked in `plancheck.sh`. Keep the stop: it caught real loops
   (askdesk7, svc4).
4. **Fixed box setup per step.** 216 steps; step start to box ready 0.8 min median (183 min),
   box ready to first agent event 2.1 min median (473 min): 656 min, 10.9 lane-hours. PR 876
   (faster start, merged 02:22) never ran (item 11). Smallest fix: pull the main checkout, then read
   876's phase timings. Later: a warm box per lane, reset between steps, that proves a clean tree
   before the agent starts. Where a step's start time goes: [experiment 267](./267-how-a-step-box-starts-in-seconds.md).
5. **Docker hang in box gc.** 12 step starts waited over 6 min, 504 min, all 21:13 to 02:00; worst
   askdesk7 r19 116 min, p14 r17 112 min, askdesk7 r20 68 min. PR 863 (time limit) merged 00:43;
   PR 919 (Alchemy beta.85, fewer Docker calls). Smallest fix: gc's Docker sweep never runs before a
   box is made. *Decided later as [0101](../.decisions/0101-box-cleanup-runs-on-a-timer.md): gc
   leaves the start path entirely.* Later: a watchdog outside the process that kills a `docker ps`
   older than 2 min.
6. **Plan writers one at a time.** Each start equaled the previous end, to the minute (sm1 01:30,
   sm3 01:36, sm2 01:41, sm4 01:46, sm6 01:53, sm5 01:59, all briefed at 01:19). `redact.sh --run`
   holds an exclusive `flock` on a lock named after the working folder for the whole Codex run, and
   every plan writer runs in the main checkout. The lock guards an `.npmrc` swap, and the main
   checkout has none. 433 min of queue wait over 24 plans (sm5 40 min, p42 36, sm6 34, t681 32), 2
   duplicate starts. Smallest fix: take the lock only when `<cwd>/.npmrc` exists, or only around the
   rename and restore. *Rechecked on main 2026-11-11: the lock is still taken for every run
   (`redact.sh:70-73`).* Later: a law that two `--run` calls in a folder with no `.npmrc` overlap.
7. **The lead's pickup after an ask or stuck.** The lead checked every 20 minutes. 33 parks, 359
   min, median about 10 min, longest 34 (p13b after 887 went red), 30 (sm6), 30 (settings1 after
   901's CI typecheck): an upper bound, as it includes the fix. PR 895 (heartbeat) merged but never
   ran. Smallest fix: a background watch on the chain records that wakes the lead when a step ends
   `ask`, `stuck` or a stop, and records when it fired.
8. **Plan files table missed a file.** A finished step could not be committed because the plan
   named nobody for a path, and amending the plan changes the hash the box pinned, so the work was
   thrown away. Lost runs: settings1 74 min, p34c2 87, errcause 38, svc1 16, t688 25: 240
   agent-min, **$42 at list price**, then rerun. Asks about a file outside the table: p39s1, p40s1
   (42 min of work, then a rerun of 23), p34cs2, t688, svc4 twice, errcause's build. About 5.5
   lane-hours with the reruns, not counting errcause's 197 min park (item 3). Was in flight: PR 877
   (tests may commit an exam path nobody lists), held for the owner; PR 894 (owned paths first, a
   draft plan fails on a non-path row) merged but never ran. Smallest fix: at collect, `drive.ts`
   reads the lane's current signed plan, not the hash pinned in the box facts, so the lead adds the
   row and the kept box is collected (one change in `collect` and the box facts check in
   stepcommit). Later: plancheck finds every file that imports a file the plan renames or moves, and
   asks for a row; collect still refuses a path the current plan does not list.
9. **Type errors only CI could find.** Boxes ran no typecheck, so type errors showed up on CI after
   the lane said done. 15 red `check` runs on `pnpm typecheck` (886 twice, 887 four times, 899
   twice, 901 twice, 906 twice, 924, 926, 929). Each costs a CI run (12 min), a pickup (10 min) and
   a fix round: about 40 min each, about 10 PR-hours (estimate). 924, 926 and 929 came after PR 898
   (host typecheck before the pull request opens) merged at 05:46, because it never ran (item 11);
   PR 932 too. Smallest fix: pull the main checkout, then look for a `typechecking` phase in the
   next lane's chain record. Later: a narrow `tsc -p` of the changed package inside the box, still
   one host typecheck at a time.
10. **Merge conflicts in the line.** 10 aborts in the lander's log. 901 conflicted at 05:46 and
    again at 08:55 and was still open. About 1 PR-hour each, about 10 (estimate). Three rename
    sweeps (t681, t682, t688) touched many shared test files in the same hours. Three landers move
    main faster, which helps and also makes more conflicts. Smallest fix: `chain.ts` merges
    origin/main into the lane branch before the review step, so a conflict reaches the builder, not
    the line. Later: land wide sweeps alone, at the head of the queue; the merged head still gets
    its lint check (`freshmain.ts`).
11. **The main checkout is stale.** Last pulled at 01:44: 36 commits behind, 40 lead files, 3,873
    lines. Never ran: 871, 873, 875, 876, 893, 894, 895, 898, 905, 906, 908, 909. Measured effects:
    askdesk7 looped 71 more min after 871 merged (8 steps); 924, 926, 929 opened with type errors
    after 898; no `beat` in any chain record; setup time unchanged after 876. Smallest fix: the
    lead's check waits until no step is starting its box, then `git -C <main checkout> pull
    --ff-only`. *Decided later in 260's research: the merge queue brings the checkout up to date
    after it merges* ([260, "Guesses that were wrong"](./260-lane-queue-or-scheduled-job.md#guesses-that-were-wrong)).
12. **askdesk7 loop with no host run.** Review said "host laws not run"; build could not run them
    and answered "already green". 21:03 to 03:09: 9 review sends and 9 builds, 85 agent min, about
    **$15**, 6 h wall (2.5 h of it the Docker hang). PR 871 (host step) never ran. Smallest fix: in
    `chain.ts`, when review sends to build with the same reason at the same head twice and build
    made no commit, park as `ask:lead`. Later: the host step runs host laws in the loop; review
    still refuses without host results.
13. **Slow and timed-out tests.** p34c2's tests2 stopped at its 60 min limit ($0 spent, 64 min
    lost); p34cs2's build was sent back over the slow RunnerSupervision property; 3 CI reds from
    RunnerSupervision's p80 law at its 60 s limit (PR 882; main at 04:08 and 08:21); hourly
    mutation 10 of 32 runs red, several at the 900 s box limit. Was in flight: PR 923
    (RunnerSupervision 48 s to 17 s), PR 916, PR 913. Smallest fix: land 923 first in the queue.
14. **Landing jams before 04:39.** About 60 min (the waiters' `pgrep` matched fake catch-ups from
    the box cleanup's tests) and 20 min (a catch-up on already merged 879 looped on `sleep 30`).
    From the lead's log; no lander log then. Was in flight: one lander with an anchored match; PR 913
    (red on `test (1)`). Smallest fix: land 913.
15. **No commit, unsigned base, Codex turns ending early.** 3 `no_commit` stops (32 min), 2
    `base_not_signed` refusals (sm6 24 min, p14b 4 min), and svc4 on Codex: 5 tests rounds of 0.7
    to 2.9 min each, 2 to plan and 3 to itself, 38 min and **$5.40** with no pull request. Smallest
    fix: `drive.ts` treats a send to its own step as `stuck:no_progress` on the first one.
16. **`commits` check red behind main.** 48 of 285 runs red; the lander hit one. Smallest fix: land
    [0098](../.decisions/0098-the-signed-chain-covers-the-branch-not-main.md)'s change.

Dollars named in the night: $42 (item 8), about $15 (item 12), $5.40 (item 15), $3.88 (t688's
broken plan), all at list price from the step cost rows. The night's total spend was not summed.

## What it cannot tell us

- When each pull request was ready (hand check done and queued). So line wait and CI time per pull
  request are not split; item 2 is an estimate from open-to-merged times.
- Whether apt recovered on its own before 08:20, since 914's fallback landed first.
- Tooling agents' worktrees leave no rows, so their time is not here.
- The lead's own time per hand task. Only counts.
- A plan writer's start is its file's birth time, which is right only because of the lock; the
  reruns (svc1, t682) mix two runs.
- The four 20:58 to 21:13 steps of askdesk7 and p14 started before the window; their setup is
  counted from their step start.
- No field run rows were written for these lanes on 2026-11-11, so `field/` cannot check these
  numbers.
- One night. The numbers move with the load and with every tooling fix.
