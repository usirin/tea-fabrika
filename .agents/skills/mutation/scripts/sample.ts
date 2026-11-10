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
});

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
  const take = (candidate: Candidate) => {
    if (selected.has(candidate)) {
      return false;
    }

    const enclosed = candidates.filter((other) => encloses(candidate, other));

    if (enclosed.some((other) => !eligibleSet.has(other))) {
      return false;
    }

    const added = enclosed.filter((other) => !selected.has(other));

    if (selected.size + added.length > cap) {
      return false;
    }

    ranges.push(range(candidate));

    for (const other of added) {
      selected.add(other);
    }

    return true;
  };
  // First picks go round-robin across changed files, in line order within each file, so a cap
  // smaller than the changed lines still reaches every file.
  const unique = [...new Map(changed.map((line) => [JSON.stringify(line), line])).values()];
  const queues = [...new Set(unique.map((line) => line.file))]
    .sort(compare)
    .map((file) => unique.filter((line) => line.file === file).sort((a, b) => a.line - b.line));
  const lines = Array.from({ length: Math.max(0, ...queues.map((q) => q.length)) }, (_, turn) =>
    queues.flatMap((queue) => (turn < queue.length ? [queue[turn]] : [])),
  ).flat();

  for (const line of lines) {
    if (![...selected].some((candidate) => touches(candidate, line))) {
      ordered.find((candidate) => touches(candidate, line) && take(candidate));
    }
  }

  for (const candidate of ordered) {
    take(candidate);
  }

  return Schema.decodeUnknownSync(Sample)({
    seed,
    ranges,
    total: eligible.length,
    selected: selected.size,
    left: eligible.length - selected.size,
  });
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      build: { type: "string" },
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
      `${values.build}^`,
      values.build,
      "--",
      "*.ts",
      "*.tsx",
      ":!*.test.ts",
      ":!*.test.tsx",
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
