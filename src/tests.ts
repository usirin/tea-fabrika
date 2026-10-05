import { type ExampleCriterion, type Issue, testName } from "./issue.ts";

/** The file an issue's examples are written to. The builder may read it and never change it. */
export const TESTS_FILE = "criteria.test.js";

/**
 * A node:test file with one test per example, named by {@link testName}. Code
 * writes it from the issue's data, so what it asserts is exactly the example.
 */
export function testsFor(issue: Issue): string {
  const examples = issue.criteria.filter((c): c is ExampleCriterion => c.kind === "example");
  const names = new Map<string, Set<string>>();
  for (const c of examples) names.set(c.file, (names.get(c.file) ?? new Set()).add(c.name));
  const seen = new Set<string>();
  const tests = examples.flatMap((c) =>
    c.examples.flatMap((e) => {
      const name = testName(c, e);
      if (seen.has(name)) return [];
      seen.add(name);
      return [`test(${JSON.stringify(name)}, () => {\n  assert.deepStrictEqual(${e.call}, ${e.result});\n});\n`];
    }),
  );
  return [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    ...[...names].map(([file, imported]) => `import { ${[...imported].join(", ")} } from "./${file}";`),
    ``,
    ...tests,
  ].join("\n");
}
