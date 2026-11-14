---
state: "decided 2026-11-02"
summary: "Both versions, today's windows first, through `@kampus/fabrika-design`. Six text styles in `text-styles.ts` (`textStyles`, `TextStyle`), spread onto Manti's `Text` and `Heading`: `title` 22/600, `heading` 15/600, `strong` 13/500, `body` 13, `quiet` 13 in the low gray, `label` 12 in the low gray; the same steps as macOS's text styles and Linear's app. \"Text styles\", not \"roles\", as Apple, Figma, Panda and Chakra say. Six principles: every size comes from a text style; what you act on leads its block; rank by size, then weight, in two grays; the text style sets the look, the element the meaning; a label is one line and meta gives way first; mono only for typed words. `DescriptionList`, `DescriptionTerm` and `DescriptionDetails` live in the same package, built from Manti's `Text`. No new prop on Manti; our six go to Manti's issue 135 as a real case. The ask desk's card is the test: its rec moves to `heading` and its question to `strong`. The ledger records nothing new."
---

# Typography

**Decided 2026-11-02.** The owner approved the six principles, the shape and the smaller calls below
with their leans, after a walk of each part. The leans' confidence numbers stay as written. The walk
changed two things:

- **"Roles" became "text styles".** The file is `text-styles.ts`, the export `textStyles` and the
  type `TextStyle`. The six names stay: `title`, `heading`, `strong`, `body`, `quiet`, `label`. Apple
  [t2] and Figma [t22] call one named size, weight and leading a "text style", and Panda [t23] and
  Chakra [t19] name the config `textStyles`. Material's "roles" [t1] are groups of styles, such as
  body in large, medium and small.
- **A description list lives in our package.** `DescriptionList`, `DescriptionTerm` and
  `DescriptionDetails`, in `@kampus/fabrika-design`, built from Manti's `Text` (`as="dt"` and
  `as="dd"`). The piece owns its `dt` and `dd` and their default look. The names are HTML's own
  (MDN [t24]), as in Tailwind's Catalyst [t25] and Shopify Polaris [t26]. Not `DataList`, Radix's
  name [t20], since it clashes with HTML's `<datalist>`. Manti 0.13.0 has no description list.

Its decided rules are in: [0457](../../.decisions/0457-six-text-styles-set-every-size.md),
[0458](../../.decisions/0458-what-you-act-on-leads.md),
[0459](../../.decisions/0459-a-label-never-wraps.md),
[0460](../../.decisions/0460-mono-only-for-typed-words.md).

Earlier the same day, after the look step, the owner decided the look built from the six text
styles; the rec at `heading` (15/600) and the question at `strong` (13/500, still the `h2`); prose
from 14 in the low gray to `body` (13, step 12); Activity's mono agent id and cost to sans in the
same tryout; and the text styles' home in `@kampus/fabrika-design`
([one design package](./fabrika-design-package.md)).

Built from [experiment 200](../../experiments/200-typography.md), which read about 20 makers and
tools and checked the ask desk's "Your turn" card, a tracker row and the ticket heading against them,
and a private page, "Typography guidelines", where the card switches between today and the text
styles.
Neither is a measurement. It builds on [color principles](./color-principles.md) and
[themes](./themes.md) (two text grays, rank from size and weight), [UI on Manti](./ui-on-manti.md)
(the type scale on Manti's sizes) and [popovers](./popovers.md) (one font, mono only for typed
words).

```ts
// A sketch. @kampus/fabrika-design, text-styles.ts. The look build ran this map under another name.
import type {TextProps} from "@manti-ui/react";

export const textStyles = {
	title: {size: "2xl/semibold"}, //             22, 600, step 12: a page's one title
	heading: {size: "xl/semibold"}, //            15, 600, step 12: what you act on
	strong: {size: "base/medium"}, //             13, 500, step 12: a row's title, a question
	body: {size: "base"}, //                      13, 400, step 12: prose
	quiet: {size: "base", emphasis: "muted"}, //  13, 400, low step: a reason, a quote
	label: {size: "sm", emphasis: "muted"}, //    12, 400, low step: one line of meta
} as const satisfies Record<string, TextProps>;
export type TextStyle = keyof typeof textStyles;
```

```tsx
// A sketch, today's version: the ask desk's card, made only from text styles.
<Text {...textStyles.label}>
	<Text as="span" {...textStyles.label} variant="primary">Your turn</Text> · lane asked at 10:09
</Text>
<Heading level={2} {...textStyles.strong}>Approve plan v1?</Heading>
<DescriptionList>
	<DescriptionTerm>Recommended</DescriptionTerm>
	<DescriptionDetails textStyle="heading">
		Approve <Text as="span" {...textStyles.label}>95% sure</Text>
	</DescriptionDetails>
</DescriptionList>
<Text {...textStyles.quiet}>Both tasks have a test, and no question is open.</Text>
```

```tsx
// A sketch. @kampus/fabrika-design, description-list.tsx, built from Manti's Text.
import {Text, type TextProps} from "@manti-ui/react";
import type {ComponentProps} from "react";
import {type TextStyle, textStyles} from "./text-styles.ts";

type DetailsProps = TextProps & {textStyle?: TextStyle};

export const DescriptionList = (props: ComponentProps<"dl">) => <dl {...props} />;
export const DescriptionTerm = (props: TextProps) => (
	<Text as="dt" {...textStyles.label} {...props} />
);
export const DescriptionDetails = ({textStyle = "body", ...props}: DetailsProps) => (
	<Text as="dd" {...textStyles[textStyle]} {...props} />
);
```

`DescriptionDetails` takes a `textStyle` prop because it is our own piece, and the prop only spreads
`textStyles[textStyle]`. Manti's `Text` gets no new prop.

```text
one text style traced: the rec's value
DescriptionDetails    textStyle="heading", which spreads textStyles.heading, {size: "xl/semibold"}
Manti's Text          <dd data-scope="text" data-size="xl" data-weight="semibold">
tokens.css            --manti-text-xl: var(--fs-head), which is 15px
what a person sees    "Approve" at 15/600 in step 12, the loudest text in the card
a screen reader       the h2 "Approve plan v1?" first, then the list: "Recommended, Approve"
```

## Which version

- **Today's version (`apps/fabrika`, `programs/`):** the text styles go on its windows first,
  starting with the card, the tracker rows and the ticket heading, then each program as it is
  touched. The fixes are at [a tryout in today's version](#a-tryout-in-todays-version), none filed.
- **`next/`:** it imports the same text styles and description list from `@kampus/fabrika-design`.
  Its first window uses them from the start.

## Why these numbers

Manti's scale at base 13, as the design package's `tokens.css` maps it, gives 12, 13, 15 and 22. Two makers that build
dense desktop tools land on the same steps.

| Text style | Ours | macOS text style [t2] | Linear's app CSS [t11] |
|---|---|---|---|
| `label` | 12 | Callout 12 | mini 12 |
| `body`, `quiet`, `strong` | 13 | Body 13, Headline 13 bold | small 13 |
| `heading` | 15 | Title 3 15 | regular 15 |
| `title` | 22 | Title 1 22 | title2 24 |

22 against Linear's 24 is a guess, 80% that 22 holds: it is macOS's Title 1, and it is already
today's ticket title. A shot of a long title at 24 in a half tile would settle it. Manti's `lg` (14)
and `xs` (11) get no text style: 14 was prose, which moves to 13, and 11 is under Primer's 12 floor
for a caption [t3].

Every heading takes a text style. A Manti `Heading` with no size picks one from its level, and
`<Heading level={1}>` draws at 4xl, 29.25px, because our `tokens.css` does not map 3xl to 5xl
[t21].

## The six principles

### T1: Every size comes from a text style

**Decided 2026-11-02, lean 85%.** Kind: lint.

- **What it means.** A program's text takes one of six text styles. No program's CSS sets a
  `font-size`, a `font-weight` or a text color. A seventh text style is a change to the package, not
  a local rule.
- **Why.** "A text style specifies a combination of font weight, point size, and leading values"
  (Apple [t2]). "Your product will likely not need all 15 default styles" (Material [t1]). "Use no
  more than 3 sizes" (NN/g [t12]).
- **Linear row.** Linear's team would put the text styles in the one place every program draws
  from, so a new program gets the right text for free, and its settings' font size scales all six at
  once. They run eight sizes; we run four, since our programs share tiles.
- **Elm answer.** A text style is part of the view. The model and update do not change.
- **Holds it.** The `TextStyle` type in `@kampus/fabrika-design`. Later, a lint that fails on a
  size, weight or text color in a program's CSS. Its false alarms are measured before it blocks.
- **Doubt.** A seventh text style may be needed for the trace waterfall's labels or the asks popup.
  The next two programs moved onto text styles settle it.
- **Cost.** The map is 10 lines. Moving a program is about 20 to 60 lines each.
- **Today.** Breaks. `window.css` sets 105 sizes by hand in 13 sizes and 27 size and weight pairs.
  `Text` and `Heading` are used nowhere.

### T2: What you act on leads its block

**Decided 2026-11-02, lean 75%.** Kind: taste. Decided on the card first: the rec at `heading`,
the question at `strong`.

- **What it means.** In a block a person answers or picks from, the thing they act on is the
  loudest text. The question that frames it steps down a rank.
- **Why.** "not every element of the interface should carry equal visual weight. While the parts
  central to the user's task should stay in focus, ones that support orientation and navigation
  should recede" (Linear [t10]). Warnings "if used to excess, tend to lose their effectiveness"
  (MUTCD [t17]).
- **Linear row.** Triage Intelligence shows a suggestion as a quiet label and a strong value. We do
  the same, with the value one size up, because the rec is the card's job.
- **Elm answer.** Nothing in the model. The view picks the text style.
- **Holds it.** Taste: a shot beside Linear. On the card, a law can check that the rec's text style
  outranks the question's.
- **Doubt.** A card with no rec now has a 13/500 question as its loudest line. The running, stuck
  and done cards need a shot each.
- **Cost.** None beyond T1.
- **Today.** Breaks. Round 6's card set the rec at 13/600, under the question at 15/600.

### T3: Rank by size, then weight, in two grays

**Decided 2026-11-01** in [color principles](./color-principles.md) and [themes](./themes.md).
Kind: law.

- **What it means.** A text style differs from the one below it by size first, then weight. Text
  uses two grays: step 12 and the low step. Manti's third emphasis, `subtle`, has no text style.
- **Why.** "The system-defined text styles give you a convenient and consistent way to convey your
  information hierarchy through font size and weight" (Apple [t2]). "Steps 11 and 12 are designed
  for text" (Radix [t8]). "Use no more than 3 contrast variations" (NN/g [t12]).
- **Linear row.** Linear uses four text grays. We keep two, as decided, and rank by size and weight
  where Linear would reach for a third gray.
- **Elm answer.** View only.
- **Holds it.** A test over the `textStyles` map: every `emphasis` is the default or `muted`, and
  every pair of text styles differs in size or weight.
- **Doubt.** None on the rule. The test is small.
- **Cost.** About 20 lines of test.
- **Today.** Half. Two grays, but round 6's card has four parts at weight 600.

### T4: The text style sets the look, the element sets the meaning

**Decided 2026-11-02, lean 85%.** Kind: law. WCAG 1.3.1 and 2.4.6.

- **What it means.** A heading is an `h1` or `h2` because of the page's outline, and its text style
  is picked for how loud it should be. The question is an `h2` at `strong`; the ticket's title is
  the `h1` at `title`. A label and its value are a `dt` and a `dd`, drawn by `DescriptionTerm` and
  `DescriptionDetails`.
- **Why.** "Don't adjust semantic heading tag order to achieve a specific visual design" (Primer
  [t3]). Structure "can be programmatically determined" (WCAG 1.3.1 [t15]). Atlassian ties the
  two together: "Use heading styles, rather than bold or a change of font size" [t4]. Manti splits the
  two: `Heading` takes a `level` and a `size` apart.
- **Linear row.** No Linear answer: its markup is not public, so its heading levels cannot be read.
- **Elm answer.** The element comes from the view's structure; the text style is spread onto it.
- **Holds it.** A law per window: headings go `h1` then `h2`, with no skipped level, read from the
  rendered tree, whatever their text styles. The description list owns its `dt` and `dd`, so a
  program cannot draw a pair that is not a pair in the tree.
- **Doubt.** No screen reader run yet. One run on the card settles it.
- **Cost.** About 30 lines of law.
- **Today.** Passes on the card: the question is an `h2`. Nothing ties its look to that.

### T5: A label is one line, and meta gives way before a row's title

**Decided 2026-11-02, lean 80%.** Kind: law.

- **What it means.** `label` text never wraps. In a row, the meta line ends in an ellipsis before
  the title loses its first words. The title keeps a floor of 16 characters.
- **Why.** A caption is "for single-line scenarios" (Primer [t3]). Geist's Label is "Designed for
  single-lines" [t7]. WCAG 1.4.12 asks that a line height of 1.5 times the size break nothing [t15].
- **Linear row.** Linear's list shots put the title first and the meta after it, at the right. How
  its rows squeeze in a narrow window was not seen; a guess is that the meta goes first.
- **Elm answer.** View only.
- **Holds it.** A layout law at 1024x700 and at a quarter tile: a row's title shows at least 16
  characters.
- **Doubt.** 16 is from one shot, not a measure. More titles at the small layout settle it.
- **Cost.** The grid change is 3 lines; the law about 30.
- **Today.** Half. At 1024x700 the tracker's title squeezed to "`fabri…" while its meta stayed.

### T6: Mono only for typed words

**Decided** in [popovers](./popovers.md) and [color principles](./color-principles.md). Kind: lint.

- **What it means.** Mono marks what a person types or reads as code: a command, a path, backticked
  words in a title. An agent's id, a ticket number and a cost are sans.
- **Why.** Geist keeps mono for "inline code mentions" [t7]. Linear's app names Inter for its text and
  a separate mono font [t11].
- **Linear row.** Issue IDs are sans, in a low gray, in Linear's list shots.
- **Elm answer.** View only.
- **Holds it.** Later, a lint on `.mono` and `var(--mono)` outside typed spans. Today, the text
  styles carry no font family, so a text style is always sans.
- **Doubt.** Numbers that line up in columns need `tabular-nums`, which today comes from `.view`.
- **Cost.** Part of the tryout below.
- **Today.** Breaks. An agent's id is mono (`apps/fabrika/src/window/window.css:2431`), Activity's
  cost and turns are mono (`window.css:2700`), the ticket number is mono
  (`programs/ticket/src/window.tsx:603`) and so is the cost on the ticket page
  (`programs/ticket/src/window.tsx:372`).

## The smaller calls

All five were taken as leaned on 2026-11-02. The second changed its lean during the walk, before it
was taken.

**The names.** Taken: `title, heading, strong, body, quiet, label`, lean 70%.

```ts
const ours = ["title", "heading", "strong", "body", "quiet", "label"];
const material = ["headline", "title", "body", "label"]; // each in large, medium, small
const linear = ["title2", "regular", "small", "mini"]; // size names, not jobs
```

Material's names are the industry's, but its `title` is a mid rank and its sizes come in threes. Ours
name the job in one plain word. The doubt: `strong` and `quiet` are ours alone. If the owner wants
Material's, `strong` becomes `title-small` and `quiet` is `body` with a color.

**How a program uses a text style.** Taken: spread Manti's own props, and add no new prop to Manti,
lean 75%.

```tsx
<Text {...textStyles.label}>#117</Text> // works on Manti 0.13.0 as it is
```

This replaces the first lean, "a Manti `textStyle` later". Manti's way is size and emphasis props,
and its [issue 135](https://github.com/manti-ui/ui/issues/135), still open, asks how a brand adds
named styles. Our six text styles go there as a real case, in one comment. A wrapper of our own
(`<T textStyle="label">` over every `Text`) would work around Manti, which
[UI on Manti](./ui-on-manti.md) rules out. `DescriptionDetails` is different: it owns an element,
and its `textStyle` prop only spreads `textStyles[textStyle]`.

**The title's size.** Taken: 22, lean 80%.

```ts
const title = {size: "2xl/semibold"}; // 22: macOS Title 1, and today's ticket title
const title24 = {size: "3xl/semibold"}; // 24: Linear's title2; needs --manti-text-3xl mapped
```

22 needs no new token and matches the platform. The doubt: Linear's heavier title may read better
over a long ticket page. A shot of a long title at both sizes in a half tile settles it.

**Line height.** Taken: Manti's own, lean 75%: 1.5 for most, snug at `xl` and `2xl`. Butterick asks 120 to
145% [t14]; WCAG asks that 1.5 break nothing [t15]. Prose at 13 may want more; the long description
shot settles it.

**Numbers.** Taken: `tabular-nums` from `.view`, as today, lean 70%. A Manti `numeric` prop (Polaris [t6])
is a pull request idea, not a need yet.

## What the ledger records

Nothing new. A text style is how the view draws a value; no fact is written when text is drawn, so no fact
is lost by not recording it.

## A tryout in today's version

Offered, not filed. About 1 agent hour in all, after the design package move.

- **The look build.** The card, the tracker rows and the ticket heading onto text styles, and their
  CSS sizes, weights and colors gone. About 150 lines.
- **The description list.** The three pieces in `@kampus/fabrika-design`. The card's rec, the
  ticket's properties (`.ticket-view .props`, `window.css:2819`) and the trace's key and value rows
  (`.view .kv`, `window.css:2490`) move onto them. About 40 lines.
- **Prose to `body`.** `.ticket-view .desc` (`window.css:2621`) moves from 14 at 1.65 in the low
  gray to the `body` text style in step 12. About 10 lines. Decided.
- **Activity's mono.** An agent's id (`.who.ag`, `window.css:2431`) is drawn like a person's,
  `strong` in sans, and the cost and turns (`.act-r .code`, `window.css:2700`, such as "$0.11, 1
  turn") become `label`. About 10 lines. Decided.
- **The ticket number and cost.** `#7` and the Cost row lose `mono`. A few lines.
- **`colors.test.ts` (`apps/fabrika/src/window/`) reads the `textStyles` map.** Four of its checks read colors from `.tracker-title` and
  `.tk-title`, and fail once color comes from Manti's props. About 40 lines.
- **`primary` text is our accent.** One line in the design package's `tokens.css`; Manti's own `primary` is orange.
- **A lint on sizes in program CSS.** Advice first, its false alarms measured, then blocking.

## Manti ideas

A pull request is tried with `pnpm patch` first.

- **Issue 135, a comment.** Our six text styles, composed from Manti's size and emphasis props in a
  real app on 0.13.0, as a case for its third option: a brand composes its styles from existing
  tokens. No new prop on Manti.
- **Heading's default sizes.** Map `--manti-text-3xl` and up, or document that `Heading` picks its
  size from its level, so `level={1}` is 4xl.
- **`primary` text follows the theme's accent,** not a fixed orange.

The description list stays ours, not Manti's: Manti has none, and no issue asks for one.

## Where this differs from settled notes

- **[Popovers](./popovers.md)** names the `--fs-*` scale as the source of sizes. The text styles sit
  on top of it, and `--fs-prose` (14) loses its one use in the ticket's description. Whether the markdown
  program's reading view keeps 14 is open; the same long text shot settles both.
- **[The ask desk](https://github.com/usirin/tea-fabrika/pull/326)**, proposed with the look decided,
  built the rec's value at 13/600. The text styles make it 15/600 and the question 13/500. Its note
  says the rec's type follows "the typography roles", meaning these text styles.
- **[One design package](./fabrika-design-package.md)** lists "the text roles" as proposed, as
  `roles.ts` exporting `roles` and `Role`. This note decides them under a new name:
  `text-styles.ts`, exporting `textStyles` and `TextStyle`, beside `description-list.tsx`. That
  note's words change in the pull request that moves the files.

## What it costs

The note and the `textStyles` map: done. The tryout: about 1 agent hour. The lint: sized when its false
alarms are measured. Each Manti pull request: sized with Manti's maintainers.

How sure: 80% that six text styles on Manti's sizes are the right set. The doubt is the programs not yet
built on them; the next two settle it.

## What it cannot tell us

- Whether 13 is big enough for a long ticket description. A shot of a long body at 13 settles it.
- How the card sounds in a screen reader. No run yet.
- Whether 22 or 24 is the better title. A guess, 80% for 22.
- Whether the trace waterfall and the asks popup need a seventh text style. They were read, not built.
- Whether a person who zooms the app, as Ableton's one zoom does [t18], keeps the ranks. Manti's
  sizes are in px through our scale; a zoom test at 200% (WCAG 1.4.4) settles it.

Sources are tagged as in [experiment 200](../../experiments/200-typography.md#links).
