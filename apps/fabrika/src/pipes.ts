// The six pipe colors, in the order new pipes take them (docs/direction/pipe-colors.md): listed so
// neighbors sit far apart, with no warm color and none near a state color. A line's `tint` is its
// place here, and a tile in a pipe says its color's name as `data-pipe`, which window.css reads.
//
//   PIPES[0]  "sky": the first pipe in a workspace
//   PIPES[5]  "plum": the sixth; a seventh is sky again, with its own letter
//
// Only the names live here. The values are Radix 3.0.0 steps in window.css, in both looks, and
// pipes.test.ts checks them against Radix's own scales, so the stylesheet is the one place they
// are written. A pipe is not in a theme, on purpose (docs/direction/themes.md), so none of this is
// in themes.ts.

export const PIPES = ["sky", "pink", "teal", "violet", "lime", "plum"] as const;

export type Pipe = (typeof PIPES)[number];
