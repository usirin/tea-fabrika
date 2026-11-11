import { Schema } from "effect";

/** A captured failure's class, such as `TypeError`: the same 256-character bound as other brain text. */
const ErrorClass = Schema.NonEmptyString.check(Schema.isMaxLength(256));

/**
 * Why a process ended, as OTP keeps it: `normal`, `shutdown`, `kill`, or `crashed` with the phase that
 * failed and the captured error class. Never an exception's message or stack.
 */
export const ExitReason = Schema.TaggedUnion({
  normal: {},
  shutdown: {},
  kill: {},
  crashed: {
    phase: Schema.Literals(["step", "saved_letter", "interrupted"]),
    error: Schema.optionalKey(ErrorClass),
  },
});
export type ExitReason = typeof ExitReason.Type;

/** Two reasons are the same exit when their fields are, wherever each copy came from. */
export const sameReason = Schema.toEquivalence(ExitReason);

/** Untrusted input to one exit reason; a string, an unknown tag or an extra field is refused. */
export const decodeExitReason = Schema.decodeUnknownResult(ExitReason, { onExcessProperty: "error" });
