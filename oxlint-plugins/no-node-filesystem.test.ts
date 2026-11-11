// P12, next/. Each generated case runs in process through oxlint's RuleTester, at product and exam
// paths; one oxlint run over every case's files then proves the repo's own .oxlintrc.json wires it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { noNodeFilesystem } from "./no-node-filesystem.ts";

const root = join(import.meta.dirname, "..");

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: root });

/** In process, RuleTester: the file fires on exactly these lines, or on none. */
const check = (filename: string, code: string, lines: readonly number[]) => {
  tester.run("no-node-filesystem", noNodeFilesystem, {
    valid: lines.length === 0 ? [{ code, filename }] : [],
    invalid:
      lines.length === 0
        ? []
        : [{ code, filename, errors: lines.map((line) => ({ line, message: /Use Effect FileSystem and Path/ })) }],
  });
};

/** One oxlint run over every case's files, through the repo's own config: the lines each one fires. */
const cli = (cases: ReadonlyMap<string, readonly number[]>) => {
  const out = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["--format=json", ...[...cases.keys()].map((file) => relative(root, file))],
    { cwd: root, encoding: "utf8" },
  );
  const report = JSON.parse(out.stdout) as {
    diagnostics: Array<{
      code: string;
      filename: string;
      labels: Array<{ span: { line: number } }>;
    }>;
  };
  const found = [...cases.keys()].map((file) => [
    file,
    report.diagnostics
      .filter((d) => d.code === "fabrika(no-node-filesystem)" && join(root, d.filename) === file)
      .map((d) => d.labels[0]!.span.line)
      .sort((a, b) => a - b),
  ]);
  expect(Object.fromEntries(found)).toEqual(Object.fromEntries(cases));
};

it("every native filesystem import form is refused only in next/ product files", () => {
  const folder = mkdtempSync(join(root, "next/.p12-fs-"));

  try {
    let n = 0;
    const cases = new Map<string, readonly number[]>();
    fc.assert(
      fc.property(
        fc.constantFrom(
          "node:fs",
          "node:fs/promises",
          "fs",
          "fs/promises",
          "node:path",
          "path",
          "node:path/posix",
          "node:path/win32",
        ),
        (module) => {
          const from = JSON.stringify(module);
          const forms = [
            `import * as native0 from ${from};`,
            `import native1 from ${from};`,
            `import {readFile as read} from ${from};`,
            `import ${from};`,
            `export * from ${from};`,
            `export {readFile as read} from ${from};`,
            `const native6 = await import(${from});`,
            `const native7 = require(${from});`,
            `import native8 = require(${from});`,
            `const native9 = import(\`${module}\`);`,
          ];
          const files = [
            ["product/plant.ts", true],
            ["product/plant.test.ts", false],
            ["product/plant.test-support.ts", false],
            ["exam/plant.ts", false],
            ["e2e/plant.ts", false],
          ] as const;
          // The one oxlint run reads every run's files, so each run writes them in a folder of its own.
          const run = join(folder, `${n++}`);

          for (const [name, banned] of files) {
            const lines = banned ? forms.map((_, i) => i + 1) : [];
            check(relative(root, join(folder, name)), forms.join("\n"), lines);
            mkdirSync(dirname(join(run, name)), { recursive: true });
            writeFileSync(join(run, name), forms.join("\n"));
            cases.set(join(run, name), lines);
          }
        },
      ),
      { seed: 119120, numRuns: 8, examples: [["node:fs"], ["fs/promises"], ["node:path"]] },
    );
    cli(cases);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
