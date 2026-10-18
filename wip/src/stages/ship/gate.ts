import type {ShipFacts} from "./facts";
import {type Landing, landed, type ShipOutcome} from "./outcome";

// The ship machine's one check. Every line of it is a row from today's
// shipper skill. The order of the lines is a design choice still to be checked
// against real tickets (`docs/ship-machine.md`); the tests beside this file
// pin it as it is.

export type ShipGate =
	/** Go. It carries what the next steps need, so none of them works it out a second time. */
	| {readonly answer: "go"; readonly head: string; readonly landing: Landing}
	/**
	 * Not yet: the checks on this head are still running. That is no problem,
	 * only early, so it is not an outcome. What to do about it is the machine's:
	 * it waits, with a limit.
	 */
	| {readonly answer: "wait_for_checks"; readonly head: string}
	| {readonly answer: "stop"; readonly outcome: ShipOutcome};

const stop = (outcome: ShipOutcome): ShipGate => ({answer: "stop", outcome});

export const landingOf = (f: ShipFacts): Landing => (f.ticket === "part_of_it" ? "part" : "whole");

/**
 * A pull request found already merged: which kind of landing it was. A merge
 * either finishes the ticket or only lands part of it, and the two are
 * different answers. This run did no tidy-up after it.
 */
export const landedAs = (f: ShipFacts): ShipOutcome => landed(landingOf(f), f.head, "not_run");

/** Go, wait, or the one reason not to. Pure: same facts in, same answer out. */
export function shipGate(f: ShipFacts): ShipGate {
	if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
	if (f.state !== "open") return stop({kind: "skip", why: f.state}); // closed or a draft, on purpose
	if (!f.ours) return stop({kind: "skip", why: "not_ours"});
	if (f.mergeable === "conflicts") return stop({kind: "send", to: "builder", why: "conflicts"});
	if (f.reviews === "failed") return stop({kind: "send", to: "builder", why: "review_failed"});
	if (f.reviews === "missing") return stop({kind: "send", to: "reviewer", why: "no_review"});
	if (f.reviews === "unknown") return stop({kind: "stuck", why: "reviews_unknown"}); // one passing review is never taken for all
	if (f.checks === "red") return stop({kind: "send", to: "builder", why: "checks_red"}); // the machine runs them again once first
	if (f.comments.some((c) => c.by === "person"))
		return stop({kind: "ask", who: "commenter", for: "comment"});
	if (f.comments.length > 0) return stop({kind: "send", to: "builder", why: "bot_comment"});
	if (f.approval === "missing") return stop({kind: "ask", who: "owner", for: "approval"});
	if (f.approval === "unknown") return stop({kind: "stuck", why: "approval_unknown"}); // nobody is asked on a guess
	if (f.checks === "pending") return {answer: "wait_for_checks", head: f.head};
	if (f.checks === "stuck") return stop({kind: "stuck", why: "checks_stuck"});
	if (f.mergeable === "unknown") return stop({kind: "stuck", why: "merge_unknown"});
	return {answer: "go", head: f.head, landing: landingOf(f)};
}
