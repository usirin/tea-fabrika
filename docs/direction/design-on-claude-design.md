---
state: "decided 2026-11-03"
summary: "Both versions. Guidelines studies, design explorations and prototypes are drawn on a Design canvas with the design system installed: our colors, the Manti mapping, the six text styles, `DescriptionList`, and one bundle (`window.Fabrika`, all of Manti 0.13.0 and our pieces) whose real parts the canvas mounts, never look-alikes. A keyboard-only walk stays a plain page, since the canvas takes keys only on a focused element. Four limits from the first round, each with what settles it: one file per publish, no page-wide keys, a person looks once per round since the agent may not check its own render, and Manti's `TreeView` takes string labels only. The system's contents come from the settled notes; `@kampus/fabrika-design` is its source once the code moves there."
---

# Designs are drawn on Claude Design

**Decided 2026-11-03** by the owner. Both versions. Guidelines studies, design explorations and
prototypes are drawn on a Design canvas in Claude Design, with the design system installed. A walk
that is pressed with the keyboard only stays a plain page. Before this, every mockup round was an
HTML page built by hand, in the shape the [guidelines skill](../../.claude/skills/guidelines/SKILL.md)
gave.

Its decided rules are in: [0467](../../.decisions/0467-designs-are-drawn-on-claude-design.md),
[0468](../../.decisions/0468-a-canvas-decides-a-look.md).

**Changed later on 2026-11-03 by the owner:** a canvas alone was hard to use, since nothing on it
said what to look at or why. A guidelines study's front door is the plain page again (a pressable
demo on top, the principles folded under it), and the canvas sits behind it for every artboard
side by side.

**Changed 2026-11-06 by the owner:** the plain page's demo was lifted from the real build's saved
DOM, so any press nobody had captured said "not shot". A demo where a press does nothing was
turned down. A guidelines study is now one Design canvas: slides that walk the story, the way a
designer presents work, ending in a clickable prototype built on the design system and driven by
a small state machine, so every key and click the guidelines name does something. Keys go to the
prototype's focused window, so the plain keyboard page is gone too. The real app is still built
and shot: its shots are the reference the prototype must match, set side by side on a slide.

```text
guidelines                             one Design canvas: slides, then a clickable prototype
explorations, prototypes               a Design canvas, the design system installed
a keyboard walk                        the prototype's focused window, on the same canvas
the decision and its why               docs/direction/, as before
shots of the real app in a PR          the real built app, as before
```

```html
<!-- A sketch: one artboard on a Design canvas. The design system is installed under ds/fabrika/. -->
<script src="./support.js"></script>
<link rel="stylesheet" href="ds/fabrika/tokens.css" />
<link rel="stylesheet" href="ds/fabrika/components/bundle.css" />
<script src="ds/fabrika/components/bundle.js"></script>

<!-- Manti's real parts and ours, mounted from the bundle's global, never drawn again -->
<x-import component-from-global-scope="Fabrika.Text" size="sm" emphasis="muted">label</x-import>
<x-import component-from-global-scope="Fabrika.Kbd">⌃B</x-import>
```

The first canvas was the outline round: 20 artboards, 4 states in 5 layouts. Each keys line came
from its program's `commands` table plus `refuse`.

## Which version

- **Both.** Today's windows and `next/`'s windows are drawn on the same design system, because both
  import one design package ([one design package](./fabrika-design-package.md)).
- The real app still makes the shots a pull request carries ("Show it running" in `AGENTS.md`). A
  canvas is for deciding a look, not for proving a build.

## The two kinds of artifact

Claude Design has two kinds. This is how their own type docs describe them, read on 2026-11-03.

- **A Design System** holds a README, tokens (colors in each theme, text styles, spacing, radius),
  components with live previews, and an optional bundle: one script that sets a global, such as
  `window.Fabrika`. Every reader starts at its README. A system synced from code is read-only on its
  page: a change is made in the code, then synced again.
- **A Design canvas** holds artboards, one file each, laid out on a canvas. It installs a system as a
  copy in its own files: the system's `tokens.json` and one record in its index. Then its color
  pickers and text style menu offer our tokens. When the system's README names a bundle global, the
  canvas mounts the real components from it, "never look-alikes". Layout and words stay plain
  markup on the system's tokens.

Our system holds the colors, the Manti mapping, the six text styles and `DescriptionList`, plus one
bundle, `window.Fabrika`: all of Manti 0.13.0 and our pieces, about 900 KB. It was rebuilt on
2026-11-02.

## What moves, and what stays a plain page

- **Moves to a canvas:** a guidelines study's designs and rounds, a design exploration, a
  prototype. Each design, state and layout is an artboard. Clicks work, and keys work on a focused
  element.
- **Stays a plain page:** a walk a person presses with the keyboard only, where keys work from
  anywhere on the page. The canvas does not allow a page-wide key handler. The plain page keeps the
  shape the guidelines skill gives it: the real build's DOM and CSS, lifted, in frames.
  (Changed 2026-11-06: no longer. The prototype's window takes focus and the keys go to it, so a
  keyboard walk lives on the canvas too.)
- **Stays in the repo:** the decision, its experiment and its why. The canvas is private, so the repo
  names it by title only, never by link.

## Why

- **Real parts cannot drift.** The ask desk's hand-built demo drifted from the built screen: boxed
  buttons where the build had quiet words, and a footer that wrapped. A canvas mounts Manti's own
  parts and wears our tokens, so a button is the button
  ([UI on Manti](./ui-on-manti.md)).
- **It is the tool's known way.** The canvas type says to mount the system's real components and to
  install the system before any look. We follow it as written.
- **One look, many pieces.** The tokens and text styles come from the system, so no page copies a
  palette block by hand.
- **A person can comment on the canvas,** where the designs are, not in a chat.

## Limits found in the first round

| Limit | What settles or fixes it |
|---|---|
| One file per publish, as the canvas type asks: one round took 28 publishes. | We live with it. A round lists its artboards first, so none is sent twice. A type that takes several artboards in one call would fix it. |
| No page-wide key handler, only one on a focused element. | Settled first by the split above: a keyboard-only walk stayed a plain page. Since 2026-11-06 the prototype's window is that focused element: it takes focus when Play opens it, and a click gives the keys back. |
| The canvas type tells an agent not to check its own render. | A person looks once per round. Each prototype state sits beside its real shot on a slide, so the look compares like with like. The pixel check went with the plain page on 2026-11-06. |
| The Slides type cannot hold a prototype: its live embed takes no clicks or keys, and it cannot load the bundle. | Found 2026-11-06. The deck is drawn as slides on the Design canvas instead, joined by links that Play follows. |
| Manti's `TreeView` takes string labels only, so an edit inside a row can't be drawn with the real part. | An upstream gap. The fix goes into Manti by pull request, tried first with a `pnpm patch` ([UI on Manti](./ui-on-manti.md)). Until then the canvas shows it as a named gap, never a look-alike. |

## Where the system's contents come from

- **From the settled notes,** never from today's shapes: [themes](./themes.md),
  [color principles](./color-principles.md), [typography](./typography.md) and
  [UI on Manti](./ui-on-manti.md). This is the same rule the design package follows
  ([one design package](./fabrika-design-package.md)).
- **`@kampus/fabrika-design` is the source once its code moves there.** Then the system is synced
  from the package and never edited by hand on its page, which is the type's own way for a system
  made from code ([data first](./data-first-markdown-is-a-view.md)).
- **Until then,** some parts are built from the notes' own sketches. The system's README lists them
  under "Not synced".

## What it costs

- About one publish per artboard, plus the index: 28 for the 20-artboard outline round.
- A person's look each round, since the agent may not check its own render.
- The 900 KB bundle loads in every artboard.
- A keyboard-only walk still needs its own plain page, so a study with one has two places to look.
  (No longer since 2026-11-06: one canvas holds the deck and the prototype.)
- A prototype is built by hand on the real parts, so it can drift from the build in what it does.
  The press checklist and the owner's look per round hold it; nothing checks it in code.

## What it cannot tell us

- One round was drawn this way. Whether the person's single look catches what the old pixel check
  caught (a box, a wrapped line, 1px) is not measured yet. A second round, with its shots beside the
  artboards, would settle it.
- Whether the chassis around a program (the top bar, the bottom line, the tile's title bar) looks
  right in plain markup. It is not one part in the bundle.
- How long the 900 KB bundle takes to load on a canvas of 20 or more artboards.
- Whether the prototype's window takes focus by itself when Play opens it. The format allows it,
  and it was not yet tried on 2026-11-06.
