# A free-form plan goes to the planner

Decided by the owner 2026-11-01. The flow's first half works in today's version. Its last
step is not built, and this note sizes that gap.

**The answer:** a person and an agent talk a plan through in free form. It goes in the
tracker as a ticket. The plan step turns that text into the real plan, and the owner
approves that output. A tier is still a project, and Tier 1 is the first to go this way,
after ticket 117. Today's plan step can read the text if it fits a ticket, but it cannot
yet turn out several small pull requests.

```text
talk it through in an artifact     free-form text, no schema       works today
report it as one tracker ticket    a `filed` fact, title and body  works today
triage, then the plan step         the planner reads that text     works today, for one PR
the output: stories, small tickets the owner approves it           NOT BUILT, the gap below
each small ticket runs its lane    plan, tests, build, ...         works today
```

## What was decided

- **The flow above is how a large plan enters the pipeline.** The owner expects to use it a lot.
- **Nobody writes Tier 1's stories, pull requests and tickets by hand now.** They come out
  of the planner, after ticket 117.
- **[`docs/plan/tier-1.md`](../plan/tier-1.md) stays as it is, as the free-form input.** Its
  PR letters and order are what the planner reads, and it may change them.
- **Tier 1's approval of 2026-11-01 covers what it builds and why.** It does not cover the
  breakdown. The owner approves the planner's output before any builder starts.

## One ticket traced

The first two lines are today's real shapes. The rest is a sketch.

```ts
// Today. The tracker holds the ticket. `tier-1.md` is too long for a body, so the body names it.
{type: "filed", title: "Tier 1: notes agents write", body: "Free-form plan: docs/plan/tier-1.md, at main. ..."}
// Today. The plan step ends in one fact for one ticket, and all its tasks land in one pull request.
{type: "planned", plan, tickets: [ticketOf(plan)], data, problems: []}

// A sketch, not built. Its shape is the gap's job, not this note's.
// The owner approves this version. Then each small ticket is filed and runs its own lane.
data.stories  // s9: an agent saves note n-7f3a, and the owner reads it drawn on a phone
smallTickets  // "notes: a save is one fact", needs: [...], ...
```

## What today's plan step does

All of this is today's version. Paths start at `packages/pipeline/src/`, except the brief.

**What goes in.** The lane hands the planner the ticket's title and body, fenced, with the
code at main in its folder (`stages/pipeline/program.ts:255-262`, body from `:667`). The
planner may Read, Grep and Glob, and nothing else (`stages/plan/planner.ts:133`). In the lane,
facts about the code are not gathered: the slots say "None gathered"
(`stages/pipeline/program.ts:258-259`).

**What comes out.** One `PlanDraft`: a summary, stories, tasks, a goal, pointers, questions,
properties, an interface and exam changes (`stages/plan/plan.ts:167-175`, and the brief at
`programs/pipeline/briefs/plan.md:45-76`). The lane writes one `planned` fact for one ticket
(`stages/pipeline/program.ts:275`). The owner answers `approve`, `change` or `no`
(`asks/ask.ts:123`, `:179`).

| Question | Answer | Where |
|---|---|---|
| Can it take a long free-form text? | Up to 65,536 characters in the body. `tier-1.md` has about 207,000, so it cannot be pasted. The body can name the file, since the planner reads the repo. | `tickets/ticket.ts:32` |
| Can it spend enough on it? | Unproved. A run is capped at $1 unless settings pick more, and today's plans cost $0.13 to $0.95 on small tickets (experiment 86). Settings can raise the cap with no code. | `stages/pipeline/program.ts:200`, `settings.ts:137` |
| Can it turn out a project's stories? | Yes in shape: stories are a list with no upper limit. Its brief pulls the other way: "one ticket", "most tickets are one task", and merge past about 25 checks. Tier 1 has about 65 laws and 17 criteria. | `plan.ts:169`, `plan.md:13`, `plan.md:43` |
| Can it turn out several small PR-sized tickets? | **No.** Its tasks can be many, but they all land in one pull request. No stage writes a `filed` fact, so none can file a new ticket. | `stages/plan/planner.ts:123`, `docs/direction/a-project-is-a-parent-plan.md:20-22` |

## The gap

Nothing takes one plan and gives several tickets. [A project is a parent
plan](./a-project-is-a-parent-plan.md) decided the idea, and nothing builds it.

- **What has to change, and no more than this:** the planner is told it may plan a project,
  its output can say which tasks are their own tickets and what each needs first, the pure
  Check holds that, and after the owner's yes each one is filed.
- **Size, a guess:** about 7 files, 400 to 700 product lines, 450 to 750 test lines, 6 to 10
  agent hours, at this repo's 150 lines an hour. Files: `stages/plan/plan.ts`,
  `stages/plan/check.ts`, `stages/plan/render.ts`, `briefs/plan.md`,
  `stages/pipeline/program.ts`, `stages/pipeline/machine.ts`, `tickets/ticket.ts`. Sure: 50%.
  The doubt is how the lane holds one ticket that births others; building a fold of parents
  would push it up.
- **Separate, and free:** Tier 1's ticket body names the file, and settings raise its budget.
  What budget is a guess until one run.
- **How the gap gets built:** as a ticket on today's version, after ticket 117, through the
  same pipeline. This note does not design it.

## Why, cost and how sure

- **Why:** the owner expects to use this flow a lot, so Tier 1 should give it real use. A
  person talks in free form, and the schema stays the planner's job. A plan written by hand
  now would skip the step that needs proving.
- **Cost:** Tier 1 waits for the gap, 6 to 10 more agent hours, on top of ticket 117. One
  large planner run, likely above $1. The planner may also return a breakdown worse than a
  careful person would write, and the owner's look is what catches that.
- **How sure:** 85% on the flow, since it reuses today's stage and the owner chose it. 50% on
  the size. 60% that the planner does this well at this scale on its first try. Experiment 105
  found 2 to 3 tasks an epic and weak lists of files. One run on Tier 1's text settles that.

## What this cannot tell us

- **Whether a planner can hold a plan this size.** Nothing has run one. What was measured is
  single tickets.
- **What a run costs.** $1 is the cap, not a measure of this.
- **Whether the owner can approve an output with so many tickets** in one look, or needs it
  walked step by step.
- **How `next/` reaches the lane.** That question stays open as
  [`tier-1.md`](../plan/tier-1.md#still-open-how-next-reaches-the-lane) says, and the planner's
  breakdown may change its cost.
- **Whether the size holds.** I read the code and did not sketch the change.
