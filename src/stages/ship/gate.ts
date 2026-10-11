import type { ShipFacts } from "./facts.ts";
import type { ShipOutcome } from "./outcome.ts";

// The ship machine's one check. Every line of it is a row from today's
// shipper skill. The order of the lines is a design choice still to be checked
// against real tickets (`docs/ship-machine.md`); the tests beside this file
// pin it as it is.

/** A merge either finishes the ticket or only lands part of it. */
export type Landing = "whole" | "part";

export type ShipGate =
  /** Go. It carries what the next steps need, so none of them works it out a second time. */
  | { readonly go: true; readonly head: string; readonly landing: Landing }
  | { readonly go: false; readonly outcome: ShipOutcome };

const stop = (outcome: ShipOutcome): ShipGate => ({ go: false, outcome });

export const landingOf = (f: ShipFacts): Landing => (f.ticket === "part_of_it" ? "part" : "whole");

/** A merge either finishes the ticket or only lands part of it. The two are different answers. */
export const landedAs = (f: ShipFacts): ShipOutcome =>
  landingOf(f) === "part" ? { kind: "landed_part", commit: f.head } : { kind: "landed", commit: f.head };

/** Go, or the one reason not to. Pure: same facts in, same answer out. */
export function shipGate(f: ShipFacts): ShipGate {
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
  return { go: true, head: f.head, landing: landingOf(f) };
}
