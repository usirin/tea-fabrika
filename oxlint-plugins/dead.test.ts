// `pnpm lint:dead` (dead.ts): code-graph's dead exports, less those in today's frozen version
// (0525), with no ledger (0524).
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import * as fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { judge, type Report } from "./dead.ts";

const ROOT = join(import.meta.dirname, "..");
const DEAD = join(import.meta.dirname, "dead.ts");

/** Frozen, written apart from frozen.mjs: under one of the four roots and not the design package. */
const frozenFile = (file: string) =>
  /^(?:apps|programs|packages|bin)\//.test(file) && !file.startsWith("packages/fabrika-design/");

const file = fc
  .tuple(
    fc.constantFrom(
      "apps/fabrika/src/",
      "packages/pipeline/src/",
      "programs/trace/src/",
      "bin/",
      "packages/fabrika-design/src/",
      "next/packages/libfabrika/src/",
      "oxlint-plugins/",
      ".github/ci/",
      ".agents/skills/lead/scripts/",
      "packages-old/",
    ),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
  )
  .map(([at, name]) => `${at}${name}.ts`);

// The shape main's run printed on 2026-11-14: `{file, id, category, startLine, testReferences}`.
const finding = fc
  .tuple(file, fc.stringMatching(/^[a-zA-Z]{1,8}$/), fc.constantFrom("dead", "only-called-from-tests", undefined))
  .map(([at, name, category]) => ({
    file: at,
    id: `${at}:${name}`,
    ...(category === undefined ? {} : { category }),
  }));

it("S5: dead.ts fails on every finding in a live file and on none in a frozen file, in both arrays", () => {
  fc.assert(
    fc.property(fc.array(finding, { maxLength: 12 }), fc.array(finding, { maxLength: 12 }), (unreachable, unused) => {
      const report: typeof Report.Type = { unreachable, unusedExports: unused };
      const all = [...unreachable, ...unused];
      const { blocks, frozen } = judge(report);
      expect(blocks).toEqual(all.filter((f) => !frozenFile(f.file)));
      expect(frozen).toBe(all.filter((f) => frozenFile(f.file)).length);
    }),
    {
      seed: 119120,
      numRuns: 200,
      // pinned: main's three findings on 2026-11-14, all frozen, and one live unused export.
      examples: [
        [
          [
            {
              file: "apps/fabrika/src/editor/grid.ts",
              id: "apps/fabrika/src/editor/grid.ts:gridOf",
              category: "only-called-from-tests",
            },
          ],
          [{ file: "next/packages/libfabrika/src/Id.ts", id: "next/packages/libfabrika/src/Id.ts:gone" }],
        ],
      ],
    },
  );
});

const temps: string[] = [];

afterAll(() => {
  for (const at of temps) {
    rmSync(at, { recursive: true, force: true });
  }
});

/** dead.ts's main with a stand-in code-graph first on PATH, which prints `stdout` and exits `status`. */
const withGraph = (stdout: string, status: number) => {
  const bin = mkdtempSync(join(tmpdir(), "dead-graph-"));
  temps.push(bin);
  const stub = join(bin, "code-graph");
  writeFileSync(
    stub,
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${status});\n`,
  );
  chmodSync(stub, 0o755);
  return spawnSync(process.execPath, [DEAD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: [bin, process.env["PATH"]].join(delimiter) },
  });
};

it("S6: scenario: dead.ts exits 2 when code-graph fails or prints what does not decode, never 0", () => {
  // scenario: each way code-graph can fail to report, through main, with a stand-in on PATH.
  const clean = JSON.stringify({ entryCount: 1, unreachable: [], unusedExports: [], withheld: [] });
  const live = JSON.stringify({
    unreachable: [],
    unusedExports: [{ file: "next/x.ts", id: "next/x.ts:x" }],
  });
  const frozen = JSON.stringify({
    unreachable: [{ file: "apps/x.ts", id: "apps/x.ts:x", category: "dead" }],
    unusedExports: [],
  });
  expect(withGraph(clean, 1).status).toBe(2);
  expect(withGraph(clean, 2).status).toBe(2);
  expect(withGraph("not json", 0).status).toBe(2);
  expect(withGraph("", 0).status).toBe(2);
  expect(withGraph(JSON.stringify({ unreachable: [] }), 0).status).toBe(2);
  expect(withGraph(JSON.stringify({ unreachable: [{ id: "x" }], unusedExports: [] }), 0).status).toBe(2);
  expect(withGraph(clean, 0).status).toBe(0);
  expect(withGraph(frozen, 0).status).toBe(0);
  const red = withGraph(live, 0);
  expect(red.status).toBe(1);
  expect(red.stdout).toContain("next/x.ts:x");
});

it("S7: pinned: unreachable-ledger.json is gone, and nothing makes it again (0524)", () => {
  // pinned: 0524's law, that the list of waived dead exports does not exist.
  expect(existsSync(join(ROOT, "unreachable-ledger.json"))).toBe(false);
});
