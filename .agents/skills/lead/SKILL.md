---
name: lead
description: Lead one tea-fabrika ticket through the hand-run pipeline steps (plan, tests, build, mutation, review) with Codex boxes, then push, catch up and land it. Use when you are the lead session running a ticket's steps by hand, or when asked to start a box, approve a plan, or land a step pull request.
---

# The lead

Today's pipeline programs are paused, so the lead session runs each pull request's steps by hand:
plan, tests, build, mutation, one review, each by its own agent
([the steps](../../../docs/direction/next-is-a-pipeline-pre-run.md)). The lead writes no step's
work. It starts each step, reads what comes back, and lands the result.

```text
plan (read-only) -> lead approves -> box -> tests -> build -> mutation -> review
  -> fetch, read the diff, e2e -> push as the bot -> pull request -> catch up -> merge rule
```

A step's brief is short. It names the skill and the ticket's facts, and nothing the skill holds:

```text
Use the build skill for ticket 277, door fixes, next/. Plan at ../door-PLAN.md.
Laws d1 to d3 are red. This round: make them green in door.ts, answer.ts and hello.ts.
```

A brief never prints npm, pnpm or environment settings (owner, 2026-11-08), not even to show a
step where they come from. A run once printed a token to a local log that way. Name the setting
and say where it is set; never echo its value. `pnpm config list` and `env` stay out of briefs.

For a stacked lane, put the parent and landing facts in the state file and the brief before the
first step:

```text
Parent: ticket <id>, branch <branch>, signed build head <sha>, or none.
Children: <ticket, branch and signed parent head for each child>, or none. Record before starting.
Start a child at its parent's signed build head. Keep the child's tests through catch-up.
Land the stack with `gh stack merge <pr> --squash`, then `gh stack sync --prune`.
Return plans unsigned, including reviews and revisions. Only the lead session approves them.
```

The draft check checks the handoff format. Shared shell access cannot prove which session signed.
Do not add a marker, key or readable file as proof of session identity.

## Review brief template

Use this for the whole diff, including a re-review after fixes:

```text
Use the review skill for the ticket below.
Ticket: <id and title>
Version: <today's tooling or next/>
Approved plan: <path, including amendments>
Parent base: <branch and full signed SHA, or origin/main and full SHA>
Reviewed head: <branch and full SHA>
Decided notes: <every decided note the PR builds>
Last fixes: <commit range and report, or none>
```

Sweep, do not sample. For each law in the plan's table, list every way in: each public call,
each cut point, and each saved or binding state. Check each one.
A finding names its class and every case of it.
A law written as examples over a class the plan names is a defect when a found case escapes
those examples.
On a re-review, read every line the last fixes changed and what calls them first. Then finish
the remaining checks.
Read every decided note the PR builds, following the plan's references and the change itself.
Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law.
Each blocker cites that source and shows the missed case.

Start with merge-ready; findings: <m> or changes: <n>; findings: <m>.
n counts blocking classes. Each class lists every affected case. m counts the finding rows in
this answer.
Give every finding in that answer, grouped by class, most serious first.
Name each checked decided note and say where the change follows or breaks it.
Any other actionable finding is one finding row with proof: never a ticket, a fix or only a
mention, and never a security hole.
Give each row as one JSON line in the answer. The lead adds it to field/findings.jsonl
unchanged. Do not start another review round for it.
End with exactly one answer: line, as the last line.
Keep the four reason labels in the review skill. A missed case in a named class checks the law;
it does not reopen every test's merits.

## Lane brief template

Use this when a lane agent runs a lane's steps for you. Its last act is `land.ts ready`; the lead
session lands (ticket 652):

```text
Run the lane for ticket <id>, <title>, <today's tooling or next/>.
Lane: <lane>. Branch: fabrikalfa/<name>, in the worktree <path>. State file: BOXES/state/<lane>.md.
Approved plan: <path, including amendments>. Lane brief: <path>.
Run each step through drive.ts or chain.ts, read its answer, and send fixes to the step that owns the file.
Commit a lead file (field rows, a plan row, a lockfile) unsigned, with
`stepcommit.sh --commit-only lead <ticket> <subject> <files>`, and keep its sha.
When the review says merge-ready: write the PR body file (its first line the title, and a
`fabrika close ticket <id>` line when the PR finishes the ticket), save loosening.sh's output and the
mutation arm a vs arm b comparison as files, and end with
`node .agents/skills/lead/scripts/land.ts ready <lane> --tree <path> --body <file> --loosening <file> --mutation <file> --plan <path> [--lead <sha>]...`.
Mid-lane, when only a lead commit must reach the next step (a lockfile, a merge of main), end with the same
command without the three PR files. Then stop and say "ready to land" with the state file's path.
```

## Who runs which step

Decided in [stage agents run on Codex](../../../docs/direction/agents-run-on-codex.md) (owner,
2026-11-08), which this section follows.

- **Codex in a box runs each step:** plan, tests, build, mutation and review, each its own agent.
- **Except Electron or socket work** (owner, 2026-11-08): a step whose laws or shots need the app
  running (a program's window, the desk, keys, the look) or need to bind a socket is run by a Claude
  agent instead. A Codex box can start neither, so a Codex build there would come back half checked.
  Still one agent per step.
- **A tool that needs ports, sockets or its own processes runs in a container with its own
  network** (owner, 2026-11-09,
  [0045](../../../.decisions/0045-test-steps-run-in-containers.md)), never behind a hole in a
  sandbox row. The mutation step is the first: `drive.ts` runs Stryker through `mutbox.ts` before
  the step's agent starts, and the agent only reads the report. Its agent is still Claude
  (`drive.ts --agent claude`).
- **One fresh Claude agent per step, not one long driver per ticket** (owner, 2026-11-09). Each
  step gets a new agent with a short brief. It reads the lane's state file
  (`BOXES/state/<lane>.md`), does its one step, and writes the state file back for the next agent:
  the branch, the signed heads, what ran and what is next. Nothing is carried in an agent's
  memory. A PR still merges only after every step ran, each by its own agent (plan, tests, build,
  mutation, one review saying merge-ready), with CI green and the leak grep clean. No step is ever
  skipped. Only a new design call or an exam read that does not meet the bar (step 9) comes back to
  the lead. `chain.ts` (tracker ticket 341) chains the mechanical steps in code and starts an
  agent only where judgment is needed ([below](#run-a-whole-lane-with-chaints)). *It said (owner, 2026-11-08): one driver per ticket, start
  to finish. One driver ran for 11 hours, which was wasteful.*
- **A step agent never writes another step's code or tests** (owner, 2026-11-08). The agent
  that hands work along fetches, reads the report, and runs what a Codex box cannot: e2e runs and
  screenshots.
- Plan every row as soon as its tier opens, and start each test writer when its plan is approved.
  Tests do not wait for the code under them; only builds wait in line.

## Scripts

All read `scripts/env.sh`, which finds the main checkout from the repo and keeps the boxes beside
it (`BOXES`, default `<parent of the main checkout>/boxes`). Each value can be set from outside.

| Script | What it does |
|---|---|
| `box.sh new <name> <base> <branch> --ticket <n> --plan <path> [--root <sha>]` | check the start and save its facts (the lane root that build order and the commits check read from), then clone and install |
| `box.sh run <name> <prompt> <out> --step <step>` | run Codex, save redacted output and the run row |
| `box.sh fetch <name> <branch> --sign <step> --ticket <n>` | fetch without force, sign the recorded run and check commits |
| `box.sh gc [--dry-run]` | remove every box that sat idle 2 h (24 h when drive kept it stuck) once its work is on a remote, backing unpushed commits up to `<branch>-wip` first (a box with uncommitted files is kept, since a backup saves only HEAD), then every `state/<box>.box` whose box is gone, then every clean, idle linked worktree whose lane's pull request merged or closed, found by its branch, by a remote branch at its HEAD or by the PR's head commit; before any folder goes, `keepruns.sh` moves its `runs/` (raw samples, never in git) into the main checkout's `runs/<folder>/`, and a folder it cannot move is kept, as in `box.sh rm` and `catchup.sh`; it prints each keep with its reason, and drive runs it at start and names those keeps when it still refuses on disk. Cleanup is the tooling's job: never ask the owner to free disk (owner, 2026-11-09) |
| `drive.ts <lane> <step> <brief>` | one Codex step end to end, with no agent waiting: box, run, fetch, checks, backup push, field row, state; one JSON line (below) |
| `chain.ts <lane> <lane-brief.md>` | the whole lane end to end, with no lead agent holding it: tests, build, mutation, review through `drive.ts`, then the PR, `loosening.sh` and `catchup.sh`; a short judgment agent only on an ask or a stuck ([below](#run-a-whole-lane-with-chaints)) |
| `mutbox.ts run --checkout <repo> --ticket <n> --build <sha> --related <paths> --out <dir> --lock <file> [--base <sha>]` | the mutation step's Stryker sample in a container: `--network none`, no capability, 4 CPUs, 4 GB, the commit copied in read-only, nothing from the home folder; one JSON line and `<out>/mutbox.json`; `stuck` when Docker is missing, never the host instead. `mutbox.ts gc --lock <file>` removes a dead run's container and images over a week old; `box.sh gc` calls it |
| `runplan.sh <name> <brief>` | a read-only plan writer in the main checkout; the plan lands in `BOXES/<name>-plan.md` |
| `botpush.mjs <tree> fabrikalfa/<branch>` | merge the remote notes in, then push the branch and `refs/notes/fabrika` as the bot, in one atomic push; when the only refusal is notes another session pushed meanwhile, it merges them and pushes once more, never forced |
| `land.ts ready <lane> --tree <dir> [--body <f> --loosening <f> --mutation <f>] [--lead <sha>]... [--plan <f>]` | a lane agent's last act: records "ready to land" in `state/<lane>.land.json` and a line in `state/<lane>.md`; the tree must be clean. Without the three PR files it is a mid-lane handover to `-wip` |
| `land.ts run <lane> <ticket>` | the lead session only, in the background: refuses unless the tree is clean and at the ready head, leak-greps the PR body, merges `origin/main` in as the bot (never a rebase), leak-greps the change and each commit, signs each named lead commit and then the merge as lead through main's own signer, pushes with `botpush.mjs`, opens or updates the PR and runs `catchup.sh`. A conflict stops it with each file and the step that owns it in the plan's files table; every refusal before the push puts HEAD and the notes back. It never resolves a conflict and never reads a key |
| `governance.sh [base]` | list the `.decisions/` files the diff from `base` (default `origin/main`) touches; advice only, always exits 0 |
| `catchup.sh <pr> <ticket>` | merge `main` in as the bot, sign `lead`, push, check that exact head, look at main once more with `freshmain.ts`, and squash-land pinned to that head; a PR in a gh stack lands with `gh stack merge`; a green PR whose freshmain lint passed lands even when gh refuses it as behind main, through the REST merge with `sha` as the pin ([0049](../../../.decisions/0049-merge-behind-main-once-lint-passes-on-the-true-merge.md)) |
| `freshmain.ts <pr> <tip>` | run by `catchup.sh` just before the squash, in its checkout: fetch main, and when it moved after the checks, run `pnpm lint` on the head merged with it; a red lint, a conflict or a failed fetch refuses the merge, and the lane merges main and pushes. No flag skips it, and the tests are not run again (ticket 552) |
| `fieldrow.py [--parent R] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why>` | one `field/runs.jsonl` row from a Codex run's events |
| `clauderow.py --run R [--billing B] [--role R] [--parent R] [--corrects R] <transcript> [why]` | one `field/runs.jsonl` row from a Claude subagent's transcript, tokens and list dollars; `billing` only when given, since a transcript does not say; `--turns <transcript>` prints each call's context and dollars |

box.sh run and runplan.sh strip secret settings and redact saved output.
fetch --sign checks owners and signs missing notes in MAIN.
Review and mutation briefs say never to print npm, pnpm or env settings.
leakgrep.sh checks added text; private words stay outside the repo.

## Use drive.ts for any step

Every step goes through `drive.ts`, on a Codex box or a Claude agent; no box is made by hand. A
Claude agent in the lead session only reads its result and makes the judgment call. Start it in the
background and read the last line only:

```sh
node .agents/skills/lead/scripts/drive.ts <lane> <plan|tests|build|mutation|review> <brief.md> \
	[--agent codex|claude] [--model sonnet|opus] [--from <ref>] [--ticket <n>] \
	[--branch fabrikalfa/<name>] [--plan-only] &
```

- `--agent codex` (the default) runs Codex in a box. `--agent claude` runs `claude -p` in the same
  kind of box, with a new `--session-id`, `--model` (default `sonnet`; `opus` when asked), `--tools`
  per step (a review gets no Edit or Write), no setting sources, no MCP servers, and the step's
  skill named in its prompt. Its `stream-json` goes to the events file, and `clauderow.py` writes
  the field row with tokens and list-price dollars.
- Claude runs under `sandbox-exec`: it cannot read `~/.fabrika/step-keys`, the leak words or
  `~/.codex`, and it writes only its box and caches. It commits with plain git. drive then signs its
  work as one commit through `stepcommit.sh`, with main's own signer, never the box's code.
- A mutation step's Stryker run happens first, in a container (`mutbox.ts`, 0045): drive runs it on
  the step's start head with the tests the brief names on one line, `RELATED=<paths>`, and with
  the lane's root as arm a. A brief without that line is a usage error. A run that is stuck
  (Docker not running, another Docker box, a test that fails there) ends the step
  `stuck:step_said` with no agent, its reason starting `mutbox:`, and the box is kept. Else the
  agent gets the text of `BOXES/<box>-mutbox/mutbox.json` in its prompt, whole, since its box
  reads nothing outside itself. Mutation's
  agent is `--agent claude` only, since a law it adds may start Electron. Start any
  other Claude step whose laws or shots run the app with `--electron`. The box cannot write
  `BOXES/state/electron.lock`, so drive takes it outside the box before the agent starts and holds
  it for the whole step; the next Electron step waits. The sandbox is unchanged.
- It starts a box at `--from`, else the lane's last head (`BOXES/state/<lane>.json`, moved only
  by a step it accepted) or the newest tip on origin of the branch or its `-wip` backup when that
  is ahead of it, else `origin/main`. So a lead commit (a merge of main, a lockfile commit) pushed
  to `-wip` is where the next step starts, and `box.sh new` takes a verified lead head as a base
  like a build head, and so is any commit `origin/main` holds, such as the main a plan read before
  main moved on. A plan reads the main checkout and takes no `--from`.
- `box.sh new` refuses `shared_ticket` only when another live branch carries a link for the same
  ticket: one with an open PR, or one a box on disk names. A branch the base already holds, one
  with neither, or one whose change is only `field/*.jsonl` rows, does not block.
- It runs the agent with the brief and an `answer:` line it asks for, waits with no agent, fetches,
  and checks: `pnpm commits check` and this step's name on every new commit, no exam path in any
  build commit, the leak grep on each commit's added lines, a review committing nothing, and
  `plancheck --draft` on a plan. A `stale_link` counts only for a step the lane has signed; one for
  a step it has not reached (lead, before catch-up) is left to CI on the PR. Stepcommit reads the
  facts of the box it runs in, never another `.box` on the branch. A check that cannot run is
  `stuck`, never a pass. When the commits check holds a step, `box.sh fetch` and the outcome line's
  `reason` name each rule and commit that held it (`stale_link 1a2b3c4d step tests`,
  `broken_chain ...`, `unlinked_commit ...`; five at most), and `not_owner` names its path and
  commit, so the lead knows which step to send it to. A build that
  answers `done` with no commit is done only with a `laws: green <paths>` line (every law already
  green at its start); else it is `stuck:no_commit`, as a tests step with no commit always is.
  It takes exactly one `answer:` line outside a code fence: none, two or more, or one that names no
  verb is `stuck:no_answer`. So is a review's `done` without a merge-ready first line, or with a
  `changes: <n>` line, n above 0 (ticket 557).
- A box has no network, so it cannot refresh `pnpm-lock.yaml`. When a step's commits change a
  locked field of a workspace `package.json` (its name or dependencies) or `pnpm-workspace.yaml`
  and leave the lockfile alone, drive answers `ask` (`lockfile`, exit 20) whatever the step said,
  and still pushes `-wip`. The lead then, outside the box, runs `pnpm install --lockfile-only` on
  `-wip`, checks each new version is exact and named in the approved plan, and commits the lockfile
  with `stepcommit.sh --commit-only lead`; a lane agent then runs `land.ts ready` without PR files
  and stops, and the lead session runs `land.ts run`, which signs it and pushes it to `-wip`. The
  next step starts at that tip.
- Then it pushes `<branch>-wip` (a `-wip` branch as it is) as the bot when the step committed, writes the field row to
  `BOXES/<lane>-rows.jsonl`, appends the step to `state/<lane>.json` and `.md`, and removes the box.
  It keeps the box, whatever the step answered, while it holds uncommitted files or commits off the
  step's branch, and the outcome line's `reason` ends with `(box kept: ...)` saying what is left.
  A stop after the time limit takes the agent's whole process group with it.
- Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (the question
  is in `reason`), 30 stuck, 40 skip (`answer: skip <why>`: nothing here for the step, such as a
  mutation step whose diff has no product lines; its field row says `skip`, which review's order
  check takes in place of a mutation row), 2 usage, 3 refused before any agent ran, printed as
  `refused:<check>`: `agent_cap` (8 agents running: Codex boxes plus Claude steps drive started),
  `low_disk` (under 20 GB free after `box.sh gc`), `branch_checked_out` (the lane's branch checked
  out in a worktree, which the end-of-step fetch could not update), `docker_busy` (a mutation step
  while another run holds the one Docker box), or a `box.sh new` start check
  (`plan_unapproved`, `base_not_signed`, `shared_ticket`, `root_not_ancestor`). A refusal is not a
  step outcome, so the stuck count holds only steps an agent ran. It never retries. A stuck step keeps its
  box. A box's number is the first that no older run's files hold, and the line's `report` is `null`
  when this run wrote none, as when box.sh refused it before the agent started. The commits check reads the whole lane, from where it left main, so each earlier step's
  newest link is in its chain. After a lead merge of main it starts at the merge-base with
  `origin/main` instead, so main's own commits are not judged as the lane's. A tests, build or mutation step waits while `pgrep -x tsgo` finds
  one. `DRIVE_MINUTES` (default 60) stops a step that runs too long.

## Run a whole lane with chain.ts

A lead agent used to sit for hours on one lane, starting each step and reading its answer. That
loop is code now (owner, 2026-11-09; tracker ticket 341). `chain.ts` is a tea machine on the
Effect engine whose Cmds run `drive.ts`'s pieces in process for each step (`prepare`, then
`driveStep`), read the step's one line, and pick the next move; a fresh read-only agent is started
only where judgment is needed, and it is gone after one answer. Every agent, a step's and the
judgment's, runs through today's fabrika agents package (`Agent`, `@kampus/fabrika-old`) on its ACP
rows, the same harness rows `summon` starts (`scripts/agents.ts`, owner, 2026-11-09): Codex writes
its box or only reads it (plan, review), Claude runs in its own OS sandbox. The box's git data is
outside the box, so the agent commits nothing: it leaves its changes in the tree, and drive copies
them into a worktree of the main checkout and signs them as one step commit (0028). A box reads
nothing beside itself, so drive puts the approved plan's text in the step's prompt, and gives the
box a git view to read: a hard-linked mirror of the main checkout's git data, `BOXES/<box>-view`,
which the harness opens read-only and drive removes when the step ends (`git diff`, `log` and
`show` work; nothing git keeps can be written). A brief names no file outside the box. The step
answers with one JSON object (verb, to, reason, laws), read by the agents package's schema.

Measured on the first real lane (t411, 2026-11-09): neither row lets a command listen on a port or
a unix socket (`EPERM`), and no row is opened for it (0045). The mutation step's Stryker run goes
in a container first (ticket 483); a tests or build law that binds a port still cannot run on
these rows. On the read-only Codex row, a command that writes
is refused and that ends the turn `cancelled` with no answer (ticket 484), so drive tells a review
to run no writing command.

Measured on a throwaway lane (ticket 522, 2026-11-10, $0.10 at list price): a tests step's one new
file was collected and signed as one step commit, a review on the read-only Codex row read it with
`git diff` and said merge-ready, the chain found the lane's open pull request, and `catchup.sh`
merged main in, signed it as lead and pushed. A command that fails does not end a turn; only a
refused ask does. The merge itself was not run: the `commits` check runs only for a pull request
into main, so catch-up on a scratch base waits for it until its hour is up.

The mutation step has one wiring spot: `MUTATION_AGENT` and `mutationDraft` in `drive.ts`, under
the heading `MUTATION WIRING`. `mutationDraft` runs `mutbox.ts` (ticket 483) and then the agent's
one turn; nothing else in `drive.ts` or `chain.ts` knows the step is different.

Start it in the background and read the last line only:

```sh
node .agents/skills/lead/scripts/chain.ts <lane> BOXES/<lane>-CHAIN.md \
	[--ticket <n>] [--branch fabrikalfa/<name>] [--plan <approved plan>] \
	[--claude tests,build] [--electron tests,build] [--model sonnet|opus] [--start <step>] &
```

- **The lane brief** is one Markdown file. Its text before the first `## ` heading goes to every
  step (the ticket, its version, the approved plan, the decided notes). Then one section per step,
  `## tests`, `## build`, `## mutation` and `## review`, written as a step brief is written today
  (the review one keeps the template above, minus the two head lines), and `## pr`: the pull
  request's description, its first line the title, with the `fabrika close ticket <N>` line when
  the PR finishes the ticket. Every section is required. Each step's brief is the shared head, its
  section, and the lane's facts the chain fills in: the round, where the step starts, each step's
  head so far, what the last step said, `Reviewed head` and `Parent base` for a review, `T=` and
  `BUILD=` for a mutation. The chain saves each one as `BOXES/<lane>-chain<round>-<step>-brief.md`.
- **The moves:** tests done leads to build, build to mutation, mutation (done or skip) to review,
  and a merge-ready review pushes the branch as the bot, opens the PR (or finds the open one) with a
  steps-and-dollars table in its body, then runs `loosening.sh` from the lane's merge-base with
  `origin/main` to the reviewed head and posts its output on the PR as a comment (0014). Zero hits
  runs `catchup.sh`; any hit parks the lane as `ask` with the hit list, for the lead's hand check;
  an error, or a comment that did not post, ends it `stuck`. The chain passes no mapping table, so
  a renamed law is a hit too. A `send` goes to the step it names,
  with the sender's word in that step's brief. A send to plan parks: only the lead approves a plan.
  A lockfile ask parks with drive's own instructions. Any other refusal parks.
- **Retries and limits** (decided with the clanka walk, 2026-11-09): a step drive refused for a full
  laptop (`refused:agent_cap`, `refused:low_disk`) is retried on one named Effect `Schedule`,
  `slotSchedule`, and running out is a typed `RetriesExhausted`, reported as stuck with the schedule's
  name. Every limit is a `Context.Reference` with a default the environment may override:
  `WaitMinutes` 5 (`CHAIN_WAIT_MINUTES`), `MaxWaits` 6 (`CHAIN_WAITS`), `MaxStucks` 3
  (`CHAIN_STUCKS`), `MaxSteps` 16 (`CHAIN_STEPS`). Proven against the real `drive.ts` on 2026-11-09
  with the disk under the 20 GB floor: the step was tried, retried on the schedule, and the lane
  ended `stuck` with `RetriesExhausted` and drive's reason, exit 30.
- **Judgment** (an `ask:lead:question`, or a `stuck`): the chain runs one turn in the main
  checkout on the agents package's read-only Codex row, which cannot change the checkout, with the
  lane's state file and the step's report in its prompt. It answers one JSON object: `send` with a step and a note runs that step again
  with the note in its brief; `park` with why ends the lane for the lead.
  Its field row goes to `BOXES/<lane>-rows.jsonl` like a step's. Three stucks in a row on one
  step park without asking. Mutation's agent always runs on Claude, after its container run, and
  the `## mutation` section carries the `RELATED=<paths>` line; `--claude` names other steps that
  need Claude (Electron or socket work), `--electron` the ones that run the app.
- **Where it ends:** one JSON line, `outcome` `done` (landed, exit 0), `ask` (parked, exit 20,
  the why in `reason`) or `stuck` (exit 30). `state/<lane>.md` gets a `chain:` line for every move,
  so the status page reads the lane as before. `state/<lane>-chain.json` is the chain record, a
  Schema value (`ChainRecord`): one `StepRecord` per round, written before the step starts and again
  when it ends (drive's line, the judgment's answer), plus the PR number and when it landed, so a
  resume needs nothing in memory. The step state file, boxes, rows and exit codes are drive's own,
  unchanged. The chain holds every right (the bot's push, the PR, catch-up); a box and the judgment
  agent hold only their model login ([0028](../../../.decisions/0028-the-parent-holds-every-right.md)),
  and the steps run the unmodified harness through `drive.ts`.
- **Watching:** `tail -f BOXES/state/<lane>.md`. To stop a lane, stop the chain process: the
  running step's process group goes with it, and drive records that step as stuck. Start the chain
  again with `--start <step>` to go on from there: its rounds count on from the ones the chain
  record holds, so no earlier round's record, brief or judgment file is written over. Read the
  line's own `exit`, never the shell's: `volta run` answers 126 for any exit that is not 0.

## Pushes and protected refs

Keep the bot's explicit atomic push of notes plus branch. On a person's branch, notes-only as the
bot and branch-only as the person are two intended writes. A refusal stops the step.

When the session's permission check refuses a step agent its lead sign (`pnpm commits sign --step
lead` through the repo's scripts), its normal push (`botpush.mjs`, or a plain non-force push of its
own branch), or its merge of a passing test-only fix or a rows-only PR, the lead session runs that
same command itself, without asking the owner again
([0056](../../../.decisions/0056-lead-runs-a-refused-step-itself.md)). Only the script reads the key.
Report every other refused action to the owner with the exact command and worktree; never route
around it. A lane agent does not meet this for its landing: it stops at `land.ts ready` (step 8). A rows-only PR merges with `catchup.sh` on green CI with a clean leak grep; a test-only
fix still runs every step first.

`Cannot update this protected ref.` alone does not prove a push failed. Read the command's exit
status and the rule suite's overall result and named ref. In
[rule suite 4984058968](https://api.github.com/repos/usirin/tea-fabrika/rulesets/rule-suites/4984058968),
the update check named a person's branch, and the overall result was `bypass`: that push
succeeded through the owner's bypass. It did not show a refused notes ref. Keep real push failures
visible, and never weaken the rules to hide this message.

## Steps

1. **Plan.** Write a brief that names the ticket, its version, what to read and an older plan to copy
   the shape of. Run `runplan.sh` in the background. Save the answer as `BOXES/<name>-PLAN.md`.
2. **Check the unsigned plan.** Run `sh .agents/skills/plan/scripts/plancheck.sh --draft <plan>`.
   It checks sections, generators and file owners, and prints the whole body's hash.
   The exam listing is a total scan of the whole file, fences and link titles included.
   Read the list for paths the files-table parser may miss.
3. **Approve in the lead session only.** Read the whole plan, its laws and generators or labels,
   its decided notes and open questions. Plan writers and agents reviewing or revising a plan
   return it unsigned, with line one blank. The agent that wrote it sends it to the lead session for approval.
   After the read, fill line one with `Approved by the lead agent, builds <note>; body <sha256-12>`
   using the draft check's digest, then run `plancheck.sh --approved <plan>`. Any body edit,
   including an amendment, needs the same read and checks again. A new design call goes to the owner as one
   yes or no. Answer, in the plan, any open question a decided note already answers.
   A plan that patches or changes a package (tea, demlik, Manti, Effect, Alchemy) names what it
   read of that package's decisions, patterns and source; else send it back
   ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md)).
4. **Start the lane** on a `fabrikalfa/<name>` branch through `drive.ts`, never `box.sh new` by
   hand. Use `origin/main` for an independent ticket. A stacked child starts at the parent's signed build head, before the
   parent merges, as [Tier 1](../../../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) allows.
   Record the child, parent branch and signed head before starting it. Keep the child's tests
   when merging parent work in. Never replace them with the parent's older tests.
   box.sh new checks the approved plan, base and ticket.
5. **Run the steps in order,** in the background: tests, build, mutation, review. Each runs
   through `drive.ts`, except a step with Electron or socket work, which a Claude agent runs
   (above). No builder starts before tests that exist. Each brief names its skill.
   box.sh run --step checks order and slots, and saves the run row.
6. **After each step:** read drive's last line, the report and the diff, and log the run the same day:
   one `field/runs.jsonl` row (`fieldrow.py` for Codex, `clauderow.py` for a Claude agent, a
   driver included, once it has finished), and one `field/notes.jsonl` note for anything that
   broke, cost too much, needed a person or worked well. Send a fix to the step that owns the file.
   A test that breaks on one machine or in a box leans on that machine: send it to tests to remove
   the dependency, never to catch the error ([0052](../../../.decisions/0052-tests-never-depend-on-the-machine.md)).
   Step-commit checks file owners.
   Each correction the owner makes, and each slip of the lead's own, gets a note too, with the code
   that would have caught it. Running the steps by hand is how `next/`'s pipeline learns.
7. **Run what the box cannot,** yourself: Electron e2e and screenshots. One Electron app at a time,
   each run with its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`. Look at every shot.
8. **Ready to land.** A lane agent never signs as lead, pushes, opens the pull request or runs
   catch-up: the permission check refuses a subagent the lead key, and the lane stops
   ([0056](../../../.decisions/0056-lead-runs-a-refused-step-itself.md), ticket 652). Its last act
   is `land.ts ready` ([the template](#lane-brief-template)). The PR body file says which parts were
   this repo's steps, what ran each one, and the dollars.
9. **Land it** by [the plan's rule](../../../docs/plan/README.md#how-a-change-lands): the review says
   `merge-ready`, CI is green (e2e included), and you read the diff and run the leak grep.
   Every new or changed law is a property, or an example labeled vector, format, pinned or
   scenario with its reason.
   Zero hits from loosening.sh and the mutation arm-a vs arm-b comparison mean no owner read is needed.
   The lead records both outputs in the PR. A hit goes to the lead's hand check, with the hit list
   in the PR. Only real loosening waits on the owner.
   Did this PR change a row in docs/direction/follows/? It updates that row in the same PR ([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).
   Then the lead merges, product code included; a new design call is the only other wait ([0014](../../../.decisions/0014-the-lead-merges-when-every-step-passed.md)).
   Apply the labels rule and both zero-hit checks together. These are proper property tests.
   Run `sh .agents/skills/lead/scripts/loosening.sh <base> <head> <mapping.md>` on the PR's exam
   diff. The PR writes a mapping table with `Removed` and `Replacement` columns for every renamed
   or replaced law, using exact test titles. Save that table as `mapping.md` for the command.
   A pure addition needs no replacement row. `loosening.sh` fails closed: any exam-file change
   other than purely new tests or a rename listed in the mapping table is a hit. A pattern parser
   cannot cover every TypeScript form, so it names forms it knows but never clears a change it
   does not understand.
   Missing replacements, muted tests, removed assertions, fewer runs and tighter generated ranges
   are hits for the lead's hand check. Include the
   mutation step's narrowing list: a mutant main kills that the branch lets live is a hit too.
   Before this new check blocks anything, measure false alarms on the last 20 merged `next/`
   PRs and record the count. Do not claim that measure from generated tests alone.
   Never write "owner read" unless the owner did. Log each required owner read in a field note.
   An exam change that is all proper property tests merges without the owner's read (owner,
   2026-11-08). A change that loosens or removes a law still stays `ask owner exam_read`.
   Then the lead session runs `land.ts run <lane> <ticket>` in the background. It merges main in,
   signs, pushes and opens or updates the PR as the Scripts table says, then runs `catchup.sh`: it
   brings the PR up to
   date, signs only the new merge as `lead`, waits for every check on that exact head (e2e and
   commits included) and squash-lands it pinned to that head; a PR in a gh stack lands with
   `gh stack merge <pr> --squash --yes` once its head reads unchanged. Every PR squash-merges, a stacked
   parent too ([0004](../../../.decisions/0004-squash-merges-and-native-stacks.md)). A stack is a
   GitHub stack ([its commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)):
   `gh stack init <bottom> ... <top>` adopts the branches, `gh stack submit` opens the PRs,
   `gh stack merge <pr> --squash` lands bottom-up, and `gh stack sync --prune` rebases the rest
   onto main and pushes. Rebase by hand only locally (`gh stack rebase`, then `gh stack push`),
   never with the web "Rebase stack" button: it makes unsigned commits. The child's trees stay the
   same, so its links hold; if a tree changed, that child's steps sign again. A child keeps its own
   tests. It never signs a step's commit: an
   unsigned one goes back to its own step.
   After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.
   Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the
   driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.
   Before each removal, read MAIN's gitdir, common directory, object directory and all alternates
   from outside. Keep their paths and every link they use. Refuse any removal that contains one.
   Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates
   and any box that fails its guard.
   Print one line per retained item and continue. Cleanup never changes a landed merge's success.
   Saved plans, reports, logs and state/ remain.
   Box removal ignores untracked-only files and installs. It requires clean tracked files and
   every local branch, detached HEAD, stash and step-note tip retained in MAIN. Remote-tracking
   refs and object presence do not count. Fetch remote-only work into a retained MAIN ref first.
   HEAD, ORIG_HEAD, refs outside refs/remotes/ and reflogs outside logs/refs/remotes/ need that proof; FETCH_HEAD is a fetched copy, and ORIG_HEAD and config.worktree are ordinary metadata. Keep operation or linked-worktree
   metadata, unknown state, and any pair holding MAIN or BOXES/state.
   An annotated tag's own object ID must be reachable under MAIN's retained refs. Keeping only
   its commit loses the annotation. This also applies to signed tags and tags pointing at tags.
10. **After the merge:** `catchup.sh` closes each ticket the description names on a line of its
    own, `fabrika close ticket <N>`, so put that line in when the PR finishes the ticket
    ([0015](../../../.decisions/0015-a-pr-phrase-closes-its-tickets.md)). Write the `MergeRow`,
    then `git pull --ff-only origin main` and `pnpm install --frozen-lockfile` in the main checkout, plus any build the app needs to start. The owner runs the app from there and
    never pulls or installs first. If the pull refuses, because of local edits or another branch,
    leave them and tell the owner in one line.

## Tickets and tracker posts

Every ticket for this repo goes in the app's own tracker, through its `tracker_file`,
`tracker_comment` and `tracker_close` tools. Never open a GitHub issue on this repo. GitHub issues
are for other people's repos only.

- Every lane gets a ticket before its agent starts. File one if it is missing.
- Each brief names the ticket and a short writer name, such as `door-fix`.
- The agent posts when a real step starts, on a finding that matters, when blocked, when a pull
  request opens or is pushed, and when done. Not after every command.
- A post is 2 to 5 plain lines with full pull request URLs. No security holes, secrets or personal
  names: the tracker will be shared.

## Outside your task

Something wrong that your task does not cover is one finding row with proof, then keep going:
never a fix, a ticket or only a mention, and never a security hole.
Decision [0035](../../../.decisions/0035-outside-work-becomes-finding-rows.md) says why.
[A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
counts as proof. The CI `field` job checks each added row's shape.

- **Every brief says it in one line,** for an agent that reads no skill: outside work is a finding
  row, see `field/README.md`.
- **A step hands its rows over** in its report or answer, one JSON line each. Add each to
  `field/findings.jsonl` unchanged the same day, in the pull request it was found during or a
  rows-only one. Change only an `id` that is already taken. Never drop a row because you disagree
  with it: a wrong one is rated `noise`.
- **Never rate a row.** A person does. When the owner rates one, write the `rated` row as their
  call, and for a `fix` file its ticket with `tracker_file` and put the number in that row.
- **A `flaky_test` does not wait** for its rating: it gets a ticket and a fix the same day
  ([0036](../../../.decisions/0036-a-flaky-test-is-fixed.md)).

## Lead tooling is fast-tracked

Skills, the lead scripts and the drive script run on our own laptop, so they are not product work
(owner, 2026-11-09). They skip the plan, tests, mutation and review steps. The lead or one agent
changes them directly, keeps each change small, and merges on green CI with a clean leak grep.
Product code (`next/` and today's app) keeps its steps.

## Decisions land at once

Decisions live in `.decisions/`, one file per decision
([0001](../../../.decisions/0001-decisions-live-in-the-repo.md), owner, 2026-11-09). The whole path:

```text
owner decides -> write .decisions/NNNN-slug.md -> its own docs PR -> merge on green
```

- **Write it the turn it is decided,** with a docs agent using [the adr skill](../adr/SKILL.md),
  in the shape the adr skill gives. Link its `docs/direction/` note when
  one exists.
- **One decision, one PR.** Never batch decisions, and never wait for a code PR or for the end of
  the day.
- **Merge on green.** A docs-only PR that writes down a decision is merged when CI is green and the
  leak grep is clean, with no plan, tests, review or field rows. Code PRs keep their steps.
- **Search before you ask.** Before the lead or any step asks the owner or writes a plan, it
  searches `.decisions/`, `.glossary/` and `docs/direction/` for the topic.
- **Ask in plain words, from the code.** Before a question to the owner, read the code it is about
  and that package's decisions, as [0054](../../../.decisions/0054-read-upstream-before-patching-it.md)
  asks of upstream. Then say what the code does, what breaks, each option with its cost, and your
  lean with how sure you are. An abstract question comes back to be asked again.
- **Read what a diff touches.** Before a review and before a merge, run
  `sh .agents/skills/lead/scripts/governance.sh` on the branch. It lists the decision files the
  diff's words touch. The review step and the lead read each one and say whether the diff walks it
  back. It only lists for now; it blocks later, once its false alarms are measured.

The lead owns the count of decisions still missing from the repo. Its status gives that count and
the open docs PRs carrying them. The owner does not keep the list. Code cannot count decisions
nobody recorded.

The leak check fails closed (owner, 2026-11-08): any hit stops the push or merge for the lead's
hand check.
A flagged line that only respaces a line the same file's diff removes is old text, and is not a
hit (owner, 2026-11-09, ticket 500). Spaces put inside braces and a line wrapped another way are
still new text.
A push reads each commit it sends on its own, beside the branch's net change (owner, 2026-11-10,
[0048](../../../.decisions/0048-leak-check-reads-each-commit.md)): `botpush.mjs` runs
`leakgrep.sh --commits <source> --not --remotes=origin`. A hit names its commit, and a later
commit does not clear it.

## Go easy on the machine

- One Electron test app and one Docker box at a time. Every wait or poll loop runs in the background.

## Never

- Write a step's work, run git inside a box, or reset a branch to take a step's work over.
- Rebase, force-push or `gh pr update-branch`, except a stacked child moved with `gh stack` (0004).
- Read, print or copy a key. Leave a box, a claim or a half-open pull request behind without saying so.

## When a run teaches something

Update the skill it teaches, in the same pull request as the field note. A rule that lives only in
one brief is lost with that brief.
