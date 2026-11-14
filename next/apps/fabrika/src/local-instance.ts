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
import { Cause, Effect, Path, Predicate, Schema } from "effect";
import type { Options } from "./settings.ts";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literal("storage"),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
class PortError extends Schema.TaggedError<PortError>()("PortError", { message: Schema.String }) {}

// The runtime refuses a taken port as a ConfigError with subtag AddressInUse, and Node as EADDRINUSE;
// either may arrive as the cause of another error.
const addressInUse = (error: unknown): boolean =>
  (Predicate.isTagged(error, "ConfigError") &&
    Predicate.hasProperty(error, "subtag") &&
    error.subtag === "AddressInUse") ||
  (Predicate.hasProperty(error, "code") && error.code === "EADDRINUSE") ||
  (Predicate.hasProperty(error, "cause") && error.cause !== error && addressInUse(error.cause));

const portTaken = (cause: Cause.Cause<unknown>) =>
  cause.reasons.some(
    (reason) =>
      (Cause.isFailReason(reason) && addressInUse(reason.error)) ||
      (Cause.isDieReason(reason) && addressInUse(reason.defect)),
  ) ||
  // Edge: a refusal that reached us only as text, its structure gone, is known by the runtime's words.
  /AddressInUse|EADDRINUSE|already in use/.test(Cause.pretty(cause));

export const localInstance = Effect.fn("brain.localInstance")(function* (
  built: Omit<import("./build.ts").Built, "assets">,
  options: Options,
) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const path = yield* Path.Path;
  process.env.DO_NOT_TRACK = "1";
  process.env.ALCHEMY_HOME = path.join(options.home, "alchemy-home");
  // oxlint-disable-next-line fabrika/no-promises -- edge: load Alchemy only after disabling its telemetry
  const { startDev } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: defer Alchemy loading until telemetry is disabled
    try: () => import("./instance.ts"),
    catch: (cause: unknown) => new BrainError({ reason: "storage", cause }),
  });
  // oxlint-disable-next-line fabrika/no-promises -- edge: the platform module is loaded at the local command boundary
  const { ProcessIdGenerator } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: load the platform dependency at the command boundary
    try: () => import("@kampus/libfabrika/processes/ProcessIdGenerator"),
    catch: (cause: unknown) => new BrainError({ reason: "storage", cause }),
  });
  // Alchemy listens with a strict port, so a taken one fails here and no other port is tried.
  const started = startDev(built, options).pipe(Effect.provide(ProcessIdGenerator.layer));
  return yield* started.pipe(
    Effect.catchCause((cause): Effect.Effect<never, PortError | Effect.Error<typeof started>> =>
      portTaken(cause)
        ? Effect.fail(
            new PortError({
              message: `Port ${options.settings.values["instance.port"]} is taken, so the instance did not start. Stop what uses it, or set instance.port to another port.`,
            }),
          )
        : Effect.failCause(cause),
    ),
  );
});
