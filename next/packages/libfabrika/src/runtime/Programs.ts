/**
 * The built-in programs command: a program asks the runner which programs it can start, as a shell
 * reads its `PATH`. The runner performs it itself, from its own program loader, when the command
 * runs; a caller-supplied handler never runs it.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";

/**
 * Schema for the programs operands. It takes no field: the runner reads its own loader.
 *
 * @stability unstable
 * @category schemas
 */
export const ProgramsInput = Schema.Struct({});

/**
 * The programs command. Its answer is every program name the runner's loader can load, sorted in
 * JavaScript's default string order.
 *
 * @stability unstable
 * @category commands
 */
export const programs = Cmd.make("programs", { input: ProgramsInput, ok: Schema.Array(Schema.String), err: [] });
