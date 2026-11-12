---
id: 0461
title: Every part of the app's UI is built on Manti UI, wearing our own token values set from our names, never a theme of Manti's or another project's
status: accepted
date: 2026-10-30
tags: [design, manti, tokens, today]
---

# 0461: Every part of the app's UI is built on Manti UI, wearing our own token values set from our names, never a theme of Manti's or another project's

```css
/* @kampus/fabrika-design's tokens.css, abridged: Manti's tokens point at ours. */
:root {
  --manti-font-sans: var(--font);        /* Inter */
  --manti-text-sm: var(--fs-small);      /* our px scale, never Manti's rem scale */
  --manti-accent-fill: var(--turn-fill); /* "your turn" */
}
```

**What this decides:** what the app's UI parts are built from and whose values they wear. The note
scopes it to today's version.

## Context

Hand-built parts drifted in focus, roles and keys. From
[UI on Manti](../docs/direction/ui-on-manti.md#the-apps-ui-is-built-on-manti-ui-with-our-own-tokens).
AGENTS.md says it too ("All in on Manti").

## Decision

**Manti UI (`@manti-ui/react`, `@manti-ui/styles`) is used for every part of the app's UI, never
beside it.**

- Manti wears our own token values. Never a theme of Manti's or of another project, except a
  person's own theme file in their own config (2026-11-01).
- Manti's tokens are set from our token names, so a value lives once and the mapping only points
  at it. The mapping is `tokens/manti.toml` in the design package
  ([0453](0453-every-token-is-toml-data.md)).
- Manti's reset is kept to Manti's parts, so a screen with no Manti part draws as before.
- A better way goes into Manti by pull request, tried first with a `pnpm patch`, never "Manti or
  native".

## Consequences

- How the move splits into pull requests, and four clashes with popovers' rules, stay proposed in
  the note.
- Whether "every part" binds `next/`'s windows is not said by the note; `next/` already draws its
  text through Manti's `Text` ([0457](0457-six-text-styles-set-every-size.md)).
