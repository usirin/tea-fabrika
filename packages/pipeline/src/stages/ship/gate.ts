import {reviewsOf, type ShipFacts} from "./facts.ts";
import {type Landing, landed, type ShipOutcome} from "./outcome.ts";
import {ReadyToMerge, type Refusal} from "./ready.ts";

// The ship machine's one check. Every line of it is a row from today's
// shipper skill, and one that is not: the ticket's criteria, each with a
// passing verdict row on its current version at this head (./ready.ts). The
// order of the lines is a design choice still to be checked against real
// tickets (`docs/ship-machine.md`); the tests beside this file pin it as it is.

export type ShipGate =
	/**
	 * Go. It carries what the next steps need, so none of them works it out a
	 * second time: the proof it may merge, which names the head, and how it lands.
	 */
	| {readonly answer: "go"; readonly ready: ReadyToMerge; readonly landing: Landing}
	/**
	 * Not yet: the checks on this head are still running. That is no problem,
	 * only early, so it is not an outcome. What to do about it is the machine's:
	 * it waits, with a limit.
	 */
	| {readonly answer: "wait_for_checks"; readonly head: string}
	| {readonly answer: "stop"; readonly outcome: ShipOutcome};

const stop = (outcome: ShipOutcome): ShipGate => ({answer: "stop", outcome});

export const landingOf = (f: Pick<ShipFacts, "ticket">): Landing =>
	f.ticket !== "none" && f.ticket.link === "part_of_it" ? "part" : "whole";

/** A criterion whose row at this head failed: the builder has work. */
const notMet = (r: Refusal) => r.why === "not_met";
/** A criterion with no row on its current words at this head: a review is owed. */
const unjudged = (r: Refusal) =>
	r.why === "no_verdict" || r.why === "other_head" || r.why === "old_version";

/**
 * A pull request found already merged: which kind of landing it was. A merge
 * either finishes the ticket or only lands part of it, and the two are
 * different answers. This run did no tidy-up after it.
 */
export const landedAs = (f: ShipFacts): ShipOutcome => landed(landingOf(f), f.head, "not_run");

/**
 * What each approval reading says at the gate. `null`: it lets the pull
 * request on. Every reading has a row, so one added later cannot pass unsaid,
 * and `unknown` is a stop: nobody is asked on a guess.
 */
const BY_APPROVAL: {readonly [A in ShipFacts["approval"]]: ShipOutcome | null} = {
	not_needed: null,
	given: null,
	missing: {kind: "ask", who: "owner", for: "approval"},
	unknown: {kind: "stuck", why: "approval_unknown"},
};

/** The same for the checks: only `green` goes on, `pending` waits, and a reading that cannot be told stops. */
const BY_CHECKS: {readonly [C in ShipFacts["checks"]]: "on" | "wait" | ShipOutcome} = {
	green: "on",
	pending: "wait",
	red: {kind: "send", to: "builder", why: "checks_red"},
	stuck: {kind: "stuck", why: "checks_stuck"},
};

/** Go, wait, or the one reason not to, for the pull request `pr`. Pure: same facts in, same answer out. */
export function shipGate(pr: string, f: ShipFacts): ShipGate {
	// From the rows, here: no word a reader wrote decides it.
	const reviews = reviewsOf(f.reviews);
	const readiness =
		f.criteria === null
			? null
			: ReadyToMerge.of({
					pr,
					head: f.head,
					tested: f.main.tested,
					criteria: f.criteria,
					verdicts: f.verdicts,
					checks: {head: f.head, state: f.checks},
				});
	const refused = readiness !== null && "refused" in readiness ? readiness.refused : [];
	if (f.state === "merged") return stop(landedAs(f)); // already merged: say which kind of landing it was
	if (f.state !== "open") return stop({kind: "skip", why: f.state}); // closed or a draft, on purpose
	if (!f.ours) return stop({kind: "skip", why: "not_ours"});
	if (f.mergeable === "conflicts") return stop({kind: "send", to: "builder", why: "conflicts"});
	if (reviews === "failed") return stop({kind: "send", to: "builder", why: "review_failed"});
	if (reviews === "missing") return stop({kind: "send", to: "reviewer", why: "no_review"});
	if (reviews === "unknown") return stop({kind: "stuck", why: "reviews_unknown"}); // one passing review is never taken for all
	if (readiness === null) return stop({kind: "stuck", why: "criteria_unknown"}); // nothing to prove it ready by
	if (refused.some(notMet)) return stop({kind: "send", to: "builder", why: "review_failed"});
	if (refused.some(unjudged)) return stop({kind: "send", to: "reviewer", why: "no_review"}); // a new head, or new words
	if (f.checks === "red") return stop({kind: "send", to: "builder", why: "checks_red"}); // the machine runs them again once first
	if (f.comments.some((c) => c.by === "person"))
		return stop({kind: "ask", who: "commenter", for: "comment"});
	if (f.comments.length > 0) return stop({kind: "send", to: "builder", why: "bot_comment"});
	const approval = BY_APPROVAL[f.approval];
	if (approval !== null) return stop(approval);
	const checks = BY_CHECKS[f.checks];
	if (checks === "wait") return {answer: "wait_for_checks", head: f.head};
	if (checks !== "on") return stop(checks);
	if (f.mergeable === "unknown") return stop({kind: "stuck", why: "merge_unknown"});
	// Every line above is clear, so the checks are green here: only the proof says go.
	return "ready" in readiness
		? {answer: "go", ready: readiness.ready, landing: landingOf(f)}
		: stop({kind: "stuck", why: "proof_refused"});
}
