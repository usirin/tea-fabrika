# The ship machine: a design in progress

Status: a draft being worked out in conversation. Nothing here is built, and
the code blocks are sketches in this repo's style, not checked by the compiler.
Each point is marked **settled** or **open**. This file is updated as points
settle.

It rebuilds today's shipper agent as a machine. It is a rethink, not a port:
see [`direction/rethink-do-not-port.md`](./direction/rethink-do-not-port.md).

## The whole idea in one block

```ts
// In: one pull request. Out: one typed answer. No agent in between.
ship({ pr: "https://github.com/acme/app/pull/42" })
// → { kind: "landed", commit: "d694f6b" }
// → { kind: "back_to_builder", why: "conflicts_with_main" }
// → { kind: "waiting_on_person", who: "an owner", forWhat: "approve this pull request" }
```

The machine that started it reads the answer and decides what happens next.
The ship machine never decides that.

## What today's shipper does

Eleven steps, read from its skill. Nine are a checklist or bookkeeping, one is
a long wait, one needs thinking, and the last is a two-line message.

1. Cancel any leftover "merge when ready".
2. Read the pull request's facts.
3. Check the owner's approval on protected files.
4. Check every required review passed.
5. Wait for the checks on this commit.
6. Decide on unresolved review comments. *The one judgment.*
7. Put it in the merge queue and watch.
8. Label flagged work "waiting for release".
9. Delete the ticket's working copies.
10. Write the ending in the ledger.
11. Tell the person what happened.

Most of that skill is a table written in prose. This is the same table for one
command, as the skill gives it:

```text
ship enqueue  → exit 0   armed, go on to watch the queue
              → exit 11  cannot tell if it is mergeable: stop, say "unknown"
              → exit 16  not mergeable: back to the builder
              → exit 21  main moved under the branch: back to the builder, no repair round charged
              → exit 22  the pull request is not ours: refuse
```

What 961 real shipper runs showed
([experiment 53](../experiments/53-lane-logs.md)): they end in one of seven
ways and no eighth. A run lasts about 8 minutes at the median, which is also
the length of its wait limit, and in about a third of runs the watch ran out
while the pull request was still in the queue.

## The sketch

### 1. Gather: read everything, fresh, in one go

```ts
/** Everything the gate needs, read at one commit. */
const ShipFacts = z.object({
  head: z.string(),                                     // the commit about to land
  state: z.enum(["open", "merged", "closed", "draft"]),
  ours: z.boolean(),                                    // opened by one of the repo's own accounts
  ticket: z.enum(["closes_it", "part_of_it", "none"]),  // "Fixes #N", "Part of #N", or no ticket named
  approval: z.enum(["not_needed", "given", "missing"]), // protected files need an owner
  reviews: z.enum(["passed", "failed", "missing"]),     // every required review, at this commit
  checks: z.enum(["green", "red", "pending", "stuck"]),
  mergeable: z.enum(["clean", "conflicts", "unknown"]),
  comments: z.array(z.object({ id: z.string(), by: z.enum(["person", "bot"]) })), // unresolved only
});

const readShipFacts = gather("ship_facts", {
  input: z.object({ pr: z.string() }),
  ok: ShipFacts,
  err: ["unknown"],
});
```

### 2. Check: one gate, a pure function

```ts
/** Go, or the one reason not to. Pure: same facts in, same answer out. */
function shipGate(f: ShipFacts): { go: true } | { go: false; outcome: ShipOutcome } {
  if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
  if (!f.ours) return stop({ kind: "not_ours" });
  if (f.mergeable === "conflicts") return stop({ kind: "back_to_builder", why: "conflicts_with_main" });
  if (f.reviews === "failed") return stop({ kind: "back_to_builder", why: "review_failed" });
  if (f.reviews === "missing") return stop({ kind: "back_to_reviewer" });
  if (f.checks === "red") return stop({ kind: "back_to_builder", why: "checks_red" });
  if (f.comments.some((c) => c.by === "person"))
    return stop({ kind: "waiting_on_person", who: "the commenter", forWhat: "resolve your comment" });
  if (f.comments.length > 0) return stop({ kind: "back_to_builder", why: "bot_comment" });
  if (f.approval === "missing")
    return stop({ kind: "waiting_on_person", who: "an owner", forWhat: "approve this pull request" });
  if (f.checks !== "green" || f.mergeable === "unknown") return stop({ kind: "cannot_tell" });
  return { go: true };
}
```

Every line is a row from today's skill. The order of the lines is a design
choice still to be checked against real tickets.

```ts
/** A merge either finishes the ticket or only lands part of it. The two are different answers. */
const landedAs = (f: ShipFacts): ShipOutcome =>
  f.ticket === "part_of_it" ? { kind: "landed_part", commit: f.head } : { kind: "landed", commit: f.head };
```

### 3. Act, 4. Listen, 5. Act

```ts
const enqueue = act("ship_enqueue", {
  input: z.object({ pr: z.string(), head: z.string() }), // refuses if the head moved
  ok: z.enum(["queued", "head_moved", "conflicts"]),
  err: ["unknown"],
});

/** Open only while the pull request is in the queue. Nothing is paid to wait. */
const queueSub = listen("ship_queue", (s: Ship) => (s.phase === "queued" ? { pr: s.pr } : null));
//   arrives as { type: "ship_queue", reading: "landed" | "ejected" }

const finish = act("ship_finish", { input: z.object({ pr: z.string() }), ok: z.null(), err: ["unknown"] });
//   label flagged work, remove working copies
```

### The state, and the step function

```ts
type Ship =
  | { phase: "reading"; pr: string }
  | { phase: "enqueueing"; pr: string; head: string; landing: "whole" | "part" }
  | { phase: "queued"; pr: string; head: string; landing: "whole" | "part" }
  | { phase: "finishing"; pr: string; commit: string; landing: "whole" | "part" }
  | { phase: "over"; pr: string; outcome: ShipOutcome };

function update(s: Ship, m: ShipMsg): [Ship, ShipCmd[]] {
  switch (s.phase) {
    case "reading": {
      if (m.type !== "ship_facts_ok") return [s, []];
      const gate = shipGate(m.value);
      if (!gate.go) return [{ phase: "over", pr: s.pr, outcome: gate.outcome }, []];
      const landing = m.value.ticket === "part_of_it" ? "part" : "whole";
      return [{ phase: "enqueueing", pr: s.pr, head: m.value.head, landing }, [enqueue({ pr: s.pr, head: m.value.head, intent })]];
    }
    case "enqueueing":
      if (m.type !== "ship_enqueue_ok") return [s, []];
      if (m.value === "head_moved") return [{ phase: "reading", pr: s.pr }, [readShipFacts({ pr: s.pr })]]; // read fresh, again
      if (m.value === "conflicts") return over(s, { kind: "back_to_builder", why: "conflicts_with_main" });
      return [{ ...s, phase: "queued" }, []];
    case "queued":
      if (m.type !== "ship_queue") return [s, []];
      return m.reading === "landed"
        ? [{ phase: "finishing", pr: s.pr, commit: s.head, landing: s.landing }, [finish({ pr: s.pr, intent })]]
        : over(s, { kind: "back_to_builder", why: "thrown_out_of_queue" });
    case "finishing":
      if (m.type !== "ship_finish_ok") return [s, []];
      return over(s, { kind: s.landing === "part" ? "landed_part" : "landed", commit: s.commit });
    case "over":
      return [s, []];
  }
}
```

Elm shape: a small child machine with its own state and a pure `update`. The
parent steps it. The queue wait is a subscription. Nothing new is needed.

### What it hands back

```ts
type ShipOutcome =
  | { kind: "landed"; commit: string }                            // merged, and the ticket is finished
  | { kind: "landed_part"; commit: string }                       // merged, but the ticket has work left ("Part of #N")
  | { kind: "back_to_builder"; why: "review_failed" | "checks_red" | "conflicts_with_main" | "thrown_out_of_queue" | "bot_comment" }
  | { kind: "back_to_reviewer" }                                  // a review is missing or out of date for this commit
  | { kind: "waiting_on_person"; who: string; forWhat: string }
  | { kind: "cannot_tell" }                                       // a read failed: stop, never guess
  | { kind: "not_ours" };                                         // the pull request belongs to someone outside the repo
```

### How a parent reacts

```ts
// In the parent's update, when the ship child is over:
switch (outcome.kind) {
  case "landed":            return close(ticket);
  case "landed_part":       return readWhatIsLeft(ticket);                // never `close`; the ticket says what is left
  case "back_to_builder":   return startBuild(ticket, outcome.why);       // a repair round, or a free lap, by `why`
  case "back_to_reviewer":  return startReview(ticket);
  case "waiting_on_person": return ask(ticket, outcome.who, outcome.forWhat);
  case "cannot_tell":       return stop(ticket, "ship could not read the pull request");
  case "not_ours":          return stop(ticket, "the pull request is not ours to land");
}
```

After a part landing the parent reads the ticket again. The ticket already
holds what is left; nobody is asked to remember it.

```ts
/** Read fresh from the ledger, after a part of the ticket landed. */
const WhatIsLeft = z.object({
  state: z.enum(["open", "closed"]),          // someone may have closed it meanwhile
  criteria: z.array(z.object({ text: z.string(), done: z.boolean() })), // the ticket's own checklist
  owed: z.enum(["nothing", "a_ruling", "an_owner_act"]),               // a stop the ledger already names
});

function afterPartLanding(left: WhatIsLeft): Next {
  if (left.state === "closed") return close(ticket);                    // settled by someone already
  if (left.owed !== "nothing") return waitFor(ticket, left.owed);       // the ledger names who and what
  const open = left.criteria.filter((c) => !c.done);
  return open.length === 0 ? close(ticket) : startBuild(ticket, { only: open }); // build just what is left
}
```

### Run alone

```sh
# One pull request, no pipeline around it. Prints the outcome as JSON.
node src/ship-run.ts https://github.com/acme/app/pull/42
```

## Settled

- **It reads fresh.** Right before it acts, it reads the facts again at the
  commit it is about to land, and the fresh read wins over anything remembered.
  See [`direction/read-fresh-run-alone.md`](./direction/read-fresh-run-alone.md).
- **It runs alone.** Its input is one pull request. It can be started by a
  parent machine or by hand, and behaves the same.
- **It tries to do the job in code and hands back one typed outcome.** The
  machine that started it reads that outcome and knows how to react. The ship
  machine does not decide what the pipeline does next.
- **Open comments, the simple way first.** A comment a person wrote or joined:
  the machine asks that person. A comment only a bot wrote: back to the
  builder, always. Nothing is closed silently, and no judgment is made. Count
  how often each case comes up on real tickets; if bot comments are common,
  "real problem or nit?" becomes a candidate question for Jev.
- **A part landing is its own answer, and the ticket says what is left.** A
  pull request that says "Part of #N" merges and leaves its ticket open (41 of
  847 real trips through ship, 4.8%). It is a separate outcome so no parent can
  close the ticket by mistake. What happens next is read from the ticket, never
  asked of a person: closed meanwhile, a named stop the ledger already holds,
  or criteria still open, which go to a new build of only those. See
  [`direction/ask-for-decisions-not-facts.md`](./direction/ask-for-decisions-not-facts.md).

## Open

- **The set of outcomes.** The seven above are a first list. Today's shipper
  has 13 ending words; the real logs show 7 endings in use.
- **How a ticket records what is left.** The sketch above reads the ticket's
  checklist. Today nothing ticks a criterion when a part lands, so after a
  part landing every box may still read as open. Either the part's pull
  request names the criteria it delivers and landing ticks them, or the
  remaining work lives in child tickets. In the real logs the step after a
  part landing was a new build 13 times, the board ending the ticket 12 times,
  an immediate stop for a person 11 times, and nothing 5 times.
- **A branch that fell behind main.** The most common named stop in the real
  logs. Today's skill says a branch that is behind but merges cleanly ships as
  it is, because the merge queue tests it on top of main. So the gate above
  has no line for it. Is that right?
- **Thrown out of the queue, and a conflict with main.** Both go back to the
  builder today without costing the ticket a repair round. Keep that?
- **Checks still running.** The gate above answers "cannot tell" for pending
  checks. Should the ship machine wait for them instead (a second Listen)?
- **Does today's fabrika accept a "queued" fact written by code** instead of
  by a shipper agent? Unchecked.
- **The closing message to a person.** A template per outcome, or nothing
  beyond the ledger line?
