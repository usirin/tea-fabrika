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
// P19 next/. Which process groups a host test may signal. Pure: nothing here reads or signals a process.
// On 2026-11-13 a host run signaled group 1, and `kill -TERM -1` ended every process its user owned.
import { Schema } from "effect";

/** One row of `ps -axo pid=,ppid=,pgid=`. */
export const Row = Schema.Struct({ pid: Schema.Int, parent: Schema.Int, group: Schema.Int });

/**
 * A process group a test may signal: above 1, always.
 *
 * `kill` reads a target of -1 as every process its caller's user owns, and of 0 as the caller's
 * own group. A negative group would turn the target positive, a single process nobody chose.
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Owned = Schema.Int.check(Schema.isGreaterThan(1));

/** The groups a guard saved for its test. A file that holds 0 or 1 does not decode. */
export const Saved = Schema.Array(Owned);

/**
 * The groups led by `root` or by one of its descendants.
 *
 * A group is named by its leader's pid, so a group counts only when that leader is in the tree.
 * A group led from outside it is left out, launchd's group 1 included: a job caught while it
 * spawns can still sit in it. A root of 1 or below has the whole machine beneath it, so it owns
 * nothing.
 */
export const descendants = (rows: ReadonlyArray<typeof Row.Type>, root: number): ReadonlyArray<number> => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  if (root <= 1) {
    return [];
  }

  const tree = new Set([root]);

  for (let n = 0; n < rows.length; n++) {
    for (const row of rows) {
      if (tree.has(row.parent)) {
        tree.add(row.pid);
      }
    }
  }

  const led = rows.filter((row) => tree.has(row.pid) && tree.has(row.group) && row.group > 1);
  return [...new Set(led.map((row) => row.group))];
};
