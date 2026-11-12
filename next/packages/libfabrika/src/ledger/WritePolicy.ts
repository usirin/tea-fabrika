/** Synchronous admission in the ledger's own transaction.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Entry } from "./Log.ts";

/** A quota refusal aborting a multi-entry transaction.
 * @stability unstable
 * @category errors
 */
export class QuotaRefused extends Schema.TaggedError<QuotaRefused>()("QuotaRefused", {}) {}

/** Admission may save a charge using the transaction that called it.
 * @stability unstable
 * @category services
 */
export class WritePolicy extends Context.Service<
  WritePolicy,
  {
    readonly admit: (entry: Entry) => Result.Result<void, "quota">;
  }
>()("@kampus/libfabrika/ledger/WritePolicy") {}
