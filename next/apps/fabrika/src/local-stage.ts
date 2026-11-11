import { Effect, Path, Schema } from "effect";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literal("storage"),
}) {}

export const localStage = Effect.fn("brain.localStage")(function* (
  built: Omit<import("./build.ts").Built, "assets">,
  options: Omit<import("./settings.ts").Settings, "build"> & { readonly home: string },
) {
  const path = yield* Path.Path;
  process.env.DO_NOT_TRACK = "1";
  process.env.ALCHEMY_HOME = path.join(options.home, "alchemy-home");
  // oxlint-disable-next-line fabrika/no-promises -- edge: load Alchemy only after disabling its telemetry
  const { startDev } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: defer Alchemy loading until telemetry is disabled
    try: () => import("./stage.ts"),
    catch: () => new BrainError({ reason: "storage" }),
  });
  // oxlint-disable-next-line fabrika/no-promises -- edge: the platform module is loaded at the local command boundary
  const { ProcessIdGenerator } = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: load the platform dependency at the command boundary
    try: () => import("@kampus/libfabrika/processes/ProcessIdGenerator"),
    catch: () => new BrainError({ reason: "storage" }),
  });
  return yield* startDev(built, options).pipe(Effect.provide(ProcessIdGenerator.layer));
});
