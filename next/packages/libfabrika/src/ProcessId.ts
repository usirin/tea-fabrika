// One of the shared names of 0043 (rooms on floors): a value every room may import, with no service
// and no error.
import { Schema } from "effect";
import * as Id from "./Id.ts";

/** A process's id: `process_` and a TypeID suffix. A restart is a new process (P33). */
// Keep the existing string type until the wider ID conversion in T518 PR 2.
export const ProcessId = Schema.String.check(
  Schema.makeFilter(Schema.is(Id.Process), { expected: "a process UUIDv7 TypeID" }),
);
