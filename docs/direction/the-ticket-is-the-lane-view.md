# The ticket is the lane's one view

Decided 2026-10-24. One part is still proposed, and it is marked.

```ts
// A sketch. A ticket is the key that ties one lane's facts together.
// Its state is the fold of those facts. A person and an agent get two views of the same fold.
const facts = ledger.entries({ticket: "demlik-1"}); // oldest first
const state = facts.reduce(step, empty); // where the lane is now
const forPerson = view(state, facts); // the window: rows, then a box for each open ask
const forAgent = brief(state, facts); // the same rows as text, typed facts as short lines
```

## What was decided

- **The ticket ties the lane together.** Every piece of a lane's work is a
  fact on its ticket: filed, edited, comments, triage's answer, the plan, each
  build commit, each review, the pull request's status, each ask and its
  answer. The ticket's state is the fold of those facts.
- **Its view is the most important window in the app.** A person sees where
  the lane is, and what waits on them, from this one view. An open ask shows
  as a box after the last entry, and the owner answers there
  ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
- **It is also the agents' main context.** An agent working the lane reads the
  same timeline a person reads, as text.
  - Triage reads it whole, comments included (decided 2026-10-24).
  - [Experiment 138](../../experiments/138-tracker-on-demlik.md) ran 20 demlik
    tickets with and without their comments. On 3, the comments changed
    triage's answer, each time toward what really happened.
- **Proposed: machine state is a fact, never a comment.**
  - In 138, half of demlik's 1,463 comments (732) were machine markers:
    claims, lane state, JSON.
  - Here those are typed facts. A person sees each as a short row, and an
    agent reads it as data.
  - Nothing reads a comment to learn where a lane is
    ([data first](./data-first-markdown-is-a-view.md)).
- **Each fact says who or what wrote it** (decided 2026-10-24). The ledger is
  private, and each writer on it is a user or an agent. An agent session can
  get its own identity when that is wanted.
  - An agent's comment and a user's then look different in both views.
  - Only a user's answer closes an ask.
  - This holds because a user's key never goes into a box: agents run boxed,
    with no real key ([programs run in a box](./programs-run-in-a-box.md)).
  - A tap to sign each answer, such as Touch ID, was weighed and left out as
    more than this needs.

## Why

- **It is event sourcing.** "Capture all changes to an application state as a
  sequence of events" ([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)).
  The ticket is one stream of them.
- **GitHub's pull request page already works this way for code:** comments,
  pushes, reviews and checks in one list.
- **A person sees what the agent sees.** When an agent goes wrong, the same
  page shows what it read.
- **It keeps an agent's context small.** Anthropic's guide asks for "the
  smallest possible set of high-signal tokens"
  ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
  Typed facts as short lines keep markers out of the text.

**Cost:**

- Two views, the window and the agent's brief, to keep in step with every new
  kind of fact.
- A long lane makes a long timeline. An agent's brief may need to cut old
  rows. Not designed.
- The more an agent reads, the more text could steer it. Only ledger members
  write, and each fact says who wrote it.

**How sure: 80%.** The doubt: how long a lane's timeline gets, and whether one
brief fits every stage or each stage needs its own cut. The first lanes on the
tracker would settle it.

## Still open

- What each stage's brief keeps: the whole timeline, or a cut per stage.
- How a long timeline is cut for an agent.
- How the window groups rows, by stage or by task, once a lane has many.

## What it cannot tell us

Nothing is built. 138's triage test is 20 tickets on one model.
