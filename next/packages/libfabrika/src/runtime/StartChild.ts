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
