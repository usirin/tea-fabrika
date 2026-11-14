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
export const descendants = (rows: ReadonlyArray<typeof Row.Type>, root: number): ReadonlyArray<number> => {
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
