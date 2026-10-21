# 104. The stages as programs on tea-host

The question: can each pipeline stage run as a program on tea-host, survive
kills and takeovers, and never send an outside write twice (step S6)?

- Ship, review, plan and build each run their own machine, unchanged, under a
  registered name (`ship:<pr>`, `review:<k>`, `plan:<k>`, `build:<n>:r<round>`).
- Each agent is a child program, `<name>:agent`, with `limits` on its spec.
  The ledger counts them (experiment 102).
- Every outside write (push, pull request, comment, enqueue, merge, rerun)
  leaves through one gate, with a key made from a ledger id.
- The ledger is the Durable Object in Miniflare. node:sqlite stays the way out.
- Sort is not a machine yet, so it is not here. It is the next stage to move.

**Answer: yes, with scripted agents. With real agents: yes for review and
build. Plan missed the 2-of-3 rule on 3 runs (0 of 3, then 1 of 3). 104c then
ran it 20 times a kill point against 20 controls: a takeover does not change
plan's outcome (p 0.60 at each kill point, 0.32 pooled; tasks and questions
equal in 40 of 40). Plan is noisy by itself: 3 of its 20 controls end
`stuck:unchecked`.**

- Scripted agents, fake GitHub, 20 killed runs per stage: 80 of 80 equal the
  control. 0 doubled outside writes, 0 lost outcomes, 0 writes without a key.
  At most 1 wasted turn per takeover.
- Each stage's host frozen past its lease, then woken: 4 of 4 wrote nothing.
- A child capped at $0.05 ends `limit:usd` and is not started again.
- Both planted mistakes were seen to fail.
- Real agents (haiku, all runs labelled `real`), on the sandbox repository:
  - review: 3 of 3 match the control's rows and outcome, 1 comment per key.
  - build: 2 of 3 match. The third answered with a form that did not read
    (`misfit`, the model's own miss). 1 open pull request per branch; a kill
    after the push: the next holder found the push.
  - plan: 0 of 3 and 1 of 3 outcomes match their controls, over two runs.
    That misses the 2-of-3 rule. The controls themselves split 6 to 1 over 7
    runs (`ask:owner:questions` against `stuck:unchecked`); the 6 killed runs
    split 4 to 2. Tasks and question count match in 6 of 6.
  - plan at 20 runs a kill point (104c): killed runs end `ask` 19 of 20 at
    each kill point, controls 17 of 20. No test comes near p 0.05. The
    takeover is harmless to plan's outcome.
  - At most 1 wasted paid turn per takeover, in every real run.
- The real runs found 4 bugs the scripted runs could not: build's conversation
  id, plan's open stream, plan resumed on another host, and plan answered from
  the wrong conversation. All are fixed.

Confidence 75%. The doubts are under "Holes".

## The gate (S6)

`packages/fabrika/src/pipeline/hosted/idempotency.ts`. One write, in order:

1. **Key.** `<name>#<op>:<subject>`, for example
   `review:1#comment:<pr>@<head>`. Only the gate can make a `Key`: its
   constructor is private and it carries a private brand. A string, or an
   object that looks like one, does not typecheck. A key forged at run time
   (`Object.create(Key.prototype)`) is refused by the adapter.
2. **Done row?** `<name>/writes` holds `done:<key>`: nothing is sent.
3. **Intent row.** `intent:<key>` is written under the stage's fence. A host
   that lost its lease is refused here (`refused_fence`).
4. **Intent row with no done row** (a host died between send and record):
   look out there first (the pull request from the branch, the comment with
   the key's marker, the branch at the commit, the pull request in the
   queue). Found: write the done row, send nothing.
5. **Lease read again** just before the send, with a 300 ms margin. Too close
   to its end: `refused_lease`, nothing sent.
6. **Send**, with the key's marker in the text (pull request body, comment).
7. **Done row.**

The same rules as Stripe's idempotency keys and Kafka's fenced producer:
a key per write, a fence per writer, and the world read back when the record
is missing.

- **Never forced.** A push goes from a copy made again at the ledger's base.
  It is refused if it is not a fast-forward. There is no force-push anywhere.
  Were one ever needed, it would be `--force-with-lease` on the ledger's sha.
- **Takeover with no working copy.** Build's next holder makes a new copy from
  the pushed branch, or from the base plus the child's patch from the ledger.

The tests are in `idempotency.test.ts`: 7 tests, one per row above.

## Scripted runs

`experiments/104-stages-on-tea-host.ts`. One Miniflare ledger and one fake
GitHub run in the harness process. Each host is its own process, in its own
process group, and is killed whole.

- **The fake GitHub** keeps GitHub's rules and no more. There is one open pull
  request per branch. A push that is not a fast-forward is refused. An enqueue
  of a pull request already queued at that head changes nothing. A queued pull
  request lands after 3 s.
- **It logs every write that reaches it:** the key, and the name and fence it
  was sent under. It marks a write `late` when that fence did not hold the
  lease as the write arrived. Pushes are counted from the bare repository's
  reflog.
- **The kill points:**
  - inside the agent's turn;
  - after the answer, before its row;
  - after an outside write, before its done row.
  The second host then takes over with a fresh working folder.
- **The freeze:** SIGSTOP the host's group at the point just before a send.
  Another host finishes the stage. Then SIGCONT, and watch for 3 s.
- Lease 1 s, renewed every 250 ms.

| Stage | Kill points | Equal to control | Doubled | Lost outcomes | Freeze: woken host wrote |
|---|---|---|---|---|---|
| ship | before enqueue ×10, after enqueue ×10 | 20 / 20 | 0 | 0 | 0 |
| review | in turn ×7, after answer ×7, after comment ×6 | 20 / 20 | 0 | 0 | 0 |
| plan | in turn ×10, after answer ×10 | 20 / 20 | 0 | 0 | 0 |
| build | in turn ×7, after answer ×7, after push ×3, after open ×3 | 20 / 20 | 0 | 0 | 0 |

- **Wasted turns** (agent turns past the control's): at most 1 per takeover
  in every run.
  - A kill inside the turn or after the answer: 1 more.
  - A kill after an outside write: 0.
  - Plan's control takes 2 turns; its killed runs take 3. Plan starts its
    drafts over under a new conversation after a takeover. The old ask is
    taken back, so the child does not run it (see "An ask nobody waits for").
- **Build after a push, before its record.** The next host has no copy. It
  rebuilds the commit from the remote plus the patch, and logs
  `push found_out_there`. The branch took 1 push in 20 of 20 runs.
- **The open after a kill.** The pull request from the branch is found, not
  opened again.

### Limits

A review whose child has a $0.05 cap and bills $0.10 a turn:

- 1 turn, then `limit:usd`, with one row in `<child>/dead`.
- The outcome is `stuck:over_budget`.
- A second host started after it does not start the child again: 1 turn over
  2 hosts.

### Planted mistakes

| Plant | Seen to fail |
|---|---|
| A comment sent straight to the code host, with no key | yes: 1 write with no key |
| A stage that sends after losing its lease (no lease read before the send) | yes: a doubled comment, 1 late write, the woken host wrote 1 |

## Real agents

Claude Code (haiku, effort low, $0.50 a turn) through the Agent SDK, as the
agent child of each stage. Every run below is `real`: a model ran. GitHub
writes go only to `kamp-us/tea-fabrika-sandbox`, through one constant; every
pull request, branch and issue the runs made was closed or deleted after.

- **The setup.** One ticket for build and review (a README section), one for
  plan (an install line). Per stage: a control, then 3 runs, each SIGKILLed at
  a kill point and taken over by a second host process. The child's cap is
  $4 on its spec. The lease is 1 s, renewed every 250 ms, as in the scripted
  runs.
- **What is compared.** review: the rows (criterion and grade) and the
  outcome. build: the outcome and whether the branch changed. plan: the
  outcome, the tasks and the questions.
- **A wasted paid turn** is a turn the ledger counted past the control's.

The last full run (after every fix), and a second plan run:

| Stage | Kill point | Outcome | Matches control | Turns (control) | Outside |
|---|---|---|---|---|---|
| review | in turn | done | yes | 2 (1) | 1 comment with its key |
| review | after answer | done | yes | 2 (1) | 1 comment with its key |
| review | after comment | done | yes | 1 (1) | 1 comment with its key |
| build | in turn | `stuck:draft_failed` | no | 2 (1) | 0 pull requests |
| build | after answer | done | yes | 2 (1) | 1 pull request |
| build | after push | done | yes | 1 (1) | 1 pull request; push found out there |
| plan | in turn | `ask:owner:questions` | no (control `stuck:unchecked`) | 3 (2) | none |
| plan | after answer | `ask:owner:questions` | no | 3 (2) | none |
| plan | in turn | `ask:owner:questions` | no | 3 (2) | none |
| plan (2nd run) | in turn | `stuck:unchecked` | no (control `ask:owner:questions`) | 3 (2) | none |
| plan (2nd run) | after answer | `ask:owner:questions` | yes | 3 (2) | none |
| plan (2nd run) | in turn | `stuck:unchecked` | no | 3 (2) | none |

- **review:** 3 of 3. Each comment was posted once; the run killed after
  the comment's send found it by its marker and posted nothing.
- **build:** 2 of 3. The run killed in the turn ran again on the next host,
  made the patch, and answered `misfit`: its structured answer did not read
  as the form, after 4 calls to its answer tool. That is the model, not the takeover; the
  takeover cost 1 turn. The kill after the push: the next host found the
  branch at the commit (`push found_out_there`) and opened the pull request.
- **plan:** 1 of 6 over two runs. Plan's own outcome is not steady on this
  ticket: 7 controls ended `ask:owner:questions` 6 times and
  `stuck:unchecked` once. The 6 killed runs ended 4 to 2. All 13 runs drafted
  2 tries, 1 task and 1 question. Whether the check accepts the second try is
  the part that varies. 3 runs a stage cannot tell this from a takeover
  effect; 20 would.
- **Before the fixes,** 2 of 3 killed plan runs ended `stuck:unchecked` for a
  reason that was the takeover's: the second try had lost the first draft
  ("the original full draft is not in this conversation"). After the fixes no
  answer says so.
- **Wasted paid turns:** at most 1 per takeover in all 9 killed runs of the
  last full run and all 3 of the second plan run. On the next host the plan
  child's log reads `withdrawn` before its first turn: the dead holder's ask
  was taken back and not run.
- **Spend.** The ledger counted $12.74 over 5 real runs and 3 extra plan
  controls. That is an upper bound: each turn cut by a kill stays counted at
  its $0.50 hold. The finished turns billed about $0.25. The $15 cap was not
  reached.

## tsh's ledger

`packages/fabrika/src/pipeline/tsh/ledger.ts`. tsh's default ledger is now the
Durable Object in Miniflare:

- **One local ledger per fabrika home**, its data under
  `<fabrika home>/ledgers/local`. Its port is a hash of that folder
  (40000 to 59999), so two homes never share one.
- **One object per repository**, named after the old sqlite file
  (`github-demlik`, `folders-<name>-<hash>`).
- **One tsh at a time per home.** tsh starts the ledger lazily, after it
  holds the home's lock. A second start on the same home finds the port
  answering and is refused ("another tsh is using the ledger"). It does not
  join: the ledger process dies with the tsh that started it, so a joiner
  would lose its ledger mid-run.
- **The ledger stops with its tsh.** The Miniflare process watches its parent
  and exits when it is gone, also after a SIGKILL of tsh.
- **node:sqlite is the way out.** `sqliteLedger` is kept as a Layer and is not
  used by default. Which one tsh uses is fixed in code, not in config.
- Tests (`tsh/ledger.test.ts`): a second open on the same home is refused
  while the first runs; a third open after the first closes reads the first
  one's claim.

Not moved: rows in the old per-repository sqlite files. A lane in flight there
is not seen by the new ledger.

## Holes and findings

- **A ship landed before the takeover.** If the queue lands the pull request
  before the next host reads it, ship's own entry reads the facts again. It
  finds the pull request merged, and the outcome names the head, not the
  merge commit, with `cleanup: not_run`. Only the outcome differs: nothing is
  sent twice. Seen with a 300 ms queue (one extra case). The scripted runs use
  3 s.
- **Build counts a takeover as a run.** Build's `resume` adds 1 to `runs`, so
  with `MAX_RUNS = 2`, two takeovers in one build turn end
  `stuck:over_budget`, even though the ledger holds the answer. The comparison
  leaves `runs` out.
- **A gap between the lease read and the send.** The gate reads the lease
  300 ms before the end. A host frozen after that read and before the send
  could still send late. The code host has no fence, so only a key at the code
  host closes it. GitHub has none for comments; the marker makes the doubled
  comment findable, not impossible.
- **Rerun has no lookup.** A rerun of a failed check is sent again after a
  kill. It is harmless (GitHub reruns once more), but it is not found first.
- **A woken host is stopped by the host machine first.** In all 4 freezes the
  woken host saw its lease end and stopped before the gate ran. The gate's
  own refusal is shown by its tests and by the planted mistake.
- **Build's conversation id.** Claude Code takes only a UUID as a session id.
  The hosted build first used the stage's name. The real build turn exited
  with code 1 and $0 spent. It is now a UUID made from the name and the job
  (`sessionOf`).
- **Plan's stream does not end.** A live Agent SDK run keeps its stream open
  after the final message. The hosted plan read it to the end and hung after
  its turn. It now reads up to the first message that is not a tool note, as
  the builder already did.
- **A plan resumed on another host.** Claude Code keeps a conversation in the
  folder it ran in, on the host it ran on. A second try that continues the
  conversation on a new host failed with `error_during_execution`. The
  planner now asks the SDK whether the conversation is kept for this folder
  (`getSessionInfo`). If not, it sends the same prompt as a new conversation.
- **A plan answer from the wrong conversation.** After a takeover the plan
  machine starts over under a new conversation name. The ask id was made of
  the prompt only, so the first draft was answered from the ledger with the
  old conversation's answer. The second try then continued the new name,
  which had never run, and the model saw only the feedback ("the original
  full draft is not in this conversation"). 2 of 3 killed real runs ended
  `stuck:unchecked` this way. The ask id now holds the conversation id too.
- **An ask nobody waits for.** With that fix, the child on the next host
  still ran the dead holder's ask, which the restarted plan no longer wanted:
  2 wasted turns per takeover (scripted 4 turns against the control's 2). The
  stage now records each ask in `<stage>/asking` under its fence, and takes it
  back when it stops waiting (its Sub was cut). The child runs an ask only
  once the stage's holder is seen alive and has asked it under its own fence.
  A turn whose ask is taken back mid-way is cut short. This is Temporal's
  cancel of an activity a reset workflow no longer waits on. Plan's killed
  runs now take 3 turns.
- **The take-back rule assumes one ask at a time.** A holder waiting on
  another unanswered ask counts as having taken this one back. All four
  stages ask one thing at a time; a stage that asks two at once would need
  only the explicit take-back. Seeing the holder alive costs up to one lease
  renewal (250 ms here) before each turn.
- **Review's second turn after a takeover is the review's own.** In an earlier
  real run killed inside the reviewer's turn, the next host ran 2 turns. The first
  form was sent back by the review's own check, a second try ran, and that
  try filed an open finding, so the review sent the work back to the builder.
  The takeover itself wasted 1 paid turn: the one killed.

## Next

- **Sort**, once it is a machine: the next stage to move.
- Close the gap between the lease read and the send for comments.
- Build's `runs` should not count a takeover.
- Plan's Check: the `, and` rule reads one claim as two, and the fixture
  rule fits a doc ticket badly. Those two rules are what make plan noisy
  (104c).
- Move the rows of the old per-repository sqlite files into the new ledger.

## Run it

```sh
node experiments/104-stages-on-tea-host.ts
```

- `ONLY`: `ship,review,plan,build,limits,plants` (the default) or `real`.
- `KILLS=20`, `TTL_MS=1000`.
- Real agents: `REAL=1 ONLY=real`, with a Claude Code token in
  `CLAUDE_CODE_OAUTH_TOKEN`, and `gh` able to write to the sandbox repository.
  `REAL_ONLY=build,review,plan`, `REAL_KILLS=3`, `BUDGET_USD=15`,
  `REAL_KEY=real` (the results key, so a rerun of one stage keeps the rest).

## 104c: plan at 20 runs a kill point

The question: does a takeover change plan's outcome, or is plan just noisy by
itself? 104's real plan runs missed the 2-of-3 rule (0 of 3, then 1 of 3).
This part settles it with more runs.

### The rule, written before the runs

- **The runs.** One plan ticket (104's words), haiku, effort low, on main at
  `c30bc91`. 20 controls, 20 runs killed in the turn (`agent-turn`), 20
  killed after the answer (`agent-answered`). Those are plan's two kill
  points in 104. Each killed run is taken over by a second host.
  - Run in 20 rounds. Each round is one run of each kind, in an order turned
    by one each round, so a drift over the session hits every kind alike.
  - A smoke round of one of each runs first, under its own key. It is not
    counted.
  - A killed run whose kill never fired is left out, and said.
- **What is compared.** The outcome's name (`ask:owner:questions`,
  `stuck:unchecked`, anything else, no outcome at all as `none`). And the
  plan's shape: its task count and question count, as one pair.
- **The test.** Fisher's exact test, two-sided (Freeman-Halton when there
  are more than 2 outcomes), on the counts. Killed against control, once per
  kill point, and once with both kill points pooled (40 against 20).
- **Harmless** when all of these hold:
  - every one of the 3 outcome tests has p at or above 0.05;
  - every one of the 3 shape tests has p at or above 0.05;
  - at each kill point, at least 95% of killed runs have the controls' most
    common shape. If the controls themselves are under 95%, the killed share
    may be at most 10 points under theirs;
  - every killed run wastes at most 1 paid turn (104's law).
- **Changes the outcome** when any outcome or shape test has p under 0.05.
  Then: find why, fix it with a test that fails without the fix, and run
  that kill point 20 more times.
- **No correction for 3 tests.** That makes "changes the outcome" easier to
  call, not harder. It is the strict side for a claim of "harmless".
- **What 20 a side can see.** If the controls end `ask` 6 times in 7, as in
  104, one kill point at 20 runs catches a drop to 40% `ask` 4 times in 5,
  and a drop to 60% only 1 time in 3. Pooled, a drop to 50% 3 times in 4.
  So "harmless" here means "no large effect", not "no effect".
- **Spend.** Stop once the estimated spend reaches $9: the turns that
  answered, at what they billed, plus each lost turn at the mean turn.
  Whatever ran is then read with the same rule, and the stop is said.

### Results

**Answer: harmless. A takeover does not change plan's outcome. Plan is
noisy by itself, and its Check's word rules are why.** Confidence 85%.

- **The counts.** 60 runs, all `real`, all on one ticket
  (`kamp-us/tea-fabrika-sandbox#65`). Every kill fired; none left out.

| Runs | `ask:owner:questions` | `stuck:unchecked` | Tasks 1, questions 1 | Outcome p | Shape p |
|---|---|---|---|---|---|
| control | 17 | 3 | 20 of 20 | | |
| killed in the turn | 19 | 1 | 20 of 20 | 0.60 | 1 |
| killed after the answer | 19 | 1 | 20 of 20 | 0.60 | 1 |
| both kill points | 38 | 2 | 40 of 40 | 0.32 | 1 |

- **The rule, line by line.**
  - Outcome tests: p 0.60, 0.60, 0.32. All at or above 0.05.
  - Shape tests: p 1, 1, 1. Every run of the 60 has 1 task and 1 question.
  - Shape share: 100% at each kill point.
  - Waste: every control took 2 turns, every killed run 3. 1 wasted turn
    per takeover, in 40 of 40.
  - So the verdict is "harmless". No fix was needed, and none was made.
- **Which way it leans.** Killed runs ended `ask` more often than controls
  (95% against 85%), not less. That is noise too: a takeover starts the
  drafts over under a new conversation, so a killed run is a fresh plan plus
  one lost turn.
- **What 104's misses were.** Plan's controls over all 27 real runs (104's 7
  and these 20) end `stuck:unchecked` 4 times. A coin that lands the other
  way 1 time in 7 misses a 2-of-3 match often, and 3 runs could not tell
  that from a takeover.
- **What it cannot see.** At 20 a side it catches only a large shift (see
  the rule). A takeover that moved `ask` by 10 points would pass unseen.

### Plan's own variance

A separate finding, about plan's Check and prompt, not about takeover.

- **How plan ends.** Over all 60 runs: `ask:owner:questions` 55 (92%),
  `stuck:unchecked` 5 (8%). Controls alone: 85% and 15%.
- **Every run drafts twice.** The job has `tries: 2`. The first draft
  failed the Check in 60 of 60:
  - its fixture is "the smallest case" in 59 of 60;
  - it names a source path (`packages/tea/README.md`) in 45 of 60;
  - a criterion "joins two results" in 8 of 60.
- **The second draft decides.** It passed in 55 of 60. The 5 that did not:
  - 3 still had a fixture the Check reads as the smallest case: "two readers
    ... one after the other", "reads from the top down to the Quickstart",
    "opens the README on the npm page or in the repo, then installs". The
    rule wants a count above two, or words like "again" or "large". A doc
    ticket has no natural fixture of that kind.
  - 2 were sent back for "joins two results" on one claim: "the command
    installs the package as published, @demlik/tea, and no other package".
    The `, and` rule reads that as two results. It is one. That is a false
    alarm in the Check.
- **So the driver is the Check's word rules, met with one retry.** The Check
  reads words, not meaning (its own header says so). With 2 tries, one stray
  word on the second draft ends the plan `stuck:unchecked`. A third try, or a
  Check that takes `and no other` as one claim, would likely move most of
  these to `ask`. Not tested here.

### Spend

- **Billed:** $0.49 over 120 answered turns (about $0.004 a turn). 40 turns
  were cut by a kill; at the mean turn that is $0.16 more. About $0.66 in all,
  plus $0.04 for the smoke round.
- **The ledger counted $21.52** (60 runs and the smoke round). That is the
  upper bound 104 already explains: each cut turn stays counted at its $0.50
  hold. It is not money spent. The $10 cap held on the billed spend.

### Run it (104c)

```sh
REAL=1 ONLY=real REAL_ONLY=plan PLAN_ROUNDS=20 RESULTS_NAME=104c-plan-at-20.json \
  BUDGET_USD=60 EST_BUDGET_USD=9 node experiments/104-stages-on-tea-host.ts
```

- Needs `CLAUDE_CODE_OAUTH_TOKEN` and `gh` able to write issues on the
  sandbox repository. Writes one issue there and closes it after.
- The test and the rule: `104-stages-on-tea-host/plan-at-20.ts`.
- Results: `results/104c-plan-at-20.json`, key `real` (the counted runs) and
  `smoke` (the round that is not counted). About 35 minutes.
