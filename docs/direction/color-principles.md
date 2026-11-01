# Color principles

Decided 2026-11-01 by the owner. Written for today's version, and `next/` reads them as lessons.
Today's code does not meet them yet: see [What today's code still breaks](#what-todays-code-still-breaks).
[Pipe colors](./pipe-colors.md) is these principles applied to one job.

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
| 8 | strong border and focus | focus edge |
| 11 | low-contrast text | name at rest |
| 12 | high-contrast text | name when focused, the letter |

**The one bend.** Radix gives borders steps 6 to 8. Our resting tile edge is step 4, because a higher
one was too loud on a desk full of tiles. It is 1.31:1 on the ground, so it cannot carry a needed
fact. The title bar and the focus edge do that.

## What today's code still breaks

- Colors are hand-written oklch in `apps/fabrika/src/window/window.css`, and some are written straight
  into `apps/fabrika/src/window/terminal.ts` and `apps/fabrika/src/main.ts`.
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
