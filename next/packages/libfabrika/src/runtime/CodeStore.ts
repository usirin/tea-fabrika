/**
 * Stored program code, keyed by its hash. This file holds the contract only (0095);
 * `CodeStoreSql.layer` keeps the rows.
 *
 * @stability unstable
 */
import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";
import type { BuiltProgram } from "./Built.ts";

/**
 * Error for a code read or write that failed in the store.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Error for a stored code row that does not decode, or whose source does not hash to its hash.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Error for stored code that could not be read or written.
 *
 * @stability unstable
 * @category errors
 */
export class CodeStoreError extends Schema.TaggedError<CodeStoreError>()("CodeStoreError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/**
 * Service for program code stored by hash.
 *
 * **Details**
 *
 * `put` keeps a program's source under its hash, and a second put of the same hash leaves the first
 * row alone. `get` returns the stored program with its hash checked, or none.
 *
 * @stability unstable
 * @category services
 */
export class CodeStore extends Context.Service<
  CodeStore,
  {
    /** Keeps checked bytes by hash. A second put leaves the first row alone. */
    readonly put: (code: BuiltProgram) => Effect.Effect<void, CodeStoreError>;
    /** Decodes the stored bytes and checks their hash before returning them. */
    readonly get: (hash: string) => Effect.Effect<Option.Option<BuiltProgram>, CodeStoreError>;
  }
>()("@kampus/libfabrika/runtime/CodeStore") {}
