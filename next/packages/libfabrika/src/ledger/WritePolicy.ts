/**
 * The ledger's admission contract: a policy the ledger asks about each new entry inside its own
 * transaction, so an entry and its charge commit together. The ledger knows no quota; a higher
 * module supplies the policy.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Entry } from "./Log.ts";

/**
 * Error kept as the cause of the `LedgerError` that ends a multi-entry transaction when
 * admission refuses one of its entries for quota.
 *
 * @stability unstable
 * @category errors
 */
export class QuotaRefused extends Schema.TaggedError<QuotaRefused>()("QuotaRefused", {}) {}

/**
 * Service that names the process whose runtime is writing. The trusted runtime assembly provides
 * it around a write, and it is never decoded from a request.
 *
 * @stability unstable
 * @category services
 */
export class RuntimeWrite extends Context.Service<RuntimeWrite, { readonly process: string }>()(
  "@kampus/libfabrika/ledger/RuntimeWrite",
) {}

/**
 * Service that admits or refuses one new entry before the ledger inserts it. `admit` runs
 * synchronously in the caller's transaction, so it may save the entry's charge there.
 *
 * @stability unstable
 * @category services
 */
export class WritePolicy extends Context.Service<
  WritePolicy,
  {
    readonly admit: (entry: Entry, runtime?: RuntimeWrite["Service"]) => Result.Result<void, "quota">;
  }
>()("@kampus/libfabrika/ledger/WritePolicy") {}
