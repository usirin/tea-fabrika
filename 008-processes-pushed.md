REPORT: the processes fill is pushed: fabrikalfa/cloud-fill-processes at 2328af3c7, after one fix round.

- **Branch:** `fabrikalfa/cloud-fill-processes` at `2328af3c7c80e9e2f525e36c23f9e6a194913a6b`, made from `origin/main` at `48460bdaa`.
- **Commits:** `203cf86e5` (doc blocks for processes) and `2328af3c7` (fixes to `Child` and `Start`). Both are authored "Claude" and have no trailers. Together they change 8 files: 256 lines added, 34 removed.
- **Blocks:** 34 export blocks added and 12 existing blocks reshaped. No module block was added; every file had one. The checker counted 41 changed blocks.
- **Re-export layout:** `Process.ts`'s one-line re-export of six names from `internal/processTable.ts` became multi-line, with a block on each name.
- **Text the writer widened to match the code:**
  - `ProcessHistory`'s `Unreachable`, `BadRow` and `Storage`;
  - `brainOnly`, which now names the `/dead` stream and the `dead` entry.
- **Checker, round 1:** send back, one block. `Child` in `Children.ts` opened "Schema for one start request", the same words as `Start`'s new block in `Process.ts`, though it is a different schema. One optional wording fix to `Start`'s `again` case was also taken.
- **Checker, round 2:** pass. 41 blocks: 40 true and useful, 0 empty, and the 1 wrong one fixed. The checker checked these against the code itself:
  - the six re-exports, against `internal/processTable.ts`;
  - `RunnerMail`;
  - `ProcessCalls` and `remoteProcessManager`;
  - `ProcessTable`;
  - `brainOnly`;
  - every place that builds `ProcessHistory`'s errors.
- **Checks at the head:**
  - comments only: the `oxc-parser` trees and the minified `esbuild` output are the same for all 8 files; planted literals were detected in 7 of 8, and the 8th, `ProcessHistory.ts`, has no lowercase string literal to plant in;
  - rule at zero: 0 0 0 0;
  - `pnpm format` passed in 18 s and changed nothing;
  - `pnpm lint` passed in 129 s.
- **Category notes from the checker, not changed:**
  - `tracing` is new to the library, the lowercase form of Effect's own `Tracing`.
  - `sameReason` is under `guards`, where Effect would use `instances`.
  - `signalId` is under `getters`, while its neighbor `noticeId` is under `constructors`.

## Description

docs: doc blocks for processes, so processes is at zero for the docs rule (B2 fill)

## What this does

All of it is in `next/`. Today's version is not touched.

- `processes/` now has no fire from `fabrika/jsdocs`, the docs rule of `docs/plan/effect-rules-big.md` section "B2". It had 40: 6 exports with no block and 34 blocks out of Effect's shape. Most of the 34 lacked `@stability` and `@category`, or the blank line before the tags.
- 34 exports get a block, and 12 existing blocks are reshaped. Where an old description said less than the code does, it now says what the code does:
  - `ProcessHistory`'s `Unreachable`, `BadRow` and `Storage`;
  - `brainOnly`, which now names the `/dead` stream and the `dead` entry.
- `Process.ts` re-exports six names from `internal/processTable.ts` (`Owner`, `ProcessEvent`, `Recipient`, `signalId`, `Start`, `State`). That re-export is now multi-line, with a block on each name. Effect writes blocks on re-exported names the same way.
- Comments only. No code, import, export or name changed.

## Why this change

A fill for the docs rule of `docs/plan/effect-rules-big.md`, section "B2". The rule is in its own pull request (ticket 913, slice B2.1). `processes/` joins the rule's folder list in `.oxlintrc.json` once B2.1 has merged.

## How it was made and checked

- **Measured:** `fabrika/jsdocs` from the B2.1 branch, run over all of libfabrika on `origin/main` at `48460bdaa` from a scratch copy. `processes/` had 40 fires.
- **Written** by one writer agent, then **read** by a separate checker agent against the code and its tests. The checker checked:
  - the six re-exports, against `internal/processTable.ts`;
  - `RunnerMail`, against `Mailbox.send` and `Runner.ts`;
  - `ProcessManager`'s and `ProcessTable`'s blocks, against their bodies;
  - every place that builds `ProcessHistory`'s errors.

  It sent one block back (`Child`, whose first sentence was the same as `Start`'s, though the two are different schemas). After that fix it passed.
- **Proof that only comments changed:** the `oxc-parser` trees with positions and comments removed, and the `esbuild` output with `minifyWhitespace`, are the same for all 8 changed files on `origin/main` and on this branch. The checker also showed its script detects a changed literal.
- **Checks at this head:** the rule reports 0 for `processes/`, and `pnpm format` and `pnpm lint` pass.

## Not in this pull request

Adding `processes/` to the rule's list waits for B2.1 to merge.
