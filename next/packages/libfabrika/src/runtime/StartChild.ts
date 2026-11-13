// The built-in start_child and exit commands, next/ (P42 slice 1): a program asks the host to start
// a program under a name, as a process asks its supervisor, and ends its own life with `normal`.
// Their only operands are these; the runner binds the requester, the hash and the life that exits.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Started } from "../processes/Children.ts";

/** Plain strings, so their content is judged once, by the host: `no_program`, then `bad_name`. */
export const StartChildInput = Schema.Struct({
  program: Schema.String,
  name: Schema.String,
  input: Schema.optionalKey(Schema.Json),
});

/** Why a start is refused for good. Other clients decode these by name. */
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

/** The runner performs it itself; a caller-supplied handler never runs it. */
export const startChild = Cmd.make("start_child", { input: Asked, ok: Started, err: StartRefusal.literals });

/** It takes no field: a program names no other process and no reason. */
export const ExitInput = Schema.Struct({});

/** Ends this life with `normal`; nothing restarts it. */
export const exit = Cmd.make("exit", { input: ExitInput, ok: Schema.Null, err: [] });
