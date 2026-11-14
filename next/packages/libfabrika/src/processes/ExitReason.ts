/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Why a process ended, as data: the exit reason, when two reasons are the same exit, and the
 * decoder for a reason that comes from outside.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/** A captured failure's class, such as `TypeError`: the same 256-character bound as other brain text. */
const ErrorClass = Schema.NonEmptyString.check(Schema.isMaxLength(256));

/**
 * Why a process ended, as OTP keeps it: `normal`, `shutdown`, `kill`, or `crashed` with the phase that
 * failed and the captured error class. Never an exception's message or stack.
 *
 * @stability unstable
 * @category schemas
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
/**
 * Why a process ended, as `ExitReason` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type ExitReason = typeof ExitReason.Type;

/**
 * Equivalence under which two exit reasons are the same exit when their fields are, wherever each
 * copy came from.
 *
 * @stability unstable
 * @category guards
 */
export const sameReason = Schema.toEquivalence(ExitReason);

/**
 * Decodes untrusted input to one exit reason, as a `Result`. A string, an unknown tag or an extra
 * field is refused.
 *
 * @stability unstable
 * @category decoding
 */
export const decodeExitReason = Schema.decodeUnknownResult(ExitReason, { onExcessProperty: "error" });
