/** Program accounting and the brain's separate recovery allowance.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LedgerError } from "../ledger/Ledger.ts";

/** A program's exhausted allowance.
 * @stability unstable
 * @category errors
 */
export class Exceeded extends Schema.TaggedError<Exceeded>()("Exceeded", {
  resource: Schema.Literals(["writes", "storage"]),
  used: Schema.Number,
  limit: Schema.Number,
  cause: Schema.Defect(),
}) {}

/** A named recovery stop, outside the program's own allowance.
 * @stability unstable
 * @category errors
 */
export class RecoveryReserveExhausted extends Schema.TaggedError<RecoveryReserveExhausted>()(
  "RecoveryReserveExhausted",
  {
    resource: Schema.Literals(["writes", "storage"]),
    location: Schema.Literals(["project", "process"]),
    process: Schema.String,
    required: Schema.Number,
    remaining: Schema.Number,
    cause: Schema.Defect(),
  },
) {}

/** An accounting write failed.
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/** Accounting could not resolve committed data.
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/** The accounting service's closed error.
 * @stability unstable
 * @category errors
 */
export class QuotasError extends Schema.TaggedError<QuotasError>()("QuotasError", {
  reason: Schema.Union([Exceeded, RecoveryReserveExhausted, Storage, BadRow]),
}) {}

/** A recovery window and the room each accepted replay letter brings.
 * @stability unstable
 * @category models
 */
export interface Allowance {
  readonly writes: number;
  readonly bytes: number;
  readonly letter: { readonly writes: number; readonly bytes: number };
}

/** Values selected from the checked settings, in bytes.
 * @stability unstable
 * @category models
 */
export interface Limits {
  readonly writes: number;
  readonly storage: number;
  readonly recovery: { readonly project: Allowance; readonly process: Allowance };
}

/** Current usage and the charge for steps still to commit.
 * @stability unstable
 * @category models
 */
export interface Use {
  readonly writes: number;
  readonly bytes: number;
  readonly ahead: { readonly writes: number; readonly bytes: number };
  readonly total: { readonly writes: number; readonly bytes: number };
}

/** A synchronous, name-local store port. The store supplies exact row differences.
 * @stability unstable
 * @category models
 */
export interface Accounting {
  readonly check: Effect.Effect<void, LedgerError>;
  readonly change: (operation: string, writes: number, bytes: number, at: number, recovery?: boolean) => void;
  readonly protect: <A>(step: () => A) => A;
  readonly status: Effect.Effect<
    {
      readonly program: { readonly writes: number; readonly bytes: number };
      readonly recovery: Use;
      readonly fault: RecoveryReserveExhausted | null;
    },
    QuotasError
  >;
  readonly resume: Effect.Effect<void, QuotasError>;
}

/** The checked reads of saved accounts.
 * @stability unstable
 * @category services
 */
export class Quotas extends Context.Service<
  Quotas,
  {
    readonly program: (identity: string) => Effect.Effect<Use, QuotasError>;
    readonly recovery: (name: string) => Effect.Effect<Use, QuotasError>;
    readonly ordinary: <A>(process: string, step: () => A) => A;
    readonly recovering: <A>(process: string, step: () => A) => A;
    readonly infrastructure: <A>(step: () => A) => A;
    readonly runtime: <A, E, R>(process: string, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("@kampus/libfabrika/processes/Quotas") {}
