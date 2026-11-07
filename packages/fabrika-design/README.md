# @kampus/fabrika-design

fabrika's design: the two built-in themes and one stylesheet of tokens, with Manti UI's tokens set
from them. It is the one package both versions import: today's app (`apps/fabrika`) and `next/`'s
windows ([one design package](../../docs/direction/fabrika-design-package.md), and AGENTS.md's
"Two versions, side by side"). What it holds comes from settled notes, [themes](../../docs/direction/themes.md)
and [color principles](../../docs/direction/color-principles.md), not from how today's app is built.

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
| `src/themes.ts` | `fabrika` and `fabrika-light`: Radix 3.0.0, slate and indigo, the fifteen colors and the terminal's. The five bends are listed in its header. |
| `src/tokens.css` | The tokens: surfaces, lines, the two text steps, the turn, the state words, the dialog scrim, a tile's names, the px type scale, spacing, radii, rows and motion. Then Manti's `--manti-*` tokens, each pointing at one of ours, and the keycap. |
| `src/index.ts` | The top level: the themes and nothing else. It imports nothing, so it loads in a browser tab, in Electron's main and in Node. |
| `src/themes.test.ts`, `src/themes.frame.test.ts` | The package's laws: each value is the note's and a Radix step, text reads 4.5:1 and lines 3:1 where they sit, the package stands alone. |

The values are written twice, in `themes.ts` and `tokens.css`, and the tests hold them equal. A
change to a value changes both files.
