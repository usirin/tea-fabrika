# Promises in the pipeline

Proposed 2026-10-22.

```ts
// A sketch. A promise is a ticket's criterion that lasts after the ticket closes.
type Promise = {
	says: string; // "A lane never waits forever for a child."
	harm: string; // "A child that dies before its row leaves the lane stuck."
	is: "new" | "kept"; // new: the ticket adds it. kept: today's code must already keep it
	tool: "search" | "property" | "tla" | "proof"; // picked by code from the promise's kind
	covers: readonly Covers[]; // filled in once the code exists
};

// The five steps, built from the primitives we have. No new primitive.
const writeChecks = draft("checks_write", {input: PromisesAndCode, ok: Checks}); // not the builder
const killMutants = check("checks_kill_mutants", {/* each break Stryker makes is caught by a check */});
const today = check("checks_today", {/* new: red on today's code. kept: green on it */});
const hold = check("checks_hold", {/* every check green on the built code */});
const inStep = check("checks_in_step", {/* every record's prints match the code */});
```

## What is proposed

- **A promise is a criterion that lasts.** A criterion says when a ticket is
  done ([Done is per criterion](./done-is-per-criterion.md)). A promise says
  what the code always does, after the ticket is closed.
- **The plan lists its promises in plain sentences, and the owner approves
  them with the plan.** The owner approves plans, not pull requests
  ([Every machine has laws](./every-machine-has-laws.md)). The promises are
  what that approval is about.
- **Each promise is new or kept, and the plan says which.** A new promise is
  behavior the ticket adds, such as the lane-hang fix. A kept promise is one
  today's code already keeps and the ticket must not break, such as "an ended
  run sends nothing", or anything a cleanup ticket touches.
- **The [five steps](./five-steps-for-every-check.md) become parts of the
  loop,** each built from the existing primitives
  ([Reuse before special rules](./reuse-before-special-rules.md)):
  1. **Plan.** Draft proposes the promises. The owner approves them.
  2. **Tool.** Code picks it from the promise's kind. No agent.
  3. **Verify writer.** An agent that is not the builder
     ([Nobody grades their own work](./nobody-grades-their-own-work.md))
     drafts each check. A mutation tool such as Stryker, not the writer,
     makes the planted breaks: small edits to the lines the promise covers.
     Mutation testing calls each one a mutant, and a check that fails on it
     kills it. Code checks that every mutant is killed. A writer that picked
     its own breaks could pick easy ones, which is grading its own work
     (decided 2026-10-23). Then it runs each check on today's code: a new promise's check
     must be red there, red first, and a kept promise's check must be green.
     For a kept promise, the planted break alone shows the check can fail.
  4. **Build.** The builder works until every check is green. A diff that
     touches a check asks the owner
     ([Nobody writes their own exam](./nobody-writes-their-own-exam.md)).
  5. **Ship.** Every promise green and in step, by experiment 117's gate,
     before the merge.

The answers, in the [five verbs](./outcome-names.md):

```
plan           promises drafted              ask:owner:approval
verify writer  a mutant survived             send:verify_writer:mutant_survived
               a new promise already green   ask:owner:already_kept
               a kept promise red today      ask:owner:not_kept
               every mutant killed, as today done
build          every check green             done
               the diff touches a check      ask:owner:check_change
ship           a promise red or out of step  send:builder:promise_red
```

## Why

- **Trust in a green pull request has to come from checks the builder did not
  write and cannot change.** This is where those checks come from.
- **Each piece was built by hand and tested:** the check on the lane
  (experiment 115), the tools compared (116), the record that keeps a check in
  step with its code (117).
- **The hard part of formal checking is a statement people trust.** Here the
  owner approves the statement as one plain sentence, and code holds the rest.
- **Red first is test-driven development's rule,** used for a new promise.
  It is only for new ones. A check for a promise the code already keeps
  passes at once, and an agent pushed to make it fail would write one that
  fails for the wrong reason.
- **A check that disagrees with the plan goes to the owner, not back to the
  writer.** A new promise already green means the work may be done already.
  A kept promise red today means a bug was found, or the check is wrong.
  Either way the plan was wrong about today's code, and the plan is the
  owner's.

## What it costs

- One more agent per ticket, the verify writer, and its runs.
- A slower plan: promises are written and approved before any code.
- **A weak check can still pass.** A check can be red first and catch its
  planted break, yet miss the real case. The planted break shows a check can
  fail. It does not show it fails on the right thing.
- **How sure:** 75%. The doubt is how good the verify writer's checks are and
  what they cost. One real ticket run through it would settle both.

## Not decided here

- Whether the verify writer is its own stage or a slot in build
  ([One parent, stages as slots](./one-parent-stages-as-slots.md)).
- The name "verify writer".
- "Primitives" or "moves": the code says one, the docs say the other. It goes
  on the naming sweep.

## What would change it

- Checks from the verify writer that miss real bugs more often than review
  catches them.
- A cost per ticket the owner will not pay.
