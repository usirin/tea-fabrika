import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome";

// What the ship machine hands back: one typed answer, and nothing else. The
// machine that started it reads the answer and decides what happens next. The
// design is in `docs/ship-machine.md`.
//
// The shape is the one every stage uses: five verbs (`../outcome.ts`,
// docs/direction/outcome-names.md). Only the words below are the ship
// machine's own.

/**
 * The tidy-up after a merge: label flagged work, remove the working copies.
 * `not_run`: the pull request was found already merged, so this run did none.
 * `failed`: it merged, and the tidy-up broke; something may be left behind.
 */
export const Cleanup = Schema.Literals(["done", "failed", "not_run"]);
export type Cleanup = typeof Cleanup.Type;

const ship = outcomesOf({
	/** Merged. `part`: the ticket has work left ("Part of #N"). `commit`: the commit on the base branch. */
	done: {commit: Schema.String, cleanup: Cleanup},
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
	stuck: [
		"read_failed",
		"enqueue_failed",
		"head_moving",
		"checks_stuck",
		"queue_silent",
		"merge_unknown",
		"approval_unknown",
		"reviews_unknown",
	],
});

export const ShipOutcome = ship.schema;
export type ShipOutcome = typeof ShipOutcome.Type;

/** Every name a ship outcome can print: `send:builder:checks_red`, `done:part`, and so on. A text that is not one does not compile. */
export type ShipName = Name<ShipOutcome>;
export const SHIP_NAMES = ship.names;
/** Whether a text read from outside (a log, a ledger line) is a ship outcome's name. */
export const isShipName = ship.isName;

/** A merge either finishes the ticket or only lands part of it. */
export type Landing = "whole" | "part";

/** The one place a landing becomes an outcome, so the gate and the machine cannot say it differently. */
export const landed = (landing: Landing, commit: string, cleanup: Cleanup): ShipOutcome => ({
	kind: "done",
	part: landing === "part",
	commit,
	cleanup,
});
