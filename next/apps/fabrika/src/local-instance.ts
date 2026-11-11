import { Effect, Path, Schema } from "effect";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literal("storage"),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

export const localInstance = Effect.fn("brain.localInstance")(function* (
  built: Omit<import("./build.ts").Built, "assets">,
  options: Omit<import("./settings.ts").Settings, "build"> & { readonly home: string },
) {
  const path = yield* Path.Path;
  process.env.DO_NOT_TRACK = "1";
  process.env.ALCHEMY_HOME = path.join(options.home, "alchemy-home");
  // oxlint-disable-next-line fabrika/no-promises -- edge: load Alchemy only after disabling its telemetry
  const { startDev } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: defer Alchemy loading until telemetry is disabled
    try: () => import("./instance.ts"),
    catch: (cause) => new BrainError({ reason: "storage", cause }),
  });
  // oxlint-disable-next-line fabrika/no-promises -- edge: the platform module is loaded at the local command boundary
  const { ProcessIdGenerator } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: load the platform dependency at the command boundary
    try: () => import("@kampus/libfabrika/processes/ProcessIdGenerator"),
    catch: (cause) => new BrainError({ reason: "storage", cause }),
  });
  return yield* startDev(built, options).pipe(Effect.provide(ProcessIdGenerator.layer));
});
