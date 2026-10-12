# The ship machine: a design in progress

Status: a draft being worked out in conversation. The machine is built, in
[`src/stages/ship/`](../src/stages/ship/): the outcomes (`outcome.ts`), the
facts (`facts.ts`), the gate with `landedAs` (`gate.ts`), and the state, the
step function, its four Cmds, its two Listens and their clocks (`machine.ts`),
with tests beside them. A machine is made with its own settings
(`createShip`). It waits for checks that are still running, runs red checks
again once before the builder is called, and both waits have a limit. A code
block that starts with a `src/` path is the real code.

The read side is real too. The `CodeHost` service (`src/services.ts`) reads,
and its GitHub Layer (`src/code-host-github.ts`) reads a pull
request's facts through `gh`, at one head commit. That includes the owner's
approval, read from the repo's own CODEOWNERS file, and which kinds of review
the change needs, read from the files it touches. Where the reader cannot
tell, the fact is `unknown` and the gate stops. The handler for `ship_facts`
asks it (`handlers.ts`), and `run.ts` runs the machine alone on one pull
request, up to its first write. On real open pull requests it now reaches
"go".

The write side is built, and **has never been run against a real
repository**. A second service, `CodeHostWrites`, holds the two writes: put a
head in the merge queue, and start red checks again. Its GitHub Layer is
`src/code-host-github-writes.ts`. The handlers that use it and the runners
behind the two Listens are in `handlers.ts`. All of it is tested against a
scripted `gh` only: see [What is real and what is
scripted](#what-is-real-and-what-is-scripted). `run.ts` writes only when it is
started with `--write`.

The operator machine can run it as a child in place of the shipper shell,
behind a switch that is off by default: see [Under the
operator](#under-the-operator). That too is tested against scripted services
only, and **has not been run on a real ticket**. Every
other code block is a sketch in this repo's style, not checked by the
compiler. Each point is marked **settled** or **open**. This file is updated
as points settle.

It rebuilds today's shipper agent as a machine. It is a rethink, not a port:
see [`direction/rethink-do-not-port.md`](./direction/rethink-do-not-port.md).

## The whole idea in one block

```ts
// In: one pull request. Out: one typed answer. No agent in between.
ship({ pr: "https://github.com/acme/app/pull/42" })
// → { kind: "done", part: false, commit: "d694f6b", cleanup: "done" }      "done"
// → { kind: "send", to: "builder", why: "conflicts" }                      "send:builder:conflicts"
// → { kind: "ask", who: "owner", for: "approval" }                         "ask:owner:approval"
```

The answer is one of five verbs, the same five every stage machine uses:
`done`, `send`, `ask`, `skip`, `stuck`. Beside each is its name, which is how
it is spelled for people, logs and drawings. See
[`direction/outcome-names.md`](./direction/outcome-names.md).

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
/** One kind of review a pull request needs, and how it stands at the head commit. The kinds are today's fabrika's. */
export const ReviewKind = Schema.Struct({
  kind: Schema.Literals(["review-code", "review-doc", "review-skill", "review-ui", "governance"]),
  /** `missing`: no verdict binds to this commit. */
  verdict: Schema.Literals(["passed", "failed", "missing"]),
});
export type ReviewKind = typeof ReviewKind.Type;

/** One run of the checks that was started again: which run, and the try it was on when the re-run was asked. */
export const Rerun = Schema.Struct({ run: Schema.Number, attempt: Schema.Number });
export type Rerun = typeof Rerun.Type;

/** Everything the gate needs, read at one commit. */
export const ShipFacts = Schema.Struct({
  /** The commit about to land. */
  head: Schema.String,
  state: Schema.Literals(["open", "merged", "closed", "draft"]),
  /** Opened by one of the repo's own accounts. */
  ours: Schema.Boolean,
  /** "Fixes #N", "Part of #N", or no ticket named. */
  ticket: Schema.Literals(["closes_it", "part_of_it", "none"]),
  /** Protected files need an owner's approval of this commit. `unknown`: the reader could not tell; it never guesses `missing`. */
  approval: Schema.Literals(["not_needed", "given", "missing", "unknown"]),
  /**
   * Every review this pull request needs, at this commit: `passed` only when
   * each one passed. `unknown`: the reader could not tell which it needs; one
   * passing review is never taken for all of them.
   */
  reviews: Schema.Literals(["passed", "failed", "missing", "unknown"]),
  /** The detail behind `reviews`, for whoever is told to fix it. A reader makes both from one list, with `reviewsOf`. Empty when `unknown`. */
  reviewKinds: Schema.Array(ReviewKind),
  checks: Schema.Literals(["green", "red", "pending", "stuck"]),
  mergeable: Schema.Literals(["clean", "conflicts", "unknown"]),
  /** Unresolved only. */
  comments: Schema.Array(Schema.Struct({ id: Schema.String, by: Schema.Literals(["person", "bot"]) })),
});
export type ShipFacts = typeof ShipFacts.Type;

/** The reviews as one word: any that failed is `failed`, else any with no verdict is `missing`, else `passed`. */
export const reviewsOf = (kinds: readonly ReviewKind[]): "passed" | "failed" | "missing" =>
  kinds.some((k) => k.verdict === "failed") ? "failed" : kinds.some((k) => k.verdict === "missing") ? "missing" : "passed";
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
  | { readonly answer: "go"; readonly head: string; readonly landing: Landing }
  /**
   * Not yet: the checks on this head are still running. That is no problem,
   * only early, so it is not an outcome. What to do about it is the machine's:
   * it waits, with a limit.
   */
  | { readonly answer: "wait_for_checks"; readonly head: string }
  | { readonly answer: "stop"; readonly outcome: ShipOutcome };

const stop = (outcome: ShipOutcome): ShipGate => ({ answer: "stop", outcome });

/** Go, wait, or the one reason not to. Pure: same facts in, same answer out. */
export function shipGate(f: ShipFacts): ShipGate {
  if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
  if (f.state !== "open") return stop({ kind: "skip", why: f.state }); // closed or a draft, on purpose
  if (!f.ours) return stop({ kind: "skip", why: "not_ours" });
  if (f.mergeable === "conflicts") return stop({ kind: "send", to: "builder", why: "conflicts" });
  if (f.reviews === "failed") return stop({ kind: "send", to: "builder", why: "review_failed" });
  if (f.reviews === "missing") return stop({ kind: "send", to: "reviewer", why: "no_review" });
  if (f.reviews === "unknown") return stop({ kind: "stuck", why: "reviews_unknown" }); // one passing review is never taken for all
  if (f.checks === "red") return stop({ kind: "send", to: "builder", why: "checks_red" }); // the machine runs them again once first
  if (f.comments.some((c) => c.by === "person")) return stop({ kind: "ask", who: "commenter", for: "comment" });
  if (f.comments.length > 0) return stop({ kind: "send", to: "builder", why: "bot_comment" });
  if (f.approval === "missing") return stop({ kind: "ask", who: "owner", for: "approval" });
  if (f.approval === "unknown") return stop({ kind: "stuck", why: "approval_unknown" }); // nobody is asked on a guess
  if (f.checks === "pending") return { answer: "wait_for_checks", head: f.head };
  if (f.checks === "stuck") return stop({ kind: "stuck", why: "checks_stuck" });
  if (f.mergeable === "unknown") return stop({ kind: "stuck", why: "merge_unknown" });
  return { answer: "go", head: f.head, landing: landingOf(f) };
}
```

Every line is a row from today's skill, but for the second: today's shipper
has no word for a closed pull request or a draft. The order of the lines is a
design choice still to be checked against real tickets.

The gate has three answers, not two. Checks that are still running are not a
reason to stop, so the gate does not make an outcome of them: it says wait,
and the machine waits. That keeps "what about pending checks" in one place,
the gate's own line, at its own spot in the order. Red checks are different:
whether they were already run again is something only the machine remembers,
so the gate answers as before and the machine decides on the re-run.

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
const AtHead = Schema.Struct({ pr: Schema.String, head: Schema.String });

/** Run the failed checks of this head again. It answers which runs it started again, so the wait after it can tell the new run from the old red one. */
export const rerunChecks = act("ship_rerun_checks", { input: AtHead, ok: Schema.Array(Rerun), err: Unknown });

/** Put this head in the merge queue. It refuses when the head is no longer this one. */
export const enqueue = act("ship_enqueue", { input: AtHead, ok: Schema.Literals(["queued", "head_moved", "conflicts"]), err: Unknown });

/** The tidy-up after a merge: label flagged work, remove the working copies. */
export const finish = act("ship_finish", { input: At, ok: Schema.Null, err: Unknown });

type AtHead = { readonly pr: string; readonly head: string };
/**
 * The checks of one pull request at one head. The runner says when none is
 * still running, once. It does not say how they went. `after`: the runs that
 * were started again; the checks have not settled until each has finished a
 * later try than the one named, so the old red run is never taken for the new.
 */
export type ChecksSub = Sub<"ship_checks", AtHead & { readonly after: readonly Rerun[] }>;
/** The merge queue, for one pull request at one head. The runner says how it left the queue, once. */
export type QueueSub = Sub<"ship_queue", AtHead>;

/** The Listen on the checks: open only while they run. Nothing is paid to wait. */
export const checksSub = listen("ship_checks", (s: Ship) => (s.phase === "waiting" ? { pr: s.pr, head: s.head, after: s.after } : null));
/** The Listen on the merge queue: open only while the pull request is in it. */
export const queueSub = listen("ship_queue", (s: Ship) => (s.phase === "queued" ? { pr: s.pr, head: s.head } : null));
/** The clock beside each Listen. Its Msg names the wait it was set for, so each wait sets a new clock. */
export const checksClock = listen("timer", (s: Ship) =>
  s.phase === "waiting" ? { ms: s.waits.checksMs, msg: { type: "ship_checks_overdue" as const, pr: s.pr, head: s.head, wait: s.waited } } : null,
);
export const queueClock = listen("timer", (s: Ship) =>
  s.phase === "queued" ? { ms: s.waits.queueMs, msg: { type: "ship_queue_overdue" as const, pr: s.pr, head: s.head } } : null,
);
```

A limit is a clock: tea's own `timer` Sub, the way the operator machine times
its waits. It is open in the same phase as the Listen it sits beside, and
when it fires first the run ends. No new timer idea.

### The state, and the step function

```ts
// src/stages/ship/machine.ts (built)
/** How long each wait may last, in ms. */
export interface Waits {
  /** Checks still running, or running again. */
  readonly checksMs: number;
  /** The pull request in the merge queue. */
  readonly queueMs: number;
}

/** The machine's own limits, for a setting left out. Starting numbers, not measured ones. */
export const DEFAULT_WAITS: Waits = { checksMs: 15 * 60_000, queueMs: 60 * 60_000 };

/** A ship machine's settings. Each one left out takes the machine's own default. */
export interface ShipConfig {
  readonly waits?: Partial<Waits>;
}

/** How many times the branch may move under the enqueue before the machine gives up. */
export const MAX_MOVES = 3;

/** `waits`: the limits this run started with, kept in the state so a restart goes by the same numbers. */
type Held = { readonly pr: string; readonly waits: Waits };
/**
 * What a run remembers from one read to the next. `moves`: how many times the
 * head has moved under an enqueue. `rerunFor`: the head whose red checks were
 * already run again, so a new head gets a re-run of its own. `waited`: how
 * many times it has waited on the checks, which numbers each wait's clock.
 */
type Sofar = Held & { readonly moves: number; readonly rerunFor: string | null; readonly waited: number };
/** What the gate said go with. Kept from the gate's answer, never worked out again. */
type Going = { readonly head: string; readonly landing: Landing };

/**
 * Each phase that has a Cmd in flight keeps it as `asked`: an Act's intent is
 * in the state before the Cmd goes out, and `resume` sends the same Cmd again.
 * The two phases that wait (`waiting`, `queued`) have none: their Listens open
 * again by themselves.
 */
export type Ship =
  | { readonly phase: "idle" }
  | (Sofar & { readonly phase: "reading"; readonly asked: ReadCmd })
  | (Sofar & { readonly phase: "rerunning"; readonly head: string; readonly asked: RerunCmd })
  /** The checks of `head` are running, for the first time or again. */
  | (Sofar & { readonly phase: "waiting"; readonly head: string; readonly after: readonly Rerun[] })
  | (Sofar & Going & { readonly phase: "enqueueing"; readonly asked: EnqueueCmd })
  | (Held & Going & { readonly phase: "queued" })
  | (Held & { readonly phase: "finishing"; readonly commit: string; readonly landing: Landing; readonly asked: FinishCmd })
  | (Held & { readonly phase: "over"; readonly outcome: ShipOutcome });

export type ShipMsg =
  | { readonly type: "start"; readonly pr: string }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  /** From a Listen. Each names its pull request and head, so a parent with several ships can route it and an old one is told apart. */
  | { readonly type: "ship_checks"; readonly pr: string; readonly head: string }
  /** `commit`: the commit on the base branch. With a merge queue or a squash it is not the head. */
  | { readonly type: "ship_queue"; readonly pr: string; readonly head: string; readonly reading: "landed"; readonly commit: string }
  | { readonly type: "ship_queue"; readonly pr: string; readonly head: string; readonly reading: "ejected" }
  /** From a clock: a wait reached its limit. `wait` numbers the wait it was set for. */
  | { readonly type: "ship_checks_overdue"; readonly pr: string; readonly head: string; readonly wait: number }
  | { readonly type: "ship_queue_overdue"; readonly pr: string; readonly head: string };

const stay = (s: Ship): Step => [s, []];
const over = (s: Held, outcome: ShipOutcome): Step => [{ phase: "over", pr: s.pr, waits: s.waits, outcome }, []];
const sofar = (s: Sofar): Sofar => ({ pr: s.pr, waits: s.waits, moves: s.moves, rerunFor: s.rerunFor, waited: s.waited });
const isHere = (s: Held & { readonly head: string }, m: AtHead): boolean => m.pr === s.pr && m.head === s.head;

function read(s: Sofar): Step {
  const asked = readShipFacts({ pr: s.pr });
  return [{ ...sofar(s), phase: "reading", asked }, [asked]];
}
/** Wait on the checks of `head`, with a clock of its own. */
const wait = (s: Sofar, head: string, after: readonly Rerun[] = []): Step => [{ ...sofar(s), phase: "waiting", head, after, waited: s.waited + 1 }, []];

/**
 * A ship machine, made with its own settings. A run copies them into its
 * state when it starts, so a run that is saved and started again goes by the
 * numbers it began with, whatever machine picks it up.
 */
export function createShip(config: ShipConfig = {}) {
  const waits: Waits = { ...DEFAULT_WAITS, ...config.waits };
  return defineMachine({
    types: { model: {} as Ship, msg: {} as ShipMsg, sub: {} as ChecksSub | QueueSub | TimerSub<ShipMsg>, ctx: undefined },
    cmds: [readShipFacts, rerunChecks, enqueue, finish],
    init: (loaded) => [loaded ?? { phase: "idle" }, []],
    update: {
      start: (s, m): Step => (s.phase === "idle" ? read({ pr: m.pr, waits, moves: 0, rerunFor: null, waited: 0 }) : stay(s)),
      resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),

      ship_facts_ok: (s, m): Step => {
        if (s.phase !== "reading") return stay(s);
        const gate = shipGate(m.value);
        switch (gate.answer) {
          case "go": {
            const { head, landing } = gate;
            const asked = enqueue({ pr: s.pr, head, intent: intentOf("ship", s.pr, "enqueue", head) });
            return [{ ...sofar(s), phase: "enqueueing", head, landing, asked }, [asked]];
          }
          case "wait_for_checks":
            return wait(s, gate.head);
          case "stop": {
            const { outcome } = gate;
            const { head } = m.value;
            // Red checks are run again once before the builder is called. Once for each head: a new head starts over.
            if (nameOf(outcome) !== "send:builder:checks_red" || s.rerunFor === head) return over(s, outcome);
            const asked = rerunChecks({ pr: s.pr, head, intent: intentOf("ship", s.pr, "rerun", head) });
            return [{ ...sofar(s), phase: "rerunning", head, rerunFor: head, asked }, [asked]];
          }
        }
      },
      ship_facts_err: (s): Step => (s.phase === "reading" ? over(s, { kind: "stuck", why: "read_failed" }) : stay(s)),

      ship_rerun_checks_ok: (s, m): Step => (s.phase === "rerunning" && m.cmd.intent === s.asked.intent ? wait(s, s.head, m.value) : stay(s)),
      // The re-run was only a courtesy. Without it the answer is the one the gate gave: the checks are red.
      ship_rerun_checks_err: (s, m): Step =>
        s.phase === "rerunning" && m.cmd.intent === s.asked.intent ? over(s, { kind: "send", to: "builder", why: "checks_red" }) : stay(s),

      // The Listen says only that the checks settled. How they went is read fresh, and goes through the gate again.
      ship_checks: (s, m): Step => (s.phase === "waiting" && isHere(s, m) ? read(s) : stay(s)),
      ship_checks_overdue: (s, m): Step =>
        s.phase === "waiting" && isHere(s, m) && m.wait === s.waited ? over(s, { kind: "stuck", why: "checks_stuck" }) : stay(s),

      ship_enqueue_ok: (s, m): Step => {
        // An answer to an enqueue of another head is an old one: a Cmd sent twice answers twice.
        if (s.phase !== "enqueueing" || m.cmd.intent !== s.asked.intent) return stay(s);
        switch (m.value) {
          case "queued":
            return [{ phase: "queued", pr: s.pr, waits: s.waits, head: s.head, landing: s.landing }, []];
          case "conflicts":
            return over(s, { kind: "send", to: "builder", why: "conflicts" });
          case "head_moved":
            // Read fresh, again. A branch that keeps moving does not spin the machine forever.
            return s.moves >= MAX_MOVES ? over(s, { kind: "stuck", why: "head_moving" }) : read({ ...s, moves: s.moves + 1 });
        }
      },
      // Nobody knows whether it is in the queue. Stop, and say so.
      ship_enqueue_err: (s, m): Step =>
        s.phase === "enqueueing" && m.cmd.intent === s.asked.intent ? over(s, { kind: "stuck", why: "enqueue_failed" }) : stay(s),

      ship_queue: (s, m): Step => {
        if (s.phase !== "queued" || !isHere(s, m)) return stay(s);
        if (m.reading === "ejected") return over(s, { kind: "send", to: "builder", why: "ejected" });
        const asked = finish({ pr: s.pr, intent: intentOf("ship", s.pr, "finish", s.head) });
        // The commit is the one the queue's Listen names, on the base branch: never the head taken for it.
        return [{ phase: "finishing", pr: s.pr, waits: s.waits, commit: m.commit, landing: s.landing, asked }, [asked]];
      },
      // The pull request may still be in the queue. The machine says so and does not pull it out.
      ship_queue_overdue: (s, m): Step => (s.phase === "queued" && isHere(s, m) ? over(s, { kind: "stuck", why: "queue_silent" }) : stay(s)),

      ship_finish_ok: (s): Step => (s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "done")) : stay(s)),
      // It merged all the same. The landing is the answer, and it says the tidy-up broke.
      ship_finish_err: (s): Step => (s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "failed")) : stay(s)),
    },
    subs: [checksSub, queueSub, checksClock, queueClock],
  });
}

/** A ship machine with every setting left at its default. */
export const ship = createShip();
```

Elm shape: a small child machine with its own state and pure update cells, one
per Msg. The parent steps it with `applyCell` and reads `outcome` when the
phase is `over`. Each wait is a subscription with a clock beside it. Nothing
new is needed.

The settings are given when the machine is made, and a run copies them into
its state when it starts. So a run that is saved and picked up later goes by
the numbers it began with, even under a machine made with other numbers.

Three things the first sketch did not have:

- **A Cmd that fails has an ending.** A failed read is `stuck:read_failed`. A
  failed enqueue is `stuck:enqueue_failed`: nobody knows whether it is in the
  queue. A failed tidy-up is still a `done`, with `cleanup: "failed"`, because
  it did merge.
- **A branch that keeps moving stops the machine.** After the head has moved
  under the enqueue more than `MAX_MOVES` times the answer is
  `stuck:head_moving`.
- **`update` takes `head` and `landing` from the gate's answer.** It never
  works them out from the facts itself.

### What it hands back

The shape is shared. Every stage machine answers in the same five verbs, and
a stage writes only its own words:

```ts
// src/stages/outcome.ts (built)
/** Any stage's outcome, as far as the shape goes. */
export type AnyOutcome =
  | { readonly kind: "done"; readonly part: boolean }
  | { readonly kind: "send"; readonly to: string; readonly why: string }
  | { readonly kind: "ask"; readonly who: string; readonly for: string }
  | { readonly kind: "skip"; readonly why: string }
  | { readonly kind: "stuck"; readonly why: string };

/** How an outcome is spelled. Passing on says who, then why. Ending says why. A whole `done` has nothing to add. */
export function nameOf<O extends AnyOutcome>(outcome: O): Name<O>;
export function nameOf(outcome: AnyOutcome): string {
  switch (outcome.kind) {
    case "done":
      return outcome.part ? "done:part" : "done";
    case "send":
      return `send:${outcome.to}:${outcome.why}`;
    case "ask":
      return `ask:${outcome.who}:${outcome.for}`;
    case "skip":
    case "stuck":
      return `${outcome.kind}:${outcome.why}`;
  }
}
```

```ts
// src/stages/ship/outcome.ts (built)
/**
 * The tidy-up after a merge: label flagged work, remove the working copies.
 * `not_run`: the pull request was found already merged, so this run did none.
 * `failed`: it merged, and the tidy-up broke; something may be left behind.
 */
export const Cleanup = Schema.Literals(["done", "failed", "not_run"]);
export type Cleanup = typeof Cleanup.Type;

const ship = outcomesOf({
  /** Merged. `part`: the ticket has work left ("Part of #N"). `commit`: the commit on the base branch. */
  done: { commit: Schema.String, cleanup: Cleanup },
  send: {
    /**
     * Back to the builder. The parent reads the reason to tell a repair round
     * from a free lap. `conflicts`: with the base branch. `ejected`: thrown
     * out of the merge queue.
     */
    builder: ["review_failed", "checks_red", "conflicts", "ejected", "bot_comment"],
    /** A review is missing or out of date for this commit. */
    reviewer: ["no_review"],
  },
  ask: {
    /** An owner's approval on protected files. */
    owner: ["approval"],
    /** The person who left an open comment, to resolve it. */
    commenter: ["comment"],
  },
  /** Closed or a draft, on purpose, or opened by someone outside the repo. Never shipped. */
  skip: ["closed", "draft", "not_ours"],
  /**
   * Stop, never guess. `reviews_unknown`, `approval_unknown` and
   * `merge_unknown` are facts the gate read. `checks_stuck`: the checks were
   * still running at the wait's limit, or the reader said they are stuck.
   * `queue_silent`: the merge queue said nothing by its limit; the pull
   * request may still be in it, and the machine does not pull it out.
   * `read_failed`: the facts could not be read at all. `head_moving`: the
   * branch moved under every try to queue it. `enqueue_failed`: the call that
   * queues it broke, so nobody knows whether it is in the queue.
   */
  stuck: ["read_failed", "enqueue_failed", "head_moving", "checks_stuck", "queue_silent", "merge_unknown", "approval_unknown", "reviews_unknown"],
});

export const ShipOutcome = ship.schema;
export type ShipOutcome = typeof ShipOutcome.Type;

/** Every name a ship outcome can print: `send:builder:checks_red`, `done:part`, and so on. A text that is not one does not compile. */
export type ShipName = Name<ShipOutcome>;

/** A merge either finishes the ticket or only lands part of it. */
export type Landing = "whole" | "part";

/** The one place a landing becomes an outcome, so the gate and the machine cannot say it differently. */
export const landed = (landing: Landing, commit: string, cleanup: Cleanup): ShipOutcome => ({ kind: "done", part: landing === "part", commit, cleanup });
```

Five verbs, and 21 names in all. The words a stage may say to each one it
passes work to are listed under that one, so a pair that makes no sense (a
reviewer sent red checks) is not a value of the type.

```text
done                          send:builder:review_failed    skip:closed      stuck:read_failed
done:part                     send:builder:checks_red       skip:draft       stuck:enqueue_failed
                              send:builder:conflicts        skip:not_ours    stuck:head_moving
ask:owner:approval            send:builder:ejected                           stuck:checks_stuck
ask:commenter:comment         send:builder:bot_comment                       stuck:queue_silent
                              send:reviewer:no_review                        stuck:merge_unknown
                                                                             stuck:approval_unknown
                                                                             stuck:reviews_unknown
```

### How a parent reacts

```ts
// In the parent's update, when the ship child is over. Five verbs, the same for every stage.
switch (outcome.kind) {
  case "done":  return outcome.part ? readWhatIsLeft(ticket) : close(ticket); // a part is never closed; the ticket says what is left
  case "send":  return start(outcome.to, ticket, outcome.why);                // the builder or the reviewer; a repair round or a free lap, by `why`
  case "ask":   return ask(ticket, outcome.who, outcome.for);                 // the commenter, or an owner
  case "skip":  return stop(ticket, outcome.why);                             // closed, a draft, or not ours: a person is told
  case "stuck": return stop(ticket, outcome.why);                             // something could not be read
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

Two modes. Reading is the default, and writing has to be asked for by name.
The first line it prints says which one it is in.

```sh
# Read only, the default. One pull request, no pipeline around it. Nothing is changed.
# --own: the accounts the repo treats as its own, who may open a pull request this machine lands.
# --reviewers: the accounts whose review verdicts count. Left out, the same accounts.
node src/stages/ship/run.ts https://github.com/kamp-us/demlik/pull/629 --own <account>[,<account>] [--reviewers <account>[,<account>]]
# mode: read only. Nothing on https://github.com/kamp-us/demlik/pull/629 will be changed.

# With writes. The machine runs to its end on a REAL pull request: it may put it in the
# merge queue, and it may start its red checks again. Never run so far.
node src/stages/ship/run.ts <pull request url> --own <account> --write
# mode: WRITE. This run may put <pull request url> in the merge queue and start its red checks again.
```

In read mode the run is given the read service only. The write service is
made by a call that only write mode reaches, so a read-only run has no write
to send, and a test holds it to that.

In write mode it prints the outcome and its name, and nothing else:

```json
{ "mode": "write", "pr": "<pull request url>", "outcome": { "kind": "done", "part": false, "commit": "<the commit on main>", "cleanup": "done" }, "name": "done" }
```

That block is what the code prints on a scripted run. No real run has made it.

In read mode it prints the facts it read, what the machine answers, and what
it would send next. This is a real answer, with the `notRead` texts cut short. The pull
request changed a workflow file, which the repo's CODEOWNERS protects, and
another owner approved its head:

```json
{
  "pr": "https://github.com/kamp-us/demlik/pull/629",
  "facts": {
    "head": "7779cf9be905f5c1b0c51a991f3a1a199e78b96e",
    "state": "merged",
    "ours": true,
    "ticket": "closes_it",
    "approval": "given",
    "reviews": "passed",
    "reviewKinds": [
      { "kind": "review-code", "verdict": "passed" },
      { "kind": "governance", "verdict": "passed" }
    ],
    "checks": "green",
    "mergeable": "unknown",
    "comments": []
  },
  "outcome": { "kind": "done", "part": false, "commit": "7779cf9be905f5c1b0c51a991f3a1a199e78b96e", "cleanup": "not_run" },
  "name": "done",
  "wouldSend": null,
  "wouldWaitFor": null,
  "next": "nothing: the machine stops here with this outcome",
  "notRead": ["reviews: which kinds a pull request needs is worked out here ...", "reviews, approval: the first 100 changed files ...", "checks: ...", "comments: ..."]
}
```

When the gate says go, `outcome` is `null`, `wouldSend` holds the
`ship_enqueue` Cmd, and `next` reads "would enqueue: not sent, this run
only reads". An open pull request that got there, with the same cuts:

```json
{
  "pr": "https://github.com/kamp-us/demlik/pull/597",
  "facts": { "state": "open", "ours": true, "approval": "not_needed", "reviews": "passed", "checks": "green", "mergeable": "clean", "comments": [] },
  "outcome": null,
  "wouldSend": {
    "type": "ship_enqueue",
    "pr": "https://github.com/kamp-us/demlik/pull/597",
    "head": "9eb6b52c75d64b555547780717bd43a2460bb658",
    "intent": "ship/https://github.com/kamp-us/demlik/pull/597/enqueue/9eb6b52c75d64b555547780717bd43a2460bb658"
  },
  "wouldWaitFor": null,
  "next": "would enqueue: not sent, this run only reads"
}
```

The same holds for the machine's other write. With red checks, `wouldSend`
holds the `ship_rerun_checks` Cmd and it is not sent. With checks still
running, `wouldWaitFor` is `"checks"`: the run says so and does not wait.

How the two facts that used to be guessed are read now:

- **`approval`.** The base branch's `.github/CODEOWNERS` says which files are
  protected and who owns them. That is the file today's fabrika reads. A
  changed file with an owner needs the approval of any one owner the file
  names, on this head: an approving review by an owner who did not open the
  pull request, or, in a repo with one owner, that owner's
  `control-plane-self-approval @ <commit>` comment. A team is read for its
  members. No CODEOWNERS, or a team that cannot be read, is `unknown`.
- **`reviews`.** The files a change touches say which kinds of review it
  needs: code, docs, skill pages, and from the repo's `.fabrika.jsonc`, the
  rendered review and the governance review. `passed` means every kind it
  needs has a passing verdict at this head. No `.fabrika.jsonc`, or one that
  does not read, is `unknown`.

`notRead` says what a fact's value still cannot be taken for. The one that
matters most: the rule from files to kinds of review is a copy of today's
fabrika's, kept here, so the two can drift.

## Under the operator

The operator machine (`src/operator.ts`) drives a ticket through build, review
and ship by starting today's fabrika shells. Its ship stage can be filled by
the ship machine instead. This is the first stage swapped from an agent to
code ([`direction/one-parent-stages-as-slots.md`](./direction/one-parent-stages-as-slots.md)).
The switch is set where the operator is made, and it is off unless asked for.

```ts
// src/operator.ts, src/turn.ts (built)
createOperator(slots);                        // the ship stage is the shipper shell, as always
createOperator(slots, { ship: "machine" });   // the ship stage is the ship machine, run as a child
//   in src/operate.ts:  SHIP=agent (the default)  |  SHIP=machine

// At `ship`, where the shipper shell would start: start the child on the lane's pull request.
// Its limits are the run's own: how long checks may take, how long the queue may hold it.
const machine = createShip({ waits: { checksMs: p.knobs.ciWaitMs, queueMs: p.knobs.queueStallMs } });
const [ship, cmds] = applyCell(machine, { phase: "idle" }, { type: "start", pr: t.pr });

// When the child is over, its outcome is written as ONE line on the lane, in the words a
// shipper shell reports today. Fabrika folds it as it folds a shipper's.
//   done                        LANDED, or ALREADY-MERGED when it was found merged
//   send:builder:conflicts      BASE-CONFLICTED, a lap that costs no repair round
//   send:builder:ejected        EJECTED
//   send:builder:<the rest>     ROUTED-REPAIR, a repair round
//   send:reviewer:no_review     ROUTED-REVIEW; fabrika parks it on `verdict-owed`
//   ask:owner:approval          AWAITING-CP-APPROVAL; the park whose recipe looks for the approval
//   ask:commenter:comment       a park with no cause, which the operator asks a person about
//   skip:<why>                  REFUSED, and the run stops for a person, with the name as the reason
//   stuck:<why>                 UNKNOWN, and the run stops for a person, with the name as the reason
```

What to know:

- **With the switch off nothing changes.** The machine made without it
  declares none of the child's Cmds or Listens, and every test the operator
  had passes untouched.
- **No "queued" line is written.** A shipper shell ends its run when the pull
  request enters the merge queue, so it writes `QUEUED` and the lane waits in
  another state. The child waits on the queue itself, so the lane stays at
  `ship` until the one line at the end. Whether fabrika takes a `QUEUED`
  written by the driver is therefore not asked, and still not known.
- **The working copy stays the operator's.** It made it, and it removes it on
  every way out of a run. The child's tidy-up does nothing here.
- **`WHO` does three jobs.** Whose replies count, whose pull requests may be
  landed, and whose review verdicts count are one list in `src/operate.ts`.
- **A restart carries on.** The child's state is part of the operator's, so a
  run started again finds the child where it was: its Cmd in flight is sent
  again under the same intent, and its Listens open again.
- **The field log says who shipped.** A stage the machine ran leaves a
  `shipper` row with no model and no cost, whose note names each phase the
  child stood in and how it ended.

Not checked, because nothing was run: whether fabrika's `lane report` takes
these words from a driver when no shipper shell was started. Its source has no
check on who writes a word, but each word is proved against GitHub before it
is written, and fabrika's own way into the merge queue is not this machine's.

## What is real and what is scripted

Everything is built. Every part is tested against scripted answers. Only the
reads have been run against a real repository. **No write has.**

| Part | What it does on GitHub | Built | Tested on scripted answers | Run on a real repository |
|---|---|---|---|---|
| Cmd `ship_facts` | reads the pull request, CODEOWNERS, `.fabrika.jsonc`, the owning team | yes | yes | yes, read only |
| Cmd `ship_rerun_checks` | **writes**: starts the failed jobs of the head's red runs again | yes | yes | **no** |
| Cmd `ship_enqueue` | **writes**: puts the head in the merge queue | yes | yes | **no** |
| Cmd `ship_finish` | nothing on GitHub. Alone it does nothing; with a working copy it removes that one | yes | yes | **no** |
| Listen `ship_checks` | reads, every `pollMs`, until the checks of the head settle | yes | yes | no |
| Listen `ship_queue` | reads, every `pollMs`, the pull request and GitHub's record of its times in and out of the queue, until it is merged or that record says it was thrown out | yes | yes | no. The read itself was run on three past pull requests |
| The two clocks | nothing on GitHub: tea's own timer | yes | yes | no |

The two writes, whole. There is no other call that changes anything:

```sh
# ship_enqueue: one read, then one write. GitHub refuses the write itself when the head is no longer <head>.
gh api graphql -f owner=<owner> -f name=<repo> -F number=<n> -f query='query … pullRequest { id state headRefOid mergeable isInMergeQueue isMergeQueueEnabled }'
gh api graphql -f pull=<id> -f head=<head> -f query='mutation($pull: ID!, $head: GitObjectID!) { enqueuePullRequest(input: { pullRequestId: $pull, expectedHeadOid: $head }) { mergeQueueEntry { id } } }'

# ship_rerun_checks: one read, then one write for each red run of the head.
gh api 'repos/<owner>/<repo>/actions/runs?head_sha=<head>&per_page=100'
gh api --method POST repos/<owner>/<repo>/actions/runs/<run>/rerun-failed-jobs
```

What the writes never do: arm "merge when ready", merge a pull request
directly, name a merge method, jump the queue, delete a branch, use an
owner's bypass, add a label, post a comment.

Three things to know before a first real run:

- **A repo with no merge queue.** `ship_enqueue` writes nothing and fails,
  and the run ends `stuck:enqueue_failed`. It never merges a
  pull request itself. That ending's name fits badly here: a repo with no
  queue is a known thing, not an unknown one.
- **The tidy-up is thin.** Today's shipper also labels flagged work "waiting
  for release", writes the ending in the ledger and removes the ticket's
  other working copies. None of those has a service yet, so `ship_finish`
  does none of them, and a landing still says `cleanup: "done"`.
- **"Ejected" is GitHub's own record, never one answer.** "Open and not in
  the queue" can be answered for a moment right after an enqueue, so on its
  own it means "not known yet" and the wait goes on. How it is read, in
  `queueStep` in `src/code-host-github.ts`:

  | What a read shows | The wait says |
  |---|---|
  | merged, with the commit on the base branch | `landed` |
  | closed | `ejected` |
  | the newest queue event is "removed", dated after our enqueue, with a reason other than `merged` | `ejected`, at once |
  | the record cannot be read, and the pull request is open and out of the queue on 3 reads in a row, the first and last at least 90 seconds apart | `ejected` |
  | anything else | nothing yet. `queueMs` still ends the run as `stuck:queue_silent` |

  The event is GitHub's `RemovedFromMergeQueueEvent`, with its `createdAt`
  and `reason`. GitHub writes one for a merge too, with the reason `merged`,
  so the reason is read and not only the event. On real pull requests the
  other reasons seen were `failed_checks`, `merge_conflict` and `manual`.
  "After our enqueue" is told by GitHub's clock alone: the wait opens right
  after the enqueue, and an event already there on its first read is from
  before it. The 3 and the 90 seconds are settings of the Layer (`outPolls`,
  `outMs`), beside `pollMs`.

  Two things it gives up. A wait that opens late, after a restart, takes an
  ejection that happened meanwhile for an old one, and ends
  `stuck:queue_silent` at the limit. And a "removed" event with no reason is
  not taken for an ejection.

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
  if (f.mergeable === "conflicts") return stop({ kind: "send", to: "builder", why: "conflicts" });
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
  a `skip`, with `closed` or `draft` as the `why`.
- **Red checks are run again once before the builder is called.** A re-run
  costs minutes and no money; a builder run costs both, and a new review after
  it. In the real logs 9 of 13 stops for red checks shipped from the stop with
  no new code, and experiment 54 saw 9 failed reviews turn green on a plain
  re-run. The sample is small, so count it on real tickets. Built in
  `src/stages/ship/machine.ts`: the `rerunning` phase and the
  `ship_rerun_checks` Cmd. The re-run is once for each head, and a re-run that
  cannot be asked for ends as red checks. The log of the failing job is not
  carried on the outcome yet.

  ```ts
  // checks red, first time  → ask the code host to run the failed jobs again, and wait
  // checks red, second time → { kind: "send", to: "builder", why: "checks_red" }, with the failing job's log
  type Ship =
    | ...
    | (Held & { phase: "rechecking"; head: string })   // a Listen on the checks, open only here
  ```
- **Checks still running are waited for, with a time limit.** "Still running"
  is not a problem, only early. The machine waits on the same Listen the
  re-run uses, and a machine waiting costs nothing. Built in
  `src/stages/ship/machine.ts`: the gate answers `wait_for_checks`, and the
  `waiting` phase holds the Listen and its clock. When the Listen says the
  checks settled, the facts are read fresh and go through the gate again.

  ```ts
  // checks pending              → wait
  // they turn green             → carry on to the queue
  // they turn red               → the red-checks rule above
  // still pending at the limit  → { kind: "stuck", why: "checks_stuck" }
  ```
- **Every time limit is a setting, given to a machine when it is created.**
  There is no settings list on the root that names its children. Each machine
  takes its own settings where it is made, the way `createJudge` and
  `createDraft` already do. So the root machine can have its limits and each
  ship machine its own. Nothing is read from the computer it runs on.

  ```ts
  // Each machine is made with its own settings.
  const ship = createShip({ waits: { checksMs: 30 * 60_000, queueMs: 60 * 60_000 } });

  // The root is made the same way, and is handed the machines it runs.
  const fabrika = createFabrika({ timeoutMs: 4 * 60 * 60_000, ship });

  // Run alone: make one and start it. Same machine, no root.
  createShip({ waits: { checksMs: 5 * 60_000 } });
  ```

  A setting left out takes the machine's own default. 15 minutes for the
  checks is a starting number, not a measured one. Count how often real runs
  reach it. Built in `src/stages/ship/machine.ts`: `createShip(config)`. The
  root machine in the block above is not built.
- **The queue wait has a limit too.** In 3 recorded runs the queue never
  answered. It is a setting like the checks limit, and reaching it ends the
  run as `stuck`. The pull request may still be in the queue, so the
  machine says that and does not pull it out. Built in
  `src/stages/ship/machine.ts`: the clock beside the queue's Listen, and the
  ending `stuck:queue_silent`.

  ```ts
  createShip({ waits: { queueMs: 60 * 60_000 } });
  // in the queue past the limit → { kind: "stuck", why: "queue_silent" }
  ```

## Open

- **The set of outcomes.** The names above are a first list. Today's shipper
  has 13 ending words; the real logs show 7 endings in use. On the 961
  recorded runs no eighth ending came up, but three things did not fit
  ([experiment 55](../experiments/55-ship-outcomes-on-recorded-runs.md)).
  All three are now settled above or done: a closed or draft pull request, a
  limit on the queue wait, and two different waits sharing one kind (`for`
  is now a tag, and so is the `why` of `stuck`, so a parent can `switch`
  on both).
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
  How it is read now: from the base branch's CODEOWNERS (which files, which
  owners) and the approving reviews at the head, not from GitHub's own
  "review required" answer. Where that cannot be read the fact is `unknown`.
- **Thrown out of the queue, and a conflict with main.** Both go back to the
  builder today without costing the ticket a repair round. Keep that?
- **Does today's fabrika accept a "queued" fact written by code** instead of
  by a shipper agent? Unchecked.
- **The closing message to a person.** A template per outcome, or nothing
  beyond the ledger line?
