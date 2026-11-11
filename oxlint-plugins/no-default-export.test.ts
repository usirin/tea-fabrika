// oxlint's own `import/no-default-export`, as `.oxlintrc.json` sets it (0058): on for our source,
// off for the tooling and config a tool loads by its default, and a platform default passes only
// under an inline edge comment on the line above it.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "import(no-default-export)";

/** Every way a module can have a default export, each on one line. */
const FORMS = [
  "export default 1;",
  "export default {};",
  "export default function f() {}",
  "export default async function () {}",
  "export default class C {}",
  "const a = 1; export { a as default };",
  'export { a as default } from "./named.ts";',
  'export { default } from "./named.ts";',
  'export type { T as default } from "./named.ts";',
];

const SOURCE = [
  "next",
  "next/packages/libfabrika/src",
  "packages/fabrika/src",
  "programs/ticket/src",
  "apps/fabrika/src",
];

/** Tooling and config under our source folders, which 0058 leaves out. */
const TOOLING = [
  "next/apps/fabrika/alchemy.run.ts",
  "packages/pipeline/rslib.config.ts",
  "packages/fabrika/vitest.config.ts",
  "apps/fabrika/stylelint.config.ts",
  "next/apps/fabrika/scripts/tool.ts",
];

/** Outside the source folders: the rule never runs there. */
const OUTSIDE = ["stylelint.config.ts", "experiments/tool.ts", "docs/tutorials/first/tool.ts"];

const NAMED = "export const a = 1;\nexport type T = number;\n";

it("every default export form is refused in our source, under every source folder", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...SOURCE), fc.stringMatching(/^[a-z]{1,8}$/), async (folder, stem) => {
      const files = Object.fromEntries(FORMS.map((form, i) => [`${folder}/${stem}${i}.ts`, `${form}\n`]));
      const result = await plant({ ...files, [`${folder}/named.ts`]: NAMED });

      for (const file of Object.keys(files)) {
        expect(result(CODE, file)).toEqual([1]);
      }

      expect(result(CODE, `${folder}/named.ts`)).toEqual([]);
    }),
    { seed: 119120, numRuns: 5 },
  );
});

it("an inline edge comment lets the default on the next line through, and no line further down", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...SOURCE), fc.uuid(), async (folder, reason) => {
      const edge = `// oxlint-disable-next-line import/no-default-export -- edge: ${reason}`;
      const marked = `${folder}/worker.ts`;
      const farther = `${folder}/farther.ts`;
      const result = await plant({
        [marked]: [edge, "export default { fetch: () => 1 };"].join("\n"),
        [farther]: [edge, "const a = 1;", "export default a;"].join("\n"),
      });
      expect(result(CODE, marked)).toEqual([]);
      expect(result(CODE, farther)).toEqual([3]);
    }),
    { seed: 119120, numRuns: 5 },
  );
});

it("scenario: tooling and config files, and files outside our source, keep their default export", async () => {
  // A tool loads these by their default, so 0058 leaves them out by glob.
  const files = Object.fromEntries([...TOOLING, ...OUTSIDE].map((file) => [file, "export default {};\n"]));
  const result = await plant(files);

  for (const file of Object.keys(files)) {
    expect(result(CODE, file)).toEqual([]);
  }
});

it("scenario: a declare module block that types a loader's default is not an export of ours", async () => {
  // apps/fabrika/src/window/wasm.d.ts types what esbuild's binary loader gives; the rule reads it as
  // a type, not as a module's own default.
  const file = "apps/fabrika/src/window/bytes.d.ts";
  const result = await plant({
    [file]: 'declare module "*.wasm" {\n  const bytes: Uint8Array;\n  export default bytes;\n}\n',
  });
  expect(result(CODE, file)).toEqual([]);
});
