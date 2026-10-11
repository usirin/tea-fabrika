import { Schema } from "effect";

// What the ship machine hands back: one typed answer, and nothing else. The
// machine that started it reads the answer and decides what happens next. The
// design is in `docs/ship-machine.md`.
//
// Every field a parent may need to tell two answers apart is a fixed tag, so
// a parent can `switch` on it. The words a person reads are made from the
// tags, in a view.

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
