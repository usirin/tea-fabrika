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
 * Instance readiness and owned-resource checks.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a readiness answer about the expected instance: still waiting, or ready.
 *
 * @stability unstable
 * @category schemas
 */
export const Readiness = Schema.TaggedUnion({ waiting: {}, ready: {} });
/**
 * Schema for an owned-resource answer: still waiting, or every owned group and the listener gone.
 *
 * @stability unstable
 * @category schemas
 */
export const Children = Schema.TaggedUnion({ waiting: {}, gone: {} });
/**
 * Readiness could not be checked.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}
/**
 * Another instance owns the fixed address.
 *
 * @stability unstable
 * @category errors
 */
export class Foreign extends Schema.TaggedError<Foreign>()("Foreign", { cause: Schema.Defect() }) {}
/**
 * Owned resources could not be checked.
 *
 * @stability unstable
 * @category errors
 */
export class Cleanup extends Schema.TaggedError<Cleanup>()("Cleanup", { cause: Schema.Defect() }) {}

/**
 * Probe failure with its protected cause.
 *
 * @stability unstable
 * @category errors
 */
export class BrainProbeError extends Schema.TaggedError<BrainProbeError>()("BrainProbeError", {
  reason: Schema.Union([Unreachable, Foreign, Cleanup]),
}) {}

/**
 * Probes supplied by the client that owns the instance.
 *
 * @stability unstable
 * @category services
 */
export class BrainProbe extends Context.Service<
  BrainProbe,
  {
    readonly ready: Effect.Effect<typeof Readiness.Type, BrainProbeError>;
    readonly cleanup: Effect.Effect<typeof Children.Type, BrainProbeError>;
  }
>()("@kampus/libfabrika/desktop/BrainProbe") {}
