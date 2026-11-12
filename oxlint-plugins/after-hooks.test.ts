// In next/, a resource is released by the scope that acquired it, never by an `afterEach` or
// `afterAll` that a thrown error or a killed test can skip (0061). oxlint's own `vitest/no-hooks`
// holds it, set in the repo's config to allow the two setup hooks. Each planted file sits at a
// generated path, so the config's globs are under test with the rule.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "vitest(no-hooks)";
const runs = { seed: 119120, numRuns: 12 };

const name = fc
  .array(fc.constantFrom("a", "Z", "_", "0", "é"), { minLength: 1, maxLength: 8 })
  .map((letters) => `file${letters.join("")}`);

const body = (after: string, before: string) =>
  [
    `import { ${after}, ${before}, it } from "vitest";`,
    `${after}(() => rmSync(folder, { recursive: true, force: true }));`, // 2
    `${before}(() => undefined);`, // 3: setup stays
    'it("x", () => undefined);',
    `describe("y", () => { ${after}(() => db.close()); });`, // 5: nested too
  ].join("\n");

it("refuses an after-hook in any next/ file, test or helper, and keeps the setup hooks", async () => {
  await fc.assert(
    fc.asyncProperty(
      name,
      fc.constantFrom("afterEach", "afterAll"),
      fc.constantFrom("beforeEach", "beforeAll"),
      async (file, after, before) => {
        const held = [
          `next/packages/libfabrika/src/ledger/${file}.test.ts`,
          `next/apps/fabrika/e2e/${file}.test.ts`,
          `next/apps/fabrika/src/${file}.laws.test.tsx`,
          `next/packages/libfabrika/src/processes/${file}.test-support.ts`,
        ];
        const free = [`packages/fabrika/src/${file}.test.ts`, `.agents/skills/x/scripts/${file}.test.ts`];
        const result = await plant(Object.fromEntries([...held, ...free].map((path) => [path, body(after, before)])));

        for (const path of held) {
          expect([path, result(CODE, path)]).toEqual([path, [2, 5]]);
        }

        for (const path of free) {
          expect([path, result(CODE, path)]).toEqual([path, []]);
        }
      },
    ),
    runs,
  );
});
