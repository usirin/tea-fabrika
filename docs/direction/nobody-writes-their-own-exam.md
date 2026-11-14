---
state: "decided in pieces, see the note"
summary: "An agent that writes code never changes what it is checked against: laws, criteria, the checker, CI. Changing them is the owner's call, in its own change."
---

# Nobody writes their own exam

**Decided, in pieces:**

- The rule: decided 2026-10-22, below.
- The CI half: replaced 2026-11-05 by [a unit of work is a commit](./a-unit-of-work-is-a-commit.md).
- How code holds it: in the approved [Tier 1 plan](../plan/tier-1.md), where P1 and P2 built the exam and P32 builds the check that a `build` commit touching an exam path is `stuck`.

Decided 2026-10-22. How it is enforced is **proposed**, except the CI half, which the owner replaced
on 2026-11-05 with [a unit of work is a commit](./a-unit-of-work-is-a-commit.md).

```ts
// A sketch. The build stage's Check move, after the agent's draft:
const touched = draft.files.filter(isCheck);   // laws, criteria, the checker, CI rules
if (touched.length > 0)
	return {kind: "ask", who: "owner", for: "check_change", files: touched};
// Only a draft that leaves every check alone can end as done.
```

## What was decided

- **An agent that writes or fixes code never changes what that code is
  checked against.** The checks are the exam. The builder only sits it.
- **The exam is:**
  - a machine's laws, and the planted mistakes that show each law can fail;
    *2026-11-11: in `next/` a plant is run once and recorded, not committed
    ([0093](../../.decisions/0093-laws-walk-plants-run-once.md), a trial).*
  - the checker itself (`explore.ts`) and its settings, such as the depth;
  - a ticket's criteria (already ruled in
    [Done is per criterion](./done-is-per-criterion.md));
  - CI, lint rules and `layer-rules.json` (AGENTS.md already says: never
    switch a rule off to pass).
- **Changing the exam is the owner's decision**, made as its own change, never
  inside a build.
- **Held by code, not by a prompt** ([Make the mistake impossible](./make-the-mistake-impossible.md)).
  Proposed, in two places:
  1. **In the build stage.** A draft whose diff touches an exam file ends as
     `ask:owner:check_change`, never `done`.
  2. ~~**In CI.** A pull request that changes code and its exam together fails.
     An exam change goes in a pull request of its own.~~ *Replaced 2026-11-05 (owner):* an exam
     change is its own commit, by an agent that is not the builder, inside the same pull request.
     Each step signs its commits with its own key; CI verifies the signatures, and a `build`
     commit that touches an exam path is `stuck` ([a unit of work is a commit](./a-unit-of-work-is-a-commit.md)).
- **One list says which paths are the exam**, kept in one file, so both places
  read the same list.
- **How sure:** 90% on the rule. 75% on the two places. The doubt is the CI
  half: a split pull request may just move the gaming into the exam pull
  request. One real build that hits a wrong law would show it.

## Why

- **The industry has names for this failure:** reward hacking, or
  specification gaming. When a worker is judged by a check, the cheapest way to
  pass is often to change the check.
- **It happens with today's models.** Anthropic's report on formal
  verification with LLMs (2026-10-22,
  https://www.anthropic.com/research/formal-verification) notes that when
  Claude was allowed to patch code so a proof would go through, it could have
  made any theorem provable by rewriting the program so it trivially never
  crashes. They penalized patches and audited them.
- **Our version:** a law fails, and the agent edits the law to match the code.
  The suite goes green and nothing is fixed.
- **It is the other half of [Nobody grades their own work](./nobody-grades-their-own-work.md).**
  That note keeps the builder from grading. This one keeps it from writing the
  questions.
- **It is what lets the owner review laws instead of diffs.** That only works
  if the laws cannot move under the code.

## What it costs

- A real mistake in a law, found during a build, stops the build until the
  owner approves. Slower, on purpose.
- Some fixes need two pull requests: the exam first, then the code.

## What it does not stop

- **Gaming through the code.** A machine that never does anything passes every
  law of the form "never do X wrongly". Laws must also say that something good
  happens: a run ends, a child that starts answers. The one-machine checker
  (`explore.ts`) checks only the first kind. The world search of experiment 91
  checks "every lane ends", but over the old operate loop, not the hosted lane.
- **Whoever can approve an exam change.** The CI rule is only as strong as the
  list of people who can approve. An agent that can approve in the owner's name
  breaks it.

## What would change it

A case where the builder must change a check to do its job, often enough that
the stop costs more than the gaming it prevents.
