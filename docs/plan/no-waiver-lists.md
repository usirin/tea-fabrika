
Plancheck-Version: 3

# Plan: no list lets broken code pass, in both versions

The owner ruled on 2026-11-13 that [0168](../../.decisions/0168-old-lint-breaks-are-fixed.md) holds
everywhere: an old break is fixed, never kept in a list. Every list of that kind goes, what it holds
is fixed properly, and checks make sure no new one appears. Code-graph JSON files may stay only
where no agent can use them to let wrong code through.

This plan covers both versions. Each row says which one: `next/`, today's (`apps/`, `packages/`,
`programs/`), or lead tooling (`.agents/`). All counts were read on `origin/main` at `7ae7cea0f`.
Each slice counts again when it starts.

```ts
// The whole idea, as the last guard law sees the tree (a sketch).
const waivers = [
  ...filesNamed(/-ledger\.json$|baseline|allowlist/),      // list files
  ...layerRules.allowed ?? [],                            // code-graph's import exceptions
  ...stylelintRules.flatMap((rule) => rule.known ?? []),   // CSS "known debt"
  ...oxlintOverrides.filter(turnsOffForProductPaths),      // a rule off for named product files
  ...oxlintRules.filter((level) => level === "warn"),      // advice: printed, never failing
];
expect(waivers).toEqual([]); // the gate closes behind the last fix
```

## How others do it

- **ESLint's own answer is inline, per line, with a reason.** ESLint's
  `eslint-comments/require-description` and `--report-unused-disable-directives` make each
  exception a line a reviewer reads. A file-level `"off"` override is what ESLint's docs call
  "disabling rules for a group of files", meant for a class of files (tests, generated code), not
  for one product file. Read: oxlint 1.90.0's `configuration_schema.json` and `dist/index.d.ts`,
  installed here.
- **Baseline files are the known industry pattern we are leaving.** Detekt, PHPStan and SpotBugs
  keep "baseline" files of old findings; Google's Tricorder paper (CACM 2018, cited in `AGENTS.md`)
  instead turns a check on only at about 0% false alarms, so nothing old needs listing. 0168 picks
  the second way: fix first, then turn on.
- **Code-graph itself allows an absent ledger.** `@demlik/code-graph@0.15.0`'s loader reads
  `unreachable-ledger.json` and treats a missing file as `{ kind: "absent" }`, an empty ledger
  (`dist/index.js`, the ledger reader after `UNREACHABLE_LEDGER_FILENAME`). Its `--accept-dead
  --reason` flag writes every current finding into the file in one command.
- **oxlint can replace option lists, not merge them.** An override's options replace the base
  options whole, so each override of `eslint/no-restricted-imports` repeats the list. That is why
  some overrides dropped entries (see row 12 below). oxlint 1.90.0 also takes an
  `oxlint.config.ts` with `defineConfig`, where lists can be spread; this plan does not move to it
  (see Shape).

## The inventory

| # | Version | Where | What it waives | Entries | Since | Status |
|---|---|---|---|---|---|---|
| 1 | `next/` | `next-ledger.json`, read by `oxlint-plugins/lint.ts` | `eslint(no-restricted-imports)` layering imports | 71 | 2026-11-11 | being fixed: PR 1185 and 1189 |
| 2 | `next/` | `next-ledger.json` | `vitest(no-hooks)` after-hooks | 13 | 2026-11-11 | this plan, slice 3 |
| 3 | lead tooling | `agents-ledger.json`, same reader | 7 rules in 10 files of `.agents/skills/` | 109 | 2026-11-09 | this plan, slices 4 to 6 |
| 4 | today's | `unreachable-ledger.json`, read by code-graph `lint:dead` | `only-called-from-tests` exports in `apps/fabrika/src/editor/` | 3 | 2026-10-30 | this plan, slice 7 |
| 5 | `next/` | `layer-rules.json` key `allowed`, read by code-graph `lint:layers` | upward imports, "until ticket 641" | 6 | 2026-10-23 | this plan, slice 8 |
| 6 | today's | `layer-rules.json` key `allowed` | old pipeline laws importing `packages/pipeline/src/laws/explore.ts` and `world/search.ts` | 34 | 2026-10-23 | open question 1 |
| 7 | `next/` | `compiler-ledger.json`, read by `next/apps/fabrika/src/exam/compiler.ts` | React Compiler findings, owner-approved rows | 0 | 2026-11-05 | this plan, slice 9 |
| 8 | today's | `stylelint.config.ts` `known` lists, read by `oxlint-plugins/stylelint.ts` | CSS breaks in `apps/fabrika/src/window/window.css`: token-exists 28, no-raw-color 20, font-size-from-scale 6 | 54 | 2026-11-08 | this plan, slice 10 |
| 9 | both | `oxlint-plugins/lint.ts` `ADVICE` set, plus 8 `"warn"` levels in `.oxlintrc.json` | 6 rules print and never fail | 6 rules, 922 fires | 2026-10-31 | being fixed: PR 1194 (0523), PR 1170 |
| 10 | today's | `.oxlintrc.json` overrides 6 and 8 to 13: a rule `"off"` for one named product file | `no-project-settings` in `rules.ts`; `no-redacted-value` in six `packages/fabrika/src/host/` files (9 lines) | 7 overrides | 2026-10-31 | open question 2, slice 11 |
| 11 | none | `.oxlintrc.json` override 7: two rules `"off"` for `experiments/**` | nothing: `experiments/` holds no code file on main | 1 override | 2026-10-31 | this plan, slice 2 |
| 12 | `next/` | `.oxlintrc.json` overrides 32, 39, 43, 44, 46 replace the import ban list and drop entries | the `useState` ban (5 overrides), the `_electron` ban (1), `@decimalturn/toml-patch` (1) | 5 overrides, 0 code hits | 2026-11-10 onward | this plan, slice 2 |
| 13 | `next/` | one disable line, `next/packages/libfabrika/src/cloudflare/record.ts:102` | a cast marked as debt: "edge: raw storage until PR 8" | 1 | 2026-11-10 | this plan, slice 2 |
| 14 | lint tests | `oxlint-plugins/plants.test.ts`, the `elsewhere` array | rules the "every rule has a plant" law skips | 31 | 2026-10-31 | this plan, slice 12 |
| 15 | `next/` | `node-kinds.json`, read by code-graph `lint:dead` | exports a runtime binds by name: `RecordPart`, `IsolateTail` in `src/brain.ts` | 1 convention, 2 names | 2026-11-09 | stays, guarded, slice 7 |
| 16 | both | `.github/workflows/check.yaml` step `aria`, `continue-on-error: true` | ARIA tree diffs advise and never block | 1 step | 2026-11-07 | open question 3 |

Not waivers, checked and left as they are:

- **Test-class overrides** in `.oxlintrc.json` (2, 21, 22, 24, 25, 26): rules off for `*.test.ts`,
  `*.test-support.ts` and `*Test.ts` shared suites. Each is a class where the rule does not apply,
  and the `next/` test exception to `no-promises` is decided in
  [no-promises](../../docs/direction/no-promises.md) ("refuse Promises outside tests"). Overrides 2
  and 25 spell two `*Test.ts` files by path; both match the class pattern.
- **Tool-loaded files** (override 15): `import/no-default-export` off for configs a tool loads by
  default. A class.
- **A rule's own home** (overrides 5, 27, 31, 37): Radix in the token build, the TOML adapter and
  its start code, the one test-window launcher. Each is the one place its ban's message names. They
  narrow nothing the rule exists for.
- **Stricter overrides** (0, 1, 35, 36, 40, 41): they add bans or allow only a few imports.
- **`ignorePatterns`**: `**/fixtures/**` (toy repos, the tests' subject), `**/experiments/results/**`
  (saved output, [0006](../../.decisions/0006-no-unused-exports.md)), `.claude/**` (symlinks that
  would lint `.agents/` twice), and two ledger files, which go with slice 13.
- **tsconfig `exclude`**: only `packages/fabrika` and `packages/pipeline` build configs leave tests
  out of the built package. The typecheck still reads them. `adapters/` has no `typecheck` script
  and no TypeScript.
- **tsconfig `include`**: a scope too, and a list under 0524 when it leaves files out. The e2e
  typecheck pull request closes `next/apps/fabrika`'s: its `e2e/` and `e2e.ts` were outside the type
  check from 2026-11-06, hiding 19 errors. Three gaps stay, each a finding: `.agents/tsconfig.json`
  lists files one by one (72 outside); the repo root's 16 TypeScript files, which no typecheck runs;
  today's `apps/fabrika` (2 files), frozen by
  [0525](../../.decisions/0525-todays-version-is-frozen.md). One error it hid: every run of P19's
  L13 before that pull request sent `SIGTERM`, not `SIGKILL`, since the kill passed `signal`, a key
  Effect's `KillOptions` does not have.
- **vitest `exclude`**: skill fixtures, and `next/packages/tuval/src/browser/key.laws.test.ts`, which
  `next/apps/fabrika/e2e.ts` runs in headless Chromium; CI runs that runner. Not hidden.
- **CI `--exclude` flags**: they route tests to jobs. `.github/ci/workflow-lint.ts` checks the
  routing covers every path.
- **`.skip`, `.todo`, `xit`**: none on main; `vitest/no-disabled-tests` already blocks `.skip`. 24
  `skipIf`/`runIf` calls gate on the machine (root user, platform, a missing tool, a sandbox), none
  on a literal.
- **`@ts-expect-error`**: 274, every one with words after it, all in test or probe files.
  `@ts-ignore`: 3, all inside planted strings in lint tests.
- **Disable lines**: 482 real ones. Every one has a reason after `--` (held by
  `fabrika/no-bare-disable`); 355 say `edge:`. Only row 13 marks debt.
- **`boundary-rules.json`**: package rules, no exception key.

## Code-graph files: can they let wrong code through?

**`unreachable-ledger.json`: yes, today.** Three ways:

- Any entry hides a finding: an export nobody uses, or product code only tests call, passes.
- `code-graph . --unreachable --accept-dead --reason "x"` writes every current finding into the
  file in one command. An agent can do that inside any pull request.
- CI's step `dead exports ledger committed` runs `git diff --exit-code` on the file. That proves the
  pruned file was committed. It does not prove no entry was added.
- It is an exam path, so a build step's signed commit that touches it is `stuck`. But I found no CI
  step on main that runs that commit check (`next/apps/fabrika/src/exam/commits.ts`); the lead runs
  it by hand. That is a finding below, outside this plan.

**What stops it:** fix the 3 entries (slice 7), delete the file, and add a law that the file does
not exist. Code-graph reads a missing file as an empty ledger, so the check stays as strict, and
`--accept-dead` would recreate the file and fail the law. So the file is not kept. With that, the
owner's condition holds: no entry can exist.

**`layer-rules.json`: its `layers` rows are fine, its `allowed` key is not.** The rows say where a
folder sits; changing one is an exam change and moves every import the same way. The `allowed` list
exists only to let named wrong imports pass, 40 of them. The law: `allowed` is absent (slices 8 and
the answer to question 1).

**`node-kinds.json`: it can, and a law stops it.** A name listed under `entryExportConventions` is
treated as used. A made-up name would hide a dead export. Both names on main are real:
`RecordPart` is bound by `Cloudflare.DurableObject("RecordPart")` in
`next/apps/fabrika/alchemy.run.ts`, and `IsolateTail` by `getLoopbackEntrypoint(..., "IsolateTail")`
in `next/packages/libfabrika/src/cloudflare/tail.ts`. The law: every listed name is exported by its
file and appears as a binding string in non-test `next/` code. It is not an exam path today; slice 1
adds it.

**`boundary-rules.json`: no.** It has no exception key.

## Already being fixed: do not duplicate

- **The 71 layering import rows of `next-ledger.json`** reach zero through the seven slices of
  `docs/plan/layering-debt.md` in https://github.com/kamp-us/tea-fabrika/pull/1185. Slice 1 is
  https://github.com/kamp-us/tea-fabrika/pull/1189. Slices 4 to 7 wait on that plan's open
  question 1, for the owner. Each slice deletes its rows. With slice 3 of this plan, which empties
  the 13 hook rows, `next-ledger.json` is then empty.
- **The advice set** empties through decision 0523 (https://github.com/kamp-us/tea-fabrika/pull/1194)
  and its lane: the five advice rules block folder by folder at zero, and the docs rule turns on the
  same way. `fabrika/service-id`, the sixth, blocks in
  https://github.com/kamp-us/tea-fabrika/pull/1170. When the last folder reaches zero, `ADVICE` is
  empty and no `"warn"` level is left. Slice 13 then deletes the set and turns on its guard.
- Note: 0523 keeps a dirty folder printing as advice until its fill lands. That is a per-folder
  scope while the fills run, not a list of breaks, and it ends when they do.

## The shape

### Who reads what, after

```ts
// oxlint-plugins/lint.ts, after slice 13 (a sketch): one level, no list.
const blocks = diagnostics;                    // every diagnostic blocks
for (const d of blocks) console.log(`${where(d)} ${d.code} ${d.message}`);
process.exit(blocks.length === 0 ? 0 : 1);
// gone: ADVICE, LEDGERS, settle, fingerprint, the prune-and-write step
```

### The guard laws, in one test file

All guard laws that read config live in one new file, `oxlint-plugins/no-waivers.test.ts`. Each
law turns on in the slice that brings its count to zero, so it never starts red (0168: "a new rule
starts at zero").

```ts
// A sketch of the override law (slice 2). Effect Schema decodes the parsed config.
const Level = Schema.Literals(["off", "warn", "error", 0, 1, 2]);
const Override = Schema.Struct({
  files: Schema.Array(Schema.String),
  rules: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

// The one fixed set of classes a rule may be off or down for. Not a list of breaks: each entry is
// a kind of file where some rule does not apply, and a product path never matches one.
const CLASSES = [
  "**/*.test.ts", "**/*.test.tsx", "next/**/*.test.ts", "next/**/*.test.tsx",
  "next/**/*.test-support.ts", "next/**/*Test.ts", ".agents/**/*.test.ts",
  "**/vitest.config.ts", "**/rslib.config.ts", "**/stylelint.config.ts", "**/alchemy.run.ts",
  "**/scripts/**",
] as const;

const loosens = (o: Override) =>
  Object.values(o.rules ?? {}).some((v) => ["off", "warn", 0, 1].includes(level(v)));

// A glob is fine when it is a class, or a path that a class matches.
const fits = (glob: string) => CLASSES.some((c) => c === glob || match(c)(glob));

it("scenario: no override turns a rule off or down for a product path", () => {
  const bad = overrides.filter(loosens).flatMap((o) => o.files.filter((g) => !fits(g)));
  expect(bad).toEqual([]);
});
```

```ts
// A sketch of the import-ban law (slice 2). An override replaces a rule's list, so it must keep
// every entry of each wider block that covers its files, unless the dropped entry's message names
// this override's path as its one home ("Only X imports", "through X").
const kept = (wide: Ban[], narrow: Ban[], files: string[]) =>
  wide.filter((b) => !covers(narrow, b) && !homeOf(b).some((h) => files.some(under(h))));

it("scenario: a narrower import ban keeps the wider block's entries", () => {
  expect(banOverrides.flatMap(({ files, bans }) => kept(widerBans(files), bans, files))).toEqual([]);
});
// `covers` treats a `**` group with `!` exceptions as covering every entry (overrides 35, 40, 41).
```

The `homeOf` reading needs each ban message to name its home as a path. Two TOML messages say it in
prose ("only the settings module, its Node loader and start code in next/apps"); slice 2 rewrites
them to name the paths, in the same words.

Why not move to `oxlint.config.ts` so lists spread and cannot drop entries: it would rewrite the
exam file that about 20 lint tests read as JSON, for a gap the law above closes. Recorded here, not
built. 70% sure; a second drift after the law lands would change it.

### The disable-line rule

```ts
// fabrika/no-bare-disable grows one refusal (slice 2): a reason that sets a deadline is debt.
const DEBT = /\buntil (?:PR|pull request|ticket|T)\s?#?\d+|\b(?:TODO|FIXME)\b/;
// `-- edge: raw storage until PR 8` -> refused: "a disable line is not a way to postpone a fix (0168)"
// `-- edge: defer Alchemy loading until telemetry is disabled` -> passes: "until" with no PR or ticket
```

### One value traced: a row of `next-ledger.json` through slice 3

1. Before: `next/packages/libfabrika/src/node/build/css.test.ts` has
   `afterEach(() => { for (const home of homes.splice(0)) rmSync(home, ...) })`. Oxlint reports
   `vitest(no-hooks)`. `lint.ts` finds the row
   `{file: ".../css.test.ts", rule: "vitest(no-hooks)", code: "afterEach(() => {"}` and waives it.
2. The tests step rewrites the test: each test opens its home with
   `Effect.acquireRelease(makeHome, (h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})))`
   inside `it.effect`, as [0061](../../.decisions/0061-resources-are-acquired-in-a-scope.md) says.
   Same assertions, same generators.
3. Oxlint reports nothing for that file. `lint.ts`'s whole run finds the row unmatched, prunes it,
   and the commit carries the shorter `next-ledger.json`.
4. CI's `next ledger committed` step and slice 1's shrink check both pass: one entry fewer, none
   added.
5. When the last of the 84 rows is gone, slice 13 deletes the file, the reader and the steps.

A mock reset in a hook (`vi.doUnmock`, `vi.unstubAllEnvs`, in 4 of the 13) gets the same shape:
`Effect.acquireRelease(Effect.sync(() => vi.doMock(...)), () => Effect.sync(() => vi.doUnmock(...)))`.

## Laws

| Law | Kind | Generator | Plant | Slice |
|---|---|---|---|---|
| L1. No row is added to `next-ledger.json` or `agents-ledger.json` against the base commit | test, 100 runs | fc.array: entries drawn from a base file, with one added | add one entry to a copy of the base file | 1 |
| L2. Every name in `node-kinds.json` is exported by its file and bound by that string in non-test `next/` code | test | scenario: the real file on the tree, two names | add a made-up export name | 1 |
| L3. No override turns a rule off for a glob outside the fixed class set | test | scenario: the parsed `.oxlintrc.json` on the tree | add `{"files": ["next/x.ts"], "rules": {"fabrika/no-of": "off"}}` | 11 |
| L4. A narrower `no-restricted-imports` override keeps every entry of each wider block, except one whose message names its path | test | scenario: the parsed `.oxlintrc.json` on the tree | drop the `useState` entry from the `next/**` block's copy in one override | 2 |
| L5. A disable reason that names a PR or ticket as a deadline is refused | lint | lint | the line at `record.ts:102` before its fix | 2 |
| L6. `@ts-expect-error` needs a description (`ban-ts-comment`, `allow-with-description`) | lint | vector: oxlint 1.90.0's built-in rule, planted in `builtin-plants.ts` | a bare `// @ts-expect-error` | 2 |
| L7. `it.todo` and `describe.todo` fail (`vitest/warn-todo` at error) | lint | vector: oxlint 1.90.0's built-in rule, planted in `builtin-plants.ts` | `it.todo("x")` | 2 |
| L8. Every single test file in vitest's `exclude` is named by a runner CI runs | test | scenario: `vitest.config.ts` on the tree, one file | exclude a law file no runner names | 2 |
| L10. A test that holds a resource releases it through its scope | lint | vector: the 13 files as they stand, `vitest(no-hooks)` already on | the existing hook, kept in a scratch copy | 3 |
| L11. `agents-ledger.json` rows for each fixed file are gone and the file still passes `pnpm lint` | lint | format: the existing rules, unchanged | none new: the rules' own plants | 4 to 6 |
| L12. `unreachable-ledger.json` does not exist | test | scenario: the tree | write `{"entries": []}` there | 7 |
| L13. `layer-rules.json` has no `allowed` key | test | scenario: the tree | add one `allowed` row | 8 (after question 1) |
| L14. `compiler.ts` reads no ledger: a compiler finding passes only under `"use no memo"` with an `edge:` line, and `edges.ts --base` asks the owner about a new one | test, 100 runs | fc.array: functions with and without the directive and the edge line | a directive with no edge line | 9 |
| L15. No stylelint rule carries a `known` option, and `stylelint.ts` refuses one | test | scenario: `stylelint.config.ts` on the tree | add `known: ["--x"]` to one rule | 10 |
| L16. Every plugin rule has a row in `PLANTS` or `BUILTIN_PLANTS`, at a real path when the rule is path-scoped; no `elsewhere` array | test | scenario: `plugin.rules` against `PLANTS` | delete one rule's row | 12 |
| L17. No rule level is `"warn"`, and `lint.ts` has no advice set | test | scenario: the parsed `.oxlintrc.json` and `lint.ts` | set one rule to `"warn"` | 13 |
| L18. No list file: no tracked `*-ledger.json`, `*baseline*` or `*allowlist*` file outside `field/`, `fixtures/` and `experiments/results/` | test | scenario: `git ls-files` on the tree | add `next-ledger.json` back | 13 |

Lint, type or test: L5, L6, L7, L10 and L11 judge code lines, so they are lint. The rest read config
files or the file tree, not code shape, so they are tests. None is a type law.

### False alarms, measured on main

| Law | Hits on main | Real | False alarms | Note |
|---|---|---|---|---|
| L1 | 0 | 0 | 0 | no PR adds rows today |
| L2 | 2 names | 2 bound | 0 | |
| L3 | 8 overrides: 7 product files and `experiments/**` | 8 | 0 | slice 2 deletes `experiments/**`, slice 11 the other 7, and L3 turns on there at 0. Advice `"warn"` levels are L17's |
| L4 | 9 overrides | 5 drift, 2 prose homes, 2 named homes | 2, the prose TOML messages | rewritten in the same slice, so it starts at 0 |
| L5 | 1 | 1 | 0 | `record.ts:102`, fixed in the slice |
| L6 | 0 of 274 | 0 | 0 | |
| L7 | 0 | 0 | 0 | |
| L8 | 1 file | 1 run by `e2e.ts` | 0 | |
| L12 to L18 | each at its slice's end | | 0 | each turns on when its count is 0 |
| L16 | 31 skipped rules, all with a plant | | 0 | `no-redacted-value` is listed though `PLANTS` already plants it |

L3 lands in slice 11, not slice 2: turning it on earlier would need the seven product-file
overrides read as known by the test, which is itself a list.

## Files

| File | Owner | Product lines expected | Slice |
|---|---|---|---|
| `.github/ci/ledgers-shrink.ts` | tests | 70 | 1 |
| `.github/ci/ledgers-shrink.test.ts` | tests | tests | 1 |
| `.github/workflows/check.yaml` | tests | 10 | 1, 13 |
| `exam-paths.json` | tests | 6 | 1 |
| `node-kinds.json` | tests | 0 | 1 |
| `next-ledger.json` | build | rows deleted | 3, 13 |
| `agents-ledger.json` | build | rows deleted | 4 to 6, 13 |
| `oxlint-plugins/no-waivers.test.ts` | tests | tests | 1, 2, 7 to 13 |
| `.oxlintrc.json` | tests | 60 | 2, 11, 13 |
| `oxlint-plugins/no-bare-disable.ts` | tests | 20 | 2 |
| `oxlint-plugins/builtin-plants.ts` | tests | 20 | 2 |
| `oxlint-plugins/plants.test.ts` | tests | 250 | 2, 12 |
| `next/packages/libfabrika/src/cloudflare/record.ts` | build | 15 | 2 |
| `next/apps/fabrika/e2e/instance.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/brain-life.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/build.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/door.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/exam/commits-git.test-support.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/instance-one-file.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/instance-wire.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/runtime-recovery.laws.test.ts` | tests | tests | 3 |
| `next/apps/fabrika/src/runtime.laws.test.ts` | tests | tests | 3 |
| `next/packages/libfabrika/src/node/build/build-assets.test.ts` | tests | tests | 3 |
| `next/packages/libfabrika/src/node/build/build-one-file.test.ts` | tests | tests | 3 |
| `next/packages/libfabrika/src/node/build/css.test.ts` | tests | tests | 3 |
| `next/packages/libfabrika/src/processes/Process.test-support.ts` | tests | tests | 3 |
| `.agents/skills/mutation/scripts/sample.ts` | build | 120 | 4 |
| `.agents/skills/mutation/scripts/run.test.ts` | tests | tests | 4 |
| `.agents/skills/lead/scripts/botpush.mjs` | build | 60 | 5 |
| `.agents/skills/lead/scripts/botpush.test.ts` | tests | tests | 5 |
| `.agents/skills/lead/scripts/box.test.ts` | tests | tests | 5 |
| `.agents/skills/lead/scripts/chain.ts` | build | 150 | 6 |
| `.agents/skills/lead/scripts/drive.ts` | build | 220 | 6 |
| `.agents/skills/lead/scripts/drive.test.ts` | tests | tests | 6 |
| `.agents/skills/lead/scripts/gc.ts` | build | 90 | 6 |
| `.agents/skills/lead/scripts/lane.ts` | build | 40 | 6 |
| `apps/fabrika/src/editor/cells.probe.ts` | build | 20 | 7 |
| `apps/fabrika/src/editor/grid.ts` | build | 20 | 7 |
| `apps/fabrika/src/editor/history.ts` | build | 20 | 7 |
| `unreachable-ledger.json` | tests | deleted | 7 |
| `layer-rules.json` | tests | 40 deleted | 8, after question 1 |
| `next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts` | tests | tests | 8 |
| `next/packages/libfabrika/src/telemetry/Records.test.ts` | tests | tests | 8 |
| `next/packages/libfabrika/src/telemetry/Sink.test.ts` | tests | tests | 8 |
| `next/packages/libfabrika/src/telemetry/internal/measurements.test.ts` | tests | tests | 8 |
| `next/packages/libfabrika/src/telemetry/internal/sums.test.ts` | tests | tests | 8 |
| `next/packages/libfabrika/src/presence/Connections.test.ts` | tests | tests | 8 |
| `compiler-ledger.json` | tests | deleted | 9 |
| `next/apps/fabrika/src/exam/compiler.ts` | tests | 40 | 9 |
| `next/apps/fabrika/src/exam/compiler.test.ts` | tests | tests | 9 |
| `stylelint.config.ts` | tests | 60 deleted | 10 |
| `oxlint-plugins/stylelint.ts` | tests | 20 | 10 |
| `oxlint-plugins/css-support.ts` | tests | 15 | 10 |
| `apps/fabrika/src/window/window.css` | build | 80 | 10 |
| `packages/fabrika-design/tokens/color` | tests | 60 | 10 |
| `packages/fabrika/src/host/http.ts` | build | 2 | 11 |
| `packages/fabrika/src/host/local.ts` | build | 4 | 11 |
| `packages/fabrika/src/host/worker-options.ts` | build | 4 | 11 |
| `packages/fabrika/src/host/door.ts` | build | 4 | 11 |
| `packages/fabrika/src/host/durable-object.ts` | build | 2 | 11 |
| `packages/fabrika/src/host/signer.ts` | build | 2 | 11 |
| `packages/fabrika/src/agents/claude/rules.ts` | build | 4 | 11 |
| `docs/direction/secrets-are-redacted.md` | build | docs | 11 |
| `oxlint-plugins/lint.ts` | tests | 90 deleted | 13 |
| `oxlint-plugins/ledger.ts` | tests | deleted | 13 |
| `oxlint-plugins/ledger.test.ts` | tests | deleted | 13 |
| `.oxfmtrc.json` | tests | 3 | 13 |
| `AGENTS.md` | build | docs | 13 |
| `oxlint-plugins/README.md` | tests | docs | 13 |
| `docs/plan/README.md` | build | docs | each slice |

Read by the laws above, not changed (each an exam path, so the tests step owns it):

| File | Owner | Product lines expected |
|---|---|---|
| `vitest.config.ts` | tests | 0, read by L8 |
| `next/apps/fabrika/e2e.ts` | tests | 0, read by L8 |
| `next/packages/tuval/src/browser/key.laws.test.ts` | tests | 0 |
| `.github/ci/workflow-lint.ts` | tests | 0 |
| `.github/workflows` | tests | 0 |
| `.github/workflows/` | tests | 0 |
| `boundary-rules.json` | tests | 0 |
| `next/apps/fabrika/src/exam/commits.ts` | tests | 0 |
| `next/apps/fabrika/src/exam/plant.ts` | tests | 0, reused by slice 12 |
| `next/**/*.test.ts` | tests | 0, a class glob L3 reads |
| `next/**/*.test.tsx` | tests | 0, a class glob L3 reads |
| `next/**/*.test-support.ts` | tests | 0, a class glob L3 reads |
| `next/**/*Test.ts` | tests | 0, a class glob L3 reads |

## Slices

Ordered by what closes the most holes first. Each slice deletes its rows, runs as its own lane and
pull request, and is fast-tracked under 0168 (it changes no law's assertions or generators).

1. **Stop growth now.** `.github/ci/ledgers-shrink.ts` fails when a pull request adds a row to
   `next-ledger.json` or `agents-ledger.json` against `$BASE` (L1). Add `next-ledger.json`,
   `agents-ledger.json` and `node-kinds.json` to `exam-paths.json`. L2 for `node-kinds.json`. Until
   the files go, nothing can add a row. Deleted in slice 13.
2. **Config holes with no code behind them.** Delete override 7 (`experiments/**`, 0 code files).
   Put the dropped bans back in overrides 32, 39, 43, 44, 46 (0 code hits). Rewrite the two TOML
   ban messages to name their paths. Fix `record.ts:102`: type the Durable Object state through a
   typed read of Alchemy's `state.raw` and keep only a real `edge:` reason, or none. L4 to L8.
3. **The 13 after-hook rows** of `next-ledger.json` (row 2). Each test acquires what it holds with
   `Effect.acquireRelease` in its own scope (0061); the four mock resets get the same shape. Run by
   the tests step, since every file is an exam path.
4. **Lead tooling, mutation scripts** (38 rows of `agents-ledger.json`): `sample.ts` onto Effect's
   platform services and no Promises; `run.test.ts` onto `it.effect`.
5. **Lead tooling, push and box** (26 rows): `botpush.mjs` and its test, `box.test.ts`.
6. **Lead tooling, the lane scripts** (45 rows): `chain.ts`, `drive.ts`, `drive.test.ts`, `gc.ts`,
   `lane.ts`. Then `agents-ledger.json` is empty.
7. **Code-graph's dead-export ledger** (row 4). The 3 exports only tests call (`modelAnswersOf`,
   `gridOf`, `memoryHistory`) move into test support beside their tests, or go with their tests if
   the product never needs them. Delete `unreachable-ledger.json`, its CI step, and the
   `ignorePatterns` and `.oxfmtrc.json` entries. L12. Today's version: this is a fix CI needs under
   the ruling (0217).
8. **`next/` layer exceptions** (row 5, 6 rows, ticket 641): the telemetry database laws take a Sql
   maker as a suite, and `storage()` moves down beside the ledger's test support, so no test imports
   up. Delete the 6 rows. L13 turns on only once question 1's 34 rows are gone too.
9. **The compiler ledger** (row 7, empty). `compiler.ts` stops reading a ledger: the exit is
   `"use no memo"` plus an `edge:` line, which `edges.ts --base` already brings to the owner. Delete
   the file. L14. This replaces 0464's ledger row with the inline form, owner approval kept.
10. **CSS known lists** (row 8, today's app). The 28 local custom properties `token-exists` does
    not know become design-package tokens with the same values, or use an existing token. The 20
    raw colors move into the token files at the same values, so nothing looks different. The 6
    off-scale font sizes take the nearest scale step: a visible change of a pixel or two, so the
    pull request carries shots from the built app at the five layouts. Delete every `known` key and
    the runner's demand for one. L15.
11. **Per-file "off" overrides** (row 10), after question 2. Each of the 9 `Redacted.value` lines and
    the `rules.ts` lines gets its own `edge:` disable line with the reason now in the override's
    comment. Delete the 7 overrides. Change the one line in `secrets-are-redacted.md` that says edge
    files are named by path. L3 turns on.
12. **The plants list** (row 14). Delete `elsewhere`. Each of its 31 rules gets one row in `PLANTS`
    or `BUILTIN_PLANTS`; a path-scoped rule's row carries a real repo path and runs through the same
    real-config runner that `next/apps/fabrika/src/exam/plant.ts` gives the exam tests. The rules'
    own test files stay as deeper laws. L16. The duplicate `no-redacted-value` entry goes with it.
13. **Delete the readers and close the gate**, after slices 1 to 12, PR 1185's seven slices, and
    0523's fills. Delete `oxlint-plugins/ledger.ts`, `ledger.test.ts`, the ledger and advice code in
    `lint.ts`, the three "ledger committed" CI steps, `ledgers-shrink.ts`, both ledger files, their
    `ignorePatterns` and `.oxfmtrc.json` entries, and the `AGENTS.md` lines about a list that only
    shrinks. L17 and L18.

The 34 old-pipeline layer rows (row 6) are not sliced: question 1.

## Size

Each slice lands whole. No number caps one (0099).

1. Slice 1: stop growth, 90 lines.
2. Slice 2: config holes, 350 lines.
3. Slice 3: after-hook rows, 450 lines, all tests.
4. Slice 4: mutation scripts, 400 lines.
5. Slice 5: push and box, 450 lines.
6. Slice 6: lane scripts, 600 lines.
7. Slice 7: dead-export ledger, 120 lines.
8. Slice 8: `next/` layer exceptions, 350 lines.
9. Slice 9: compiler ledger, 120 lines.
10. Slice 10: CSS known lists, 300 lines.
11. Slice 11: per-file overrides, 60 lines.
12. Slice 12: plants list, 250 lines.
13. Slice 13: delete readers, 350 lines, most of them deleted.

Size confidence: 65%. The doubt is slices 4 to 6: moving lead scripts onto Effect's platform
services may touch more of `drive.ts` and `chain.ts` than their rows suggest.

Priced from `docs/plan/effect-rules-big.md` (69 steps, $85, about $1.25 a step): 13 slices at tests,
build and review, plus one send-back each.

Estimate: 52 steps, $65

## Records

What fact is lost if not recorded now: each exception's reason. The `reason` fields in
`layer-rules.json` and `unreachable-ledger.json`, and the override comments, say why each was taken.
Git keeps them, but each slice's pull request also lists, per rule, the hits it met, the ones it
fixed and each new `edge:` line with its reason, as 0523 asks, so the count and the why sit in one
place. Each slice's lane writes its rows in `field/` the same day.

## What this cannot tell

- The false-alarm counts for L3, L4 and L16 come from reading the config by hand and with `rg`, not
  from running the new laws. The build step runs each against main before it turns on.
- I did not run oxlint or stylelint; every count is from the files and `rg` on `origin/main`.
- Whether `vitest/warn-todo` in oxlint 1.90.0 also fires on `it.todo` inside a planted string in a
  lint test; the build step plants it and reads the result.
- How long the old pipeline stays, which decides how long the 34 rows of question 1 stay.
- Whether the 3 test-only exports in slice 7 are test doubles to move or dead product code to
  delete; the build reads each.

## Decision file

The ruling is [0524](../../.decisions/0524-no-list-lets-broken-code-pass.md). It leaves open the
three questions below.

## Open questions

1. **The 34 layer exceptions in today's old pipeline.** 34 law files in `packages/pipeline/src/laws`
   (13,278 lines) import our own search engine (`explore.ts`, `world/search.ts`), and
   `layer-rules.json` lets them. The ruling says fix it everywhere; 0217 says today's version gets
   only fixes daily use or CI needs, and 0168 says a break in code that an open pull request deletes
   is not fixed first. Do we port those 34 laws to tea's `@demlik/tea/pbt` now, or open a pull
   request now that deletes the old pipeline's laws with the old pipeline? My lean: neither fits
   today, so the old pipeline's deletion gets a ticket and a date, and the 34 rows stay until then,
   with L1-style shrink-only checks on them. Why: porting tests of paused code that is to be deleted
   buys nothing, and deleting tests of code still in the repo would be loosening. Cost: the gate on
   `allowed` (L13) stays open until then. 55% sure; the doubt is whether the ruling meant to cover
   code that is on its way out.
2. **The seven per-file "off" overrides for secrets.** Six `packages/fabrika/src/host/` files turn
   `no-redacted-value` off whole, and `rules.ts` turns `no-project-settings` off whole.
   `secrets-are-redacted.md` (decided 2026-10-26) chose to name edge files by path so the list sits
   in one place. Each override lets any new line in that file pass too. Do we move each to an
   `edge:` disable line on its own lines (9 `Redacted.value` lines plus `rules.ts`), as `no-promises`
   did on 2026-11-05? My lean: yes. Why: it is the same move the owner made for Promises, and today's
   ruling removes file-level waivers. Cost: about 15 lines, and one line of a decided note changes.
   80% sure; the doubt is that the note chose files on purpose.
3. **The ARIA step in CI.** `check.yaml`'s `aria` step has `continue-on-error: true`: ARIA tree
   diffs advise and never block, until "0 noise in 300 clean checks, 0 flakes". 0523 left open
   whether the false-alarm rule changes for checks other than its five rules. Is the ARIA step in
   this ruling, so it blocks now? My lean: out of this plan, asked separately, since it is a
   snapshot diff of what the app shows, not a list of named breaks. 65% sure.

## Findings

```json
{"_tag": "finding", "id": "2026-11-13-exam-commit-check-not-in-ci", "date": "2026-11-13", "by": "plan", "model": "claude-opus-5-5", "rule": "rule_break", "location": {"path": ".github/workflows/check.yaml", "line": 1}, "says": "The check that makes a build commit touching an exam path stuck (next/apps/fabrika/src/exam/commits.ts, run as pnpm commits) runs in no workflow on origin/main 7ae7cea0f, so an exam path such as unreachable-ledger.json is guarded only when the lead runs that check by hand.", "proof": "A search for 'commits' in .github/workflows/ on origin/main 7ae7cea0f finds no step that runs commits.ts or pnpm commits in check.yaml, host.yaml or mutation.yaml; the only hits are comments about a stuck mutation run.", "cost": "A pull request whose build commit edits an exam file passes CI; the guard from docs/direction/nobody-writes-their-own-exam.md holds only on the lead's hand run.", "head": "7ae7cea0f"}
```
