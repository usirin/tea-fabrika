---
date: "2026-11-11"
summary: "`next/`, 0093's second check, on ticket 707's waiting machine (`waiting.ts`, 185 lines, 144 mutants, all sampled at seed 119120). Yes, as many, not more. A file written from the plan alone, before any mutation result and without opening `waiting.test.ts`, killed 98 of 144 in the skill's container, the same 98 as the old file, mutant for mutant (13 survived, 33 static ignored, both). A final version with a longer walk (`minLength: 10`, `size: 60`) and type fixes (the first version failed `pnpm typecheck`) killed 99: `waiting.ts:172`, a leave from a row with other clients copying that row over all rows, which neither first walk reached (0 of 580 steps). The other 12 survivors are empty-case guards, equivalent by reading. Six of the plan's plants failed their laws once and were not kept; the type, gateway and lint plants were not run here. 0093's trial ends by its own rule. Tokens not visible, dollars not measured. About 75% sure: one small file, both files already walk, static mutants unmeasured."
---

# 257. Does a law file written from the plan alone, blind to the old tests, kill as many mutants as the old one?

Measured on 2026-11-11, on main at `bbb13727b`, in a worktree on the branch
`fabrikalfa/exp-second-check`. **Every claim is about `next/`**
(`next/packages/libfabrika/src/gateway/internal/waiting.ts`), never today's version. This is the
second check that [0093](../.decisions/0093-laws-walk-plants-run-once.md) asks for. One agent read
the plan, wrote the laws and ran the mutants. No paid model was called beyond that agent.

**The answer: yes, as many, not more.** The new file, written before any mutation result, killed
98 of the file's 144 mutants. The old file killed the same 98: the same mutants, one by one. A
final version, with a longer walk and type fixes made after the first result, killed 99. By 0093's own
rule ("at least as many"), the trial ends and the rule stays.

```ts
// A sketch, cut from the new file. The whole idea: one walk through the real machine. Each draw is read against the Model reached
// so far: a knock picks a waiting key or a fresh one, a leave picks a client that is in the row or
// a stranger, a time lands one before, at or after a row's deadline.
const knock = (s: Model, clock: number, d: Draw): Knock => {
  const held = rowsIn(s);
  const key = held.length > 0 && d.move % 2 === 0 ? at(held, d.pick).key : at(KEYS, d.other);
  return { type: "knock", key, client: at(CLIENTS, d.other + d.word), at: timeFrom(s, clock, d) /* and new label, code, pass */ };
};

// Each law reads one step against the step before, never against the machine's own code.
expect(rowsIn(after)).toEqual(live(before, msg.at)); // expiry keeps exactly `until > at`
```

## Why this file

The check needs a `next/` file on main, with a law file beside it and an approved plan with a Laws
table. Ticket 707 fits: its plan was approved, and its pull request (885) merged
`waiting.ts` and `waiting.test.ts`. The file is 185 lines of one tea machine (a Model, four Msgs, a
saved-value codec), with no input or output, so a mutant run is cheap. It is not P14's window
machine, which experiment 256 used. Other candidates fell out: the dev-life machine of ticket 708
is not on main, and the Ledger extraction of ticket 702 is a service, not a machine.

## Did the writer stay blind?

Yes. The writer read the product file, the plan's Laws table and transitions, and one other
machine's law file (`telemetry/internal/sink.test.ts`) for the house style. It listed the folder,
so it knew the old file's name, but it did not open `waiting.test.ts` until both mutant runs had
ended. One leak is in the plan itself: its Laws section names the five older properties
("stable codes across tabs, expiry boundaries, oldest-first eviction, distinct client counts,
positive cap validation"). That is plan text, so the rule allows it.

## Today's setup

- **Sample.** The mutation skill's own scripts, unchanged: `mutbox.ts` in its container (no
  network), `run.sh`, `sample.ts` at seed 119120 with its cap of 150, and `limit.ts`. To make the
  sample cover the whole file, the build commit is main plus the new law file, and its parent is
  main with `waiting.ts` removed. Then `build^..build` holds every line of `waiting.ts`. The file
  has only **144 mutants, so the sample is all of them**, not 150. Both runs used the same build
  commit, so the same 144.
- **Run A:** `--related` names only `waiting.test.ts` (468 lines, 11 tests). **Run B:** only the new
  `waiting.second-check.test.ts` (388 lines, 10 tests). Same limits, the skill's own: `ignoreStatic:
  true`, `timeoutMS` 5000, concurrency 1, the five-minute cap, the test limit from each arm's plain
  run.
- **What is not in either run.** The app's `door.test.ts` and `GatewayRevocation.test.ts` also reach
  `waiting.ts` through the gateway. They are not the file beside it, so neither run names them.

| | Run A, old file | Run B, new file, first version | Run B3, new file, final |
|---|---|---|---|
| Lines | 468 | 388 | 388 |
| Tests | 11 (all properties) | 10 (all properties) | 10 (all properties) |
| Plain run in the box | 1.17 s | 0.21 s | 1.01 s |
| Stryker time | 47 s | 29 s | 48 s |
| Killed | 98 | 98 | 99 |
| Survived | 13 | 13 | 12 |
| Ignored (static) | 33 | 33 | 33 |
| No coverage, timeout | 0, 0 | 0, 0 | 0, 0 |

Both files import `waiting.ts` at the top, so the 33 module-level mutants (the schemas) are static
for both and ignored for both. Experiment 256's trap, an `await import()` that turns static
mutants into false survivors, does not apply here.

## What only one side kills

**Against the first version: nothing.** A and B have the same 13 survivors, mutant for mutant.

**Against the final version: one, for the new file.** `waiting.ts:172`, `r === row` to `true` in
`leave`: when a client leaves a row that keeps other clients, every row becomes a copy of that
row. Both old and new laws would catch it (one row per key; a leave changes only its own row). But
neither walk reached a leave of a real client from a row with two or more clients while another
row waited. The new file's first walk was short: Effect's `Arbitrary.array` with `minLength: 1`
starts at a small size, so 200 runs made only 580 steps, 0 of them that case. The final version
sets `minLength: 10` and the property's `size: 60`: 3,944 steps, 3 of them that case, and the
mutant dies. The old file walks with `size: "max"` and still misses it; its walk does not reach
that case either. A hand plant of this mutant passed both the old file and the first version, and
failed the final one.

**The 12 that live in both** are equivalent by reading: the `_tag === "empty"` guards at lines 114,
136, 160 and 177 (made `false`, `""` or an empty block), and `live._tag === "waiting"` at 138 made
`true`. Each guarded path gives the same Model either way, since filtering or searching an empty
row list gives an empty result. They were read, not each run in a fresh process, so the mutation
skill would call them unconfirmed until hand-planted.

**No miss of B's is a plan gap.** The plan's leave
law covers line 172. The miss was the walk's reach, not a missing law.

## The plants, run once each

Each plan plant was put into `waiting.ts`, the new file run once, and the plant undone. None was
kept. The new file failed on all six it could run:

| Plant (from the plan) | Laws that failed |
|---|---|
| A repeat knock replaces the row's code | the knock law |
| Expiry keeps rows at equality (`>=`) | the knock law, the expiry law |
| Overflow keeps the oldest rows | the knock law |
| The first leave removes the whole row | the leave law |
| Acceptance clears every row | the acceptance law |
| Decoding resets `until` | the save and reload law, the reopen law |

A seventh plant, written for the final version's cap law, let `init` take a cap of 0; the cap law
failed.

Not run: the type plant (an empty client list must not typecheck), since it needs a second full
typecheck on a laptop that allows one at a time; the file holds that law as `@ts-expect-error`
lines, which the one typecheck at the end did check. The gateway plant (no `accepted` after a
grant) and the lint plant (a `why` field) belong to `door.test.ts` and the lint rules, not to a file
beside `waiting.ts`.

## What this tells us

- A writer with only the plan matched the old file exactly on this file's mutants, on its first
  try. 0093's doubt "the rewriter had read the old file" does not change the result here.
- The plan did most of the work. Its Laws table already said "resolve each seed against the folded
  state", and the old file already walks: its generator reads the folded state too. So this check
  compares two walking files, not a walking file against hand lists, as experiment 256 did.
- **Walk length is the weak spot, not the laws.** The one mutant either side missed needs a deeper
  walk. Effect's `Arbitrary.array` grows with `size`, so a walk that sets no `minLength` and no
  size is short. A writer should set both, and count how often each law's case comes up.
- Small and pure machines leave little room: 99 of 111 tested mutants die with either file, and
  the other 12 look equivalent.

## What it cannot tell us

- **One file, and a small one.** 144 mutants, no hand lists on either side. A file where the old
  laws were hand-built lists, like P14's, could still show a gap this one cannot.
- **Static mutants are not measured.** With the skill's `ignoreStatic: true`, the 33 schema
  mutants count for neither file. The new file decodes every Msg and Model strictly and refuses
  bad fields; whether that kills schema mutants the old file misses is unknown here.
- **The final version is not blind to the result.** After the first run it got a longer walk (two
  lines), and after `pnpm typecheck` it got five type fixes: the first version passed vitest and
  lint but failed the typecheck (tea types a machine's schemas as `Schema.Schema`, and Effect's
  `it.prop` takes no `examples`). An in-between run with only the walk change (B2) also killed 99.
  The first version is the clean comparison.
- **The gateway laws were not written.** The plan's gateway row is `door.test.ts`'s job, so a writer
  of the whole plan might do better or worse there.
- **One writer.** Another fresh agent could miss what this one caught.

## Cost

The agent's own tokens are not visible to it, so its dollars could not be measured. No other model
was called. Docker: four mutant runs, one at a time: 77 s and 45 s of wall time for A and B, and Stryker
times of 52 s and 48 s for B2 and B3.

## Does 0093's trial end?

Yes, by its own rule: the new file killed at least as many as the old one (98 against 98, and 99 in
the final version). Nothing here would reverse it.

## Where things are

None of it is on main (0027). The new law file,
`next/packages/libfabrika/src/gateway/internal/waiting.second-check.test.ts`, is in the worktree of
the branch `fabrikalfa/exp-second-check`. The Stryker reports, the sample, the plant log and the
first version of the file are raw results under `runs/second-check/`, for the owner's private
archive. Every number this write-up uses is quoted above.
