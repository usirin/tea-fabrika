---
name: guidelines
description: Run this repo's guidelines study for one design area: build the screen first, look at it next to Linear, then write the guidelines it proves. Use on "guidelines for X", "we need X guidelines", "run the guidelines process", or "a guidelines study".
---

# A guidelines study

The screen comes first. A guideline is something a good screen proved, written down after,
not a rule written before anything was drawn.

Why this order (2026-11-02): the ask desk study ran the old ten steps and spent most of its
time on the write-up. Its screen was a small demo in the corner of a docs page, and it copied
today's flaws: a left bar for the selected row, boxes inside boxes, mono meta text. One fresh
agent with one paragraph and no skill made a better screen in 9 minutes, against about 40.
That agent had one job: make a screen Linear's team would ship.

Read `AGENTS.md` first. Its rules on names, writing, version and the public repo all apply.

## The steps

### 1. Check what is settled (short)

- Search `docs/direction/` (its README rows), `experiments/README.md` and `docs/plan/` for the
  area. List what is decided, with a link each. Decided points are followed, never asked again.
- The look is settled already. Follow it, don't relitigate it:
  [color principles](../../../docs/direction/color-principles.md) and
  [themes](../../../docs/direction/themes.md): Radix slate and indigo, every value a Radix step
  used for its job, and **two text steps only** (12 and the low step). Rank comes from size and
  weight. The program's own text is sans; mono is only for what a person types.
- **Done when** you can list what is decided and what is open, in under 20 lines.

### 2. Name the scope

- Write one line: which program or part this study changes. Everything else stays exactly as it is
  today.
- The chassis (the top bar, the bottom line, each tile's title bar, the desk) is out of scope unless
  the area *is* the chassis. Its font, size and lines stay as they are.
- If the screen seems to need a change outside the scope, don't make it. Write it down as a
  question for the owner.

### 3. Build the screen

- One job: the screen for this area that Linear's team would ship if they built it as a fabrika
  program, with our pieces (programs in tiles, the desk, the top bar, pipes). Their taste and their
  quality bar, on our pieces. Never copy a Linear screen.
- Real content: real tickets, steps, programs and fact names from the repo. List anything made up.
- Read today's code to learn which jobs exist, not how they look
  ([rethink, do not port](../../../docs/direction/rethink-do-not-port.md)). Today's look isn't the
  starting point.
- Look outside software for one or two ideas: music tools (Ableton gave us
  [fold, not tabs](../../../docs/direction/fold-not-tabs.md)), video editors, game tools, a
  cockpit, a kitchen. One line each.
- Draw it in today's app frame, with the real tokens (`apps/fabrika/src/themes.ts`), so the chassis
  around it is the real one. It is clickable: keys and mouse both work.
- Fewer boxes. If something already draws an edge, a second line, box or background goes. A
  selected row is shown by a full-row fill and stronger text, never a colored bar on one side.

### 4. Look at it next to Linear

- Shoot it at each layout: one tile filling the window, two side by side, two stacked, a 2x2
  grid, and a small window (about 1024x700). Put each shot beside today's app and beside the
  closest Linear screen, taken from Linear's public docs or changelog.
- Ask of each shot, and write the answer in one line: would Linear's team ship this? What looks
  off: a box in a box, a gray that fights, a line nobody needs, text too loud, a cramped layout?
- Fix what looks off and shoot again. Two or three rounds is normal. Stop when you would ship it.
- Then show the owner the shots and the clickable screen, before any write-up. Their yes on the
  look comes first. If they say no, go back to step 3.

### 5. Write down what the screen proved

- About six principles, each one something the screen does and the shot shows. More than eight
  means some are rules: group them.
- Each principle gets one **kind**, so it gets checked the right way:
  - **law**: a property the test writer can check (a key always does X, a selected row has
    `aria-selected`);
  - **lint**: a rule `pnpm lint` can hold;
  - **taste**: checked only by a screenshot next to Linear.
- For each, in a line or two: why, a short quoted source, the Elm or OTP answer where it fits, the
  WCAG criterion it touches, the lean with how sure, and the doubt that would settle it.

### 6. Write it up and walk it

- `experiments/NN-<area>.md`: the question as the title, the answer first, the shots, what was
  read (one table), what it cannot tell us. Dollars, even when $0.
- `docs/direction/<area>.md`: **Proposed DATE.**, a code block first (the screen's model, update
  and view, as a sketch), the principles with their kinds and leans, the open calls, the cost, what
  it cannot tell us. A row in `docs/direction/README.md` and one in `experiments/README.md`.
- The private page "<Area> guidelines": the clickable screen first and full width, then the
  principles under it. `references/page-structure.md` has the checklist.
- One docs-only pull request: `direction: <area>, proposed, with experiment NN`. Run `pnpm format`
  and `pnpm lint`, and grep the added lines for names, machine paths and keys. Log the hand run in
  `field/` the same day.
- Walk the owner through it one step per message, `**Step N of M: <name>**`, 3 to 5 bullets, one
  everyday comparison, "Say next." An answer changes the page first, then the note, then the PR.
  The last step asks: merge it? Before the merge, the note's status line becomes **Decided DATE.**
