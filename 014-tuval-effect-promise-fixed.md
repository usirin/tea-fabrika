REPORT: the Tuval round is pushed at 1dbfad736 (pull request 1204): all 18 Effect.promise uses in the new law file fixed the Effect way, recheck pass, type check green.

- **Head:** `fabrikalfa/cloud-tuval-run-main` at `1dbfad736057dbae303d135b4a337e8731611a09`. This adds one commit, `1dbfad736`, "Tuval run main tests: the page laws wrap Playwright in a typed error". It is authored "Claude", has no trailers, and touches only `next/apps/fabrika/e2e/page-runtime.laws.test.ts`.
- **The fix:** the file had 18 `Effect.promise` sites, not 11.
  - Two `Schema.TaggedError` classes: `PlaywrightError` (`op`, `message`, `cause`) and `PropertyFailed`. `PropertyFailed` carries fast-check's report, so a red law still shows its counterexample.
  - Two helpers built on `Effect.tryPromise`: `playwright(op, run)` and `property(run)`, for the two `fc.assert` calls.
  - The three closes in `acquireRelease` go through `playwright` and then `Effect.orDie`, since a release may not fail with a typed error. A failed close stays a loud defect with its op name.
  - `until` now takes `Effect<boolean, E>`.
  - Effect 4.1.2 has no `Schema.TaggedErrorClass`, the name the rule's message gives; its name is `Schema.TaggedError`.
- **Laws unchanged:** the same titles, generators, seed 119120, run counts and assertions. The reviewer confirmed this from `git diff 0d25ef464 1dbfad736`.
- **Checks:**
  - Lint on the file: 0 blocking and 0 advice, so 0 `no-effect-promise` fires.
  - The law file: 3 of 3 green.
  - Plant (main's `Effect.runFork(page)`): L2 red at `[[false]]` and L4 red at `["yffmxllxhqq"]`, each through `PropertyFailed` with the assertion as its cause. L3 green, as designed.
  - Recheck by the same reviewer: pass.
  - `pnpm lint`: exit 0, 141 s.
  - `pnpm typecheck`: exit 0, 55 s.
  - Leak check: the diff is clean, and 6 commits are clean (built-in shapes; the word list is missing here).
- **Loosening check:** the same 4 hits as before, and none is new. They are the renamed L11 (mapping row in 013), its title line, and the lockfile and workspace lines for the new package.
- **New finding, for you to file:** in effect 4.1.2, an uncalled `Schema.Defect` used as a field of `Schema.TaggedError` passes `tsc`, `@effect/tsgo` and lint, but throws `TypeError: Cannot read properties of undefined (reading 'encoding')` when the error is built. The tests step hit it first, and its first plant went red for that wrong reason before the fix to `Schema.Defect()`. A scratch script, deleted, proved it with `class A extends Schema.TaggedError<A>()("A", { cause: Schema.Defect }) {}` and then `new A({ cause: new Error("y") })`. A lint rule flagging an uncalled `Schema.Defect` would hold it.

## Description changes

These are against the description in 013:

- **Laws and checks:** after the L4 bullet, add:
  - "The law file has no `Effect.promise`. Playwright and fast-check calls go through two `Effect.tryPromise` helpers, with typed errors `PlaywrightError` and `PropertyFailed`. A failed close is a defect through `Effect.orDie`."
- **What ran:** `pnpm lint` exit 0 in 141 s, and `pnpm typecheck` exit 0 in 55 s, at `1dbfad736`.
- **Steps table:** add the row "tests | `1dbfad736`, the law file wraps Playwright in typed errors (no `Effect.promise`); rechecked: pass".
- **Not in this pull request:** add the finding above.
- **Everything else:** unchanged.

## Also

- **T753 L16 flake:** the child session "Cloud lane: T753 L16 flake" is started on Opus, with the branch `fabrikalfa/cloud-t753-l16-flake`.
- **One change from your brief:** it does not open the draft pull request. My standing rules allow opening a pull request only when the owner asks in this session's chat. The child pushes the branch and mails you through me, as the other lanes do.
