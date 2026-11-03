# A pipe is marked by a title wash, one of six colors, and a letter

Decided 2026-11-01 by the owner, not built yet. This is about today's version. It replaces the faint tint described in
[fold, not tabs](./fold-not-tabs.md) when the change lands, and `next/` takes it as a lesson.

```ts
// A sketch. Values are Radix Colors 3.0.0, the dark alpha scales.
const plain = { rest: "slateA2", focused: "slateA3", edge: "slateA8", mark: "dot" };
const pipe = (color: PipeColor, letter: string) => ({
	rest: `${color}A2`,
	focused: `${color}A3`,
	edge: `${color}A8`,
	mark: letter, // A, B, C... drawn in slateA12 beside the name
});
const PipeColors = ["sky", "pink", "teal", "violet", "lime", "plum"] as const;
type PipeColor = (typeof PipeColors)[number];
```

## The rule

- **The title bar carries it.** A tile's title is filled with step 2 of its color at rest and step 3
  when focused. A plain tile does the same in slate. So a plain tile goes from subtle gray to active
  gray, and a pipe goes from subtle tinted to active tinted.
- **The box does not change.** No rule line sits under a washed title. Tile sizes and gaps stay as
  they are. A folded strip gets the same wash and letter.
- **A letter is the second cue.** Color is never the only way to tell pipes apart
  ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)). A plain tile shows a
  small dot in the same slot.
- **A pipe's color says which pipe, and nothing else.** So no color near a state color. Today's state
  colors in `apps/fabrika/src/window/window.css` are green for done, amber for running, red for stuck
  and an indigo for your turn. Today's six tints break this rule: three of them sit on amber, red and
  green. Trace's service colors already follow it.
- **The order spreads them.** The first pipes on a desk get the first colors, listed so neighbors sit
  far apart: sky, pink, teal, violet, lime, plum.
- **A seventh pipe repeats a color.** Colors go round again, as `freeTint` does today, and the letter
  stays its own.
- **Colors are counted per workspace.** A repeat then needs seven pipes in one workspace. Today
  `apps/fabrika/src/desk/desk.ts` counts across all of them. The cost: moving a tile to another
  workspace can still bring two pipes of one color together, and the letter tells them apart.

## The values

Over the ground `#111113`. Contrast is the focus edge against the ground, then against the focused
wash.

| Color | Rest | Focused | Focus edge | On ground | On wash |
|---|---|---|---|---|---|
| sky | `#1171fb18` | `#1184fc33` | `#1db2fea9` | 4.07 | 3.60 |
| pink | `#f420bb12` | `#fe37cc29` | `#ff68c8a2` | 3.55 | 3.30 |
| teal | `#12fbe60c` | `#00ffe61e` | `#32ffe775` | 3.87 | 3.64 |
| violet | `#853ff916` | `#8354fe36` | `#977dfea8` | 3.25 | 2.92 |
| lime | `#78f7000a` | `#9bfd4c1a` | `#b6fd6d6c` | 3.60 | 3.44 |
| plum | `#f22ff211` | `#fd4cfd27` | `#ee84ff95` | 3.58 | 3.33 |

Plain tiles use slate: `#d8f4f609` at rest and `#ddeaf814` focused.

## Why

- **Why a wash.** It was picked by eye on real desks, over a colored line and a shape with a hue. It
  was the simplest of the three, and it adds no new box.
- **Why six.** Fewer colors sit farther apart, so four was the recommendation. The closest pair on the
  focused wash is 0.045 in OKLab with four colors, 0.034 with five and 0.013 with six (pink and plum).
  Six won on a real desk, by eye. The cost is that pink and plum are close, and the letter has to tell
  them apart.
- **Why these hues.** [Radix's palette guide](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)
  pairs red, ruby, tomato and crimson with errors, green, teal, jade, grass and mint with success, and
  yellow, amber and orange with warnings. Teal stays in because it is 30 degrees of hue from our green.
  Lime is the closest to a state, 24 degrees from done. Warm colors are out completely.

How sure: 80% on the wash and the letter, 70% on six colors.

## What would change this

- Pipes that a person cannot tell apart at a glance on real work, above all pink and plum. Dropping
  plum for four or five colors is a small change.
- A real screen reader or a low-vision user who finds the letter or the wash does not work.
- Lime read as done, or sky read as your turn, on real work.

## What this cannot tell us

- No person other than the owner has looked at these, and nobody has tried them in the built app.
  They were judged on a mockup.
- No screen reader has been run, and no color blindness simulation.
- Violet's focus edge is 2.92 where it crosses the 20px title, under the 3:1 of
  [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). It is 3.25 along
  the rest of the tile. Whether that passes needs a look at the built tile.
- The values are plain sRGB hex. Display P3 is still to weigh.
- Radix's pairings are stated for Western culture. Nobody has tested what these colors say elsewhere.
