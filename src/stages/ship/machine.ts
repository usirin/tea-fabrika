import { defineMachine, type Sub } from "@demlik/tea";
import { Schema } from "effect";
import { act, gather, intentOf, listen } from "../../primitives.ts";
import { ShipFacts } from "./facts.ts";
import { shipGate } from "./gate.ts";
import { type Landing, landed, type ShipOutcome } from "./outcome.ts";

// The ship machine: one pull request in, one typed outcome out, no agent in
// between (`docs/ship-machine.md`). It is made of four moves:
//
//   Gather  read the facts, fresh, at the commit about to land
//   Check   the gate (./gate.ts): go, or the one reason not to
//   Act     put it in the merge queue; after it lands, tidy up
//   Listen  the merge queue, open only while the pull request is in it
//
// Its input is the pull request and nothing else, so it runs alone or as a
// child, the same way. A parent steps it with `applyCell` and reads `outcome`
// when the phase is `over`. It never decides what the pipeline does next.
//
// Only the machine is here. The handlers that answer its Cmds and the runner
// behind its Listen are not built yet.

const Unknown = ["unknown"] as const;
const At = Schema.Struct({ pr: Schema.String });

/** Everything the gate needs, read in one go. */
export const readShipFacts = gather("ship_facts", { input: At, ok: ShipFacts, err: Unknown });

/** Put this head in the merge queue. It refuses when the head is no longer this one. */
export const enqueue = act("ship_enqueue", {
  input: Schema.Struct({ pr: Schema.String, head: Schema.String }),
  ok: Schema.Literals(["queued", "head_moved", "conflicts"]),
  err: Unknown,
});

/** The tidy-up after a merge: label flagged work, remove the working copies. */
export const finish = act("ship_finish", { input: At, ok: Schema.Null, err: Unknown });

type ReadCmd = ReturnType<typeof readShipFacts>;
type EnqueueCmd = ReturnType<typeof enqueue>;
type FinishCmd = ReturnType<typeof finish>;
export type ShipCmd = ReadCmd | EnqueueCmd | FinishCmd;

/** The merge queue, for one pull request at one head. The runner says how it left the queue, once. */
export type QueueSub = Sub<"ship_queue", { readonly pr: string; readonly head: string }>;

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

type Step = readonly [Ship, readonly ShipCmd[]];

const stay = (s: Ship): Step => [s, []];
const over = (s: Held, outcome: ShipOutcome): Step => [{ phase: "over", pr: s.pr, outcome }, []];

function read(pr: string, moves: number): Step {
  const asked = readShipFacts({ pr });
  return [{ phase: "reading", pr, moves, asked }, [asked]];
}

/** The Listen: open only while the pull request is in the queue. Nothing is paid to wait. */
export const queueSub = listen("ship_queue", (s: Ship) => (s.phase === "queued" ? { pr: s.pr, head: s.head } : null));

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
