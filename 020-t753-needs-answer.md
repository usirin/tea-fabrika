NEEDS ANSWER: Cloud lane T753 L16 flake stopped at the plan step with nothing pushed; the slowness is in product code, and it needs your call on (a), (b) or (c); relayed from its transcript.


NEEDS ANSWER: T753 L16 lane stopped at the plan step. No commits, nothing pushed. The law's slowness is in product code, not in the test, so a proper fix needs a decision I may not make.

Branch: `fabrikalfa/cloud-t753-l16-flake`, still at `origin/main` f583014. No commits, never pushed, working tree clean. All of this is about `next/`.

## Why each run costs about 0.28 s

The plan agent measured this on f583014, with timers in the law and a CPU profile over all 100 runs. It reverted every timer afterward.

- **Setup is cheap.** `world(...)` takes 0.9 ms a run and closing it 0.7 ms. With the first `info`, `delivered` and `admit`, setup and teardown are about 8% of the law. Sharing keys, programs or one runtime across runs would save at most 8%.
- **The walk is the other 92%:** 1,617 moves at about 17 ms each.

| Move | Count | Each |
|---|---|---|
| step | 539 | 21.7 ms |
| successor | 161 | 18.3 ms |
| cold open | 284 | 11.3 ms |
| alarm | 271 | 6.0 ms |
| warm open | 1,093 | 4.6 ms |

- **The biggest cost:** Process objects call `processStatus` on the Project 17,840 times, about 14 times per step. These calls come from `Runner.ts` `ensure` (line 744), and from `ended` in `setAlarm` (line 491) and `catchUp` (line 1099).
- **Each call refolds the whole process table from rev 0:** `ProcessManager.ts:140` calls `ProcessTable.read` in `Process.ts:453`. That fold alone is 21% of the CPU profile.
- **Telemetry** spans written to SQLite on every call are another 17%. That is the decided design.
- **Not costly:** program loading takes 135 ms in total. No alarm timer fired during the walk.

## The plan proposed two slices, and I did not approve either

1. **Slice 1, a product fix.** `ProcessManager.layer` keeps its last folded table and reuses it while each stream it read still ends with the same entry (compared with `Schema.toEquivalence(Entry)`). The plan adds two new laws: a long-lived manager answers the same as a fresh one, and a rolled-back turn leaves no stale table.
   - A prototype took the law from 28.5 s to 23.4 s and 25.0 s alone, and to 21.4 s in its file. The file went from 126 s to 116 s.
   - I did not approve it, for three reasons:
     - It caches a value derived from the log inside the process manager, with its own rule for when the cache is stale. That is a new product design call, not the law's existing intent.
     - This lane has no build step, and product code needs one.
     - Alone, it still leaves only about a 2.5x margin against 60 s, and CI ran this law over 2x slower than this container. So it would not end the flake.
2. **Slice 2, splitting the law.** The same 100 values go into four tests of 25 each. `fc.sample` on seed 119120 gives exactly the 100 values `fc.assert` draws; the plan agent checked this against fast-check 4.10.2. Each test passes its slice as `examples` with `numRuns: 0`, and a pinned law checks the four slices hold exactly those 100 values.
   - I did not approve it. The total work is the same, and the law gets four 60 s limits in place of one. In effect that raises the timeout, which the brief calls loosening. It does not make the law any faster.

## What I need: one of these

- **(a)** A yes to slice 1 as a product change, with a build step added to this lane. On its own it does not end the flake.
- **(b)** A ruling that splitting the 100 fixed-seed runs across four tests is not loosening. The plan agent's lean is that it is not, about 65% sure. Then the lane can land slice 2, with or without slice 1.
- **(c)** An owner design call on the main cost: the Runner asking the Project for its status about 14 times per letter. `Runner.ts:410` says the runner keeps no second copy of the lifecycle, so changing that is the owner's call.

My lean is (a), plus (c) as a ticket. That fixes a real cost a live Project also pays on every manager call, and it does not trade the 60 s budget away. I am about 70% sure the cache is safe. Its rollback law (plant P5 below) would settle that doubt.

## Times before (f583014, Node 26.13.0, `--maxWorkers=1`, 100 runs each)

- **Alone,** with `-t "T753 L16"`: 28,411 ms and 28,540 ms.
- **In its file:** 28,721 ms. The whole file took 126.3 s (12 tests).
- **After:** no times, because no fix was approved.

## Steps

- **Plan:** done by a fresh Opus agent. It passes `plancheck.sh --draft` (exit 0) and is unsigned. It is in this lane's own container, not in git; the essentials are above.
- **Lead:** did not approve the plan, for the reasons above.
- **Tests and review:** not started.

## Plants

The plan agent ran these against the law, with the slice 1 prototype in place. The law caught P1 to P4. None was rerun on main.

- **P1:** `SettingsRuntime.ts:35` set to `Duration.zero`. The costs check fails with 9 reads where 3 were expected.
- **P2:** an extra `settingsRead` at `SettingsStartsRemote.ts:50`. The check fails with 2 calls and 4 reads.
- **P3:** the new cache never notices a change. `delivered` comes back `failed` where `configured` was expected.
- **P4:** `runtime.ts:1434` drops `active = status.state.process`. The law fails on a run with a successor move.
- **P5:** a plant for the new rollback law only. It was not run.

## What ran, and what did not

- **What ran:** Node 26.13.0, pnpm 12.16.1, `pnpm install --frozen-lockfile`, the law run alone twice, its file once, and the plan agent's profiling.
- **What did not run:** format, lint, typecheck and the leak check, because there is no diff to check. No pull request description, because no pull request was made.

## Outside this lane

- In the same file, `ticket 402: P34 recovery on the Worker runtime > recovery writes and process calls keep typed failures and retry saved actions` took 69.5 s on this container, over the 60 s limit. It passed anyway, probably because its own limit is set higher. It risks the same CI flake, and slice 1's cache would likely speed it up too.
- I wrote no finding row, because the brief says to write no field row. It needs one.
