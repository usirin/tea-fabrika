# A free-form plan goes to the planner

Decided by the owner 2026-11-01. Tier 1 goes this way once, with its last step by hand. The
whole flow is built in `next/`.

**The answer:** a person and an agent talk a plan through in free form. It goes in the
tracker as a ticket. The plan step turns that text into the real plan, and the owner
approves it. A tier is still a project. For Tier 1, after ticket 117, an agent then files
each task as a ticket by hand, as a named exception. Nothing new is built on today's version.

```text
talk it through in an artifact     free-form text, no schema        today's version has it
report it as one tracker ticket    a `filed` fact, title and body   today's version has it
triage, then the plan step         the planner reads that text      today's version has it
the owner approves the plan        `approve`, `change` or `no`      today's version has it
one plan becomes small tickets     Tier 1: by hand, once            next/: built properly, Tier 6
each small ticket runs its lane    plan, tests, build, ...          today's version has it
```

## What was decided

- **The flow above is how a large plan enters the pipeline.** The owner expects to use it a lot.
- **[`docs/plan/tier-1.md`](../plan/tier-1.md) stays as it is, as the free-form input.** Its
  PR letters and order are what the planner reads, and it may change them.
- **Tier 1's approval of 2026-11-01 covers what it builds and why.** It does not cover the
  breakdown. The owner approves the planner's plan before any builder starts.
- **Tier 1's split goes by hand, once, as a named exception.** After the owner's yes, an agent
  files each task as a ticket with the existing tracker command, `tracker`'s `file` input, and
  logs it in `field/`.
- **No splitter gets built on today's version.**
- **The whole flow is a requirement for `next/`,** in
  [Tier 6](../plan/tiers.md#a-requirement-the-whole-plan-flow). That covers the artifact, the
  ticket, the planner's plan, the owner's yes and several small tickets from one plan, and a
  rerun after a partial filing must not file twice.
- **That is where the exception ends.** No second project gets split by hand without the
  owner's yes.

## One ticket traced

The first two lines are today's real shapes. The rest is by hand, once.

```ts
// Today. The tracker holds the ticket. `tier-1.md` is too long for a body, so the body names it.
{type: "filed", title: "Tier 1: notes agents write", body: "Free-form plan: docs/plan/tier-1.md, at main. ..."}
// Today. The plan step ends in one fact for one ticket. The owner approves this version.
{type: "planned", plan, tickets: [ticketOf(plan)], data, problems: []}

// By hand, once. For each task in `data.tasks`, an agent checks the tracker and `field/`, then:
tracker.file({title: "notes: a save is one fact", body: "From the Tier 1 plan, version 1, task t7. ..."})
// One row in field/ per ticket filed. Each ticket then runs its own lane.
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
| Can it turn out a project's stories? | Yes in shape: stories are a list with no upper limit. Its brief pulls the other way: "one ticket", "most tickets are one task", and merge past about 25 checks. Tier 1 has about 65 laws and 17 criteria. The ticket's text has to ask for a project's plan. | `plan.ts:169`, `plan.md:13`, `plan.md:43` |
| Can it turn out several small PR-sized tickets? | **No.** Its tasks can be many, but they all land in one pull request. No stage writes a `filed` fact, so none can file a new ticket. | `stages/plan/planner.ts:123`, `docs/direction/a-project-is-a-parent-plan.md:20-22` |

## The route not taken

Teaching today's plan step to split, on today's version.

- **What it would have cost, a guess:** about 7 files, 400 to 700 product lines, 450 to 750
  test lines, 6 to 10 agent hours, at this repo's 150 lines an hour. Sure: 50%.
- **Why not:** today's version is deleted when `next/` takes the job over. Tier 1 would wait
  for code that gets thrown away, to save one filing by hand.

## A rerun by hand

The tracker helps less here than it looks. A write sent twice is one row only under the same
message id, which is made once (`programs/tracker/README.md:67`). An agent starting again makes
a new one, so it could file every ticket again.

- **For Tier 1:** before each filing, the agent reads the tracker and its `field/` rows and files
  only what is missing. That is a rule the agent follows and no code holds, which is one more
  reason this happens once. In `next/`, code holds it.

## Why, cost and how sure

- **Why this flow:** the owner expects to use it a lot, so Tier 1 should give it real use. A
  person talks in free form, and the schema stays the planner's job.
- **Why by hand for the split:** one filing costs little, and no throwaway code gets built.
- **Why Tier 6:** that is where `next/`'s pipeline stages land, and the tier's own list says
  plans live there.
- **Cost:** one agent's filing of each task, one `field/` row each, and one large planner run,
  likely above $1. The planner may return a breakdown worse than a careful person would write,
  and the owner's look is what catches that. Tiers 2 to 5 come before Tier 6, and each is a
  project, so each needs the owner's yes to split by hand, or the flow moves up.
- **How sure:** 85% on the flow, since it reuses today's stage and the owner chose it. 70% on
  Tier 6, since the order of Tiers 3 to 6 is only proposed. 60% that the planner does this well
  at this scale on its first try. Experiment 105 found 2 to 3 tasks an epic and weak lists of
  files. One run on Tier 1's text settles that.

## What this cannot tell us

- **How Tier 1's lane stops at the owner's yes.** By my reading, a lane goes on to the next
  steps after an approval, and it must not here, since it would build every task in one pull
  request. Build stops on a closed ticket (`stages/pipeline/machine.ts:268`), but the test writer
  comes first. Closing it right after the yes has not been tried. One rehearsal on a throwaway
  repo settles it, before Tier 1's ticket is filed.
- **Whether a planner can hold a plan this size.** Nothing has run one. What was measured is
  single tickets.
- **What a run costs.** $1 is the cap, not a measure of this.
- **Whether each task comes out PR-sized.** The planner is told tasks land together, so a task
  may be too large or too small to be a ticket. The owner's look is the only check.
- **Whether the owner can approve so many tasks** in one look, or needs them walked step by step.
- **How `next/` reaches the lane.** That question stays open as
  [`tier-1.md`](../plan/tier-1.md#still-open-how-next-reaches-the-lane) says.
- **Whether the size of the route not taken was right.** I read the code and did not sketch it.
