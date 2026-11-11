import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CEILING, FACTOR, FLOOR, limit, type Report, slowest } from "./limit.ts";

// Today's lead tooling.
const options = { seed: 119120, numRuns: 200 };

type File = (typeof Report.Type)["testResults"][number];

const duration = fc.oneof(fc.double({ min: 0, max: 120_000, noNaN: true }), fc.constant(null), fc.constant(undefined));
const tests = fc.array(duration, { maxLength: 6 }).map((ds) => ds.map((d) => (d === undefined ? {} : { duration: d })));

/** A file with times that hold its tests and some set-up, or a file that failed to load and has none. */
const file: fc.Arbitrary<File> = fc
  .tuple(tests, fc.double({ min: 0, max: 120_000, noNaN: true }), fc.boolean(), fc.integer({ min: 0, max: 2e12 }))
  .map(([assertionResults, setup, timed, start]) => {
    const sum = assertionResults.reduce((s, t) => s + (typeof t.duration === "number" ? t.duration : 0), 0);
    return timed ? { startTime: start, endTime: start + sum + setup, assertionResults } : { assertionResults };
  });

const report = fc.array(file, { maxLength: 5 }).map((testResults) => ({ testResults }));

describe("the mutation run's per-test limit, today's tooling", () => {
  it("is whole seconds from the floor to the ceiling, and at least three times the slowest wait below it", () => {
    fc.assert(
      fc.property(report, (r) => {
        const ms = limit(r);
        expect(ms % 1000).toBe(0);
        expect(ms).toBeGreaterThanOrEqual(FLOOR);
        expect(ms).toBeLessThanOrEqual(CEILING);
        expect(ms).toBeGreaterThanOrEqual(Math.min(CEILING, FACTOR * slowest(r)));
        expect(ms - 1000).toBeLessThan(Math.max(FLOOR, FACTOR * slowest(r)));
      }),
      options,
    );
  });

  it("never drops when a file is added, and a test with no duration or a file with no tests changes nothing", () => {
    fc.assert(
      fc.property(report, file, (r, more) => {
        expect(limit({ testResults: [...r.testResults, more] })).toBeGreaterThanOrEqual(limit(r));
        const blank = { assertionResults: [{}, { duration: null }] };
        expect(limit({ testResults: [...r.testResults, blank] })).toBe(limit(r));
      }),
      options,
    );
  });

  it("counts a file's set-up, its span less its tests, as one wait, and only tests in a file with no times", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 30_000, noNaN: true }),
        fc.double({ min: 0, max: 30_000, noNaN: true }),
        (test, setup) => {
          const timed = { startTime: 0, endTime: test + setup, assertionResults: [{ duration: test }] };
          expect(slowest({ testResults: [timed] })).toBeCloseTo(Math.max(test, setup), 6);
          expect(slowest({ testResults: [{ assertionResults: [{ duration: test }] }] })).toBe(test);
        },
      ),
      options,
    );
  });

  // vector: the three laws that stopped the first hourly runs' dry runs on 2026-11-11, with their
  // plain-run times in the box (CI runs 42955163001, 42962636258, 42988915529), and an empty report.
  it.each([
    [9_754, 30_000],
    [12_685, 39_000],
    [25_348, 60_000],
  ])("vector: a %s ms law gets %s ms", (ms, expected) => {
    expect(limit({ testResults: [{ assertionResults: [{ duration: ms }] }] })).toBe(expected);
  });

  it("vector: an empty report gets the floor", () => {
    expect(limit({ testResults: [] })).toBe(FLOOR);
  });

  // scenario: the command prints the limit for a real report shape, and fails on a file that is not
  // one, so the mutation command stops instead of taking the floor in silence.
  it("scenario: the command prints the limit for a report and fails on anything else", () => {
    const dir = mkdtempSync(join(tmpdir(), "mut-limit-"));
    const run = (text: string) => {
      const path = join(dir, "baseline.json");
      writeFileSync(path, text);
      return spawnSync(process.execPath, [join(import.meta.dirname, "limit.ts"), path], { encoding: "utf8" });
    };

    try {
      const good = run(
        JSON.stringify({
          numTotalTests: 1,
          testResults: [
            {
              name: "/repo/a.test.ts",
              status: "passed",
              startTime: 1,
              endTime: 14_001,
              assertionResults: [{ title: "slow", status: "passed", duration: 12_685 }],
            },
          ],
        }),
      );
      expect(good.status).toBe(0);
      expect(good.stdout).toBe("39000\n");
      const bad = run('{"testResults": "none"}');
      expect(bad.status).not.toBe(0);
      expect(bad.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
