---
id: 0023
title: next/ follows the Effect codebase's code style and doc comments as strictly as it can, and each kept difference names its reason
status: amended-in-part by [0021](0021-a-blank-line-between-top-level-statements.md), [0029](0029-format-and-names-follow-effect.md), [0032](0032-libraries-take-effects-file-layout.md)
date: 2026-11-09
tags: [style, format, lint, doc-comments, jsdoc, effect, next, readability, open-source]
---

# 0023: next/ follows the Effect codebase's code style and doc comments as strictly as it can, and each kept difference names its reason

**What this decides:** code in `next/` is written for a human reader first, in the style of the
Effect repository at the version we pin (`effect@4.1.2`), doc comments included, and any place we
differ is written down with its reason.

```ts
// Effect's shape, from packages/effect/src/Deferred.ts at effect@4.1.2 (formatted the Effect way).
/**
 * One-time coordination cells for Effect programs. ...
 *
 * @stability stable
 * @since 2.0.0
 */
import type * as Cause from "./Cause.ts"
import * as core from "./internal/core.ts"

/**
 * A `Deferred` represents an asynchronous variable that can be set exactly once ...
 *
 * **When to use**
 *
 * Use to coordinate multiple fibers around a value or failure that will be supplied exactly once.
 *
 * @stability stable
 * @category models
 * @since 2.0.0
 */
export interface Deferred<in out A, in out E = never> extends Deferred.Variance<A, E>, Pipeable {
```

*[0029](0029-format-and-names-follow-effect.md) settles indent, line width, semicolons, trailing commas, spaces in braces, the generator star, bare `of` and plural service names; the rest of this file still holds.*

## Context

`libfabrika` and the other libraries in `next/` are open source. A stranger who reads them knows
Effect's own code best, so the closest style to copy is Effect's. The owner decided on 2026-11-09
that readability for humans comes first, and that `next/` follows Effect's style as strictly as it
can, comment structure included.

Sources, all read at the tag `effect@4.1.2` of [Effect-TS/effect](https://github.com/Effect-TS/effect/tree/effect%404.1.2)
(the effect-smol line now lives there; our lockfile pins `effect@4.1.2`):

- formatter: `dprint.json` (dprint's TypeScript plugin 0.93.4);
- lint: `.oxlintrc.json`, which extends `packages/tools/oxc/oxlintrc.json`, with Effect's own
  rules in `packages/tools/oxc/src/oxlint/rules/`;
- doc comments: `.agents/skills/jsdocs/` (`declarations.md`, `categories.md`, `examples.md`),
  checked by `pnpm jsdocs --check` (`packages/tools/jsdocs`, config `jsdocs.config.json`), run in
  `.github/workflows/check.yml`;
- layout: `packages/effect/src/index.ts` (the `@barrel` block), `packages/effect/src/internal/`.

For apps, Tim Smart's repos (`lalph`, `dfx`, `cheffect`, `actualbudget-sync`, `receipts`) show the
app-level version: Prettier with `"semi": false`, 2 spaces, no doc comments on app code, and
`import {...} from "effect"` from the barrel.

## Decision

**`next/` follows Effect's code style and doc comment structure at the pinned version; a difference
stays only with a written reason in this file.**

- **Libraries** (`next/packages/*`) follow Effect's library style in full: the doc comments, the
  file layout, the import style and the lint rules below.
- **Apps** (`next/apps/*`) follow Effect's formatting and naming, and Tim Smart's app habits where
  Effect's repo has no app: no doc comment is required on app code, and imports may use the
  `effect` barrel.
- **Doc comments** follow `.patterns/doc-comments.md` (ticket 447): a module block with
  `@stability` and `@since`; on each public export one description paragraph, the optional
  `**When to use**`, `**Details**` and `**Gotchas**` sections in that order, `**Example** (title)`
  sections and never `@example`, then tags in the order `@deprecated`, `@default`, `@see`,
  `@stability`, `@category`, `@since`.
- **Where Effect has a rule and we have none, we take Effect's.** Where our rule is stricter in the
  same direction, ours stays. Where a settled decision set ours the other way, it stays until the
  owner picks, one at a time, from the list below.
- **When Effect changes its style in a version we bump to, `next/` follows on that bump.**

### What differs, and what happens to it

| Area | Effect at 4.1.2 | Ours today | Set by | Outcome |
|---|---|---|---|---|
| Indent | 2 spaces (`dprint.json` `indentWidth: 2`) | tabs | [oxlint and oxfmt](../docs/direction/oxlint-and-oxfmt.md), 2026-10-31 | open: owner picks |
| Line width | 120 | 100 | the same note | open: owner picks |
| Semicolons | none (`semiColons: "asi"`) | always (oxfmt's default, kept from Biome) | the same note ("keeps the old settings") | open: owner picks |
| Trailing commas | never (`trailingCommas: "never"`) | always (`trailingComma: "all"`) | the same note | open: owner picks |
| Spaces in braces | `import { dual } from` (dprint default) | `import {dual} from` (`bracketSpacing: false`) | the same note | open: owner picks |
| Generator star | `function*() {` (dprint) | `function* () {` (oxfmt prints it, no setting) | the formatter choice, same note | open: owner picks, only by changing formatter |
| Formatter | dprint | oxfmt | the same note | kept: the note settled oxfmt; it can print every setting above except the star |
| Quotes, arrow parens, import sort | double, always, case-insensitive | the same | | same |
| Blank lines | a blank line at about 93% of top-level boundaries after a multi-line statement in `packages/effect/src` (7,896 of 8,527), not enforced | enforced by a rule, with one-line groups kept ([PR 659](https://github.com/usirin/tea-fabrika/pull/659), 0021) | 0021, open as PR 659 | kept: stricter, same direction |
| Braces on `if` | one-statement `if (x) return y` with no braces is common (2,228 lines in `packages/effect/src`), no `curly` rule | braces on every body, `eslint/curly` `all` | owner, 2026-11-09, 0021 (ticket 439) | differs: human readability |
| Blank lines around blocks | not enforced | a blank line before and after each `if`, loop, `switch` and `try` | owner, 2026-11-09, 0021 (ticket 439) | differs: human readability |
| Library imports | namespace import by module path, `import * as Effect from "effect/Effect"`; `effect/no-import-from-barrel-package` bans the barrel in package code | `import {Effect} from "effect"` (170 import lines in `next/`) | | follow in libraries; apps keep the barrel |
| Type imports | `consistent-type-imports` with `fixStyle: "inline-type-imports"` | `consistent-type-imports`, default fix style | | follow |
| Array types | `typescript/array-type` generic: `ReadonlyArray<A>`, `Array<A>` | no rule | | follow |
| `console` | `eslint/no-console` is an error in package code | no rule | | follow in libraries |
| File names | one public module per file, PascalCase (`Deferred.ts`); implementation in `src/internal/` in camelCase, every export there `/** @internal */` | kebab-case (`door-nonce.ts`), no `internal/` folder | | follow; renames go in one sweep ticket |
| Barrel | `index.ts` re-exports each module as a namespace, `export * as Deferred from "./Deferred.ts"`, each with its own doc block | `index.ts` re-exports names (`export {Door} from ...`) | | follow in libraries |
| Options | inline in the signature, `readonly` fields, `\| undefined` on optional ones | mixed | | follow |
| Doc comments | required on every public export, with `@stability`, `@category`, `@since` | 0 `@since` in `next/`; `pnpm jsdocs --check` finds 92 places in `libfabrika` | | follow, `.patterns/doc-comments.md` |
| Bare `of` | `Array.of`, `Chunk.of`, `Iterable.of`, `Request.of` exist | banned in `next/` (AGENTS.md) | owner, AGENTS.md | open: owner picks |
| Plural service names | `Runners`, `Servers`, `Notifications`, `Dimensions` are services | never plural; `<Thing>Manager` (AGENTS.md) | owner, AGENTS.md | open: owner picks |
| Tag key | `_tag` | `_tag` | AGENTS.md | same |

## Consequences

- **Open: owner picks, one at a time.** Each keeps today's setting until the owner answers. None is
  changed by this decision.
  - open: indent, tabs or 2 spaces.
  - open: line width, 100 or 120.
  - open: semicolons, always or none.
  - open: trailing commas, always or never.
  - open: spaces inside braces, `{a}` or `{ a }`.
  - open: the generator star, `function* ()` (oxfmt) or `function*()` (dprint). Only a formatter
    change gives Effect's spelling.
  - open: bare `of` in `next/`, banned or allowed where Effect uses it.
  - open: plural service names, `<Thing>Manager` or Effect's plural names.
- **Follow, each as its own lead-tooling or sweep ticket:** the import style, inline type imports,
  generic array types and `no-console` in libraries; PascalCase module files with `internal/`; the
  namespace barrel; doc comments on every public export.
- **What holds the doc comments.** Effect's checker (`packages/tools/jsdocs`) is private, not on
  npm. Copied into a scratch folder with `effect@4.1.2`, `glob` and TypeScript 5.9 (it needs the
  TypeScript JS API; our TypeScript 7 has none), it ran on both trees. On Effect's own 144 modules
  in `packages/effect/src` it reports one file, `StandardSchema.ts`, which Effect's config excludes,
  so 0 false alarms. On `next/packages/libfabrika/src` it reports 92 places; a hand read of 20
  (seed 119120) found 20 real exports missing a doc or its tags, 2 of them in `*.test-support.ts`
  files a config would exclude. Oxlint 1.90.0's `jsdoc` plugin has no rule that requires a doc on an
  export, and its `require-param` and `require-returns` fire 1,494 and 1,679 times on Effect's
  correct tree, so they stay off. Which tool blocks is the pattern ticket's call.
- **Cost.** The follow items touch most files in `next/`. They are sweeps, not hand edits, and each
  lands as its own pull request.
- **Decided since:** a `curly` rule and blank lines around blocks, both differences from Effect
  ([0021](0021-a-blank-line-between-top-level-statements.md), ticket 439).
- **Not decided here:** the open items above; `@since` values while `libfabrika` is `0.0.0`.
