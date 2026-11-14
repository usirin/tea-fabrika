---
state: "decided 2026-11-11"
summary: "Step 1 to 3 of decision 0059's order, before `next/`'s pipeline is designed, redone on the teams where agents do most of the work (0059's ticket 645 amendment); today's version is the evidence. The loop in plain words (decide, shape, do, check, ship, learn), then in fabrika's words, then seven principles: a person's attention is the scarce budget (F1); a ticket with intent, run to one pull request with proof (F2); check in layers and place people by risk (F3); every miss becomes a check the same day, and stale rules leave (F4); the repo is the memory and the top file a map (F5); one writer per change (F6); code holds the edges, the agent the path inside a step (F7). The first draft's W1 to W6 are mapped onto them. Ticket 574 traced through it. From experiment 250."
---

# How we get work done

**Decided 2026-11-11.** Redone on the teams where agents do most of the work, as 0059's amendment
of ticket 645 asked. The owner walked this study on 2026-11-10 and approved the seven principles
below as the starting point on 2026-11-11
([0127](../../.decisions/0127-how-we-get-work-done-seven-principles.md)). The leans' confidence
numbers stay as written. Already decided: the order of design, work first and
the pipeline last ([0059](../../.decisions/0059-pipeline-starts-from-the-work.md)); this study's
five-part plan, with ticket 574 as its running example and the loop starting at "decide what to
work on next" (0059's amendment, 2026-11-10).

Built from [experiment 250](../../experiments/250-how-we-get-work-done.md), which read how the teams
that build coding agents, and use them, get work done, checked them against agent fleets, single
builders and outside measurements, and read `field/` for what really happens here. It is not a
measurement. This is step 1 to 3 of 0059's order: the loop in plain words, then in fabrika's words,
then guidelines. It designs no pipeline and adds no code. Source tags such as [a1] are the
experiment's.

This area has no screen, so the guidelines skill's step 5 (designs shot next to Linear) does not
apply. There are no shots and no Design canvas. The page traces ticket 574 instead.

```text
the loop, with ticket 574 traced through it (today's version, 2026-11-10, Pacific)

decide   a test box on ticket 576 fails: the test setup reads the home folder
         the owner rules it goes; decision 0052 merges 11:50; ticket 574 is filed
shape    the lead approves a plan that builds 0052, laws L1 to L5
         A1 11:52  the test writer: the linter lacks the rule the plan named
         A2 12:38  mutation stuck twice: the code ran only at file load
do       tests 8 rounds (4 done), build 7 rounds (5 done), 11:48 to 13:18
         tests stuck twice on fetch_failed: the tools, not the work
check    mutation: 17 killed, none left; review: sent back once, then done
         loosening.sh: 2 hits; the lead's hand check: both laws got stricter
ship     PR 787 lands 13:28 on green CI, no owner read (0014)
learn    a field note names four causes; none becomes a ticket or a finding
cost     $19.47 at list price, 70 agent minutes; $8.81 went to rounds that stalled
```

## Which version

- **Today's version:** all the evidence. Ticket 574, the lead's tooling (`drive.ts`, `chain.ts`,
  `land.ts`) and today's paused lane (`packages/pipeline`).
- **`next/`:** what the principles are for. Its pipeline is designed on them, last, as 0059 says.
  None of the loop is built in `next/` yet.

## The loop, in plain words

No fabrika words in this section, as 0059 asks.

| Part | Who decides | What is handed over | What "done" means |
|---|---|---|---|
| Decide what to work on next | the person who owns the goals | one piece of work with a reason | it is picked, and someone has it |
| Shape it | the goal owner, or someone they trust | a short plan: what changes, how we will know, how much time it is worth | the plan is agreed, and its limits are clear |
| Do it | the doer | the change, and what the doer saw on the way | the change exists and the doer thinks it meets the plan |
| Check it | someone other than the doer, and the rules | a yes, or a no with the reason | every check passes, or the work goes back with why |
| Ship it | whoever holds the gate | the change, live | people can use it |
| Learn from it | everyone who touched it | what broke, what cost too much, what worked | the lesson is in the written way of working |

## The known way

The teams that build coding agents and use them to build those agents (Anthropic, OpenAI, Google,
Cursor, Cognition), checked against Stripe, StrongDM, Ramp, single builders and METR's
measurements ([experiment 250, the answer](../../experiments/250-how-we-get-work-done.md#the-answer)):

- **Agents write most of the code, and a person's attention is the scarce thing.** About 90% of
  Claude Code's code [a1], 75% of Google's new code [g1]; "the only fundamentally scarce thing is
  the synchronous human attention of my team" [o2]. All company claims.
- **Reading moved to machines; people look by risk.** Seven layers of checks, then nobody, one or
  two people, set from the change, not the author [a1]. This is the biggest split: Stripe has a
  person read every PR [s1], OpenAI's harness team reads after merge [o2], StrongDM never [f1].
- **The unit is a ticket or thread with intent, run by one agent to one PR with proof** [o4, s1,
  d3, r2].
- **Every miss becomes a rule, a skill or a check, the same day**, and stale rules leave when a
  newer model no longer needs them [a1, o3, b1, b2, a4]. The one thing every source agrees on.
- **One agent writes; the rest read, review or advise** [d2, g3]. Many writers trade errors for
  speed [c2, a5].
- **The plumbing breaks next:** source control, CI, build times [a2, a3, o2].
- **The labs are moving from fixed steps to goals** [a4; o5, secondary]. Stripe's fixed nodes
  around agent nodes are the counter-example [s2].

Outside measurements warn against trusting a green check alone: about half of test-passing agent
patches "would not be merged into main by repo maintainers" [m2], and failed agent PRs are larger
[m4].

The first reading, of human teams (Toyota, Lean, Shape Up, kanban, a kitchen, surgery, the
cockpit), was turned down as the lens on 2026-11-10 and stays in the experiment as background.

## What really happens here

All of it today's version, from `field/` on 2026-11-10:

- **236 step runs** over 24 tickets on 2026-11-09 and 11-10: 50% done, 22% sent back, 22% stuck,
  4% ask, 3% skip.
- **The test writer stalls and costs the most:** 31 of 101 runs stuck, 16 of them `fetch_failed`
  (the tools could not collect the commit), and $117.91 of about $239.
- **No step asked the owner.** All 9 asks went to the lead. 89 of 554 notes say a person was
  needed, mostly for design calls, the owner correcting the lead, and tooling knots.
- **Nothing records the owner's time,** the budget the frontier counts first.

## In fabrika's words

Checked in code or settled notes, version named in each row. The ledger's word for a recorded fact
is **event** in `next/` (renamed 2026-11-08); today's code says fact.

| Part | Today | `next/`, by settled notes |
|---|---|---|
| Decide | the owner orders tiers in `docs/plan/`; the lead picks lanes and files tickets with `tracker_file`; `triage` is in `STEPS` but paused | `ticket`, `tracker`, `triage`, `area`, `label`; no priority; a label never routes |
| Shape | a plan file approved on its line 1, by the lead when it builds a decided note | a `plan` with criteria and properties, approved by version and hash |
| Do | `test_writer` and `build`, run by `drive.ts`, chained by `chain.ts` (a tea machine) | steps are tea machines that answer in five verbs; an `attested` link per commit, checked by `next/`'s exam |
| Check | `mutation`, `review`, CI, `leakgrep.sh`, `loosening.sh`, the lead's hand check | `mutation`, `review`, the `exam`; a person only for a `judgment` |
| Ship | `land.ts queue` under the lead, into GitHub's merge queue (0014, 0162) | `ship`, the one merge authority |
| Learn | `field/` rows and notes, findings a person rates, `.decisions/` | a `finding` row until Tier 6; `asked` and `answered` events, with `needed` |

The full table, with a source for each name, is in experiment 250, part 8.

## The seven principles

### F1: spend people's attention as the scarce budget

**Lean, 85%.**

- **What it means:** every step is built so a person looks only where their look changes the
  outcome. Each look is counted: who, when, on what, how long.
- **Why:** "the only fundamentally scarce thing is the synchronous human attention of my team"
  [o2]; engineers juggled three to five sessions before switching cost won [o5, secondary];
  "verification definitely becomes a bottleneck" [o7]; Hashimoto turns notifications off [b2];
  Anthropic tracks approvals, comments and wait time per PR [a1].
- **Linear as the builder:** an agent session asks a person only through an `elicitation` or an
  `error` activity, and the person's answer is a `prompt` no agent can write (experiment 186). Each
  ask is a visible, countable thing on the ticket. Counting the minutes a look takes is ours.
- **Elm or OTP:** OTP sends a problem up to the parent only after a burst of failures (restart
  intensity). Here the person is the parent: asked last, and only with a choice to make.
- **What holds it:** a law later: every ask and every look is an event, from day one. Today
  nothing records it.
- **Doubt:** at two people, attention may matter less than taste.
- **Cost:** one event per look.
- **Ticket 574:** half. The owner looked once, at the rule, and nothing else asked him. But no look
  by anyone was recorded.
- **Since the walk:** [0096](../../.decisions/0096-the-lead-fixes-forward-while-the-owner-is-away.md):
  while the owner is away, the lead leaves pull requests to read, not questions, and the owner hears
  one line only when something cannot wait.
  [0082](../../.decisions/0082-approvals-is-a-floor-for-every-run.md): how many people must approve
  is one repo setting, `human-approvals`, a floor no run goes under, and an agent's look never
  counts.

### F2: the unit is a ticket with intent and evidence, run to one PR with proof

**Lean, 80%.**

- **What it means:** a person writes what, why and how we will know. One agent run turns it into
  one pull request that carries its proof: checks, shots where there is a screen, a short write-up.
  Small means cheap to check and cheap to undo, not short in time.
- **Why:** Symphony maps each open tracker issue to one agent workspace [o4]; Stripe [s1],
  Cognition [d3] and Ramp [r2] start from a thread or a ticket and end at a PR with proof; failed
  agent PRs are larger [m4]; "one item per loop" [b1].
- **Linear as the builder:** Linear Agent writes code in a coding session started from an issue,
  and its Reviews view shows the diff (experiment 186). The issue is the intent; the session is the
  run.
- **Elm or OTP:** one worker process per job, as Symphony keeps one workspace per issue. Its result
  comes back to the parent as one message.
- **What holds it:** law in part. A plan's line 1 carries its approval and a hash of its body
  (AGENTS.md). Proof on the PR is taste today.
- **Doubt:** fabrika's plan step may be heavier than the frontier's (Stripe starts from a thread).
- **Cost:** proof costs tokens per PR.
- **Ticket 574:** follows. One ticket, one plan, one PR; the proof was CI and `loosening.sh` in a
  PR comment.
- **Since the walk:** [0099](../../.decisions/0099-no-number-caps-a-pull-request.md): no number
  caps a pull request; a plan cuts big work into slices that each land whole with their tests.
  [0100](../../.decisions/0100-a-slice-over-its-own-estimate-goes-back-to-the-plan.md): a slice
  past twice its own plan's estimate goes back to the plan.

### F3: check in layers, and place people by risk

**Lean, 75%.**

- **What it means:** machines read every change. A rule read from the change, never from who wrote
  it, decides how many people must look. An agent's yes never counts as a person's. The builder
  never writes its own exam.
- **Why:** Anthropic's seven layers, then nobody, one or two people [a1]; Stripe's "at most two
  rounds of CI" [s1]; review after merge [o2]; StrongDM's hidden scenarios [f1]; passing tests is
  not mergeable [m2].
- **Linear as the builder:** an agent session's `error` state covers every stop alike (experiment
  186). We differ: a stop says whose defect it is (see "Also" below).
- **Elm or OTP:** OTP's supervisor decides from a child's exit reason. A check's answer is a reason
  the parent reads, never a flag.
- **What holds it:** law. Today: plan, tests, build, mutation and one review, each by its own
  agent; the lead reads every diff, CI and the leak grep; the owner reads only real loosening
  ([0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md)),
  [nobody writes their own exam](./nobody-writes-their-own-exam.md).
- **The lean as walked:** keep the exam rule; add a risk tier per PR set from the paths it touches;
  try one holdout set of scenarios the builder can't see.
- **Doubt:** the evidence is company claims plus one METR warning. Settled by counting later fixes
  per tier on merged PRs.
- **Cost:** a classifier and its false-alarm count (about 0% to block).
- **Ticket 574:** half. Mutation, review, CI, `loosening.sh` and the lead's hand check all ran. No
  tier, so the lead read it as it reads every PR.
- **Since the walk:** the guess "a risk tier set from the paths it touches" was **wrong**, and stays
  here marked as wrong. [Experiment 252](../../experiments/252-risk-tiers-on-phoenix.md) replayed
  path tiers on 457 merged pull requests of kamp-us/phoenix: the high tier was not above the medium
  one in later fixes (7.4% against 9.8%), while size alone separated them (1.3% at 50 lines or
  fewer, 11.6% over 400). [0079](../../.decisions/0079-size-counts-governed-paths-name-who.md)
  replaces that part of the lean: size sets how many people look, governed paths set who.
  [0082](../../.decisions/0082-approvals-is-a-floor-for-every-run.md) adds the floor.

### F4: every miss becomes a check, a rule or a skill the same day; and stale rules leave

**Lean, 85%.**

- **What it means:** a mistake ends in code that prevents it where it can, and prose only for
  judgment. Each failure note links to the check, ticket or "no change" it led to. When a newer
  model makes a rule useless, the rule is deleted.
- **Why:** a missed bug becomes a line in `CLAUDE.md`, a skill or a check [a1]; repeated review
  comments become docs and checks on a weekly cleanup day [o3]; a line per bad behavior [b2]; a
  "sign" per repeated mistake [b1]; harness parts encode "an assumption about what the model can't
  do on its own", so they come out when it can [a4].
- **Linear as the builder:** No Linear answer: the study read Linear's sessions, not how Linear's
  team turns a miss into a rule.
- **Elm or OTP:** OTP's `code_change` moves a running process to new code and keeps its state: the
  standard changes while the work goes on.
- **What holds it:** a check later: a note of kind failure with no link. Today a finding row is
  rated by a person ([0035](../../.decisions/0035-outside-work-becomes-finding-rows.md)), and "a
  rule in a prompt that could be code becomes code" (AGENTS.md).
- **Doubt:** deletion needs proof a rule is stale.
- **Cost:** one link per note, one pass a week.
- **Ticket 574:** breaks. Note 2026-11-10-25 names the branch move and the box limits, and nothing
  picks them up.
- **Since the walk:** [0077](../../.decisions/0077-mutation-gaps-carry-a-category.md): each real
  mutation gap carries a category, and the second gap of one category files one ticket for the
  tests step to catch the whole category.

### F5: the repo is the memory; the top file is a map

**Lean, 75%.**

- **What it means:** a fresh agent learns everything from files. The top file is short and points
  to decisions, notes, plans and progress files. Rules live near what they govern, or become
  checks.
- **Why:** a short `AGENTS.md` as a table of contents into `docs/` [o1, secondary; o2]; a shared
  `CLAUDE.md` [a1]; a progress file and a feature list that fresh sessions read [a6]; handoff notes
  [c2]; rule files scoped by folder [s2]; "repository structure is part of the prompt" [o3].
- **Linear as the builder:** an agent rebuilds its context from the session's activities, not from
  comments (experiment 186). The record is the memory, not the agent.
- **Elm or OTP:** state that must survive a restart is stored, and the recovery path reads it
  ([0037](../../.decisions/0037-implicit-state-machines-made-explicit.md)'s third test). An agent is
  a process that restarts every run.
- **What holds it:** taste today. This is already fabrika's habit: `.decisions/`, `docs/direction/`,
  `.glossary/`, one fresh agent per step reading a state file. But AGENTS.md is about 685 lines.
- **Doubt:** no measurement here that a long file hurts. Settled by running the same step with the
  long and the short file.
- **Cost:** a rewrite of the most-read file.
- **Ticket 574:** half. Each fresh step agent read the plan and its amendments. But the plan and
  chain files live outside the repo, and the first plan body is lost.

### F6: one writer per change; other agents read, review and advise

**Lean, 70%.**

- **What it means:** a ticket's code has one writing agent at a time. Other agents may research,
  review or test beside it, and write nothing to the branch.
- **Why:** "writes stay single-threaded" [d2]; independent agents amplified errors 17.2x, against
  4.4x with a coordinator [g3]; Claude Code's agent teams keep two teammates out of one file [a9].
  Cursor's many writers paid in churn [c1, c2].
- **Linear as the builder:** No Linear answer: one session per agent is all the study read; it
  says nothing on two agents writing one change.
- **Elm or OTP:** one process owns its state, and others only send it messages. No shared writes.
- **What holds it:** law in part. One lane per ticket, steps in a row, chained by `chain.ts`
  (today's lead tooling). The test writer and the builder are two writers in turn on one branch.
- **Doubt:** two writers in turn (tests, then build) is a form the sources do not discuss. Settled
  by comparing send-backs between them in `field/`.
- **Cost:** less parallel speed inside a ticket.
- **Ticket 574:** follows. Tests and build wrote in turn on one branch; mutation and review only
  read.
- **Since the walk:** [0093](../../.decisions/0093-laws-walk-plants-run-once.md), a trial: its
  second check had a fresh agent write laws from the plan alone, blind to the old tests.
  [Experiment 257](../../experiments/257-second-check-blind-laws.md) found it killed the same 98 of
  144 mutants as the old file: a second reader that writes only its own check file.

### F7: code holds the edges; the agent holds the path inside a step

**Lean, 70%.**

- **What it means:** code owns what must always happen: start, claim, checks, merge, stop, record.
  Inside a step, the agent gets a goal and the checks, not a script.
- **Why:** fixed nodes "reduce the chances for the agent to err" and save tokens [s2]; fixed
  transitions were too rigid [o5, secondary]; structure comes out as models improve [a4]. The
  frontier pulls hardest against fabrika here.
- **Linear as the builder:** a session's states are set by Linear "based on the last emitted
  activity", while the agent chooses its own path inside the session (experiment 186). The edges
  are Linear's; the path is the agent's.
- **Elm or OTP:** Elm's parent steps its children by hand; `update` is the edge, and the agent is a
  command whose result comes back as a Msg.
- **What holds it:** law. Every state machine in `next/` is explicit and a tea machine
  ([0037](../../.decisions/0037-implicit-state-machines-made-explicit.md),
  [0046](../../.decisions/0046-one-tea-machine-per-file.md)); the lane's moves are code in
  `chain.ts` (today's version).
- **Doubt:** OpenAI's lesson is secondary, and our own data is two days. Settled by running the
  same tickets through today's fixed steps and through one goal-plus-checks agent.
- **Cost:** none to keep; an experiment to test.
- **Ticket 574:** half. The chain ran the lane with no agent holding it. But at one edge,
  collecting a stuck commit moved the branch, and the lead fixed it by hand.
- **Since the walk:** [0064](../../.decisions/0064-the-lead-drives-with-flows.md): the lead drives
  work as a flow, a list of typed steps one program runs, and no agent holds a loop.
  [0074](../../.decisions/0074-agent-hands-over-a-flow.md): an agent that composes work hands
  fabrika a flow as data, so the goal is the agent's and the loop is fabrika's.
  [0070](../../.decisions/0070-flow-runner-stays-a-machine.md): the flow runner stays a plain tea
  machine for now.

### Also: the tools are a first-class source of defects

Not an eighth principle; it lives inside F3's layers as a stop reason of its own. A stop says
whether the work is wrong or the tools are, and the two go to different owners. Anthropic's CI and
source control [a2, a3], its quality postmortem [a8] and OpenAI's build times [o2] all broke before
the work did. Here, 16 of 31 stuck test-writer runs were `fetch_failed`.

**Since the walk:** [0076](../../.decisions/0076-a-lane-stops-at-its-budget.md): every stuck step
says its fault, `tool` or `work`; a tool fault files a finding and drains one tool budget shared by
all lanes, and does not count against the lane.
[Experiment 254](../../experiments/254-how-a-lane-should-stop.md) sorted about 35 of 41 stuck steps
on the five longest lanes as tool faults.

## What became of the first six

The first draft's six principles came from the human-team reading. Tested against the frontier
([experiment 250, part 6](../../experiments/250-how-we-get-work-done.md#part-6-the-first-drafts-six-principles-tested)):

| First draft | Verdict | Where it went |
|---|---|---|
| W1 one loop, six handoffs, each with an owner and a done | changes shape: check is many layers, and learn runs on every miss | F3 and F4; the handoffs are recorded facts, not a fixed path (F7) |
| W2 pull new work only when there is room | changes shape: what is capped is people's attention and the plumbing, not work in flight | F1 |
| W3 shape first, change the plan in the open | holds, and changes: shape the intent and the check; for code, redo is often cheaper than amend | F2 |
| W4 stop at the first defect, say whose | half breaks: "whose" holds; stopping at every defect is walked back where a change can be undone | F3, and "Also: the tools" |
| W5 ship small | holds, with small meaning cheap to check and undo | F2; since the walk, 0099 |
| W6 a lesson lands in the written way of working | holds, the strongest of the six; code beats prose | F4 |

F5 and F6 are new: the human-team reading had no answer for an agent's memory or for many agents
on one change.

## What the ledger records

Nothing new is designed here. The study found facts that are lost because they are not recorded
now: each look by a person and how long it took (F1), who filed a ticket and when, who wrote the
first plan and its body, the lead's own checks, and the owner's time. A later pipeline note decides
where each goes.

## Where this differs from settled notes

- [Pipeline guidelines](./pipeline-guidelines.md) says whoever designs `next/`'s lane "starts from
  this note". 0059 already moved that note to input. Nothing here walks back its twelve principles;
  the "Also" adds "whose defect" on top of its P3.
- [Pipeline strategies](./pipeline-strategies.md) is proposed and asks "can a later change undo the
  harm?". The frontier answers the same way: stops stay where harm cannot be undone.
- F3 pulls against today's rule that the lead reads every diff (AGENTS.md). That is Branch A, the
  biggest split, and this note does not change the rule; 0079 and 0082 say how many look.
- F5 pulls against the length of AGENTS.md. Nothing changes until the experiment F5 names has run.
- [Every pull request goes through the steps](./next-is-a-pipeline-pre-run.md) is unchanged. The
  steps by hand keep running.

## What it costs

- One study now. The pipeline's design, 0059's step 4, waits for the owner's yes on these seven.
- F1, F4 and the "Also" each add an event, a link or a field. F2 costs proof tokens per PR. F3
  costs a count of false alarms before anything blocks. F5 is a rewrite of AGENTS.md. F6 gives up
  parallel speed inside a ticket.

## What it cannot tell us

- Almost every frontier number is a company's own claim. Only METR, Google Research and two GitHub
  studies measure from outside, and none measures a team where agents write most of the code.
- OpenAI's posts are known only through other pages; openai.com refused every fetch.
- No source is a two-person team. What carries over to two people is a judgment.
- The clean step data here is two days and 24 tickets.
- Ticket 574 is one easy ticket: it built a decision already made.
- Whether these principles make work faster or cheaper. Nothing measured that.
- The owner's time, which nothing records.
