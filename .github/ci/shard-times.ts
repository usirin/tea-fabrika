// Today's CI. Advice only: measured seconds are not a reason to fail a test job.
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measured } from "../../vitest.shards.ts";

export const LIMIT = 60;
export type Row = { readonly path: string; readonly seconds: number };

export const reportRows = (report: unknown, root: string): Row[] => {
  if (
    typeof report !== "object" ||
    report === null ||
    !("testResults" in report) ||
    !Array.isArray(report.testResults)
  ) {
    return [];
  }

  return report.testResults.flatMap((file: unknown) => {
    if (
      typeof file !== "object" ||
      file === null ||
      !("name" in file) ||
      typeof file.name !== "string" ||
      !("startTime" in file) ||
      typeof file.startTime !== "number" ||
      !("endTime" in file) ||
      typeof file.endTime !== "number"
    ) {
      return [];
    }

    const seconds = (file.endTime - file.startTime) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? [{ path: relative(root, file.name), seconds }] : [];
  });
};

export const staleRows = (table: Readonly<Record<string, number>>, real: readonly Row[]): Row[] =>
  real
    .filter((row) => Math.abs(row.seconds - (table[row.path] ?? 1)) > LIMIT)
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const rowLine = (row: Row): string => `  ${JSON.stringify(row.path)}: ${row.seconds.toFixed(1)},`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const path of process.argv.slice(2)) {
    try {
      const rows = reportRows(JSON.parse(readFileSync(path, "utf8")), process.cwd());

      for (const row of staleRows(measured, rows)) {
        console.log(
          `::warning::shard table differs by more than ${LIMIT} s: ${row.path.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
        );
        console.log(rowLine(row));
      }
    } catch {
      console.log("shard-times: report unavailable; no timing advice for this report");
    }
  }
}
