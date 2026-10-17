# 67. tsh: a shell that is itself a tea program

```text
$ bin/tsh
tsh$ seq --to 3 | double
2
4
6
tsh$ seq --to 3 | upper
tsh: does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started
  seq --to 3 | upper
             ^
tsh$ sqe --to 3
tsh: no program named sqe. Did you mean seq?
  sqe --to 3
  ^
tsh$ tally &
[1] tally:4be0c2d1
tsh$ tell %1 add 2
[1] 2
tsh$ review-scripted --rubrics r --model opus --effort medium --budget 1 pr=https://github.com/kamp-us/demlik/pull/597 | ship --mode read
review-scripted verdict #597  done  head 9eb6b52c75d6…  criteria 9  verdicts 2  comments 2  ran (0)  runs 1
ship found #597  facts (open, closes_it, not_needed, passed, green, clean)  wouldSend ship_enqueue
tsh$ ^D
$ bin/tsh -c 'false' && echo ok || echo no
tsh: false failed: false always fails
no
```

The question: can a shell be one more tea program? Lines in on an input,
lines out on an output, its job table a machine, and every command a typed
program started by name.

**Answer: yes.** tsh is `defineProgram` with two inputs (`line`, `signal`),
two outputs (`printed`, `ready`), one flag (`show`) and one machine (`jobs`).
It starts programs from a list by name, checks every flag, value and pipe
against the programs' own schemas before anything runs, and keeps its job
table on a shelf, so a killed tsh opened again finds its jobs and can start
one again by run id. A thin launcher puts it on a terminal with Node's
readline. All 9 proofs pass. `@demlik/tea` did not change. tea-program got
one new function, `call`.

About 75% sure the shape is right for a shell a person uses. The doubts are in
[Findings](#findings): an input's close outlives the run that closed it, so a
session program cannot be restarted under its own id; the fit check passes
pipes that fail at run time; and fabrika's programs need four flags on every
line.

## What was asked, and what was built

Asked: a shell that is itself a tea program. `main` reads each line and
starts, tells, pipes, closes, stops or lists programs. A program list holds
ship, review and small programs. Parsing goes from shell words to a small
fixed grammar to each program's own schemas, with a position and a
did-you-mean on every error. A launcher on Node's readline, with completion
from the pure parser. Nine proofs, each tested. A real fabrika check, read
only.

Built, in `src/tsh/`:

- **`words.ts`, `grammar.ts`**: shell words (quotes, escapes, `$( )`,
  comments), then the grammar: statements parted by `;`, `&`, `&&`, `||`;
  pipelines; `--flag value`, `input=value`, `>output`, `<input`,
  `--describe [name]`. Pure. A refusal has a position.
- **`check.ts`, `decode.ts`, `did-you-mean.ts`**: the line against the
  program list. A program, flag, input or output name that does not exist is
  refused with a did-you-mean (edit distance, two swapped letters count as
  one). A value is read as raw text first, then as JSON, and checked against
  the schema. A pipe runs the fit check. Nothing starts until the whole line
  passes.
- **`execute.ts`, `jobs.ts`, `builtins.ts`**: running a checked line. One
  program in the foreground is a `call`. A pipe, or `&`, is `start` and
  `pipe` and becomes a job. `$( )` is a line run first whose values go into
  the line. Built-ins: `jobs`, `ps`, `tell`, `close`, `stop`, `attach`,
  `programs`, `help`, `exit`.
- **`shell.ts`**: the program itself.
- **`small.ts`, `fabrika.ts`**: the programs. `say`, `seq`, `double`,
  `upper`, `sleep`, `true`, `false`, `tally` (keeps a running total on the
  shelf). `ship` in read mode only, `review-scripted`, and `review` with a
  live agent when a clone is given.
- **`complete.ts`, `search.ts`, `short.ts`**: pure pieces for the terminal:
  Tab completion, Ctrl-R search, and the short line a value is printed as.
- **`main.ts`, `launch.ts`, `bin/tsh`**: the launcher. A terminal session,
  `-c`, a script file, or stdin. `--json` prints each value whole.

## How a line runs

```text
seq --to 3                     call(seq, {to: 3}): start, close its inputs, wait, print each value
seq --to 3 | double            start double, pipe seq into it, close what no pipe feeds, wait for both
tally &                        start, keep its inputs open, print [1] tally:…, prompt back
double n=$(seq --to 2)         run the $( ) first, then tell double what it sent
ship --describe                the declaration, one short row per flag, input and output
ship --describe found          one output whole, many lines
false && say --text no         && and || chain on the status, as in sh
```

The exit status: 0 ended, 1 failed, 130 stopped, 2 refused, 127 no such
program. A pipe's status is its last non-zero one (pipefail, always on). The
last line's status is tsh's exit status.

## The 9 proofs

| # | Proof | Result | How it was checked |
|---|---|---|---|
| 1 | A terminal session: prompt, history, editing, Ctrl-R | pass | `pty/session.exp` through `expect` on a real pty: up arrow brings back the last line; Ctrl-R `hel` finds `say --text hello`, Enter runs it. History kept in the home across sessions. |
| 2 | Tab completes names, flags and values from the schemas | pass | `session.exp`: `se`→`seq`, `--t`→`--to`, `review-scripted --eff`→`--effort`, `me`→`medium` (from the flag's literals). `complete.test.ts`: 25 cases, built-ins and job refs too. |
| 3 | Ctrl-C stops the foreground job through `stop`, tsh goes on | pass | `session.exp`: `sleep --ms 60000`, Ctrl-C, `[stopped]`, next line runs. Idle Ctrl-C drops the typed line. `shell.test.ts`: also on an attached job. |
| 4 | Ctrl-D closes `line`, tsh exits | pass | `session.exp` waits for the end and reads the exit status. |
| 5 | `tsh -c`, `tsh script.tsh`, `echo … \| tsh` | pass | `pty.test.ts` runs all three from `sh`. |
| 6 | Exit status follows the last program | pass | `pty.test.ts`: 8 lines and their statuses; `zsh -c 'tsh -c "false" && echo ok \|\| echo no'` prints `no`. |
| 7 | Kill tsh, reopen: jobs still there, reattach by run id | pass | `pty/kept.exp`: `tally &`, totals 2 and 5, `kill -9`, reopen, the note, `jobs` shows it detached, `attach <run id> &`, `tell %1 add 1` says 6. |
| 8 | A typed pipe that does not fit is refused before anything runs | pass | `seq \| upper` and `seq \| ship` refused with a caret, status 2, nothing started; on the recorded GitHub, zero reads. But see the fit hole below. |
| 9 | A real fabrika check, read only, plus `--describe` | pass | `67-tsh-real.ts`: `review-scripted … \| ship --mode read` on 597, 596, 675; `--describe` on both. Below. |

## The real check

`node experiments/67-tsh-real.ts`, read only, on kamp-us/demlik pull requests
597, 596 and 675. The reviewer is scripted (it passes every criterion without
reading code), so this proves the wiring and the reads, not a review. No
model ran. The accounts ship treats as the repo's own were read from the pull
requests' authors at run time, and the script refuses to save a result that
names one. Results in `results/67-tsh.json`.

- `review-scripted … | ship --mode read`: status 0, about 8 seconds. 597 and
  596 passed review and reached ship, which read them open, green, reviewed
  and clean, and said it would send `ship_enqueue`. 675 is a draft: review
  skipped it and sent nothing on to ship.
- `ship --mode write …`: refused at the flag, status 2. `--mode` takes `read`
  alone in tsh, and ship's write side there is `noWrites`.
- `seq --to 3 | ship --mode read`: refused before anything ran, status 2.
- `say --text hello | ship --mode read`: wired, ran, failed, status 1. This is
  the fit hole.
- `ship --describe` is 12 short lines; `ship --describe found` prints that
  one output whole, 88 lines.

## The tea-program change: `call`

```ts
const called = yield* call(seq, {to: 3}, {told: {}, listeners, stopOn: ctrlC, keeping});
// {kind: "called", ended, heard: [{name: "n", value: 1}, ...]} | {kind: "bad_shape", name, why}
```

New: `call`, and its types `Heard`, `Told`, `Called`, `CallOptions`. Nothing
renamed. `call` checks every told value, starts the program, tells the
values, closes every input, and waits. `stopOn` stops the run with the
starter's `stop` when it finishes first; tsh hands it Ctrl-C. `keeping` is
required by type exactly as `start` requires it. 6 new tests in
`src/program/program.test.ts`. `docs/direction/tea-program.md` now lists it.

tsh uses `call` for its stop, close and wait, and prints through
`listeners`, because a long run must print as it goes. It never reads
`heard`. `heard` is for code that calls a program and wants its values
after; for a long-running call it grows until the end.

## Effect's CLI: not used

Effect has a CLI module. tsh does not use it, for four reasons:

- It parses one argv against a fixed tree of commands. A tsh line has pipes,
  `&`, `&&`, `$( )` and many commands; its commands come from a program list
  known only at run time.
- Its errors have no character position, so there is no caret.
- Its completion writes a script for bash or zsh to load. tsh completes
  inside its own readline, from the same parser that runs the line.
- Its runner needs `@effect/platform-node`, which is not installed here.

What tsh does take from Effect: each program's flags and inputs are Effect
Schemas, and the value checks, did-you-mean on literals, completion of
literal values and `--describe` all read them.

## Node primitives tsh uses

The owner's direction: use Effect's own modules where they exist. Two were
cheap and moved: run ids now come from Effect's `Random`, not
`node:crypto`. The rest stayed, for the reasons below.

| Node primitive | Where | Effect equivalent | Why it stayed Node |
|---|---|---|---|
| `node:readline` | `main.ts` | `Terminal.readLine` and `readInput` (raw keys) | Effect's Terminal has no line editing, history or completion. readline has all three. |
| `node:stream` `PassThrough` | `main.ts` | `Stream` | It sits between raw stdin and readline, which reads a Node stream. Goes when readline goes. |
| `node:fs` (history, lock, script file, home) | `main.ts` | `FileSystem` | Its Node layer is in `@effect/platform-node`, not installed. The shelf moves to `FileSystem` in the next change. |
| `node:path` `join` | `main.ts`, `launch.ts` | `Path` (core has a POSIX layer) | `homeOf` is a pure function; making it an Effect for one join is not worth it alone. Moves with `FileSystem`. |
| `node:os` `homedir` | `main.ts` | none | No Effect equivalent. |
| `process.stdin.setRawMode`, `process.stdout.write` | `main.ts` | `Terminal.display`, `readInput` | Tied to readline. |
| `process.on("SIGINT")` | `main.ts` | none in core | In `-c` mode Ctrl-C is turned into a tell on `signal`; Effect's runner only interrupts. |
| `process.kill(pid, 0)` | `main.ts` | none | Asks whether the lock's holder is alive. |
| `node:child_process` | `pty.test.ts`, `67-tsh-real.ts` | `ChildProcess` (needs a platform layer) | Test and experiment code only. |

`main.ts` is the one file that touches the terminal. The programs, the
grammar, the checker, the runner and the completer use no Node module.

## Do one-liners feel heavy as whole programs?

Small ones, no. `upper` is a name, a description, one input, one output and a
two-line `main`: 8 lines, and every line is used by `--describe`, Tab and the
fit check. `true` is 7 lines. That buys a lot: `seq | upper` is refused before
anything runs, and `upper --describe` says what it takes.

fabrika's programs, yes. Flags have no defaults, so every review line carries
`--rubrics --model --effort --budget`. A person would write a script, or an
alias, for that. Defaults belong in the flag declaration; that is a
tea-program change and was not made here.

## Findings

1. **An input's close outlives the run.** The shelf keeps a closed input
   closed, as experiment 66 needs for a program that resumes. So tsh, started
   again under its last id, is born with `line` closed by the last Ctrl-D, and
   ends at once. tsh takes a fresh run id each time and keeps its job table
   at a fixed place on the shelf, through its own `JobShelf` service, not
   `keep`. It still has to be given a `keeping` it does not use, because it
   declares a machine. tea-program has no word for a session: a run whose
   inputs belong to one life.
2. **The fit hole.** Effect's JSON Schema drops patterns, so any string fits
   ship's pull request url. `say | ship` is wired, runs, and fails at the
   first value, status 1. The fit check is only as good as the JSON Schema.
   Already known from experiment 62; tsh makes it a thing a person hits.
3. **Printed values were walls of JSON.** Fixed: each value is one short line
   read from the value alone (`#597  done  criteria 9`), and `--json` prints
   it whole. The short line is a guess from field names; `ran (0)` shows
   where it guesses wrong. A program knows best how its value reads.
4. **readline has no Ctrl-R.** tsh filters raw keys before readline and runs
   a pure search. A Tab inside a chunk of several keys is pasted text to
   readline, not completion.
5. **Flags have no defaults.** See above.
6. **What a killed tsh loses.** Values told and not yet read. A detached job
   started again begins from what its machines kept; one with no machine
   starts over. Jobs die with tsh and wait, detached, to be attached.
7. **One tsh per home.** Two would run the jobs of one table. A lock file
   with the holder's pid refuses the second; a stale lock is taken over.
8. **`&` cannot be part of a chain.** `a & && b` is refused; sh allows odd
   forms here, and tsh does not.
9. **The startup note** about jobs from an earlier tsh comes after the first
   prompt is drawn, so it is drawn above it.
10. **Ship read mode on real pull requests** is right but early: in an
    earlier run the same day `mergeable` was still unknown, and ship said
    `stuck:merge_unknown`. On the saved run it was clean.

## Recommendations

- **Add a declared `show` to an output, optional** (Elm's `view`: the value
  stays data, the program says how a person reads it). The generic short line
  stays the fallback. About 75%. Cost: one more field per output and one
  more thing to keep in step with the schema. Gain: ship and review print
  what matters, not what the field names suggest.
- **Give flags defaults in the declaration.** About 80%. Cost: a default is a
  value the starter did not choose, so `--describe` must show it. Gain:
  review lines lose four flags.
- **Name a session input in tea-program**: an input whose close is kept for
  this life only, so a shell or a REPL can be restarted under its own id and
  keep its machines with `keep`. About 60%: tsh works around it today with a
  fresh id, and one more program like it would show whether the word is
  needed.
- **Close the fit hole at the source**: check fit on the Schemas, or carry
  patterns in the JSON Schema, not on what Effect writes today. About 70%.
  Until then the fit check refuses only what differs in type.
- **Keep `call` as it is.** About 85%. It is small, it reuses `begin`, and
  tsh, tests and `$( )` all fit it.

## Tests

- `src/program/program.test.ts`: 30 (6 new, for `call`).
- `src/tsh/parse.test.ts` 26, `check.test.ts` 25, `complete.test.ts` 25,
  `short.test.ts` 6, `shell.test.ts` 10, `pty.test.ts` 13.
- `pty.test.ts` drives the real launcher on a pty through `expect`
  (`src/tsh/pty/*.exp`), and from `sh` and `zsh`. It skips where `expect` is
  not installed.

## What this cannot tell us

- **Whether a person likes it.** The terminal checks are scripts. Nobody used
  tsh for a day.
- **A live review.** `review` with a live agent is listed when a clone is
  given and was not run through tsh. The real check used the scripted
  reviewer.
- **Any write.** tsh cannot write to GitHub, by the flag's shape and by its
  write side. Whether a write mode belongs in a shell at all is not decided.
- **Many jobs at once, or long ones.** The longest job ran for seconds. A
  table with hundreds of jobs, or a job that runs for days, was not tried.
- **Other terminals.** A macOS pty through `expect` only. Not a real
  terminal app, not Linux, not Windows, not tmux.
