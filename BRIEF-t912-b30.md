This prompt is your whole brief; nothing else from the lead reaches you.
Tracker ticket 912 in tea-fabrika, writer name `er-b30`: `next/` only. Slice B3.0 of the approved plan `docs/plan/effect-rules-big.md` (section "B3: `preferNamespaceImport` for `next/packages/**`"), and only slice B3.0: Effect's own type-check rule `preferNamespaceImport` goes to `error` for `next/packages/libfabrika/src/ci/**` and `codehost/**`, their two test files are fixed, and Effect's own automatic fix is tried once and written up. The other modules are slices B3.1 to B3.7 and are not built here. It builds decisions 0168 and 0023 and `docs/direction/effect-code-guidelines.md`. Branch `fabrikalfa/t912-namespace-imports`.

Limits for every step: tests run as
`nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>` (a box refuses
`nice` with setpriority: then run without it; plain `pnpm` and `node` are the pinned ones in a box, and
`volta` does not work there, so never type `volta run`). In a box each command starts in a login shell, which can put an older Node first: if `node -v` does not print v26.13.0, start every `pnpm` and `node` command with `PATH="$HOME/.volta/tools/image/node/26.13.0/bin:$HOME/.volta/tools/image/packages/pnpm/bin:$PATH"` (one line, same command), and say in your answer that you did. A test that was not run on Node 26.13.0 was not run: never report a law red or green from a refused start. Never the
full suite, never --changed. `pnpm format` first, then `pnpm lint`. No `pnpm typecheck` in a box:
the typecheck is CI's `check` job (decision 0133).
TYPESAFE_API_KEY stays unset. Never read, print or copy a key or the control token, and never print npm, pnpm or env
settings. Never push. A box's git index is read-only: restore a planted file by copy, not `git checkout`. A plant is allowed in any product file the plan names: the tests step may break it once to see a law fail, then restores it by copy before it commits; only files the plan gives to `tests` are committed (tests skill, "A plant is run once, not kept").
Outside work is a finding row, see `field/README.md`. No public text may hold an absolute path, a
personal name or an account name.

Decision 0168 is the rule of this lane: the slice fixes every break and turns its rule on in the same pull request. So never switch a lint rule off to pass, write no `oxlint-disable` line the plan does not name, and add no entry to any ledger or list file. Other slices of the same plan run beside this one, and each changes a line or a block of `.oxlintrc.json`, `tsconfig.base.json`, `oxlint-plugins/index.ts` or `oxlint-plugins/README.md`: in those files change only your own slice's lines, so the second to merge has a one-line conflict and no more.


A box runs no type check, and this slice's rule is a type-check rule. So no step reports law 5 red or green from a box: CI's type check at the pushed head is its proof, and each step says so in its answer.

## tests

Use the tests skill for ticket 912. Yours: `tsconfig.base.json` (one more override, as the plan's sketch shows: `namespaceImportPackages: ["effect"]` and `preferNamespaceImport` at `error` for the two folders), the two test files of `ci` and `codehost` (10 names: each named import from `effect` becomes a namespace import by module path, import lines only, no other line), the test for law 6 where the plan's Files table puts it, and the rule's entry in `oxlint-plugins/README.md`. Write law 6 as the plan's Laws table says: a pinned saved list of the folders listed on the day this lands, which fails when a folder is dropped. Law 5 is the type check itself and is not written as a test. Read `node_modules/effect/AGENTS.md` and the installed `@effect/tsgo` docs for the exact option names before you write them. Run law 6's plant once, restore by copy, record it in your answer's `plants`, and commit.

## build

Use the build skill for ticket 912. No product file is yours to commit in this slice: the plan found no named import from `effect` in the product files of `ci` and `codehost`. Check that claim with a search and say what you found; a product file that has one is yours to fix, import lines only. Your other job is the tryout the plan's "Codemod" section asks for: in a scratch copy, never committed, run Effect's own fix through `effect-tsgo oxlint --type-aware` with `oxlint-tsgolint` at an exact version, on one module that still has named imports, and write up in your answer what happened: the exact commands, whether it ran from the command line, how many files it changed, whether the result matches the hand fix, and every error, a failure included. If a box cannot install or run it, say exactly what refused, and the lead runs it on the host. That write-up decides whether B3.1 to B3.7 use the tool or helper agents, so do not smooth a failure over.

## review

Use the review skill for ticket 912. One review. Sweep: every B3.0 row of the Files table against the diff; law 6 against its plant record; that the two test files changed in import lines only and every name still resolves to the same thing; that the override covers exactly the two folders and their tests; that the tryout's write-up names its commands and its result and that nothing of the scratch copy was committed; that nothing of B3.1 to B3.7 was built.

## pr

next: preferNamespaceImport on for ci and codehost, and the tryout of Effect's own fix (Effect rules B3.0)

Ticket 912, slice B3.0 of `docs/plan/effect-rules-big.md`. Say what the rule refuses and why (0023), the two folders it is on for, the 10 names fixed in two test files, and how the list closes. Give the tryout's result in full: the commands, whether Effect's own fix runs from the command line, what it changed, and what that decides for B3.1 to B3.7. Name what a box could not run and what proved it: the rule is a type-check rule, so CI's type check at this head is the proof of law 5.

fabrika close ticket 912
