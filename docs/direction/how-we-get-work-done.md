# How we get work done

**Proposed 2026-11-10.** Already decided: the order of design, work first and the pipeline last
([0059](../../.decisions/0059-pipeline-starts-from-the-work.md)); this study's five-part plan, with
ticket 574 as its running example and the loop starting at "decide what to work on next" (0059's
amendment, 2026-11-10). Nothing below is decided yet.

Built from [experiment 250](../../experiments/250-how-we-get-work-done.md), which read eleven sources
on how work gets done and read `field/` for what really happens here, and a private page, "How we
get work done". Neither is a measurement. This is step 1 to 3 of 0059's order: the loop in plain
words, then in fabrika's words, then guidelines. It designs no pipeline and adds no code.

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
  `catchup.sh`) and today's paused lane (`packages/pipeline`).
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

The makers agree on six things ([experiment 250, part 2](../../experiments/250-how-we-get-work-done.md#part-2-what-they-agree-on)):
stop at the first defect; limit what is in flight and pull new work only when there is room;
shape before you start; ship small; write the current way down and improve that; learn as a
habit and blame no one. Toyota, Lean, Shape Up, Linear, DORA, kanban, a kitchen line, the WHO
surgical checklist and cockpit checklists each hold some of these.

One clash with a goal of ours: Shape Up's six-week bet and Linear's 1 to 3 week projects are sized
for people. An agent does a ticket in hours, so their "cycle" is too long to use as it is.

## What really happens here

All of it today's version, from `field/` on 2026-11-10:

- **236 step runs** over 24 tickets on 2026-11-09 and 11-10: 50% done, 22% sent back, 22% stuck,
  4% ask, 3% skip.
- **The test writer stalls and costs the most:** 31 of 101 runs stuck, 16 of them `fetch_failed`
  (the tools could not collect the commit), and $117.91 of about $239.
- **No step asked the owner.** All 9 asks went to the lead. 89 of 554 notes say a person was
  needed, mostly for design calls, the owner correcting the lead, and tooling knots.

## In fabrika's words

Checked in code or settled notes, version named in each row. The ledger's word for a recorded fact
is **event** in `next/` (renamed 2026-11-08); today's code says fact.

| Part | Today | `next/`, by settled notes |
|---|---|---|
| Decide | the owner orders tiers in `docs/plan/`; the lead picks lanes and files tickets with `tracker_file`; `triage` is in `STEPS` but paused | `ticket`, `tracker`, `triage`, `area`, `label`; no priority; a label never routes |
| Shape | a plan file approved on its line 1, by the lead when it builds a decided note | a `plan` with criteria and properties, approved by version and hash |
| Do | `test_writer` and `build`, run by `drive.ts`, chained by `chain.ts` (a tea machine) | steps are tea machines that answer in five verbs; an `attested` link per commit, checked by `next/`'s exam |
| Check | `mutation`, `review`, CI, `leakgrep.sh`, `loosening.sh`, the lead's hand check | `mutation`, `review`, the `exam`; a person only for a `judgment` |
| Ship | `catchup.sh` under the lead (0014) | `ship`, the one merge authority |
| Learn | `field/` rows and notes, findings a person rates, `.decisions/` | a `finding` row until Tier 6; `asked` and `answered` events, with `needed` |

The full table, with a source for each name, is in experiment 250, part 4.

## The six principles

### W1: one loop, six handoffs, each with an owner and a "done"

**Lean, 85%.**

- **What it means:** every piece of work moves through the same six parts. Each part has one owner,
  hands over one thing and has a "done" anyone can check.
- **Why:** standard work is "the object of continuous improvement" [l2]; you map "every step" of
  the flow before you change it [l1].
- **Linear as the builder:** a ticket's timeline would show the six parts as its history, with the
  tracker owning "decide" and each step owning its part. Guess, from [n1]'s triage inbox.
- **Elm or OTP:** each handoff is a Msg from a child to its parent, and the parent steps the next
  child (Elm's parents step children).
- **What holds it:** taste today. A law once `next/`'s lane exists: each part writes its handoff.
- **Doubt:** six may be one too many for small work. Settled by sizing a few tickets on it.
- **Cost:** a row or event at every handoff.
- **Ticket 574:** half. Every handoff happened, but three left no row: who filed it, who wrote the
  first plan, and the lead's own checks.

### W2: pull new work only when there is room

**Lean, 75%.**

- **What it means:** a fixed cap on work in flight. A new lane starts only when one finishes or
  frees a slot.
- **Why:** a kanban team "must explicitly control the number of work items" [k1]; Shape Up has a
  "circuit breaker" so "one project doesn't overload the system" [s1].
- **Linear as the builder:** a cap would sit with the person's inbox, not the steps: work waits in
  triage until it is pulled [n1]. A cap count is not in the Linear pages read, so that part is
  ours (guess).
- **Elm or OTP:** OTP has no work cap built in. The nearest is a supervisor with a fixed set of
  children. Where we leave it: the cap is a count in the parent's model.
- **What holds it:** law, later. Today the cap of 12 agents is prose in AGENTS.md.
- **Doubt:** with agents the cap may be the laptop or the owner's attention, not the work. Settled
  by counting both.
- **Cost:** some work waits even when an agent is free.
- **Ticket 574:** follows. One lane, run by the chain, inside the lead's cap.

### W3: shape before you start, and change the plan in the open

**Lean, 80%.**

- **What it means:** work starts from a short plan with its limits. When a later part learns the
  plan is wrong, the plan changes as a dated amendment, signed again, never as a silent edit.
- **Why:** shaped work "tells the team where to stop" [s1]; the surgery time out re-checks the plan
  just before the act [o2].
- **Linear as the builder:** the plan would be the ticket's own text, with each amendment a dated
  entry on its timeline. Guess.
- **Elm or OTP:** the plan is model; an amendment is a Msg that `update` handles. Nothing edits the
  model by hand ([0046](../../.decisions/0046-one-tea-machine-per-file.md)).
- **What holds it:** law. The plan's line 1 already carries a hash of its body, and an edit forces a
  new line (AGENTS.md).
- **Doubt:** how big a change may be an amendment before it needs a new plan. No data yet.
- **Cost:** a re-approval on every amendment.
- **Ticket 574:** follows. A1 and A2 are both in the plan, signed again. Both came from later steps.

### W4: stop at the first defect, and say whose defect it is

**Lean, 80%. The first half is decided** (P3 in [pipeline guidelines](./pipeline-guidelines.md),
[jidoka and andon](./jidoka-and-andon.md)).

- **What it means:** a stop says whether the work is wrong (a red law, a review finding) or the
  tools are (a commit not collected, a box that cannot run a check). The two go to different
  owners.
- **Why:** Toyota's andon shows where and what [t1]. Here, 16 of 31 test writer stops were the
  tools, and each sent a person to find out.
- **Linear as the builder:** Linear's agent session has one `error` state for both (experiment 186).
  We differ: the reason says whose it is.
- **Elm or OTP:** OTP's exit reason says why a process ended, and its supervisor decides from it.
- **What holds it:** law. A stop's reason is a closed list, each case with its owner.
- **Doubt:** some stops are both. Settled by tagging a week of stops by hand.
- **Cost:** a second field on every stop.
- **Ticket 574:** breaks. `fetch_failed` and the moved branch were the tools' defects, but read as
  the step's.

### W5: ship small

**Lean, 85%.**

- **What it means:** one ticket, one pull request, small enough to land the same day.
- **Why:** "make each change as small as possible", since "smaller changes are also easier to
  recover from" [d1].
- **Linear as the builder:** small projects of "1–3 weeks with a team of 1–3 people" [n1], scaled
  down to agent hours: a ticket is a few files.
- **Elm or OTP:** no Elm or OTP answer: batch size is about the work, not the runtime.
- **What holds it:** taste, with a size shown on each pull request.
- **Doubt:** some decided notes need a big change at once. Settled by how often a ticket splits.
- **Cost:** more pull requests, and more step runs per line of change.
- **Ticket 574:** follows. 6 files, +289 and -48, about 100 minutes from decision to merge.

### W6: a lesson lands in the written way of working

**Lean, 75%.**

- **What it means:** each cause a note names ends in a ticket, a finding, a decision or a skill
  change. A note alone is not the end.
- **Why:** "Only humans can implement kaizen" [t1], and what kaizen improves is the written standard
  [l2]. Postmortems follow "any significant undesirable event" [p1].
- **Linear as the builder:** a note on a ticket would link to the ticket or rule it led to. Guess.
- **Elm or OTP:** OTP's `code_change` moves a running process to new code and keeps its state: the
  standard changes while the work goes on.
- **What holds it:** taste today. A check later: a note of kind failure with no link.
- **Doubt:** some notes record a one-off with nothing to change. They need a "no change" exit.
- **Cost:** one link per note, and more tickets.
- **Ticket 574:** breaks. Note 2026-11-10-25 names the branch move and the box limits, and nothing
  picks them up.

## What the ledger records

Nothing new is designed here. The study found facts that are lost because they are not recorded
now: who filed a ticket and when, who wrote the first plan and its body, the lead's own checks, and
the owner's time. A later pipeline note decides where each goes.

## Where this differs from settled notes

- [Pipeline guidelines](./pipeline-guidelines.md) says whoever designs `next/`'s lane "starts from
  this note". 0059 already moved that note to input. Nothing here walks back its twelve principles;
  W4 adds "whose defect" on top of P3.
- [Pipeline strategies](./pipeline-strategies.md) is proposed and asks "can a later change undo the
  harm?". W4's "whose defect" is a second question beside it, not a replacement.
- [Every pull request goes through the steps](./next-is-a-pipeline-pre-run.md) is unchanged. The
  steps by hand keep running.

## What it costs

- One study now, and the pipeline's design waits for the owner's walk of this note (0059).
- W1, W4 and W6 each add a field or a row. W2 makes some work wait.

## What it cannot tell us

- The clean step data is two days and 24 tickets.
- Ticket 574 is one easy ticket: it built a decision already made.
- Whether these principles make work faster or cheaper. Nothing measured that.
- The owner's time, which nothing records.
- No source was about two people working with AI agents. Every lesson is carried over.
