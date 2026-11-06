# Kept branches, 2026-11-05

24 worktrees held commits that were only on one laptop: their pull request was never opened, or
was closed. They point at 23 heads (two worktrees shared one head). Each head is now on GitHub as
`keep/<name>`, so the worktrees can go. Each was read against main and sorted:

- **already recorded:** its change or finding is on main, at the place named.
- **recorded now:** its finding was not on main, and this pull request adds it.
- **dropped:** nothing in it is left to learn.

All 23 passed the leak grep, so none was held back. Counts: 21 already recorded, 2 recorded now,
0 dropped. Every head is today's version; none touches `next/`.

| Head | Branch | Verdict | Where | Why |
|---|---|---|---|---|
| `0b1e49d6` | `keep/popover-principles` | already recorded | `docs/direction/popovers.md` | Landed fuller in pull request 210. |
| `190325c7` | `keep/no-do-inputs-wt` | already recorded | `programs/trace`, `programs/map`, `programs/tracker` | The same files landed in pull requests 164 and 205. |
| `1d98a93e` | `keep/faster-lane-tests` | recorded now | `docs/plan/pipeline-self-fix.md`, "Also tried, not merged" | A lane that hears an answer on the doorbell, not the 1 s look, and `pollMs` for GitHub waits. Never opened. |
| `27bec633` | `keep/detached-27bec633` | already recorded | `programs/map/src/selection.laws.test.ts` | Ticket 117's rule change landed in pull request 313; this head only formats it. |
| `281914ab` | `keep/exp-effect-on-cloudflare` | already recorded | `experiments/174-effect-on-cloudflare.md` | Landed fuller in pull request 321. |
| `2b241306` | `keep/detached-2b241306` | already recorded | `apps/fabrika/src/window/frame.ts` | The window frame landed in pull request 199. |
| `f9f65d86` | `keep/detached-f9f65d86` | already recorded | `apps/fabrika/src/window/frame.ts` | An earlier step of the head above. |
| `32940be8` | `keep/detached-32940be8` | already recorded | `experiments/178-lane-rehearsal.md` | Two worktrees. Landed fuller in pull request 267, with the fresh review and the CI failure. |
| `40085a4a` | `keep/every-layer` | already recorded | `docs/direction/every-update-builds-every-layer.md` | Pull request closed; the note landed, updated, in pull request 269. |
| `417d3a8c` | `keep/exp169-port` | already recorded | `experiments/169-agents-are-programs.md` | The write-up and lessons landed in pull request 303, which closed the code on purpose. |
| `6a4dd9fb` | `keep/exp-169-agents-are-programs` | already recorded | `experiments/169-agents-are-programs.md` | Pull request closed, same as the row above. |
| `482913ca` | `keep/review-192` | already recorded | `experiments/169-agents-are-programs.md` | The head above with main merged in. Its host test fix is on main too. |
| `486ff965` | `keep/exp-guided-answers` | recorded now | `experiments/121-ship-on-tea-pbt.md`, "Also tried, not merged" | Where a guided answer gets chosen, for demlik 745 and 749. Its number, 174, went to another experiment. |
| `4b50f2e2` | `keep/self-fix-guidelines-rev` | already recorded | `docs/plan/pipeline-self-fix.md`, `docs/direction/jidoka-and-andon.md` | Landed in pull request 289, and has grown since. |
| `5c324c6d` | `keep/detached-5c324c6d` | already recorded | `docs/direction/oxlint-and-oxfmt.md` | Landed fuller in pull request 226. |
| `63c119e4` | `keep/detached-63c119e4` | already recorded | `apps/fabrika/src/desk/layout/line.ts` | Landed in pull requests 181 and 182. |
| `91c73db1` | `keep/try-meta-gray` | already recorded | `experiments/196-ask-desk.md`, `docs/direction/color-principles.md` | A third text gray, tried and kept as a wrong guess: it fails contrast. |
| `9b7c20f1` | `keep/work` | already recorded | `packages/fabrika/src/host/door.ts` | The door and its Keys service landed fuller in pull request 92. |
| `9ccece84` | `keep/code-graph-gates-redo` | already recorded | `docs/direction/sweep-the-core-rebuild-the-pipeline.md` | Dead exports only advised, on code-graph 0.11.0. Replaced by blocking on 0.12.0 in pull request 44; the note keeps both counts. |
| `a405e937` | `keep/detached-a405e937` | already recorded | `.fabrika/fabrika.toml`, `docs/direction/one-fabrika-toml-per-repo.md` | Landed fuller in pull request 260. |
| `b98ccd63` | `keep/type-roles` | already recorded | `docs/direction/typography.md` | The text roles on the ask card, a tracker row and the ticket heading, decided with experiment 200. |
| `c84e26fc` | `keep/detached-c84e26fc` | already recorded | `packages/fabrika/src/host/job-rules.ts`, `experiments/166-step-size.ts` | The JobRecord landed in pull request 171. |
| `ea0a316f` | `keep/effect-4.1.1` | already recorded | `pnpm-workspace.yaml` | Effect 4.1.1 landed in pull request 258. |
