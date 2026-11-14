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
import { Outcome } from "@demlik/tea";
import { Ci, CodeHost, type Handler } from "@kampus/libfabrika";
import { Cause, Effect, Schema } from "effect";
import { Inputs } from "./Merger.ts";

export class HandlerDefect extends Schema.TaggedError<HandlerDefect>()("HandlerDefect", {
  cmd: Schema.Literals(["change", "update", "checks", "merge"]),
}) {}

const Fault = Schema.TaggedUnion({ unavailable: {}, rate_limited: {}, refused: {} });

const faults = {
  Unavailable: Fault.cases.unavailable,
  RateLimited: Fault.cases.rate_limited,
  Refused: Fault.cases.refused,
};

type Command = keyof typeof Inputs;

// This boundary must not retain a service's failure text in runner letters or spans.
const outcome =
  (cmd: Command) =>
  <A, R>(effect: Effect.Effect<A, CodeHost.CodeHostError | Ci.CiError | Schema.SchemaError, R>) =>
    effect.pipe(
      Effect.map(Outcome.ok),
      Effect.catchTag(["CodeHostError", "CiError"], (error) =>
        Effect.succeed(Outcome.err(faults[error.reason._tag].make({}))),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) {
          return Effect.interrupt;
        }

        return Effect.fail(new HandlerDefect({ cmd }));
      }),
    );

export const handlers: Readonly<Record<string, Handler<CodeHost.CodeHost | Ci.Ci>>> = {
  change: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.change)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan("fab.change", c.change)),
      Effect.flatMap((c) => CodeHost.CodeHost.use((h) => h.change(c.change))),
      outcome("change"),
    ),
  update: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.update)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan({ "fab.change": c.change, "fab.head": c.head })),
      Effect.flatMap((c) => CodeHost.CodeHost.use((h) => h.update(c.change, c.head))),
      outcome("update"),
    ),
  checks: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.checks)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan("fab.head", c.head)),
      Effect.flatMap((c) =>
        Ci.Ci.use((ci) => (c.start ? ci.start(c.head) : Effect.void).pipe(Effect.andThen(ci.at(c.head)))),
      ),
      Effect.tap((runs) =>
        Effect.annotateCurrentSpan(
          "fab.checks",
          runs.map((r) => r.name),
        ),
      ),
      outcome("checks"),
    ),
  merge: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.merge)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan({ "fab.change": c.change, "fab.head": c.head })),
      Effect.flatMap((c) => CodeHost.CodeHost.use((h) => h.merge(c.change, c.head))),
      outcome("merge"),
    ),
};
