---
state: "decided 2026-11-07, the token file's keys included"
summary: "Both versions. Five levels (principles, foundations, tokens, components, patterns and guides), with a program's note off the map as product; every note sorted (28 keep, 9 merge, 5 split, 2 retire); a guideline page made from doc tags on the part; two token tiers plus the tile's, from one data file with contrast pairs; one focus ring; ARIA snapshots that advise first. Nine calls for the owner."
---

# Design language: the levels, the page shape, and where each note sits

**Proposed 2026-11-04; most calls decided 2026-11-07.** A draft read on main at `ffa7056f`. The
owner walked it on 2026-11-07 and decided calls 1, 2 and 4 to 9, below, with the changes written
beside each; call 3 decided the same day, with the tier words and naming grammar. Each decided call
starts on today's app at once (AGENTS.md).
Both versions: the design package is the one thing today's app and `next/` share
([one design package](./fabrika-design-package.md)). The owner's calls are at the end, each yes or
no.

Its decided rules are in: [0450](../../.decisions/0450-design-notes-sit-on-five-levels.md),
[0451](../../.decisions/0451-tokens-take-four-tiers-one-grammar.md),
[0452](../../.decisions/0452-a-token-means-one-thing.md),
[0453](../../.decisions/0453-every-token-is-toml-data.md),
[0454](../../.decisions/0454-an-aria-snapshot-per-story.md),
[0455](../../.decisions/0455-the-owner-reads-token-changes.md).

**Changed 2026-11-08:** design foundations PR 1 builds one slate a9 focus token in both looks
for today's version. `--tile-edge-on` reads `--focus`; pipes keep their own focus steps.
The examples below follow that choice.

```text
principles     one page, a few lines; plus one line of rules at the top of every page
foundations    the materials: color, type, motion, icons, layering, keys, words
tokens         the named values foundations publish, which code reads and themes change
components     parts with props, states and keys: the frame's 50 parts
patterns       how parts combine, plus guides: accessibility, content, contributing, agents
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
product        a program's own note (tracker, ticket): it uses the system, it is not it
engineering    runtime and pipeline notes: outside the design language
```

## The answer

- **Five levels,** close to how two large public design systems split theirs: Material 3 splits
  Foundations from Styles and Components ([Material 3](https://m3.material.io/foundations));
  Apple's HIG has Foundations, Patterns, Components and Inputs
  ([HIG](https://developer.apple.com/design/human-interface-guidelines)). One bend of ours: keys are
  a foundation, as Apple keeps inputs a shelf of their own.
- **44 notes sorted: 28 keep, 9 merge, 5 split, 2 retire.** Only 24 sit inside the design language.
  The rest are product or engineering.
- **The biggest gaps:** no principles page (a first draft is [principles](./principles.md)); no
  motion, content or focus foundation; no accessibility guide; three name sets for the same colors;
  one word, `turn`, meaning a fill in `themes.ts` and a text color in `window.css`; three focus
  looks; and our notes are decision records, not guideline pages.
- **What we have and did not name:** contrast laws at test time (the design package's `themes.test.ts`, the app's `colors.test.ts`, `pipes.test.ts`),
  a list of known accent uses that only shrinks, and jsx-a11y rules that block a click handler on a
  plain element.

## 1. The levels

```ts
// A sketch: the test for each level.
const Level = Schema.TaggedUnion({
	principle: {test: Schema.Literal("a rule every part and every token must follow")},
	foundation: {test: Schema.Literal("a material with nothing to press or click")},
	token: {test: Schema.Literal("a named value that code reads and a theme can change")},
	component: {test: Schema.Literal("a part you use, with its own states and keys")},
	pattern: {test: Schema.Literal("how several parts work together for one task")},
});
```

- **Principles:** short rules that settle arguments, one short page, and a line at the top of each
  page. Example: "Quiet, and accessible, and neither gives way"
  ([color principles](./color-principles.md), 1).
- **Foundations:** color, type, motion, icons, layering, words, and for us keys (the prefix, the
  notation, the keys a program cannot take). Example: [color principles](./color-principles.md).
- **Tokens:** named values. Example: `--tile-edge-on`, the focused tile's edge: `--focus`, slate a9
  in both looks, a pipe's own step inside `[data-pipe]` (`apps/fabrika/src/window/window.css`).
- **Components:** reusable parts with behavior, states and an API. [The frame](./the-frame.md) is
  this level's catalog: 50 parts, each with its word and its note. We don't split atoms, molecules
  and organisms ([atomic design](https://atomicdesign.bradfrost.com/)); the 50 parts are one list.
- **Patterns and guides:** how parts combine into a task. Example: [fold, not
  tabs](./fold-not-tabs.md). fabrika's interesting design lives between parts (tiles, pipes, modes,
  layers, key routing), so most of our notes belong here.
- **Off the map:** a program's own note is product; runtime, pipeline and build notes are
  engineering.

## 2. Every note, sorted

**keep** stays one note; **merge** folds into the one named; **split** goes to two levels;
**retire** moves to an archive list.

| Note | Level | Mark | Why |
|---|---|---|---|
| [Elm first](./elm-first.md) | principle (engineering) | keep | Every component page cites it; it is not a design page. |
| [A browser is always a client](./a-browser-is-always-a-client.md) | principle (engineering) | keep | Cited, not restated. |
| [Make the mistake impossible](./make-the-mistake-impossible.md) | principle | keep | Lint rules on day one. |
| [Use the industry's names](./use-the-industrys-names.md) | guide: content | keep | The content guide's naming half. |
| [We follow DDD](./we-follow-ddd.md) | guide: content | keep | One word, one meaning per context; the glossary is the word list agents read. |
| [Color principles](./color-principles.md) | foundation: color | keep | The color page. |
| [Pipe colors](./pipe-colors.md) | foundation: color | merge with color principles | One palette; its values go to the token data. |
| [Typography](./typography.md) | foundation: type | keep | The type page. |
| [App icon](./app-icon.md) | foundation: icons | keep | Icons are a foundation, in the HIG too. |
| [Keybindings are configurable](./keybindings-are-configurable.md) | foundation: keys | keep | The `keys` program part is product. |
| [Layers](./layers.md) | foundation and pattern | split | L1 and L2 (order, owner) are layering; L3 to L6 (keys, one modal, Esc) a pattern. |
| [Themes](./themes.md) | tokens: theming | keep | How tokens change per theme. |
| [UI on Manti](./ui-on-manti.md) | components: the library | keep | Its token mapping moves to the tokens page. |
| [The frame](./the-frame.md) | components: catalog | keep | It holds the names; the pages hold the rules. |
| [Tile guidelines](./tile-guidelines.md) | components and pattern | split | The tile, title bar and strip become part pages; moving between tiles becomes a pattern. |
| [Top bar's name](./top-bar-name.md) | component | merge with the top bar's page | One rule of one part. |
| [Popovers](./popovers.md) | components and pattern | split | Five parts, and one "which one opens" pattern. |
| [Fold, not tabs](./fold-not-tabs.md) | pattern | keep | The model pattern. |
| Tabbed is an orientation | none | retire | Replaced the same day by fold, not tabs. |
| [Modes](./modes.md) | pattern | keep | Spans the status bar, the title, Esc and every program. |
| [The ask desk](./ask-desk.md) | pattern and product | split | A2, A3, A6 are the asking pattern; the rest is the inbox program. |
| [Ask for decisions, not facts](../../.decisions/0415-ask-a-person-for-decisions.md) | pattern | merge with the asking pattern | Its one rule is the pattern's first line. |
| [Errors are diagnostics](./errors-are-diagnostics.md) | pattern | keep | How an error shows, in a terminal, a window or JSON. |
| [Program guidelines](./program-guidelines.md) | pattern and guides | split | G2 to G6 and C1 to C11 are patterns; G7 is the kit's contract; G8 goes to the content guide. |
| [One ask and one meter](./one-ask-and-one-meter.md) | engineering | keep | Data, not UI. |
| [Every wait is a queue](./every-wait-is-a-queue.md) | engineering | retire | Never taken up; the ask desk and the inbox carry it. Lean 60%. |
| [The tracker is like Linear](../../.decisions/0346-the-tracker-is-built-like-linear.md) | product | merge with tracker views and areas | One program in three notes. |
| [Tracker views are programs](./tracker-views-are-programs.md) | product | merge into the tracker's page | Its section 7 goes to program guidelines. |
| [Areas](./areas.md) | product | merge into the tracker's page, once decided | Same program. |
| [The ticket is the lane's view](./the-ticket-is-the-lane-view.md) | product | merge with what a ticket shows | One view in two notes. |
| [What a ticket shows](./what-a-ticket-shows.md) | product | merge | Same. |
| [A canvas per work](./a-canvas-per-work.md) | product (vision) | keep | A vision, not a guideline. |
| [Designs on Claude Design](./design-on-claude-design.md) | guide: contributing | keep | Where designs are drawn. |
| [One design package](./fabrika-design-package.md) | guide: contributing | keep | Where the source lives. |
| [UI verification](./ui-verification.md) | guide: testing | keep | The accessibility guide's testing half. |
| [Hot reload](./hot-reload.md) | engineering | keep | Runtime. |
| [Saved state](./saved-state.md) | engineering | keep | Runtime. |
| [React Compiler](./react-compiler.md) | engineering | keep | A build rule. |
| [The desktop layer](./the-desktop-layer.md) | engineering | keep | Layer 5's architecture. |
| [The host keeps terminals and jobs](./the-host-keeps-terminals-and-jobs.md) | engineering | keep | Runtime. |
| [Windows in `next/`](./windows-in-next.md) | engineering | keep | The OS. |
| [Pipeline guidelines](./pipeline-guidelines.md) | engineering | keep | The factory's own track. |
| [Jidoka and andon](./jidoka-and-andon.md) | engineering | merge with pipeline guidelines | Same rules. |
| [Agent hours](./agent-hours.md) | engineering | keep | A tracker field. |

**The level with almost nothing in it is tokens:** one note, themes. The real list lives only in
`window.css` and the design package's `tokens.css`.

## 3. A guideline page's shape

Our notes are decision records: a status line, leans, sources, costs, doubts. A guideline page is
a reference: what it is, when to use it, its states, keys and props. One file cannot be both well.
So a study writes both: the decision note, and the guideline as doc tags on the part in
`packages/fabrika-design`, which a sync turns into the part's page on the canvas.

```tsx
// A sketch: the guideline lives on the part.
/**
 * Names the tile and holds its marks. Not a button, and never the app's icon.
 * @usage One per open tile. A folded tile shows a `Strip`, not a title bar.
 * @do Cut the name first; the id and the state word are never cut.
 * @dont Draw a line under it: color replaces, it does not add (color principle 6).
 * @keys No tab stop. `C-b f` folds the tile; a double-click does too.
 * @a11y The tile's region carries the name (`tileName`); the slot and the id are aria-hidden.
 * @agent Mount `Fabrika.TitleBar`; never draw a title bar in markup.
 * @decided docs/direction/tile-guidelines.md#title-bar
 */
export function TitleBar(props: TitleBarProps): ReactNode;
```

- **Required sections:** overview (with what it is not), usage (when, when not, which sibling
  instead), states, keys, accessibility and props for every part; anatomy, motion and content when
  they apply. Ours add three: layouts (our five), the Linear row, and do and don't, each with
  what holds it (law, lint or taste).
- **Generated, never by hand:** the props table and the code example, from the types and the
  stories. Hand-written ones go stale.
- **What our notes lack most:** "which sibling instead". It is the one an agent gets wrong: a
  popover where a menu was meant.
- **A pattern page:** overview, parts by their frame names, the flow as one code block, the keys,
  what is announced at each step, the Elm or OTP shape, the Linear row, what holds each rule.

## 4. Tokens

```text
primitive    Radix 3.0.0 steps: slate.a4, indigo.9, grass.11            nobody's code reads these
semantic     --surface-*, --text-*, --border-*, --focus, --turn-*,      every program
             --state-*, --space-*, --radius-*, --motion-*
component    --tile-*, --pop-*                                          only the tile, only popovers
manti        --manti-*, set from the semantic tier in tokens.css        only Manti's parts
```

- **Two tiers, plus a component tier only where a part must theme its own parts.** The tile needs
  one: a pipe re-themes its title bar and edges. Radix steps already mean something (1 and 2 app
  backgrounds, 3 to 5 component backgrounds, 6 to 8 borders, 9 and 10 solid fills, 11 and 12 text;
  [Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)).
- **What we really have, read on main:** no primitive tier, since each value is a hex with its step
  in a comment; three name sets (`themes.ts`, `window.css :root`, and 12 old aliases still used);
  `turn` means the fill in `themes.ts` and the text in `window.css`; three names for one gray
  (`--text-faint`, `--text-muted`, `--text-secondary`, all slate a11); two focus values and the
  tracker's accent focus as a third look; six `color-mix()` uses that put a token at 30 to 60%; no
  raw color outside the token blocks.
- **A token means one thing; two tokens may share a primitive.** So `turn-fill` says your turn,
  and `focus-ring` is one slate token everywhere. A token used at 60% no longer has the contrast
  that was checked, so a modifier on a token is refused; ask for a token instead.
- **One data source,** TOML, not `tokens.ts` (call 5, decided 2026-11-07): one file per color token
  in the package's `tokens/color/`, each with its step per look, the tokens it sits on and the
  contrast it must reach there. The token build (`src/build/tokens.ts`) writes `tokens.css`, the
  Manti mapping and the themes' colors, with room for the canvas's `tokens.json`. The W3C Design
  Tokens format is the known shape for the JSON ([design tokens](https://www.designtokens.org/)).
  The sketch below is the earlier `tokens.ts` shape, kept as it was proposed; the decided keys are
  in `packages/fabrika-design/src/build/schema.ts`.

```ts
// A sketch. packages/fabrika-design/src/tokens.ts. A primitive is a Radix step by name.
export const tokens = {
	"text-muted": {dark: "slate.a11", light: "slate.a11", on: ["surface-base", "fill-hover"], min: 4.5},
	"focus-ring": {dark: "slate.a9", light: "slate.a9", on: ["surface-base", "surface-sunken"], min: 3},
	"surface-sunken": {dark: {hex: "#0c0d0e", bend: "nothing in slate is darker than 1"}, light: "slate.2"},
} as const satisfies Record<string, Token>;
// tokens.test.ts: every pair in `on` reaches `min` in both looks; a value that is no step needs `bend`.
```

- **Names,** a lean of about 60% each: `--surface` becomes `--surface-base`; the three grays become
  `--text-muted`; `--focus` becomes `--focus-ring`; `--done`, `--running`,
  `--stuck` become `--state-*`; `--s-1` to `--s-10` become `--space-4` to `--space-40`; the `--r-*`
  become `--radius-*`, Manti's words; `on` in a tile token becomes `focused`. The 12 aliases go, all
  in one commit: two people and one app need no deprecation step.
- **How it is held:** we have no CSS linter ([oxlint and oxfmt](./oxlint-and-oxfmt.md)), so laws are
  tests that read the stylesheets, as `type-scale.test.ts` and `colors.test.ts` do. New laws, each
  with a list that only shrinks: no raw color outside the token file, no `color-mix()` on a token,
  no px `font-size` outside a text style, a reduced-motion twin for every animation.

## 5. Accessibility inside the system

The bar is WCAG 2.2 AA, as tile guidelines already say.

```text
keys        everything works from the keyboard; a click handler only on a real control     2.1.1, 2.1.2
focus       one focus ring, from one token, visible in forced colors and more contrast     2.4.7, 2.4.11
name        every part that takes a key has a name, a role and a state, in its props       4.1.2, 2.5.3
contrast    text 4.5:1, a needed state 3:1, checked when tokens build, both looks          1.4.3, 1.4.11
color       never the only cue: a letter, a shape or a word                                1.4.1
target      24px, or the spacing exception, said out loud                                  2.5.8
motion      a reduced-motion twin for every animation; a tile has none                     2.3.3
announce    a change says itself once, in a live region made at boot                       4.1.3
```

- **Diff the accessibility tree.** For a keyboard-first app, the tree and the focus order are the
  product. Playwright's ARIA snapshots are the known tool
  ([Playwright](https://playwright.dev/docs/aria-snapshots)), and `apps/fabrika/e2e.ts` already
  drives the app. Advise first; block once its false alarms are measured.
- **A passing checker is not a working screen reader.** Nothing in fabrika has had a real run.

## 6. Design and code in sync

The code is the source, and the canvas mirrors it. When they disagree, code wins by default, then
design decides which side was wrong, and the token data changes first. A plan to sync the package
to the canvas has that shape (a producer in the package, a lock file, CI red on drift); it is not
in the repo yet. Changes this draft asks of it: sort its map into these levels; generate each
part's page from doc tags; read tokens from `tokens.ts`, not by parsing CSS; give each story an
ARIA snapshot law; keep a changelog; and list the frame's parts as "in the bundle" or "not yet", so
a canvas agent knows what it may mount.

## 7. How a guideline gets decided

As now: a study writes a proposed note, the owner walks it, and a build plan follows the same day.
Changes: the guideline page is built or not built, a second mark beside proposed or decided, so
"decided, not built" stops being invisible. A `CODEOWNERS` line could make the owner the reviewer
for `tokens.ts` and its laws, since those are the exam
([nobody writes their own exam](./nobody-writes-their-own-exam.md)). A reviewer pushes back on a
token wanted for its look, a variant only one screen needs, a modifier on a token, a copy of an
existing part with a twist, and any part with no accessibility section.

## The first pull requests

At 600 lines an agent hour ([agent hours](./agent-hours.md)):

1. This note and the guidelines skill's anatomy change: about 700 lines of prose, 1 to 1.5 agent
   hours.
2. The package, with tokens from one data file: about 1,300 new lines and 2,100 moved, 2 to 2.5
   agent hours. Sure: 65%.
3. One name per token, and the 12 aliases gone: about 650 changed lines, 1 to 1.5 agent hours.
4. The tile and its title bar, from source to canvas: about 650 new and 150 moved, 1 to 1.5 agent
   hours.
5. One focus ring, and settings at the root: about 330 lines, about 1 agent hour.

## The owner's calls

1. Take these levels, with programs off the map as product? **Decided yes, 2026-11-07.**
2. Split each design note into a decision note and a guideline page made from doc tags?
   **Decided yes, 2026-11-07.** The page is read in Claude Design's fabrika design system, and a
   sync writes it from the package, never by hand (owner, the same day).
3. Two token tiers, plus a component tier for the tile and popovers only? **Decided 2026-11-07,
   changed** (owner): four tier words, **primitive** (a Radix step, which no program reads),
   **global** (a meaning every program reads), **shared** (a state set two or more parts repeat,
   added only when they do) and **component** (a part's own tokens). Global names are
   `category-subcategory-item` (`background-surface-high`, `text-muted`); a part's are
   `part-piece-variant-category-state-interaction` (`tile-titlebar-background-selected-hover`).
   Fixed slot words: `background` (with `base` and `surface` under it), `text`, `icon`, `border`;
   `subtle`, `muted`, `strong`; `hover`, `active`, `focus`; ladders `low`/`lower`/`lowest` and
   `high`/`higher`/`highest`. Each token's data names its `owner`; the lint rule reads that field,
   never the name's prefix. The keys inside a token file were decided 2026-11-07 (owner): `type` (`background`, `text`, `icon` or `border`), `tier`, `owner`, `description`, `[colors]` with `dark` and `light`, or `extends`, or a Radix `scale`, and `on`, `floor`, `aim` and `carries`. The renames land in call 6's
   one pull request. Code never reaches a primitive: the rule is lint (`no-restricted-imports`, one
   exception for the token build), not a test (owner, 2026-11-07).
4. Restate "accent only for your turn" as "a token means one thing", with focus one slate token?
   **Decided yes, 2026-11-07.** `turn` splits into `turn-fill` and `turn-text`; focus is one gray
   token everywhere. A colored primary button stays a separate pick.
5. Tokens from one data source with their pairs and bars? **Decided yes, 2026-11-07, as TOML:** one
   file per semantic color token (for example `tokens/color/text-muted.toml`), each naming its step
   per look, what it sits on and the contrast it must reach. An Effect Schema checks every file at
   build, and the build writes `tokens.css`, the Manti mapping and the design system's data. TOML,
   as themes already are ([themes](./themes.md)); not YAML, and not one TypeScript file. Doubt kept:
   the six pipe blocks.
6. Rename in one pull request, with no deprecation step? **Decided yes, 2026-11-07,** once the
   names are settled.
7. A principles page? **Decided yes, 2026-11-07:** [principles](./principles.md) is its first draft.
8. An ARIA snapshot per story and per layout, advising first? **Decided yes, 2026-11-07,** on
   today's app first.
9. A `CODEOWNERS` line for the token files? **Decided yes, 2026-11-07, for now:** the owner reviews
   every change to the token files and their laws while the system settles, and may relax it after.

## What it cannot tell us

- Whether the levels hold up. The notes were sorted from their rows and headings, and only a few
  were read in full.
- Whether a large system's shape scales down to two people and one app.
- Whether doc tags in the source are read, by an agent or by the canvas.
- Whether one data file can hold the six pipe blocks. Nobody tried it.
- The counts are hand counts with a text search on `window.css` at `ffa7056f`.
- Anything a screen reader says. No run has happened.
