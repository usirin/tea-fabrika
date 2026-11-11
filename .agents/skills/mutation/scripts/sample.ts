import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Schema } from "effect";
import fc from "fast-check";

type Position = { readonly line: number; readonly column: number };

type Candidate = {
  readonly id: string;
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: { readonly start: Position; readonly end: Position };
};

type Changed = { readonly file: string; readonly line: number };
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Sample = Schema.Struct({
  seed: Schema.Int,
  ranges: Schema.Array(Schema.String),
  total: Count,
  selected: Count,
  left: Count,
  /** Every changed file, in name order: its mutants on changed lines, and how many were selected. */
  files: Schema.Array(Schema.Struct({ file: Schema.String, total: Count, selected: Count })),
});

/**
 * The diff's product files: every extension Stryker 10.1.1's Instrumenter parses as JavaScript or
 * TypeScript (its parsers/create-parser.js), less tests and type-only declarations, which hold no
 * mutant. A changed `.cjs` or `.mjs` file is sampled like a `.ts` one (ticket 655).
 */
const PRODUCT = [
  "*.ts",
  "*.tsx",
  "*.mts",
  "*.cts",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  ":!*.test.*",
  ":!*.d.ts",
  ":!*.d.mts",
  ":!*.d.cts",
] as const;

const position = (a: Position, b: Position) => a.line - b.line || a.column - b.column;

const encloses = (a: Candidate, b: Candidate) =>
  a.fileName === b.fileName &&
  position(a.location.start, b.location.start) <= 0 &&
  position(a.location.end, b.location.end) >= 0;

const touches = (candidate: Candidate, changed: Changed) =>
  candidate.fileName === changed.file &&
  candidate.location.start.line <= changed.line &&
  candidate.location.end.line >= changed.line;

const identity = (candidate: Candidate) =>
  JSON.stringify([
    candidate.fileName,
    candidate.location.start,
    candidate.location.end,
    candidate.mutatorName,
    candidate.replacement,
    candidate.id,
  ]);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const range = (candidate: Candidate) => {
  const { start, end } = candidate.location;
  return `${candidate.fileName}:${start.line}:${start.column}-${end.line}:${end.column}`;
};

// Locations use Stryker's public range grammar: one-based lines and zero-based columns.
// A range selects every enclosed mutant, including different replacements at equal locations.
export const sample = ({
  candidates,
  changed,
  seed,
  max,
}: {
  candidates: readonly Candidate[];
  changed: readonly Changed[];
  seed: number;
  max: number;
}): typeof Sample.Type => {
  const cap = Math.max(0, Math.min(150, Math.floor(max)));
  const eligible = candidates.filter((candidate) => changed.some((line) => touches(candidate, line)));
  const sorted = [...eligible].sort((a, b) => compare(identity(a), identity(b)));
  const ordered = fc
    .sample(fc.shuffledSubarray(sorted, { minLength: sorted.length, maxLength: sorted.length }), {
      seed,
      numRuns: 1,
    })
    .flat();
  const selected = new Set<Candidate>();
  const ranges: string[] = [];
  const eligibleSet = new Set(eligible);
  const enclosing = new Map(eligible.map((c) => [c, candidates.filter((other) => encloses(c, other))]));
  // What taking a range would add, or `null` when it pulls in a mutant on an unchanged line, is
  // taken already, or would pass the cap.
  const adds = (candidate: Candidate) => {
    const enclosed = enclosing.get(candidate) ?? [];

    if (selected.has(candidate) || enclosed.some((other) => !eligibleSet.has(other))) {
      return null;
    }

    const added = enclosed.filter((other) => !selected.has(other));
    return selected.size + added.length > cap ? null : added;
  };
  const take = (candidate: Candidate, added: readonly Candidate[]) => {
    ranges.push(range(candidate));

    for (const other of added) {
      selected.add(other);
    }
  };
  // First picks go round-robin across changed files, one range per file per turn, so no file gets
  // a second range before every file that can take one has its first. A turn takes the file's
  // cheapest range over a changed line no earlier range covers, the earlier line and then the
  // seed breaking ties. Cheapest first: a range enclosing a whole block selects every mutant in
  // it, so a few such picks filled the cap from the first files and left later ones none
  // (ticket 655, lane t389).
  const files = [...new Set(changed.map((line) => line.file))].sort(compare);
  const open = new Map(files.map((file) => [file, new Set(changed.filter((c) => c.file === file).map((c) => c.line))]));
  const firstOpen = (candidate: Candidate) => {
    const lines = open.get(candidate.fileName) ?? new Set<number>();
    const { start, end } = candidate.location;
    return [...lines].filter((line) => line >= start.line && line <= end.line).sort((a, b) => a - b)[0];
  };
  const turn = (file: string) => {
    let best: { candidate: Candidate; added: readonly Candidate[]; line: number } | null = null;

    for (const candidate of ordered) {
      const line = candidate.fileName === file ? firstOpen(candidate) : undefined;
      const added = line === undefined ? null : adds(candidate);

      if (
        line !== undefined &&
        added !== null &&
        (best === null || added.length < best.added.length || (added.length === best.added.length && line < best.line))
      ) {
        best = { candidate, added, line };
      }
    }

    if (best === null) {
      return false;
    }

    take(best.candidate, best.added);
    const lines = open.get(file);

    for (const line of lines ?? []) {
      if (line >= best.candidate.location.start.line && line <= best.candidate.location.end.line) {
        lines?.delete(line);
      }
    }

    return true;
  };

  for (let moved = true; moved;) {
    moved = files.map(turn).some(Boolean);
  }

  for (const candidate of ordered) {
    const added = adds(candidate);

    if (added !== null) {
      take(candidate, added);
    }
  }

  return Schema.decodeUnknownSync(Sample)({
    seed,
    ranges,
    total: eligible.length,
    selected: selected.size,
    left: eligible.length - selected.size,
    files: files.map((file) => ({
      file,
      total: eligible.filter((c) => c.fileName === file).length,
      selected: [...selected].filter((c) => c.fileName === file).length,
    })),
  });
};

/**
 * Which diff the sample reads: `since..build` when a `since` is given, else the build commit
 * against its first parent. A lane whose tip is the lead's merge of main has main's lines in
 * `build^..build`, so drive's run samples from the lane's base, the pull request's own lines
 * (p14-mutation-r1, 2026-11-10; ticket 568).
 */
export const diffRange = (build: string, since: string | undefined): readonly [string, string] => [
  since ?? `${build}^`,
  build,
];

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      build: { type: "string" },
      since: { type: "string" },
      seed: { type: "string", default: "119120" },
      max: { type: "string", default: "150" },
      report: { type: "string" },
    },
  });

  if (!values.build || !values.report) {
    throw new Error("sample: --build and --report are required");
  }

  const seed = Schema.decodeUnknownSync(Schema.Int)(Number(values.seed));
  const max = Schema.decodeUnknownSync(Count)(Number(values.max));
  const diff = execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "-U0",
      ...diffRange(values.build, values.since),
      "--",
      ...PRODUCT,
    ],
    { encoding: "utf8" },
  );
  const changed: Changed[] = [];
  let file = "";

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
    }

    const hunk = /^@@ .* \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (hunk) {
      const start = Number(hunk[1]);

      for (let n = 0; n < Number(hunk[2] ?? 1); n++) {
        changed.push({ file, line: start + n });
      }
    }
  }

  // Resolve from the package that owns the installed Instrumenter; no root dependency is added.
  const require = createRequire(resolve("packages/pipeline/package.json"));
  const { Instrumenter } = await import(pathToFileURL(require.resolve("@stryker-mutator/instrumenter")).href);
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    trace() {},
    fatal() {},
    isDebugEnabled: () => false,
  };
  const files = [...new Set(changed.map((line) => line.file))].sort().map((name) => ({
    name,
    content: readFileSync(name, "utf8"),
    mutate: true,
  }));
  const result = await new Instrumenter(logger).instrument(files, {
    plugins: null,
    ignorers: [],
    excludedMutations: [],
  });
  // Instrumenter positions are zero-based; command-line ranges and git lines start at one.
  const candidates: Candidate[] = result.mutants.map((mutant: Candidate) => ({
    ...mutant,
    location: {
      start: { ...mutant.location.start, line: mutant.location.start.line + 1 },
      end: { ...mutant.location.end, line: mutant.location.end.line + 1 },
    },
  }));
  const report = sample({ candidates, changed, seed, max });
  writeFileSync(values.report, `${Schema.encodeSync(Schema.fromJsonString(Sample))(report)}\n`);
  console.log(report.ranges.map((item) => JSON.stringify(item)).join(","));

  if (report.left) {
    console.error(`sample: ${report.left} of ${report.total} mutants left outside the cap; see ${values.report}`);
  }
}
