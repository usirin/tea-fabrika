/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { Outcome } from "@demlik/tea";
import { Ci, CodeHost, type Handler } from "@kampus/libfabrika";
import { Cause, Effect, Schema } from "effect";
import { Inputs } from "./Merger.ts";

export class HandlerDefect extends Schema.TaggedError<HandlerDefect>()("HandlerDefect", {
  cmd: Schema.Literals(["change", "update", "checks", "merge"]),
}) {}

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
      Effect.catchCause((cause) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
