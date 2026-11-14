---
state: "decided 2026-11-02"
summary: "Both versions. fabrika's design lives in `@kampus/fabrika-design`, modeled on phoenix's `@kampus/design`, and today's app and `next/` both import it. First slice: the colors (`themes.ts` and its tests), the Manti mapping (`theme.css`, now the package's `tokens.css`) and the six text styles typography decided (`textStyles`); later the lint that holds \"every size comes from a text style\", and a design-system page made from it. It is the one shared piece, because its contents come from settled notes, not today's shapes; moving means rethinking each file against them. Moved in P31 to `packages/fabrika-design`. Open: publishing. *Changed 2026-11-07 (P31): \"text roles, proposed\" became the text styles typography decided.*"
---

# One design package, shared by both versions

**Decided 2026-11-02.** Both versions. fabrika's design lives in its own package,
`@kampus/fabrika-design`. Today's app and `next/` both import it. It is modeled on `@kampus/design`
in the public [kamp-us/phoenix](https://github.com/kamp-us/phoenix/tree/main/packages/design) repo.
Moved in P31 ([PR 431](https://github.com/usirin/tea-fabrika/pull/431)): `packages/fabrika-design`
holds the themes (`src/themes.ts`) and `src/tokens.css`, the tokens with Manti's set from them.

Its decided rules are in: [0456](../../.decisions/0456-one-design-package-both-versions.md),
[0453](../../.decisions/0453-every-token-is-toml-data.md),
[0451](../../.decisions/0451-tokens-take-four-tiers-one-grammar.md).

Decided by the owner, 2026-11-08: every token is TOML data, not only the colors: type sizes,
fonts, spacing, radius, row heights and motion, with the same build, schema and drift check. It
starts after typography PR 1 merges; its plan is in progress.

```ts
// A sketch. The names and paths are guesses until the move's pull request.
// @kampus/fabrika-design
export { fabrika, fabrikaLight, terminalTheme, type Theme } from "./themes.ts"; // the colors
export { textStyles, type TextStyle } from "./text-styles.ts"; // the text styles, not moved yet
// @kampus/fabrika-design/tokens.css: our color tokens, and Manti's --manti-* tokens set from them

// today's app, apps/fabrika
import { fabrika, terminalTheme } from "@kampus/fabrika-design";
import "@kampus/fabrika-design/tokens.css";

// next/, a window
import { textStyles } from "@kampus/fabrika-design";
import "@kampus/fabrika-design/tokens.css";
```

## What goes in

The first slice:

- **The colors.** They were in `apps/fabrika/src/themes.ts`, held by `themes.test.ts` and
  `themes.frame.test.ts`, and now are in the package's `src/themes.ts`, with those tests. The window also writes them as tokens in `window.css`'s `:root`, which the
  Manti mapping points at, so those tokens come along.
- **The Manti mapping.** It was `apps/fabrika/src/window/theme.css`, and now is in `tokens.css`: Manti's `--manti-*` tokens,
  set from our own names ([UI on Manti](./ui-on-manti.md)).
- *Changed 2026-11-07 (design language, call 5; built in design foundations PR 2, ticket 263):* the
  colors and the Manti mapping are data now. Each color token is one TOML file in
  `tokens/color/`, with its steps, what it sits on and the contrast it must reach there, and
  `tokens/manti.toml` maps Manti's tokens. The token build (`src/build/tokens.ts`, `pnpm tokens`)
  checks every floor and writes `tokens.css`'s two marked regions, `src/theme-colors.ts` (which
  `themes.ts` reads) and `src/token-names.json`. `pnpm lint` fails when one has drifted. Only that
  build imports `@radix-ui/colors` 3.0.0.
- **The text styles,** from [typography](./typography.md). Six text styles on Manti's `Text` and
  `Heading`: `title`, `heading`, `strong`, `body`, `quiet`, `label`, in `text-styles.ts`. *Changed
  2026-11-07 (P31): they were "text roles", proposed; typography decided them as text styles on
  2026-11-02. They land in their own row, not in P31.*

Later:

- **A lint that holds "every size comes from a text style".** Its false alarms are measured before it
  blocks, as every blocking check is.
- **A design-system page,** made from the package's data, never written by hand
  ([data first](./data-first-markdown-is-a-view.md)).

phoenix's package also holds fonts, shared components and a property-based accessibility suite. Ours
can grow the same way, one decided piece at a time. None of that is in the first slice.

## Why one package for both versions

- **The rule against sharing is about shapes, not facts.** `next/` never imports today's code because
  today's shapes were never thought through again ([rethink, do not port](./rethink-do-not-port.md)).
  The design package is different: what it holds comes from settled notes,
  [themes](./themes.md) and [color principles](./color-principles.md), not from how today's app
  happens to be built.
- **One source of truth for what a person sees.** If the two versions each kept their own colors,
  they would drift, and a fix to contrast in one would miss the other.
- **It is the first piece of the new version that today's app also uses.** Today's app takes it
  first, because that is where the colors and tests already run.
- **It is the known way.** A monorepo with more than one app puts its tokens and its shared parts in
  one design package that each app imports. phoenix does exactly this for its web app and a planned
  second app.

## How it fits rethink, do not port, and clean slate

- **Moving is rethinking.** Each file is read again against the notes before it moves. A value or a
  rule the notes do not back is fixed or dropped on the way, never copied over as it is.
- **It is not today's code.** Once moved, it is the new version's package that today's app happens to
  use. `next/` imports it like any other package of its own.
- **Clean slate still holds.** [Clean slate](./clean-slate.md) says the new code grows beside the old
  and the old part goes when the new one takes its job. Here the new piece takes the job right away:
  the pull request that moves the files deletes the old copies from `apps/fabrika`, with their tests
  moved first.
- **The one exception is named.** [AGENTS.md](../../AGENTS.md) lists it under "Two versions, side by
  side", so no agent reads it as leave to share anything else.

## What is open

- **The folder.** `packages/fabrika-design`, beside the others (P31).
- **Whether it is published.** phoenix publishes its package to npm. Ours aims at two people working
  together first, so publishing is later.
- **When the move happens.** The move is its own pull request, through the pipeline's steps like
  every other ([the steps](./next-is-a-pipeline-pre-run.md)).
- ~~How the text roles look in code.~~ *Changed 2026-11-07 (P31): settled. [Typography](./typography.md)
  shows them in code as `textStyles`, decided 2026-11-02.*

## What it costs

About half an agent hour to move the two files and their tests, plus the tokens in `window.css` they
point at. Then the text styles, decided in typography. The lint and the design-system page come after
and are sized then.

How sure: 85% that one package is the right home. The doubt: `next/` has no window on main yet, so the
package's shape is set by one user until the second arrives.

## What it cannot tell us

- Whether today's token names fit `next/`'s windows. Only the first `next/` window will show that, and
  it may rename some.
- Whether the colors, the tokens and the Manti mapping can be pulled apart cleanly from the rest of
  `window.css`. The move's pull request will find out.
- How the theme files people bring ([themes](./themes.md)) sit beside built-in values in a package.
  That is Tier 2's question.
