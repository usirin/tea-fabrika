# 111. Sort as a program on tea-host

The question: can sort, the stage that says whether a report is still work,
run as a tea machine on tea-host, survive kills and takeovers, and never send
an outside write twice?

- Sort is now a machine, shaped like plan and review: one pure `update`, the
  agent's turn as a Cmd, the outcome a closed union.
- It keeps experiment 92's bar: 7 rules for a no, 4 for a yes that stays, and
  the answers yes, no, duplicate and fold (part of an open plan).
- It runs under a registered name, `sort:<n>`. Its agent is a child program,
  `sort:<n>:agent`, with `limits` on its spec, as in 104.
- Every outside write leaves through 104's gate, with a key from a ledger id:
  the comment, the label, the close (as a duplicate or as not planned), the
  link comment on the plan's ticket, and the `ruling_needed` fact.

**Answer: yes, with scripted and with real agents.** One part is still
missing: a fold says so on GitHub, but no ledger fact adds the ticket to the
plan yet.

- Scripted sorter, fake issue host, 20 killed runs over 4 cases: 20 of 20
  equal the control. 0 doubled writes, 0 lost outcomes, 0 writes without a
  key. At most 1 wasted turn per takeover.
- A host frozen past its lease, then woken: it wrote nothing.
- A child capped at $0.05 ends `limit:usd`, with 1 turn over 2 hosts, and 0
  writes. The outcome is `stuck:over_budget`.
- Both planted mistakes were seen to fail.
- Real agents (haiku, all runs labelled `real`), on the sandbox repository
  only, 3 cases, a control and 3 killed runs each:
  - a real duplicate: 3 of 3 match the control (closed as a duplicate of
    the same ticket);
  - a report that fails the bar: 3 of 3 match (closed as not planned, rule
    `pipeline_tool`);
  - a report that folds into an open plan: 3 of 3 match (the same plan, 1
    link comment on it).
  - 1 comment per key on every ticket, at most 1 wasted paid turn per
    takeover. Billed about $0.01; the ledger counted $1.51 (killed turns stay
    at their $0.25 hold).
- No logic bug was found by either pass. The fixes on the way were type and
  lint fixes.

Confidence 80%. The doubts are under "Holes".

## Sort as a machine

`packages/fabrika/src/pipeline/stages/sort/`. Elm first: a `Model`, a closed
`Msg`, one `update`, Cmds for every read and write, and a Sub for the agent's
run. Nothing in `update` touches the world.

- **The phases.**
  - `reading`: read the ticket (`sort_ticket`).
  - `gathering`: read the repo's other tickets and the open plans
    (`sort_context`).
  - `sorting`: the agent's turn, through plan's refine loop
    (`createRefineLoop`). Each try's spend is added up.
  - `checking`: the answer against the bar. Problems go back to the agent as
    feedback, up to the tries the job allows.
  - `writing`: one write at a time, each a Cmd with an `intent` made of the
    ticket, its place in the list, and its kind.
  - `over`: the outcome and a report (the answer, the writes made, the last
    problems, the tries, the spend).
- **The check** (`brief.ts`, `sortProblems`). Every answer says why. A no
  names one of the 7 rules (the schema holds it) and its one-line reason
  starts with that rule's lead ("won't do: ..."), as 92's comments did. A
  duplicate names another ticket of the repo, not itself. A fold names a plan
  that is open. A ruling asks something and gives at least two options.
  Everything else is the agent's judgement, as in 92.
- **The door.** Before the first write the ticket is read again. Closed:
  `skip:closed`. Its title or body changed: `stuck:changed`. Nothing is
  written in either case.
- **The writes, in order** (`writes.ts`). The comment comes first, so a
  person sees why before anything else changes. Then the label
  (`sort:<said>`). Then, by the answer:
  - no: close as not planned.
  - duplicate: close as a duplicate.
  - fold: a link comment on the plan's ticket.
  - ruling: a `ruling_needed` fact on the ledger.
  - plan or research: nothing more.
- **The outcomes** (`outcome.ts`). `done:closed:no|duplicate`,
  `send:plan:yes|fold`, `send:research:yes`, `ask:owner:ruling`,
  `skip:closed`, and `stuck` with `read_failed`, `draft_failed`,
  `over_budget`, `unchecked`, `changed`, `write_failed`.
- **The sorter** (`sorter.ts`). Claude Code through the Agent SDK, with no
  tools, no saved session and no settings files, in a fresh empty folder. The
  SDK's `maxBudgetUsd` is the turn's cap. A run past it reads
  `stuck:over_budget`.
- **Tests.** 14 in `machine.test.ts`: each answer's writes and outcome, a fold
  sent back by the check and fixed on the second try, the door, a refused
  write, the spend, and how the reason of an earlier no is read back.

## The world laws

`packages/fabrika/src/pipeline/laws/sort.ts`, added to `laws/specs.ts`. The
world gives the machine 7 replies: a duplicate, a duplicate of itself, a no,
a fold, a fold into no plan, a ruling, and an answer that does not fit. The
walk goes 12 steps deep: 204 states, nothing broken.

- An outcome other than `stuck` comes only from an answer that passed the
  check.
- Nothing is written before the door. A closed or changed ticket gets no
  write.
- The writes are the answer's, in order, each once.
- The run ends only once every write went out.
- The run id is the one the refine loop asked; the tries never pass the job's.
- The dollars only go up.
- An ended run sends nothing.

Three planted mistakes, each caught with its path (`laws/sort.test.ts`): a
write before the door, a machine that takes any run's answer, and a no that
leaves the ticket open.

## Hosting it

`packages/fabrika/src/pipeline/hosted/sort.ts` and `hosted/issues.ts`. Only
new files: 104's `stage.ts`, `agent.ts`, `idempotency.ts` and `outside.ts` are
used as they are.

- **`hostedSort`** is a 104 `Stage`. Its job is the ticket, the tries, the
  settings and the child's dollar cap. Its start key is the name.
- **The agent child** runs each try as one ask. The ask id is
  `sort/<run id>/<digest of the prompt>`, so a takeover that asks the same
  try again is answered from the ledger. A child that hits its limit replays
  as `error_max_budget_usd`, so the machine ends `stuck:over_budget`.
- **`Issues`** is a new service: read a ticket's comments and labels and
  whether it is closed; write a comment, a label, a close. `gitHubIssues`
  takes the repositories it may write to, and refuses any other.
- **The keys** are `sort:<n>#<op>:<subject>`:

| Write | Subject | Looked for out there by |
|---|---|---|
| comment | the ticket | a comment with the key's marker |
| label | the ticket and the label | the ticket has the label |
| close | the ticket | the ticket is closed |
| link | the plan's ticket | a comment with the key's marker |
| ruling | the ticket | nothing: the ledger fact's id is the key, so a second send is a no-op |

## Scripted runs

`experiments/111-sort-on-tea-host.ts`. One Miniflare ledger and one fake
issue host in the harness process. Each host is its own process, in its own
process group, and is killed whole. As in 104.

- **The fake issue host** keeps GitHub's rules and no more. A label a ticket
  has is not added twice. A closed ticket is not closed again. Every write is
  logged with its key, and the name and fence it was sent under. A write is
  `late` when that fence did not hold the lease as it arrived.
- **The cases**, each a ticket next to three background tickets (an open bug,
  a closed one with a sort no, and the ticket of an open plan):
  - duplicate: the open bug, reworded.
  - no: a standing readout, not work.
  - fold: a case the open plan missed. Its first try names a plan that is
    not open, so the check sends it back; the second names the right one.
  - ruling: an owner must choose between two options.
- **The scripted sorter** takes 300 ms and bills $0.10 a try, so a kill 100 ms
  into a turn lands inside it.
- Lease 1 s, renewed every 250 ms.

| Case | Control: turns, writes | Kill points | Equal to control | Doubled | Lost |
|---|---|---|---|---|---|
| duplicate | 1; comment, label, close | after answer, after label, before close, after close | 4 / 4 | 0 | 0 |
| no | 1; comment, label, close | in turn, after answer, after comment, after close | 4 / 4 | 0 | 0 |
| fold | 2; comment, label, link | in turn ×2, after answer ×2, after comment, after label, before link, after link | 8 / 8 | 0 | 0 |
| ruling | 1; comment, label, 1 ruling fact | in turn, after comment, before ruling, after ruling | 4 / 4 | 0 | 0 |

- **Wasted turns:** at most 1 per takeover.
  - A kill inside the turn or after the answer: 1 more (fold 3 against 2,
    the others 2 against 1).
  - A kill around a write: 0.
- **The freeze:** the fold's host SIGSTOPped just before its comment, another
  host finished the sort, then SIGCONT. The woken host saw its lease end and
  stopped. It wrote nothing.

### Limits

The no case, with the child capped at $0.05 and a turn billing $0.10:

- 1 turn, then `limit:usd`, with one row in `<child>/dead`.
- 0 writes. The outcome is `stuck:over_budget`.
- A second host does not start the child again: 1 turn over 2 hosts, $0.10.

### Planted mistakes

| Plant | Seen to fail |
|---|---|
| A comment sent straight to the issue host, with no key | yes: the issues differ from the control, 1 write with no key |
| A stage that sends after losing its lease | yes: a doubled comment, 1 late write, the woken host wrote 1 |

## Real agents

Claude Code (haiku, effort low, $0.25 a turn by the SDK's cap) through the
Agent SDK, as the sort's agent child. Every run below is `real`: a model ran.
GitHub writes go only to `kamp-us/tea-fabrika-sandbox`: `gitHubIssues` is
given that one repository, and the harness's own `gh` calls refuse any line
that does not name it.

- **The setup.** The harness opens 4 issues: one plan ticket (the README's
  install section, with its `planned` fact seeded on the ledger) and 3 cases.
  - duplicate: the same type-error report as the sandbox's open #7, in other
    words.
  - fails the bar: a bug in fabrika's operator. The repo note says fabrika
    lives in another repository, so this is a no by `pipeline_tool`.
  - fold: the install line should name the `effect` peer, a case the plan
    missed.
- Per case: a control, then 3 runs, each SIGKILLed once and taken over by a
  second host process:
  - inside the turn (1.5 s in);
  - after the answer, before its row;
  - after the last write (the close, or the link), before its done row.
- Between runs every write is taken back: keyed comments deleted, `sort:`
  labels removed, the ticket reopened. At the end every issue the run opened
  was closed as not planned.
- Lease 1 s, renewed every 250 ms. The child's cap is $1; the spend stop was
  $5 and was not reached.

| Case | Kill point | Outcome | Matches control | Turns (control) | Outside |
|---|---|---|---|---|---|
| duplicate | control | `done`, of #7 | | 1 | 1 comment, `sort:duplicate`, closed as duplicate |
| duplicate | in turn | `done`, of #7 | yes | 2 (1) | the same |
| duplicate | after answer | `done`, of #7 | yes | 2 (1) | the same |
| duplicate | after close | `done`, of #7 | yes | 1 (1) | the same |
| no | control | `done`, `pipeline_tool` | | 1 | 1 comment, `sort:no`, closed as not planned |
| no | in turn | `done`, `pipeline_tool` | yes | 2 (1) | the same |
| no | after answer | `done`, `pipeline_tool` | yes | 2 (1) | the same |
| no | after close | `done`, `pipeline_tool` | yes | 1 (1) | the same |
| fold | control | `send:plan:fold`, plan #60 | | 1 | 1 comment, `sort:plan`, 1 link comment on #60 |
| fold | in turn | `send:plan:fold`, plan #60 | yes | 2 (1) | the same |
| fold | after answer | `send:plan:fold`, plan #60 | yes | 2 (1) | the same |
| fold | after link | `send:plan:fold`, plan #60 | yes | 1 (1) | the same |

- **9 of 9.** Each killed run ended with the control's outcome and target,
  and left the same things on GitHub.
- **No doubled write.** Every key's comment is there once. The run killed
  after the close found the ticket closed and closed nothing. The run killed
  after the link found its marker on the plan's ticket and posted nothing.
- **GitHub takes `duplicate` as a close reason.** The fallback to
  `not_planned` in `gitHubIssues` was never used.
- **The answers' words vary, the answers do not.** The `why` changes from
  run to run; the answer, the rule and the target did not, in 12 of 12.
- **Wasted paid turns:** at most 1 per takeover, in all 9 killed runs.
- **Spend.** The ledger counted $1.51. That is an upper bound: 6 turns were
  cut by a kill (in the turn, or after the answer before its charge) and stay
  counted at their $0.25 hold. The finished turns billed $0.0099 in all.
- The ruling case ran only scripted. The brief asked for the three cases
  above.

## Holes and findings

- **A gap between the lease read and the send** (104's hole) holds for sort's
  comment and link comment. A host frozen after the gate's last lease read
  and before the send could post late. GitHub has no fence for comments; the
  marker makes a doubled one findable, not impossible. The label and the
  close cannot double: GitHub keeps one of each.
- **A fold lives on GitHub only.** It posts a link comment on the plan's
  ticket and ends `send:plan:fold`. No ledger fact adds the ticket to the
  plan's `tickets`, so plan does not see it yet. That needs a new fact in
  `asks/ledger.ts`, shared with the other stages; it is left for its own
  change.
- **The door reads once.** The ticket is read again before the first write.
  It can still change between that read and a later write; a person's edit
  in that window is not seen.
- **`hasComment` reads the first 100 comments.** A ticket with more would
  not find the marker, and the comment could be posted again after a kill.
- **An earlier no's reason is read from the key's text** (`sort:<n>#comment:`
  in the marker). A change to the key's format would hide earlier noes from
  the sorter.
- **Labels are made by the first write.** GitHub creates `sort:no`,
  `sort:duplicate` and the rest on first use, with no color or description.
- **The real cases were easy.** Each had one clear answer, and haiku gave it
  12 times out of 12. A report on the edge of the bar would show whether
  sort's own answer varies the way plan's did in 104. 3 runs a case cannot
  tell that from a takeover effect.
- **A woken host is stopped by the host machine first,** as in 104. The
  gate's own refusal is shown by its tests and by the planted mistake.

## Next

- Add the fold to the ledger: a fact that adds a ticket to an open plan, read
  by plan.
- Real runs on reports near the bar, 20 a kill point, to measure sort's own
  variance.
- Close the gap between the lease read and the send for comments (with 104).
- Page through comments in `hasComment`.
- Sort under operate and tsh, in place of the sort skill.

## Run it

```sh
node experiments/111-sort-on-tea-host.ts
```

- `ONLY`: `kills,limits,plants` (the default) or `real`.
- `KILLS=20`, `TTL_MS=1000`, `DEBUG=1`.
- Real agents: `REAL=1 ONLY=real`, with a Claude Code token in
  `CLAUDE_CODE_OAUTH_TOKEN`, and `gh` able to write to the sandbox
  repository. `REAL_KILLS=3`, `BUDGET_USD=5`, `REAL_KEY=real` (the key the
  results are saved under).
