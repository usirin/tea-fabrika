REPORT: the runtime fill is pushed: fabrikalfa/cloud-fill-runtime at 2c4779ee3, after the bounded round you allowed.

- **Branch:** `fabrikalfa/cloud-fill-runtime` at `2c4779ee35b920a0425bbbd5384416f50343b69f`, made from `origin/main` at `48460bdaa`.
- **Commits:** all are authored "Claude" and have no trailers. Together they change 20 files: 565 lines added, 102 removed.
  - `a01e2b75f`: doc blocks for runtime.
  - `7028ee7f4`: round 1's fixes.
  - `2c4779ee3`: the 8 type twins keep `models`.
- **Blocks:**
  - Added: 2 module blocks (`Audit.ts`, and `Client.ts`, whose `//` header it replaces, with plan codes dropped and 0046 kept) and 4 export blocks (`TileProps`, the `WatcherManager` re-export, and the `defaultPolicy` and `Supervision` re-exports).
  - Reshaped: 77 blocks, plus tag blocks for the `Admission` and `Prepared` types.
  - Also: "as before" was removed from the `Life` comment, since the pattern forbids history.
- **Round 1:** send back.
  - 7 blocks were untrue: `Audit.ts`'s module block, `defaultPolicy`, `StartRefusal`, `resolveName`, `WatchersSql.layer`, `WatcherManager` and `ChaosMachine.refuse`.
  - 15 Schema values were tagged `models` rather than `schemas`.
  - One paragraph needed rewrapping.
  - All fixed, plus `ChaosMachine.wake` and `Audit.failure`/`restore` tagged `constructors`.
- **Round 2:** send back. 8 type twins had been moved to `schemas` on my own wrong instruction. The lane stopped, and I mailed you in 009.
- **Bounded round (yours):** only those 8 tags went back to `models`. The checker confirmed the diff is exactly those 8 lines: pass.
- **Truth, over about 85 blocks read:** about 75 true and useful, 3 true but empty, and the 7 wrong ones fixed.
- **Checks at the head:**
  - comments only: the `oxc-parser` trees and the minified `esbuild` output are the same for all 20 files; a planted literal was detected;
  - rule at zero: 0 0 0 0;
  - `pnpm format` passed in 19 s and changed nothing;
  - `pnpm lint` passed in 136 s.
- **Possible code gap, for you to file:** `start_child` does not declare `bad_cmd`, but the runner answers a malformed start with it (`Runner.ts:1482`, `:1499`).

## Description

docs: doc blocks for runtime, so runtime is at zero for the docs rule (B2 fill)

## What this does

All of it is in `next/`. Today's version is not touched.

- `runtime/` now has no fire from `fabrika/jsdocs`, the docs rule of `docs/plan/effect-rules-big.md` section "B2". It had 83: 4 exports with no block, 77 blocks out of Effect's shape (most lacked `@stability` and `@category`), and 2 files with no module block.
- 2 module blocks and 4 export blocks are added, and 77 blocks are reshaped. Where an old description said less or more than the code does, it now says what the code does:
  - `Audit.ts`'s module block: the errors keep a redacted cause in memory, and `Answer` has no field for it;
  - `defaultPolicy`: the wiring's policy wins over it, and it gives the delivery limit only when the wiring leaves one out;
  - `StartRefusal`: a malformed start is answered `bad_cmd`, which is not one of its reasons;
  - `resolveName`: its `by` is a test of the writer, not a writer;
  - `WatchersSql.layer`: each transaction ends before the next delivery;
  - `WatcherManager`: names `Gone` and `Unreachable`;
  - `ChaosMachine.refuse` and `wake`: name every phase.
- `Client.ts`'s `//` header becomes its module block, with every fact kept except plan codes.
- Schema values are tagged `schemas` and their type twins `models`, as the rest of libfabrika does.
- The re-exports of `defaultPolicy`, `Supervision` and `WatcherManager` are now multi-line, with a block on each name. Effect writes blocks on re-exported names the same way.
- Comments only. No code, import, export or name changed.

## Why this change

A fill for the docs rule of `docs/plan/effect-rules-big.md`, section "B2". The rule is in its own pull request (ticket 913, slice B2.1). `runtime/` joins the rule's folder list in `.oxlintrc.json` once B2.1 has merged.

## How it was made and checked

- **Measured:** `fabrika/jsdocs` from the B2.1 branch, run over all of libfabrika on `origin/main` at `48460bdaa` from a scratch copy. `runtime/` had 83 fires.
- **Written** by one writer agent, then **read** by a separate checker agent against the code and its tests, including `internal/supervisor.ts`, `Runner.ts`, `Execution.ts`, `node/build/build.ts` and every place that builds `BuildError` and `ProgramDown`.
  - Round 1 sent 7 untrue blocks back, plus 15 Schema values tagged `models`.
  - Round 2 sent back 8 type twins that the fix had wrongly moved to `schemas`. That came from the lead's instruction, not the writer.
  - After one bounded round on those 8 tags, it passed.
- **Proof that only comments changed:** the `oxc-parser` trees with positions and comments removed, and the `esbuild` output with `minifyWhitespace`, are the same for all 20 changed files on `origin/main` and on this branch. The checker also showed its script detects a changed literal.
- **Checks at this head:** the rule reports 0 for `runtime/`, and `pnpm format` and `pnpm lint` pass.

## Not in this pull request

- Adding `runtime/` to the rule's list waits for B2.1 to merge.
- Found and left: `start_child` does not declare `bad_cmd` among its errors, though the runner answers a malformed start with it (`Runner.ts:1482`, `:1499`).
