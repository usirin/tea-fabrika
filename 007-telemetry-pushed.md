REPORT: the telemetry fill is pushed: fabrikalfa/cloud-fill-telemetry at 5525f6193, after one fix round.

- **Branch:** `fabrikalfa/cloud-fill-telemetry` at `5525f6193139c4b2a1a340420c1cd613271e7f59`, made from `origin/main` at `48460bdaa`.
- **Commits:** `b93f980d4` (doc blocks for telemetry) and `5525f6193` (a fix to the `RecordPart.ts` module block). Both are authored "Claude" and have no trailers.
- **Blocks:** 1 module block (`RecordPart.ts`) and 3 export blocks (`recordPart`, `REFUSED`, `SinkError`). All three exports are re-exports, so each one-line `export { X } from "..."` became multi-line, with the block on the name inside the braces.
- **`RecordPart.ts` and your open question:** this file's first statement is an `export {`, not an import. So it carries two blocks above that statement: the module block, then a short one ("Re-export of `recordPart`, the one name this file offers") that the rule reads as the statement's own. This is the rule's current reading of your open B2.8 question. If your answer changes that reading, this file changes with it.
- **Checker, round 1:** send back, one block. The module block said "so a runner can open a part without the rest of that module". It was wrong twice: no Runner imports the file (its importers are `cloudflare/record.ts` and `telemetry/RecordPartTest.ts`), and a re-export still loads all of `Records.ts`.
- **Checker, round 2:** pass. 4 blocks are true and useful, 1 is true but empty (the second `RecordPart.ts` block, which is there for the rule), 0 are wrong.
- **Checks at the head:**
  - comments only: the `oxc-parser` trees are the same with positions and comments removed, and the `esbuild` output is the same with `minifyWhitespace`, for all 3 files; planted literals were detected;
  - rule at zero: 0 0 0 0;
  - `pnpm format` passed in 20 s and changed nothing;
  - `pnpm lint` passed in 130 s.
- **Could not check:** whether a docs generator or an editor shows a block written on a name inside `export { ... }` braces. Effect 4.1.2 writes blocks the same way.

## Description

docs: doc blocks for telemetry, so telemetry is at zero for the docs rule (B2 fill)

## What this does

All of it is in `next/`. Today's version is not touched.

- `telemetry/` now has no fire from `fabrika/jsdocs`, the docs rule of `docs/plan/effect-rules-big.md` section "B2". It had 4: three re-exports with no block (`recordPart` in `RecordPart.ts`, `REFUSED` in `Trace.ts`, `SinkError` in `Sink.ts`) and `RecordPart.ts` with no module block.
- Each re-export gets a block on its name, inside the braces of its `export { ... } from`, which is now multi-line. Effect writes blocks on re-exported names the same way.
- `RecordPart.ts` opens with that `export {`, not an import. So it gets a module block, then a short block that belongs to the statement, as the rule reads a file whose first statement is not an import.
- Comments only. No code, import, export or name changed.

## Why this change

A fill for the docs rule of `docs/plan/effect-rules-big.md`, section "B2". The rule is in its own pull request (ticket 913, slice B2.1). `telemetry/` joins the rule's folder list in `.oxlintrc.json` once B2.1 has merged.

## How it was made and checked

- **Measured:** `fabrika/jsdocs` from the B2.1 branch, run over all of libfabrika on `origin/main` at `48460bdaa` from a scratch copy. `telemetry/` had 4 fires.
- **Written** by one writer agent, then **read** by a separate checker agent against the code and its tests. The checker checked every place that builds `SinkError`, and every place that sets the tag `REFUSED` names. It sent one block back, the `RecordPart.ts` module block, which named the wrong importer and said a re-export loads less than it does. After that fix it passed.
- **Proof that only comments changed:** the `oxc-parser` trees with positions and comments removed, and the `esbuild` output with `minifyWhitespace`, are the same for all 3 changed files on `origin/main` and on this branch. The checker also showed its script detects a changed literal.
- **Checks at this head:** the rule reports 0 for `telemetry/`, and `pnpm format` and `pnpm lint` pass.

## Not in this pull request

- Adding `telemetry/` to the rule's list waits for B2.1 to merge.
- If the answer on files whose first statement is not an import changes the rule's reading, `RecordPart.ts`'s second block goes.
