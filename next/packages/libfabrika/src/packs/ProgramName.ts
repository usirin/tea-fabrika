/**
 * A program's identity (0083): its pack and its name in that pack, as `pack/program`. Pure data, no
 * platform, so the Node builder, the built tables and a browser client read one schema.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/**
 * Schema for a program's name, `pack/program`: two segments that each start with a letter or an
 * underscore and go on with letters, digits, underscores or dashes. At most 256 characters in all,
 * the cap a process's `code.program` has.
 *
 * @stability unstable
 * @category schemas
 */
export const ProgramName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][\w-]*\/[A-Za-z_][\w-]*$/),
  Schema.isMaxLength(256),
);
/**
 * A program's name, `pack/program`.
 *
 * @stability unstable
 * @category models
 */
export type ProgramName = typeof ProgramName.Type;
