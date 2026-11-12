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

/** Trusted runtime assembly supplies this capability; it is never decoded from a request.
 * @stability unstable
 * @category services
 */
export class RuntimeWrite extends Context.Service<RuntimeWrite, { readonly process: string }>()(
  "@kampus/libfabrika/ledger/RuntimeWrite",
) {}

/** Admission may save a charge using the transaction that called it.
 * @stability unstable
 * @category services
 */
export class WritePolicy extends Context.Service<
  WritePolicy,
  {
    readonly admit: (entry: Entry, runtime?: RuntimeWrite["Service"]) => Result.Result<void, "quota">;
  }
>()("@kampus/libfabrika/ledger/WritePolicy") {}
