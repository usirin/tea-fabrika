// plants.ts: the plant records a review's brief carries (ticket 850). A tests step's answer names
// each plant it ran (0093), and drive keeps them on the step's entry in state/<lane>.json. The
// report beside the lane (`../boxes/<box>.md`) holds the table of what each failure looked like,
// and a box cannot read it, so a review once asked the tests step for records that already
// existed, and the lane looped (acpcancel and sjob1, 2026-11-11). The chain writes this section
// into a review's brief instead.

import { Schema } from "effect";

/**
 * One plant as the state file keeps it, read loosely as the host step reads its entries: the
 * answer's own schema lives with the step agents, whose module reaches every lead script, so a
 * test of this file would have to declare them all.
 */
const SavedPlant = Schema.Struct({ law: Schema.String, plant: Schema.String, result: Schema.String });
type SavedPlant = typeof SavedPlant.Type;

/** A tests entry in the lane's state file that named plants; other entries are not read. */
const TestsEntry = Schema.Struct({
  step: Schema.Literal("tests"),
  head: Schema.String,
  report: Schema.optional(Schema.NullOr(Schema.String)),
  plants: Schema.NonEmptyArray(SavedPlant),
});

/** A build that moved the lane: a record from before it ran at an older head. */
const BuildEntry = Schema.Struct({
  step: Schema.Literal("build"),
  outcome: Schema.Literal("done"),
  head: Schema.String,
});

/** One law's newest record: the plants of the newest tests answer that named it, and where it ran. */
export type LawRecord = {
  readonly law: string;
  readonly head: string;
  readonly plants: ReadonlyArray<SavedPlant>;
  /** The last cell of each row the report's plant table has for this law; empty with no report. */
  readonly failures: ReadonlyArray<string>;
  /** The record's tests step ran before the lane's last build, and that build moved the head. */
  readonly older: boolean;
};

const MAX_CELL = 300;

const rowCells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

const bare = (cell: string) => cell.replace(/^[`*]+|[`*]+$/g, "").trim();

/**
 * What the report's plant tables say each failure of `law` looked like: the last cell of each row
 * whose first cell is the law, in a table whose header starts with `Law` and names a plant column.
 */
export const failuresIn = (report: string, law: string): string[] => {
  const found: string[] = [];
  let header: string[] | null = null;

  for (const line of report.split("\n")) {
    if (!line.trim().startsWith("|")) {
      header = null;
      continue;
    }

    const cells = rowCells(line);

    if (header === null) {
      header = cells.map((c) => bare(c).toLowerCase());
      continue;
    }

    const plantTable = header[0] === "law" && header.some((h) => h.includes("plant"));

    if (plantTable && cells.length > 1 && bare(cells[0] ?? "") === law) {
      found.push((cells.at(-1) ?? "").slice(0, MAX_CELL));
    }
  }

  return found;
};

/**
 * Each law's newest record among the lane's state file's steps, oldest law first. `read` gives a
 * report's text, `null` when the file is gone.
 */
export const records = (steps: ReadonlyArray<unknown>, read: (path: string) => string | null): LawRecord[] => {
  const lastBuild = steps.findLastIndex(Schema.is(BuildEntry));
  const buildHead = lastBuild === -1 ? null : (steps[lastBuild] as typeof BuildEntry.Type).head;
  const byLaw = new Map<string, LawRecord>();

  steps.forEach((step, at) => {
    if (!Schema.is(TestsEntry)(step)) {
      return;
    }

    const report = step.report === undefined || step.report === null ? null : read(step.report);
    const older = at < lastBuild && step.head !== buildHead;

    for (const law of new Set(step.plants.map((p) => p.law))) {
      // A later answer that names the law replaces the earlier one whole.
      byLaw.delete(law);
      byLaw.set(law, {
        law,
        head: step.head,
        plants: step.plants.filter((p) => p.law === law),
        failures: report === null ? [] : failuresIn(report, law),
        older,
      });
    }
  });

  return [...byLaw.values()];
};

/** The review brief's plant section, or `null` when no tests answer named a plant. */
export const section = (records: ReadonlyArray<LawRecord>, build: string | null): string | null => {
  if (records.length === 0) {
    return null;
  }

  const short = (s: string) => s.slice(0, 8);
  const lines = [
    "## Plant records",
    "",
    "The chain copied these from the lane's state file: for each law, the plants the newest tests answer that named it ran, at the head that step ended on. They are the lane's records; do not ask the tests step for them again.",
    build === null ? "No build has moved the lane yet." : `The last build ended at ${short(build)}.`,
    "",
  ];

  for (const r of records) {
    lines.push(`- ${r.law}, at ${short(r.head)}${r.older ? ", older than the last build" : ""}:`);
    lines.push(...r.plants.map((p) => `  - ${p.result}: ${p.plant}`));
    lines.push(...r.failures.map((f) => `  - the report's failure: ${f}`));
  }

  return lines.join("\n");
};
