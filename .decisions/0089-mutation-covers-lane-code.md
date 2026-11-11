---
id: 0089
title: The hourly mutation run also tests the lead tooling's lane code (chain.ts, drive.ts and the flow runner), and no other lead tooling
status: accepted
date: 2026-11-10
tags: [mutation, schedule, lead-tooling, chain, drive, flow, trial]
---

# 0089: The hourly mutation run also tests the lead tooling's lane code (chain.ts, drive.ts and the flow runner), and no other lead tooling

**What this decides:** of the code under `.agents/`, the hourly mutation run tests only the code
that runs lanes: the chain script, the drive script and the flow runner.

## Context

[0066](0066-mutation-runs-on-a-schedule.md) made mutation one run an hour on the changed lines of
what merged to main, and [0067](0067-hourly-mutation-runs-in-ci.md) moved that run to GitHub CI.
Neither says whether lead tooling under `.agents/` is part of it. Lead tooling is fast-tracked: it
skips the plan, tests and review steps ([AGENTS.md](../AGENTS.md#two-versions-side-by-side),
2026-11-09), and [0033](0033-agents-code-follows-next-rules.md) holds its code to `next/`'s lint
rules. [0007](0007-drive-is-the-pipeline-lab.md) makes `drive.ts` the lab that `next/`'s pipeline
is rethought from.

Today the run's file pick has no path rule. `sample.ts`'s `PRODUCT` list and the `range` step in
`.github/workflows/mutation.yaml` take every changed `.ts` or `.js` file with a test beside it,
so any lead script can be mutated, and nothing says which ones should be.

This amends 0066 in part: what "what merged" covers under `.agents/`. The rest of 0066 holds, as
amended by 0067 and [0077](0077-mutation-gaps-carry-a-category.md). 0067 and 0077 are unchanged.
0007 and 0033 are unchanged: lane code stays fast-tracked.

## Decision

**The hourly mutation run tests the lead tooling's code that runs lanes, and nothing else of the
lead tooling.**

- In scope, with the tests beside them as the run's tests:

  | Code | Its tests |
  |---|---|
  | `.agents/skills/lead/scripts/chain.ts` | `.agents/skills/lead/scripts/chain.test.ts` |
  | `.agents/skills/lead/scripts/drive.ts` | `.agents/skills/lead/scripts/drive.test.ts` |
  | the flow runner, `.agents/skills/lead/scripts/flow/**/*.ts` | `.agents/skills/lead/scripts/flow/**/*.test.ts` |

- Out of scope: shell helpers, skill prose, and every other lead script, such as `mutbox.ts`,
  `gc.ts`, `lane.ts`, `agents.ts` and the mutation skill's own `sample.ts`.
- A gap in lane code is filed like any other gap: one ticket per file, with its category, as 0066
  and 0077 say.
- Why: the pipeline is the product. This code is the pipeline we run every day and what `next/`'s
  pipeline grows from, so a gap found now carries over. A failure there hangs lanes.

**Binding constraints:**

- Lane code stays fast-tracked: no plan, tests or review steps, and a merge never waits on a
  mutation result (0066, 0007, 0033).
- The run still changes nothing in the repo.

## Consequences

- More gap tickets from the hourly run, on code that changes fast. Its tests may be too thin to give
  useful gaps at first; the trial's read around 2026-11-17 counts them apart from product gaps.
- The run's file pick must change to match: today it takes any changed lead script that has a test
  beside it. That change to `sample.ts` and `mutation.yaml` is a follow-up ticket; this file
  changes no code or config.
- The flow runner is not on main yet (open [PR 814](https://github.com/usirin/tea-fabrika/pull/814),
  under `.agents/skills/lead/scripts/flow/`). It joins the scope when it lands. On main, vitest's
  include for lead tests is `.agents/skills/*/scripts/*.test.ts`, one folder deep, so its tests must
  be in the include before the run can use them.
- Not decided here: whether lane code leaves the fast track (it does not), lint or types for shell
  helpers, and whether `lane.ts` and `agents.ts`, which `chain.ts` and `drive.ts` import, join
  later.
