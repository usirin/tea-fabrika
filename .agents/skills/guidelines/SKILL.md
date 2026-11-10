---
name: guidelines
description: Run this repo's guidelines study for one design area, from settled check to a decided note. Use on "guidelines for X", "we need X guidelines", "run the guidelines process", or "a guidelines study".
---

# A guidelines study

One design area becomes a few principles the owner can press, read and decide on, and then a
build in the app. A study ends with one experiment, one note, one Design canvas titled "<Area>
guidelines", one docs-only pull request, a walk that ends in a yes or a no, and, on a yes, a build
plan the same day. The canvas is the study's front door, presented the way a designer presents
work: slides that walk the story, and at the end a clickable prototype of the pick that answers
every key and click the guidelines name. It is a Design canvas in Claude Design with the design
system installed ([drawn on Claude Design](../../../docs/direction/design-on-claude-design.md)).

The models are themes (PR 281), keybindings (PR 282), hot reload (PR 286) and modes (PR 287).
Themes came first; the other three set the note's shape and the order of the principle slides,
and modes is the closest to it all: copy modes for those. Pipeline guidelines (PR 290) drifted on structure (no demo, no Try it), so it is not a model.
The prototype copies the mockup rounds instead (the tile, the pipe marker finalists, the chat
window, the outline round): there the screen is the point, and the words sit beside it.

Read `AGENTS.md` first. Its rules on names, writing, version and the public repo all apply.

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
- It runs through the experiment, the note, the code block that opens the note, and the
  canvas. Every principle says whether today's case follows it or breaks it, and where.
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
  answer: <why>". Where we differ, say why. Ask it again for each design in step 5: which program
  owns each part of it?
- **Elm or OTP.** Name the Elm answer (model, update, view, parents step children) or the
  Erlang/OTP one (mailbox, supervisor, `code_change`) where it fits. Say where we leave it.
- **Accessibility.** Name the WCAG criterion a principle touches, and what needs a real screen
  reader run.

### 5. Build 3 or 4 designs and look at them next to Linear

The Linear row in step 4 is words. This step checks the look with eyes. It starts wide, as the
pipe marker finalists did with four different designs, and only then refines one.

This step also runs on its own for a screen already being built in today's app, before its pull
request opens, even when no study is running (owner, 2026-11-08).

- Build **3 or 4 distinct designs** for real in today's app, on a local branch, with the real
  tokens (`apps/fabrika/src/themes.ts`) and the real chassis around them. Each is a different
  answer to the same job, such as a list, a card, a panel or inline, not a small change to one
  design. Keys and mouse both work in each, as the guidelines say. Read today's code for which
  jobs exist, not for how they look
  ([rethink, do not port](../../../docs/direction/rethink-do-not-port.md)).
- **Each design writes its tsh pipe line first,** before it is built: `tracker --all | outline`,
  or `outline | ticket`. Any part that is another program's job becomes its own tile, joined by a
  pipe: a sidebar that opens a detail, a list another program owns, a mode that swaps the whole
  view. The yardstick is program guidelines (PR 332, proposed): G1, one job per program, and G6,
  programs meet on typed pipes.
- Fewer boxes. If something already draws an edge, a second line, box or background goes. A
  selected row is a full-row fill and stronger text, never a colored bar on one side.
- Shoot each design with Playwright on Electron, as `apps/fabrika/e2e.ts` does, at five layouts:
  one tile filling the window, two side by side, two stacked, a 2x2 grid, and about 1024x700. Put
  each shot beside today's app and beside the closest Linear screen, from Linear's public docs or
  changelog.
- Show the owner the designs on the canvas (step 9), one slide each with its pipe line on top and
  its prototype beside it. **The owner picks one.** Each design that lost gets one or two plain
  lines on why, tied to a principle or a shot.
- Then refine the pick in rounds. For each shot, one line: would Linear's team ship this? What
  looks off: a box in a box, a gray that fights, a line nobody needs, loud text, a cramped
  layout? Fix it and reshoot. Two or three rounds is normal. Stop when you would ship it.
- Keep every design and every round. For each, the shoot presses the real build through every
  key and click the principles name, and every other key and click the screen takes, and saves
  each state it reaches: its shot, the words on screen (from the DOM), and which press led where.
  These files are the prototype's reference, not its source: step 9 copies its words, keys and
  first state table from them and matches its boxes and sizes to the shots.
- **A press the shoot missed is shot now,** in the real build, never left out. A state the real
  build cannot reach yet is built on the local branch first, then shot. Only a part Manti cannot
  draw yet stays a named gap (step 9).
- Their yes on the look comes before the write-up. On a no, go round again.
- Each principle also gets a **kind**, so it is checked the right way: **law** (the test writer
  can check it), **lint** (`pnpm lint` can hold it) or **taste** (only a shot beside Linear checks
  it).

### 6. Write the experiment

`experiments/NN-<area>.md`, the next free number. Shape, from 182, 183 and 184:

- The title is the question. Line one: the date read, and **"This is reading, not a
  measurement."** unless something ran. It names the note and the Design canvas "<Area>
  guidelines" by title.
- When step 5 ran, say so: the branch, the app version, the designs and rounds shot, and how many
  states each prototype has, with how many of them have a real shot.
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
- Built from experiment NN and the Design canvas, "Neither is a measurement."
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

### 9. Build and publish the deck and the prototype

**One Design canvas titled "<Area> guidelines",** with the design system installed: its
`tokens.json` copied in and its record in the canvas's index, as the canvas type says. Follow the
type's own instructions for every file. Later rounds revise the same canvas. It holds two things,
in this order:

- **The deck.** Slides that walk the story the way a designer presents work: the question and the
  scope, what is settled, how the makers do it, one slide per principle with its lean, one slide
  per design with why it lost or won, the rounds of the pick, the proof, the smaller calls, what it
  cannot tell us. Each slide is a 1280x720 artboard with one idea on it, and Play walks them in
  order. The canvas opens on the first slide.
- **The prototype, last.** The pick, built on the design system and driven by a small state
  machine, so every key and click the guidelines name does something. Each other design gets one
  too, at one tile at least, so its slide can be pressed.

The Slides type is not used: its live embed takes no clicks and no keys, so it cannot hold a
prototype. Shots and the prototype are in dark mode first, as the owner runs it.

- Follow `references/deck-structure.md`: the slide list, the prototype rules, the press checklist
  and the marks. Every box on it is checked before publishing.
- **The prototype is a model, an update and a view** (Elm first). The model is the screen's state;
  the update is a table of presses, one row per key or click in each state; the view is real
  parts. A flow lives in one artboard, since each artboard keeps its own state.
- **Real parts, not redrawn.** Mount Manti's parts and ours from the system's bundle
  (`window.Fabrika`) by name, never a look-alike. Layout is plain markup on the system's tokens.
  Every word, name and key is copied once from step 5's saved states: nobody retypes a word of
  the screen. A keys line comes from its program's `commands` table plus `refuse`, as the outline
  round's did. A part the bundle cannot draw yet, such as an edit inside a `TreeView` row, is a
  named gap tag where it would be; the press still moves the state, and the gap tag says what the
  build will draw there.
- **Keys go to a focused window.** The canvas allows no page-wide key handler. So the prototype's
  app window is one focusable element with its own key handler. It takes focus when Play opens it,
  and a click on it gives the keys back. A ring shows while it has them, and a quiet line under it
  says "Click the window to give it the keys" when it does not. A key the browser keeps for itself
  (such as Cmd-W) cannot reach it: that key gets a row on the press checklist and a click on its
  menu item stands in.
- **Every press answers.** A line under the window logs each press: the key or click, and the
  state it reached. A press the app ignores in that state says so in the log, with why, as the
  app does. There is no "not shot": a press with no state is a bug to fix before publishing,
  never a label.
- **The press checklist.** One row per key or click a principle names: the press, the state it
  starts from, the state it reaches, the principle and Try it line it serves, and whether that
  state has a real shot. The agent ticks each row by reading the prototype's press table against
  the principles' Try it lines and keys tables. It sits on a slide before the prototype.
- **The blocking check is the owner's look,** once per round. The canvas type tells an agent not
  to check its own render. So the proof slides put each prototype state beside its step 5 shot,
  uploaded as an image, at the same size and scale. Any difference in words, boxes or sizes sends
  the round back: fix the prototype, not the shot. A round is ready for that look only when every
  row of the press checklist is ticked and every state has a real shot.

The owner's plain walk page uses the same real parts, states, working keys and clicks. It sits
beside the canvas for the walk. Keep the distinct designs from step 5 available to choose.

- **One selected design per screen.** Show today's version on the left and the selected design
  on the right. Label both. Switch the design between screens or walk steps. Never pack three
  or four frames into one row to show all choices at once.
- **Keep both at 1:1 real size.** Use their real dimensions. Allow scrolling when the pair needs
  more space. Never shrink the screens to fit the page or redraw their layout at a smaller size.
- **Lead looks before sending.** Capture the plain page at 1440x900 and look at that capture.
  Check the left and right order, real sizes, scrolling and the chosen design. Fix clipping or
  crowding before the owner sees it. Press the keys and clicks too.
- **Make one HTML copy with everything inline.** Include styles, scripts, fonts, images and
  real parts, so the owner's side panel needs no other files or server. Open that copy and
  check its keys, clicks and states before sending it.

The owner's plain walk page uses the same real parts, states, working keys and clicks. It sits
beside the canvas for the walk. Keep the distinct designs from step 5 available to choose.

- **One selected design per screen.** Show today's version on the left and the selected design
  on the right. Label both. Switch the design between screens or walk steps. Never pack three
  or four frames into one row to show all choices at once.
- **Keep both at 1:1 real size.** Use their real dimensions. Allow scrolling when the pair needs
  more space. Never shrink the screens to fit the page or redraw their layout at a smaller size.
- **Lead looks before sending.** Capture the plain page at 1440x900 and look at that capture.
  Check the left and right order, real sizes, scrolling and the chosen design. Fix clipping or
  crowding before the owner sees it. Press the keys and clicks too.
- **Make one HTML copy with everything inline.** Include styles, scripts, fonts, images and
  real parts, so the owner's side panel needs no other files or server. Open that copy and
  check its keys, clicks and states before sending it.
- These checks apply only to the plain walk page and its single-file copy. Keep the canvas
  type's own rule against an agent checking its own canvas render. The owner's canvas look
  still checks each proof slide against its real shot.

### 10. Open a docs-only pull request

leakgrep.sh checks added text; private words stay outside the repo.

- Title: `direction: <area>, proposed, with experiment NN`. The body, as PR 287: what is in it,
  the principles with their leans (or "No lean, the owner picks"), the shape, today's example, what was decided, what other open
  pull requests would change to match, open calls, what it cannot tell us. It names the canvas
  "<Area> guidelines" by title, never by link.
- Log the hand run in `field/` the same day. It lands by
  [the plan's rule](../../../docs/plan/README.md#how-a-change-lands), after the owner's yes.

### 11. Walk the owner through it

- The walk follows the deck. One step per message, titled `**Step N of M: <name>**`, each naming
  the slide it is about. Step one is the whole idea, then one step per principle, then the
  designs, then the smaller calls.
- 3 to 5 short bullets per step, each with its lean and how sure, or "No lean, the owner picks". Then one everyday comparison.
  End with "Say next." and wait.
- A principle's step ends with its Try it line, so the owner can press it in the prototype.
- The next to last step is the prototype: the owner presses it in Play, and any press that does
  the wrong thing goes back to step 9 before the walk goes on.
- The owner's answer on a lean changes the canvas first, then the note, then the pull request.
- The last step asks one yes or no: merge it?
- **Before the merge,** mark the note decided. Its status line becomes "**Decided DATE.** The
  owner approved the N principles, the shape and the smaller calls below with their leans, after
  a walk of each part. The leans' confidence numbers stay as written." Its README row says
  `decided DATE`, and the canvas's marks change to match.

### 12. Plan the build, the same day

A decided note is not done until the app shows it. The owner decided on 2026-11-03 that every
study ends here.

- **The same day as the merge,** write the build plan for the version the note names, using the
  plan skill.
- **Today's version is in scope.** A note about today's app, or one whose tryout the owner took,
  is the owner's pick by that yes; it needs no second ask before it is planned.
- **Bring it to the owner as one yes or no:** approve the plan? On a yes, the test writer starts
  as soon as a slot is free (AGENTS.md's caps), then the build, mutation and one review, as every
  pull request does. File the build as a tracker ticket with `from` set to the note's pull request.
- **A `next/`-only note** gets its plan written too, filed against the tier it lands in, so the
  build is waiting when that tier opens.
