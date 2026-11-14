This prompt is your whole brief; nothing else from the lead reaches you.
Tracker ticket 913 in tea-fabrika, writer name `er-b21`: `next/` and the repo's lint tooling. Slice B2.1 of the approved plan `docs/plan/effect-rules-big.md` (section "B2: the docs rule"), and only slice B2.1: a new lint rule `fabrika/jsdocs` with its copied grammar, on for `next/packages/libfabrika/src/ci/**` and `codehost/**`. No product code file changes in this slice; the fills are slices B2.2 to B2.8 and are not built here. It builds decisions 0168, 0023 (`next/` follows Effect's code style, with its listed differences) and 0120, and `docs/direction/effect-code-guidelines.md`. Branch `fabrikalfa/t913-jsdocs-rule`.

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


The owner answered the plan's two open questions on 2026-11-13. A type directly under its same-name schema shares the schema's doc block; this is a kept difference from Effect's style, and this slice adds it to 0023's list. A usage export gets a named span like any other, with no exemption.

## tests

Use the tests skill for ticket 913. Yours: every row the plan's Files table gives to `tests` for slice B2.1: `oxlint-plugins/jsdocs.ts` and `oxlint-plugins/effect-jsdocs.ts` (the rule and the copied grammar, as the draft the plan cites has them, about 870 lines of which about 650 are copied: keep the copied part's source and license note at its top, as the plan's "Whose check" says), `oxlint-plugins/jsdocs.test.ts`, the rule's row in `oxlint-plugins/index.ts`, its two blocks in `.oxlintrc.json` as the plan's sketch shows them (on at `error` with `{ "since": "absent" }` for `ci` and `codehost`; off for the six kinds that are not public: `internal/`, tests, test support, shared suites, fixtures, declaration files), and its entry in `oxlint-plugins/README.md`. Write the docs rule's laws as the plan and its draft say (the plan's "Laws" section says where the nine are), each a property or a labeled example with its reason, seed 119120. Add the case for a type directly under its same-name schema: it passes with no block of its own, and a type that is not directly under its schema does not. Replay the rule over `ci` and `codehost` and report the count against the plan's 9 of 9 and 12 of 12 exports passing; a difference is a finding for your answer. `pnpm lint` is green after your step. Run each plant once, restore by copy, record each in your answer's `plants`, and commit.

## build

Use the build skill for ticket 913. No product code is yours in this slice. Yours are the docs rows the plan's Files table gives to `build` for B2.1: in `.patterns/doc-comments.md` and `docs/direction/effect-code-guidelines.md`, "what can hold it" becomes what holds it, and the measured counts stand beside the guesses; and the list of kept differences in `.decisions/0023-next-follows-effects-code-style.md`, which gains one row: a type directly under its same-name schema shares the schema's doc block, with a dated note in the shape other amended decisions here have. Re-ground the pattern doc with the write-pattern skill's shape if you change more than a line of it. Take the measured numbers from the tests step's answer. Confirm `pnpm lint` is green and say so.

## review

Use the review skill for ticket 913. One review. Sweep: every B2.1 row of the Files table against the diff; each law against its plant record; the copied grammar against its source, that it is copied and not rewritten, with its source and license note; the six left-out kinds, each by a planted file; the schema-and-type case both ways; that a usage export has no exemption; that the README's counts match a replay you run yourself; that 0023's new row and the two docs agree with the rule; that no product code file changed and nothing of B2.2 to B2.8 was built. Say how many false alarms you found reading every fire in `ci` and `codehost`: a rule that blocks needs about none.

## pr

The docs rule fabrika/jsdocs, on for ci and codehost (Effect rules B2.1)

Ticket 913, slice B2.1 of `docs/plan/effect-rules-big.md`. Say what the rule asks of a public export and of a file, what was copied and from where, the six kinds it leaves out, the two answers of 2026-11-13 and where each shows in the rule (a type under its same-name schema shares its block, now a kept difference in 0023; a usage export gets a named span), the measured counts for `ci` and `codehost` and the false alarms found, and how the list closes: each fill adds its folders, then one glob. Say that no product code changed.

fabrika close ticket 913
