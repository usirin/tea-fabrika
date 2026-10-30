# Triage asks when worth is unclear

Decided 2026-10-30, by the owner, from experiment 163 parts 4 and 5.

```ts
// Triage in two (experiment 163 part 4): close on a fact, ask on worth.
// The pick: when worth is unclear, triage asks. It does not keep and build.
type Triage =
  | { answer: "close"; fact: string }          // a fact says so: built, duplicate, out of scope
  | { answer: "keep" }                         // clearly worth doing
  | { answer: "ask"; why: "worth" | "security" };

// After the Draft, code turns any answer on a security ticket into an ask.
const securityRule = (t: Triage, security: boolean): Triage =>
  security && t.answer !== "ask" ? { answer: "ask", why: "security" } : t;
```

## What was decided

- **Option A: more asks, clean builds.**
  - Part 5 left two ways to go. A: about 130 to 190 asks a week, with wrong
    keeps at about 10%. B: keep every unclear ticket and build it, about 50 to
    90 asks a week, with wrong keeps at about 45%.
  - The owner picked A.
- **The ask budget is not set yet.** Nobody knows the right number before
  triage runs on real tickets. The budget, and the choice between A and B,
  are measured as we go.
- **The security rule is the next triage piece to build.** A Check after
  triage's Draft, as in the sketch above. Part 5: opus's wrong closes go from
  2 of 27 to 1 of 27 and security closes to 0, for one more ask.

## Why

- **A wrong keep costs a build and a pull request someone has to read.** At
  45% wrong keeps, about half the builds are thrown away, and part 5 did not
  count the time spent reading them.
- **An ask costs the owner seconds, if it can be answered from its trace.**
  Part 4 found 12 of 15 sampled asks answerable that way.
- **The numbers are offline.** Parts 4 and 5 rewrote saved answers on seen
  sets. Only a live week tells what the load really is.

## What would change it

- **Asks pile up.** If real weeks run well past what the owner answers, try
  B on one area at a time and count wasted pull requests.
- **Asks get cheaper.** A batch view or a precedent hint beside each ask
  (experiment 163 part 6) lowers the cost of A without changing the pick.
  Part 6 found the hint right first on 7 of 20 asks at 0.9, on a question
  fitted to that set. It is parked until live asks can test it fresh.
- **Security without the label.** The rule reads a label triage will not
  have. Its numbers are an upper bound until triage has its own security
  check.

## What this cannot tell us

- How long the owner really spends per ask. Nobody has timed it.
- Whether 10% wrong keeps holds live, on tickets triage has never seen.
