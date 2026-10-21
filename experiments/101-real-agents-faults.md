# 101. Real agents behind tea-host, with hosts killed mid-question

The question: experiment 98 put a stub agent behind `packages/tea-host`. Put real
Claude Code agents there instead, and kill their hosts mid-question.

- Does "one right answer per question, never two" still hold?
- How many paid agent runs does a takeover waste?
- Can the new host resume the dead host's Claude session instead of starting over?

**Answer: yes, and partly.**

- One right answer per question held in 4 of 4 runs: 120 of 120 right, 0 answered
  twice, 0 replies from a host that did not hold the lease.
- A takeover wastes about one agent run without resume (1 extra run and 1.5 extra
  turns per takeover).
- With resume it wastes 0.75 extra runs and 0.75 extra turns per takeover: half the
  turns, and about 43% less money.
- Resume works when the dead host had finished a turn. It does not help when the
  kill lands inside the first turn, and it cannot stop a turn that was cut from
  being paid.

Confidence 75%. Spend: about $0.035 in all, haiku.

## The set-up

- **Hosts.** The asker host runs on the Mac. Two answerer hosts run in Docker
  containers (98's image). Each one runs Claude Code (haiku, Agent SDK) for each
  question it owns. Only tea-host's public exports are used. The package is
  unchanged.
- **The agent's job.** Two turns in one session:
  - turn 1: "What is 40 + 75?" (a different sum for each id, so every answer can
    be checked);
  - turn 2: "Check that answer once more. Reply with the final number only."
  - The second turn needs the first turn's context, so a resume has something to
    save.
- **The login.** A Claude Code OAuth token in `CLAUDE_CODE_OAUTH_TOKEN`. The
  containers get it by name (`docker run -e CLAUDE_CODE_OAUTH_TOKEN`). It is never
  on a command line, in a file, in the image or in a log. Every log and the
  results file were checked for it after each run.
- **The ledger.** 98's local Durable Object on the Mac (Miniflare). The hosts
  reach it over HTTP.
- **Settings.** 30 questions a run, one in flight at a time (`WINDOW=1`), lease
  3 s, renewed every 500 ms.

### Two modes

- **fresh** (today's behaviour). A new owner starts every unanswered question
  from scratch.
- **resume.** Each agent run is put on record before it starts, and as it goes:
  - `started`: its session id (a UUID chosen by us), before the run starts. This
    is what ACP's `session/new` hands back before `session/prompt`.
  - `turned`: each turn's result, before the next turn is sent. This is a
    checkpoint.
  - `progress`: the transcript, line by line, through the Agent SDK's
    `SessionStore`. The SDK calls our `append`, and we dispatch it into the
    answerer's own state stream, fenced like every other write.
- In resume mode, a new owner looks at the run on record for the question it is
  about to answer (`planFor`):
  - **recover.** Every turn is done and only the answer's save was lost. Use the
    recorded answer. No agent run.
  - **resume.** Some turns are done and their transcript is on record. Fork that
    session (`resume` + `forkSession` + a new `sessionId`), load it from the
    ledger, and send only the turns still to do.
  - **fresh.** Nothing usable is on record.

### The faults, in each run

- **kill_turn1.** `docker kill` the owner's container 0.6 to 2.4 s after a run
  starts, while turn 1 is in flight.
- **kill_turn2.** `docker kill` it 0.1 to 0.4 s after turn 1's result, while
  turn 2 is in flight.
- **crash.** After q-15's run finishes, its host kills itself (SIGKILL) before
  the answer is saved. This is experiment 98's window, hit on purpose
  (FoundationDB's "buggify").
- **pause.** `docker pause` the owner for 4 s mid-run (longer than the lease),
  then wake it. Another host takes over. The woken host must write nothing that
  is accepted.
- A killed container is started again 300 ms later, so there are always two
  answerer hosts.

## The numbers

| | run 1 fresh | run 2 resume | run 3 fresh | run 4 resume |
|---|---|---|---|---|
| Right answers | 30 of 30 | 30 of 30 | 30 of 30 | 30 of 30 |
| Answered twice / produced twice | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Replies not from the lease holder | 0 | 0 | 0 | 0 |
| Agent runs (per question) | 34 (1.13) | 33 (1.10) | 34 (1.13) | 33 (1.10) |
| How: fresh / resume / recover | 34 / 0 / 0 | 32 / 1 / 1 | 34 / 0 / 0 | 32 / 1 / 1 |
| Turns sent (60 needed) | 66 | 63 | 66 | 63 |
| Takeovers | 4 | 4 | 4 | 4 |
| Extra runs per takeover | 1 | 0.75 | 1 | 0.75 |
| Extra turns per takeover | 1.5 | 0.75 | 1.5 | 0.75 |
| USD, all | $0.00716 | $0.00677 | $0.00704 | $0.00676 |
| USD wasted (past 30 clean questions) | $0.00083 | $0.00044 | $0.00069 | $0.00043 |
| Question latency p50 / p99 | 4.2 / 11.9 s | 3.7 / 8.7 s | 3.8 / 11.9 s | 4.2 / 9.6 s |
| The same, no fault on it | 4.2 / 5.5 s | 3.4 / 6.8 s | 3.8 / 4.8 s | 4.1 / 5.9 s |
| A whole fresh run (2 turns), p50 | 4.2 s | 3.3 s | 3.7 s | 4.1 s |
| The paused host: writes accepted after waking | 0 | 0 | 0 | 0 |

- **USD** is what Claude Code reported (`total_cost_usd`). A turn cut mid-flight
  never reports its cost, so it is counted at the median price of a finished
  turn of the same number. That part is an estimate: about $0.00038 a run.
- **A clean question** costs $0.00021: turn 1 about $0.00017 (it includes Claude
  Code's own title call), turn 2 about $0.000044.
- **"Wasted"** is the spend past 30 clean questions. It is a small number next
  to a noisy one, so read it as a rough size.
- **Latency** is from the asker's first send to the first reply it heard. A
  question hit by a fault takes 6.6 to 8.7 s: about 3 s for the lease to run out
  and be claimed, then a new or resumed run. A recovered one takes about 3 s.

### Fault by fault

| Fault | fresh mode | resume mode |
|---|---|---|
| kill_turn1 | turn 1 cut and paid; a new run (+1 turn) | the same: nothing to resume (+1 turn) |
| kill_turn2 | turn 1 paid, turn 2 cut; a new run (+2 turns, about $0.00021 + the cut turn) | only turn 2 again, forked from the transcript (+1 turn, $0.0000508) |
| crash | a finished, paid run lost; a new run (+2 turns) | recover: the answer on record, no run, $0 |
| pause | the frozen run is lost; a new run (+1 turn) | the same (+1 turn) |

- **Takeover time.** The claim came 2.5 to 3.1 s after each fault (the 3 s
  lease). The new owner's first answer came 6.6 to 8.7 s after the fault in
  fresh mode.
- **Resume (kill_turn2).** The forked run sent only turn 2. It cost $0.0000508,
  against $0.00021 for a fresh redo: 76% less for that question. Turn 2 read 488
  input tokens, the whole history, with no cache hit, since the cache does not
  follow the session to another host. It took 3.4 and 4.5 s, about as long as a
  whole fresh run (3.8 to 4.8 s), because most of the time is Claude Code
  starting up.
- **Recover (crash).** The first answer came 2.7 and 3.1 s after the crash: the
  claim, then nothing to run.
- **The paused host.** It woke, its lease clock stopped its program 131 to
  160 ms later, and its Claude Code run was aborted with it. It finished no turn,
  started no run, and wrote nothing that was accepted.

## The probe: what the SDK's session store does

`probe.ts` runs in one container and checks what the resume relies on, before
any fault.

- **A fresh 2-turn run** writes 13 transcript lines by the end of turn 1 (about
  7 KB) and 20 by the end (about 11 KB).
- **Resume on "another host".** The turn-1 snapshot was loaded into a second
  store, and the run used an empty Claude Code config folder. It worked:
  - `load` was called once, with 13 lines;
  - the answer was right (115);
  - it took 2.3 to 2.6 s and cost $0.0000444, the price of turn 2 alone.
- **The fork copies the history.** The new session id gets the whole history
  appended again under its own key. So a resumed run's own record holds every
  turn, and a second takeover can resume from it. A trial run did exactly that:
  a fork of a fork.
- **An abort is not a refund.** The probe cut a run at 1.2 s, in turn 1. The
  model's reply still landed 0.4 to 0.8 s after the cut, followed by Claude
  Code's cost line. The request was already at the API, and it was paid.
- **Lines land late.** The user line is written 1.0 to 1.7 s after start (Claude
  Code starting up). The assistant line can arrive after the turn's result. So
  the answerer waits for a turn's transcript lines before it records the turn
  as done (up to 3 s).

## Is an agent's work at-least-once by nature?

**Yes.** The record can be exactly-once. The work cannot.

- The fence makes the *record* exactly-once: one accepted answer per question,
  0 doubles in 120.
- The *work* happens outside the fence. A model call that has started will be
  paid, whatever happens to the host. The probe's cut shows it: the reply
  landed after the abort.
- Between "the turn came back" and "the turn is on record" there is always a
  gap. A crash in that gap redoes the turn. Recording sooner makes the gap
  smaller. It never makes it zero.
- This is Temporal's model too. Activities are at-least-once. Heartbeat
  details let a retried activity go on from its last progress. Durable
  execution (Temporal, Restate, DBOS) records each step's result, so a replay
  skips it.
  - Our `turned` and `progress` lines are the heartbeat details.
  - `recover` is the durable-execution skip.

## What makes a side-effecting agent safe?

These agents had no tools, so nothing here was tested with side effects. What
the runs say about it:

- **An idempotency key on every write, from our ledger.** Stripe-style: the
  service keeps the key with the first result and returns that result for a
  repeat.
  - Build the key from the question id and the step: `q-9/turn-2/call-1`.
  - Do not use the model's `tool_use` id. A redone turn gets new ids, and the
    model may word the call differently.
- **A fence check at the service.** The host's fence (Kleppmann's fencing
  token) goes with each write, and the service refuses one older than the last
  it saw.
  - The paused host shows why. It ran for 131 to 160 ms after waking, before
    its lease clock stopped it.
  - A tool call in that window would get past the ledger's fence, because it
    does not go through the ledger.
- **Read-only tools need neither.**
- **A tool with no key and no fence** (sending an email, say) should be put on
  record as `started` before it runs. A new owner that finds it started and not
  done must ask the outside world (or a person) whether it happened, not redo
  it.

## Laws and planted mistakes

The answer machine with a run in flight (`101-real-agents-faults/machine.ts`)
was explored to depth 8: 10,794 states in 0.64 s.

- **The 15 laws hold.**
  - Four from experiment 95: the cursor never goes back; a message behind the
    cursor changes nothing; a new answer counts once; one reply per question.
  - Six on the record: a run in flight is kept until its question is answered;
    an answer forgets its run; the record only grows while a question is in
    flight; transcript lines are recorded once; turns are recorded in order,
    once each; a line for a session not in flight changes nothing.
  - Five on the planner: a recover hands back the last turn of a run that did
    every turn; a resume starts from a run of the same question with a turn done
    and its transcript; such a run is not thrown away; with resume off, every
    plan is fresh; an answered question is never recovered or resumed.
- **All 12 planted mistakes are caught**, for example "recovers from half a
  run", "resumes without a transcript", "resumes another question's run" and
  "turns in any order".

## What went wrong on the way

- **A 1 s lease is too short with real agents.** In a 12-question trial at a
  1 s lease, renewed every 250 ms, Claude Code starting up in the container
  stalled the host for about 0.5 s (525 and 540 ms). Under one stall a host
  lost its own lease mid-run. That made a takeover no fault had caused. The
  chain still held: the new owner resumed, from a fork of a fork. At 3 s and
  500 ms there were none in 4 runs: 16 takeovers, all planned. The price is
  about 3 s of waiting per real takeover.
- **A trial run crashed the harness on a ledger read error** (a transport error
  in a read). Harness reads now retry, and a broken fault plan still gets its run
  judged. 0 read errors in the 4 runs.

## Not in yet

- **Tools and side effects.** The keys and the fence check above are a design,
  not a measurement.
- **Resume inside a turn.** A turn cut in flight is always redone. Only finished
  turns are saved.
- **Big transcripts.** The transcript goes into the ledger's state stream: 7 to
  11 KB a run here. A real session can be megabytes. Past a size it should go
  to blob storage, with only a pointer in the ledger.
- **ACP.** Not tried. ACP's `session/load` needs the agent process to reach the
  session. The SDK's `SessionStore` (alpha) is the hook that makes it reachable
  from another host. An ACP agent would need the same thing on its side.
- **Bigger work.** Here turn 1 is tiny. In real work most of the cost sits in
  the turns before a kill, so resume saves more. But it also re-reads the whole
  history as input on a cold cache.
- **Only one question in flight at a time,** only haiku, and only the crash
  point after a whole run. The gap between a turn's result and its record was
  not hit on purpose.

## How to run it

```bash
node experiments/101-real-agents-faults.ts                 # laws only without REAL=1
REAL=1 node experiments/101-real-agents-faults.ts          # with a Claude Code OAuth token in CLAUDE_CODE_OAUTH_TOKEN
```

- `ONLY=laws|probe|runs`, `MODES=fresh,resume,fresh,resume`, `N=30`,
  `MODEL=haiku`, `BUDGET_USD=3`, `ANSWER_DEPTH=8`, `KEEP_LOGS=<dir>`,
  `KEEP_IMAGE=1`.
- Fault-run knobs: `TTL_MS=3000`, `RENEW_MS=500`, `WINDOW=1`, `STOP_MS=4000`,
  `RESTART_MS=300`.
- About 10 minutes and about $0.03.
- Results: `results/101-real-agents-faults.json`.
