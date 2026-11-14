/**
 * The built-in start_child, stop_child and exit commands: a program asks the host to start a program
 * under a name, as a process asks its supervisor, to stop a child it started, as OTP's
 * `terminate_child`, and ends its own life with `normal`. Their only operands are these; the runner
 * binds the requester, the hash and the life that exits.
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

/**
 * Schema for the stop_child operands: the `name` of a child this process started. It is a plain
 * string, so the host judges it once: a name that is not this process's child is `not_child`.
 *
 * @stability unstable
 * @category schemas
 */
export const StopChildInput = Schema.Struct({ name: Schema.String });

/** Why a stop is refused, by name: the name is not the requester's child, or that child has ended. */
const StopRefusal = Schema.Literals(["not_child", "noproc"]);

/** What a step's own check takes for a stop: any object, as for a start; the host decodes it strictly. */
const AskedStop = Schema.declare<typeof StopChildInput.Type>(
  (value): value is typeof StopChildInput.Type => typeof value === "object" && value !== null,
);

/**
 * The stop_child command, OTP's `terminate_child`: the requester's own child ends with `shutdown`,
 * and each of its watchers gets one `DOWN`. A name the requester did not start is `not_child`, and a
 * child that already ended is `noproc`. The runner performs it itself.
 *
 * @stability unstable
 * @category commands
 */
export const stopChild = Cmd.make("stop_child", { input: AskedStop, ok: Schema.Null, err: StopRefusal.literals });
