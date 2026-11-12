import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type * as Start from "./Start.ts";

export const MissingTarget = Schema.TaggedUnion({ instance: { start: Schema.NonEmptyString } });

export class Decode extends Schema.TaggedError<Decode>()("Decode", { cause: Schema.Defect() }) {}
export class Missing extends Schema.TaggedError<Missing>()("Missing", { target: MissingTarget }) {}
export class Refused extends Schema.TaggedError<Refused>()("Refused", { cause: Schema.Defect() }) {}
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

export class StartsError extends Schema.TaggedError<StartsError>()("StartsError", {
  reason: Schema.Union([Decode, Missing, Refused, Storage, Unreachable]),
}) {}

export class Starts extends Context.Service<
  Starts,
  {
    readonly record: (input: Start.Input) => Effect.Effect<Start.Receipt, StartsError>;
    readonly read: (start: string) => Effect.Effect<Start.Receipt, StartsError>;
  }
>()("@kampus/libfabrika/settings/Starts") {}
