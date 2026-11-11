// The plain-text report `fabrika settings` prints from `Reference.rows`. Explicitly set keys show;
// `all` adds the keys their defaults supply. Which rows show reads each origin's `_tag`, never a
// value, so a key set to its own default still shows, and `all` never changes what a row says.
import type { Row, Warning } from "./Reference.ts";
import type { Origin } from "./Sources.ts";

const from = (origin: Origin) =>
  origin._tag === "file"
    ? `${origin.file}, line ${origin.line}`
    : origin._tag === "default"
      ? "the default"
      : origin.name;

const indent = (text: string) => text.replace(/\n/g, "\n  ");

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

/** One line per warning, printed apart from the report. */
export const warnings = (warnings: ReadonlyArray<Warning>) =>
  warnings.map(
    (w) =>
      `${w.path} came in fabrika ${w.since}, and this repo works with fabrika ${w.minimum} or newer, which may refuse it.`,
  );
