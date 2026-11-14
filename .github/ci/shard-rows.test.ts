// Today's CI, about next/. The unusual keys and line breaks exercise the check's edges.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect } from "@effect/vitest";
import * as fc from "fast-check";
import { createVitest } from "vitest/node";
import { testConfig } from "../../vitest.config.ts";
import { measured } from "../../vitest.shards.ts";
import { main, nextFiles, unmeasured } from "./shard-rows.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const options = { seed: 119120, numRuns: 100 };

// fast-check supplies dependent subarrays and unique strings; no domain schema describes paths here.
const rows = fc
  .uniqueArray(fc.string(), { maxLength: 50 })
  .chain((files) => fc.subarray(files).map((present) => ({ files, present })));

// L2. Plants, each run once on shard-rows.ts and restored: return [] always (red); test the key
// with `in`, so `constructor` passes as a row (red).
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

// L3. Plants, each run once on shard-rows.ts and restored: narrow the next/ globs to `*.test.ts`,
// so the scratch folder's view.test.tsx is lost (red); add `next/apps/*/e2e/**/*.test.ts`, so the
// app's end-to-end files are found (red).
it("scenario: L3 the real config finds TSX tests and excludes e2e, node_modules and dist", async () => {
  // This law is about the file set selected by today's real Vitest config. No .tsx test is left
  // under next/ in the repo, so the scratch folder's view.test.tsx holds that case.
  const files = await nextFiles(root);
  expect(files.length).toBeGreaterThan(0);
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

    const vitest = await createVitest("test", {
      root: folder,
      config: false,
      watch: false,
      include: testConfig.test.include,
      exclude: testConfig.test.exclude,
    });

    try {
      const actual = (await vitest.globTestSpecifications())
        .map((spec) => relative(vitest.config.root, spec.moduleId))
        .toSorted();
      expect(await nextFiles(folder)).toEqual(actual);
      expect(actual).toEqual(selected);
    } finally {
      await vitest.close();
    }

    // New next/ globs in the config must be read on every call.
    const added = "next/extra/fresh.test.tsx";
    mkdirSync(dirname(join(folder, added)), { recursive: true });
    writeFileSync(join(folder, added), "");
    testConfig.test.include.push("next/extra/*.test.tsx");

    try {
      expect(await nextFiles(folder)).toEqual([...selected, added].toSorted());
    } finally {
      testConfig.test.include.pop();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// Generated paths under the three next/ include roots. A folder or file name may start with a dot
// or end in `.git`, and a folder may be one the config or Vitest's defaults exclude, so the dot
// rules and every exclude meet in one walk. fast-check supplies the paths; no domain schema fits.
const segment = fc.oneof(
  fc.stringMatching(/^\.?[a-z]{1,4}(?:\.git)?$/),
  fc.constantFrom("e2e", "dist", "node_modules", ".git"),
);

const testPath = fc
  .tuple(
    fc.constantFrom("next/apps", "next/packages", "next/programs"),
    segment,
    fc.constantFrom("src", "e2e", ".src"),
    fc.array(segment, { maxLength: 2 }),
    fc.stringMatching(/^\.?[a-z]{1,4}$/),
    fc.constantFrom(".test.ts", ".test.tsx", ".ts"),
  )
  .map(([top, name, src, folders, file, end]) => [top, name, src, ...folders, file + end].join("/"));

// L3, the class: the file set is Vitest's own selection on any tree, and a new exclude in the
// config is read on every call. Plants, each run once on shard-rows.ts and restored: the reviewed
// `node:fs` globSync, which skips dot folders and dot files (red, `next/apps/a/src/.a.test.ts`
// lost); read the excludes once at load, so the pushed exclude is ignored (red).
// Each run gets its own folder and its own Vitest: one Vitest reused over a changed tree kept its
// first selection, so a reused one is no reference.
it("L3: next files equal Vitest's own selection on generated trees, new excludes included", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uniqueArray(testPath, { minLength: 1, maxLength: 8 }), fc.nat(), async (paths, pick) => {
      const folder = mkdtempSync(join(tmpdir(), "t890-dots-"));

      try {
        for (const path of paths) {
          mkdirSync(dirname(join(folder, path)), { recursive: true });
          writeFileSync(join(folder, path), "");
        }

        const vitest = await createVitest("test", {
          root: folder,
          config: false,
          watch: false,
          include: testConfig.test.include,
          exclude: testConfig.test.exclude,
        });
        let selected: string[];

        try {
          selected = (await vitest.globTestSpecifications())
            .map((spec) => relative(vitest.config.root, spec.moduleId))
            .toSorted();
        } finally {
          await vitest.close();
        }

        expect(await nextFiles(folder)).toEqual(selected);

        // A new exclude is picked up: exclude one selected file by its own path.
        const gone = selected[pick % Math.max(selected.length, 1)];

        if (gone !== undefined) {
          testConfig.test.exclude.push(gone);

          try {
            expect(await nextFiles(folder)).toEqual(selected.filter((path) => path !== gone));
          } finally {
            testConfig.test.exclude.pop();
          }
        }
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }),
    options,
  );
});

// L4. Plants, each run once on shard-rows.ts and restored: exit 0 always (red); print only the
// first path (red).
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

it("scenario: L4 the Node entry passes the real table and file set to the reporter", async () => {
  // Spawn the real CLI so import.meta.main and its exit status are covered too.
  const missing = unmeasured(measured, await nextFiles(root));
  const result = spawnSync(process.execPath, [".github/ci/shard-rows.ts"], { cwd: root, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(missing.length === 0 ? 0 : 1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(missing.map((path) => `no shard row: ${path}\n`).join(""));
});
