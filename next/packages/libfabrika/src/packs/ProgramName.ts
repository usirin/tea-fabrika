// A program's identity (P40, 0083): its pack and its name in that pack, as `pack/program`. Pure
// data, no platform, so the Node builder, the built tables and a browser client read one schema.
import { Schema } from "effect";

/** `pack/program`: two segments in the builder's alphabet, at most 256 characters, as a process's code. */
export const ProgramName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][\w-]*\/[A-Za-z_][\w-]*$/),
  Schema.isMaxLength(256),
);
export type ProgramName = typeof ProgramName.Type;
