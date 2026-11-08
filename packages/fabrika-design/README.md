# @kampus/fabrika-design

fabrika's design: the two built-in themes and one stylesheet of tokens, with Manti UI's tokens set
from them. It is the one package both versions import: today's app (`apps/fabrika`) and `next/`'s
windows ([one design package](../../docs/direction/fabrika-design-package.md), and AGENTS.md's
"Two versions, side by side"). What it holds comes from settled notes, [themes](../../docs/direction/themes.md)
and [color principles](../../docs/direction/color-principles.md), not from how today's app is built.

Changed 2026-11-08: design foundations PR 1 builds one `--focus`, slate a9 in both looks, for
today's version. `--tile-edge-on` reads it, and the two focus bends become one, leaving four.
The turn's text is `--turn-text`; its fill is `--turn-fill` in CSS and `turn-fill` in the themes.

```ts
// the colors, for code that paints outside CSS: a terminal, a window's frame
import {fabrika, fabrikaLight, terminalTheme, frameColor, followLook} from "@kampus/fabrika-design";

terminalTheme(fabrika).background; // "#111113", slate 1
```

```css
/* a window's stylesheet, in this order (today's app's build.ts joins them into one file) */
@import "@manti-ui/styles/index.css"; /* Manti's parts, in its own cascade layers */
@import "@kampus/fabrika-design/tokens.css"; /* our tokens, and Manti's set from them */
/* then the window's own rules, which name the tokens */
```

| File | What it is |
|---|---|
| `tokens/color/<token>.toml` | One file per color token: its type, tier and owner, what it is for, both looks' Radix steps (or a bend with its reason), what it sits on and its contrast floor. |
| `tokens/manti.toml`, `tokens/parts.toml` | Manti's `--manti-*` tokens, each set from one of ours; and each owner, with the stylesheets a part's tokens may appear in. |
| `src/build/tokens.ts` | The token build, `pnpm tokens`: reads and checks the TOML (`schema.ts`, `contrast.ts`), then writes the generated files below. `--check` fails on drift, and `pnpm lint` runs it. The one place that imports `@radix-ui/colors`. |
| `src/themes.ts` | `fabrika` and `fabrika-light`: Radix 3.0.0, slate and indigo, the sixteen colors (from `theme-colors.ts`, generated) and the terminal's. The four bends are listed in its header. |
| `src/tokens.css` | The tokens: two generated regions, the colors and Manti's `--manti-*` tokens, and by hand the px type scale, spacing, radii, rows, motion and the keycap. |
| `src/theme-colors.ts`, `src/token-names.json` | Generated: the themes' colors, and every token name with its owner and every Radix step's name, for the CSS lint rules. |
| `src/index.ts` | The top level: the themes and nothing else. It imports nothing, so it loads in a browser tab, in Electron's main and in Node. |
| `src/themes.test.ts`, `src/themes.frame.test.ts` | The package's laws: each value is the note's and a Radix step, text reads 4.5:1 and lines 3:1 where they sit, the package stands alone. |

## How to change a token

1. Edit its file in `tokens/color/`, or add one named for the token. `schema.ts` says every key.
2. Run `pnpm tokens`. It fails, naming the file and the field, on a bad key, an unknown step or a
   floor missed in either look: `turn-fg.toml: floor: dark on turn-fill-hover reads 4.28, under 4.5`, until its `except` names that ratio and its ticket.
   An `aim` missed is only printed.
3. Commit the TOML with what it wrote: `src/tokens.css`'s regions, `src/theme-colors.ts` and
   `src/token-names.json`. Never edit those by hand; `pnpm lint` fails when they differ.

The token files are exam: the owner reads every change to one.
