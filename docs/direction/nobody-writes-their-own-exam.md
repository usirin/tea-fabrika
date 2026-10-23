# Nobody writes their own exam

Decided 2026-10-22. How it is enforced is **proposed**.

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
  2. **In CI.** A pull request that changes code and its exam together fails.
     An exam change goes in a pull request of its own.
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
  owner says yes. Slower, on purpose.
- Some fixes need two pull requests: the exam first, then the code.

## What it does not stop

- **Gaming through the code.** A machine that never does anything passes every
  law of the form "never do X wrongly". Laws must also say that something good
  happens: a run ends, a child that starts answers. Today's checker only checks
  the first kind.
- **Whoever can approve an exam change.** The CI rule is only as strong as the
  list of people who can approve. An agent that can approve in the owner's name
  breaks it.

## What would change it

A case where the builder must change a check to do its job, often enough that
the stop costs more than the gaming it prevents.
