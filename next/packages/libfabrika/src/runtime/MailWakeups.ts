/**
 * Mail wakeups: how a sender tells a name's runner that mail is waiting. This file holds the
 * contract only (0095).
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/**
 * Error for a wake whose schedule was not saved. The same wake may be asked again.
 *
 * @stability unstable
 * @category errors
 */
export class MailWakeupsError extends Schema.TaggedError<MailWakeupsError>()("MailWakeupsError", {
  /** `unavailable`: the schedule was not saved. The same wake may be asked again. */
  reason: Schema.Literal("unavailable"),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that schedules a name's runner to read its inbox.
 *
 * **Details**
 *
 * `wake(name)` answers only once that schedule is saved, so a sender that got an answer knows the
 * letter will be read.
 *
 * **Gotchas**
 *
 * It never runs the recipient inside the caller's turn, and never starts a name its supervisor has
 * not started.
 *
 * @stability unstable
 * @category services
 */
export class MailWakeups extends Context.Service<
  MailWakeups,
  { readonly wake: (name: string) => Effect.Effect<void, MailWakeupsError> }
>()("@kampus/libfabrika/runtime/MailWakeups") {}
