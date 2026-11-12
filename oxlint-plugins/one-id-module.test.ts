// Each generated case runs in process through oxlint's RuleTester, at its path; one oxlint run then
// proves the repo's own .oxlintrc.json wires the rule. The retired path is one path, so each run
// lints one body: one oxlint run for each of the four body kinds, as the first generated run drew them.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { oneIdModule } from "./one-id-module.ts";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const retired = "next/packages/libfabrika/src/data/id.ts";

const allowed = [
  "next/packages/libfabrika/src/Id.ts",
  "next/packages/libfabrika/src/data/id.test.ts",
  "next/packages/libfabrika/src/transport/id.ts",
  "packages/fabrika/src/data/id.ts",
];

const forwarding = 'export * from "../id.ts";';

it("refuses the retired Id module for generated contents and permits other module paths", async () => {
  // The first run's four bodies: one of each kind, for the oxlint runs below.
  let kinds: readonly string[] = [];
  fc.assert(
    fc.property(fc.string(), fc.integer(), (text, count) => {
      const bodies = [
        "",
        `export const value = ${JSON.stringify(text)};`,
        `export const value = ${count};`,
        forwarding,
      ];

      if (kinds.length === 0) {
        kinds = bodies;
      }

      for (const code of bodies) {
        tester.run("one-id-module", oneIdModule, {
          valid: allowed.map((filename) => ({ code, filename })),
          invalid: [{ code, filename: retired, errors: [{ line: 1, message: /Delete data\/id\.ts/ }] }],
        });
      }
    }),
    { seed: 119120, numRuns: 10 },
  );
  expect(kinds).toHaveLength(4);

  for (const body of kinds) {
    const linted = await plant(Object.fromEntries([retired, ...allowed].map((path) => [path, body])));
    expect(linted("fabrika(one-id-module)", retired)).toEqual([1]);

    for (const path of allowed) {
      expect(linted("fabrika(one-id-module)", path)).toEqual([]);
    }
  }
});
