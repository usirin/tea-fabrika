/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
