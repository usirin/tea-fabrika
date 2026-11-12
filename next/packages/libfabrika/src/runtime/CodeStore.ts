import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";
import type { BuiltProgram } from "./Built.ts";

export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

export class CodeStoreError extends Schema.TaggedError<CodeStoreError>()("CodeStoreError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

export class CodeStore extends Context.Service<
  CodeStore,
  {
    /** Keeps checked bytes by hash. A second put leaves the first row alone. */
    readonly put: (code: BuiltProgram) => Effect.Effect<void, CodeStoreError>;
    /** Decodes the stored bytes and checks their hash before returning them. */
    readonly get: (hash: string) => Effect.Effect<Option.Option<BuiltProgram>, CodeStoreError>;
  }
>()("@kampus/libfabrika/runtime/CodeStore") {}
