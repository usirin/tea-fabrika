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
// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
import { Schema } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import * as Id from "./Id.ts";

/** A process's id: `process_` and a TypeID suffix. A restart is a new process (P33). */
// Keep the existing string type until the wider ID conversion in T518 PR 2.
export const ProcessId = Schema.String.check(
  Schema.makeFilter(Schema.is(Id.Process), { expected: "a process UUIDv7 TypeID" }),
);
