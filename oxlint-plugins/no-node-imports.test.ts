import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "fabrika(no-node-imports)";

it("every native import form needs a nonempty reason on its own line, in product and exam code", async () => {
  await fc.assert(
    fc.asyncProperty(
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
      async (name, prefix, reason) => {
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

        const result = await plant(Object.fromEntries(paths.map((path) => [path, body])));

        for (const [i, path] of paths.entries()) {
          expect(result(CODE, path)).toEqual(native && i < 3 ? expected : []);
        }
      },
    ),
    { seed: 119120, numRuns: 12 },
  );
});

it("multiline imports use the module string's line; strings and neighboring marks grant nothing", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (reason) => {
      const path = "next/apps/fabrika/src/exam/native.ts";
      const product = "next/packages/libfabrika/src/native.ts";
      const result = await plant({
        [product]: `import {readFile} from "node:fs"; // edge: ${reason}`,
        [path]: [
          `import {\n readFile\n} from "node:fs"; // edge: ${reason}`,
          `import { // edge: ${reason}\n writeFile\n} from "node:fs";`,
          `const fake = "// edge: ${reason}"; const a = require("node:fs");`,
          'import {Effect} from "effect";',
          'import a from "some-package";',
          'import b from "./fs.ts";',
        ].join("\n"),
      });
      expect(result(CODE, path)).toEqual([6, 7]);
      expect(result(CODE, product)).toEqual([]);
      expect(result("fabrika(no-node-filesystem)", product)).toEqual([]);
    }),
    { seed: 119120, numRuns: 5 },
  );
});
