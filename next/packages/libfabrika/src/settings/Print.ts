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
export const report = (rows: ReadonlyArray<Row>, options: { readonly all: boolean }) => {
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
