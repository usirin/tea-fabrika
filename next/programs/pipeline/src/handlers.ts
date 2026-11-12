import { Outcome } from "@demlik/tea";
import type { Handler } from "@kampus/libfabrika";
import { Ci, type CiError } from "@kampus/libfabrika/ci/Ci";
import { CodeHost, type CodeHostError } from "@kampus/libfabrika/codehost/CodeHost";
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
  <A, R>(effect: Effect.Effect<A, CodeHostError | CiError | Schema.SchemaError, R>) =>
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

export const handlers: Readonly<Record<string, Handler<CodeHost | Ci>>> = {
  change: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.change)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan("fab.change", c.change)),
      Effect.flatMap((c) => CodeHost.use((h) => h.change(c.change))),
      outcome("change"),
    ),
  update: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.update)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan({ "fab.change": c.change, "fab.head": c.head })),
      Effect.flatMap((c) => CodeHost.use((h) => h.update(c.change, c.head))),
      outcome("update"),
    ),
  checks: (cmd) =>
    Schema.decodeUnknownEffect(Inputs.checks)(cmd).pipe(
      Effect.tap((c) => Effect.annotateCurrentSpan("fab.head", c.head)),
      Effect.flatMap((c) =>
        Ci.use((ci) => (c.start ? ci.start(c.head) : Effect.void).pipe(Effect.andThen(ci.at(c.head)))),
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
      Effect.flatMap((c) => CodeHost.use((h) => h.merge(c.change, c.head))),
      outcome("merge"),
    ),
};
