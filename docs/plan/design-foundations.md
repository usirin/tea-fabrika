# Plan: the design language's decided calls, on today's app

**Approved by the owner, 2026-11-07,** with the focus ring kept at slate a9 for now. Built as
tracker ticket 245, in three pull requests.

- **Version and scope.** Today's version only: `packages/fabrika-design`, `apps/fabrika`, `programs/tracker`, `oxlint-plugins` and the root config. Nothing in `next/`.
- **What it builds.**
  - Design-language calls 4, 5, 8 and 9 (PR 470, decided 2026-11-07).
  - The lint half of call 3 ("code never reaches a primitive").
  - The 2026-11-07 change to oxlint and oxfmt that gives CSS stylelint.
  - The AGENTS.md line that a decided product foundation starts on today's app at once.
- **When it starts.** Once PR 470 merges.
- **What stays open.** Call 3 (the tier names) and call 6 (the renames). This plan renames nothing but the `turn` split, which call 4 decides.
- **The ticket.** File the build as a tracker ticket with `from` set to PR 470.

Items marked **(new)** were added by the lead agent on 2026-11-07, after the brief, from a reference the owner asked for. They are our own rules, and they do not settle call 3.

## The whole idea

```text
today, on main at 164daff6                     after these three pull requests
--focus (slate a9) and --tile-focus (a8 dark)  --focus, slate a9 in both looks: every ring, every focused edge
the tracker's rings in --key (indigo 9)        the tracker's rings in --focus; --key keeps its non-focus uses
--turn is text in CSS, turn is fill in TS      --turn-text and turn-fill: each name means one thing
tokens.css colors typed by hand as hex         tokens/color/<token>.toml -> build -> a generated region of tokens.css,
                                               src/theme-colors.ts, src/token-names.json, the Manti mapping; room for tokens.json
Radix values from a JSON in experiments/       @radix-ui/colors 3.0.0, exact, imported only by the token build (oxlint)
CSS shape held only by tests                   stylelint 18.0.0 in pnpm lint, every rule an error from day one:
                                               a var() names a listed token; no raw color; no color-mix; no Radix
                                               step variable; a part's token only in its stylesheet; motion only
                                               under the reduced-motion guard; px font-size only from the scale
no ARIA check                                  an ARIA snapshot per key state at the five layouts, printed in CI, never failing
no code owner                                  .github/CODEOWNERS: the owner on the token files and their laws
```

Three pull requests, in the order the owner sees them:

1. PR 1 changes pixels.
2. PR 2 moves the values into data.
3. PR 3 adds the linter.

Each lands whole.

## The data shape

### A token file

**Keys decided by the owner, 2026-11-07, after the owner's reference shape landed. These win over the sketches below wherever they differ:**

- `job` is `type`, a closed set of call 3's category words: `background`, `text`, `icon`, `border`. Today's `surface` and `fill` are `background`, `line` is `border`, and `on-fill` is `text`. There's no catch-all.
- `says` is `description`.
- `dark` and `light` move under `[colors]`. `same = "x"` is `[colors] extends = "x"`.
- Every file has `tier` (`primitive`, `global`, `shared`, `component`) and `owner`.
- `on`, `floor` and `aim` stay as they are: a floor and a target are two words, never one.
- There's no high-contrast key, since forced colors drops the theme. There are no Figma, codegen or platform keys.
- Q13 is decided: borders say `carries = "nothing"`.

```toml
# tokens/color/text-faint.toml
type = "text"
tier = "global"
owner = "design"
description = "every quieter word"
on = ["surface", "surface-raised"]
floor = 4.5

[colors]
dark = "slate.a11"
light = "slate.a11"
```


One file per semantic color token, named after today's token. Nothing is renamed; call 6 renames later, in one pull request.

```toml
# packages/fabrika-design/tokens/color/text-faint.toml
format = 1
job = "text"             # surface | line | icon | fill | text | on-fill
group = "text"           # which section of tokens.css it is written in
says = "every quieter word: secondary, muted and faint alike (decided 2026-11-02)"
theme = "faint"          # its key in themes.ts's Colors, when the terminal or the frame reads it
dark = "slate.a11"
light = "slate.a11"
on = ["surface-sunken", "surface", "surface-raised",
      "surface-hover/surface", "surface-hover/surface-raised",
      "surface-selected/surface", "surface-selected/surface-raised"]   # "a/b": a drawn over b
floor = 4.5              # a hard floor: the build fails under it, in either look
aim = 7                  # (new) a target: the build prints the pairs under it and does not fail
```

```toml
# tokens/color/focus.toml: the one focus token, after PR 1
format = 1
job = "line"
group = "lines"
says = "every keyboard ring and the focused tile's edge"
theme = "focus"
dark = { step = "slate.a9", bend = "a solid step as a line: a8 reads 2.82 on a selected row" }
light = { step = "slate.a9", bend = "a solid step as a line: a8 reads 1.90 on the desk" }
on = ["surface-sunken", "surface", "surface-raised", "surface-selected/surface"]
floor = 3
```

```toml
# tokens/color/surface-hover.toml: (new) a translucent value names its backdrop, even a surface
job = "surface"
dark = "slate.a3"
light = "slate.a3"
on = ["surface", "surface-raised"]
```

```toml
# tokens/color/tile-edge-on.toml: a part's token, pointing at another
same = "focus"
owner = "tile"           # (new) only the tile's stylesheet may name it; the prefix is never read
```

```toml
# tokens/color/surface-sunken.toml: a value that is no step carries its reason
dark = { hex = "#0c0d0e", bend = "nothing in slate is darker than 1" }
light = "slate.2"
```

```toml
# tokens/color/turn-fg.toml: a named exception holds at its printed value, with its ticket
except = [{ on = "turn-fill-hover", look = "dark", ratio = 4.28, ticket = 153,
            why = "the owner kept Radix's indigo 10" }]
```

```toml
# tokens/parts.toml: (new) which stylesheets each owner's tokens may appear in
[tile]
stylesheets = ["apps/fabrika/src/window/window.css"]
```

`tokens/manti.toml` maps each `--manti-*` to one of our tokens by name, or to a plain value with its reason (today's `28px` control height, law 11's `PLAIN` list).

### The schema

This is a sketch in Effect Schema (effect 4.1.1, from the catalog). The names follow effect 4.1.1's `Schema.d.ts`.

```ts
// packages/fabrika-design/src/build/schema.ts
const StepName = Schema.String.check(
	Schema.isPattern(/^(slate|indigo|grass|amber|red|black|white)\.a?([1-9]|1[0-2])$/),
);
const Value = Schema.Union([
	StepName,
	Schema.Struct({step: StepName, bend: Schema.NonEmptyString}),
	Schema.Struct({hex: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)), bend: Schema.NonEmptyString}),
]);
const Bar = Schema.Literals([3, 4.5, 7]);              // a WCAG number, never any number
const Job = Schema.Literals(["surface", "line", "icon", "fill", "text", "on-fill"]);
export const TokenFile = Schema.Union([
	Schema.Struct({format: Schema.Literal(1), same: Schema.NonEmptyString,
		owner: Schema.optionalKey(Schema.NonEmptyString), says: Schema.optionalKey(Schema.String)}),
	Schema.Struct({
		format: Schema.Literal(1), job: Job, group: Schema.NonEmptyString, says: Schema.NonEmptyString,
		theme: Schema.optionalKey(Schema.NonEmptyString),
		owner: Schema.optionalKey(Schema.NonEmptyString),  // (new)
		dark: Value, light: Value,
		on: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
		floor: Schema.optionalKey(Bar),                      // a hard floor
		aim: Schema.optionalKey(Bar),                        // (new) a target, never a failure
		carries: Schema.optionalKey(Schema.Literal("nothing")),
		except: Schema.optionalKey(Schema.Array(Except)),
	}),
]);
```

The build also checks things one file's schema cannot see. Every error names the file and the field.

- Job `text` needs `on` and `floor` 4.5 or more.
- **(new)** Every non-text job (`line`, `icon`, `fill`: borders, icons, the focus ring) needs `on` and `floor` 3 or more. The one way out is `carries = "nothing"`, for a value no fact rides on.
- **(new)** A value with alpha under 1 in either look (an `a` step, black or white alpha, an 8-digit hex) needs `on`, its backdrop, whatever its job. Contrast is computed over that backdrop.
- **(new)** A token name appears once across the TOML files, `manti.toml` and the hand-written part of `tokens.css`. A duplicate is an error. So is the same name in two cases, since macOS's file system folds case.
- A file's name is its token.
- Every name in `on` and `same` exists, and `same` has no cycle.
- An `owner` is named in `parts.toml`.
- An unknown key fails.

### What the build writes

`node packages/fabrika-design/src/build/tokens.ts` reads the files and decodes them. It resolves each step against `@radix-ui/colors` 3.0.0 and checks every pair with `src/build/contrast.ts`. Then it writes:

```css
/* packages/fabrika-design/src/tokens.css, abridged */
:root {
	color-scheme: light dark;
	/* @generated colors from tokens/color/*.toml by src/build/tokens.ts. Edit the TOML, then pnpm tokens. */
	/* Lines. */
	--focus: light-dark(#00051d74, #dfebfd6d); /* slate a9; slate a9 */
	--text-faint: light-dark(#0007149f, #f1f7feb5); /* slate a11 */
	--tile-edge-on: var(--focus);
	/* @end generated colors */
	/* Type, room, shape and motion: written by hand, as today. */
	--fs-body: 13px;
	/* @generated manti from tokens/manti.toml */
	--manti-focus-ring: var(--focus);
	/* @end generated manti */
}
/* the keycap rule, by hand, as today */
```

```ts
// packages/fabrika-design/src/theme-colors.ts, generated: the 15 values themes.ts needs
export const dark = {desk: "#0c0d0e", focus: "#dfebfd6d", "turn-fill": "#3e63dd", "turn-text": "#9eb1ff", /* ... */} as const;
export const light = {/* ... */} as const;
```

```json
// packages/fabrika-design/src/token-names.json, generated (new): what the stylelint rules read
{"tokens": [{"name": "--focus", "owner": null}, {"name": "--tile-edge-on", "owner": "tile"}, {"name": "--fs-body", "owner": null}],
 "parts": {"tile": ["apps/fabrika/src/window/window.css"]},
 "steps": ["--slate-a9", "--slate-9", "--slateA9", "--indigo-9", "..."]}
```

- **One `:root`, with marked regions.** `type-scale.test.ts` takes the first `:root`, and the tests read `tokens.css` by name, so the file keeps its shape. The generated regions are the "generated token block".
- **One value form per token.** Each token is `light-dark(light, dark)`, or a plain value when both looks give one hex, as `--turn-fill` and `--turn-fg` are today.
- **Output goes through oxfmt** before it is written or compared, so `format.ts --check` never fights the generator.
- **`steps` lists every Radix 3.0.0 scale and step,** read from the package, in the spellings a stylesheet could use. Rule 3 reads that list, never a pattern.
- **Room for the design system's JSON, a later ticket.** The build is read, decode, resolve, then a list of writers (CSS, TS, names, Manti). A resolved token keeps everything: its step name, hex, job, owner, `on`, `floor`, `aim`, bend and `says`. A W3C Design Tokens writer for `tokens.json` is one more writer and loses nothing.
- **Drift fails.** `pnpm tokens` writes the files. `pnpm lint` calls the build with `--check`, which fails when a generated file or region differs from what the TOML gives, and names the token.
- **(new) The contrast checker has its own tests,** `src/build/contrast.test.ts`:
  - white on black is 21 and a color on itself is 1;
  - the ratio is the same both ways round, and always between 1 and 21, for any colors (fast-check);
  - alpha is drawn over its backdrop and rounded to 8 bits a channel, as `rules.py` does;
  - it gives the repo's printed values, 4.28 for white on indigo 10 and 2.82 for slate a8 on a dark selected row;
  - on every pair `themes.test.ts` computes, it agrees with that file's own `ratio`, so two separate implementations must match.

**Raw Radix values come from `@radix-ui/colors` 3.0.0, pinned exact, as a devDependency of `@kampus/fabrika-design` only.** Why not the checked table (`experiments/177-themes/schemes/radix-colors-3.0.0.json`):

- It is the maker's own source, so nothing drifts silently between npm and a copy.
- It holds `blackA` and `whiteA`, which the table lacks. That is why `themes.test.ts` builds `BLACK_A` by hand.
- The lint rule "no code reaches a primitive" needs an import to restrict.
- It gives rule 3 its full list of step names.
- The cost is one exact dependency, used at build time only. The output is plain hex.
- The table stays as experiment 177's record, and `themes.test.ts` keeps reading it, unchanged.

## One token traced to the pixel

`focus`, dark look, a focused tracker input, after PR 2:

```text
tokens/color/focus.toml        dark = { step = "slate.a9", bend = ... }, on [...], floor = 3
schema.ts                      decodes; a line with floor 3 passes; slate.a9 is a step name; alpha, so on is required and given
build/tokens.ts                slateDarkA.slateA9 from @radix-ui/colors 3.0.0 = "#dfebfd6d"
contrast.ts                    worst pair: on surface-selected over surface = 3.32 >= 3, passes
tokens.css (generated region)  --focus: light-dark(#00051d74, #dfebfd6d);
token-names.json               {"name": "--focus", "owner": null}
window.css (PR 1)              .tracker input:focus-visible { outline: 2px solid var(--focus); }
stylelint (PR 3)               rule 1: --focus is listed; rule 2: no raw color in the rule; passes
apps/fabrika/build.ts          Manti, React Flow, tokens.css, manti-reset.css, window.css -> dist/window.css
Electron (nativeTheme dark)    color-scheme: light dark, so light-dark() takes #dfebfd6d
drawn over the tile's ground   #dfebfd6d at alpha 0.427 over #111113 = #696e77, 3.68:1
```

Before PR 1, the same ring was `--key`, indigo 9, `#3e63dd` (3.62:1 on the ground).

## PR 1: one meaning per token, and ARIA snapshots that advise

What the owner sees:

- the tracker's rings go from indigo to slate;
- the focused tile's edge in dark goes one step up, a8 to a9;
- the unseen-ask dot and the map's "you" ring take the turn fill;
- a printed ARIA report in CI.

### Every file and line that changes (main at `164daff6`)

`packages/fabrika-design/src/tokens.css`:

- L34: `--tile-focus: light-dark(#00051d74, #d9edff5d);` is deleted. It is the second focus value.
- L35 to 36: `--focus` stays slate a9 in both looks. Its comment becomes "the one focus token: every ring and the focused tile's edge".
- L46: `--turn:` becomes `--turn-text:`.
- L70: `--tile-edge-on: var(--tile-focus)` becomes `var(--focus)`.

`packages/fabrika-design/src/themes.ts`:

- L7 to 8: the two focus bends become one, "focus is slate a9 in both looks, a solid step used as a line: a8 reads 1.90 on the desk in light and 2.82 on a selected row in dark". That makes four bends.
- L33 to 34, L97 and L150: the key `turn` becomes `"turn-fill"`.
- L94: dark `focus` goes from `#d9edff5d` (a8) to `#dfebfd6d` (a9).

`apps/fabrika/src/window/window.css`, the tracker's accent rings (`--key`) become `--focus`. That is ten selectors on five lines, exactly the ten "Radix focus default" entries in `colors.test.ts`'s `KNOWN`:

- L1394 `button:focus-visible { outline }`
- L1755 to 1759 `.tracker button`, `a`, `input` and `textarea`, each `:focus-visible { outline }`
- L1832 `.tracker-find:focus-within { border-color }`
- L1957 to 1959 `.tracker .tracker-composer input:focus` and `textarea:focus { border-color }`
- L2024 to 2027 `.tracker .tracker-list button:focus-visible` and `.tracker-list a.tracker-pull-request:focus-visible { box-shadow }`

`apps/fabrika/src/window/window.css`, the turn split:

- `color: var(--turn)` becomes `var(--turn-text)` at L602 `.fb.accent`, L1041 `.ic-ask`, L2244 `.tracker-body a`, L2267 `.tracker-head-line[data-waits]`, L2593 `.view .w-you` and L3968 `.trace-view .tv-out.waiting`.
- Two uses of the text token that are not text move to `--turn-fill`. Both are visible:
  - L741 `.udot { background }`, from frame.tsx L273. It reads 3.62 on the ground and 3.38 on raised in dark, and 5.08 in light.
  - L2565 `.view .dot.you { box-shadow }`, from the map window, L543.

What does not change:

- `--key` (L48) keeps its other five uses.
  - In `TURNS`: L2273 `.tracker-fact-asked` and `.tracker-fact-answered`, and L2282 `.tracker-ask`.
  - In `KNOWN`, "owner call pending": L1390 `button:hover`, L1765 `.tracker-primary` and L2324, the pressed hint.
- A colored primary button stays a separate pick.
- The pipe blocks (L327 to 377) keep their a8 dark focus edge (open question 1).

`apps/fabrika/e2e.ts`, a stage `--aria`, sharing one layout grid with the shots:

- **The grid.** `grid(page)` builds the five layouts once: one tile, two side by side, two stacked, a 2x2, and a 2x2 at 1024x700 through the DevTools window size, as `infoModeSmall` does. It hands each cell to both the PNG shots and `locator.ariaSnapshot()`.
- **Its own home.** The stage uses `mkdtemp(join(tmpdir(), "fh-aria-"))`, short for the 103-byte socket path. Never `FABRIKA_FOREGROUND=1`.
- **The states.** `plain`, `pipe`, `close-asked`, `closing`, `info`, `palette` and `strips`. A state with no meaning in a layout prints `skipped: <why>`. That is about 31 cells, dark only, since the tree is the same in both looks.
- **Two captures per cell.** A difference between them counts as a flake.
- **Scrubbing.** The temp home becomes `<home>`, pids become `<pid>`, and clock times become `<time>`.
- **The comparison.** Each cell is compared as text with `apps/fabrika/aria/<state>-<layout>.aria.yml`. The stage prints a unified diff per cell and a total, and writes the received files to `$SHOTS/aria-received/`.
- **Exit codes.** It exits 0 on any diff, and 2 only when it cannot reach a state. This is call 8's advising stage, not a gated rule.

`.github/workflows/check.yaml`: one `e2e` step after the existing one, `pnpm --filter @kampus/fabrika-app-old e2e -- --aria`, with `continue-on-error: true`, plus an upload of `aria-received/` on every result.

`apps/fabrika/aria/*.aria.yml`: the first snapshots, recorded from main before the build commit and committed by the test writer.

Tests, in the test writer's commits, which the owner reads:

- `packages/fabrika-design/src/themes.test.ts`:
  - `DARK` and `LIGHT`: `turn` becomes `turn-fill`, and dark `focus` becomes a9;
  - `TOKENS`: drop `--tile-focus`, and `--turn` becomes `--turn-text`;
  - law 7 drops the `--tile-focus` pair;
  - the lists at L636 and L641;
  - law 4 says four bends.
- `apps/fabrika/src/window/colors.test.ts`:
  - `LINES_AND_FILLS` drops `--tile-focus` (L407);
  - L415 expects `--turn-text`;
  - `KNOWN` loses its ten focus entries (L766 to 778);
  - two new laws: every `:focus`, `:focus-visible` or `:focus-within` rule draws its indicator in `--focus`, or in `--tile-edge-on` on a tile or strip; and a text-job token appears only as `color`.
- `apps/fabrika/src/pipes.test.ts`:
  - L289: slate's `edgeOn` is a9 in both looks;
  - L408: `var(--focus)`;
  - L416: drop the filter;
  - `NAMED_UNDER` drops `["dark slate", 2.99]`, since a9 lifts it over 3:1.

Docs:

- `color-principles.md`: four bends, and the row for step 8;
- `themes.md`: the `[colors]` sketch gets `focus` a9 and `turn-fill`, with a "Changed 2026-11-07" line;
- `tile-guidelines.md` and `pipe-colors.md`: slate a9, pipes a8;
- `design-language.md`, L57;
- the design package's README.

### Screenshots (visible, so five layouts, both looks, before and after)

Names are `<state>-<layout>-<look>`, and the layouts are `one`, `side`, `stacked`, `2x2` and `small`.

| State | Where saved | What changes | Taken by |
|---|---|---|---|
| `tile-focused` | `apps/fabrika/docs/focus/` | dark edge a8 to a9; light the same | `e2e.ts` grid |
| `tracker-ring-input` | `programs/tracker/docs/focus/` | indigo 9 ring to slate a9 | `e2e.ts` grid |
| `tracker-ring-row` | `programs/tracker/docs/focus/` | indigo inset bar to slate a9 | `e2e.ts` grid |
| `tracker-ring-composer` | `programs/tracker/docs/focus/` | indigo border to slate a9 | `e2e.ts` grid |
| `asks-dot` | `apps/fabrika/docs/focus/` | indigo 11 to indigo 9 dot | `e2e.ts`, the asking-host stage |
| `map-you` | `programs/map/docs/focus/` | the "you" ring, indigo 11 to indigo 9 | `shots.ts` |

The pull request shows each before beside its after and says what squeezes or breaks per layout. It also asks the owner to look at the dark focused tile on a full 2x2 desk.

## PR 2: tokens as TOML, and no code reaches a primitive

What the owner sees: about 29 small TOML files, a review request on them, and no pixel change.

- **`packages/fabrika-design/tokens/color/*.toml`,** one per color token in `tokens.css`:
  - surfaces: 5
  - lines: 5, `focus` among them
  - text: 2
  - turn: 4
  - states: 4, with `closed` as `same`
  - `scrim`: 1, black.a6 and black.a8
  - tile: 8, each with `owner = "tile"` **(new)**

  The files sit flat in `tokens/color/`. A folder per tier waits on call 3. `tokens/manti.toml` and `tokens/parts.toml` **(new)** go beside them.
- **`src/build/schema.ts`, `src/build/contrast.ts` (new) and `src/build/tokens.ts`,** with `src/build/tokens.test.ts` and `src/build/contrast.test.ts` **(new)**. They sit under `src/` so the package's tsconfig and vitest's `packages/*/src/**/*.test.ts` cover them. `index.ts` does not export them, so the top level stays platform-free (`lint:browser`, law 13).
- **`src/theme-colors.ts` (generated)** feeds `fabrika.colors` and `fabrikaLight.colors`. The terminal palette stays in `themes.ts`, held by laws 4 and 14.
- **`src/token-names.json` (generated, new)**, for the stylelint rules.
- **`tokens.css`** gets its two generated regions. Every value is the same as after PR 1: laws 1 to 12 of `themes.test.ts` pass unchanged, which is the proof. Only law 13's import line changes.
- **Packages and scripts:**
  - in `@kampus/fabrika-design`'s devDependencies: `@radix-ui/colors`, `effect` and `smol-toml`, all `catalog:`;
  - in the catalog: `'@radix-ui/colors': 3.0.0`, with a comment. `smol-toml` 1.9.1 is already there;
  - in the root `package.json`: `"tokens": "node packages/fabrika-design/src/build/tokens.ts"`, and `pnpm lint` gains `&& node packages/fabrika-design/src/build/tokens.ts --check`.
- **`.oxlintrc.json`:**
  - `"eslint/no-restricted-imports": ["error", {"paths": [{"name": "@radix-ui/colors", "message": "Code never reaches a primitive: read a token. Only packages/fabrika-design/src/build/ imports Radix."}], "patterns": [{"group": ["@radix-ui/colors/*"], "message": "..."}]}]`
  - One override for `packages/fabrika-design/src/build/**` turning it off.
- **`oxlint-plugins/plants.test.ts`:**
  - One entry in `PLANTS`, with one line the rule must refuse and one it must allow: `{code: "eslint(no-restricted-imports)", prelude: [], lines: [['import {slateDarkA} from "@radix-ui/colors";', true], ['export {slate} from "effect";', false]]}`.
  - One case in "rules that apply by path": the same import under `packages/fabrika-design/src/build/` fires nothing.
- **`.github/CODEOWNERS`** (call 9), below.
- **Docs:**
  - the design package's README: how to change a token;
  - `fabrika-design-package.md`: "Changed 2026-11-07";
  - `design-language.md`, section 4: TOML, not `tokens.ts`.

## PR 3: stylelint for CSS, every rule an error

What the owner sees: `pnpm lint` reads CSS, and six rules, each with its count.

- **The version and its dependencies.**
  - `stylelint: 18.0.0`, exact, in the catalog and in the root devDependencies. It is npm's `latest`, and needs Node `^22.22.2 || ^24.15.0 || >=26.0.0`; we have 26.13.0.
  - `postcss-value-parser: 4.2.0`, exact, in the `oxlint-plugins` package, since pnpm hides stylelint's own copy from our rules.
- **What changed in stylelint 18, and what it means here.**
  - Plugins pass a `fix` callback to `report`. None of ours fixes anything.
  - `extends` and `plugins` take full file paths.
  - The CLI takes kebab-case flags only, so `--formatter json` and `--config <path>`.
  - A `.ts` config loads through Node's type stripping.
- **`stylelint.config.ts` at the root:**
  - the six rules, each at `"error"`;
  - a `known` list per rule;
  - `reportDescriptionlessDisables`, `reportNeedlessDisables`, `reportInvalidScopeDisables` and `reportUnscopedDisables`, all true.
- **(new) No warnings for a gated rule.**
  - Every rule is an error from day one, and the config sets no `severity: "warning"` anywhere. A test fails if it does.
  - A rule found to fire falsely is fixed or narrowed before PR 3 lands. It never lands as a warning.
  - The ARIA stage is the one thing that only prints, and it is call 8's advising check, not a lint rule.
- **`oxlint-plugins/stylelint.ts`, the runner, on `lint.ts`'s pattern.**
  - It lints the tracked CSS that `git ls-files` gives under `apps/`, `packages/`, `programs/` and `next/`.
  - It passes `--config` with the root file, so no nested config is read.
  - It passes `--ignore-path` with an empty path, so no ignore file hides a file.
  - It prints every fire, and fails on any fire, on a crash, or on looking at no file.
  - `pnpm lint` gains `&& node oxlint-plugins/stylelint.ts`.
- **The rules** live in `oxlint-plugins/css/`, written in TypeScript with `createPlugin`, `ruleMessages` and `validateOptions`. The fire counts are on main, counted by hand.

| # | Rule | Refuses | Allows | Fires on main |
|---|---|---|---|---|
| 1 (new) | `fabrika/token-exists` | a `var(--x)` whose name is not in `token-names.json` | a name the same file defines for itself as a local variable, inside the rule that reads it; `known` | 159 uses of 28 names that only `window.css` defines: 12 aliases, `--person-bg`, `--agent-bg`, `--pop-*` (5), `--row-hi`, `--row-on`, `--ty` and `--ty-*` (5), `--bar`, `--sans`. All 28 go on `known` by name; each leaves when call 6 renames it or a later pull request moves it into TOML. |
| 2 | `fabrika/no-raw-color` (the brief's, widened) | hex; `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and `color()`; a named color; `color-mix()` with any arguments; relative color (`from var(--x)`) | the generated regions of `tokens.css`; `transparent`, `currentColor` and the CSS-wide words; system colors only inside `@media (forced-colors: active)`; a pipe's five own tokens inside `[data-pipe="..."]`, a named exception (open question 3); `known` | 20: 14 raw colors (`--person-bg`, `--agent-bg`, `--ty-*` (4), `--svc-*` (6), `--pop-shadow`, L1212's shadow), and the 6 `color-mix()` uses (L2782, L3314, L3893 to 3907). All on `known`. |
| 3 (new) | `fabrika/no-primitive-var` | a custom property declared or read whose name is in `token-names.json`'s `steps` | the generated regions only | 0. It guards what is not there yet. |
| 4 (new) | `fabrika/part-token-owner` | a token whose `owner` is a part, declared or read in a stylesheet `parts.toml` does not name for that part | the generated regions; the part's stylesheets | 0. Every `--tile-*` is in `window.css` or `tokens.css`. Today it guards programs' and `next/`'s CSS only, since the tile's rules share `window.css` with everything else (open question 14). |
| 5 (new) | `fabrika/motion-under-guard` | a `transition` or `animation` (or one of their longhands) not inside `@media (prefers-reduced-motion: no-preference)`; inside a `reduce` block, any value but `none` or `0s` | the guard | 7 declarations: L874 `.pop`, L1096 `.pop-chev`, L1348 the tooltip fade, L2446 `.view .btn`, L2794 `.ticket-view .act-r`, L2835 `.ticket-view .chev` and L2859 `.ticket-view .composer`. All 7 are fixed in PR 3 by wrapping them in the guard, and L902's `reduce` block goes. |
| 6 | `fabrika/font-size-from-scale` | a px length (in a `calc()` too) as `font-size` or as the size in `font` | `var(--fs-*)`, `var(--manti-text-*)`, `inherit` and the keywords; the hand-written scale in `tokens.css` | 22. The 16 on the scale become `var(--fs-*)` with no pixel change. The 6 off it go on `known`: L515 16px, L1371 64px, L2165 20px, L3134 9px, and L2501 and L3306 at 10px. |

- **Motion is the one rule here that changes what someone sees.** Only a person who asked for reduced motion sees it: they lose the palette's and tooltip's fades and three color transitions. Everyone else sees no change.
- **`known` only shrinks.** An entry is `file selector { property }`, or a bare name for rule 1. A fire not on the list fails, and so does an entry with no fire. The list lives in `stylelint.config.ts`, an exam path.
- **(new) Known-bad fixtures prove each rule fires.**
  - stylelint replaces a rule's options rather than merging them. A later `overrides` entry, or a second options object, can leave a rule on and dead without a sound.
  - So `oxlint-plugins/stylelint.test.ts` lints `oxlint-plugins/css/fixtures/bad/<rule>.css` and `good/<rule>.css` through the real root config, via `stylelint.lint({configFile})`, never through a copy. It expects each bad line's fire, at its line, and nothing on the good file.
  - For every tracked CSS file, it also takes `stylelint.resolveConfig(file)` and checks that each `fabrika/` rule is on, at `"error"`, with its full options and its `known` list.
  - It fails if a fixture is deleted or a rule has no bad fixture.
  - The fixtures sit outside the runner's folders, so `pnpm lint` never reads them.
- **False alarms, measured before the rules land.**
  - Every fire of each rule is counted on the tree (`window.css`, 4,012 lines; `manti-reset.css`; `tokens.css`).
  - Every fire is counted again on an outside set, read in place and never copied in: Manti 0.13.0's `dist/*.css` (about 1,875 lines), React Flow 12.12.0's `style.css`, and `experiments/142-web-terminals/page.css`.
  - Each fire is checked by hand against what the rule means. The counts, the declarations scanned and every false fire go in an experiment write-up under the number `records.ts next experiments` gives, with its own frontmatter (0522).
  - A rule with a false fire is fixed before the pull request lands (see "No warnings" above).
- **Moving tests into these rules is a proposal only.** Nothing moves in this pull request. The proposals are below.

## Properties a test checks, each with a planted bug

| # | Property | Where | Planted bug that must fail |
|---|---|---|---|
| 1 | Every focus indicator draws in `--focus`, or `--tile-edge-on` on a tile or strip | `colors.test.ts`, new | `.tracker input:focus-visible { outline: 2px solid var(--key) }` |
| 2 | No second focus value | `themes.test.ts` law 2 | `--tile-focus` added back |
| 3 | Focus reads 3:1 on the desk, ground, raised and a selected row, both looks | `themes.test.ts` law 7 | dark focus at slate a8 |
| 4 | The accent list only shrinks | `colors.test.ts` | a `KNOWN` entry kept after its rule moved |
| 5 | A text-job token appears only as `color` | `colors.test.ts`, new | `.udot { background: var(--turn-text) }` |
| 6 | `turn` means one thing in each file | typecheck, `themes.test.ts` law 1 | a `turn:` key in `themes.ts` |
| 7 | The ARIA stage prints every cell or `skipped: <why>`, and exits 0 on a diff | the stage | `aria-label` removed from `.udot`: diff printed, exit 0 |
| 8 | Two captures of one cell are equal | the stage's flake count | a clock time left unscrubbed |
| 9 | Every TOML file decodes; a bad one fails with its path and field | `tokens.test.ts` | `slate.13`, `slaet.a11`, a text job with no `floor`, `floor = 4.0`, a hex with no `bend`, a key `colour` |
| 10 | Every pair in `on` reaches `floor`, both looks; an exception needs a ticket and its exact ratio | `tokens.test.ts`, property-based | `text-faint` dark at `slate.a10` |
| 11 (new) | A non-text token has a 3:1 floor unless it says `carries = "nothing"` | `tokens.test.ts` | `focus.toml` with `floor` removed; `border-strong` with no `floor` and no `carries` |
| 12 (new) | A translucent value names its backdrop | `tokens.test.ts` | `surface-hover.toml` with no `on` |
| 13 (new) | A token name appears once, case folded | `tokens.test.ts` | `Focus.toml` beside `focus.toml`; `--surface` in `manti.toml` and in a TOML file |
| 14 (new) | `aim` never fails the build; `floor` always does | `tokens.test.ts` | `aim = 7` unmet: printed, exit 0; `floor = 7` unmet: exit 1 |
| 15 (new) | The contrast checker is right | `contrast.test.ts` | the alpha not drawn over its backdrop; the luminance weights swapped |
| 16 | Generated files equal what the TOML gives | `pnpm lint` `--check`, with a test | `--surface` edited by hand in `tokens.css` |
| 17 | No value moved in PR 2 | `themes.test.ts` laws 1 to 12 | one step changed in a TOML file |
| 18 | `@radix-ui/colors` is imported only under `src/build/` | `plants.test.ts` | `import {slateDarkA} from "@radix-ui/colors";` |
| 19 | A file's name is its token; `on`, `same` and `owner` exist; no `same` cycle | `tokens.test.ts` | `same = "text-faint"` in `text-faint.toml`; `owner = "tlie"` |
| 20 | Every `--manti-*` is ours by `var()` or a named plain value | `themes.test.ts` law 11 | a hex in `manti.toml` |
| 21 (new) | `token-exists` fires | bad fixture | `color: var(--txet-faint)` |
| 22 | `no-raw-color` fires, and allows the named places | bad and good fixtures | Fires on `color: #fff`, `color: red`, `--x: oklch(0.7 0.1 200)`, `color-mix(in oklab, var(--done) 30%, transparent)`, `rgb(from var(--stuck) r g b / 50%)`, and `outline-color: Highlight` outside forced colors. Allows a `#fab` id selector, a hex in `url()`, a comment, `content: "#1"` and `animation-name: red`. |
| 23 (new) | `no-primitive-var` fires | bad fixture | `--slate-a9: #dfebfd6d;` and `color: var(--indigo-9)` in an app stylesheet |
| 24 (new) | `part-token-owner` fires | bad fixture, under a planted `programs/` path | `outline-color: var(--tile-edge-on)` in a program's CSS |
| 25 (new) | `motion-under-guard` fires | bad fixture | `transition: opacity 120ms` outside the guard; `animation: pop-fade 1s` inside a `reduce` block |
| 26 | `font-size-from-scale` fires | bad fixture | `font-size: 12px`; `font: 600 10px / 1 var(--font)`; `calc(12px + 1px)` |
| 27 (new) | Each rule is on, at error, with its full options, in every tracked CSS file's resolved config | `stylelint.test.ts` | an `overrides` entry that sets `fabrika/no-raw-color` to `[true]` and drops its `known` list |
| 28 (new) | No gated rule is a warning | `stylelint.test.ts` | `severity: "warning"` on any rule |
| 29 | `known` only shrinks | `stylelint.test.ts` | an entry left after its line is fixed |
| 30 | The runner fails on any fire and on no files; a nested config and an ignore file change nothing; a disable needs a rule and a reason | `stylelint.test.ts` | a `.stylelintrc.json` planted in a folder; a bare `/* stylelint-disable */` |

## Files

| File | PR | Change | Lines, rough |
|---|---|---|---|
| `packages/fabrika-design/src/tokens.css` | 1, 2 | 4 lines; then two generated regions | 10; 190 regenerated |
| `packages/fabrika-design/src/themes.ts` | 1, 2 | bends, keys, one value; then imports `theme-colors.ts` | 15; 40 out |
| `apps/fabrika/src/window/window.css` | 1, 3 | 15 lines; then 16 size swaps and 7 motion wraps | 15; 40 |
| `apps/fabrika/e2e.ts` | 1 | `grid()`, `--aria`, scrub, report | 250 |
| `apps/fabrika/aria/*.aria.yml` | 1 | about 31 recorded | about 1,200, recorded |
| `.github/workflows/check.yaml` | 1 | one advising step, one upload | 15 |
| `packages/fabrika-design/src/themes.test.ts` | 1, 2 | names, values, bends; law 13 | 40; 5 |
| `apps/fabrika/src/window/colors.test.ts` | 1 | `KNOWN` minus 10, two laws | 60 |
| `apps/fabrika/src/pipes.test.ts` | 1 | a9, `var(--focus)`, `NAMED_UNDER` | 8 |
| Docs (`color-principles`, `themes`, `tile-guidelines`, `pipe-colors`, `design-language`, the package README) | 1, 2 | values, the token source | 80 |
| `packages/fabrika-design/tokens/color/*.toml`, `manti.toml`, `parts.toml` | 2 | about 29 files and 2 maps | 360 |
| `packages/fabrika-design/src/build/schema.ts` | 2 | schema and checks across files | 120 |
| `packages/fabrika-design/src/build/contrast.ts` (new) | 2 | ratio, alpha over a backdrop | 50 |
| `packages/fabrika-design/src/build/tokens.ts` | 2 | read, decode, resolve, check, write, `--check` | 280 |
| `packages/fabrika-design/src/build/tokens.test.ts`, `contrast.test.ts` | 2 | properties 9 to 17 and 19 | 360 |
| `src/theme-colors.ts`, `src/token-names.json` | 2 | generated | 40; about 500 generated |
| `.oxlintrc.json`, `oxlint-plugins/plants.test.ts` | 2 | the rule, one override, two plants | 25 |
| `.github/CODEOWNERS` | 2 | new | 8 |
| `pnpm-workspace.yaml`, `package.json` (root, the package, `oxlint-plugins`) | 2, 3 | catalog, devDependencies, scripts | 25 |
| `stylelint.config.ts` | 3 | six rules, `known`, report options | 110 |
| `oxlint-plugins/stylelint.ts` | 3 | the runner | 90 |
| `oxlint-plugins/css/*.ts` | 3 | six rules | 550 |
| `oxlint-plugins/css/fixtures/{bad,good}/*.css` (new) | 3 | 12 fixtures | 180 |
| `oxlint-plugins/stylelint.test.ts` | 3 | properties 21 to 30 | 320 |
| `experiments/NN-stylelint-false-alarms.md`, with its frontmatter | 3 | the counts | 150 |
| `exam-paths.json` | 1, 2, 3 | rows below | 14 |
| `docs/direction/oxlint-and-oxfmt.md`, the AGENTS.md Checks block | 3 | stylelint in `pnpm lint` | 15 |

## Shape tests that could move into stylelint (proposals; the owner decides each, none moves here)

| Test | Lean | Why |
|---|---|---|
| `themes.test.ts` law 11, "every var() names a defined token" | move, to rule 1 (new) | the same law, across `window.css` too |
| `type-scale.test.ts` "names no rem", and `themes.test.ts` law 12's twin | move, to stylelint's own `unit-disallowed-list: ["rem"]` | a pure shape; "the old fault" becomes its fixture |
| `themes.test.ts` law 4, "no oklch(), rgb() or hsl() in tokens.css" | move, to rule 2 and the schema | held twice after PR 2 |
| `colors.test.ts` "keeps no oklch() gray"; the oklch half of `tile.test.ts` "the old tint is gone" | move, to rule 2 | `known` holds today's hues |
| `pipes.test.ts` "under more contrast, still by var()" and "a pipe sets only its washes and own edges, as hex" | move, to rule 2's pipe exception | one statement of one shape |
| `colors.test.ts` "manti-reset.css sets no token" | move, to stylelint's own `property-disallowed-list: ["/^--/"]` for that file | a pure shape |
| `colors.test.ts` "no rule dims text with an opacity under 1, past the named fades" | later, a rule of its own | needs its own count |
| `colors.test.ts` accent laws (`TURNS`, `KNOWN`) and "no line or fill token as text"; `themes.test.ts` law 9 | later, a rule that reads each token's `job` | high value, after PR 2 |
| `themes.test.ts` law 8; `colors.test.ts` A1 and "names no --ink" | stay | names that call 6 changes, or checks across files |
| every contrast, step and value law; the tile's outline, box-shadow and title-line laws; the palette laws | stay | they need real values, or they are the tile's spec |

`caret.test.ts`, `scroll.test.ts` and `frame.test.ts` also read stylesheets. Their checks are about one part's behavior, so none is proposed.

## Exam paths, and who commits them

`exam-paths.json` covers `next/` tests, CI, lint and the root config today. It covers neither today's app tests nor the design package. The proposed rows:

```json
{ "glob": "packages/fabrika-design/tokens/**", "why": "the token files: each step, its owner, what it sits on and its floor" },
{ "glob": "packages/fabrika-design/src/build/schema.ts", "why": "what a token file may say" },
{ "glob": "packages/fabrika-design/src/build/contrast.ts", "why": "the contrast checker the floors are judged by" },
{ "glob": "packages/fabrika-design/src/**/*.test.ts", "why": "the design package's laws" },
{ "glob": "apps/fabrika/src/window/colors.test.ts", "why": "the app's color laws" },
{ "glob": "apps/fabrika/src/pipes.test.ts", "why": "the pipe color laws" },
{ "glob": "apps/fabrika/src/window/type-scale.test.ts", "why": "the type scale's laws" },
{ "glob": "apps/fabrika/src/window/tile.test.ts", "why": "the tile's laws" },
{ "glob": "apps/fabrika/aria/**", "why": "the approved ARIA snapshots" },
{ "glob": "stylelint.config.ts", "why": "the CSS lint rules and their known lists" }
```

- **Already covered:**
  - `oxlint-plugins/**`: the CSS rules, the runner, the fixtures and the plants;
  - `.oxlintrc.json`;
  - `.github/**`, which includes CODEOWNERS;
  - `package.json` and `pnpm-workspace.yaml`.
- **Not exam:** the generated files and regions. The drift check holds them.
- **(new) `contrast.ts` is exam** because the floors are only as good as the checker that judges them.
- **Who commits them.**
  - The test writer, an agent that is not the builder, commits every exam change as its own signed commit inside the pull request. That covers the rows above, the laws, the fixtures and plants, the ARIA baseline, the TOML files (each carries a floor), the schema and the contrast checker.
  - The builder writes the build script and its writers, the CSS changes, the runner and the rules' code.
  - Any exam path touched asks the owner to read it.
  - Today's pipeline programs are paused, so the lead session's agents take the steps by hand, each logged in `field/runs.jsonl`.

## CODEOWNERS (call 9, decided yes for now)

**Decided 2026-11-08 by the owner: CODEOWNERS stays advisory.** No `require_code_owner_review` on main while only the project's two people send commits, so the step below waits.

New file `.github/CODEOWNERS`:

```text
# The token files and their laws: the owner reads every change (design language, call 9,
# decided 2026-11-07, for now; the owner may relax it).
/packages/fabrika-design/tokens/                      @<owner>
/packages/fabrika-design/src/build/schema.ts          @<owner>
/packages/fabrika-design/src/build/contrast.ts        @<owner>
/packages/fabrika-design/src/build/tokens.test.ts     @<owner>
/packages/fabrika-design/src/build/contrast.test.ts   @<owner>
/packages/fabrika-design/src/themes.test.ts           @<owner>
/apps/fabrika/src/window/colors.test.ts               @<owner>
/apps/fabrika/src/pipes.test.ts                       @<owner>
```

**Decided by the owner, 2026-11-08: CODEOWNERS stays advisory.** The step below is not taken for
now: `require_code_owner_review` stays off on `main`. Only two people send commits here, and the
owner accepts no one else's. Revisit when a third person can push.

**A step that needs the owner's yes, never done silently.**

- In the ruleset "main only through a pull request", set `require_code_owner_review` to `true`. It is `false` today, with `required_approving_review_count` at 0.
- At the change, check GitHub's docs on whether the count must be 1 for this to bite.
- The agent changes it only after the yes, with `gh api -X PUT repos/usirin/tea-fabrika/rulesets/<id>`, and says so in the pull request.

**How it fails today, read from the rulesets.**

- That ruleset lets the admin role bypass it "always".
- Pull requests here open as the owner's account, who cannot approve their own.
- So until pull requests open as `fabrikalfa` and merge without the bypass, the line gives a review request and a "code owner" mark, not a block.

## How the ARIA snapshots' false alarms get counted before they may block

- **Rating.** Each differing cell gets one rating, `fix` (the tree changed in a way a person would hear) or `noise` (a scrub missed, an order moved, timing).
  - The lead agent or the owner rates it, never the builder.
  - Each rating is one row in `field/notes.jsonl`: `{check: "aria", cell, pr, rated, why}`.
- **A clean check** is a cell compared on a pull request that did not mean to change that cell's tree. The stage's printed total gives the count.
- **Flakes are counted apart,** from the two captures per cell.
- **Before it may block,** all of these must hold:
  - 0 `noise` in at least 300 clean checks, about 10 pull requests at 31 cells;
  - 0 flakes in the same window;
  - every planted break shows a diff: the tile region's name removed, the status region gone, a button's role changed, the info item hidden.
- **Then the owner decides.** If the noise is text churn, the stage moves to Playwright Test's `toMatchAriaSnapshot`, whose partial match tolerates it. The `.aria.yml` files carry over.

## Size

At 600 lines an agent hour, on the doubling scale.

| PR | Written lines, rough | Estimate | Sure |
|---|---|---|---|
| 1: one meaning per token, ARIA advising, shots | 480 code and tests, 80 docs, plus 1,200 recorded | 2 agent hours | 60%. Doubt: every state at every layout, and the scrubbing. |
| 2: TOML, schema, contrast checker, build, lint rule, CODEOWNERS | 1,300 | 2 agent hours | 55%. Doubt: output oxfmt leaves alone, and the exam changes. |
| 3: stylelint, six rules, fixtures, false alarms | 1,500 | 4 agent hours | 50%. Doubt: TS plugins under stylelint 18's type stripping, the outside set's hand count, and rule 1's local variables. |
| All three | about 3,300 | 8 agent hours, likely 6 to 10 | 50% |

PR 3 sits at the 8-hour cap's half. If it grows, split rules 1, 3 and 4 (the ones that read `token-names.json`) into a fourth pull request.

## What it cannot tell us

- Whether the rules hold on CSS nobody has written yet. The tree is three files, about 4,400 lines.
- Whether slate a9 on a dark focused tile reads too loud on a full desk. Eyes pick.
- Anything a screen reader says. An ARIA snapshot is tree text, not speech.
- Whether ARIA noise comes from scrubbing or from real churn, until the ratings come in.
- Colors written in TSX or TS. stylelint reads CSS only, and the import rule stops an import, not a pasted hex.
- Whether `import("@radix-ui/colors")` is caught. ESLint's rule covers static imports only; the plant shows what oxlint 1.90 does.
- Anything about the table in `experiments/177-themes/`. `themes.test.ts` still reads it by path, which no rule sees.
- Whether the code-owner setting blocks anything.
- Whether rule 4 catches anything real before the tile's rules leave `window.css`.
- Whether the motion rule's cost (no fades for reduced-motion users) is right. Only someone using that setting can say.
- How the TOML shape fits `next/`. No `next/` window imports the package yet.
- Whether one TOML file can hold a pipe's five tokens. This plan does not try it.
- Nothing about tracker ticket 153: the 4.28:1 exception stays as it is.

## Open questions, each with a lean

1. **Pipes' dark focus edge: stay a8 while slate moves to a9?** Lean: stay, 65%. Their a9 is near solid (sky 12.7:1, lime 14.0:1); a8 reads 3.2 to 4.1. Doubt: principle 4, and violet's named 2.92 stays.
2. **Unseen-ask dot and "you" ring to `--turn-fill`?** Lean: yes, 70%. Cost: a darker dot in dark.
3. **Pipe blocks: written by hand in `window.css`, under a named exception to rule 2, until call 3?** Lean: yes, 65%. `pipes.test.ts` holds each value to a step of its color. Moving them into the generated file would clear rules 2 and 4 outright, but it is an exam change to `pipes.test.ts`, which reads them from `window.css`.
4. **Radix from the package?** Lean: yes, 75%.
5. **Move `--person-bg` and `--agent-bg` into TOML in PR 2?** Lean: yes, 60%. That takes 2 names off rule 1's and rule 2's `known` lists. The cost is law 2's list growing, an exam change.
6. **ARIA compare: `ariaSnapshot()` and a text diff in `e2e.ts`, or Playwright Test's `toMatchAriaSnapshot`?** Lean: `e2e.ts`, 60%. The matcher throws outside Playwright Test in 1.64.1. Moving to it is part of "before it blocks".
7. **Which app tests become exam: the four named files, or all of `apps/fabrika/src/**/*.test.ts`?** Lean: the four, 60%.
8. **CSS rules in `oxlint-plugins/css/`, or a new `stylelint-plugins/`?** Lean: `oxlint-plugins/css/`, 60%. It is already exam, and it is one place to swap if the Rust CSS linter study finds one.
9. **Flip the code-owner setting now, or once pull requests open as `fabrikalfa`?** No lean; the owner picks. Add the line in PR 2.
10. **The 6 off-scale sizes, the 6 `color-mix()` uses and rule 1's 28 names: `known` now, with a ticket each?** Lean: yes, 80%.
11. **The brief's `text-muted.toml`?** The package forbids that name (law 8), so the file is `text-faint` until call 6. Lean: yes, 85%.
12. **(new) Rule 5 as stated, or let an opacity-only or color-only transition sit outside the guard?** Lean: as stated, 65%. It is one simple rule, and only people who asked for less motion see the change. Doubt: losing a fade can make a popover feel abrupt.
13. **(new) The 3:1 floor for borders.** Radix's border steps fail it: `--border` (a6) and `--border-strong` (a7) are under 3:1 on the dark ground, and only `--wire` (a8) reaches it (3.01). Each must say `carries = "nothing"` (another cue, such as the part's text or fill, identifies it) or take a higher step. Lean: `carries = "nothing"` on `--border`, `--border-faint` and `--border-strong`, each with its reason in `says`, 60%. Doubt: `--border-strong` is named for an interactive part's edge.
14. **(new) Split the tile's rules out of `window.css` into a `tile.css`,** so rule 4 can guard them? Lean: later, its own pull request, 70%. `tile.test.ts` and `pipes.test.ts` read the tile's rules from `window.css`, so it is an exam change.

### Files the build starts from
- packages/fabrika-design/src/tokens.css
- packages/fabrika-design/src/themes.test.ts
- apps/fabrika/src/window/window.css
- apps/fabrika/src/window/colors.test.ts
- apps/fabrika/e2e.ts