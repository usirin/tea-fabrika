REPORT: the ledger fill is pushed: fabrikalfa/cloud-fill-ledger at 576213588, one block, checker pass on the first read.

- **Branch:** `fabrikalfa/cloud-fill-ledger` at `576213588aff17ae7e5d0ee77c970ec4b6e8e7dd`, made from `origin/main` at `48460bdaa`.
- **Commit:** `docs: doc blocks for ledger (B2 fill)`. It is authored "Claude" and has no trailers.
- **Blocks:** 1 export block added, on the re-export `InputId` in `ledger/Log.ts`. No module block was added and no block was reshaped.
- **Re-export layout:** `fabrika/jsdocs` reads a re-export's block from above the name inside the braces, so the one-line `export { InputId } from "../Id.ts"` became multi-line, with the block inside. The checker found that effect 4.1.2 writes blocks the same way: `schema/Model.ts:80-135`, `sql/SqlSchema.ts:104`, `Order.ts:715`, `Array.ts:10546`. `pnpm format` kept it as it is.
- **Checker:** pass, first round. 1 block read, true and useful. It noted that the block's "why" clause ("so a writer of the log can name a line's `parent` without a second import") is a reasonable reading that `Log.test.ts` supports but no commit states.
- **Checks:**
  - comments only: the `oxc-parser` trees are the same with positions and comments removed, the `esbuild` output is the same with `minifyWhitespace`, and a planted literal was detected;
  - rule at zero: the count is 0 0 0 0;
  - `pnpm format` passed in 19 s and changed nothing;
  - `pnpm lint` passed in 129 s.

## Description

docs: doc block for ledger's InputId re-export, so ledger is at zero for the docs rule (B2 fill)

## What this does

All of it is in `next/`. Today's version is not touched.

- `ledger/` now has no fire from `fabrika/jsdocs`, the docs rule of `docs/plan/effect-rules-big.md` section "B2". It had one: the re-export `InputId` in `ledger/Log.ts` had no doc block.
- The fix is one block on that name, inside the braces of `export { InputId } from "../Id.ts"`, which is now multi-line. Effect writes blocks on re-exported names the same way.
- Comments only. No code, import, export or name changed.

## Why this change

A fill for the docs rule of `docs/plan/effect-rules-big.md`, section "B2". The rule is in its own pull request (ticket 913, slice B2.1). `ledger/` joins the rule's folder list in `.oxlintrc.json` once B2.1 has merged.

## How it was made and checked

- **Measured:** `fabrika/jsdocs` from the B2.1 branch, run over all of libfabrika on `origin/main` at `48460bdaa` from a scratch copy. `ledger/` had 1 fire.
- **Written** by one writer agent, then **read** by a separate checker agent against `Id.ts`, `Rev.ts` and `Log.test.ts`. The checker found it true and useful: pass.
- **Proof that only comments changed:** the `oxc-parser` trees with positions and comments removed, and the `esbuild` output with `minifyWhitespace`, are the same for `ledger/Log.ts` on `origin/main` and on this branch. The checker also showed its script detects a changed literal.
- **Checks at this head:** the rule reports 0 for `ledger/`, and `pnpm format` and `pnpm lint` pass.

## Not in this pull request

Adding `ledger/` to the rule's list waits for B2.1 to merge.
