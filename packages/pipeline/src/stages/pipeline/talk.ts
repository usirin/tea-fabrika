import type { Outcome } from "../../tickets/ticket.ts";
import { after, type LaneStep } from "./machine.ts";

// What a step's end says on the ticket, beside its `ended` fact. Pure: the lane's Act posts it.
//
//   stuck, and the lane ends on it   `<step> is stuck.` and why
//   ask, or a stuck the lane asks    what the step found, for the question that comes next:
//   about (`rounds_spent`)           the question is all a person is asked, never "is stuck"
//   anything else, or nothing found  nothing

/** One comment a step's end posts. `stuck`: under `<run>/why`. `found`: under `<run>/found`. */
export type EndTalk = { readonly kind: "stuck" | "found"; readonly body: string };

/** The comment `step`'s end in `round` posts, given what its machine found. `null`: none. Pure. */
export const endTalk = (
  step: LaneStep,
  outcome: Outcome,
  round: number,
  problems: readonly string[],
): EndTalk | null => {
  if (problems.length === 0) {
    return null;
  }

  // `send_back` is no matter here: it changes only where a red head goes, and a red head is a send.
  if (outcome.kind === "stuck" && !("ask" in after(step, outcome, round))) {
    return { kind: "stuck", body: `${step} is stuck. ${problems.join(" ").slice(0, 2_000)}` };
  }

  return outcome.kind === "ask" || outcome.kind === "stuck" ? { kind: "found", body: problems.join("\n") } : null;
};
