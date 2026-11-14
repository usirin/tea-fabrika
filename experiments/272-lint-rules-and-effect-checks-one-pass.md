---
date: "2026-11-09"
summary: "Both versions, main at `40b36a47`; oxlint 1.90.0, `@effect/tsgo` 0.63.0. 511 oxlint rules ran as warn in one 3.4 s pass over 1,237 files (the 61 type-aware rules did not run). All 135 Effect checks ran over 23 projects in about 25 s. Up to 10 hits were read per rule. 98 named oxlint rules plus a React set, and 35 Effect checks, fired 0 times; they landed in PR 665. 13 oxlint rules (among them `import/no-cycle` with two real cycles in libfabrika, `no-import-type-side-effects` and `no-empty`) and 7 Effect checks had 0 false alarms in the sample and could block after a small fix. `throw-new-error`, `import/export`, `no-useless-concat` and the vitest expect rules were wrong 6/6 to 11/11. An agent's editor shows no type errors: the TS 5 language server cannot start on TypeScript 7 native. `tsc --lsp --stdio` would work, 85%, untested. 0114 later made 16 more Effect checks block in `next/` (PR 958), and 262 reread them. The counts are from 11-09, not rechecked. No model, $0."
---

# 272. Which of oxlint's rules and Effect's checks that are off could block, and how often is each one wrong?

Counted on 2026-11-09, on main at `40b36a47`, in a throwaway worktree; moved here on 2026-11-11.
One oxlint pass and one `effect-tsgo diagnostics` sweep ran; no repo file changed, no model was
called beyond the one agent that read the hits, and it cost $0. **The counts cover both versions**
(every git-tracked file); the `next/`-only columns say so. Versions from the lockfile then:
oxlint 1.90.0, `@effect/tsgo` 0.63.0 (TypeScript 7.0.2 patched, `7.0.2+effect-tsgo.0.63.0`),
`typescript-language-server` 5.1.3 (installed globally, not in the repo).

**The answer: 98 named oxlint rules plus a set of React rules, and 35 Effect checks that were off
or hidden, fired 0 times and could block at once; 13 oxlint rules and 7 Effect checks fired with
no false alarm in the sample and could block after a small fix; most of the rest are wrong more
often than right.** The zero-hit rules, the
`import` and `promise` plugins and the zero-hit Effect checks landed in
[PR 665](https://github.com/usirin/tea-fabrika/pull/665). Later,
[0114](../.decisions/0114-effects-team-as-the-builder.md) made 16 more Effect checks block in
`next/` only ([PR 958](https://github.com/usirin/tea-fabrika/pull/958)), after experiment
[262](./262-effects-team-as-the-builder.md) read the checks again with all 135 on; this write-up
does not repeat 262. What had no home until now is the false-alarm rate of each rule with hits,
which AGENTS.md asks for before a rule may block (about 0% to block, up to 10% to advise, Google
CACM 2018), and the reading of why an agent sees no type errors in its editor.

```text
oxlint     872 rules listed, 572 not yet on in the enabled plugins + import, promise, node, jsdoc
           61 type-aware (not run), 511 ran as warn in one pass: 3.4 s, 1,237 files
Effect     135 checks, all on, over 23 typecheck projects: about 25 s
FP         up to 10 hits read per rule, spread across files; FP = the line is right, the rule wrong
```

## How it was measured

- **oxlint.** `oxlint --rules -f json` listed 872 rules. 572 sat in the enabled plugins plus
  `import`, `promise`, `node` and `jsdoc` and were not on. The blank-line rules were skipped, since
  another agent had them. 61 of the 572 are type-aware and could not run, because
  `oxlint-tsgolint` is not installed. The other 511 ran as `warn` in **one** pass on top of the
  config of the day, with its overrides and ignores, under `nice -n 19 --threads=3`. Rules do not
  affect each other, so one pass gives the same counts as one run per rule.
- **Effect.** `effect-tsgo diagnostics --project <pkg>/tsconfig.json --format json --lspconfig
  <all 135 rules on>` ran once over each of the 23 typecheck projects, one after another, holding
  the same lock `scripts/typecheck.sh` takes, under `nice -n 19`.
- **False alarms.** Up to 10 hits read per rule. Rules with thousands of hits were judged by
  their pattern, not one by one.

## oxlint, zero hits: turn on now

0 hits means 0% false alarms measured and also 0 evidence. Each should get a planted line in
`oxlint-plugins/plants.test.ts`. These landed in PR 665.

| Group | Rules (0 hits each) | Why |
|---|---|---|
| eslint correctness and suspicious | no-unused-expressions, no-constant-binary-expression, no-unassigned-vars, no-invalid-regexp, no-unreachable-loop, no-throw-literal, preserve-caught-error, no-implied-eval, no-new, no-extend-native, no-extra-bind, no-useless-call, no-caller, no-iterator, no-delete-var, no-empty-static-block, block-scoped-var, no-unexpected-multiline, no-new-wrappers, no-object-constructor, prefer-promise-reject-errors, symbol-description, no-var, no-return-assign, no-useless-computed-key, guard-for-in, default-param-last, yoda | Real bugs (dead expressions, `a ?? b \|\| c` precedence, a caught error dropped on rethrow); their false alarms are well known to be rare |
| oxc | missing-throw, const-comparisons, double-comparisons, erasing-op, bad-comparison-sequence, bad-char-at-comparison, bad-replace-all-arg, bad-match-all-arg, bad-object-literal-comparison, bad-array-method-on-arguments, number-arg-out-of-range, uninvoked-array-callback, only-used-in-recursion, bad-bitwise-operator | Pure bug patterns (`new Error()` with no throw, `x === {}`, `a < b < c`) |
| unicorn | no-unnecessary-await, no-await-in-promise-methods, no-single-promise-in-promise-methods, no-invalid-fetch-options, no-invalid-remove-event-listener, no-useless-length-check, prefer-set-size, no-accessor-recursion, no-empty-file, no-instanceof-builtins, no-negation-in-equality-check, no-typeof-undefined, prefer-optional-catch-binding, prefer-string-slice, prefer-includes, prefer-regexp-test, prefer-array-some, prefer-array-flat, prefer-math-min-max, error-message, prefer-type-error | Correctness first; the rest is cheap style the tree already follows |
| typescript | prefer-as-const, no-confusing-non-null-assertion, no-non-null-asserted-nullish-coalescing, no-require-imports, no-var-requires, no-namespace, triple-slash-reference, no-unnecessary-parameter-property-assignment, consistent-generic-constructors, consistent-type-assertions, unified-signatures, prefer-ts-expect-error | Fits strict TypeScript; `no-require-imports` keeps ESM only |
| vitest | valid-describe-callback, valid-expect-in-promise, require-awaited-expect-poll, hoisted-apis-on-top, no-conditional-tests, no-disabled-tests, no-test-return-statement, no-mocks-import | A test that never runs, or an `expect.poll` with no await, passes silently |
| import (new plugin) | no-self-import, no-absolute-path, first, no-mutable-exports, no-empty-named-blocks, no-named-default, no-amd, no-commonjs, no-webpack-loader-syntax | Cheap; `no-absolute-path` also backs "no machine paths" |
| promise (new plugin) | no-multiple-resolved, no-new-statics, valid-params, no-return-in-finally, no-callback-in-promise, no-promise-in-callback | Low value: only today's code uses Promises, and `next/` has `fabrika/no-promises` |
| react | the zero-hit compiler and class rules (hooks, globals, static-components, use-memo, error-boundaries, set-state-in-render, no-direct-mutation-state, jsx-no-undef, no-unknown-property, iframe-missing-sandbox, no-unstable-nested-components, jsx-no-constructed-context-values, no-deriving-state-in-effects and others) | Some overlap `pnpm lint:compiler`; still free |

## oxlint, rules with hits

File paths and lines in this section are **as of 2026-11-09 at `40b36a47`, not rechecked**;
`next/`'s folders have moved since (modules, [0091](../.decisions/0091-modules-and-layers.md)).
As of 2026-11-11, none of the "block" rows below is on in `.oxlintrc.json`.

| Rule | Hits (files) | FP in sample | Lean | Why |
|---|---|---|---|---|
| import/no-cycle | 7 (6), all in `next/packages/libfabrika` | 0/7 | block after the fix | Two real cycles with value imports: `data/ledger.ts` with `referee.ts` (through `ledger-store.ts`), and `workers/index.ts` to `fetch.ts` to `runtime.ts` and back. A cycle can leave a Layer `undefined` at load time. `code-graph --layers` checks direction between layers, not cycles inside one folder. Product code, so the fix takes the steps |
| typescript/no-import-type-side-effects | 28 (20) | 0/6 | block, autofix | `import {type A}` leaves a side-effect import at runtime; pairs with `consistent-type-imports`, already on |
| import/no-duplicates | 4 (4) | 0/4 | block, autofix | Use it, not `eslint/no-duplicate-imports` (28 hits, flags `import type` beside `import`: a false alarm under our style) |
| eslint/no-empty | 12 (6) | 0/6 | block | Every hit is a bare `catch {}`; a comment inside satisfies it, which matches "an ignore says why". Most hits were in lead scripts |
| unicorn/prefer-string-starts-ends-with | 4 (4) | 0/4 | block, autofix | `/^@/.test(s)` becomes `s.startsWith("@")` |
| eslint/no-new-func | 1 | 0/1 (meant: a test evaluates a config) | block | The eval family, so a security rule; the one line gets a disable with its reason |
| typescript/no-inferrable-types | 6 (3) | 0/6 | block, fix | `x: string = "a"` |
| unicorn/prefer-at | 19 (13) | 0/6 | block, fix | `xs[xs.length - 1]` becomes `xs.at(-1)`; same type under `noUncheckedIndexedAccess` |
| eslint/object-shorthand, eslint/operator-assignment | 2, 2 | 0/2, 0/2 | block, fix | |
| react/jsx-boolean-value, unicorn/no-useless-fallback-in-spread | 1, 1 | 0/1, 0/1 | block, fix | `...(x ?? {})` |
| unicorn/no-useless-collection-argument | 5 | 0/5 | block, fix | `new Set(x ?? [])` |
| unicorn/no-array-sort, no-array-reverse | 322, 34 | 0/10 bugs; about 8/10 sort a fresh copy | advise, or block with an autofix sweep | `toSorted` and `toReversed` fit Elm's no-mutation style; one real case: `draft.ts:181`, `objects.reverse()` changes the array in place |
| typescript/prefer-for-of | 4 | 1/4 debatable (`guard.ts:95` walks a list that grows) | advise | |
| eslint/no-useless-return | 12 | 2/2 meant (`return;` closing a switch where every other case returns) | skip | Readability, and the hits are deliberate |
| unicorn/prefer-array-find | 30 | 0/10 | advise | `filter(...).at(-1)` becomes `findLast` |
| react/set-state-in-effect | 2 | 0/2 | advise | Today's app only; `next/` keeps state in tea |
| typescript/no-explicit-any | 199 (21) | about 4/6 meant (`Running<any, ...>` existential types) | advise | `fabrika/no-type-assertions` already blocks `as any` |
| eslint/no-implicit-coercion | 5 | 1/5 (`1 * cached` for clarity) | advise | `!!x` |
| eslint/prefer-object-spread | 2 | 1/2 (typed `Object.assign<B, M>`) | advise | |
| unicorn/no-lonely-if | 5 | 0/5 | advise | Style; some nesting is on purpose |
| unicorn/prefer-structured-clone | 37 | about 2/5 (a JSON round trip, not a clone) | skip | The round trip is the point in tests |
| oxc/no-map-spread, oxc/no-accumulating-spread | 141, 5 | performance hints, not bugs | skip | The oxlint note already keeps the second off |
| unicorn/no-useless-spread | 24 | about 3/10 (a copy before a loop that changes the list) | skip | |
| typescript/consistent-type-definitions | 285 | a style call | skip | The repo uses `type` everywhere; the rule wants `interface` |
| typescript/array-type | 462 | a style call | owner pick | Both `ReadonlyArray<T>` and `readonly T[]` are used; one autofix would make it consistent |
| unicorn/throw-new-error | 78 | 6/6 | skip | Reads `Schema.TaggedError<X>()(...)` as a call to `Error` |
| import/export | 11 | 11/11 | skip | An explicit re-export already settles the clash (`packages/fabrika/src/index.ts:58`) |
| eslint/no-useless-concat | 17 | 10/10 | skip | The leak-grep tests split strings on purpose |
| unicorn/no-array-fill-with-reference-type | 15 | 10/10 | skip | Hits `writer.fill(...)`, not `Array#fill` |
| unicorn/prefer-math-trunc | 7 | 7/7, and the fix breaks code | skip | `\| 0` in SHA-256 is an int32 wrap, not a trunc |
| vitest/valid-title | 11 | 11/11 | skip | `it(name, ...)` with a string variable |
| vitest/no-standalone-expect, valid-expect, expect-expect, no-conditional-expect | 1,733, 585, 150, 329 | about 10/10 each | skip | They do not know `it.effect`, `expect(x, message)` or law helpers |
| jsx-a11y/prefer-tag-over-role, react/no-array-index-key, no-redeclare, new-for-builtins, ban-types, no-invalid-void-type | 21, 10, 681, 50, 1, 105 | see the note | skip | Kept off in [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md) for the same reasons. The one `ban-types` hit was real then (`Symbol` in `exam/promise-types.ts:81`) |
| eslint/no-shadow, consistent-function-scoping, require-await, no-loop-func, no-promise-executor-return, no-unmodified-loop-condition | 595, 691, 124, 36, 57, 7 | mostly false | skip | `Effect.gen` loops, fiber-set flags, Promise interfaces |
| jsx-a11y/no-noninteractive-element-interactions, control-has-associated-label | 5, 1 | about 5/6 | skip | Handlers on containers for arrow-key focus |
| require-post-message-target-origin, no-commented-out-tests, no-extraneous-class, promise/always-return, exhaustive-effect-dependencies | 2, 2, 7, 4, 8 | all false | skip | |
| eslint/no-undef | 1,706 | false | skip | `tsc` already does it |
| style and restriction rules (one-var, no-magic-numbers, id-length, sort-keys, curly, no-ternary, no-null, jsdoc `require-*` and others) | 1,000 to 30,000 each | n/a | skip | They clash with the settled style |

Plugins: **import, yes** (`no-cycle`'s real finds, `no-duplicates`, the zero-hit set); **promise,
maybe** (today's code only, costs nothing); **node, no** (`no-process-env` repeats
`fabrika/no-secret-env`, `no-sync` is 2,605 hits of noise); **jsdoc, no** (4,000+ `require-*`
hits for 1 real `check-tag-names` find). Import and promise landed in PR 665.

The 61 type-aware rules were not measured. The big ones are `no-floating-promises`,
`switch-exhaustiveness-check`, `no-misused-promises` and `no-unnecessary-condition`. They need
`oxlint-tsgolint`; Effect's `effect-tsgo oxlint` build and its `oxlint-presets/` (in
`@effect/tsgo` 0.63.0, for oxlint 1.90.0) are one way in.

## Effect's checks (`@effect/tsgo` 0.63.0, 135 diagnostics)

What ran on 2026-11-09: the 13 checks that error by default (`floatingEffect` among them), all at
0 hits; 15 warning checks on, at 0 hits (a warning fails `tsc`); 5 warning checks off; 58
suggestions hidden (`includeSuggestionsInTsc: false`); 44 checks off by default. The plugin takes
per-file `overrides` (`include` and `exclude`), so `next/`'s product files can be stricter than
today's code. As of 2026-11-11, `tsconfig.base.json` has two such overrides: 16 checks for all of
`next/` (PR 958), among them `errorPayloadShadowsName` and `promiseInEffectSuccess` from the table
below, and `globalErrorInEffectCatch` and `globalErrorInEffectFailure` for `next/` without tests.
Experiment 262 read every check again; the rows here are the 2026-11-09 counts, kept for their
false-alarm reads. File lines are as of `40b36a47`, not rechecked.

| Check | Default | Hits (`next/`, `next/` non-test) | FP in sample | Lean | Why |
|---|---|---|---|---|---|
| promiseInEffectSuccess | warning, off here | 1 (0) | 0/1 | error after fixing 1 | `program/shape.ts:165`: `Effect.try` around a Standard Schema `validate`, which can return a Promise, so the result can go unawaited |
| errorPayloadShadowsName | suggestion | 6 (0) | 0/6 | error after fixing 6 | Ledger errors with a `name` field (`host/ledger.ts:75-110`) shadow `Error.name`, so `String(error)` prints the wrong name |
| catchUnfailableEffect, leakingRequirements, tryCatchInEffectGen, effectMapVoid, unnecessaryPipe, unnecessaryPipeChain, catchDieToOrDie, flatMapToMap and others (28 suggestions) | suggestion | 0 | n/a | error | Free; the first two catch real mistakes |
| missingEffectServiceDependency, globalRandomInEffect, globalTimersInEffect, effectDoNotation, preferSchemaTaggedError, preferSchemaTypeProperty, schemaUnionOfLiterals | off | 0 | n/a | error | Free; they match `fabrika/no-data-taggederror` and the Schema guidance |
| globalErrorInEffectCatch, globalErrorInEffectFailure | warning, off here | 11, 18 (5 and 10 in `next/`, 0 non-test) | 0 wrong, but tests mean it | error for `next/` non-test | `next/` product code is clean, so it costs nothing and keeps it clean |
| globalDateInEffect | off | 64 (9, 8 non-test) | 0/6 | error for `next/` non-test after fixing 8 | `node/stage.ts:204,227,250` and `grant.ts:74` read `Date.now()` and skip `Clock`, so TestClock cannot drive them |
| globalFetchInEffect, processEnvInEffect, globalConsoleInEffect | off | 3, 10, 2 (`next/` non-test 3, 3, 2) | edges | advise for `next/` | Each `next/` hit is a platform edge (`grant.ts`, `local-stage.ts`, `exam/promise-types.ts`); block once the edge comment can exempt them |
| schemaSyncInEffect | suggestion | 27 (26, 5 non-test) | 0/6 | error for `next/` non-test after fixing 5 | `decodeUnknownSync` inside Effect throws a defect: `runner.ts:562,1120`, `process-store.ts:134`, `webauthn.ts:102` |
| catchToIgnore | suggestion | 5 (4) | 0/5 | error after fixing 5 | `Effect.catch(() => Effect.void)` becomes `Effect.ignore` |
| unnecessaryFailYieldableError | suggestion | 17 (4 non-test) | 0/6 | advise | Style: `yield* new E()` over `yield* Effect.fail(new E())` |
| runEffectInsideEffect | suggestion | 42 (10 non-test) | about 6/8 deliberate edges | advise | `next/` already has `fabrika/no-effect-run-outside-edge` |
| returnEffectInGen | suggestion | 8 (0) | 0/8 | advise | Today's host tests return `host.exitCode` from a gen |
| nestedEffectGenYield, lazyEffect, preferUnsafeConstructor, unnecessaryEffectGen, unnecessaryTypeofType | off or suggestion | 3, 15, 17, 10, 19 | style | advise | |
| multipleEffectProvide | warning, off here | 46 (21, 1 non-test) | about 8/8 harmless test chains | keep off, or error for `next/` non-test | Only `next/apps/fabrika/src/stage.ts:29` was product code |
| unstableApiUsage | warning, off here | 2,069 | noise (`it.effect`, `Flag`, `Arbitrary`) | keep off | Could be scoped with `allowedUnstableApis` |
| instanceOfSchema | off | 31 | about 6/6 | skip | `e instanceof TaggedErrorClass` is a correct class check |
| deterministicKeys | off | 105 | a design call | owner pick | It wants keys like `@kampus/<pkg>/<path>/<Name>`; the tree mixed `fabrika/RecordClient`, `LaneHome` and `ToyClock` |
| schemaClassMissingBrand | suggestion | 86 | a design call | owner pick | Branding every TaggedError is a real design change |
| anyUnknownInErrorContext, strictBooleanExpressions, schemaNumber, preferTypedSchemaDecoder, newSchemaClass, preferSchemaOverJson | off or suggestion | 368, 204, 277, 101, 515, 164 | mixed | skip for now | Each is a sweep of its own |
| asyncFunction, newPromise, nodeBuiltinImport, preferEffectArray, String and Record, strictEffectProvide, missingPipeableSignature, the global Date, Console, Timers, Fetch and processEnv checks outside Effect | off | 486 to 8,310 | noise or duplicates | skip | `next/` has `fabrika/no-promises` and `no-node-imports` |

## What an agent sees in its editor: no type errors at all

Read on 2026-11-09 in the lead's own Claude Code setup; nothing was tested.

- Claude Code's official TypeScript language-server plugin was installed but switched off.
- Switched on, it starts `typescript-language-server` 5.1.3, which speaks the old tsserver
  protocol and looks for `node_modules/typescript/lib/tsserver.js`. This workspace has
  TypeScript 7.0.2 native, whose `lib/` holds only `tsc.js` and `getExePath.js`, and no global
  TypeScript to fall back on. So it would fail to start. The TypeScript 5 plugin
  `@effect/language-service` is not installed either, so the `plugins` entry in
  `tsconfig.base.json` means nothing to tsserver.
- For TypeScript 7 the Effect service is built into the patched binary:
  `node_modules/.bin/tsc --lsp --stdio`, or `pnpm exec effect-tsgo tsc --lsp --stdio`, is a
  language server that reads the tsconfig plugin options.
- A small local plugin with `lspServers.typescript.command = "node_modules/.bin/tsc"` and
  `args: ["--lsp", "--stdio"]`, enabled for this project in place of the official one, would turn
  it on. About 85% sure it would work; that a plugin can point at a repo-relative binary is not
  checked. Two doubts: every agent would hold its own tsgo process, against the one-tsgo-at-a-time
  cap with up to 12 agents; and installing a plugin needs the owner's yes.

## What it cannot tell us

- A zero-hit rule has no false-alarm data. Only its planted line proves it works.
- Samples are 10 or fewer hits per rule; the rules with thousands of hits were judged by pattern.
- The 61 type-aware oxlint rules were not run.
- The Effect counts come from `effect-tsgo diagnostics`, not from `tsc`. They should match; no
  `pnpm typecheck` with the new settings checked it.
- Every count is from 2026-11-09. The tree has grown and `next/` has been reorganized since, so
  each "block after fixing n" needs a fresh count before it is turned on.
