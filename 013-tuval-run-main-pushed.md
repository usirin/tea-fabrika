REPORT: Tuval run main is pushed: fabrikalfa/cloud-tuval-run-main at 0d25ef464, review pass, type check green.

- **Branch:** `fabrikalfa/cloud-tuval-run-main` at `0d25ef46448170c19c6f6be351a04afe31595e32`, made from `origin/main` at `7ae7cea0f`. The reviewer found the branch merges with newer main (two decision-only commits) with no conflict.
- **Commits:** none is squashed, all are authored "Claude", and none has trailers.
  - `8b51621d4`, tests: laws L2 to L4 and the catalog pin.
  - `c27fa8a8e`, build.
  - `4973ae331`, tests: L11 rewritten for runMain.
  - `682ac7cf0`, lead: the lockfile.
  - `0d25ef464`, tests: L11 type-checks.
- **Steps:** each was done by its own Opus agent.
  - **Plan:** approved by me, since it builds only 0250 and the "Platform pieces" sketch. It had no open questions.
  - **Tests:** done.
  - **Build:** found a plan gap. The existing law L11 in `next/apps/fabrika/src/build.test.ts` required a literal `Effect.runFork`. It went to the tests step, which rewrote it to be stricter.
  - **Review:** pass, with one finding (below).
  - **Type fix:** my type check then failed on three TS2345 errors in the new L11. The tests step widened one parameter type, with no cast and no change to what the law checks. The same reviewer rechecked it: pass.
- **Times:**
  - `pnpm typecheck`: 39 s red, then 58 s green, exit 0.
  - `pnpm lint`: 142 s, exit 0.
  - The whole job took about 4,700 s.
- **Leak check:** the diff is clean, and all 5 commits are clean. The private word list is missing here, so only the built-in shapes were checked.
- **Loosening check:** `loosening.sh $(git merge-base origin/main HEAD) HEAD` exits 1. My hand read of each hit:
  - `build.test.ts: removed law: format: the page entry starts its sole Effect run outside React at module scope`. Not loosening: it is renamed and stricter. The mapping row: Removed "format: the page entry starts its sole Effect run outside React at module scope", Replacement "format: the page entry starts its one Effect program through runMain, once, outside React at module scope, and calls no Effect.run*". The old law asked for one module-level `Effect.runFork`. The new one asks for an unaliased `runMain` import from `@kampus/tuval/browser`, exactly one module-level start, exactly two `runMain` words, and no `run[A-Z]*` word at all. Six plants were red: `runFork` back, a second start, a start in a function, a start in a component, `runPromise` beside it, and `page.pipe(Effect.runFork)`.
  - `build.test.ts: unrecognized change: line 27`. The same rewrite: it is that law's new title line.
  - `pnpm-lock.yaml: unrecognized change: line 191`. The new package `@effect/platform-browser@4.1.2`, and only that, in the catalog, the tuval importer, and the package and snapshot entries.
  - `pnpm-workspace.yaml: unrecognized change: line 33`. The new catalog line `'@effect/platform-browser': 4.1.2`.
- **Findings for you to file:**
  1. From the review: the tests step changed an existing law, which breaks `docs/plan/tier-1.md:642` ("does not move a test, change one, delete one"). The plan had marked `build.test.ts` read only, and the rule gives no path for a planned change that breaks an existing exam law.
  2. From the plan: `docs/plan/tier-1.md:650` says the catalog holds effect 4.1.1 and tea 0.23.0, but `pnpm-workspace.yaml` has effect 4.1.2 and `@demlik/tea` 0.25.0. The header of `oxlint-plugins/no-effect-run-outside-edge.ts:18` also still says 4.1.1.
  3. From the review, a note for later: decision 0523 will make `fabrika/no-effect-promise` block in folders at zero. The new e2e law file has 11 `Effect.promise` uses, which are advice today. Its neighbors, such as `key.laws.test.ts`, use the same pattern.
- **Browser builds:** the repo's Playwright 1.64.1 wants browser build 1248, but this container has 1243. Every browser run here used links named for 1248 that point at 1243, set through `PLAYWRIGHT_BROWSERS_PATH`, and nothing of that is committed. CI installs 1248 itself. L3 has not been seen on 1248. If 1248 no longer keeps a page with an open socket in the back/forward cache, L3 fails as "not restored". It can never pass falsely.

## Description

next: Tuval's page starts on Effect's browser runtime, BrowserRuntime.runMain

## What this does

All of it is in `next/`. Today's version is not touched.

- The page entry `next/apps/fabrika/src/entry/browser.tsx` now hands its one program to Effect's own browser runner, `BrowserRuntime.runMain` from `@effect/platform-browser` 4.1.2, re-exported by `@kampus/tuval/browser`. Before, it called `Effect.runFork(page)` under a lint exception, and that exception is gone.
- When a person leaves the page, so that a `pagehide` comes that is not entering the back/forward cache, the page's program stops. Its scope closes, so the socket closes and React unmounts. Before, nothing stopped it.
- When the page enters the back/forward cache, it keeps running, and it is mounted and dials again when it comes back.
- A failure of the page program is now logged on the console. Before, `runFork` dropped it silently.

## Why this change

Decision 0250 (use Effect's own module where one exists), and the "Platform pieces" sketch in `docs/plan/tier-1-detail.md` (lines 788 to 889), which planned `BrowserRuntime.runMain` for the browser entry. The build had skipped it. This is one slice: the socket, the row store, the key store and signing come later.

## How it works

- `pnpm-workspace.yaml`: the catalog gains `'@effect/platform-browser': 4.1.2`, held at effect's own version. Its only peer is `effect ^4.1.2`.
- `next/packages/tuval/package.json` takes it as a dependency. `next/packages/tuval/src/browser/index.ts` re-exports `runMain` from `@effect/platform-browser/BrowserRuntime`.
- The entry's last line:

```ts
// next/apps/fabrika/src/entry/browser.tsx
import { browserKey, browserRows, browserSocket, runMain } from "@kampus/tuval/browser";
// ...the same page program...
page.pipe(runMain);
```

Effect's `runMain` (4.1.2) adds a `pagehide` listener. That listener interrupts the main fiber unless `event.persisted`. It is removed when the fiber ends, and errors are reported through `makeRunMain`.

Read these files first, in this order:

1. `next/apps/fabrika/src/entry/browser.tsx`
2. `next/packages/tuval/src/browser/index.ts`
3. `next/apps/fabrika/e2e/page-runtime.laws.test.ts`

## What a reader should know

- **A new public export:** `runMain` from `@kampus/tuval/browser`.
- **A new dependency,** `@effect/platform-browser` 4.1.2, in the catalog and the lockfile.
- **Stored data:** nothing changes.
- **Teardown is best-effort,** as Effect's own docs say. A browser may tear a page down before an asynchronous finalizer finishes.

## Laws and checks

- **L1 (lint):** held by the existing `fabrika/no-effect-run-outside-edge` rule and `reportUnusedDisableDirectives`. Both plants went red: `Effect.runFork(page)` with no comment, and the old edge comment kept over `runMain`.
- **L2,** `L2: for generated pagehide events, the page stays up while each is persisted and stops at the first that is not, reporting nothing`: a property, 12 runs, seed 119120, run against the real built tab in Chromium. Red on main at `[[false]]`. Its plant, a hand listener that stops on every `pagehide`, was red at `[[true]]`.
- **L3,** `L3 scenario: one real back/forward cache round trip keeps the window mounted, and it dials again; Chromium hands the listener the same persisted event on every trip, so more trips add no case`: a real round trip in full Chromium. Green on main by design. Its plant, the same hand listener, was red: "the window is still mounted after Back". The reviewer ran it 8 times, 8 green.
- **L4,** `L4: a generated failure of the page program is reported on the console`: a property, 8 runs. Red on main, where the console was empty. Its plant, `runMain` with `disableErrorReporting: true`, was red.
- **L5 (type):** `runMain` takes an `Effect<A, E>` with no requirements, so dropping the page's `Effect.provide` fails the type check.
- **L11,** in `next/apps/fabrika/src/build.test.ts`: rewritten, because the old law required a literal `Effect.runFork`. The new title is `format: the page entry starts its one Effect program through runMain, once, outside React at module scope, and calls no Effect.run*`. It is stricter than before, and six plants were red.
- **What ran, on Node 26.13.0:**
  - `node next/apps/fabrika/e2e.ts page-runtime.laws.test.ts`: 3 of 3.
  - `build.test.ts`: 12 of 12.
  - `pnpm format` and `pnpm lint`: exit 0, 142 s.
  - `pnpm typecheck`: exit 0, 58 s, at `0d25ef464`.
- **What could not run:** the browser laws ran on Chromium build 1243 through links. CI's build 1248 has not been seen to keep a page with an open socket in the back/forward cache. If it does not, L3 fails as "not restored". It never passes falsely.
- **Loosening check:** `loosening.sh` gives 4 hits, and none is real loosening. The removed law is L11 under its old title; its replacement is the new L11 above, which is stricter. Line 27 of `build.test.ts` is that same rewrite. The lockfile and workspace hits are the new package.

## Not in this pull request

- The socket, the row store, the key store and signing move to Effect's browser modules in later slices.
- Docs: `docs/plan/tier-1.md:644`, `docs/plan/tier-1-detail.md:889` and `.patterns/effect-services-and-layers.md:75` now say the catalog holds the package and the page starts on `runMain`.
- Findings handed over:
  - the tests step changed an existing law against `docs/plan/tier-1.md:642`;
  - `docs/plan/tier-1.md:650` and `oxlint-plugins/no-effect-run-outside-edge.ts:18` give stale version numbers.

## Steps

Each step was a separate Opus agent in a cloud session:

| Step | Outcome |
|---|---|
| plan | approved by the lead (it builds 0250) |
| tests | `8b51621d4` |
| build | `c27fa8a8e`; found that L11 needed a rewrite |
| tests | `4973ae331`, L11 rewritten |
| lead | `682ac7cf0`, the lockfile |
| review | pass, 1 finding |
| tests | `0d25ef464`, L11 type-checks after the lead's type check failed; rechecked: pass |
