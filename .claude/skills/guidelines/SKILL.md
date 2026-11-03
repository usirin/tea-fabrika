---
name: guidelines
description: Run this repo's guidelines study for one design area, from settled check to a decided note. Use on "guidelines for X", "we need X guidelines", "run the guidelines process", or "a guidelines study".
---

# A guidelines study

One design area becomes a few principles the owner can press, read and decide on. A study ends
with one experiment, one note, one private page, one docs-only pull request, and a walk that
ends in a yes or a no.

The models are themes (PR 281), keybindings (PR 282), hot reload (PR 286) and modes (PR 287).
Themes came first; the other three set the note's shape and the views under the page's mockup,
and modes is the closest to it all: copy modes for those. Pipeline guidelines (PR 290) drifted on structure (no demo, no Try it), so it is not a model, but its views and palette are a second reference.
The page's first screen copies the mockup rounds instead (the tile, the pipe marker finalists, the
chat window): there the mockup is the page, and the words fold under it.

Read `AGENTS.md` first. Its rules on names, writing, version and the public repo all apply.

The guidelines and the keys come first, and they worked. The look is where studies went wrong:
the ask desk's screen had a left bar for the selected row, boxes inside boxes and mono meta text,
because nothing made the agent look at it next to Linear. So the look gets its own step, 5,
with real shots and the owner's yes.

## The steps

### 1. Check what is settled

- Search `docs/direction/` (its README rows, then each note on the area), `experiments/README.md`
  and `docs/plan/` (README, `tiers.md`, `tier-1.md`) for the area.
- Write down each decided point with its source. A decided point is marked decided everywhere
  and is never asked again.
- Name the open pull requests on the same area and what they already lean.
- The look is settled, so follow it and don't reopen it:
  [color principles](../../../docs/direction/color-principles.md) and
  [themes](../../../docs/direction/themes.md). Radix steps are used for their jobs, with **two
  text steps only** (12 and the low step), and rank comes from size and weight. A program's own
  text is sans, and mono is only for what a person types.
- **Name the scope in one line:** which program or part the study changes. The chassis (the top
  bar, the bottom line, each tile's title bar, the desk) stays exactly as it is unless the study is
  about the chassis. A change it seems to need outside the scope becomes a question for the owner,
  never a change.
- **Done when** you can list, with a link each, what is decided, what is leaned, and what nobody
  has touched.

### 2. Pick one running example

- One real case from today's code, read on main, with `file:line` for each claim. Modes used
  info mode (`C-b i`). Pipeline used ticket 117's real run. Keybindings used today's key code.
- It runs through the experiment, the note, the code block that opens the note, and the page's
  demo. Every principle says whether today's case follows it or breaks it, and where.
- Say which version each claim is about: today's version (`apps/`, `packages/`, `programs/`) or
  `next/`.

### 3. Lead with the known way

- Read about 10 to 15 makers and tools: the thinkers (papers, NN/g), the tools people use daily,
  apps with a pointer (Apple's HIG, Linear, Figma), and WCAG. Public docs and source, not memory.
- Look outside software too. Name two or three tools from another field that solved the same
  shape of problem for people who work fast all day: music tools (Ableton Live folds devices in
  place and marks every part that takes a key in Key Map mode, which gave us
  [fold, not tabs](../../../docs/direction/fold-not-tabs.md) and
  [configurable keys](../../../docs/direction/keybindings-are-configurable.md)), video editors,
  game tools, a cockpit, a kitchen. Say what each one teaches and what does not carry over.
- Quote short, checked against the page as fetched. Mark a claim from a summary page
  **secondary**, and one found nowhere **guess**. Give each source a tag (`[t1]`, `[k3]`).
- Write the plain way they agree on before any lean of ours. Where it clashes with a goal of
  ours, say so in one line.

### 4. Test every guideline three ways

- **Linear as the builder.** For every principle and every rule, not only screens: how would
  Linear's team build this if they were building it as fabrika programs, with our pieces
  (programs that compose in tiles, the desk, the top bar, pipes)? Their taste and quality bar,
  on our pieces. Never copy a Linear screen. Ask which program owns the job, what sits beside
  what, and what becomes a piece every program gets for free. Write it as a row, or "No Linear
  answer: <why>". Where we differ, say why.
- **Elm or OTP.** Name the Elm answer (model, update, view, parents step children) or the
  Erlang/OTP one (mailbox, supervisor, `code_change`) where it fits. Say where we leave it.
- **Accessibility.** Name the WCAG criterion a principle touches, and what needs a real screen
  reader run.

### 5. Build the screen and look at it next to Linear

The Linear row in step 4 is words. This step checks the look with eyes.

- Build the area's screen for real in today's app, on a local branch, with the real tokens
  (`apps/fabrika/src/themes.ts`) and the real chassis around it. Keys and mouse both work, as the
  guidelines say. Read today's code for which jobs exist, not for how they look
  ([rethink, do not port](../../../docs/direction/rethink-do-not-port.md)).
- Fewer boxes. If something already draws an edge, a second line, box or background goes. A
  selected row is a full-row fill and stronger text, never a colored bar on one side.
- Shoot it with Playwright on Electron, as `apps/fabrika/e2e.ts` does, at five layouts: one tile
  filling the window, two side by side, two stacked, a 2x2 grid, and about 1024x700. Put each shot
  beside today's app and beside the closest Linear screen, from Linear's public docs or changelog.
- For each shot, one line: would Linear's team ship this? What looks off: a box in a box, a gray
  that fights, a line nobody needs, loud text, a cramped layout? Fix it and reshoot. Two or three
  rounds is normal. Stop when you would ship it.
- Keep every round. The shoot saves each state's DOM beside its shot
  (`document.documentElement.outerHTML`, scripts dropped, a canvas kept as its pixels), and the
  built `window.css` of that round beside them. Step 9 lifts the page's demo from these files.
- Show the owner the shots before the write-up. Their yes on the look comes first. On a no, go
  round again.
- Each principle also gets a **kind**, so it is checked the right way: **law** (the test writer
  can check it), **lint** (`pnpm lint` can hold it) or **taste** (only a shot beside Linear checks
  it).

### 6. Write the experiment

`experiments/NN-<area>.md`, the next free number. Shape, from 182, 183 and 184:

- The title is the question. Line one: the date read, and **"This is reading, not a
  measurement."** unless something ran. It names the note and the private page "<Area>
  guidelines" by title. Never put a page link in the repo.
- **The answer** first: what the makers agree on, then how today's example follows and breaks it.
- One small `text` block: how each tool does it, one line each.
- `## What was read`, then one section per group of sources, at most one table each.
- `## Today's <example>`: a what, today, where table, then the same case checked against each
  principle (passes, breaks, half).
- `## What this tells us for fabrika`, `## What it cannot tell us`, `## Links` with the tags.
- Dollars spent, even when $0. A probe that ran says where, on what version, and if it was kept.

### 7. Write the note

`docs/direction/<area>.md`. Shape, from modes and hot reload:

- **Status line first:** **Proposed DATE.**, then each point the owner already decided, named.
- Built from experiment NN and the private page, "Neither is a measurement."
- **A code block first:** the running example in the new shape, marked as a sketch, then a short
  `text` trace of one press or one save, step by step.
- `## Which version`: `next/` and today's version, one bullet each.
- `## The shape`, if the area adds fields or types: the types, and how they were checked.
- `## The N principles`: about six. Each is `### X1: <name>`, then **Lean, NN%.**, **No lean, the owner picks.** or
  **Decided DATE.** on its own line, then bullets: what it means, why (a quoted source), the Linear row,
  the Elm or OTP answer, what holds it (the type, test or refusal that enforces it), the doubt and what would settle it, the cost, and today's example
  (follows or breaks, with `file:line`). More than eight principles means some are rules: group
  them under a principle, as hot reload's six held seventeen rules.
- The smaller calls, each with options as small code blocks, a lean and how sure (or "No lean,
  the owner picks", as for a clash with Linear).
- What the ledger records, or "nothing new", and what fact is lost if it is not recorded now.
- `## A tryout in today's version`: small fixes offered, not filed (when the area has one), with a size in lines and
  agent hours.
- `## Where this differs from settled notes`, `## What it costs`, `## What it cannot tell us`.

### 8. Add the index rows

- One row in `docs/direction/README.md`: what the note says, then its status, `proposed`.
- One row in `experiments/README.md`: number, question, files, date, the answer, $.

### 9. Build and publish the page

The page is a mockup with the guidelines folded under it, not a write-up with a demo in a corner.
Pages built the other way came out as one design and a wall of text, and the redrawn demo drifted
from the real screen (boxed buttons in a selected row, bigger type, a footer that wrapped).

- Follow `references/page-structure.md`: the structure checklist, the page rules and the
  highlight snippet. Every box on its list is checked before publishing. View every page at
  1280 and 390 wide on a local copy first, then again after publishing.
- **The demo is lifted, not redrawn.** Its CSS is the built `window.css` from step 5, copied
  unchanged, or rules lifted from it by selector and printed as they are (the design system's
  generator does this). Its markup is the DOM step 5 saved, copied once. Nobody retypes a rule, a
  class or a word of the screen. Each design and layout is its own small document the page loads
  in a frame, so today's CSS and the proposed CSS never mix.
- **Several designs, not one.** Today, each round of step 5 and Proposed can be switched, and two
  can sit side by side at the same layout. A round with no saved DOM shows its real shot.
- **The blocking check.** Shoot each demo state the page offers, at the size and scale of its
  step 5 shot, and put the two side by side with a pixel diff. Any difference in words, boxes or
  sizes blocks the publish: fix the lift, not the shot, and shoot again. Save the side-by-sides in
  the scratch folder and name them in the walk. Shoot with scroll bars shown, as Electron draws
  them. One drift is not a difference: when the check runs on a newer Chromium than the app's
  Electron, a line can sit up to about 1px lower, so a long list creeps down a few pixels. Same
  words, same boxes, same widths: say so in the walk and on the page.
- Publish it from files as a private artifact titled "<Area> guidelines": the page, the frames,
  the CSS and the shots. Later changes republish to the same URL. The page goes in no file in the
  repo.

### 10. Open a docs-only pull request

- Branch from `origin/main`. Stage the note, the experiment and the two index rows by name.
- Run `pnpm format`, then `pnpm lint` once. Grep the added lines for names, machine paths and
  keys, as `AGENTS.md`'s public repo rules say.
- Title: `direction: <area>, proposed, with experiment NN`. The body, as PR 287: what is in it,
  the principles with their leans (or "No lean, the owner picks"), the shape, today's example, what was decided, what other open
  pull requests would change to match, open calls, what it cannot tell us.
- Log the hand run in `field/` the same day. It lands by
  [the plan's rule](../../../docs/plan/README.md#how-a-change-lands), after the owner's yes.

### 11. Walk the owner through it

- One step per message, titled `**Step N of M: <name>**`. Step one is the whole idea, then one
  step per principle, then the smaller calls.
- 3 to 5 short bullets per step, each with its lean and how sure, or "No lean, the owner picks". Then one everyday comparison.
  End with "Say next." and wait.
- The owner's answer on a lean changes the page first, then the note, then the pull request.
- The last step asks one yes or no: merge it?
- **Before the merge,** mark the note decided. Its status line becomes "**Decided DATE.** The
  owner approved the N principles, the shape and the smaller calls below with their leans, after
  a walk of each part. The leans' confidence numbers stay as written." Its README row says
  `decided DATE`, and the page's marks change to match.
