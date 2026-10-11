import type { ShipFacts } from "./facts.ts";
import { type Landing, landed, type ShipOutcome } from "./outcome.ts";

// The ship machine's one check. Every line of it is a row from today's
// shipper skill. The order of the lines is a design choice still to be checked
// against real tickets (`docs/ship-machine.md`); the tests beside this file
// pin it as it is.

export type ShipGate =
  /** Go. It carries what the next steps need, so none of them works it out a second time. */
  | { readonly go: true; readonly head: string; readonly landing: Landing }
  | { readonly go: false; readonly outcome: ShipOutcome };

const stop = (outcome: ShipOutcome): ShipGate => ({ go: false, outcome });

export const landingOf = (f: ShipFacts): Landing => (f.ticket === "part_of_it" ? "part" : "whole");

/**
 * A pull request found already merged: which kind of landing it was. A merge
 * either finishes the ticket or only lands part of it, and the two are
 * different answers. This run did no tidy-up after it.
 */
export const landedAs = (f: ShipFacts): ShipOutcome => landed(landingOf(f), f.head, "not_run");

/** Go, or the one reason not to. Pure: same facts in, same answer out. */
export function shipGate(f: ShipFacts): ShipGate {
  if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
  if (f.state !== "open") return stop({ kind: "nothing_to_ship", why: f.state }); // closed or a draft, on purpose
  if (!f.ours) return stop({ kind: "not_ours" });
  if (f.mergeable === "conflicts") return stop({ kind: "back_to_builder", why: "conflicts_with_main" });
  if (f.reviews === "failed") return stop({ kind: "back_to_builder", why: "review_failed" });
  if (f.reviews === "missing") return stop({ kind: "back_to_reviewer" });
  if (f.reviews === "unknown") return stop({ kind: "cannot_tell", why: "reviews_unknown" }); // one passing review is never taken for all
  if (f.checks === "red") return stop({ kind: "back_to_builder", why: "checks_red" });
  if (f.comments.some((c) => c.by === "person")) return stop({ kind: "waiting_on_person", forWhat: "resolve_comment" });
  if (f.comments.length > 0) return stop({ kind: "back_to_builder", why: "bot_comment" });
  if (f.approval === "missing") return stop({ kind: "waiting_on_person", forWhat: "owner_approval" });
  if (f.approval === "unknown") return stop({ kind: "cannot_tell", why: "approval_unknown" }); // nobody is asked on a guess
  if (f.checks === "pending") return stop({ kind: "cannot_tell", why: "checks_pending" });
  if (f.checks === "stuck") return stop({ kind: "cannot_tell", why: "checks_stuck" });
  if (f.mergeable === "unknown") return stop({ kind: "cannot_tell", why: "mergeable_unknown" });
  return { go: true, head: f.head, landing: landingOf(f) };
}
