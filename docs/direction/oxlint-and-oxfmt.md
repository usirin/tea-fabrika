# Oxlint and oxfmt, and nothing else

Decided 2026-10-31 by the owner. This covers the whole repo: today's version, and `next/` when it
lands.

```sh
pnpm lint     # oxlint-plugins/lint.ts, format.ts --check, then the code-graph and browser checks
pnpm format   # format.ts, lint.ts --fix, format.ts
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
  A 15th, `no-bare-disable`, keeps what Biome did with an ignore comment.
- **An ignore comment names its rules and says why.** The shape is
  `// oxlint-disable-next-line <rule> -- <why>`. Oxlint itself asks for neither, and its bare comment
  silences every rule, the secret rules too. So `no-bare-disable` blocks one with no rule or no
  reason, and refuses `eslint-disable` outright. It reports at offset 0 of the file, because a report
  on the comment's own line would be silenced by that comment. A plant fails if a new oxlint changes
  that. It cannot judge a reason: `-- x` passes.
- **A plain file cannot take a folder out of the checks.** On their own, both tools obey nested
  configs and outside ignore files. So `lint.ts` and `format.ts` pin the one config and turn those
  off, and `lint.ts` fails when a `.gitignore` hides a tracked file. Each case has a plant. Running
  `oxlint` or `oxfmt` by hand skips this, and only `pnpm lint` counts.
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

The rules are the exam. The custom rules did not get weaker, and the section below shows it. The
built-in rules did get weaker, and [What it costs](#what-it-costs) lists how.

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
  - For the custom rules, Biome caught one line that oxlint did not: `as any` inside a `.js` file in
    that test set. To oxlint that is a syntax error. It stops on that file and reports it, so nothing
    passes quietly.
- **Lines Biome's built-in rules caught, and the first version of this switch did not.** A review
  planted these. These are closed now, each with a plant:
  - `./blocks.js` when only `blocks.ts` is there;
  - `export const a = (a, b);`, `[1].forEach((x) => x)` and `declare const a: {}`;
  - `<Redacted.value />`;
  - string joins, function-style callbacks and generators with no `yield` in `experiments/`;
  - a misused hook in a `.ts` file under `apps/` or `programs/`.

  The ones still open are under [What it costs](#what-it-costs).
- **Plants.** `redacted-lint.test.ts` and `rules.test.ts` kept their planted lines, and now run
  oxlint. `oxlint-plugins/plants.test.ts` plants every other rule, plus unused imports and variables,
  non-null and ts-ignore, and runs `lint.ts`.
- **Time.** Biome's step took about 12.7 seconds. Oxlint and oxfmt together take about 1.5. The
  code-graph and browser checks did not change.

## What it costs

- **Rules that have no counterpart.** These were on under Biome and are gone:
  - All CSS rules. Oxlint does not read CSS, and oxfmt only formats it. This is the largest loss.
  - All GraphQL rules. The repo has no GraphQL files.
  - All HTML rules: `useAltText`, `useHtmlLang`, `noDuplicateAttributes`. Oxlint does not read HTML.
    The repo has 4 HTML files, among them `apps/fabrika/src/window/desk.html`.
  - JSON `noDuplicateObjectKeys`. Oxlint does not read JSON, so a key written twice in a config
    passes.
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
  CACM 2018), so these stay off and are not silenced line by line. Each one that replaces a Biome rule
  is a real loss, even when none of today's lines is a real mistake: the next real one lands unseen.

| Oxlint rule | Fires | Why it stays off |
|---|---|---|
| `no-redeclare` | 701 | a const and a type of one name, which is this repo's habit |
| `no-invalid-void-type` | 61 | `Deferred.make<void>()` |
| `new-for-builtins` | 27 | `Array(4).fill(...)`, `Object(x)` |
| `prefer-tag-over-role` | 17 | it picks a tag without asking if the tag fits, see below; 2 were Biome's too |
| `no-array-index-key` | 9 | it cannot tell whether a list ever moves, see below; 3 were Biome's too |
| `no-accumulating-spread` | 5 | spreads in loops: a speed hint, not a bug |
| `no-extraneous-class` | 1 | an ambient class; `no-static-only-class` stays on |
| `ban-types` | 1 | `string & {}`; three narrower rules replace it |

  - Six of these stand for Biome rules that were on: `noRedeclare`, `noConfusingVoidType`,
    `noInvalidBuiltinInstantiation`, `noAccumulatingSpread`, `noArrayIndexKey`,
    `useSemanticElements`. Here is what now passes:

```ts
// Each passes pnpm lint today. Under Biome the first failed in programs/, not in apps/fabrika.
items.map((x, i) => <li key={i}>{x}</li>); // no-array-index-key
const f = (a: void) => a; // no-invalid-void-type
var v1 = 1;
var v1 = 2; // no-redeclare; tsc passes this too
function g(a: number) {
	var a = 1; // no-redeclare; tsc passes this too
}
```

  - ~~Each of these failed under Biome.~~ **Wrong, 2026-10-31:** not the React lines in the app's
    windows. Biome ran its React rules only where a package's `react` is a real version range. Every
    program has `^19.0.0`. `apps/fabrika` lists only `catalog:`, so Biome silently skipped them there.
    All measured with Biome 2.5.15 on the old setup:
    - A planted `useEffect(() => { console.info(p.n); }, [])` in `apps/fabrika/src/window/` passed
      Biome with `catalog:`. It failed once the range was `^19.0.0`, and it failed in
      `programs/tracker/src/`.
    - With the rules forced on, Biome finds 20 diagnostics in `apps/fabrika/src/window/` that nobody
      had ever seen: 16 of `useExhaustiveDependencies` and 4 of `noArrayIndexKey`.
    - So oxlint is a gain here. It does not skip the app. The React rules that are on, such as
      `rules-of-hooks` and `exhaustive-deps`, run there now. Of the 9 fires `exhaustive-deps` had, 6
      were in the app.
  - **`no-array-index-key` stays off.** It cannot tell whether a list ever moves. An index key only
    harms when items move and the row holds state, and the rule sees neither.
  - **`prefer-tag-over-role` stays off.** It maps a role to a tag without asking whether the tag fits.
    It tells an `<svg role="img">` to become `<img>`, and a listbox to become `<select>`. Today's 17
    fires by role: 5 img, 4 status, 3 dialog, 2 group, 1 listbox, 1 option, 1 slider.
  - `tsc` does not stand in for `no-redeclare`. It refuses a second `const`, but not those two `var`
    lines, and `experiments/` is not type-checked at all.
  - `no-array-index-key` and `prefer-tag-over-role` had ignore comments on the lines they fired.
    Those are plain comments now, with the reason kept. These, one on a CSS line, and the ones
    `exhaustive-deps` had are the 9 ignores that went. The other 81 became `oxlint-disable` comments.
- **`exhaustive-deps` is back on, and blocks.** It was left off at first as a false alarm on 9 lines,
  because more deps would change behavior. **Wrong:** adding deps is not the only fix. Those effects
  mean "run when X changes, and read Y at that moment", and `useEffectEvent` (in React since 19.2, we
  are on 19.3.1) says exactly that. All 9 are fixed with no ignore comment, and one was a real bug: an
  ask taking another's place, the count the same, stayed unseen with the list open. A plant under
  `apps/` and one under `programs/` keep it firing. Biome skipped the app.
- **Built-in rules still narrower than Biome's:**
  - `import {_a} from "effect"` passes while unused. Biome's unused-import rule ignored no name, but
    oxlint has one pattern for imports and variables. Dropping `^_` makes 18 false fires today: 16
    `infer _U` and 2 `for (const _ of ...)`, and those names cannot go. So the pattern stays.
  - `react/rules-of-hooks` reads `.tsx`, and `.ts` under `apps/` and `programs/`. All 19 of its fires
    in `.ts` files were false, all in `packages/` and `experiments/`, on names that are not React
    hooks. A real hook in a `.ts` file there is not checked.
  - `./gone.js` passes when nothing named `gone` is on disk, since a build may make it. `tsc` catches
    it where `tsc` runs, and that is not `experiments/`.
- **`checkForEach` has one false alarm, oxlint's own.** Oxlint 1.90 takes a `throw` inside a `forEach`
  callback for a returned value. So the one fire on the tree, in `experiments/59`, is false, and it
  has an ignore comment saying so. The real fire, `[1].forEach((x) => x)`, has a plant. Of 145
  `forEach` calls on the tree, that one fires. A new callback that throws will meet this too.
- **The confirmed commit and the blame file wait on the squash.** Main lands by squash, so this
  branch's format commit never reaches main.
  - The promise's `confirmed.commit` points at nothing after the merge. That was already so for every
    earlier confirm: experiment 117 chose prints for the gate for that reason. The gate's hint no
    longer names that commit.
  - `.git-blame-ignore-revs` has to name the squash commit, so that line lands right after the merge,
    as it did for Biome. Blame then also skips the real changes in that one commit.
- **JS plugins are alpha.** A rule file may need work when oxlint moves on. Exact versions are pinned
  in the catalog, and the plants fail if a rule stops firing.
- **Import extensions have no autofix.** Biome fixed them. `use-import-extensions` only refuses.
- **Old experiments.** No saved script runs Biome. Their ignore comments became oxlint's, since they
  are linted, and they were reformatted with the rest of the tree. `experiments/125-check-audit.ts`
  counts `biome-ignore` lines through `git grep`, so run again today it counts none.

## How sure

**90% that nothing custom got weaker,** on the fire counts and plants above. The doubt is what the
tree does not hold: seven rules never fired on it, so for them the hard-case file is the only proof.

**About 70% that the built-in rules are close enough.** The doubts are CSS and HTML, which now have
no linter, and the left-off rules above, which lose real catches. Fires of the left-off rules on new
code would settle it, and so would a CSS linter, which this decision does not allow today.

## What this cannot tell us

- Whether JS plugins hold up as oxlint changes. One version was tested.
- Whether a rule fires on a spelling nobody thought of. Parity covers this tree and the hard cases,
  and no more.
- What the lost Biome rules would have caught next. Their worth on new code was not measured.
  ~~The tree is clean of them today.~~ **Wrong:** the app's windows hold the 20 React diagnostics above.
- How many of those 20 are real, and how close oxlint's React rules are to Biome's. On
  `apps/fabrika/src/window/`, Biome's rule found 16 and `exhaustive-deps` found 6, and nobody has
  compared them line by line. The 6 are fixed, and the other Biome findings stay unseen.
- Whether oxfmt's small differences from Biome ever matter. Its first pass changed 122 files, +686
  -745: how an arrow function hugs its call, and in 45 of the 122 the order of the imports. The tests,
  the typecheck and `pnpm promises gate` ran on the result.
- Whether reordered imports can change what a file does at load. No test failed, and that is the only
  evidence. A module that acts on import would be the one to look at.
- Whether the owner accepts one exam change. `packages/pipeline/src/laws/review.ts` is in the `exam`
  of `review-form-for-another-head-never-counts`, not its `covers`. Only whitespace changed there, and
  the promise was confirmed again, but a confirm is not the owner's approval. The gate lists it for
  the owner.
