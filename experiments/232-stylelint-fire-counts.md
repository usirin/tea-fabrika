---
date: "2026-11-08"
summary: "Today's version, ticket 245 PR 3. Six rules over main's 2,061 declarations, the tree's 2,060, and 5,015 outside declarations from Manti 0.13.0, React Flow 12.12.0 and experiment 142. Hand-checked false fires: zero for each rule on each set. Tree fires: 153 token, 20 raw color, 0 Radix step, 0 owner, 0 motion, 6 size. Outside: 1,680, 614, 0, 0, 135, 3. Fixed named-color shorthand misses and the font angle/line-height parser; all six stay errors. No model, $0."
---

# 232. Stylelint fires checked by hand

Today's version, tracker ticket 245, design foundations PR 3. Run 2026-11-08 with
Node 26.13.0, stylelint 18.0.0 and postcss-value-parser 4.2.0. The script calls no
model, reads no key and makes no network request. Its cost is $0.

**All six rules have zero observed false fires on both required sets. They stay
at error, as the approved plan requires.** This is a count on these files, not
a claim that every possible CSS value is covered.

```text
                    declarations   token   raw   primitive   owner   motion   size
main e95bfd79              2,061     153     20       0          0       8       22
PR 3 tree                 2,060     153     20       0          0       0        6
outside                   5,015   1,680    614       0          0     135        3
false fires, each set                  0      0       0          0       0        0
```

## What was scanned

The main sample is the checkout's local `main`, `e95bfd79`, also PR 3's base.
The tree sample is `aec3e7e0` plus this review repair. No product CSS changed in
the repair. Both contain all three tracked stylesheets in today's runner
folders. There is no tracked `programs/` CSS. Neither sample substitutes
`next/` for today's version.

Manti 0.13.0 and React Flow 12.12.0 were read from the installed packages, in
place. No outside stylesheet was copied into the repo. Manti `dist/*.css`
includes all five top-level files, including the one-line minified bundle.
That bundle has 3,914 declarations. The plan's approximate line count did not
count its declarations. Repeated content across distributed files counts again.

| File | Main declarations | Tree declarations | Outside declarations |
|---|---:|---:|---:|
| `apps/fabrika/src/window/manti-reset.css` | 15 | 15 | |
| `apps/fabrika/src/window/window.css` | 1,928 | 1,927 | |
| `packages/fabrika-design/src/tokens.css` | 118 | 118 | |
| Manti `dist/index.css` | | | 3,914 |
| Manti `dist/tailwind-theme.css` | | | 196 |
| Manti `dist/tailwind.css` | | | 0 |
| Manti `dist/themes.css` | | | 278 |
| Manti `dist/tokens.css` | | | 305 |
| React Flow `dist/style.css` | | | 310 |
| `experiments/142-web-terminals/page.css` | | | 12 |
| Total | 2,061 | 2,060 | 5,015 |

Every rule receives every declaration. Generated regions count as scanned,
then get their stated exemptions. Manti's `tailwind.css` has imports but no
declarations. Imports are not expanded; the other files are read directly.

## Counts and hand checks

The script uses the real root config and six real plugins. It clears only
`known`, so existing debt is visible, and bypasses ignores and disable comments.
Every fire was inspected against its declaration, reference name and the
rule's stated exceptions. Identical values were read together with their
locations. The saved result keeps every fire's line, column and message, each
file's declaration count, and a SHA-256 of its input.

| Rule | Main fires | Tree fires | Outside fires | False fires on main / tree / outside |
|---|---:|---:|---:|---|
| `token-exists` | 153 | 153 | 1,680 | 0 / 0 / 0 |
| `no-raw-color` | 20 | 20 | 614 | 0 / 0 / 0 |
| `no-primitive-var` | 0 | 0 | 0 | 0 / 0 / 0 |
| `part-token-owner` | 0 | 0 | 0 | 0 / 0 / 0 |
| `motion-under-guard` | 8 | 0 | 135 | 0 / 0 / 0 |
| `font-size-from-scale` | 22 | 6 | 3 | 0 / 0 / 0 |

### Token names

Main and the tree each have 153 reads of the 28 names on `known`, across 152
declarations. One padding declaration reads `--pop-pad` twice. The names are
the 12 older aliases, the person and agent backgrounds, five popover names,
row highlight and foreground, `--ty` and its four variants, `--bar`, and
`--sans`. Each is absent from the registry and not declared in the reading
rule. These are policy violations permitted by the approved debt list. The
plan's earlier count of 159 is stale.

Outside, 1,680 fires read 351 distinct names: 1,269 in Manti's bundle, 154 in
its Tailwind mapping, 34 in themes, 124 in tokens, and 99 in React Flow. Each
name is absent from our registry and the reading rule's declarations. This
includes foreign spacing and text names, component settings, geometry variables
and nested fallback names. A declaration elsewhere in the stylesheet does not
make a name local to the reading rule. The outside files are judged as fabrika
CSS. A library's own token is valid for that library but still violates this
rule's registry contract. Outside CSS is not added to the normal runner.

### Raw colors

All 20 fires on main and the tree are real: 12 literal background, type and
service colors in `:root`, the popover shadow token, the palette's extra shadow,
and six `color-mix()` backgrounds. Generated regions and the five exact pipe
overrides are exempt. No selector, URL or quoted text was counted as a color.

Outside, Manti has 171 fires in the bundle, 250 in themes and 134 in tokens.
They are OKLCH scales, light/dark pairs containing raw colors, literal theme
hues, color mixes and transparent hex borders. `#0000` is still a hex color;
the permitted keyword is `transparent`. Token-only `light-dark()` values do
not fire. React Flow has 57 fires: 54 raw default-token declarations and three
literal declarations at lines 324, 445 and 551. The terminal experiment has
two, its background and border at lines 6 and 13. Each fire contains a forbidden
color value, rather than a word that happens to name a color.

### Radix steps and part ownership

Neither set declares or reads a listed Radix step outside an exempt generated
region. Neither uses an owned part token from an unauthorized file.
`window.css` is authorized for tile tokens. The outside libraries use their
own names. There are no fires to classify for either rule. Their bad fixtures
still prove the checks are live through the root config.

### Motion

Main's eight fires are seven unguarded declarations at `window.css` lines 883,
1105, 1447, 2549, 2897, 2938 and 2962, plus `animation-name: pop-fade` under
`reduce` at line 913. The latter is not `none` or `0s`. The plan counted seven
declarations to move and mentioned deleting the reduce block separately. The
tree has completed both changes and has zero fires.

Outside, Manti's bundle has 132 fires and React Flow has three, at lines 164,
168 and 204. Each sets `transition`, `animation` or a longhand without the
required guard, or has a forbidden value under `reduce`. Manti's `.01ms` reset
and iteration count of `1` under `reduce` fail the explicit `none`/`0s` rule.
Unguarded `transition: none`, `animation: none`, zero-duration overrides and a
paused animation also fire. These follow the plan's strict declaration rule,
which requires the guard for every unguarded motion property. They are not
claims that those values themselves cause visible motion.

### Font size

Main's 22 fires are literal pixel font sizes. Sixteen are on the scale and
became token reads in the tree. Its six remaining fires are the approved
exceptions: 16px, 64px, 20px, 9px and two 10px shorthands. Outside has three
actual pixel sizes, all in React Flow, at lines 317, 448 and 461. None is a
line-height, slant angle or quoted family text. Manti's sizes use relative
units or tokens and do not fire.

## Every false fire found during repair

There are **no false fires in either required dataset**. The expanded good
fixture exposed two false fires in the old font parser:

- `good/font-size-from-scale.css:7`, a local `--size` alias followed by a 12px
  line-height. The alias supplies the size; the pixel length is permitted.
- `good/font-size-from-scale.css:8`, the same grammar with comments before and
  after `/`. Comments do not change which value is the size.

Both now pass. The parser uses the size position before `/`, skips the optional
angle after `oblique`, and distinguishes size lengths from angles and weights.
The bad fixture catches pixel sizes after plain and computed oblique angles,
and a pixel fallback in the size position. Good cases include a computed
weight, a scale size with pixel line-height, and a quoted family with `12px`.

The raw-color repair closes missed fires. Its bad fixture now includes text
decoration, column rules, two scrollbar colors, text emphasis, WebKit text
stroke, a drop shadow, a mask gradient, an image fallback and a cross-fade.
The rule reads names in those color positions while keeping family names,
animation names, grid names, strings and URLs out of that check.
[CSS Text Decoration](https://www.w3.org/TR/css-text-decor-3/#text-decoration-property)
defines the shorthand's color member.
[CSS Fonts](https://drafts.csswg.org/css-fonts-4/#font-prop) defines the size,
optional line-height and optional oblique angle positions.

The new fixtures failed on the old rules for the expected reasons. All good
and bad fixtures pass through the real root config after repair. No rule was
lowered to a warning and no `known` entry was added.

## Repeating the count

```sh
env -u TYPESAFE_API_KEY node experiments/232-stylelint-fire-counts.ts
# Add --audit to print each declaration and fire for inspection.
```

The [script](./232-stylelint-fire-counts.ts) writes
[the counts and fire locations](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/232-stylelint-fire-counts.json).
It does not classify its own output. The judgments above were made by hand.
The main revision is fixed in the script; the tree and installed packages come
from the checkout where it runs.

## What this cannot tell us

Zero false fires in these sets does not establish zero false fires in all CSS.
The outside distribution repeats values and is not 5,015 independent examples.
It contains no off-file part-token misuse or Radix-step misuse, so fixtures
carry the positive evidence for those rules. Unresolved custom property
contents cannot be fully typed without substitution. The counts measure the
rules against the approved policy, not whether outside libraries should adopt
that policy or whether these rules catch every violation.
