// Each generated case runs in process through oxlint's RuleTester, at its next/ path; one oxlint run
// over every case's files then proves the repo's own .oxlintrc.json wires the rule at those paths.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noNodeFilesystem } from "./no-node-filesystem.ts";
import { noNodeImports } from "./no-node-imports.ts";

const CODE = "fabrika(no-node-imports)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

/** One case: a file at a path from the top of the repo, and the lines the rule fires on. */
type Case = { readonly text: string; readonly lines: readonly number[] };

/** In process, RuleTester: the file fires on exactly these lines, or on none. */
const check = (filename: string, { text: code, lines }: Case) => {
  tester.run("no-node-imports", noNodeImports, {
    valid: lines.length === 0 ? [{ code, filename }] : [],
    invalid:
      lines.length === 0
        ? []
        : [{ code, filename, errors: lines.map((line) => ({ line, message: /Native imports in next\/ need/ })) }],
  });
};

/** One oxlint run over every case's files, through the repo's own config. */
const cli = async (cases: ReadonlyMap<string, Case>) => {
  const result = await plant(Object.fromEntries([...cases].map(([path, { text }]) => [path, text])));
  expect(Object.fromEntries([...cases.keys()].map((path) => [path, result(CODE, path)]))).toEqual(
    Object.fromEntries([...cases].map(([path, { lines }]) => [path, lines])),
  );
  return result;
};

/** The path the one oxlint run reads run `n`'s file at: its name gets the number, its folder stays. */
const numbered = (path: string, n: number) => path.replace(/native/, `native${n}`);

it("every native import form needs a nonempty reason on its own line, in product and exam code", async () => {
  let n = 0;
  const cases = new Map<string, Case>();
  fc.assert(
    fc.property(
      fc.constantFrom(
        "fs",
        "fs/promises",
        "path",
        "child_process",
        "util",
        "os",
        "crypto",
        "sqlite",
        "url",
        "stream/web",
        "test",
        "module",
      ),
      fc.boolean(),
      fc.uuid(),
      (name, prefix, reason) => {
        const module = `${prefix ? "node:" : ""}${name}`;
        // Node's prefix-only modules are not bare builtins.
        const native = prefix || !["test", "sqlite"].includes(name);
        const from = JSON.stringify(module);
        const forms = [
          `import * as a from ${from};`,
          `import a from ${from};`,
          `import {x as a} from ${from};`,
          `import ${from};`,
          `import type {X} from ${from};`,
          `import {type X} from ${from};`,
          `export * from ${from};`,
          `export {x} from ${from};`,
          `export type {X} from ${from};`,
          `const a = import(${from});`,
          `const a = import(\`${module}\`);`,
          `const a = require(${from});`,
          `const a = require(\`${module}\`);`,
          `const a = module.require(${from});`,
          `import a = require(${from});`,
          `type A = import(${from}).X;`,
        ];
        const paths = [
          "next/packages/libfabrika/src/native.ts",
          "next/apps/fabrika/src/exam/native.ts",
          "next/native.d.ts",
          "next/native.test.ts",
          "next/native.test-support.ts",
          "next/e2e/native.ts",
          "packages/fabrika/src/native.ts",
        ];
        const lines = forms.flatMap((form, i) =>
          [
            "",
            ` // edge: ${reason}`,
            " // edge:   ",
            "before",
            ` /* edge: ${reason} */`,
            ` // not edge: ${reason}`,
          ].map((mark, j) => {
            const unique = form.replace(/\b(a|A|X|x)\b/g, (name) => `${name}${i}_${j}`);
            return mark === "before" ? `// edge: ${reason}\n${unique}` : unique + mark;
          }),
        );
        const body = lines.join("\n");
        const expected: number[] = [];
        let line = 1;

        for (const _ of forms) {
          expected.push(line, line + 2, line + 4, line + 5, line + 6);
          line += 7;
        }

        for (const [i, path] of paths.entries()) {
          const one = { text: body, lines: native && i < 3 ? expected : [] };
          check(path, one);
          cases.set(numbered(path, n), one);
        }

        n++;
      },
    ),
    { seed: 119120, numRuns: 12 },
  );
  await cli(cases);
});

it("multiline imports use the module string's line; strings and neighboring marks grant nothing", async () => {
  let n = 0;
  const cases = new Map<string, Case>();
  const products: string[] = [];
  fc.assert(
    fc.property(fc.uuid(), (reason) => {
      const path = "next/apps/fabrika/src/exam/native.ts";
      const product = "next/packages/libfabrika/src/native.ts";
      const exam = {
        text: [
          `import {\n readFile\n} from "node:fs"; // edge: ${reason}`,
          `import { // edge: ${reason}\n writeFile\n} from "node:fs";`,
          `const fake = "// edge: ${reason}"; const a = require("node:fs");`,
          'import {Effect} from "effect";',
          'import a from "some-package";',
          'import b from "./fs.ts";',
        ].join("\n"),
        lines: [6, 7],
      };
      const blessed = { text: `import {readFile} from "node:fs"; // edge: ${reason}`, lines: [] };
      check(path, exam);
      check(product, blessed);
      tester.run("no-node-filesystem", noNodeFilesystem, {
        valid: [{ code: blessed.text, filename: product }],
        invalid: [],
      });
      cases.set(numbered(path, n), exam);
      cases.set(numbered(product, n), blessed);
      products.push(numbered(product, n));
      n++;
    }),
    { seed: 119120, numRuns: 5 },
  );
  const result = await cli(cases);

  for (const product of products) {
    expect(result("fabrika(no-node-filesystem)", product)).toEqual([]);
  }
});
