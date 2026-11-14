---
date: "2026-11-07"
scripts: "none"
summary: "About Manti, which both versions use; reading only, not a measurement, at adobe/react-spectrum `82959b6a` and Zag 1.47.0. React Aria uses a single-select listbox with 2D arrows and `aria-selected`; the lean for Manti is a native radio group (65%), since it has ARIA-AT data and works in forms. React Aria's color naming (OKLCH, about 215 lines, 34 languages) is Apache-2.0 and can be ported with its notice. Zag's swatches expose no selected state, no group name and no arrow keys, and no Zag issue covers it. No product limits picks to passing colors. Base of [Manti issue 157](https://github.com/manti-ui/ui/issues/157). No model, $0."
---

# 226. How does React Aria build an accessible color swatch picker?

Read 2026-11-07. This is reading, not a measurement. About Manti, which both versions of fabrika
use; it is the base of [Manti issue 157](https://github.com/manti-ui/ui/issues/157). Sources were
fetched that day. No model, $0. React Aria source is read at
adobe/react-spectrum commit `82959b6a` (main), cited as `RS:<path>:<line>`. Zag is read from
the installed 1.47.0 in `node_modules/.pnpm/`, cited as `zag:<file>:<line>`. A claim with no
source is marked **guess**. A claim from a search summary is marked **secondary**.

## The answer first

- **Pattern.** One choice from a palette is a single-select widget. Two APG patterns fit:
  a radio group and a single-select listbox. React Aria uses a listbox with 2D arrow keys
  and `aria-selected`. My lean is a **radio group** built on native `<input type="radio">`,
  with the color name as each radio's label. Why: it has the best published screen reader
  data (ARIA-AT), it works in forms, and it is the role users know for "pick one". The cost:
  native radios only move previous/next, not up/down by row. About 65% sure. A listbox on
  Zag's grid collection is the close second. A real screen reader run would settle it.
- **Naming.** React Aria's color naming is about 215 lines of TypeScript plus 29 strings
  per language in 34 languages (Turkish included). It is Apache-2.0. Manti (MIT) can port
  it if it keeps the license and notice and marks the changed files.
- **Zag's gaps.** Zag 1.47.0 swatches expose no selected state to assistive tech. Each
  swatch is a separate tab stop with no arrow keys. The name is English text plus a hex
  code. The group has no name. Nothing handles forced colors. No open Zag issue covers this.
- **"Only accessible colors".** No product I checked limits user picks to passing colors.
  GitHub takes any hex and fixes up the text color. Material and Linear take any input and
  *derive* passing tones. For a fixed palette, the bar we can test in code: every swatch
  fill or its border is 3:1 against the surface in each theme (WCAG 1.4.11). The selected
  ring is a black-and-white double ring. Selection also has a non-color cue (1.4.1). Each
  color has a name (4.1.2).
- **Forced colors.** React Aria opts the swatch out of forced colors
  (`forced-color-adjust: none`), so the real color stays visible. Do the same for the fill
  only. Draw the edge, the selected cue and the focus ring in system colors.

## 1. The ARIA pattern for "pick one color from a grid of swatches"

**What React Aria renders today.**

- `ColorSwatchPicker` is a `ListBox` with `layout={props.layout || 'grid'}`,
  `selectionMode="single"` and `disallowEmptySelection` (`RS:packages/react-aria-components/src/ColorSwatchPicker.tsx:76-94`).
  The PR that added it says it is "based on the RAC ListBox component"
  (https://github.com/adobe/react-spectrum/pull/6272, 2024-04-26).
- Roles: `role: 'listbox'` with `aria-orientation` (`RS:packages/react-aria/src/listbox/useListBox.ts:196-197`).
  Each item is `role: 'option'` with `aria-selected` (`RS:packages/react-aria/src/listbox/useOption.ts:121-123`).
  It does not use `aria-checked`.
- The default group name is the localized "Color swatches" (`RS:packages/react-aria-components/intl/en-US.json`,
  used at `ColorSwatchPicker.tsx:83`).
- Keyboard: in grid layout, the arrow keys move in two dimensions. `getKeyBelow` and
  `getKeyRightOf` branch on `this.layout === 'grid'` (`RS:packages/react-aria/src/selection/ListKeyboardDelegate.ts:194-263`).
  The default `selectionBehavior` is `'toggle'` (`useListBox.ts:137`), so arrows move focus
  and Space or Enter selects. Selection does not follow focus. Focus is real DOM focus on
  the option.
- Each option's type-ahead text is `color.getColorName(locale)` (`ColorSwatchPicker.tsx:160`).
  The swatch inside is `role: 'img'` with `aria-roledescription` "color swatch" and an
  `aria-label` of the color name (`RS:packages/react-aria/src/color/useColorSwatch.ts:62-76`).
  So the option's name comes from its content, for example "vibrant red". That last step
  follows from accname rules; I did not run it (**guess** until tested).
- Open issue: the picker always selects `#000` when nothing is selected
  (https://github.com/adobe/react-spectrum/issues/7918).

**What the APG says.**

| Pattern | Fit for a swatch palette | Key quote |
|---|---|---|
| Radio group | One checked item. Arrows move and check. In a toolbar, arrows move only. | "a set of checkable buttons" (https://www.w3.org/WAI/ARIA/apg/patterns/radio/) |
| Listbox | Single select. Selection may follow focus. | "can severely degrade accessibility in others" (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) |
| Grid | Fewer tab stops for many interactive items. 2D arrows. Harder to build. | "Requires the author to provide code that manages focus" (https://www.w3.org/WAI/ARIA/apg/patterns/grid/) |

- The radio pattern gives no 2D guidance. Up and Down act like Left and Right (radio page).
- The listbox page suggests a convention: some design systems use `aria-selected` for
  single select and `aria-checked` for multi select. It says to pick one convention per app.
- The listbox page sends lists of *interactive elements* to the grid pattern. A swatch is
  not interactive inside an option, so a grid is not needed.

**What WCAG requires of a swatch.**

- **4.1.2 Name, Role, Value.** States "that can be set by the user" must be programmatically
  settable, and changes must be reported to assistive tech. The Understanding page gives the
  selected state of a radio as an example
  (https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html). A swatch therefore
  needs a name (the color name, not only a hex code), a role, and an exposed selected state.
- **1.4.1 Use of Color.** "Color is not used as the only visual means of conveying
  information" (https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). The page does
  not cover pickers. My reading: the color *is* the thing being chosen, so the fill may stay.
  But the *selected* cue must not be a color change alone. Use a ring shape or a check icon,
  and put the name in text or a tooltip for people who cannot tell two swatches apart.
- **1.4.11 Non-text Contrast.** 3:1 "against adjacent color(s)"
  (https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
  - A boundary is needed when there is no other way to see the control. A swatch is seen
    only by its fill, so its fill or a border must be 3:1 against the surface. The essential
    exception covers logos, flags and heat maps, not pickers. So a pale yellow on white
    needs a border.
  - A state indicator inside the component must contrast with the colors inside it. The
    selected ring sits on the swatch, so it needs 3:1 against the swatch color.
  - A disabled swatch is exempt.
- **Double ring.** React Aria's starter draws the selected ring as `border: 2px solid black`
  plus `outline: 2px solid white`, inset (`RS:starters/docs/src/ColorSwatchPicker.css:22-28`).
  S2 does the same with `gray-900` and `gray-25` (`RS:packages/@react-spectrum/s2/src/ColorSwatchPicker.tsx:122-140`).
  For any fill, either black or white reaches at least √21 ≈ 4.58:1. So one of the two rings
  always passes 3:1 (computed here from the WCAG contrast formula).

**How screen readers announce it.**

- ARIA-AT (W3C's screen reader test project) has a radio group test plan and no
  standalone listbox plan (test folders: https://github.com/w3c/aria-at/tree/master/tests/apg).
  Results for "Radio Group Example Using Roving tabindex", V25.10.27, pulled from the
  aria-at.w3.org GraphQL API:

| Screen reader + browser | MUST assertions passed | SHOULD passed | Report date |
|---|---|---|---|
| JAWS + Chrome | 206 / 206 | 158 / 170 | 2026-06-02 |
| NVDA + Chrome | 185 / 192 | 105 / 155 | 2025-10-27 |
| VoiceOver macOS + Safari | 122 / 134 | 94 / 113 | 2025-11-03 |

- a11ysupport.io lists `listbox`, `option`, `radio` and `aria-selected` as features, but its
  data repo has no test results for them (https://github.com/accessibilitysupported/a11ysupport.io,
  `data/tests/tech/aria/` holds no listbox or radio test).
- React Aria's docs say a screen reader will announce "Fire truck red, Background color"
  for a named swatch (`RS:packages/dev/s2-docs/pages/react-aria/ColorSwatch.mdx:39`). They
  publish no per-reader results for the picker.
- What each reader says for a listbox option with `aria-selected` in a 2D layout is not
  published anywhere I found (**guess**: VoiceOver may not say "selected" for a single-select
  option; needs a run).

**Lean.** Radio group, about 65% sure.

- Why: published AT data, native form support, a role users know, and Manti already has
  `RadioGroup` on Zag with a hidden native `type: "radio"` input
  (`zag:@zag-js+radio-group@1.47.0/.../radio-group.connect.mjs:54,144`).
- Cost: arrows move in DOM order, not by row. Selection follows focus, so a live preview
  must be cheap to apply and to undo.
- Second choice: a listbox like React Aria's. Zag 1.47.0's listbox already has a grid
  collection with 2D keys and `aria-selected`
  (`zag:@zag-js+listbox@1.47.0/.../listbox.connect.mjs:26,201-205,283,294`). It uses
  `aria-activedescendant` (line 121, 286) where React Aria moves real focus.
- What would lift the confidence: a VoiceOver, NVDA and JAWS run of both prototypes on a
  4x4 palette.

## 2. Color naming code

- **Where it lives.**
  - `RS:packages/react-stately/src/color/Color.ts`: hue table `OKLCH_HUES` and thresholds
    (lines 70-90), `getColorName` (141-213), `getOklchHue` (215-250), `getHueName` (252-256),
    and the sRGB to OKLCH math (796-877).
  - Strings: `RS:packages/react-stately/intl/color/*.json`, 34 locales from `ar-AE` to
    `zh-TW`, `tr-TR` included.
  - The swatch wrapper: `RS:packages/react-aria/src/color/useColorSwatch.ts` (81 lines), with
    "color swatch" and "transparent" in `RS:packages/react-aria/intl/color/*.json`.
  - Tests: `RS:packages/react-stately/test/color/Color.test.tsx:321` (`#getColorName`).
- **How it works.** Convert to OKLCH. Pick a hue name by angle. Add "light/dark" from L and
  "pale/grayish/vibrant" from C. The template is `"{lightness} {chroma} {hue}"`, so
  translators can reorder it. Dark orange becomes brown and dark yellow becomes yellow green.
  The blog says the old approach "required a huge number of strings"
  (https://react-aria.adobe.com/blog/accessible-color-descriptions). It names no research
  behind the hue angles.
- **Size.** About 215 lines of logic and color math. Each locale file is 39 lines with 37
  keys; 29 of them are for naming (the other 8 are channel names like "Hue").
- **License.** Apache-2.0: file headers (`Color.ts:1-11`), the root `LICENSE`, and
  `"license": "Apache-2.0"` in `react-stately/package.json`. The repo has a `NOTICE.txt`.
- **Can Manti port it with credit?** Yes. Apache-2.0 section 4
  (https://www.apache.org/licenses/LICENSE-2.0, `RS:LICENSE:89-141`) asks for:
  - a copy of the Apache license with the ported code;
  - "prominent notices" in each changed file saying it was changed;
  - the copyright and attribution notices kept in the source;
  - the relevant NOTICE text, if any. React Spectrum's NOTICE lists third-party sources;
    none of them looks like the color code, but keep the parts that apply (**guess** on
    which apply).
  - Apache-2.0 code inside an MIT package is fine. The ported files keep their Apache header.
- **Other open libraries.**
  - `color-description` (MIT, https://github.com/words/color-description): "a human readable
    description" with nouns and adjectives. English only by default; you can pass your own
    word set. Its output is mood words ("deep and rich"), not a short exact name.
  - `color-namer` (MIT) and `ntcjs` (MIT) find the *nearest named color*, the approach
    React Aria dropped (npm metadata).
  - `chromanomer` (Apache-2.0) claims "Universally Accessible Color Selection" in LCH. I did
    not read its code (**secondary**, npm description only).
  - None I found has React Aria's mix of OKLCH, short output and 34 locales.

## 3. Zag's gaps

Zag 1.47.0 swatch parts against the pattern above. Main still has the same code at version
1.47.0 (https://github.com/chakra-ui/zag/blob/main/packages/machines/color-picker/src/color-picker.connect.ts, lines 637-660).

| Gap | Where | Which rule |
|---|---|---|
| Selected state only in `data-state`. No `aria-checked`, `aria-pressed` or `aria-selected` | `zag:color-picker.connect.mjs:578` | 4.1.2 |
| Swatch group is `role: "group"` with no name and no label prop | `:563-567` | 4.1.2, APG |
| Name is `select ${hex} as the color`: English only, hex, not a color name | `:577` | 4.1.2, i18n |
| Each trigger is a plain button: one tab stop each, no arrow keys, no roving focus | `:570-589` | APG radio / listbox |
| No single-select role (no radiogroup or listbox) | `:563-589` | APG |
| The `swatch` part is a styled element with no role or name | `:599-614` | 4.1.2 |
| The fill is inline `background`, with no forced-colors opt-out | `:611` | forced colors |
| No contrast help: no border, no ring | (no code) | 1.4.11 left to the app |

- Indicator uses `hidden` (`:591-597`) and disabled uses the `disabled` attribute (`:574`).
  Both are fine.
- **Open issues.** Searches for "swatch", "color-picker" in titles and
  aria-checked/aria-pressed/radiogroup in chakra-ui/zag and chakra-ui/ark found no open
  issue on swatch accessibility. The only swatch hit is a merged test PR
  (https://github.com/chakra-ui/zag/pull/874). This gap is unfiled.

## 4. How others do palettes for user-picked colors

| Product | Limits picks to passing colors? | How contrast is handled |
|---|---|---|
| GitHub labels | No. Any hex, or a random color (https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels) | Text flips black or white by a "perceived lightness" threshold of 0.453 in light theme. Dark theme tints the fill to 18% alpha and lightens the text. A border fades in for very light fills (https://github.com/primer/react/blob/35ff4972b1d62810df69f606c6785bc7f123d5d5/packages/react/src/Token/IssueLabelToken.module.css lines 3-9, 36-47, 74-77). The lightness is a weighted sum of *gamma-encoded* RGB, not WCAG relative luminance, so it can land near the line without passing 4.5:1 (my reading of the formula). |
| Linear themes | No. Users set base, accent and contrast (https://linear.app/now/how-we-redesigned-the-linear-ui, 2024-03-28) | Generated in LCH. The contrast input can "automatically include super high-contrast themes". |
| Linear labels | Label color is edited from the label row (**secondary**, search summary; docs page returned 404) | No public contrast note found. |
| Slack themes | No. Users "select a swatch from the color picker" (https://slack.com/help/articles/205166337-Change-your-Slack-theme) | No contrast check documented. It points to "vision assistive" themes. |
| Material 3 | No. Any source color | Derives tones in HCT. "A difference of 40 in tone guarantees" 3:1; 50 guarantees 4.5:1. Default, medium and high contrast levels (https://github.com/material-foundation/material-color-utilities/blob/main/concepts/contrast_for_accessibility.md) |
| Apple HIG | No. "Prefer system-provided color controls" (https://developer.apple.com/design/human-interface-guidelines/color, JSON data) | System colors have Increase Contrast variants. Apps should check colors in light, dark and increased contrast. |

- The pattern: products either take any color and fix the *pairing* (GitHub, Material,
  Linear), or leave it to the user (Slack, Apple). None shows a contrast badge on a swatch.
- For us that means: a fixed, curated palette is *stricter* than everyone above. Material's
  tone rule is the one known way to make "passes" a property of how the palette is built,
  not something checked by hand.

## 5. Forced colors and high contrast

- In forced colors, the browser forces `background-color` and border and outline colors to
  system colors, and `box-shadow` computes to none
  (https://www.w3.org/TR/css-color-adjust-1/). So a swatch drawn by background turns blank,
  and a ring drawn by `box-shadow` vanishes.
- `forced-color-adjust: none` keeps an element's colors. The spec says to use it only when
  "they are themselves adjusting the colors".
- The native color input's swatch already opts out. A CSSWG thread says the swatch needs
  `forced-color-adjust: none` (https://github.com/w3c/csswg-drafts/issues/12060).
- **React Aria.**
  - `useColorSwatch` sets `forcedColorAdjust: 'none'` inline on every swatch
    (`useColorSwatch.ts:76`). S2's `ColorSwatch` does too (`RS:packages/@react-spectrum/s2/src/ColorSwatch.tsx:112-116`).
  - S2's selected ring also opts out (`s2/src/ColorSwatchPicker.tsx:137`), so it keeps
    gray-900 and gray-25, not system colors.
  - S2's focus ring switches to `Highlight` in forced colors
    (`RS:packages/@react-spectrum/s2/style/index.ts:78-90`).
  - The plain starter CSS puts `forced-color-adjust: none` on the whole *item*
    (`starters/docs/src/ColorSwatchPicker.css:14`), so its focus outline does not get a
    system color. That looks like a gap in the starter, not in S2 (my reading).
- **How ours should draw** (a sketch, not tested in Windows):

```css
.swatch-fill { forced-color-adjust: none; } /* the color is the content */
@media (forced-colors: active) {
	.swatch { border: 1px solid ButtonBorder; }                  /* edge on any fill */
	.swatch[aria-checked="true"] { outline: 2px solid Highlight; outline-offset: 2px; }
	.swatch[aria-checked="true"] .check { color: CanvasText; }   /* non-color cue */
	.swatch:focus-visible { outline: 2px solid Highlight; }
}
```

  Keep the ring and the check outside the opted-out fill, so the user's theme colors apply
  to them. Draw rings with `outline` or `border`, never `box-shadow`.

## What this cannot tell us

- **Real announcements.** What VoiceOver (macOS, iOS), NVDA, JAWS, Narrator and TalkBack
  say for (a) React Aria's 2D listbox, (b) a native radio group of swatches and (c) Zag's
  listbox with `aria-activedescendant`. Check the role, the name, "selected" or "checked",
  "3 of 16", and whether "color swatch" is read twice. ARIA-AT only covers a 1D radio group.
- **2D arrow keys and reader modes.** Whether NVDA and JAWS browse mode pass arrow keys to
  a grid-layout listbox, and whether up/down by row helps or confuses users.
- **Name quality.** Whether "vibrant pink red" helps people pick, in English and Turkish.
  The hue angles have no published research. Needs a few user sessions.
- **Forced colors in practice.** Nothing here was run in Windows High Contrast. The CSS
  above is a sketch.
- **Color vision.** WCAG has no rule that two swatches must differ for people with color
  blindness. Names and order are our only guard; a CVD simulation of the palette is still
  to do.
- **Linear's label picker.** Its docs page did not load, so its palette rules are unknown.
