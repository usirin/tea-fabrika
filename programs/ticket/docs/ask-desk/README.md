# Ask desk shots, look E

Today's version. These are shots of the real built app (`node e2e.ts --ask-desk`), with a test home of
their own. They cover 14 states, 5 layouts, and dark and light: 140 shots, plus `focus-one-dark.png`
and `focus-one-light.png`, the bar holding keyboard focus. Each file is named
`<state>-<layout>-<look>.png`. `capture-record.json` lists them and says what is made up. The ticket,
the question, the plan, the rec and the clocks are seeded.

Look E: the ask is one quiet bar under the ticket title, with only a hairline under it.

- The question is on line one. The actions are on the line under it, starting at the content's left
  edge, on every layout.
- The rec line ends with "Did this need you?" and the two marks. The line is one run of text: a
  long hint (a blind ask's "Your pick first") wraps like words, and "Did this need you?" goes on
  after its last word.
- The reason is on the next line, with Evidence right after it. With no reason (blind, no rec),
  Evidence starts the next line.
- The shots use the default keys: Take rec shows `y`.

## What each state shows

| State | What it shows |
|---|---|
| `blind` | A blind ask: "Your pick first", only Every pick and Later, no Recommended. |
| `asks-menu` | The asks menu from the top bar. A closed row is two tight lines, the question and its ticket. The open row holds the ask: all its actions in one row (Every pick, Open ticket, Later, and Take rec and Not the rec when there is a rec), then the rec line with the marks, then Evidence. |
| `no-rec` | An ask with no rec. |
| `shown` | A shown rec: "Recommended Approve · 95% sure", once. |
| `every-pick` | Every pick opened as a list under the bar. |
| `required-note` | Not the rec, with its required note ("Why no?") open and focused: one 2px ring, no second edge. |
| `needed-true`, `needed-false` | A mark pressed: a check, the selected fill and the words. |
| `evidence-open` | The evidence opened under the bar, as words. |
| `running`, `stuck`, `done` | Not your turn: the turn card says what runs, what stopped or what ended. |
| `saving` | The answer is being saved. |
| `failed-save` | A save that did not land, with Try again. Its line scrolls into the tile's view when it appears. |
| `focus` | One layout only: the bar holding keyboard focus, its hairline turned into the 2px focus line. |

The open ask's own "asks you" row is gone from Activity while the bar holds that ask. It comes back
once the ask is answered or withdrawn. An answered ask on the same ticket keeps its row, as in
`shown` on #118.

## Per layout

The same in dark and light unless a line says otherwise.

- **one** (one tile fills the window): everything is on its own line with room to spare. The actions
  sit under the question at the left edge, not far right. Nothing wraps.
- **side** and **stacked**: a shown rec has no wraps in the bar: the rec line, "Did this need you?"
  and both marks fit on one line. A blind ask's hint is longer: "Did this need you?" stays on the
  hint's line, and the two marks drop under it together.
- **2x2** (each tile about 930px wide in a 1440 window): the Properties side column is still shown. The bar
  sits in the main column, and the rec line with both marks fits on one line. A blind ask wraps as in
  side. With evidence open, the
  bar and its first lines fit, and the rest scrolls inside the tile.
- **small** (1024x700, four tiles): the ticket tile is short, so a note, its buttons or a failed
  save's line can sit below the fold. The tile scrolls, and the e2e checks each one in flow.
  - In `failed-save`, the tile scrolls the failure line into view, so it is at the tile's bottom
    edge in the shot, and the question's line is scrolled off the top.
  - The rec line with both marks still fits on one line in the ticket tile.
- **asks menu**: 660px wide (it was a 360px panel, where an open row took five lines), or the window
  less 16px. At one, side, stacked and 2x2 the open row is three lines: the actions, the hint with
  "Did this need you?" and both marks, then Evidence. In `small` (1024 wide) the menu covers about
  two thirds of the window, and its head scrolls off above the open row.

## What changed for the narrow case

- The actions keep one line. Below a 480px tile, their key chips are hidden first, and the keys stay
  in `aria-keyshortcuts`. After that, a long label wraps inside its own button. No button ever sits
  alone on a line. No shot here has a tile that narrow, so the hidden key chips are not shown.
- The marks and Evidence have no side padding, so their words start at the same edge as the line
  above. A pressed mark's fill reaches past its words with a spread shadow, so its text keeps that
  edge.
- Keyboard focus on the bar itself turns its hairline into a 2px line in the app's focus color, the
  full width of the bar (WCAG 2.4.7), not a box. Each control inside keeps the app's own ring
  (`.view :focus-visible`).

## What these shots do not tell us

- A shown rec's open row in the menu (five buttons) is not shot open: the menu opens on the first
  ask, a blind one. In a narrow menu its five buttons stay on one line, and a long label would wrap
  inside its own button.
- No VoiceOver run was made (`capture-record.json`: "not run").
- In `small`, the tracker tile next to the ticket has a sideways scrollbar under its onboarding card.
  That is the tracker's, not the bar's.
