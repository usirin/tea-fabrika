---
date: "2026-11-02"
scripts: "none; reading, plus a look build on a local branch, shot at five layouts, not kept"
summary: "Reading, not a measurement. Material, Apple, Primer, Atlassian, Carbon, Polaris, Geist, Radix, Chakra, Linear, NN/g, Butterick, WCAG, the FAA's flight display guide and road signs agree: a few named text styles, each size, weight and color at once, rank by size then weight, few loud things. Manti's scale at base 13 gives 12, 13, 15 and 22, the steps of macOS's text styles and Linear's app (whose title is 24). Today's version sets 105 sizes by hand in 13 sizes, and uses Manti's `Text` and `Heading` nowhere. On the ask desk's round 6 card five things shout and the rec is the smallest; six text styles alone fix it, with the rec at 15/600 and the question at 13/500. The build found `themes.test.ts` reads colors from CSS selectors and Manti's `primary` text is orange. A read of Manti's repo during the owner's walk found no description list and a level 1 `Heading` at 29.25px with no size. No screen reader was run; 13 for long prose is unchecked. $0."
---

# Which text styles should fabrika's programs share, and what does the ask desk's card teach?

Read 2026-11-02. **This is reading, not a measurement.** One look build ran on a local branch in
today's version and was shot at five layouts beside today's app and Linear; it is not kept in the
repo. It feeds [typography](../docs/direction/typography.md), a note decided on 2026-11-02, and a
private page, "Typography guidelines", where the card switches between today and the text styles.

This read first called them "roles". The owner's walk renamed them text styles, the word Apple
[t2], Figma [t22], Panda [t23] and Chakra [t19] use; Material's roles are groups of styles. The
names below follow the walk, and quotes keep their own words.

**The answer.** The makers agree. Name a few text styles by their job, set each one's size, weight
and color together, and let a screen use only those. Rank comes from size first, then weight, then
one quieter gray. Keep the set small: Material says a product "will likely not need all 15", and
NN/g says no more than three sizes. Apple's macOS styles and Linear's app use the same steps we
already have: 12, 13, 15 and a title near 22. Today's version breaks this in every program:

- **It breaks:** `window.css` sets 105 font sizes by hand, in 13 different sizes and 27 size and
  weight pairs. No program uses Manti's `Text` or `Heading`.
- **On the running example,** the ask desk's "Your turn" card as round 6 of the ask desk look built
  it, five things shout at once: "Your turn" in accent at 600, the agent's id in mono, the question
  at 15/600, the rec's value at 13/600 and the indigo button. The rec, the thing you act on, is the
  smallest of the loud ones.
- **It follows:** two text grays only, one sans font, mono for typed words in most places, and a
  scale already mapped onto Manti's sizes in `theme.css`.

```text
how each tool read names its text, one line each
Material 3   display, headline, title, body, label; three sizes each; "not need all 15"
Apple        text styles; macOS Body 13, Headline 13 bold, Callout 12, Title 3 15, Title 1 22
Primer       body.medium the default; caption 12 for single lines only; title.small = body, heavier
Atlassian    heading, body and code styles; "rather than bold or a change of font size"
Carbon       productive base 14; label and helper text 12; heading01 14 semibold
Polaris      a variant for size and weight, a separate tone for color, a numeric prop
Geist        Label for single lines, Copy for many lines, at 14, 13 and 12
Radix        a 9-step size scale; color steps 11 and 12 are the two text steps
Chakra       textStyle: one name for size, weight, line height and tracking
Linear       app CSS 11, 12, 13, 15, 18, 20, 24, 36; weights 450, 500, 600; four text grays
Manti 0.13   Text with size, weight and emphasis; Heading with level; no named styles
```

Which version: everything read about the makers is outside the repo. "Today" means today's version
(`apps/fabrika`, `programs/`), read on main at `5e0d3fe7`, except the card, which is round 6 of the
ask desk look on a local branch ([PR 326](https://github.com/usirin/tea-fabrika/pull/326) records
that look as decided). `next/` has no window on main yet; it gets the text styles through the
shared design package.

## What was read

About 25 public pages and two stylesheets, quoted as fetched on 2026-11-02, Manti 0.13.0's source
as installed, and seven files of today's code. Quotes marked **secondary** came only from a search
summary.

### Design systems

| Source | What it says that matters here |
|---|---|
| Material 3 [t1] | Roles "organized into roles that describe their purpose": display, headline, title, body, label. "Your product will likely not need all 15 default styles". Label medium is 12 at weight 500. |
| Apple HIG [t2] | "A text style specifies a combination of font weight, point size, and leading values". The macOS default is 13pt. Headline is Body's size, bold: "the bold trait adds weight to text, letting you create another level of hierarchy." Callout 12, Title 3 15, Title 1 22. |
| GitHub Primer [t3] | Caption, 12 with a tight line: "Use it for single-line scenarios". Title small "Uses the same size as body (large) with a heavier weight". "Don't adjust semantic heading tag order to achieve a specific visual design". |
| Atlassian [t4] | "Use heading styles, rather than bold or a change of font size, as they're important for accessibility." Body S "should be used sparingly". |
| IBM Carbon [t5] | "The productive type set uses a base type size of 14px". Label, helper text and caption are all 12. |
| Shopify Polaris [t6] | `Text` takes a variant (size and weight) and a separate tone (color), plus `numeric`: "Use a numeric font variant with monospace appearance". |
| Vercel Geist [t7] | Label is "Designed for single-lines"; Copy is "Designed for multiple lines of text, having a higher line height than Label". Copy 13 is "For secondary text and views where space is a premium." |
| Radix [t8] | "Steps 11 and 12 are designed for text. Step 11 is designed for low-contrast text. Step 12 is designed for high-contrast text." |
| Chakra [t19] | "Text styles allows you to define textual css properties", used through one `textStyle` prop. |
| Radix Data List [t20] | "Displays metadata as a list of key-value pairs", in four parts: Root, Item, Label, Value. |

The plain way they agree on: a short list of named text styles, each one size, weight, line height and
color at once, and nothing set by hand. Body text in a dense tool is 13 or 14. A one-line label is
12. A small heading is the body's size, heavier. Where it clashes with a goal of ours: Carbon and
Primer use 14 for body, and we use 13, the macOS default, because programs share tiles.

### Linear

- **Fonts.** "We started using Inter Display to add more expression to our headings while
  maintaining their readability and kept using regular Inter for the rest" [t9].
- **Weight.** "not every element of the interface should carry equal visual weight. While the parts
  central to the user's task should stay in focus, ones that support orientation and navigation
  should recede" [t10].
- **Sizes.** The app's stylesheet names eight: micro 11, mini 12, small 13, regular 15, large 18,
  title3 20, title2 24, title1 36. Weights are 300, 450, 500, 600 and 700. Text color comes in four
  grays, primary to quaternary. A person can set the app's font size [t11].
- **What it cannot show.** Most component styles load after sign-in, so which size each screen uses
  is read from public shots, not counted.

### Thinkers and WCAG

- **NN/g** [t12]: "Use no more than 3 sizes" and "no more than 3 contrast variations". "Do not rely
  only on color to communicate visual hierarchy." Headings that stand out make "an efficient scanning
  pattern" possible [t13].
- **Butterick** [t14]: line spacing "120–145% of the point size"; "if everything is emphasized,
  then nothing is emphasized."
- **WCAG 2.2** [t15]: 1.4.4 resize to 200 percent; 1.4.12 text spacing, a line height of 1.5 times
  the size must not break anything; 1.3.1 structure "can be programmatically determined"; 2.4.6
  headings and labels "describe topic or purpose"; 1.4.3, 4.5:1 below 18pt, or 14pt bold.

### Outside software

- **The cockpit,** FAA AC 25-11B [t16]: "A text change by itself should not be used as an
  attention-getting cue". Size and contrast are named as the parameters of reading. It teaches: a
  text style is for reading order, and an alert needs more than bigger text. It does not carry over: its
  sizes are set for a fixed viewing distance.
- **Road signs,** MUTCD 2A [t17]: "Word messages should be as brief as possible", and warnings
  "if used to excess, tend to lose their effectiveness." It teaches: few loud things, or none
  works. It does not carry over: a sign's size grows with speed, and a tile does not move.
- **Ableton Live** [t18], **secondary**: one zoom scales the whole window and there is no font
  setting. It teaches: a person who needs bigger text scales the text styles together, never one
  size. It does not carry over: Live has no text styles to name.

### Manti 0.13.0, as installed

- **`Text`** takes `size` (a scale, or `scale/weight` such as `xl/semibold`), `emphasis` (`default`,
  `muted`, `subtle`), `variant`, `truncate`, `lineClamp` and `as`. It draws
  `data-scope="text" data-size data-weight data-emphasis`, in the `manti.components` layer [t21].
- **`Heading`** takes `level` 1 to 6, which picks the element and a default size, semibold, tight
  tracking and `text-wrap: balance`. Its size can be set apart from its level.
- **What it lacks:** named styles (a `textStyle`, as Chakra has), a label and value list (as Radix
  has), and a `numeric` prop (as Polaris has). The `primary` variant is Manti's orange; our
  `theme.css` must map it to our accent.
- **Added by a read of Manti's whole repo during the walk.** No `<dl>` appears anywhere in Manti's
  packages. `Heading` picks its size from its level when it has none, and level 1 is 4xl; our
  `theme.css` maps `xs` to `2xl` only, so `<Heading level={1}>` draws at 29.25px. Manti's
  [issue 135](https://github.com/manti-ui/ui/issues/135), open, asks how a brand adds named styles
  such as a label, and offers three options; the third is to compose them from existing tokens.

### Read during the walk

| Source | What it adds |
|---|---|
| Figma [t22] | A text style is one saved set of font, size, weight and line height, applied by name. |
| Panda [t23] | `textStyles` in the theme config, applied through one `textStyle` prop. |
| MDN [t24] | `<dl>`, `<dt>` and `<dd>`: a description list, its terms and their details. |
| Tailwind Catalyst [t25] | `DescriptionList`, `DescriptionTerm` and `DescriptionDetails`, HTML's names as components. |
| Shopify Polaris [t26] | A `DescriptionList` component for terms and their descriptions. |

## Today's card and its neighbors

Checked on main, except the card, which is round 6 of the ask desk look on a local branch.

| What | Today | Where |
|---|---|---|
| Sizes set by hand | 105 declarations, 13 sizes, 27 size and weight pairs | `apps/fabrika/src/window/window.css` |
| Manti's text parts | `Text` and `Heading` used nowhere | `programs/`, `apps/fabrika/src` |
| The scale | 11, 12, 13, 14, 15, 22 mapped to Manti's xs to 2xl | `apps/fabrika/src/window/theme.css:14` |
| The card on main | "Your turn · question" on one line, the meta under it | `programs/ticket/src/window.tsx:135` |
| The card, round 6 | eyebrow 600 accent, agent id in mono, question 15/600, rec 13/600 | local branch, not pushed |
| A tracker row | title 14/400; number and meta 12 in the low gray, each set in its own rule | `programs/tracker/src/window.tsx:397`, `window.css:1915` |
| The ticket heading | `#7` in mono, the title an `h1` at 22 | `programs/ticket/src/window.tsx:603` |
| Activity | an agent's id in mono, its cost and turns in mono | `window.css:2431`, `window.css:2700` |
| Prose | 14 at line height 1.65, in the low gray | `window.css:2621` |

The same card, checked against each principle the note sets:

| Principle | Today's card |
|---|---|
| T1. Every size comes from a text style | **Breaks.** Each of its eight text parts is sized in its own CSS rule. |
| T2. What you act on leads its block | **Breaks.** The rec is 13/600, smaller than the question at 15/600. |
| T3. Rank by size, then weight, in two grays | **Half.** Two grays, but four parts at 600 compete. |
| T4. The text style sets the look, the element the meaning | **Passes.** The question is an `h2`. Nothing ties its look to that. |
| T5. A label is one line; meta gives way first | **Half.** In the 1024x700 shot the tracker title squeezed to "`fabri…" before its meta did. |
| T6. Mono only for typed words | **Breaks.** The agent's id `lane` and Activity's cost are mono. |

## The look build

Today's version, on a local branch, not pushed. Six text styles on Manti's `Text` and `Heading` were
put on three places: the card, the tracker's rows and the ticket's heading. Their CSS lost its sizes,
weights and colors. Each place was shot with Playwright on Electron, the way `apps/fabrika/e2e.ts`
drives the app, with its own short temp `FABRIKA_HOME`, at one tile, two side by side, two stacked,
a 2x2 grid and 1024x700, and set beside round 6 and Linear's issue page, list and Triage
Intelligence.

```text
round   what changed                                              the rec reads as
A       the card from text styles; rec at strong (13/500)         weaker than round 6
C       rec at heading (15/600)                                   the loudest text in the card
CD      rec at heading; the question at strong (13/500), an h2    the loudest, and alone
```

Round CD is the one the owner said yes to on 2026-11-02. Two fixes came from the small shot: the
row's title column got a floor (`minmax(16ch, 1fr)`), and the meta line now ends in an ellipsis
before the title does. A title's backticked words became `<code>`, typed words in mono.

What it found that the note must fix:

- **`themes.test.ts` reads colors from CSS selectors.** Four of its checks failed once color came
  from Manti's props instead of `.tracker-title` and `.tk-title`. The law must read the `textStyles` map.
- **`primary` text was orange.** One line in `theme.css` maps it to our accent.

## What this tells us for fabrika

- **Six text styles cover every place read**: title, heading, strong, body, quiet, label. That is three
  sizes in common use (12, 13, 15) and one title (22), inside NN/g's three, plus the title.
- **The numbers we have are the known numbers.** Manti's scale at base 13 gives 12, 13, 15 and 22.
  macOS: Callout 12, Body 13, Title 3 15, Title 1 22. Linear: 12, 13, 15 and a 24 title.
- **The card got better from text styles alone.** No card-only size was needed; the rec found its
  rank from the list of six.
- **Manti has the parts, not the names.** The `textStyles` map lives in our code and is spread onto
  Manti's own props. It goes in the shared design package, with the description list, so both
  versions use one list. Manti's issue 135 gets our six as a real case.

## What it cannot tell us

- Whether 13 is big enough for a long description. The build changed no prose; a shot of a long
  ticket body at 13 settles it.
- How a screen reader reads the card. No screen reader was run. The question stays an `h2`, so
  heading navigation should not change.
- Whether 22 should be 24, as in Linear. Nothing measured that; it is a guess, 80% that 22 holds.
- Whether the text styles fit the trace waterfall, the asks popup and the trace's labels. They were
  read and seem to fit; they were not built.
- How often a program needs a seventh text style. Only three places were built.

$0. Reading only; no model ran.

## Links

- [t1] Material 3, [developer.android.com](https://developer.android.com/develop/ui/compose/designsystems/material3) and [material-web typography](https://github.com/material-components/material-web/blob/main/docs/theming/typography.md)
- [t2] [Apple HIG, typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [t3] [Primer typography tokens](https://github.com/primer/primitives/blob/main/src/tokens/functional/typography/typography.json5) and [Primer foundations](https://primer.style/foundations/typography)
- [t4] [Atlassian typography](https://atlassian.design/foundations/typography)
- [t5] [Carbon type sets](https://carbondesignsystem.com/elements/typography/type-sets/)
- [t6] [Polaris `Text`](https://github.com/Shopify/polaris/blob/main/polaris-react/src/components/Text/Text.tsx)
- [t7] [Geist typography](https://vercel.com/geist/typography)
- [t8] [Radix Themes typography](https://www.radix-ui.com/themes/docs/theme/typography) and [Radix Colors scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- [t9] [Linear, how we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [t10] [Linear, a calmer interface](https://linear.app/now/behind-the-latest-design-refresh)
- [t11] Linear's app stylesheet, read from the sign-in page's shell on 2026-11-02
- [t12] [NN/g, visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- [t13] [NN/g, layer-cake](https://www.nngroup.com/articles/layer-cake-pattern-scanning/)
- [t14] [Butterick, line spacing](https://practicaltypography.com/line-spacing.html) and [bold or italic](https://practicaltypography.com/bold-or-italic.html)
- [t15] WCAG 2.2: [1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), [1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html), [2.4.6](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html), [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [t16] [FAA AC 25-11B](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25-11B.pdf)
- [t17] [MUTCD 2009, chapter 2A](https://mutcd.fhwa.dot.gov/htm/2009/part2/part2a.htm)
- [t18] Ableton Live 12 manual, Display and Input, **secondary**
- [t19] [Chakra text styles](https://chakra-ui.com/docs/styling/text-styles)
- [t20] [Radix Themes Data List](https://www.radix-ui.com/themes/docs/components/data-list)
- [t21] `@manti-ui/react` 0.13.0, `Text` and `Heading`, as installed by the lockfile
- [t22] [Figma, create and apply text styles](https://help.figma.com/hc/en-us/articles/360039957034)
- [t23] [Panda CSS text styles](https://panda-css.com/docs/theming/text-styles)
- [t24] [MDN, the `<dl>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dl)
- [t25] [Tailwind Catalyst, description list](https://catalyst.tailwindui.com/docs/description-list)
- [t26] [Shopify Polaris, description list](https://polaris.shopify.com/components/lists/description-list)
