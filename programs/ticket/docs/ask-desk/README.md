# Ask desk shots, look E

Today's version. These are shots of the real built app (`node e2e.ts --ask-desk`), with a test home of
their own. They cover 15 states, 5 layouts, and dark and light: 150 shots, plus `focus-one-dark.png`
and `focus-one-light.png`, the bar holding keyboard focus. Each file is named
`<state>-<layout>-<look>.png`. `capture-record.json` lists them and says what is made up. The ticket,
the question, the plan, the rec and the clocks are seeded.

Look E: the ask is one quiet bar under the ticket title, with only a hairline under it.

- The question is on line one. The actions are on the line under it, starting at the content's left
  edge, on every layout.
- The rec line ends with "Did this need you?" and the two marks, one piece that never splits. The
  rec's words (or a blind ask's hint, "Your pick first") flow as plain text at their full width, and
  the marks follow the last word on the same line where they fit. Where they do not, they take the
  next line together, at the words' left edge. The bar and the menu use the same rule.
- The reason is on the next line, with Evidence right after it. With no reason (blind, no rec),
  Evidence starts the next line.
- The shots use the default keys: Take rec shows `y`.

## What each state shows

| State | What it shows |
|---|---|
| `blind` | A blind ask: "Your pick first", only Every pick and Later, no Recommended. |
| `asks-menu` | The asks menu from the top bar. A closed row is two tight lines, the question and its ticket. The open row holds the ask: all its actions in one row (Every pick, Open ticket, Later, and Take rec and Not the rec when there is a rec), then the rec line with the marks, then Evidence. |
| `asks-menu-rec` | The asks menu with a shown-rec ask open: its five actions on one row (Take rec, Not the rec, Every pick, Open ticket, Later), "Recommended Approve · 95% sure", the marks on the next line, then the reason with Evidence after it. Four lines. |
| `no-rec` | An ask with no rec. |
| `shown` | A shown rec: "Recommended Approve · 95% sure", once. |
| `every-pick` | Every pick opened as a list under the bar. |
| `required-note` | Not the rec, with its required note ("Why no?") open and focused: one 2px ring, no second edge. The field rests at one line and grows as its words wrap. |
| `needed-true`, `needed-false` | A mark pressed: the selected fill, its words in the primary text and underlined. A press never changes the marks' width, so the piece stays on the line it had. |
| `evidence-open` | The evidence opened under the bar, as words: the ticket, then every field of the plan (stories, tasks, pointers, each open question with its options, lean, cost, sureness and doubt, and any field a later plan writer added). Each item's fields sit under one bullet. |
| `running`, `stuck`, `done` | Not your turn: the turn card says what runs, what stopped or what ended. |
| `saving` | The answer is being saved. |
| `failed-save` | A save that did not land, with Try again. Its line scrolls into the tile's view when it appears, with the question still in view above it. |
| `focus` | One layout only: the bar holding keyboard focus, its hairline turned into the 2px focus line. |

The open ask's own "asks you" row is gone from Activity while the bar holds that ask. It comes back
once the ask is answered or withdrawn. An answered ask on the same ticket keeps its row, as in
`shown` on #118.

## Per layout

The same in dark and light unless a line says otherwise.

- **one** (one tile fills the window): everything is on its own line with room to spare. The actions
  sit under the question at the left edge, not far right. Nothing wraps.
- **side** and **stacked**: a shown rec has no wraps in the bar: the rec line, "Did this need you?"
  and both marks fit on one line. A blind ask's hint is longer: at stacked the hint and the marks
  still fit one line; at side the hint keeps its one line and "Did this need you?" with both marks
  takes the next line, at the hint's left edge.
- **2x2** (each tile about 930px wide in a 1440 window): the Properties side column is still shown. The bar
  sits in the main column, and the rec line with both marks fits on one line, with a mark pressed
  too. A blind ask is as in side: the hint on one line, the marks on the next. With evidence open, the
  bar and its first lines fit, and the rest scrolls inside the tile.
- **small** (1024x700, four tiles): the ticket tile is short, so a note, its buttons or a failed
  save's line can sit below the fold. The tile scrolls, and the e2e checks each one in flow.
  - In `failed-save`, the question is at the tile's top and "Not saved." with Try again is under
    it. The note field rests at one line, so Send no and Cancel are in view too: every button of
    the bar is inside the tile.
  - The rec line with both marks still fits on one line in the ticket tile, and so does a blind
    ask's hint with its marks.
- **asks menu**: 400px wide, or the window less 16px (round 7 tried 660px; the lead kept it narrow).
  The menu is the same at every layout. An open row is at most four lines: the actions, the hint,
  "Did this need you?" with both marks on the next line as one piece, starting at the hint's left
  edge, then Evidence (after the rec's reason when there is one). In `small` (1024 wide) the menu
  is taller than the window, and its head scrolls off above the open row.

## What changed for the narrow case

- The actions keep one line. Below a 480px tile, their key chips are hidden first, and the keys stay
  in `aria-keyshortcuts`. After that, a long label wraps inside its own button. No button ever sits
  alone on a line. No shot here has a tile that narrow, so the hidden key chips are not shown.
- In the 400px menu, the five actions fit one row only as words: the menu's buttons hide their key
  chips, Evidence too, and their sides are 4px. The keys still work, each button names its key in
  `aria-keyshortcuts`, and the menu's footer names Move, Open, Later and Close.
- The marks and Evidence have no side padding, so their words start at the same edge as the line
  above. A pressed mark's fill reaches past its words sideways only, so its text keeps that edge,
  and its fill is the words' own height, so it keeps 4px (`--s-1`) from the line above and the row
  below, also where the marks wrap under a blind ask's hint. Its target stays 24px tall.
- A mark under the pointer shows Manti's quiet hover fill, with no underline and its faint words,
  so it does not read as pressed. In `evidence-open` the e2e parks the pointer off the tile before
  each shot, so no shot shows it.
- Keyboard focus on the bar itself turns its hairline into a 2px line in the app's focus color, the
  full width of the bar (WCAG 2.4.7), not a box. Each control inside keeps the app's own ring
  (`.view :focus-visible`).

## What these shots do not tell us

- In the menu, Take rec's `y` and Not the rec's `n` are not shown on screen; a person learns them
  from the bar. Whether that is enough needs a person to try it.
- The five menu actions fit 400px with only a few pixels to spare in `small`, where the menu has a
  scrollbar. A longer label (a renamed action, a translation) would overflow the row.
- In the bar's blind ask at side and 2x2, the marks take a line of their own under the hint, so the
  bar is one line taller than with a shown rec. That follows the rule; whether two short lines read
  better than one long one is the owner's call.
- No VoiceOver run was made (`capture-record.json`: "not run").
- In `small`, the tracker tile next to the ticket has a sideways scrollbar under its onboarding card.
  That is the tracker's, not the bar's.
