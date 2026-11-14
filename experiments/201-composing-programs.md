---
date: "2026-11-02"
summary: "Today's version; part ran, part reading, not a measurement. Outline round 2 split an outline and a board into six small programs on one shared row type: six compositions, every pipe passing today's fit check, shot on Electron at five layouts through a stand-in host. A tree cannot go on a pipe as a tree (the shape check refuses `Schema.suspend`), so it goes flat with a `parent` key; a drawer alone shows nothing; two lines cannot share a ticket tile by pipe. A read-only audit found 16 second jobs in 5 places: `ticket`, `runs` and `map` each run the tracker's whole machine, the tracker holds a second ticket page, and the frame holds the asks list. Feeds the composing rules C1 to C11 of [program guidelines](../docs/direction/program-guidelines.md#composing-programs-c1-to-c11), decided 2026-11-02. $0 in API calls."
---

# 201. How do small programs compose on pipes, and where does one program hold another's job?

Built and read 2026-11-02. **Part ran, part is reading; neither is a measurement.** Two pieces of
work feed the composing rules C1 to C11 in the note
[program guidelines](../docs/direction/program-guidelines.md#composing-programs-c1-to-c11), which the
owner walked and decided the same day:

- **Outline round 2.** An outline and a board, split into small programs joined by pipes, built in
  today's version on a local branch and shot in the real app with Playwright on Electron.
- **The audit.** A read of today's `programs/*` and `apps/fabrika` for every place one program does
  a second program's job, measured against the note's G1 and G6. Nothing ran.

Both are about today's version. What they teach goes into `next/` as rules, not as code.

## The answer

- **Small programs compose well when one row type sits below all of them.** Six compositions of
  six programs ran on one shared row type. Every pipe passed today's fit check, and a wrong pipe
  was refused.
- **A tree cannot go on a pipe as a tree today.** The shape check refuses a schema that refers to
  itself, so the tree goes flat, as OpenTelemetry spans do: rows, each naming the row above it.
- **Two things the brief named did not run as written.** A drawer alone shows nothing, and two
  lines cannot share one ticket tile by pipe. Both became rules (C4, C6).
- **Today's programs hold 16 second jobs in 5 places.** The biggest is that `ticket`, `runs` and
  `map` each run the tracker's whole machine. Five programs hold none.

```text
tracker --all | outline              c1: the tracker's tickets as a tree
notes | outline                      c2: your notes alone
tracker --all | notes | outline      c2b: the tickets placed in your notes
tracker --all | outline | ticket     c3: Enter sends the ticket on
asks | board --by whose              c4: what waits, as columns
tracker --all | board --by whose | ticket                                 c5
tracker --all | notes | outline | ticket   and   asks | board --by whose | ticket   c6: one desk
```

## Outline round 2: programs on pipes

Round 1 built four designs of an outline as four modes of one program. Round 2 split them into
small programs, as G1 (one job) and G6 (typed pipes) ask. The sidebar went: Enter sends the line's
ticket down the pipe, and the `ticket` tile beside shows it.

### The programs, one job each

| Program | Its one job | In | Out | Window |
|---|---|---|---|---|
| `tracker` (today's) | tickets on the ledger, and their rows (a new `rows` output and `--all` flag) | its query | `ticket`, `rows` | yes |
| `asks` (new; not a program today) | what waits on you, one row per ask or stuck run | the host's asks fold | `rows` | no |
| `notes` (new) | your own rows as a tree, with tickets placed where you put them | `rows`, `notes`, `place` | `rows` | no |
| `outline` (new) | draw any rows as a tree: fold, zoom, only what waits on you | `rows` | `ticket` | yes |
| `board` (new) | draw any rows as columns by whose move | `rows` | `ticket` | yes |
| `ticket` (today's) | one ticket: its page, its ask, its activity | `ticket` | `ticket` | yes |

The round 2 branch called the rows output `lines`, its row's state `LineState`, and the row's
fields `key` and `up`. The owner's naming pass on 2026-11-03 renamed them `rows`, `RowState`, `id`
and `parent`, and this write-up uses the new names. The shots still show the old empty text.

A kit beside them, not a program, held the glyph, the bar and the keys line: view helpers with no
state. The row type lived in `packages/pipeline`. Every pipe was checked with today's `fit()`
(`packages/fabrika/src/program/shape.ts:321`): ten fit, and a wrong one (`outline`'s `ticket` into
`board`'s `rows`) came back "does_not_fit".

### The six compositions

Shots are in [`201-composing-programs/shots/`](https://github.com/usirin/tea-fabrika/tree/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/). A file starting
`cap-` carries its tsh line as a caption above the states it shows.

| Line | What each program owns | Shots |
|---|---|---|
| c1 `tracker --all \| outline` | tracker: states and words. outline: open, zoom, filter | [one tile](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c1-one.png?raw=true), [1024x700](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c1-small.png?raw=true), [`y`, only what waits](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/c1-only-one.png?raw=true) |
| c2 `notes \| outline` | notes: order and placing. A placed ticket shows only as "Ticket 141" | [one tile](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c2-one.png?raw=true) |
| c2b `tracker --all \| notes \| outline` | tickets grafted into notes; the rest under "Not placed yet" | [side by side](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c2b-side.png?raw=true) |
| c3 `tracker --all \| outline \| ticket` | ticket: the page and the answer | [side by side](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c3-side.png?raw=true), [2x2](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c3-grid.png?raw=true), [Enter on 117](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/c3-enter-117-side.png?raw=true) |
| c4 `asks \| board --by whose` | asks: what waits. board: columns, the done fold | [one tile](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c4-one.png?raw=true) |
| c5 `tracker --all \| board --by whose \| ticket` | as c4, with the tracker as source | [2x2](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c5-grid.png?raw=true), [`d` in a quarter tile](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/c5-done-grid.png?raw=true) |
| c6 one desk: outline, board and one ticket tile | two lines into one ticket tile, wired by hand | [the desk](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/201-composing-programs/shots/cap-c6-desk.png?raw=true) |

The keys pressed, as the host recorded them: c1, click and `→` on 117, `⌘.`, `Esc`, `y`. c3, `→` on
117, then `Enter` (the ticket tile changed from 141 to 117), then `y`. c5, `Enter` (117 to 141),
then `d`. c6, `Enter` on 117 in the outline, then `Enter` on 176 in the board: one ticket tile showed
each.

### What ran and what did not

- **Ran:** every value went through the real fold and the real input shape check, and each drawer
  ran its own `step` and view, in the built app on Electron, at one tile, side by side, stacked,
  2x2 and 1024x700.
- **Did not run:** the pipes went through a stand-in host on the app's socket, not today's host. No
  program's main ran, and nothing was typed in tsh. The tracker's `rows` output was declared but
  its main does not send it.
- **Did not run as the brief wrote it:** `outline | ticket` and `board | ticket` with nothing
  upstream show an empty drawer, "No lines yet. Pipe some in: tracker | outline." The real lines
  have three stages (c3, c5). And c6 cannot be typed in tsh today: one line is one chain, and two
  chains cannot share a tile. The shot wires both into one ticket tile by hand.
- **Found on the way:** the first nested row type did not load. `fromEffect` refuses
  `Schema.suspend` with "a shape only checks", so the tree went flat (C2). Adding `--all` to the
  tracker broke six callers of `start(tracker, {}, ...)`: a flag with a default is still required
  in `Given`. The branch passed `{all: false}`; making defaulted flags optional is a core fix worth
  a ticket (80%).

### What looks off in the shots

- **Two counts disagree in c6.** The outline says "Waits on you 4"; the top bar and the board say 3.
  The fourth is your own note marked "you". Decided: keep it, and label the split, "Waits on you ·
  3 asks, 1 note".
- **c4 offers a key that does nothing.** The board's keys line shows `d show done` with no done
  column. A keys line made from `commands`, hidden where `refuse` says no, fixes it (C11).
- **The board has no narrow form.** In a quarter tile (c3 and c5, 2x2) it shows about two rows per
  column, and `d` opens a done column below the fold, so nothing visible changes. The outline reads
  fine at a quarter.
- **A placed ticket reads like a heading.** In c2, "Ticket 141" is bold like a note. That is C7
  working (notes never fills in a title it was not sent), but a ticket glyph on the stub would say
  what it is.
- **The workspace tab takes the ticket's number** ("#117", "#176") after Enter in c3, c5 and c6. Not
  checked why; the frame may name the workspace after the last view that changed. The audit's A3
  (below) is the likely cause.
- Stacked and 2x2 layouts show empty `tsh$` tiles: the line is in the caption, not typed in a tile.

## The audit

Read on main at `5a9d1679`, today's version only. The yardstick is the note's G1 (one job, one
model) and G6 (typed pipes, no calls). Each size is an estimate from reading.

### 16 second jobs in 5 places

| Where | Second jobs | Split | Keep |
|---|---|---|---|
| `tracker` | 4 | its ticket page, the pull request list, used as a library by three programs | the Jev duplicate hint |
| `ticket` | 3 | runs the tracker's machine | the properties panel, the ask card |
| `runs` | 2 | runs the tracker's machine | the run detail |
| `map` | 2 | a ticket reachable by flag only, with no input | the hand-made program table |
| the app frame | 5 | the asks list, Enter drives the tracker's input, reads the ticket's private view, sync rides on the asks reads | the jobs list |

`trace`, `pipeline`, `experiments`, `experiment`, `compare`, `markdown` and `counter` hold none.
A second output that is a view (data, then the same data as `markdown`) is one model in two sizes,
not a second job.

### The top three splits

1. **One read-only reader below the programs, 85%.** `ticket`, `runs` and `map` depend on
   `@tea-fabrika/tracker` (each `package.json`) and run its whole machine. Each reads the whole
   ledger, polls GitHub every 2 minutes, and holds the power to write tickets, even `map` and
   `runs`, which write nothing. Their steps list (`programs/tracker/src/steps.ts`, 9 steps) already
   disagrees with the pipeline's own `STEPS` (`packages/pipeline/src/stages/pipeline/machine.ts:56`,
   11 steps, with `exam`, `exam_merge` and `mutants`). The folds and the steps move to
   `packages/pipeline/src/tickets/`. About 450 lines moved and a 120-line reader, 4 agent hours.
2. **The tracker's ticket page goes, after the note's tryout fix 1, 75%.** Two ticket views have
   drifted: duplicate hints only in the tracker's, properties and steps only in the ticket's, and two
   ask boxes answer one input with different layouts. `tracker | ticket` owns the ticket. Before fix 1
   (Enter with no ticket tile opens one beside) this split is worse. About 350 lines out, 3 agent
   hours plus fix 1.
3. **The asks list leaves the frame, 80%, in `next/` only.** Today the frame holds the asks machine
   (`apps/fabrika/src/asks.ts`, 377 lines), reads the ticket program's private view to name tiles,
   and sends a `query` into a tile it finds by the name "tracker". In `next/` it is the asks program,
   `asks | ticket`. Today gets only fix 1.

```sh
# what the splits put back together, as lines a person types
tracker | ticket | runs              # the same line; inside, one read-only reader
tracker | ticket                     # Enter sends the number; the ticket tile follows
asks | ticket                        # next/: an ask, then its ticket beside it
```

### What the audit found about the note itself

- **G6's "today: follows" was wrong.** The pipe follows, but the imports do not, and
  `layer-rules.json` has one `programs` layer, so nothing checks "a program imports no other
  program". The note now says so.
- **The note banned the import but did not say what replaces it.** CQRS answers with a read model;
  Elm Land with a shared module. That became C9 and split 1.

## What this tells us for fabrika

The owner walked C1 to C11, the count's label and the three splits on 2026-11-02 and took each lean,
with two changes from the drafts: the row type is a `Schema.Union` of `Schema.Opaque` tagged cases,
never a `kind` field, and the tree's helpers are `Tree.fromRows` and `Tree.toRows`, never `xOf`
names. C10 went to option c: `notes`' own window is the tree you type in, and `outline` stays a
read-only drawer. Two of the note's proposed rules changed to match: G6 R2 (the ticket follows on a
pipe inside one line only) and G7 R4 (a fold moves below both programs too).

## What it cannot tell us

- **The pipes ran in a stand-in host.** No program's main ran, and nothing was typed in tsh. A real
  `tracker --all | outline | ticket` in today's host may show timing or ordering this did not.
- **The data was half real.** Ticket numbers and titles (and PRs 307, 308) are real; the runs, times
  and asks were made up.
- **The audit ran nothing.** "Four GitHub pollers" comes from reading the machine's `init` and the
  host's wiring, not from a trace or a network log. One run of `tracker | ticket | runs` with the
  `gh` calls counted would confirm it.
- **Daily use is not measured.** Whether a quick look in place beats a tile beside (split 2), or two
  tiles to write and read notes is clunky (C10), needs a week of use.
- **The steps drift may be on purpose.** If the tracker's 9 are a chosen view of the pipeline's 11,
  split 1 is one mapping, not a copy.
- **No screen reader ran,** and the `next/` side was not read: every `next/` lesson leans on the
  note's desk, `location` and `glance`.

## Dollars

$0 in API calls. No model was called by a script. The build, the shots and the audit ran in agent
sessions on a subscription; their tokens are not counted here. The shots ran under `nice` with a
test home of their own.
