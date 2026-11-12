---
id: 0520
title: Each agent gets its own color, picked from its name out of a swatch that passes 3:1 in both looks and holds no status hue or accent, stored as a swatch name, and shown only in its avatar and label
status: accepted
date: 2026-11-07
tags: [ui, shared-tiles, color, agents, accessibility, today]
---

# 0520: Each agent gets its own color, picked from its name out of a swatch that passes 3:1 in both looks and holds no status hue or accent, stored as a swatch name, and shown only in its avatar and label

```ts
// A sketch. The swatch names are made up; the theme maps each name to its steps in each look.
const pick = (name: string): Swatch => Swatch.literals[hash(name) % Swatch.literals.length];
const Mark = Schema.TaggedUnion({
  person: { name: Schema.String, swatch: Schema.optionalKey(Swatch) }, // a circle
  agent: { name: Schema.String, swatch: Schema.optionalKey(Swatch) },  // a rounded square with ✦
});
```

**What this decides:** what color an agent wears and where, in today's version.

## Context

One agent hue for every agent could not tell two agents apart. From
[shared tiles](../docs/direction/shared-tiles.md#color), decided 2026-11-07, which walks back "one
agent hue, Radix orange".

## Decision

**A color per agent, from its name.**

- The default is a stable pick from the name, so the same name lands on the same color every day.
  The person may change it, and the change is kept.
- Every swatch color passes the themes' own contrast check, one function called in both places, at
  3:1 in dark and in light.
- The swatch leaves out the status hues (green, amber, red) and the accent (indigo).
- A mark stores a swatch name, never a hex value.
- An agent's color sits only inside its avatar and presence label, never on the tile edge, which
  means focus only.
- Shape and name stay the first cue; the color only adds.

## Consequences

- This adds a fourth kind of color beside color principles' three; that note is revisited in the
  foundations work.
