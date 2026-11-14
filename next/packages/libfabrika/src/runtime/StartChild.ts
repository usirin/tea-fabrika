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
 * The built-in start_child and exit commands: a program asks the host to start a program under a
 * name, as a process asks its supervisor, and ends its own life with `normal`. Their only operands
 * are these; the runner binds the requester, the hash and the life that exits.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Started } from "../processes/Children.ts";

/**
 * Schema for the start_child operands: the `program`, the `name` and an optional `input`. They are
 * plain strings, so their content is judged once, by the host: `no_program`, then `bad_name`.
 *
 * @stability unstable
 * @category schemas
 */
export const StartChildInput = Schema.Struct({
  program: Schema.String,
  name: Schema.String,
  input: Schema.optionalKey(Schema.Json),
});

/**
 * Schema for the reasons a start's request is refused for good, as `start_child` declares them.
 * Other clients decode these by name. A malformed start is answered `bad_cmd`, which is not one of
 * these.
 *
 * @stability unstable
 * @category schemas
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const StartRefusal = Schema.Literals([
  "no_program",
  "forbidden",
  "stale_sender",
  "bad_name",
  "bad_input",
  "id_reused",
  "name_taken",
]);

/** What a step's own check takes: any object, typed as the operands. The host decodes it strictly,
 *  so a malformed start is answered `bad_cmd` and never fails the step that asked for it. */
const Asked = Schema.declare<typeof StartChildInput.Type>(
  (value): value is typeof StartChildInput.Type => typeof value === "object" && value !== null,
);

/**
 * The start_child command. The runner performs it itself; a caller-supplied handler never runs it.
 *
 * @stability unstable
 * @category commands
 */
export const startChild = Cmd.make("start_child", { input: Asked, ok: Started, err: StartRefusal.literals });

/**
 * Schema for the exit operands. It takes no field: a program names no other process and no reason.
 *
 * @stability unstable
 * @category schemas
 */
export const ExitInput = Schema.Struct({});

/**
 * The exit command. It ends this life with `normal`; nothing restarts it.
 *
 * @stability unstable
 * @category commands
 */
export const exit = Cmd.make("exit", { input: ExitInput, ok: Schema.Null, err: [] });
