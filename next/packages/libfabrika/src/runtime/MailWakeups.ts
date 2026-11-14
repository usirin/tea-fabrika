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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
