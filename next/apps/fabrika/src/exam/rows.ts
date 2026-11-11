// The exam's row reader: which rows of the rule file (`layer-rules.json`) claim a file. `pnpm
// lint:layers` (code-graph) reads the same file, so the exam and the tool keep one list of paths.
// The exam maps a row to a part (`layers.test.ts`), and the lead's move checker asks whether a moved
// file kept its row.
//
// The rule is `@demlik/code-graph@0.15.0`'s, read from its built source (`src/layers/classify.ts`
// in `dist/index.js`), since the package exports no function for it:
//   - a pattern is a path from the top of the repo, cut at `/`; it claims the file or folder it
//     names and everything below it;
//   - `*` alone is one whole segment, `*` inside a segment is any run of characters in it, and `**`
//     is any number of segments;
//   - when more than one pattern claims a file, the most specific wins: more segments that are not
//     `**`, then more segments with no `*`, then more characters that are not `*` or `/`;
//   - the tool refuses a file that two rows claim equally. Here that file gets both rows, so the
//     exam can say so.
//
// A row may carry a `layer` (the local patch, demlik issue 913). A module's rank is its layer, so
// moving a module is one edit and no other module moves. The exam's layers test reads it.

/** One row of the rule file, as far as the exam reads it. */
export interface Row {
  readonly name: string;
  readonly paths: ReadonlyArray<string>;
  readonly layer?: number;
}

type Specificity = readonly [segments: number, literal: number, characters: number];

interface Claim {
  readonly name: string;
  readonly specificity: Specificity;
}

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

const segmentSource = (segment: string): string =>
  segment === "*"
    ? "[^/]+"
    : segment
        .split("*")
        .map((literal) => literal.replace(SPECIAL, "\\$&"))
        .join("[^/]*");

/** The pattern as a test on a path: it claims its own path and everything below it. */
const claims = (pattern: string): RegExp => {
  const kept = pattern.split("/");

  while (kept.at(-1) === "**") {
    kept.pop();
  }

  if (kept.length === 0) {
    return /^/;
  }

  const body = kept
    .map((segment) => (segment === "**" ? "(?:[^/]+/)*" : `${segmentSource(segment)}/`))
    .join("")
    .slice(0, -1);

  return new RegExp(`^${body}(?:/|$)`);
};

const specificityAt = (pattern: string): Specificity => {
  const segments = pattern.split("/");

  return [
    segments.filter((segment) => segment !== "**").length,
    segments.filter((segment) => !segment.includes("*")).length,
    [...pattern].filter((character) => character !== "*" && character !== "/").length,
  ];
};

const compare = (a: Specificity, b: Specificity): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The rows that claim `path` (from the top of the repo, with `/`) with the most specific pattern:
 * none when no row names it, one when the rule file is clear, more when rows claim it equally.
 */
export const rowsAt = (rows: ReadonlyArray<Row>, path: string): ReadonlyArray<string> => {
  const found: ReadonlyArray<Claim> = rows.flatMap((row) =>
    row.paths
      .filter((pattern) => claims(pattern).test(path))
      .map((pattern) => ({ name: row.name, specificity: specificityAt(pattern) })),
  );
  const best = found.reduce<Specificity | null>(
    (top, claim) => (top === null || compare(claim.specificity, top) > 0 ? claim.specificity : top),
    null,
  );

  if (best === null) {
    return [];
  }

  return [...new Set(found.filter((claim) => compare(claim.specificity, best) === 0).map((claim) => claim.name))];
};
