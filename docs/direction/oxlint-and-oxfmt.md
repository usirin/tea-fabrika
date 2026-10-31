# Oxlint and oxfmt, and nothing else

Decided 2026-10-31 by the owner. This covers the whole repo: today's version, and `next/` when it
lands.

```sh
pnpm lint     # node oxlint-plugins/lint.ts, oxfmt --check, then the code-graph and browser checks
pnpm format   # oxfmt, oxlint --fix, oxfmt
```

```ts
// A sketch of oxlint-plugins/no-numeric-duration.ts. A custom rule is TypeScript now, not GritQL.
export const noNumericDuration: CreateRule = {
	create: (context) => ({
		CallExpression(node) {
			const duration = durationArgument(node); // Effect.sleep(5000) answers the 5000
			if (duration !== undefined && isNumber(duration))
				context.report({node: duration, message: "Say the unit: Duration.seconds(5), not 5000."});
		},
	}),
};
```

## What was decided

- **Oxlint lints and oxfmt formats.** Biome is gone: no dependency, config, plugin folder or ignore
  comment. Only records still name it: `experiments/`, `field/`, `blog/`, `video/`, and history
  lines such as the rule counts and this note.
- **The custom rules stay.** All 13 are oxlint JS plugin rules in
  [`oxlint-plugins/`](../../oxlint-plugins/README.md), with their reasons and old counts. A 14th,
  `use-import-extensions`, stands in for a Biome built-in that oxlint's own rule only partly covers.
- **A warning still fails `pnpm lint`.** Oxlint has only `warn` and `error`, and two rules only
  advise. So `oxlint-plugins/lint.ts` runs oxlint once and decides:
  - it prints every fire;
  - it fails on any fire but `no-effect-promise` and `no-raw-try-catch`;
  - it fails too if oxlint crashed, or looked at no file.

  Why one run and not two: a disable comment for a rule that is off counts as unused, and unused ones
  fail. A second run for the advice rules would fail the first on their own comments.
- **Oxfmt keeps the old settings:** tabs, 100 columns, no bracket spacing, imports sorted. It leaves
  Markdown, YAML and fixtures alone, as Biome did.

## Why it can be trusted

The rules are the exam, so the move had to show that nothing got weaker.

- **Same fires.** Before the move, every rule ran on main with Biome, ignore comments and path
  exceptions turned off, so no fire could hide. Then the new rules ran on the same tree. No line
  differs.

| Rule | Biome | Oxlint |
|---|---|---|
| `no-raw-try-catch` | 110 | 110 |
| `no-effect-promise` | 46 | 46 |
| `no-redacted-value` | 36 | 36 |
| `no-project-settings` | 32 | 32 |
| `no-secret-env` | 26 | 26 |
| `no-type-assertions` | 9 | 9 |
| the other 7 | 0 | 0 |

- **Odd spellings.** Seven rules never fire on the tree, so a file of hard cases tested them all:
  Biome 301 fires, oxlint 319.
  - The 18 extra fires are spellings like `(Effect.all)(xs)` and `(process.env).X`. Those are real
    mistakes that the old rules missed.
  - Biome caught one line that oxlint did not: `as any` inside a `.js` file in that test set. To
    oxlint that is a syntax error. It stops on that file and reports it, so nothing passes quietly.
- **Plants.** `redacted-lint.test.ts` and `rules.test.ts` kept their planted lines, and now run
  oxlint. `oxlint-plugins/plants.test.ts` plants every other rule, plus unused imports and variables,
  non-null and ts-ignore, and runs `lint.ts`.
- **Time.** Biome's step took about 12.7 seconds. Oxlint and oxfmt together take about 1.5. The
  code-graph and browser checks did not change.

## What it costs

- **Rules that have no counterpart.** These were on under Biome and are gone:
  - All CSS rules. Oxlint does not read CSS, and oxfmt only formats it. This is the largest loss.
  - All GraphQL rules. The repo has no GraphQL files.
  - Rules whose oxlint counterpart needs type information, which this setup does not run:
    `useLiteralKeys`, `useOptionalChain`, `useExportType`.
  - 20 rules with no usable counterpart: `noSvgWithoutTitle`, `noEmptyTypeParameters`,
    `noFlatMapIdentity`, `noThisInStatic`, `noUselessContinue`, `noUselessStringRaw`,
    `noUselessUndefinedInitialization`, `useSimpleNumberKeys`, `noStringCaseMismatch`,
    `noVoidTypeReturn`, `noDynamicNamespaceImportAccess`, `noDuplicateParameters`,
    `noImplicitAnyLet`, `noOctalEscape`, `noRedundantUseStrict`, `noSuspiciousSemicolonInJsx`,
    `noDeprecatedMediaType`, `useGoogleFontDisplay`, `noComponentHookFactories`,
    `useReactAsyncServerFunction`.
  - `noAssignInExpressions` became `no-cond-assign`, which is narrower.
- **Oxlint rules left off, because they fired falsely.** Blocking needs about 0% false alarms (Google
  CACM 2018), so these stay off and are not silenced line by line. Some of them replace a Biome rule
  that was on, and that part is a real step down.

| Oxlint rule | Fires | Why it stays off |
|---|---|---|
| `no-redeclare` | 700 | a const and a type of one name, which is this repo's habit; `tsc` catches real ones |
| `no-invalid-void-type` | 60 | `Deferred.make<void>()` |
| `new-for-builtins` | 27 | `Array(4).fill(...)`, `Object(x)` |
| `prefer-tag-over-role` | 17 | 2 were Biome's too, and the fix changes the DOM |
| `exhaustive-deps` | 9 | effects that mean to run on fewer deps; more deps change behavior |
| `no-array-index-key` | 8 | lists that never move; 3 were Biome's too |
| `no-accumulating-spread` | 5 | spreads in loops: a speed hint, not a bug |
| `no-extraneous-class` | 1 | an ambient class; `no-static-only-class` stays on |
| `ban-types` | 1 | `string & {}`; three narrower rules replace it |

  `exhaustive-deps`, `no-array-index-key` and `prefer-tag-over-role` were on under Biome, with ignore
  comments on the lines they fired. Those are plain comments now, with the reason kept. A new line of
  any of the three will no longer be caught. These, and one on a CSS line, are the 9 ignores that
  went. The other 81 became `oxlint-disable` comments.
- **`react/rules-of-hooks` reads `.tsx` only.** All 19 of its fires in `.ts` files were false, on
  functions named `useX` that are not React hooks. A real hook in a `.ts` file is no longer checked.
  Today only two test files with a `.ts` name import React.
- **JS plugins are alpha.** A rule file may need work when oxlint moves on. Exact versions are pinned
  in the catalog, and the plants fail if a rule stops firing.
- **Import extensions have no autofix.** Biome fixed them. `use-import-extensions` only refuses.
- **Old experiments.** No saved script runs Biome. Their ignore comments became oxlint's, since they
  are linted, and they were reformatted with the rest of the tree. `experiments/125-check-audit.ts`
  counts `biome-ignore` lines through `git grep`, so run again today it counts none.

## How sure

**90% that nothing custom got weaker,** on the fire counts and plants above. The doubt is what the
tree does not hold: seven rules never fired on it, so for them the hard-case file is the only proof.

**About 75% that the built-in rules are close enough.** The doubt is CSS, which now has no linter.
Fires of the left-off rules on new code would settle it, and so would a CSS linter, which this
decision does not allow today.

## What this cannot tell us

- Whether JS plugins hold up as oxlint changes. One version was tested.
- Whether a rule fires on a spelling nobody thought of. Parity covers this tree and the hard cases,
  and no more.
- What the lost Biome rules would have caught next. The tree is clean of them today, so their worth
  on new code was not measured.
- Whether oxfmt's small differences from Biome ever matter. Its first pass changed 122 files, +686
  -745, mostly how an arrow function hugs its call. The tests, the typecheck and `pnpm promises gate`
  ran on the result. One promise's covered code moved that way
  (`review-form-for-another-head-never-counts`) and was confirmed again, since only whitespace
  changed.
