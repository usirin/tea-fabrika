// Mail wakeups, next/ (P41 slice 1): the contract only (0095). `wake(name)` schedules the name's
// runner to drain its inbox, and answers only once that schedule is saved. It never runs the
// recipient inside the caller's turn, and never starts a name its supervisor has not.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

export class MailWakeupsError extends Schema.TaggedError<MailWakeupsError>()("MailWakeupsError", {
  /** `unavailable`: the schedule was not saved. The same wake may be asked again. */
  reason: Schema.Literal("unavailable"),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class MailWakeups extends Context.Service<
  MailWakeups,
  { readonly wake: (name: string) => Effect.Effect<void, MailWakeupsError> }
>()("@kampus/libfabrika/MailWakeups") {}
