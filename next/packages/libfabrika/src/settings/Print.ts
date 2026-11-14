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
/**
 * The plain-text report `fabrika settings` prints from `Reference.rows`.
 *
 * **Details**
 *
 * Explicitly set keys show, and `all` adds the keys their defaults supply. Which rows show depends on each origin's `_tag`, never on a value, so a key set to its own default still shows, and `all` never changes what a row says.
 *
 * @stability unstable
 */
import type { Row, Warning } from "./Reference.ts";
import type { Origin } from "./Sources.ts";

const from = (origin: Origin) =>
  origin._tag === "file"
    ? `${origin.file}, line ${origin.line}`
    : origin._tag === "default"
      ? "the default"
      : origin.name;

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const indent = (text: string) => text.replace(/\n/g, "\n  ");

/**
 * Formats rows as the report text: one block per shown row, then a count of the hidden ones.
 *
 * **Details**
 *
 * Each block gives the path and value, where it came from (file and line, `the default`, or the flag or environment name), the default, and the setting's doc. Unless `all` is true, rows whose origin is the default are left out and counted in a closing line that points at `--all`. The text ends with one newline.
 *
 * @stability unstable
 * @category combinators
 */
export const report = (rows: ReadonlyArray<Row>, options: { readonly all: boolean }) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const shown = rows.filter((row) => options.all || row.origin._tag !== "default");
  const blocks = shown.map((row) =>
    [
      `${row.path} = ${JSON.stringify(row.value)}`,
      `  from ${from(row.origin)}`,
      `  default ${JSON.stringify(row.default)}`,
      `  ${indent(row.doc)}`,
    ].join("\n"),
  );
  const hidden = rows.length - shown.length;
  const rest = hidden === 0 ? [] : [`Keys left at their defaults: ${hidden}. fabrika settings --all shows them.`];
  return `${[...blocks, ...rest].join("\n\n")}\n`;
};

/**
 * Formats each warning as one line, to print apart from the report.
 *
 * **Details**
 *
 * Each line names the key, the release it came in and the repo's stated minimum, and says that a fabrika at that minimum, older than the key, may refuse it.
 *
 * @stability unstable
 * @category combinators
 */
export const warnings = (warnings: ReadonlyArray<Warning>) =>
  warnings.map(
    (w) =>
      `${w.path} came in fabrika ${w.since}, and this repo works with fabrika ${w.minimum} or newer, which may refuse it.`,
  );
