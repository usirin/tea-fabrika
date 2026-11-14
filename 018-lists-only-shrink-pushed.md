REPORT: Cloud lane lists only shrink pushed dc6449b to fabrikalfa/no-waiver-s1, review done in one round with no findings; relayed from its transcript.

- **Since then:** the branch on origin has moved on. It is at `cf1193ae0` now, with your two `T933` commits on top of the child's `dc6449b`.
- **The open points:** what the child says is still open is its pull request text below, and whether the CI fetch of a missing base commit works. That code runs only in CI's shallow checkout.

## The child's report

REPORT: lane nowaiver-s1 (ticket 933, slice 1) is pushed, review done in one round with no findings. Head dc6449b42f42a9e2044c336a34bbe3ba8e9c6415 on fabrikalfa/no-waiver-s1, draft PR https://github.com/kamp-us/tea-fabrika/pull/1201 (not edited, not marked ready).

New commit this session: dc6449b42f42a9e2044c336a34bbe3ba8e9c6415 "T933 lead: field rows for the review, the lead's checks and the plan's two findings" (plain commit, no trailers). Pushed fast-forward from 1e7256c, no force. Leak grep clean on the diff and on all 5 commits since origin/main (no private word list here, so built-in shapes only).

Merge of main: nothing to do. The branch already held a merge commit, 1e7256c7bdf1f6d3389f51afe7d53497a0871a97, made before this session with origin/main 60a795c567bd24aac293dbe9ffd279b4bd4149df (decision 0524's PR, #1197). main had not moved since, so I made no new merge. The diff against main touches 9 files: ratchet.ts, ratchet.test.ts, node-kinds.test.ts, commits.test.ts, check.yaml, workflow-lint.ts, workflow-lint.test.ts, exam-paths.json and .glossary/TERMS.md, plus my 4 field rows.

Tests and typecheck (Node 26.13.0, pnpm 12.16.1):
- ratchet.test.ts at 1e7256c: 8 passed in 4 s.
- pnpm typecheck at 1e7256c: green in 40 s.
- pnpm format at the end changed nothing. pnpm lint: green in 1 min 41 s.
- Narrow tests at the end (ratchet, node-kinds, commits and workflow-lint test files): 220 passed in 51 s.
- The script on this repo against origin/main: all three lists "done", exit 0.
- field-check.ts on the 4 new rows: passes. It gives warnings only (ticket and pr written as bare numbers, as older rows are).

Review: one fresh Opus reviewer with the review skill, on head 1e7256c. Answer: done, merge-ready, 0 findings, 1 round, no send-back.
- The type fix at ratchet.ts:209 (e65076b) is correct. effect 4.1.2's Teardown type is generic, so the code checks that the exit value is a number, as commits.ts:1044 does.
- The reviewer's planted break of that teardown turned two L4 tests red. Its plants for L1, L2 and L6 went red too, and the L7 plants are covered by the existing tests.
- It ran the 4 test files (220 passed) and the script on the real repo. An unknown sha makes the script try the fetch, then exit 2.

loosening.sh <merge-base 60a795c> HEAD, full output (exit 1):
.github/ci/workflow-lint.test.ts: unrecognized change: line 36
.github/ci/workflow-lint.ts: unrecognized change: line 70
.github/workflows/check.yaml: unrecognized change: line 142
exam-paths.json: unrecognized change: line 76
next/apps/fabrika/src/exam/commits.test.ts: unrecognized change: line 390
My hand read: the diff against main removes no line in any file (checked with grep for removed lines).
- workflow-lint.test.ts: adds a ratchet constant, one step at index 3 of the generated valid wiring (after the step indexes the older plants use), six L7 plants and two L7 tests. No older law changed.
- workflow-lint.ts: adds the RATCHET constant and one require rule. No older rule changed.
- check.yaml: adds the step.
- exam-paths.json: adds three rows.
- commits.test.ts: adds four paths to the exam path scenario and three rows to the bytes snapshot.
None of these loosens anything, so none needs the owner's read.

Field rows written with fieldfile.ts:
- field/findings/2026-11-13-commits-header-says-ci-decides.json (the plan's row; pr set to "1201")
- field/findings/2026-11-13-exam-paths-lists-one-glob-three-times.json (the plan's row; pr set to "1201"; its line 92 is now 95 after this PR's three rows, and the row keeps its location as found, line 43)
- field/runs/2026-11-14-nowaiver-s1-review1.json
- field/runs/2026-11-14-nowaiver-s1-lead1.json (its time window is approximate)
In all four rows, "model" is null. This session's rules forbid model identifiers in pushed files, so I replaced the plan's "claude-opus-5-5" on the two finding rows. No dollar figures were reported for any run.

Not run, and left for you or CI:
- The shallow-checkout fetch path runs only in CI. Read this PR's "lists only shrink" step log.
- I did not edit or ready PR 1201. Its body still says "The steps are running", so it needs the description below sent with gh api -X PATCH.
Outside work noticed: none beyond the two plan findings.

## Description
