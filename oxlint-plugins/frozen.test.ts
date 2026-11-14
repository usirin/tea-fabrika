// Today's version's frozen paths, named once in frozen.mjs (decision 0525), and the checks that
// leave them out. The answers are written apart from frozen.mjs.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { frozen, liveRoots, shared } from "./frozen.mjs";

const options = { seed: 119120, numRuns: 200 };

it("F6: pinned: the list is the one 0525 names", () => {
  // pinned: 0525's sketch, `frozen` and `shared` as the decision writes them.
  expect([...frozen]).toEqual(["apps/", "programs/", "packages/", "bin/"]);
  expect([...shared]).toEqual(["packages/fabrika-design/"]);
});

const name = fc.oneof(
  fc.constantFrom("apps", "programs", "packages", "bin", ".git", "node_modules"),
  fc.constantFrom("next", ".github", ".agents", "oxlint-plugins", "fixtures", "docs", "package.json"),
  fc.stringMatching(/^\.?[a-z][a-z0-9._-]{0,10}$/),
);

it("F7: liveRoots holds every entry that is not frozen and the shared folder, never a frozen root, .git or node_modules", () => {
  const out = new Set(["apps", "programs", "packages", "bin", ".git", "node_modules"]);
  fc.assert(
    fc.property(fc.uniqueArray(name, { maxLength: 16 }), (entries) => {
      const roots = liveRoots(entries);
      expect(roots.filter((r) => r !== "packages/fabrika-design").sort()).toEqual(
        entries.filter((e) => !out.has(e)).sort(),
      );
      expect(roots.filter((r) => r === "packages/fabrika-design")).toEqual(["packages/fabrika-design"]);
    }),
    { ...options, examples: [[["apps", "next", ".git", "node_modules", "packages", "README.md"]]] },
  );
});
