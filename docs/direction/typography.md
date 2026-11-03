# Typography

**Proposed 2026-11-02.** Decided by the owner the same day, after the look step: the look built from
the six roles below; the rec at `heading` (15/600) and the question at `strong` (13/500, still the
`h2`); prose moves from 14 in the low gray to the `body` role (13, step 12); Activity's mono agent id
and cost become sans in the same tryout; and the roles live in `@kampus/fabrika-design`
([one design package](./fabrika-design-package.md)). The six principles and the smaller calls stay
proposed.

Built from [experiment 200](../../experiments/200-typography.md), which read about 20 makers and
tools and checked the ask desk's "Your turn" card, a tracker row and the ticket heading against them,
and a private page, "Typography guidelines", where the card switches between today and the roles.
Neither is a measurement. It builds on [color principles](./color-principles.md) and
[themes](./themes.md) (two text grays, rank from size and weight), [UI on Manti](./ui-on-manti.md)
(the type scale on Manti's sizes) and [popovers](./popovers.md) (one font, mono only for typed
words).

```ts
// A sketch. @kampus/fabrika-design, roles.ts. The look build ran this map under another name.
import type {TextProps} from "@manti-ui/react";

export const roles = {
	title: {size: "2xl/semibold"}, //             22, 600, step 12: a page's one title
	heading: {size: "xl/semibold"}, //            15, 600, step 12: what you act on
	strong: {size: "base/medium"}, //             13, 500, step 12: a row's title, a question
	body: {size: "base"}, //                      13, 400, step 12: prose
	quiet: {size: "base", emphasis: "muted"}, //  13, 400, low step: a reason, a quote
	label: {size: "sm", emphasis: "muted"}, //    12, 400, low step: one line of meta
} as const satisfies Record<string, TextProps>;
export type Role = keyof typeof roles;
```

```tsx
// A sketch, today's version: the ask desk's card, made only from roles.
<Text {...roles.label}>
	<Text as="span" {...roles.label} variant="primary">Your turn</Text> · lane asked at 10:09
</Text>
<Heading level={2} {...roles.strong}>Approve plan v1?</Heading>
<dl>
	<Text as="dt" {...roles.label}>Recommended</Text>
	<Text as="dd" {...roles.heading}>
		Approve <Text as="span" {...roles.label}>95% sure</Text>
	</Text>
</dl>
<Text {...roles.quiet}>Both tasks have a test, and no question is open.</Text>
```

```text
one role traced: the rec's value
roles.heading         {size: "xl/semibold"}
Manti's Text          <dd data-scope="text" data-size="xl" data-weight="semibold">
theme.css             --manti-text-xl: var(--fs-head), which is 15px
what a person sees    "Approve" at 15/600 in step 12, the loudest text in the card
a screen reader       the h2 "Approve plan v1?" first, then the list: "Recommended, Approve"
```

## Which version

- **Today's version (`apps/fabrika`, `programs/`):** the roles go on its windows first, starting
  with the card, the tracker rows and the ticket heading, then each program as it is touched. The
  fixes are at [a tryout in today's version](#a-tryout-in-todays-version), none filed.
- **`next/`:** it imports the same roles from `@kampus/fabrika-design`. Its first window uses them
  from the start.

## Why these numbers

Manti's scale at base 13, as `theme.css` maps it, gives 12, 13, 15 and 22. Two makers that build
dense desktop tools land on the same steps.

| Role | Ours | macOS text style [t2] | Linear's app CSS [t11] |
|---|---|---|---|
| `label` | 12 | Callout 12 | mini 12 |
| `body`, `quiet`, `strong` | 13 | Body 13, Headline 13 bold | small 13 |
| `heading` | 15 | Title 3 15 | regular 15 |
| `title` | 22 | Title 1 22 | title2 24 |

22 against Linear's 24 is a guess, 80% that 22 holds: it is macOS's Title 1, and it is already
today's ticket title. A shot of a long title at 24 in a half tile would settle it. Manti's `lg` (14)
and `xs` (11) get no role: 14 was prose, which moves to 13, and 11 is under Primer's 12 floor for
a caption [t3].

## The six principles

### T1: Every size comes from a role

**Lean, 85%.** Kind: lint.

- **What it means.** A program's text takes one of six roles. No program's CSS sets a `font-size`,
  a `font-weight` or a text color. A seventh role is a change to the package, not a local rule.
- **Why.** "A text style specifies a combination of font weight, point size, and leading values"
  (Apple [t2]). "Your product will likely not need all 15 default styles" (Material [t1]). "Use no
  more than 3 sizes" (NN/g [t12]).
- **Linear row.** Linear's team would put the roles in the one place every program draws from, so
  a new program gets the right text for free, and its settings' font size scales all six at once.
  They run eight sizes; we run four, since our programs share tiles.
- **Elm answer.** A role is part of the view. The model and update do not change.
- **Holds it.** The `Role` type in `@kampus/fabrika-design`. Later, a lint that fails on a size,
  weight or text color in a program's CSS. Its false alarms are measured before it blocks.
- **Doubt.** A seventh role may be needed for the trace waterfall's labels or the asks popup. The
  next two programs moved onto roles settle it.
- **Cost.** The map is 10 lines. Moving a program is about 20 to 60 lines each.
- **Today.** Breaks. `window.css` sets 105 sizes by hand in 13 sizes and 27 size and weight pairs.
  `Text` and `Heading` are used nowhere.

### T2: What you act on leads its block

**Lean, 75%.** Kind: taste. Decided on the card: the rec at `heading`, the question at `strong`.

- **What it means.** In a block a person answers or picks from, the thing they act on is the
  loudest text. The question that frames it steps down a rank.
- **Why.** "not every element of the interface should carry equal visual weight. While the parts
  central to the user's task should stay in focus, ones that support orientation and navigation
  should recede" (Linear [t10]). Warnings "if used to excess, tend to lose their effectiveness"
  (MUTCD [t17]).
- **Linear row.** Triage Intelligence shows a suggestion as a quiet label and a strong value. We do
  the same, with the value one size up, because the rec is the card's job.
- **Elm answer.** Nothing in the model. The view picks the role.
- **Holds it.** Taste: a shot beside Linear. On the card, a law can check that the rec's role
  outranks the question's.
- **Doubt.** A card with no rec now has a 13/500 question as its loudest line. The running, stuck
  and done cards need a shot each.
- **Cost.** None beyond T1.
- **Today.** Breaks. Round 6's card set the rec at 13/600, under the question at 15/600.

### T3: Rank by size, then weight, in two grays

**Decided 2026-11-01** in [color principles](./color-principles.md) and [themes](./themes.md).
Kind: law.

- **What it means.** A role differs from the one below it by size first, then weight. Text uses two
  grays: step 12 and the low step. Manti's third emphasis, `subtle`, has no role.
- **Why.** "The system-defined text styles give you a convenient and consistent way to convey your
  information hierarchy through font size and weight" (Apple [t2]). "Steps 11 and 12 are designed
  for text" (Radix [t8]). "Use no more than 3 contrast variations" (NN/g [t12]).
- **Linear row.** Linear uses four text grays. We keep two, as decided, and rank by size and weight
  where Linear would reach for a third gray.
- **Elm answer.** View only.
- **Holds it.** A test over the role map: every `emphasis` is the default or `muted`, and every
  role pair differs in size or weight.
- **Doubt.** None on the rule. The test is small.
- **Cost.** About 20 lines of test.
- **Today.** Half. Two grays, but round 6's card has four parts at weight 600.

### T4: The role sets the look, the element sets the meaning

**Lean, 85%.** Kind: law. WCAG 1.3.1 and 2.4.6.

- **What it means.** A heading is an `h1` or `h2` because of the page's outline, and its role is
  picked for how loud it should be. The question is an `h2` at `strong`; the ticket's title is the
  `h1` at `title`.
- **Why.** "Don't adjust semantic heading tag order to achieve a specific visual design" (Primer
  [t3]). Structure "can be programmatically determined" (WCAG 1.3.1 [t15]). Atlassian ties the
  two together: "Use heading styles, rather than bold or a change of font size" [t4]. Manti splits the
  two: `Heading` takes a `level` and a `size` apart.
- **Linear row.** No Linear answer: its markup is not public, so its heading levels cannot be read.
- **Elm answer.** The element comes from the view's structure; the role is a prop on it.
- **Holds it.** A law per window: headings go `h1` then `h2`, with no skipped level, read from the
  rendered tree, whatever their roles.
- **Doubt.** No screen reader run yet. One run on the card settles it.
- **Cost.** About 30 lines of law.
- **Today.** Passes on the card: the question is an `h2`. Nothing ties its look to that.

### T5: A label is one line, and meta gives way before a row's title

**Lean, 80%.** Kind: law.

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
- **Holds it.** Later, a lint on `.mono` and `var(--mono)` outside typed spans. Today, the roles
  carry no font family, so a role is always sans.
- **Doubt.** Numbers that line up in columns need `tabular-nums`, which today comes from `.view`.
- **Cost.** Part of the tryout below.
- **Today.** Breaks. An agent's id is mono (`apps/fabrika/src/window/window.css:2431`), Activity's
  cost and turns are mono (`window.css:2700`), the ticket number is mono
  (`programs/ticket/src/window.tsx:603`) and so is the cost on the ticket page
  (`programs/ticket/src/window.tsx:372`).

## The smaller calls

**The names.** Lean `title, heading, strong, body, quiet, label`, 70%.

```ts
const ours = ["title", "heading", "strong", "body", "quiet", "label"];
const material = ["headline", "title", "body", "label"]; // each in large, medium, small
const linear = ["title2", "regular", "small", "mini"]; // size names, not jobs
```

Material's names are the industry's, but its `title` is a mid rank and its sizes come in threes. Ours
name the job in one plain word. The doubt: `strong` and `quiet` are ours alone. If the owner wants
Material's, `strong` becomes `title-small` and `quiet` is `body` with a color.

**How a program uses a role.** Lean spread props now and a Manti `textStyle` later, 75%.

```tsx
<Text {...roles.label}>#117</Text> // now: works on Manti 0.13.0 as it is
<Text textStyle="label">#117</Text> // later: a Manti pull request, the roles in its tokens
```

A wrapper of our own (`<T role="label">`) would work around Manti, which [UI on Manti](./ui-on-manti.md)
rules out.

**The title's size.** Lean 22, 80%.

```ts
const title = {size: "2xl/semibold"}; // 22: macOS Title 1, and today's ticket title
const title24 = {size: "3xl/semibold"}; // 24: Linear's title2; needs --manti-text-3xl mapped
```

22 needs no new token and matches the platform. The doubt: Linear's heavier title may read better
over a long ticket page. A shot of a long title at both sizes in a half tile settles it.

**Line height.** Lean Manti's own, 75%: 1.5 for most, snug at `xl` and `2xl`. Butterick asks 120 to
145% [t14]; WCAG asks that 1.5 break nothing [t15]. Prose at 13 may want more; the long description
shot settles it.

**Numbers.** Lean `tabular-nums` from `.view`, as today, 70%. A Manti `numeric` prop (Polaris [t6])
is a pull request idea, not a need yet.

## What the ledger records

Nothing new. A role is how the view draws a value; no fact is written when text is drawn, so no fact
is lost by not recording it.

## A tryout in today's version

Offered, not filed. About 1 agent hour in all, after the design package move.

- **The look build.** The card, the tracker rows and the ticket heading onto roles, and their CSS
  sizes, weights and colors gone. About 150 lines.
- **Prose to `body`.** `.ticket-view .desc` (`window.css:2621`) moves from 14 at 1.65 in the low
  gray to the `body` role in step 12. About 10 lines. Decided.
- **Activity's mono.** An agent's id (`.who.ag`, `window.css:2431`) is drawn like a person's,
  `strong` in sans, and the cost and turns (`.act-r .code`, `window.css:2700`, such as "$0.11, 1
  turn") become `label`. About 10 lines. Decided.
- **The ticket number and cost.** `#7` and the Cost row lose `mono`. A few lines.
- **`themes.test.ts` reads the role map.** Four of its checks read colors from `.tracker-title` and
  `.tk-title`, and fail once color comes from Manti's props. About 40 lines.
- **`primary` text is our accent.** One line in `theme.css`; Manti's own `primary` is orange.
- **A lint on sizes in program CSS.** Advice first, its false alarms measured, then blocking.

## Manti pull request ideas

Each is tried with `pnpm patch` first.

- **`textStyle`.** Named text styles in tokens, as Chakra [t19] and Apple [t2] have. Our role map
  then moves into tokens.
- **A `DataList`** for label and value rows, as Radix has [t20]. The card's rec and the ticket's
  properties both are one.
- **`primary` text follows the theme's accent,** not a fixed orange.

## Where this differs from settled notes

- **[Popovers](./popovers.md)** names the `--fs-*` scale as the source of sizes. The roles sit on top
  of it, and `--fs-prose` (14) loses its one use in the ticket's description. Whether the markdown
  program's reading view keeps 14 is open; the same long text shot settles both.
- **[The ask desk](https://github.com/usirin/tea-fabrika/pull/326)**, proposed with the look decided,
  built the rec's value at 13/600. The roles make it 15/600 and the question 13/500. Its note
  already says the rec's type follows these roles, so its words need no change.
- **[One design package](./fabrika-design-package.md)** lists the roles as proposed. This note is
  what it waits on.

## What it costs

The note and the role map: done. The tryout: about 1 agent hour. The lint: sized when its false
alarms are measured. Each Manti pull request: sized with Manti's maintainers.

How sure: 80% that six roles on Manti's sizes are the right set. The doubt is the programs not yet
built on them; the next two settle it.

## What it cannot tell us

- Whether 13 is big enough for a long ticket description. A shot of a long body at 13 settles it.
- How the card sounds in a screen reader. No run yet.
- Whether 22 or 24 is the better title. A guess, 80% for 22.
- Whether the trace waterfall and the asks popup need a seventh role. They were read, not built.
- Whether a person who zooms the app, as Ableton's one zoom does [t18], keeps the ranks. Manti's
  sizes are in px through our scale; a zoom test at 200% (WCAG 1.4.4) settles it.

Sources are tagged as in [experiment 200](../../experiments/200-typography.md#links).
