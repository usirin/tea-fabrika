// `fabrika/no-wall-clock` through the repo's real config: next/'s product code reads the time through
// Effect's `Clock` or `DateTime`, never the platform's clock. Each planted file sits at a generated
// path, so the config's globs are under test with the rule.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "fabrika(no-wall-clock)";
const runs = { seed: 119120, numRuns: 12 };

const name = fc
  .array(fc.constantFrom("a", "Z", "_", "0", "é"), { minLength: 1, maxLength: 8 })
  .map((letters) => `file${letters.join("")}`);

const host = fc.constantFrom("", "window.", "globalThis.");

/** The platform's three clock reads, each reached through `host`. */
const reads = (on: string) => [`const a = ${on}Date.now();`, `const b = new ${on}Date();`, `const c = ${on}Date();`];

/** Code that names `Date` or a `now` and reads no clock. */
const kept = (at: string) => [
  `const d = new Date(${at});`,
  `const e = Date.parse("2026-11-11");`,
  `const f = ${at} instanceof Date;`,
  `const g = Date.UTC(2026, 10, 11);`,
  "const h = clock.now();",
  "const i = DateTime.now;",
  "type J = Date;",
];

it("refuses each clock read in next/ product code, and passes what reads no clock", async () => {
  await fc.assert(
    fc.asyncProperty(name, host, fc.constantFrom("at", "1_000", "span.start"), async (file, on, at) => {
      const paths = [
        `next/packages/libfabrika/src/runtime/${file}.ts`,
        `next/apps/fabrika/${file}.ts`,
        `next/programs/counter/src/${file}.ts`,
      ];
      const result = await plant(
        Object.fromEntries(paths.map((path) => [path, [...reads(on), ...kept(at)].join("\n")])),
      );

      for (const path of paths) {
        expect([path, result(CODE, path)]).toEqual([path, [1, 2, 3]]);
      }
    }),
    runs,
  );
});

it("leaves tests, test helpers, .tsx views and today's paths to their own rules", async () => {
  await fc.assert(
    fc.asyncProperty(name, host, async (file, on) => {
      const paths = [
        `next/packages/libfabrika/src/runtime/${file}.test.ts`,
        `next/apps/fabrika/e2e/${file}.test.ts`,
        `next/packages/libfabrika/src/processes/${file}.test-support.ts`,
        `next/apps/fabrika/src/window/${file}.tsx`,
        `packages/fabrika/src/${file}.ts`,
        `.agents/skills/x/scripts/${file}.ts`,
      ];
      const result = await plant(Object.fromEntries(paths.map((path) => [path, reads(on).join("\n")])));

      for (const path of paths) {
        expect([path, result(CODE, path)]).toEqual([path, []]);
      }

      // A view has the stricter rule.
      expect(result("fabrika(no-clock-in-view)", paths[3] ?? "")).toEqual([1, 2, 3]);
    }),
    runs,
  );
});
