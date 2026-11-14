---
state: "decided 2026-11-01, the waiting action 2026-11-08"
summary: "Eight rules for any color on screen: quiet and accessible, one meaning per color (the accent marks your turn, including the one action waiting on you, at most one per view), never color alone, gray and tint on one ladder, Radix steps for their jobs, color replaces and does not add, few colors that may repeat, numbers check and eyes pick."
---

# Color principles

Decided 2026-11-01 by the owner. Written for today's version, and `next/` reads them as lessons.
Today's code does not meet them yet: see [What today's code still breaks](#what-todays-code-still-breaks).
[Pipe colors](./pipe-colors.md) is these principles applied to one job.

**Changed 2026-11-08:** design foundations PR 1 builds one slate a9 focus token in both looks
for today's version. The two focus bends become one, leaving four. Pipe focus keeps its own steps.

```ts
// A sketch. Every color on screen is one of three things, and each brings its own second cue.
type Color =
	| { _tag: "neutral"; step: RadixStep } // the default: slate
	| { _tag: "state"; state: "done" | "running" | "stuck" | "turn"; word: string }
	| { _tag: "pipe"; pipe: PipeColor; letter: string };
```

## The eight

1. **Quiet, and accessible, and neither gives way.**
   - Color stays low and calm, and is never hard on the eyes.
   - Contrast bars still hold: [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
     for text, [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) for a
     needed state.
   - The test is how Linear would do it. Example: step 4 on a title was too bright, and amber on a tile
     edge failed.
2. **A color means one thing.**
   - State colors say state, and the accent says your turn.
   - **Decided 2026-11-08 by the owner:** your turn includes the one action waiting on you now,
     such as Save after a key is recorded in the keys editor, or answering an ask. See
     [The action waiting on you](#the-action-waiting-on-you-decided-2026-11-08).
   - A pipe's color says which pipe and nothing else, so no pipe color sits near a state color.
3. **Color never works alone.**
   - Every fact color carries is also a letter, a shape or a word
     ([1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
   - Example: pipes have a letter, and a plain tile has a dot.
4. **Gray and tint climb the same ladder.**
   - A plain tile goes from subtle gray to active gray. A pipe goes from subtle tinted to active tinted.
   - Same steps, same distance. Tint changes the hue and not the shape of the change.
5. **Every value is a Radix step, used for that step's job.**
   - [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
     are the values behind Manti's tokens. Nobody hand-rolls a color.
   - Read the docs before picking a step. A bend from a step's job is written down with its reason.
   - The one exception is a theme a person brings, such as a Base16 file: it keeps its own colors
     ([themes](./themes.md), 2026-11-01). The default and every Radix pick stay on steps.
6. **Color replaces, it does not add.**
   - Color goes on something that is already there. A washed title has no line under it.
   - If something already draws an edge, a second line or box beside it goes.
7. **A few colors, and they may repeat.**
   - Six pipe colors, because more would not stay apart, and even six has a close pair.
   - The first pipes get the colors farthest apart. They are counted per workspace.
   - A repeat is fine, because principle 3 already tells the two apart.
8. **Numbers check, eyes pick.**
   - Measure contrast and distance, and say out loud any value under a bar.
   - Then pick by eye, on a real desk, with a plain tile in view. Colors are shown, not described in CSS.
   - Example: the numbers leaned to four colors, and six won by eye.

## The steps and their jobs

| Step | Radix's job | Ours |
|---|---|---|
| 2 | subtle background | title at rest |
| 3 | component background | title when focused |
| 4 | component hover | resting tile edge, a bend (below) |
| 8 | strong border and focus | strong border; dark pipe focus edge |
| 9 | solid background | slate focus edge and keyboard ring, a bend (below) |
| 11 | low-contrast text | name at rest, and all quieter text |
| 12 | high-contrast text | name when focused, the letter, every title and main line |

**Two text steps, no third gray (decided 2026-11-02 by the owner, from the screenshot review).**
Text uses step 12 and the look's low step only: slate 11, or a11 where 11 fails (in today's app,
slate a11 in both looks). Secondary, muted and faint text are all the low step. Rank comes from
weight and size, never from a gray between the two. A title is always step 12, so it never reads
weaker than the text beside it on a row at rest, hovered or selected. A row set aside stays at the
low step, since that is a state and not a rank, and its dashed ring carries it too (principle 3).

**The bends.** Four, each with its reason, listed in `packages/fabrika-design/src/themes.ts`: the
dark desk (`#0c0d0e`, darker than slate 1), white text on a step 9 fill (Radix's own rule for that
step), the resting tile edge, and focus in both looks. Focus is slate a9 as a line, since a8 reads
1.90 on the desk in light and 2.82 on a selected row in dark.
The one that needs a word here is the edge. Radix gives borders steps 6 to 8. Our resting tile edge
is step 4, because a higher one was too loud on a desk full of tiles. It is 1.31:1 on the ground, so
it cannot carry a needed fact. The title bar and the focus edge do that. A pipe's light focus edge
bends too, from a9 to a11 by color; [pipe colors](./pipe-colors.md) gives each one and its reason.

**A line or a fill is never text (added 2026-11-01, approved by the owner from the design review).**
Principle 5 holds for each use, not only for each value. A token made from a border step (4 to 8)
or a solid fill (9, 10) is never a `color:`. Text takes 11 or 12, and it must read 4.5:1 on every
place it sits, hovered and selected rows included, not only on the page.

- **Changed 2026-11-07.** A text token no longer has to take 11 or 12: it may name a scale and a
  floor, and the build picks the step
  ([themes, point 4](./themes.md#4-a-theme-that-fails-contrast-decided-2026-11-07)).

```css
/* Before: the wire line's step used as words, 1.87 to 3.02 */
.topbar .num { color: var(--wire); }       /* slate a8 */
/* After: the text step the top bar's other words use, 5.32 or more */
.topbar .num { color: var(--text-faint); } /* slate a11 */
```

- What it changed: in `fabrika-light`, done and stuck moved from step 11 to step 12 and turn-text
  from indigo 11 to indigo a11, since step 11 fails on a selected row. The values are in
  [themes](./themes.md).
- What it costs: done and stuck in light read close to black, so the word and the mark carry the
  state more than the hue does. Quiet top-bar numbers and pipes get as strong as its other quiet
  words.

## The action waiting on you (decided 2026-11-08)

The accent goes on at most one control per view, and only while something waits on you. When
nothing waits, that control is plain.

```css
/* A sketch. Save takes the accent only while a recorded key waits on it. */
.view .btn.save { background: var(--surface); }
.view[data-waiting] .btn.save { background: var(--turn-fill); color: var(--turn-fg); }
```

- **What it means.** One control per view can be the one waiting on you: Save once a key is
  recorded, or the answer on an open ask. It takes the turn fill while it waits, and goes plain
  once you act or cancel. A view with nothing waiting has no accent at all.
- **The known way.** Apple's HIG gives the primary role to "the button people are most likely to
  choose". A primary button "uses an app's accent color", and a view keeps prominent buttons "to
  one or two" ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons),
  read 2026-11-08). We take one, not two. That Linear shows one main action per view is a guess
  from using its app; no page of theirs we read says so. Its redesign did keep colored chrome low
  ([How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui), read
  2026-11-08).
- **How it fits.** Principle 3 still holds: the control's own word says it too, so the color is
  never alone.
- **The law must learn this case.** The accent law (A3 in `apps/fabrika/src/window/colors.test.ts`)
  lists fixed turn selectors, so it cannot yet say "accented only while waiting" or "one per view".
  That change is tracker ticket 305, and its plan goes to the owner.
- **How sure:** the rule is decided. One doubt is left, at 75%: many views, each with its own
  accent, may dull the top bar's turn count, the one place that says how many turns are yours.
  Shots of three views side by side, each with an action waiting, would settle it.

## What today's code still breaks

- The grays and the state colors in `apps/fabrika/src/window/window.css` are Radix steps since
  ticket 144, now in the design package's `tokens.css` (P31), and the terminal and the window's frame
  read them from its `themes.ts`.
  The hues are still hand-written oklch: the line tints, the type colors and the service colors.
- Three of the six tints sit on amber, red and green, so they break principle 2.
- Pipes have no second cue yet, so they break principle 3.

## How sure, and what it costs

- **How sure:** 85% on principles 2, 3, 4 and 6, which follow from accessibility rules and from what
  we tried. 70% on 7 and 8, since nobody has used six colors on real work.
- **The cost of principle 2:** warm colors are gone from pipes, so the six bunch up in cool and
  purple-pink.
- **The cost of principle 5:** Radix's dark scales become a dependency, and we take its steps as they
  are.

## What would change these

- A real screen reader, low-vision or color-blind user who finds that a cue does not work.
- Real work where people misread a pipe color as a state.

## What this cannot tell us

- Nothing here has been built or run in the app yet. The mockups were judged by one person.
- **Not decided here:** Display P3, and how `prefers-contrast` and forced colors behave. User themes
  are in [themes](./themes.md). A theme has to keep these principles or say which one it gives up.
