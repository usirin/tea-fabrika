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
 * The built-in Send command: a program asks the host to mail JSON to a registered name. Its only
 * operands are the name and the message; the runner binds who sends it. `queued` means the letter
 * is saved and its recipient scheduled, never that it was answered.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { MailRefusal } from "../processes/ProgramMail.ts";

/**
 * Schema for the Send command's operands: `to`, the registered name to mail, and `m`, the JSON
 * message. A program gives nothing else; the runner binds who sends it.
 *
 * @stability unstable
 * @category schemas
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const SendInput = Schema.Struct({ to: Schema.NonEmptyString, m: Schema.Json });

/**
 * Schema for the delivery receipt: the saved letter's ID.
 *
 * @stability unstable
 * @category schemas
 */
export const Queued = Schema.TaggedStruct("queued", { id: Schema.NonEmptyString });

/**
 * The Send command. The runner performs it itself; a caller-supplied handler never runs it.
 *
 * @stability unstable
 * @category commands
 */
export const send = Cmd.make("send", { input: SendInput, ok: Queued, err: MailRefusal.literals });
