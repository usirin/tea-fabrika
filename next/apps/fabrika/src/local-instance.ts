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
import { Cause, Effect, Path, Predicate, Schema } from "effect";
import type { Options } from "./settings.ts";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literal("storage"),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

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
) {
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
