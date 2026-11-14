/**
 * The contract for per-program write and storage accounting: its errors, the limits it reads, the
 * `Accounting` port of one name's own store and the `Quotas` service. A program's use and the
 * brain's recovery use are separate accounts, so a program that is out of room can still be
 * recovered.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Error for a program account's refused charge: the resource that ran out, the use the charge
 * would have reached and the limit.
 *
 * @stability unstable
 * @category errors
 */
export class Exceeded extends Schema.TaggedError<Exceeded>()("Exceeded", {
  resource: Schema.Literals(["writes", "storage"]),
  used: Schema.Number,
  limit: Schema.Number,
  cause: Schema.Defect(),
}) {}

/**
 * Error for a recovery account with too little reserved room left for a recovery write: the
 * resource, the storage location, the account, the room the write needed and the room that was
 * left.
 *
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

/**
 * Error for a store failure while accounting rows were read or written, with that failure as its
 * cause.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Error for a committed entry whose owning program accounting could not resolve.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Error the accounting calls fail with. Its `reason` is one of `Exceeded`,
 * `RecoveryReserveExhausted`, `Storage` or `BadRow`.
 *
 * @stability unstable
 * @category errors
 */
export class QuotasError extends Schema.TaggedError<QuotasError>()("QuotasError", {
  reason: Schema.Union([Exceeded, RecoveryReserveExhausted, Storage, BadRow]),
}) {}

/**
 * The limits of one account: its `writes` and `bytes`, and under `letter` the writes and bytes
 * one replayed letter may take without counting against them.
 *
 * **Details**
 *
 * A recovery account counts both in a rolling minute. A program account counts `writes` in a
 * rolling minute and `bytes` as the total it keeps.
 *
 * @stability unstable
 * @category models
 */
export interface Allowance {
  readonly writes: number;
  readonly bytes: number;
  readonly letter: { readonly writes: number; readonly bytes: number };
}

/**
 * The limits read from the checked settings: a program's writes per rolling minute, its storage
 * in bytes, and the recovery allowance of each storage location.
 *
 * @stability unstable
 * @category models
 */
export interface Limits {
  readonly writes: number;
  readonly storage: number;
  readonly recovery: { readonly project: Allowance; readonly process: Allowance };
}

/**
 * An account's use as read: the writes and bytes counted against its limits now, the charge held
 * `ahead` for accepted letters whose step is not committed yet, and the running `total` it has
 * committed.
 *
 * @stability unstable
 * @category models
 */
export interface Use {
  readonly writes: number;
  readonly bytes: number;
  readonly ahead: { readonly writes: number; readonly bytes: number };
  readonly total: { readonly writes: number; readonly bytes: number };
}

/**
 * The accounting port of one registered name's own store.
 *
 * **Details**
 *
 * A store calls `change` with a write's exact row count and byte difference inside the
 * transaction that makes it, and runs that transaction through `protect`. When a recovery charge
 * does not fit, `protect` saves the reserve fault after the rollback and fails with it. `check`
 * fails while a fault is saved, `recordFault` saves one met elsewhere, and `resume` clears it
 * once the pending charge fits.
 *
 * @stability unstable
 * @category models
 */
export interface Accounting {
  readonly check: Effect.Effect<void, QuotasError>;
  readonly recordFault: (fault: RecoveryReserveExhausted) => Effect.Effect<void, QuotasError>;
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

/**
 * Service that reads a program's account and a name's recovery account, and marks the writes
 * made inside a step as a program's own, as recovery or as infrastructure, so admission charges
 * the right account.
 *
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
