// Today's CI, about next/. The unusual keys and line breaks exercise the check's edges.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect } from "@effect/vitest";
import * as fc from "fast-check";
import { testConfig } from "../../vitest.config.ts";
import { measured } from "../../vitest.shards.ts";
import { main, nextFiles, unmeasured } from "./shard-rows.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const options = { seed: 119120, numRuns: 100 };

// fast-check supplies dependent subarrays and unique strings; no domain schema describes paths here.
const rows = fc
  .uniqueArray(fc.string(), { maxLength: 50 })
  .chain((files) => fc.subarray(files).map((present) => ({ files, present })));

it("L2: missing rows are exactly absent own keys, sorted in either input order", () => {
  fc.assert(
    fc.property(rows, ({ files, present }) => {
      const table = Object.fromEntries(present.map((path) => [path, 0]));
      const expected = files.filter((path) => !present.includes(path)).toSorted();
      expect(unmeasured(table, files)).toEqual(expected);
      expect(unmeasured(table, files.toReversed())).toEqual(expected);
      expect(unmeasured(table, ["constructor", "toString"])).toEqual(
        ["constructor", "toString"].filter((path) => !present.includes(path)),
      );
      // A stale row is not a missing row, and 0.0 is present.
      expect(unmeasured({ stale: 0, zero: 0.0 }, ["zero"])).toEqual([]);
    }),
    options,
  );
});

it("scenario: L3 the real config finds TSX tests and excludes e2e, node_modules and dist", () => {
  // This law is about the file set selected by today's real Vitest config.
  const files = nextFiles(root);
  expect(files).toContain("next/apps/fabrika/src/exam/markdown.test.tsx");
  expect(files.every((path) => !/(?:^|\/)(?:e2e|node_modules|dist)\//.test(path))).toBe(true);
  const folder = mkdtempSync(join(tmpdir(), "t890-files-"));
  const selected = ["next/apps/toy/src/plain.test.ts", "next/apps/toy/src/view.test.tsx"];
  const excluded = [
    "next/apps/toy/e2e/wire.test.ts",
    "next/apps/toy/src/node_modules/dependency.test.ts",
    "next/apps/toy/src/dist/generated.test.ts",
  ];

  try {
    for (const path of [...selected, ...excluded]) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), "");
    }

    expect(nextFiles(folder)).toEqual(selected);
    // New next/ globs in the config must be read on every call.
    const added = "next/extra/fresh.test.tsx";
    mkdirSync(dirname(join(folder, added)), { recursive: true });
    writeFileSync(join(folder, added), "");
    testConfig.test.include.push("next/extra/*.test.tsx");

    try {
      expect(nextFiles(folder)).toEqual([...selected, added].toSorted());
    } finally {
      testConfig.test.include.pop();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("format: L4 one diagnostic per missing path, exit 1 for missing rows and 0 otherwise", () => {
  // The CLI's line format is consumed by lint. Keep generated paths on one line.
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.string().filter((path) => !/[\r\n\u2028\u2029]/u.test(path)),
        { maxLength: 20 },
      ),
      (missing) => {
        const lines: string[] = [];
        expect(main(missing, (line) => lines.push(line))).toBe(missing.length === 0 ? 0 : 1);
        expect(lines).toEqual(missing.map((path) => `no shard row: ${path}`));
        const silent: string[] = [];
        expect(main([], (line) => silent.push(line))).toBe(0);
        expect(silent).toEqual([]);
      },
    ),
    options,
  );
});

it("scenario: L4 the Node entry passes the real table and file set to the reporter", () => {
  // Spawn the real CLI so import.meta.main and its exit status are covered too.
  const missing = unmeasured(measured, nextFiles(root));
  const result = spawnSync(process.execPath, [".github/ci/shard-rows.ts"], { cwd: root, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(missing.length === 0 ? 0 : 1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(missing.map((path) => `no shard row: ${path}\n`).join(""));
});
