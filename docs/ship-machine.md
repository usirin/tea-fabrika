# The ship machine: a design in progress

Status: a draft being worked out in conversation. The machine is built, in
[`src/stages/ship/`](../src/stages/ship/): the outcomes (`outcome.ts`), the
facts (`facts.ts`), the gate with `landedAs` (`gate.ts`), and the state, the
step function, its three Cmds and its Listen (`machine.ts`), with tests beside
them. A code block that starts with a `src/` path is the real code. It is
tested against scripted handlers only. Not built: the real handlers, the
runner behind the Listen, any call to a code host, and the script that runs it
alone. Every other code block is a sketch in this repo's style, not checked by
the compiler. Each point is marked **settled** or **open**. This file is
updated as points settle.

It rebuilds today's shipper agent as a machine. It is a rethink, not a port:
see [`direction/rethink-do-not-port.md`](./direction/rethink-do-not-port.md).

## The whole idea in one block

```ts
// In: one pull request. Out: one typed answer. No agent in between.
ship({ pr: "https://github.com/acme/app/pull/42" })
// → { kind: "landed", commit: "d694f6b", cleanup: "done" }
// → { kind: "back_to_builder", why: "conflicts_with_main" }
// → { kind: "waiting_on_person", forWhat: "owner_approval" }
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
// src/stages/ship/facts.ts (built)
/** Everything the gate needs, read at one commit. */
export const ShipFacts = Schema.Struct({
  /** The commit about to land. */
  head: Schema.String,
  state: Schema.Literals(["open", "merged", "closed", "draft"]),
  /** Opened by one of the repo's own accounts. */
  ours: Schema.Boolean,
  /** "Fixes #N", "Part of #N", or no ticket named. */
  ticket: Schema.Literals(["closes_it", "part_of_it", "none"]),
  /** Protected files need an owner. */
  approval: Schema.Literals(["not_needed", "given", "missing"]),
  /** Every required review, at this commit. */
  reviews: Schema.Literals(["passed", "failed", "missing"]),
  checks: Schema.Literals(["green", "red", "pending", "stuck"]),
  mergeable: Schema.Literals(["clean", "conflicts", "unknown"]),
  /** Unresolved only. */
  comments: Schema.Array(Schema.Struct({ id: Schema.String, by: Schema.Literals(["person", "bot"]) })),
});
export type ShipFacts = typeof ShipFacts.Type;
```

```ts
// src/stages/ship/machine.ts (built)
const Unknown = ["unknown"] as const;
const At = Schema.Struct({ pr: Schema.String });

/** Everything the gate needs, read in one go. */
export const readShipFacts = gather("ship_facts", { input: At, ok: ShipFacts, err: Unknown });
```

### 2. Check: one gate, a pure function

```ts
// src/stages/ship/gate.ts (built)
export type ShipGate =
  /** Go. It carries what the next steps need, so none of them works it out a second time. */
  | { readonly go: true; readonly head: string; readonly landing: Landing }
  | { readonly go: false; readonly outcome: ShipOutcome };

const stop = (outcome: ShipOutcome): ShipGate => ({ go: false, outcome });

/** Go, or the one reason not to. Pure: same facts in, same answer out. */
export function shipGate(f: ShipFacts): ShipGate {
  if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
  if (f.state !== "open") return stop({ kind: "nothing_to_ship", why: f.state }); // closed or a draft, on purpose
  if (!f.ours) return stop({ kind: "not_ours" });
  if (f.mergeable === "conflicts") return stop({ kind: "back_to_builder", why: "conflicts_with_main" });
  if (f.reviews === "failed") return stop({ kind: "back_to_builder", why: "review_failed" });
  if (f.reviews === "missing") return stop({ kind: "back_to_reviewer" });
  if (f.checks === "red") return stop({ kind: "back_to_builder", why: "checks_red" });
  if (f.comments.some((c) => c.by === "person")) return stop({ kind: "waiting_on_person", forWhat: "resolve_comment" });
  if (f.comments.length > 0) return stop({ kind: "back_to_builder", why: "bot_comment" });
  if (f.approval === "missing") return stop({ kind: "waiting_on_person", forWhat: "owner_approval" });
  if (f.checks === "pending") return stop({ kind: "cannot_tell", why: "checks_pending" });
  if (f.checks === "stuck") return stop({ kind: "cannot_tell", why: "checks_stuck" });
  if (f.mergeable === "unknown") return stop({ kind: "cannot_tell", why: "mergeable_unknown" });
  return { go: true, head: f.head, landing: landingOf(f) };
}
```

Every line is a row from today's skill, but for the second: today's shipper
has no word for a closed pull request or a draft. The order of the lines is a
design choice still to be checked against real tickets.

```ts
// src/stages/ship/gate.ts (built)
export const landingOf = (f: ShipFacts): Landing => (f.ticket === "part_of_it" ? "part" : "whole");

/**
 * A pull request found already merged: which kind of landing it was. A merge
 * either finishes the ticket or only lands part of it, and the two are
 * different answers. This run did no tidy-up after it.
 */
export const landedAs = (f: ShipFacts): ShipOutcome => landed(landingOf(f), f.head, "not_run");
```

### 3. Act, 4. Listen, 5. Act

```ts
// src/stages/ship/machine.ts (built)
/** Put this head in the merge queue. It refuses when the head is no longer this one. */
export const enqueue = act("ship_enqueue", {
  input: Schema.Struct({ pr: Schema.String, head: Schema.String }),
  ok: Schema.Literals(["queued", "head_moved", "conflicts"]),
  err: Unknown,
});

/** The tidy-up after a merge: label flagged work, remove the working copies. */
export const finish = act("ship_finish", { input: At, ok: Schema.Null, err: Unknown });

/** The merge queue, for one pull request at one head. The runner says how it left the queue, once. */
export type QueueSub = Sub<"ship_queue", { readonly pr: string; readonly head: string }>;

/** The Listen: open only while the pull request is in the queue. Nothing is paid to wait. */
export const queueSub = listen("ship_queue", (s: Ship) => (s.phase === "queued" ? { pr: s.pr, head: s.head } : null));
//   arrives as { type: "ship_queue", pr, reading: "landed" | "ejected" }
```

### The state, and the step function

```ts
// src/stages/ship/machine.ts (built)
/** How many times the branch may move under the enqueue before the machine gives up. */
export const MAX_MOVES = 3;

type Held = { readonly pr: string };
/** What the gate said go with. Kept from the gate's answer, never worked out again. */
type Going = Held & { readonly head: string; readonly landing: Landing };

/**
 * Each phase that has a Cmd in flight keeps it as `asked`: an Act's intent is
 * in the state before the Cmd goes out, and `resume` sends the same Cmd again.
 */
export type Ship =
  | { readonly phase: "idle" }
  /** `moves`: how many times the head has moved under an enqueue so far. */
  | (Held & { readonly phase: "reading"; readonly moves: number; readonly asked: ReadCmd })
  | (Going & { readonly phase: "enqueueing"; readonly moves: number; readonly asked: EnqueueCmd })
  | (Going & { readonly phase: "queued" })
  | (Held & { readonly phase: "finishing"; readonly commit: string; readonly landing: Landing; readonly asked: FinishCmd })
  | (Held & { readonly phase: "over"; readonly outcome: ShipOutcome });

export type ShipMsg =
  | { readonly type: "start"; readonly pr: string }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  /** From the Listen. It names its pull request, so a parent with several ships can route it. */
  | { readonly type: "ship_queue"; readonly pr: string; readonly reading: "landed" | "ejected" };

const stay = (s: Ship): Step => [s, []];
const over = (s: Held, outcome: ShipOutcome): Step => [{ phase: "over", pr: s.pr, outcome }, []];

function read(pr: string, moves: number): Step {
  const asked = readShipFacts({ pr });
  return [{ phase: "reading", pr, moves, asked }, [asked]];
}

export const ship = defineMachine({
  types: { model: {} as Ship, msg: {} as ShipMsg, sub: {} as QueueSub, ctx: undefined },
  cmds: [readShipFacts, enqueue, finish],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => (s.phase === "idle" ? read(m.pr, 0) : stay(s)),
    resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),

    ship_facts_ok: (s, m): Step => {
      if (s.phase !== "reading") return stay(s);
      const gate = shipGate(m.value);
      if (!gate.go) return over(s, gate.outcome);
      const { head, landing } = gate;
      const asked = enqueue({ pr: s.pr, head, intent: intentOf("ship", s.pr, "enqueue", head) });
      return [{ phase: "enqueueing", pr: s.pr, head, landing, moves: s.moves, asked }, [asked]];
    },
    ship_facts_err: (s): Step => (s.phase === "reading" ? over(s, { kind: "cannot_tell", why: "read_failed" }) : stay(s)),

    ship_enqueue_ok: (s, m): Step => {
      // An answer to an enqueue of another head is an old one: a Cmd sent twice answers twice.
      if (s.phase !== "enqueueing" || m.cmd.intent !== s.asked.intent) return stay(s);
      switch (m.value) {
        case "queued":
          return [{ phase: "queued", pr: s.pr, head: s.head, landing: s.landing }, []];
        case "conflicts":
          return over(s, { kind: "back_to_builder", why: "conflicts_with_main" });
        case "head_moved":
          // Read fresh, again. A branch that keeps moving does not spin the machine forever.
          return s.moves >= MAX_MOVES ? over(s, { kind: "cannot_tell", why: "head_kept_moving" }) : read(s.pr, s.moves + 1);
      }
    },
    // Nobody knows whether it is in the queue. Stop, and say so.
    ship_enqueue_err: (s, m): Step =>
      s.phase === "enqueueing" && m.cmd.intent === s.asked.intent ? over(s, { kind: "cannot_tell", why: "enqueue_failed" }) : stay(s),

    ship_queue: (s, m): Step => {
      if (s.phase !== "queued" || m.pr !== s.pr) return stay(s);
      if (m.reading === "ejected") return over(s, { kind: "back_to_builder", why: "thrown_out_of_queue" });
      const asked = finish({ pr: s.pr, intent: intentOf("ship", s.pr, "finish", s.head) });
      return [{ phase: "finishing", pr: s.pr, commit: s.head, landing: s.landing, asked }, [asked]];
    },

    ship_finish_ok: (s): Step => (s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "done")) : stay(s)),
    // It merged all the same. The landing is the answer, and it says the tidy-up broke.
    ship_finish_err: (s): Step => (s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "failed")) : stay(s)),
  },
  subs: [queueSub],
});
```

Elm shape: a small child machine with its own state and pure update cells, one
per Msg. The parent steps it with `applyCell` and reads `outcome` when the
phase is `over`. The queue wait is a subscription. Nothing new is needed.

Three things the first sketch did not have:

- **A Cmd that fails has an ending.** A failed read is `cannot_tell` with
  `read_failed`. A failed enqueue is `cannot_tell` with `enqueue_failed`:
  nobody knows whether it is in the queue. A failed tidy-up is still a
  landing, with `cleanup: "failed"`, because it did merge.
- **A branch that keeps moving stops the machine.** After the head has moved
  under the enqueue more than `MAX_MOVES` times the answer is `cannot_tell`
  with `head_kept_moving`.
- **`update` takes `head` and `landing` from the gate's answer.** It never
  works them out from the facts itself.

### What it hands back

```ts
// src/stages/ship/outcome.ts (built)
/** Why a pull request goes back to the builder. The parent reads it to tell a repair round from a free lap. */
export const BackToBuilderWhy = Schema.Literals(["review_failed", "checks_red", "conflicts_with_main", "thrown_out_of_queue", "bot_comment"]);
export type BackToBuilderWhy = typeof BackToBuilderWhy.Type;

/** What a person is asked for: to resolve their open comment, or an owner's approval on protected files. */
export const WaitingFor = Schema.Literals(["resolve_comment", "owner_approval"]);
export type WaitingFor = typeof WaitingFor.Type;

/**
 * Why the machine could not tell. The first three are facts the gate read.
 * `read_failed`: the facts could not be read at all. `head_kept_moving`: the
 * branch moved under every try to queue it. `enqueue_failed`: the call that
 * queues it broke, so nobody knows whether it is in the queue.
 */
export const CannotTellWhy = Schema.Literals(["checks_pending", "checks_stuck", "mergeable_unknown", "read_failed", "head_kept_moving", "enqueue_failed"]);
export type CannotTellWhy = typeof CannotTellWhy.Type;

/** Why there is nothing to ship: someone closed the pull request, or left it a draft. */
export const NothingToShipWhy = Schema.Literals(["closed", "draft"]);
export type NothingToShipWhy = typeof NothingToShipWhy.Type;

/**
 * The tidy-up after a merge: label flagged work, remove the working copies.
 * `not_run`: the pull request was found already merged, so this run did none.
 * `failed`: it merged, and the tidy-up broke; something may be left behind.
 */
export const Cleanup = Schema.Literals(["done", "failed", "not_run"]);
export type Cleanup = typeof Cleanup.Type;

export const ShipOutcome = Schema.Union([
  /** Merged, and the ticket is finished. */
  Schema.Struct({ kind: Schema.Literal("landed"), commit: Schema.String, cleanup: Cleanup }),
  /** Merged, but the ticket has work left ("Part of #N"). */
  Schema.Struct({ kind: Schema.Literal("landed_part"), commit: Schema.String, cleanup: Cleanup }),
  /** Closed or a draft, on purpose. Never shipped: a person is told. */
  Schema.Struct({ kind: Schema.Literal("nothing_to_ship"), why: NothingToShipWhy }),
  Schema.Struct({ kind: Schema.Literal("back_to_builder"), why: BackToBuilderWhy }),
  /** A review is missing or out of date for this commit. */
  Schema.Struct({ kind: Schema.Literal("back_to_reviewer") }),
  Schema.Struct({ kind: Schema.Literal("waiting_on_person"), forWhat: WaitingFor }),
  /** Stop, never guess. */
  Schema.Struct({ kind: Schema.Literal("cannot_tell"), why: CannotTellWhy }),
  /** The pull request belongs to someone outside the repo. */
  Schema.Struct({ kind: Schema.Literal("not_ours") }),
]);
export type ShipOutcome = typeof ShipOutcome.Type;

/** A merge either finishes the ticket or only lands part of it. */
export type Landing = "whole" | "part";

/** The one place a landing becomes an outcome, so the gate and the machine cannot say it differently. */
export const landed = (landing: Landing, commit: string, cleanup: Cleanup): ShipOutcome => ({
  kind: landing === "part" ? "landed_part" : "landed",
  commit,
  cleanup,
});
```

Eight kinds. Every field a parent may need to tell two answers apart is a
fixed tag, so a parent can `switch` on it. The words a person reads are made
from the tags, in a view.

### How a parent reacts

```ts
// In the parent's update, when the ship child is over:
switch (outcome.kind) {
  case "landed":            return close(ticket);
  case "landed_part":       return readWhatIsLeft(ticket);                // never `close`; the ticket says what is left
  case "nothing_to_ship":   return stop(ticket, outcome.why);             // closed or a draft, on purpose: a person is told
  case "back_to_builder":   return startBuild(ticket, outcome.why);       // a repair round, or a free lap, by `why`
  case "back_to_reviewer":  return startReview(ticket);
  case "waiting_on_person": return ask(ticket, outcome.forWhat);          // the commenter, or an owner, by `forWhat`
  case "cannot_tell":       return stop(ticket, outcome.why);
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
- **A branch behind main ships as it is.** The machine trusts the code host's
  own answer to "can this merge". A branch that is behind but has no conflict
  goes into the merge queue, which tests it on top of main. The gate has no
  line for "behind", on purpose.

  ```ts
  // The gate reads the code host's answer. It never works it out again.
  if (f.mergeable === "conflicts") return stop({ kind: "back_to_builder", why: "conflicts_with_main" });
  // behind main, no conflict → no stop: the queue is the check
  ```

  In the real logs 31 single-ticket runs stopped for this. Ten then shipped
  from the stop with nothing else recorded
  ([experiment 55](../experiments/55-ship-outcomes-on-recorded-runs.md)).
- **Its reads come from the code host, not the ledger.** Checks, "can it
  merge" and the queue belong to wherever the code lives. See
  [`direction/ledger-behind-a-service.md`](./direction/ledger-behind-a-service.md).
- **A closed or draft pull request is never shipped.** Someone closed it or
  left it a draft on purpose, so the machine stops and a person is told. It is
  its own outcome, `nothing_to_ship`, with `closed` or `draft` as the `why`.
- **Red checks are run again once before the builder is called.** A re-run
  costs minutes and no money; a builder run costs both, and a new review after
  it. In the real logs 9 of 13 stops for red checks shipped from the stop with
  no new code, and experiment 54 saw 9 failed reviews turn green on a plain
  re-run. The sample is small, so count it on real tickets. Not built yet.

  ```ts
  // checks red, first time  → ask the code host to run the failed jobs again, and wait
  // checks red, second time → { kind: "back_to_builder", why: "checks_red" }, with the failing job's log
  type Ship =
    | ...
    | (Held & { phase: "rechecking"; head: string })   // a Listen on the checks, open only here
  ```

## Open

- **The set of outcomes.** The eight above are a first list. Today's shipper
  has 13 ending words; the real logs show 7 endings in use. On the 961
  recorded runs no eighth ending came up, but three things did not fit
  ([experiment 55](../experiments/55-ship-outcomes-on-recorded-runs.md)).
  One of them, a closed or draft pull request, is now settled above.
  - **Two different waits share one kind.** Done. A person's comment and a
    missing owner approval were both `waiting_on_person`, told apart only by
    free text. `forWhat` is now a tag, and so is the `why` of `cannot_tell`,
    so a parent can `switch` on both.
  - **The queue wait has no time limit.** In 3 recorded runs the queue never
    answered. There is no outcome for that.
- **How a ticket records what is left.** The sketch above reads the ticket's
  checklist. Today nothing ticks a criterion when a part lands, so after a
  part landing every box may still read as open. Either the part's pull
  request names the criteria it delivers and landing ticks them, or the
  remaining work lives in child tickets. In the real logs the step after a
  part landing was a new build 13 times, the board ending the ticket 12 times,
  an immediate stop for a person 11 times, and nothing 5 times.
- **Owner approval on protected files.** The code host may not enforce it. If
  it does not, "can merge" can be true on a pull request that still needs an
  owner's yes, so the gate keeps its own line for it. Proposed; not settled.
- **Thrown out of the queue, and a conflict with main.** Both go back to the
  builder today without costing the ticket a repair round. Keep that?
- **Checks still running.** The gate above answers "cannot tell" for pending
  checks. Should the ship machine wait for them instead (a second Listen)?
- **Does today's fabrika accept a "queued" fact written by code** instead of
  by a shipper agent? Unchecked.
- **The closing message to a person.** A template per outcome, or nothing
  beyond the ledger line?
