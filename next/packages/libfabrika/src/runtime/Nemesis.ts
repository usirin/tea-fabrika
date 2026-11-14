/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * The trusted fault and history-check contract. Layers live in sibling files.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Fire, Fired, Report, Target } from "./Chaos.ts";

/**
 * Chaos is disabled.
 *
 * @stability unstable
 * @category errors
 */
export class Off extends Schema.TaggedError<Off>()("Off", { cause: Schema.Defect() }) {}

/**
 * The requested target cannot be used.
 *
 * @stability unstable
 * @category errors
 */
export class BadTarget extends Schema.TaggedError<BadTarget>()("BadTarget", { cause: Schema.Defect() }) {}

/**
 * The caller lacks the required grant.
 *
 * @stability unstable
 * @category errors
 */
export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", { cause: Schema.Defect() }) {}

/**
 * The operation did not reach its destination.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

/**
 * History contained an undecodable known row or invalid position.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Storage failed while reading the check's snapshot.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * The service's own error, retaining the original cause in its reason.
 *
 * @stability unstable
 * @category errors
 */
export class NemesisError extends Schema.TaggedError<NemesisError>()("NemesisError", {
  reason: Schema.Union([Off, BadTarget, NotGranted, Unreachable, BadRow, Storage]),
}) {}

/**
 * Performs trusted faults and checks bounded history.
 *
 * @stability unstable
 * @category services
 */
export class Nemesis extends Context.Service<
  Nemesis,
  {
    readonly fire: (request: Fire) => Effect.Effect<Fired, NemesisError>;
    readonly check: (target: Target) => Effect.Effect<Report, NemesisError>;
  }
>()("@kampus/libfabrika/runtime/Nemesis") {}
