# P10 final test types

`next/`, tracker ticket 248. Test-writer correction on product commit
`56a36510`. This supersedes the remaining diagnostic lists in
[the pre-build audit](./type-audit.md) and [the first build check](./build-check.md).

All 91 remaining diagnostics came from `door.test.ts`. No product code,
law, planted failure, expected value or test count changed.

## Corrections

- Default parameters in the `Effect.fnUntraced` helpers now name their types.
  Client and enrollment ids are strings. Signing keys use the world's real
  key types. The helpers keep their inferred Effect errors and services.
- Local grant and add values satisfy their real schema types. Rank and
  observation values keep their allowed literals without a cast.
- Runtime assertions narrow replies before reading case-specific fields.
  Successful span replies decode through a test schema with
  `spans: Schema.Array(SpanRow)` and `next: Schema.Int`.
- The bounded-reader tests still reject reading the failing tail, compare
  both pages with the real record stream, and check page sizes and offsets.
  The spent-sheet test still rejects an applied answer and requires `used`.

## Validation

The ordinary root Vitest config ran against the real product, with one worker:

- Narrow suites: **117/117 passed** in five files, door, passkey,
  session-manager, process-id and sshsig-webauthn.
- Full `next/` suite, run once: **703/703 passed** in 38 files.
- `pnpm format`: passed.
- `pnpm lint`: passed, no blocking findings.
- One workspace `pnpm typecheck`: passed, exit 0, no diagnostics. It used
  `GOMAXPROCS=1` and workspace concurrency 1.

Commands unset `TYPESAFE_API_KEY`. Per-command pnpm settings skip automatic
dependency installation and use the already installed versions. No manifest,
lockfile or check configuration changed. The sandbox denied changing priority;
the one-worker limit still held.

## Limits

This checks test typing and runtime behavior on the completed P10 product.
It does not replace mutation testing or independent review.
