# Designs are drawn on Claude Design

**Decided 2026-11-03** by the owner. Both versions. Guidelines studies, design explorations and
prototypes are drawn on a Design canvas in Claude Design, with the design system installed. A walk
that is pressed with the keyboard only stays a plain page. Before this, every mockup round was an
HTML page built by hand, in the shape the [guidelines skill](../../.claude/skills/guidelines/SKILL.md)
gave.

**Changed later on 2026-11-03 by the owner:** a canvas alone was hard to use, since nothing on it
said what to look at or why. A guidelines study's front door is the plain page again (a pressable
demo on top, the principles folded under it), and the canvas sits behind it for every artboard
side by side.

```text
guidelines                             a plain page first, then a Design canvas behind it
explorations, prototypes               a Design canvas, the design system installed
a keyboard-only walk                   a plain page, as before
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
| No page-wide key handler, only one on a focused element. | Settled by the split above: a keyboard-only walk stays a plain page. |
| The canvas type tells an agent not to check its own render. | A person looks once per round. Each artboard sits beside its real shot, so the look compares like with like. The pixel check stays on the plain page. |
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

## What it cannot tell us

- One round was drawn this way. Whether the person's single look catches what the old pixel check
  caught (a box, a wrapped line, 1px) is not measured yet. A second round, with its shots beside the
  artboards, would settle it.
- Whether the chassis around a program (the top bar, the bottom line, the tile's title bar) looks
  right in plain markup. It is not one part in the bundle.
- How long the 900 KB bundle takes to load on a canvas of 20 or more artboards.
