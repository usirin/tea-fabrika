This prompt is your whole brief; nothing else from the lead reaches you.
Tracker ticket 911 in tea-fabrika, writer name `er-b10`: `next/` and the repo's lint tooling. Slice B1.0 of the approved plan `docs/plan/effect-rules-big.md` (section "B1: `no-static-layer`"), and only slice B1.0: a new lint rule `fabrika/no-static-layer`, on for the `next/` folders that are already at zero. No product code file changes in this slice; the moves are slices B1.1 to B1.7 and are not built here. It builds decisions 0168 and 0095 (a service file holds only its contract) and `docs/direction/effect-code-guidelines.md`. Branch `fabrikalfa/t911-no-static-layer`.

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


The owner answered the plan's open question on 2026-11-13: the rule refuses every static member on a class that extends `Context.Service`, not only one that returns a Layer. This slice amends 0095's rule line to say so.

## tests

Use the tests skill for ticket 911. Yours: every row the plan's Files table gives to `tests` for slice B1.0: `oxlint-plugins/no-static-layer.ts`, `oxlint-plugins/no-static-layer.test.ts`, the rule's row in `oxlint-plugins/index.ts`, its block in `.oxlintrc.json` as the plan's sketch shows it (one block whose `files` list holds the folders at zero), and its entry in `oxlint-plugins/README.md` (the rule, the tools looked at, the count by module, the folder list and how it closes). Write laws 2, 3 and 6 as the plan's Laws table says: law 2 a property through oxlint's `RuleTester` over B1's cases 1 to 5, 100 runs, seed 119120; law 3 a labeled scenario of one real lint run over one planted file per listed folder and per left-out kind; law 6 a pinned saved list of the folders listed on the day this lands. Model the rule and its test on a neighbor in `oxlint-plugins/`. Replay the rule over the whole `next/` tree with the list widened in a scratch copy of the config, read every fire, and report the count by module against the plan's hand count of 27; a difference is a finding for your answer, with the file and line of each fire that differs. The folder list you commit holds only folders where the replay found nothing, so `pnpm lint` is green after your step. Run each plant once, restore by copy, record each in your answer's `plants`, and commit.

## build

Use the build skill for ticket 911. No product code is yours in this slice. Yours are the docs rows the plan's Files table gives to `build` for B1.0: in `.patterns/effect-services-and-layers.md` and `docs/direction/effect-code-guidelines.md`, "what can hold it" becomes what holds it, and the measured count by module stands beside the guess; and the rule line of `.decisions/0095-a-service-file-holds-only-its-contract.md`, amended to say "any static member", with a dated note of the amendment in the shape other amended decisions here have. Re-ground the pattern doc with the write-pattern skill's shape if you change more than a line of it. Take the measured numbers from the tests step's answer, never from the plan's guess. Confirm `pnpm lint` is green and say so.

## review

Use the review skill for ticket 911. One review. Sweep: every B1.0 row of the Files table against the diff; laws 2, 3 and 6 against their plant records; that the rule fires on every static member of a class that extends `Context.Service` in every import spelling of B1's cases, and on no class that does not; that every listed folder really is at zero and no folder at zero was left out without a reason; that tests are left out by the config; that the count by module in the README matches a replay you run yourself; that 0095's amended line and the two docs agree with the rule; that no product code file changed and nothing of B1.1 to B1.7 was built.

## pr

The no-static-layer rule, on for the next/ folders already at zero (Effect rules B1.0)

Ticket 911, slice B1.0 of `docs/plan/effect-rules-big.md`. Say what the rule refuses and why (0095), that it refuses every static member by the owner's answer of 2026-11-13 and that 0095's rule line is amended here, the measured count by module against the plan's hand count of 27 and each difference, which folders are on today, and how the list closes: one folder a slice, then one glob, with `cloudflare/` closing when the Alchemy port (ticket 502) deletes `cloudflare/platform.ts`. Say that no product code changed.

fabrika close ticket 911
