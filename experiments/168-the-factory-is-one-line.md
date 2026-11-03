# 168. The factory is one tsh line: which loop shape lets review send a ticket back?

The question: a stage can answer `send`. Review says `send:build:checks_red`
and the ticket goes back to build. A tsh pipe only flows one way. Which loop
shape lets that `send` work on one line, reads well, and runs on our
primitives? And can an agent write the line from the help text alone?

**Decided 2026-10-29, after this ran: the factory does not become one line.**
This was an exploration, never a plan to change the pipeline. The factory
stays one thin coordinator program around the stage programs, the Elm parent.
What the experiment gave us is the other half: every stage is a program that
runs alone and pipes, so a person can run one part again by hand, such as
`build --ticket 7 | review`, and watch it. The answer below is what the
experiment found if the factory were a line; it is kept as it was.

**Answer: send it back through the tracker. The line stays exactly the
factory, with no new syntax, and the loop lives in the ledger, not on the line.**

```sh
tsh$ tracker | triage | plan | build | review | ship &
# review says send:build:checks_red  ->  a fact on the ledger
# tracker hands #7 out again         ->  triage and plan read the ledger: "already done: passed on", no agent
# build runs #7 again, review passes, ship ships
```

- **All four shapes ran end to end** on the whole line: #7 shipped after one
  send back, #8 was skipped, #9 got stuck. 11 fake agent runs each.
- **Named pipes and a wire back (`review ^build`) hang** on a line typed by
  hand: the loop's pipe keeps build's input open, so the line never ends and
  needs Ctrl-C. Make the pipe not hold build open and the ticket is lost
  instead. This is Kahn's old result for process networks: with a cycle in it,
  there is no right moment to close.
- **A parent program (`build-review`) works by hand and on the line**, but it
  hides its children from `jobs` and from a map, and needs one hand-written
  parent per loop.
- **Through the tracker works on the line, and by hand it does one lap.** By
  hand, `build --ticket 7 | review | ship` ends after review sends #7 back; a
  second line ships it. That is the honest split: the whole line is the
  factory, a line by hand is how you watch it and poke at it.
- **An agent wrote the line right 24 of 24 times.** GPT sol through Codex, from
  `programs` and each program's `--describe`, on 8 tasks, 3 tries each. It
  also said "no line" all 3 times to a job no program here does.
- **Confidence: 70%** that through the tracker is the loop shape to build on.
  The doubts are below; the biggest is two lines running at once.
- **Cost: $0.** The factory's agents are fake. Codex ran on the ChatGPT plan,
  which gives no price: 225k input tokens, 1.4k output, 24 turns.

## Who did what

- **All of it was this repo's code.** tsh, the program model and the agent
  service are `@kampus/fabrika`. The stage programs, the tracker stand-in, the
  fake agents and the ledger stand-in are this experiment's, in
  `lib/factory-line.ts`. Today's fabrika did nothing here: no ticket, no lane,
  no agent of its.
- **The fake agents:** each stage run hands back a scripted outcome in the five
  verbs, keyed by stage and ticket. No model, no network, no key.
- **Part B's agent:** GPT sol (`gpt-6.1-sol`, effort medium) through this
  repo's Codex adapter, as experiments 159 to 162 ran it, with
  `OPENAI_API_KEY`, `CODEX_API_KEY` and `TYPESAFE_API_KEY` unset. Each turn had
  a new session, an empty folder and our own system prompt in place of
  Codex's. Each turn's Codex home and folder were removed after.
- **No package code changed.** The root `package.json` gained five workspace
  programs (`counter`, `map`, `ticket`, `trace`, `tracker`) so the script can
  list them the way the app does.

## How it was run

Each shape is a real tsh session in this process, with its own program list,
on one shared fake ledger. Every stage reads the ticket's facts first, so a
stage run twice on the same ticket does not run its agent twice:

```ts
// lib/factory-line.ts: what a stage does with a ticket it is handed.
export function lookOf(facts: readonly Fact[], stage: Stage, ticket: number): Look {
	// its last word is done, or an ask answered approve  -> "pass": pass it on, no agent
	// an ask with no answer                              -> "wait"
	// skip, stuck, or an ask answered no                 -> "stop"
	// no word yet, or a later send to this stage         -> "run": run the agent
}
```

The script for ticket #7: triage done; plan asks for approval, and the test
answers yes with `tell <plan's run> answer '{"ticket":7,"pick":"approve"}'`;
build done; review `send:build:checks_red`; build done; review done; ship
done. #8: triage `skip:declined`. #9: build `stuck:cannot_meet`.

Each shape was tried three ways:

- **The whole line**, started with `&`, from the tracker to ship.
- **Ctrl-C** while build works on #7's second lap, then the same line again.
- **One ticket by hand**, in the foreground, starting after plan.

## The four shapes

```sh
# 1. A named pipe, as mkfifo makes one. Review writes to it, build reads from it.
mkfifo --name redo; tracker | triage | plan | build --from redo | review --to redo | ship

# 2. A wire back, written on the line. Done here as sugar: the script rewrites it to shape 1
#    with a pipe of the line's own. tsh's grammar has no ^ today.
tracker | triage | plan | build | review ^build | ship

# 3. The loop inside one program: a parent that calls build, then review, and again on a send.
tracker | triage | plan | build-review | ship

# 4. Through the tracker, like a retry topic: review's send is a fact, the tracker hands the
#    ticket out again, and every stage reads fresh.
tracker | triage | plan | build | review | ship
```

Shape 2 came in two kinds, after Unix's own rule. In 2, the back pipe counts
review as a writer, so build's input stays open while review runs. In 2b it
does not, so build's input closes when plan's side ends.

## What came back

| Shape | Whole line, characters | Ends by itself by hand? | #7 shipped by hand? | What `jobs` shows | What a map can draw from the job alone |
|---|---|---|---|---|---|
| 1 named pipe | 89, 2 statements | No, Ctrl-C (130) | Yes | The line with `--from redo`, `--to redo`, one row per ticket a stage handled | The back edge, but only by knowing the from/to flag rule |
| 2 wire back | 54 | No, Ctrl-C (130) | Yes | The rewritten line (`--from loop-1`), not what was typed | Same as 1 |
| 2b wire back, not a writer | 54 | Yes (0) | **No: dropped** | Same as 2 | Same as 1 |
| 3 parent | 45 | Yes (0) | Yes | `build-review #7 lap 2: passed review, passed on`; no row for build or review | No back edge, no build or review box |
| 4 through the tracker | 47 | Yes (0), after one lap | No; a second line ships it | `#7 already done: passed on` in triage and plan | No back edge; one send fact on the ledger |

- **The whole line is the same in all shapes.** 11 agent runs:
  `triage#7 triage#8 triage#9 plan#7 plan#9 build#9 build#7 review#7 build#7
  review#7 ship#7`. #9's build ran before #7's because #7 waited on its ask.
- **Ctrl-C is the same in all shapes.** Status 130, every stage printed
  `stopped`, and the job left the table: `jobs` was empty after. Typing the
  same line again finished #7 with only `build#7 review#7 ship#7`. That comes
  from the ledger and reading fresh, not from the loop shape.
- **Shape 1's pipe outlives the job.** `redo` is a name every line on that tsh
  sees. A second factory line that also says `--from redo` reads the first
  one's sends.
- **Shape 2b loses the ticket without a word.** The line ended with status 0,
  and #7 sat after review with nothing to read the send. The harness counted
  it as `dropped [{"ticket":7,"fifo":"loop-8"}]`; tsh printed nothing about it.
- **Shape 4 by hand** typed `plan --ticket 7 | build | review | ship`: build
  and review ran, review sent #7 back, and the line ended, since no tracker was
  on it to hand #7 out again. Then `build --ticket 7 | review | ship` (32
  characters) ran build, review and ship, and #7 shipped.

## Why the pipe shapes hang

A Unix pipe ends when its last writer closes. In a loop, build is a writer
upstream of review, and review is a writer into build: each waits for the
other to close first. Kahn's process networks have the same problem: a
network ends when every process is blocked on a read, and from inside nobody
can tell "blocked for good" from "slow". So a cycle gives one of two bugs:

- **The pipe holds build open (shapes 1 and 2).** The line never ends. Every
  ticket gets there, but a line by hand needs Ctrl-C.
- **The pipe does not hold build open (2b).** The line ends, and a ticket that
  is sent back after build's input closed is lost.

The industry mostly agrees that a pipeline is a one-way thing:

- McIlroy's 1964 memo asks for programs joined "like garden hose", one way
  ([memo](https://doc.cat-v.org/unix/pipes/)). Unix users still use pipelines
  "strictly linearly" ([TUHS, 2024](https://www.tuhs.org/pipermail/tuhs/2024-December/031120.html)).
- POSIX `mkfifo` makes named pipes, which is how a shell gets a pipeline that
  is not a straight line ([mkfifo](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/mkfifo.html)).
  Bash's `coproc` gives "a two-way pipe" between the shell and one process
  ([bash manual](https://www.gnu.org/software/bash/manual/html_node/Coprocesses.html)),
  not between two stages.
- Apache Beam: "the best way to think of your pipeline is as a directed
  acyclic graph" ([guide](https://beam.apache.org/documentation/programming-guide/)).
  Flink had loops in a stream (`iterate`, `closeWith`), deprecated them in 1.19
  and removed them in 2.0 ([FLIP-357](https://cwiki.apache.org/confluence/display/FLINK/FLIP-357%3A+Deprecate+Iteration+API+of+DataStream)).
- Node-RED's retry recipe does draw the wire back: Catch, then Delay, then back
  into the node that failed ([cookbook](https://cookbook.nodered.org/basic/retry-on-error)).
  It is a long-running flow that never ends, which is shape 1's "never ends".
- Erlang sends to a process by a registered name, with `!`, and the send is
  asynchronous ([processes](https://www.erlang.org/doc/system/ref_man_processes.html)).
  That is a `send` that names its target, which is what the stages' words
  already do.
- Kafka users retry by writing the message to a retry topic, which a reader
  takes up again ([Uber](https://www.uber.com/blog/reliable-reprocessing/)).
  Shape 4 is that: the ledger is the topic, the tracker is the reader.

## The Elm answer

Elm's answer to "a child needs another child to act" is the parent: the child
returns what happened, and the parent's `update` steps the other child. Shape
3 is that answer, word for word. Shape 4 is Elm too, one level up: the ledger
is the model, the tracker is a Sub on it, and each stage reads the model
before it acts. Neither needs a loop in the pipe.

## Part B: can an agent write the line?

The agent got the help text as tsh prints it: `programs`, then
`<program> --describe` for each, from the list a tile's tsh has
(`apps/fabrika/src/tsh.ts`) plus shape 4's factory. That is
`results/168-help.txt`, 10,184 characters, about 2,500 tokens. The file is an
input: rebuild it with `STEP=help HELP_FLAG=--help` once programs answer
`--help` (ticket 82), and run the agent step again.

Each answer was parsed and checked by tsh's own `parse` and `check`, compared
to the right lines by programs, flags and values, and, when it used only the
factory, run on the fake factory for 1.5 s and then given Ctrl-C.

```ts
const Reply = Schema.Struct({line: Schema.String, why: Schema.String});
// "Answer with the one tsh line that does it, in `line` ... If these programs cannot do it,
// leave `line` empty and say why in `why`."
```

### Real: GPT sol through Codex

| Task | Line it wrote, all 3 tries | Right? |
|---|---|---|
| Show me ticket 7, and the trace of its plan run | `ticket --ticket 7 & trace --ticket 7` | 3 of 3 |
| Run just build and review on ticket 7 | `build --ticket 7 \| review` | 3 of 3 |
| Run the whole factory on every open ticket | `tracker \| triage \| plan \| build \| review \| ship` | 3 of 3 |
| Triage ticket 8 only, do not plan or build it | `triage --ticket 8` | 3 of 3 |
| Plan ticket 7, build it if approved, stop there | `plan --ticket 7 \| build` | 3 of 3 |
| Run the factory but do not ship anything | `tracker \| triage \| plan \| build \| review` | 3 of 3 |
| Merge pull request 12 by hand, now | no line: "ship takes a ticket number, not a pull request number" | 3 of 3 |
| Ticket 7 failed review; build, review, ship once it passes | `build --ticket 7 \| review \| ship` | 3 of 3 |

- **24 of 24 right, the same line in all 3 tries of each task.** No flag was
  wrong, no program made up, no tool run. Median 4.9 s a turn on the first
  five tasks, 6.2 s on the last three. About 9,400 input tokens a turn.
- **The first five came back all right, so three harder ones were added**
  before seeing any answer to them: a stage left off, a job nothing here does,
  and the loop. They came back all right too.
- **The loop task shows shape 4's limit, not the agent's.** "Ship it once
  review passes" got `build --ticket 7 | review | ship`. On the fake factory,
  review sent #7 back again, and the line ended with #7 not shipped. The line
  is right for one lap; nothing on a hand line goes round twice.
- **It never wrote `^build` or a named pipe.** Nothing in the help text offers
  either, so this does not tell us whether it would use one well.

### Scripted: a stand-in, NOT an agent

The stand-in hands back fixed lines, some wrong on purpose, to show the
harness tells right from wrong. Its numbers say nothing about any agent.

- **10 of 24 right, 19 parse, 17 pass tsh's check.** What tsh caught before
  anything ran: `trace --ticket 7 --run plan` ("trace has no flag --run"),
  `ticket 7 | trace` (not `--flag value`), `triage --ticket #8`,
  `review ^build` (no such syntax), `ship --pr 12`.
- **What tsh let through and was still wrong:** `ship --ticket 12` passed the
  check and ran ship on a ticket nobody filed. tsh checks shapes, not the
  ledger. `triage --ticket 8 | plan` and `review --ticket 7 | build | ship`
  ran too. The right-answer compare caught them; tsh did not.

## Recommendation

**Not taken (2026-10-29).** The factory stays a hand-written coordinator
program, shape 3 grown to all stages, with its children listed as jobs under
it, the way Temporal lists a parent's child workflows. One parent for the
whole factory also removes this section's "one parent per loop" cost. The
recommendation below stays as written, marked wrong for the factory; it still
holds for a line typed by hand.

**Build the factory line as shape 4: through the tracker.** Confidence 70%.

- **Why:** the line is the factory as people draw it, with no new syntax, so
  `programs` and `--describe` are enough to write it (24 of 24). Any stage may
  send to any earlier one with no change to the line: ship sending to build is
  the same as review sending to build. It rides on what each stage must do
  anyway, read fresh, so Ctrl-C and a start again come for free. It is how
  Kafka users retry, and Elm's model plus a Sub.
- **What it costs:** the real `tracker` program has no ticket output yet; it
  needs one that hands out open tickets and listens for sends. Every stage
  must read fresh and pass on what is done, as these fakes do. A ticket sent
  back walks through triage and plan again, without an agent (two `already
  done` rows in `jobs`). A map cannot draw the back edge from the job; it
  must read the ledger's sends, or the stages' declared words (`SENDS`).
- **Keep the hand-written parent (shape 3) for one case:** a line by hand that
  must loop until done, with a lap limit. It is the Elm answer and it worked
  everywhere, but each loop pair needs its own parent and hides its children.
- **Drop named pipes and the wire back.** They hang or lose a ticket by hand,
  and the industry left loops in pipes too (Flink 2.0, Beam's DAG).

The doubts, and what would settle each:

- **Two lines at once.** Two factory lines, or two tsh on one ledger, would
  each hand #7 out again after a send, and build would run twice. This needs a
  claim on the ledger, one tracker per ledger, or both. Not tested. A run with
  two lines on one fake ledger would show it.
- **No lap limit.** A review that always sends back loops forever. A stage
  reading fresh could stop after N sends, as a fact the stage owns. Not tested.
- **One fixture ticket.** The fake stages are small. A real stage that does
  not read fresh breaks shape 4 at once, and only shape 4.

## What it cannot tell us

- **Fake agents, a fake ledger, one process.** Real stages take minutes; a
  real ledger is a Durable Object with other writers. The timings here mean
  nothing, and races with real writers were not tried.
- **Shape 2 was sugar, not tsh.** tsh's grammar has no `^`. The test rewrote it
  to shape 1 before tsh saw it, so the 54 characters and the `jobs` text are
  of a feature that does not exist.
- **Part B is easy tasks on a small list.** 8 tasks, 3 tries, one model, one
  effort, and the factory's help text written by the same hands as the tasks.
  All 24 tries agreed, so 3 tries said little about spread. Harder asks (a
  `tell` to a run id, an answer by its `do=` input, the map's flags) and
  `--help` text from ticket 82 are next.
- **No person typed these lines.** The character counts are for the line
  only, not for finding the run id to `tell`, which took a `jobs` first.
- **A map was not drawn.** "What a map could draw" is read from the job record
  by this script, not from `programs/map`.

## Notes

- **`trace` here is today's `runs`.** This ran before pull request 172, which
  renamed the ticket-runs view to `runs` and gave the name `trace` to a new
  program that shows one job's trace. The tasks, the help text and the results
  say `trace --ticket 7`; read that as `runs --ticket 7`. The script still
  imports `@tea-fabrika/trace`, so `STEP=help` or `STEP=agent` run again today
  would list the new `trace`: change it to `runs` first.
- **`lib/triage-codex.ts` does not run any more.** Agent turns now need a
  `system` prompt (v1 slice 2), and it passes none, so experiments 159, 161
  and 162 fail at once with a schema error. This script passes one. Not fixed
  here.
- **A fix found while running:** the first run read shape 4's hand line as
  "shipped" because it read the ledger after the second line. Fixed before
  the numbers above.

## How to run

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY node experiments/168-the-factory-is-one-line.ts              # STEP=shapes: every shape, writes results/168-shapes.json
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=help node experiments/168-the-factory-is-one-line.ts    # HELP_FLAG=--help once ticket 82 lands; HELP_FILE=<path> to write elsewhere
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=agent AGENT=scripted node experiments/168-the-factory-is-one-line.ts
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=agent AGENT=codex node experiments/168-the-factory-is-one-line.ts   # ONLY=<task ids>, TRIES=3; Codex on the ChatGPT plan, about 5 s a turn
```
