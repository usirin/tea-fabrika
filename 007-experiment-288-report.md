REPORT: experiment 288 done; the reader list is complete for both plants, and the one red off the list is a slow law, not a reader

Answer: yes, as far as two plants can show. Every red test the plants caused is on the reader
list. The one red off the list, T753 L16 in `runtime-recovery.laws.test.ts`, timed out at 60 s
on both plants. Run alone it takes about 30 s on main and on plant 1 alike, so it is a slow law on
a loaded CI machine. It is filed as a flaky-test finding, not counted as a hole. One gap: plant 1's
sixth `next` machine hit the job's 17-minute limit, so part of the suite never ran under the line
shift.

| Plant | Run | `next` machines | Reds on the list | Reds off the list |
|---|---|---|---|---|
| 1, a 26-line doc block on top of all 297 non-test files (a9d665f, PR 1195) | 43563163607 | 1, 2, 4, 5 green; 3 red; 6 cancelled at 17 min | none | T753 L16, timed out |
| 2, trap text: import and export lines, `defineMachine(`, `syncTest(`, exam markers, function-body comments (0759f89, PR 1196) | 43563165554 | 1, 4, 6 green; 2, 3, 5 red | `laws-scan` x2, `layers`, `deps` (all in the exam) | T753 L16, timed out |

About T753 L16:
- It reads no source file, builds nothing, and runs 100 fast-check runs on a fixed seed.
- On these runs shard 3 took 682 s and 653 s. On a main run it took 509 s, with all 413 tests
  passing.
- Plant 1 adds twice the lines of plant 2, yet both shards were equally slow.
- At least seven other PR runs started while the plants ran.
- Locally on Node 26.13.0, three runs per side: main 28.3, 29.7, 30.6 s; plant 1 32.3, 28.4,
  33.0 s.

`check` was green on plant 1 and red on plant 2; I did not trace the cause past oxlint's exit
code. `typecheck` was green on both.

Owed, by someone with the tracker:
- A flaky_test needs a tracker ticket and a fix the same day (0036). The finding row is
  field/findings/2026-11-14-t753-l16-times-out-on-a-loaded-ci-machine.json, with ticket null.
- Optional: rerun plant 1's `next (6)` on PR 1195, about 17 machine-minutes, to see the tests
  after the cut. Shard 6 already takes about 15 minutes on main against its 17-minute limit,
  which is itself close to a red.

Write-up: experiments/288-ci-reader-list-two-plants.md plus the finding row, on
fabrikalfa/x288-ci-reader-list, commit 24705d8, pushed. `pnpm format`, `pnpm lint` and the field
check passed. No README row, per 0522. Both plant PRs can be closed now. Cost: CI time only (two
full runs), plus this session.
