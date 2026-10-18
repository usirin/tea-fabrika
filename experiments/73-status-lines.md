# 73. Status lines: one line per running copy of a machine

```sh
pnpm vitest run src/tsh/status.test.ts src/tsh/status-attach.test.ts \
  src/program/status.test.ts src/stages/operate/program.test.ts
# The live look, read only: the review program with a scripted reviewer on three sandbox pull requests.
TSH_HOME=<home> bin/tsh -c 'review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1 &
  tell %1 pr <sandbox pull 9> <sandbox pull 14> <sandbox pull 8>; sleep --ms 1500; jobs; sleep --ms 4000; jobs'
# The build, scripted: no agent, writes go nowhere.
TSH_HOME=<home> TSH_SCRIPTED=<folder> bin/tsh -c \
  'build-scripted --model m --effort medium --budget 1 ticket=<t1> ticket=<t2> ticket=<t3> & sleep --ms 800; jobs'
```

## What was asked

A person looking at tsh's `jobs` saw a job's name and nothing else. They
could not tell which pull request a review was on, or that one of three was
stuck while the other two moved on.

The shape was set before this experiment:

- A status line is a tea-program idea. `@demlik/tea` does not change.
- A program declares it on `defineProgram`, beside `machines`, as
  `status: {<machine>: (state) => string}`. It is pure, and it is sent only
  when it changes.
- There is one line per running copy of a machine, keyed by the id the copy
  is kept under. A stuck copy is never hidden by a newer one.
- tsh's `jobs` shows the lines under the job. `--describe` says which
  machines have one.

Left to this experiment: real lines for the stages, whether `status` is
required, a small API for hosts, a trace tag, and when a finished copy's
line leaves `jobs`.

## Canon checked

Elm's answer: a program that shows something must say what it shows.
`Browser.element` and `Browser.document` require `view`, and a document's
`title` is a plain `String`, never optional. `Platform.worker` shows nothing
and has no `view` at all. There is no "view, if you like".

Mapped here: a machine is the part of a program with state worth seeing, so
each machine must have a line. A program with no machines has nothing to
show and declares nothing.

## What was built

### 1. `status` on `defineProgram` (`src/program/program.ts`)

```ts
defineProgram({
  name: "review",
  machines: {review},
  left: {review: ...},
  status: {review: reviewLine},   // (state: Review) => string
  main: ...,
})
```

How forgetting is made impossible, the same two ways as `left` (experiment 74):

- **The type.** A program with machines and no `status`, or with one
  machine left out, does not compile. A line for a machine the program does
  not run does not compile. A line that reads the wrong state type does not
  compile (`NoInfer` keeps the machines' types as the source of truth).
- **At definition.** `defineProgram` throws `<name> says no status line for
  <m>` and `<name> says a status line for <x>, which it does not run`. So
  the check holds past the types too.

A program with no machines may leave `status` out.

A line that throws does not stop the machine. The copy shows `no line: its
status line threw`, and the machine goes on.

### 2. Copies, and a stream of changes (the host API)

Each machine's view on a run (`run.machines.<name>`) gains two things:

```ts
run.machines.review.copies();   // [{id, line: "#597: waiting on checks", live: true}, ...]
run.machines.review.lines;      // Stream: the copies now, then again on each change
```

A copy is one run of a machine under one id: the `key.id` of `keep.run`,
or the id given to `watch`. Every running copy has its own row. Two copies
never share one, so a stuck copy stays visible while a newer one moves.

`lines` is built on what was there: the view was already a
`SubscriptionRef`, so `lines` is its `changes`, put through
`Stream.changesWith` on the copies. A state that moves without changing
any line sends nothing.

`listing(program)` (what `--describe` reads) gains `status`: the machines
that have a line.

### 3. The stages' lines (`src/stages/status.ts`)

The pull request or ticket comes first, so the copies of one machine read
apart. A line is short on purpose, so it fits tsh's width beside its indent.

| Machine | Lines it says |
|---|---|
| review | `#597: reading the pull request`, `waiting on checks`, `reviewer at work` (`, run 2` after a restart), `filing notes`, then how it ended: `done, passed`, `sent to builder: checks red`, `skipped (draft)`, `stuck: read failed` |
| ship | `reading the pull request`, `starting red checks again`, `waiting on checks`, `putting it in the merge queue`, `in the merge queue`, `merged, tidying up`, `merged` |
| build | `#6 round 1: reading the ticket`, `making a working copy`, `builder at work`, `pushing the branch`, `opening the pull request`, `done, PR #9` |
| operate's loop | `#6 round 1: building`, `reviewing PR #9`, `posting the review on PR #9`, `#6: shipping PR #9`, `#6: done after 2 rounds` |
| the kept queue (build, operate) | `#2 now, 1 waiting`, `nothing waiting` |

Every machine says `not started` before its first Msg. Every ending reads
the stage's outcome through one function, `endedAs`, so `stuck`, `ask`,
`send` and `skip` read the same in every stage.

tsh's own job table and the small `tally` have a line each (`total 9`).

### 4. `jobs` and `--describe` (`src/tsh/copies.ts`, `src/tsh/builtins.ts`)

`jobs` prints each copy's line under its job, indented. When a job runs
more than one program, or a program more than one machine, each row is
tagged with which one, padded so the lines start in one column. A row is
cut at tsh's width (100) with `…`.

`--describe review-scripted` adds `status lines: review (one per copy,
under the job in jobs)`. A program with no machine says nothing of them.

### 5. When a finished copy's line leaves `jobs`

A copy that ends stays in the run's view, marked `live: false`, until the
run ends. tsh shows every live copy, and the newest 5 ended copies of each
machine. Older ended copies fold into one row, `… 3 more ended`. When the
job ends, tsh drops it from the table, and its rows go with it.

Why: the brief's rule is that a stuck copy is never hidden by a newer one.
A stuck review is an ended copy, so dropping ended copies at once would
hide exactly the row a person needs. Keeping them all would make an
operate job over many tickets print a wall. Five is a guess at "the recent
past fits on a screen".

### 6. A trace tag (`src/program/trace.ts`)

Each copy's span carries `tea.status`, the same line `jobs` shows, set at
the start and again after each Msg. It goes in through the drawing's own
tags, so there was nothing new to wire.

### 7. What did not change

- `@demlik/tea`.
- `src/tsh/short.ts`. It shortens printed outputs, not machine state, so no
  status line replaces any of it.

## Proofs

### The user's job, end to end in tsh (`src/tsh/status.test.ts`)

An in-process tsh, the real review program, and GitHub answered from
recordings. Pull 1 cannot be read. Pull 2 is a draft. Pull 3's checks are
still running until the test lets them settle.

```
review-scripted … &
tell %1 pr <1> <2> <3>
jobs
```

`jobs`, while pull 3 waits:

```
[1] running   review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1
      #1: stuck: read failed
      #2: skipped (draft)
      #3: waiting on checks
```

After the checks settle, the same three rows, with `#3: done, passed`. The
stuck row and the skipped row stay where they were.

A second job, a pipe, `review-scripted … | ship --mode read &`, told pull
4, shows its row tagged with its program:

```
[2] running   review-scripted … | ship --mode read
      review-scripted  #4: done, passed
```

### Kill and attach: the lines come back from kept state (`src/tsh/status-attach.test.ts`)

The real `bin/tsh`, its own `TSH_HOME`, file storage, `build-scripted`,
three tickets, the input closed.

Life a, `jobs` mid build, before the kill:

```
      queue  #1 now, 2 waiting
      build  #1 round 1: builder at work
```

`kill -9` once the second ticket's builder starts. Life b, a new tsh on the
same home, `attach %1 &`, then `jobs`:

```
      queue  #2 now, 1 waiting
      build  #2 round 1: builder at work, run 2
```

`run 2` is read from the kept build state: the round knows it was cut off
once. Nobody told the job anything in life b.

### Mechanism rows

| Test | Shows |
|---|---|
| `program/status.test.ts` · two copies side by side | both are listed; the one that does not move is not hidden; the finished one shows `finished at 0` and `live: false` |
| `program/status.test.ts` · only on change | the copies now, then five Msgs of which two change the line: three emissions in all, no more |
| `program/status.test.ts` · a line that throws | the copy shows the message; the machine goes on |
| `program/status.test.ts` · cannot be forgotten | no `status`, an extra machine, a wrong state type: does not compile (`@ts-expect-error`), and throws |
| `program/status.test.ts` · no machines | `status` may be left out; the listing is empty |
| `stages/operate/program.test.ts` · the loop's line | over two rounds: building, reviewing, posting, again, shipping, `#1: done after 2 rounds`; then every copy of build, review, ship and queue, each ended, in order |
| `tsh/status.test.ts` · `--describe` | names `review` for review-scripted and `count` for tally; nothing for `say` |

Every earlier test passes. Three changed only to add a `status` to their
toy programs, and `jobs` in `shell.test.ts` now expects the tally's row.

## Live

Two real tsh runs, each on its own `TSH_HOME`. No agent ran and nothing was
written: $0.

The scripted build, three sandbox tickets, `jobs` twice:

```
[1] running   build-scripted --model m --effort medium --budget 1 ticket=…/issues/1 ticket=…/issues/2 ticket=…/issues/3
      queue  #1 now, 2 waiting
      build  #1 round 1: builder at work
…
[1] running   build-scripted --model m --effort medium --budget 1 ticket=…/issues/1 ticket=…/issues/2 ticket=…/issues/3
      queue  #2 now, 1 waiting
      build  #1 round 1: done, PR #1001
      build  #2 round 1: builder at work
```

`review-scripted` on real sandbox pull requests 9, 14 and 8, read only,
`jobs` at 1.5s and again later:

```
[1] running   review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1
      not started
…
[1] running   review-scripted --rubrics fixtures/review/rubrics --model opus --effort medium --budget 1
      #9: sent to builder: checks red
      #14: skipped (closed)
      #8: skipped (merged)
```

## Findings

1. **A line lags its state by one Cmd.** At 1.5s the live review said `not
   started`, while it was already reading pull 9. The cause is tea's commit
   order: it sets the state, saves it, then waits for that Msg's Cmds to
   answer, and only then tells its listeners. So a watcher hears of a new
   state only once its Cmds are done. For the first Msg, that Cmd is the
   GitHub read, so the line says `not started` for the whole read. The
   phases built for the person to see (`reading the pull request`) are the
   ones they never see.
2. **A Listen whose stream fails stops the whole run, and says nothing.**
   While writing the tsh test, a helper's stream failed. tea put the run
   into draining (`stopOnSubFailure`), every later Msg was dropped, and the
   copy's line froze on `waiting on checks` forever. No error reached tsh or
   the test. The same helper does the same on `main` without this change.
   A status line made it visible; without one it would have been a hang.
3. **A program that runs no machine has no rows.** `ship --mode read` keeps
   nothing, so in a pipe its stage shows no row at all, even while it works.
   That is honest to the rule, but a person reading `jobs` sees only the
   review half of the pipe.
4. **A `not started` row is real, but tells the person little.** It shows
   for the copy that is booted and waiting for its first Msg to settle.
   With finding 1, it is what a person sees first on nearly every job.

## Recs

1. **Keep `status` required for each machine** (85%). Why: it follows
   Elm's required `view`, and a forgotten line hides the copy a person
   needs. Cost: one more field per program, and every new machine needs a
   line. Owner: tea-program.
2. **Ask tea to tell listeners when the state is set, not after its Cmds
   answer** (70%). Why: finding 1. The line, the trace tag and anything else
   that watches a run lag by one Cmd, and the in-between phases go unseen.
   Cost: a change in `@demlik/tea`'s commit. Listeners that today assume
   "the Cmds of this Msg are done" would break, and I did not check which
   ones do. A second hook (`onState`) would avoid that, at the price of two
   hooks that look alike. Owner: `@demlik/tea`.
3. **Make a failed Listen say so** (80%). Why: finding 2. A frozen line with
   no error is the worst case for a person reading `jobs`. Cost: tea-program
   must read the run's end cause and print it, or tea must fail `done()`
   instead of draining quietly. Owner: tea-program first, `@demlik/tea` if
   the cause is not visible from outside.
4. **Keep 5 ended copies per machine, and revisit once operate runs many
   tickets** (60%). Why: it keeps a stuck copy in view on a normal job.
   The doubt: on a long job a stuck copy can fold behind 5 newer ended ones.
   That bends the "never hidden" rule. Never folding a stuck copy would
   need the line to say it is stuck (`{line, stuck}`), which changes the
   agreed `(state) => string` shape. Owner: tsh, and the person who set the
   shape.
5. **Keep the `tea.status` tag** (70%). Why: a trace reader sees in the
   span list where each copy stands, in the same words as `jobs`. The doubt:
   spans carry "names, tags and ids, never values". A line is words the
   program wrote about its own state, and holds only refs already tagged
   elsewhere, but a careless line could put a value on a span. Owner:
   tea-program.

## Holes

| Hole | Owner |
|---|---|
| A detached job (run by another tsh) shows no lines. The copies live in that process's memory. | tsh |
| Ended copies stay in memory until the run ends. A long operate run grows by one copy per round, review and ship. | tea-program |
| After a kill and attach, copies that ended in the earlier life do not come back. Only copies that run again show. | tea-program |
| No real program runs two copies of one machine at once yet. The side-by-side case is proved on a toy (`pair()`) and through tsh's recorded review. | tea-fabrika's stages |
| A stuck copy can fold behind 5 newer ended ones (rec 4). | tsh |
| The line lags one Cmd (finding 1). | `@demlik/tea` |
| Experiment 75 proposes reshaping how machines run (`machines.<kind>.get(id)`). Copies are keyed by the same id, so they should carry over, but that is not tested. | tea-program |

## Not done

- A live run with a real agent. Nothing here changes what an agent does, so
  the scripted runs and recorded GitHub cover the change.
- Lines that come back for ended copies after an attach. It needs the run's
  record to list ended copies too.

## Where Node is used

- `src/tsh/status-attach.test.ts`: `node:child_process` `spawn` (it must
  send `SIGKILL` to a real tsh), `node:fs` and `node:os` for its home folder
  and the build log, as `src/tsh/kill.test.ts` does. Test harness only.
- Everything else in this change is Effect: `SubscriptionRef`,
  `Stream.changesWith`, `Deferred`, the storage handle.
