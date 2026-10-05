import { Cmd, defineMachine } from "@demlik/tea";
import { z } from "zod";
import type { MissingOnRecord } from "./review.ts";

// Ship: put a change that passed review into the base branch. Each part is
// owned by whoever does it best:
//
//   repo    seal the change as one commit, land it, merge it with a base that moved
//   person  approve the sealed commit; nothing lands without it, and an agent never gives it
//   tests   a change merged with a moved base runs on a fresh copy before it lands
//
// The approval names the commit it is for, so it cannot be spent on anything
// else. A base that moved since merges and ships as approved when the merge is
// clean and its tests pass: the change itself did not move. A conflict, or
// tests that fail only with the new base, stop for a person.

/** Seal the change as one commit on top of where the work started. The branch the builder works on does not move. */
export const seal = Cmd.define("seal", {
  input: z.object({ message: z.string() }),
  ok: z.object({ head: z.string(), stat: z.string() }),
  err: ["repo_failed"],
});

/** Move the base branch to `head`, if `head` already holds all of it. Otherwise the base moved. */
export const land = Cmd.define("land", {
  input: z.object({ head: z.string() }),
  ok: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("landed"), sha: z.string() }),
    z.object({ kind: z.literal("behind") }),
  ]),
  err: ["repo_failed"],
});

/** Merge `head` with the base as it is now, without touching any folder. */
export const catchUp = Cmd.define("catch_up", {
  input: z.object({ head: z.string() }),
  ok: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("merged"), head: z.string() }),
    z.object({ kind: z.literal("conflicted"), files: z.array(z.string()).readonly() }),
  ]),
  err: ["repo_failed"],
});

/** Run the tests on a fresh copy of one commit. */
export const retest = Cmd.define("retest", {
  input: z.object({ head: z.string() }),
  ok: z.object({ passed: z.boolean(), output: z.string() }),
  err: ["repo_failed"],
});

/** What the person approving reads: what review and the comments left on the record. */
export interface ShipInput {
  readonly issue: string;
  readonly title: string;
  /** One line each: extra changes that stayed, findings filed, findings matched, comments settled. */
  readonly record: readonly string[];
  /**
   * How the missing-file check went, kept as data beside its line in `record`:
   * a skipped check must not read the same as a clean one.
   */
  readonly missing: MissingOnRecord;
}

type Held = { readonly input: ShipInput };
/** `approved` is the sealed commit a person approved; `head` is what is being landed: it, or it merged with a moved base. */
type Approved = Held & { readonly approved: string; readonly head: string };

type Sealing = Held & { readonly phase: "sealing" };
type Landing = Approved & { readonly phase: "landing" };
type CatchingUp = Approved & { readonly phase: "catching_up" };
type Retesting = Approved & { readonly phase: "retesting" };

/** Why ship stopped and is waiting on a person. */
export type ShipPark =
  /** The sealed commit, waiting for a person's approval. `stat` is what it changes. */
  | { readonly kind: "approve"; readonly head: string; readonly stat: string }
  /** The base moved and the change no longer merges with it. */
  | { readonly kind: "conflicted"; readonly approved: string; readonly files: readonly string[] }
  /** The change merges with the moved base, but the tests fail on the merge. */
  | { readonly kind: "fails_on_new_base"; readonly approved: string; readonly output: string }
  | { readonly kind: "repo_failed"; readonly from: Sealing | Landing | CatchingUp | Retesting };

type Drop = { readonly kind: "drop" };

export interface ShipParkAnswers {
  /** `approve` names the commit it approves; an answer naming any other leaves ship parked. */
  readonly approve: { readonly kind: "approve"; readonly head: string } | Drop;
  /** `retry`: try landing again, once the base is fixed. */
  readonly conflicted: { readonly kind: "retry" } | Drop;
  readonly fails_on_new_base: { readonly kind: "retry" } | Drop;
  readonly repo_failed: { readonly kind: "retry" } | Drop;
}

export type ShipParkAnswer = {
  [K in keyof ShipParkAnswers]: { readonly park: K; readonly answer: ShipParkAnswers[K] };
}[keyof ShipParkAnswers];

export type Ship =
  | { readonly phase: "idle" }
  | Sealing
  | (Held & { readonly phase: "parked"; readonly why: ShipPark })
  | Landing
  | CatchingUp
  | Retesting
  /** In the base branch. `sha` is the base's new tip. */
  | (Held & { readonly phase: "landed"; readonly sha: string })
  | (Held & { readonly phase: "dropped"; readonly why: ShipPark });

export type ShipMsg =
  | { readonly type: "start"; readonly input: ShipInput }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  | { readonly type: "answer"; readonly answer: ShipParkAnswer };

export type ShipCmd =
  | ReturnType<typeof seal>
  | ReturnType<typeof land>
  | ReturnType<typeof catchUp>
  | ReturnType<typeof retest>;
type Step = readonly [Ship, readonly ShipCmd[]];

const stay = (s: Ship): Step => [s, []];
const park = (s: Held, why: ShipPark): Step => [{ phase: "parked", input: s.input, why }, []];
const approved = (s: Approved): Approved => ({ input: s.input, approved: s.approved, head: s.head });

const startSealing = (input: ShipInput): Step => [
  { phase: "sealing", input },
  [seal({ message: `${input.title}\n\nCloses ${input.issue}` })],
];

/** Land `head`. The approved commit stays with it, so a moved base merges the change, not an earlier merge. */
const startLanding = (s: Held, approvedHead: string, head: string): Step => [
  { phase: "landing", input: s.input, approved: approvedHead, head },
  [land({ head })],
];

/** The Cmd a state was waiting on, asked again. */
function inFlight(s: Sealing | Landing | CatchingUp | Retesting): Step {
  switch (s.phase) {
    case "sealing":
      return startSealing(s.input);
    case "landing":
      return [s, [land({ head: s.head })]];
    case "catching_up":
      return [s, [catchUp({ head: s.approved })]];
    case "retesting":
      return [s, [retest({ head: s.head })]];
  }
}

function answerPark(s: Extract<Ship, { phase: "parked" }>, { park: kind, answer }: ShipParkAnswer): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ phase: "dropped", input: s.input, why: s.why }, []];
  switch (s.why.kind) {
    case "approve":
      // An approval is for one commit: it cannot be spent on another.
      return answer.kind === "approve" && answer.head === s.why.head ? startLanding(s, s.why.head, s.why.head) : stay(s);
    case "conflicted":
    case "fails_on_new_base":
      return startLanding(s, s.why.approved, s.why.approved);
    case "repo_failed":
      return inFlight(s.why.from);
  }
}

const isRunning = (s: Ship): s is Sealing | Landing | CatchingUp | Retesting =>
  s.phase === "sealing" || s.phase === "landing" || s.phase === "catching_up" || s.phase === "retesting";

/**
 * One change, from sealed to landed. Every cell ignores a Msg that arrives in
 * a phase it does not belong to, so a late answer changes nothing.
 */
export const ship = defineMachine({
  types: { model: {} as Ship, msg: {} as ShipMsg, ctx: undefined },
  cmds: [seal, land, catchUp, retest],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => (s.phase === "idle" ? startSealing(m.input) : stay(s)),
    resume: (s): Step => (isRunning(s) ? inFlight(s) : stay(s)),
    answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer) : stay(s)),
    seal_ok: (s, m): Step =>
      s.phase === "sealing" ? park(s, { kind: "approve", head: m.value.head, stat: m.value.stat }) : stay(s),
    land_ok: (s, m): Step => {
      if (s.phase !== "landing") return stay(s);
      return m.value.kind === "landed"
        ? [{ phase: "landed", input: s.input, sha: m.value.sha }, []]
        : [{ phase: "catching_up", ...approved(s) }, [catchUp({ head: s.approved })]];
    },
    catch_up_ok: (s, m): Step => {
      if (s.phase !== "catching_up") return stay(s);
      return m.value.kind === "conflicted"
        ? park(s, { kind: "conflicted", approved: s.approved, files: m.value.files })
        : [{ phase: "retesting", ...approved(s), head: m.value.head }, [retest({ head: m.value.head })]];
    },
    retest_ok: (s, m): Step => {
      if (s.phase !== "retesting") return stay(s);
      return m.value.passed
        ? startLanding(s, s.approved, s.head)
        : park(s, { kind: "fails_on_new_base", approved: s.approved, output: m.value.output });
    },
    seal_err: (s): Step => (s.phase === "sealing" ? park(s, { kind: "repo_failed", from: s }) : stay(s)),
    land_err: (s): Step => (s.phase === "landing" ? park(s, { kind: "repo_failed", from: s }) : stay(s)),
    catch_up_err: (s): Step => (s.phase === "catching_up" ? park(s, { kind: "repo_failed", from: s }) : stay(s)),
    retest_err: (s): Step => (s.phase === "retesting" ? park(s, { kind: "repo_failed", from: s }) : stay(s)),
  },
});

export const isShipped = (s: Ship): boolean => s.phase === "landed";
