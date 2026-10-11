import { Schema } from "effect";

// What the ship machine hands back: one typed answer, and nothing else. The
// machine that started it reads the answer and decides what happens next. The
// design is in `docs/ship-machine.md`.

/** Why a pull request goes back to the builder. The parent reads it to tell a repair round from a free lap. */
export const BackToBuilderWhy = Schema.Literals(["review_failed", "checks_red", "conflicts_with_main", "thrown_out_of_queue", "bot_comment"]);
export type BackToBuilderWhy = typeof BackToBuilderWhy.Type;

export const ShipOutcome = Schema.Union([
  /** Merged, and the ticket is finished. */
  Schema.Struct({ kind: Schema.Literal("landed"), commit: Schema.String }),
  /** Merged, but the ticket has work left ("Part of #N"). */
  Schema.Struct({ kind: Schema.Literal("landed_part"), commit: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("back_to_builder"), why: BackToBuilderWhy }),
  /** A review is missing or out of date for this commit. */
  Schema.Struct({ kind: Schema.Literal("back_to_reviewer") }),
  Schema.Struct({ kind: Schema.Literal("waiting_on_person"), who: Schema.String, forWhat: Schema.String }),
  /** A read failed: stop, never guess. */
  Schema.Struct({ kind: Schema.Literal("cannot_tell") }),
  /** The pull request belongs to someone outside the repo. */
  Schema.Struct({ kind: Schema.Literal("not_ours") }),
]);
export type ShipOutcome = typeof ShipOutcome.Type;
