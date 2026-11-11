import { resolve } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { LIMIT, reportRows, staleRows, rowLine, type Row } from "./shard-times.ts";

const options = { seed: 119120, numRuns: 100 };

it("L10: report times advise exactly for stale rows, including unmeasured files", () => {
  // Plant: require a table entry before comparing, losing new slow files.
  const path = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.test\.ts$/);
  fc.assert(
    fc.property(
      fc.dictionary(
        path,
        fc.record({
          row: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
          real: fc.integer({ min: 0, max: 1000 }),
          start: fc.integer({ min: 0, max: 1000000 }),
        }),
      ),
      (entries) => {
        const root = resolve("timing-fixture");
        const report = {
          testResults: Object.entries(entries).map(([path, value]) => ({
            name: resolve(root, path),
            startTime: value.start,
            endTime: value.start + value.real * 1000,
          })),
        };
        const rows: Row[] = Object.entries(entries).map(([path, value]) => ({ path, seconds: value.real }));
        expect(reportRows(report, root)).toEqual(rows);
        const table = Object.fromEntries(
          Object.entries(entries).flatMap(([path, value]) => (value.row === undefined ? [] : [[path, value.row]])),
        );
        table["not-run.test.ts"] = 10000;
        const expected = rows
          .filter((row) => Math.abs(row.seconds - (entries[row.path]!.row ?? 1)) > LIMIT)
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        expect(staleRows(table, rows)).toEqual(expected);
      },
    ),
    {
      ...options,
      examples: [
        [{ "new.test.ts": { row: undefined, real: LIMIT + 2, start: 17 } }],
        [{ "edge.test.ts": { row: 0, real: LIMIT, start: 41 } }],
      ],
    },
  );
});

it("L11: printed rows round-trip paths and real seconds to one decimal", () => {
  // Plant: print a fixed old table time instead of the report's seconds.
  fc.assert(
    fc.property(fc.string(), fc.double({ min: 0, max: 1e6, noNaN: true }), (path, seconds) => {
      const row: Row = { path, seconds };
      expect(rowLine(row)).toBe(`  ${JSON.stringify(path)}: ${seconds.toFixed(1)},`);
      expect(JSON.parse(`{${rowLine(row).trim().slice(0, -1)}}`)).toEqual({ [path]: Number(seconds.toFixed(1)) });
    }),
    options,
  );
});
