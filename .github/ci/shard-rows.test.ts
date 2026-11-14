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
import { main, nextFiles, stale } from "./shard-rows.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const options = { seed: 119120, numRuns: 100 };

// fast-check supplies dependent subarrays and unique strings; no domain schema describes paths here.
const rows = fc
  .uniqueArray(
    fc.oneof(
      fc.string(),
      fc.string().map((name) => `next/${name}`),
    ),
    { maxLength: 50 },
  )
  .chain((paths) =>
    fc
      .tuple(fc.subarray(paths), fc.subarray(paths))
      .map(([keys, files]) => ({ table: Object.fromEntries(keys.map((path) => [path, 0])), files })),
  );

// L2. Plants, each run once on shard-rows.ts and restored: return [] always (red); list the
// selected files with no row, as the old check did (red); drop the next/ prefix test, so a row of
// today's version counts as stale (red).
it("L2: stale rows are exactly next/ rows whose file Vitest does not select, sorted in either input order", () => {
  fc.assert(
    fc.property(rows, ({ table, files }) => {
      const expected = Object.keys(table)
        .filter((path) => path.startsWith("next/") && !files.includes(path))
        .toSorted();
      expect(stale(table, files)).toEqual(expected);
      expect(stale(table, files.toReversed())).toEqual(expected);
    }),
    {
      ...options,
      examples: [
        // A selected next/ file with no row is not stale: assign places it by its fallback.
        [{ table: { "next/a.test.ts": 1 }, files: ["next/a.test.ts", "next/new.test.ts"] }],
        // A row for a file gone from the selection is stale; a row outside next/ is not this check's.
        [{ table: { "next/gone.test.ts": 4, "next/a.test.ts": 0.0, "apps/x.test.ts": 2 }, files: ["next/a.test.ts"] }],
        // An own key that is also an Object prototype name is still a row.
        [{ table: { "next/constructor": 0, constructor: 0 }, files: [] }],
      ],
    },
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
it("format: L4 one diagnostic naming each stale row, exit 1 for stale rows and 0 otherwise", () => {
  // The CLI's line format is consumed by lint. Keep generated paths on one line.
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.string().filter((path) => !/[\r\n\u2028\u2029]/u.test(path)),
        { maxLength: 20 },
      ),
      (rows) => {
        const lines: string[] = [];
        expect(main(rows, (line) => lines.push(line))).toBe(rows.length === 0 ? 0 : 1);
        expect(lines).toEqual(
          rows.map(
            (path) =>
              `stale shard row: ${path} is not a next/ test file Vitest selects; delete its row in vitest.shards.ts`,
          ),
        );
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
  const rows = stale(measured, await nextFiles(root));
  const result = spawnSync(process.execPath, [".github/ci/shard-rows.ts"], { cwd: root, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(rows.length === 0 ? 0 : 1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    rows
      .map(
        (path) =>
          `stale shard row: ${path} is not a next/ test file Vitest selects; delete its row in vitest.shards.ts\n`,
      )
      .join(""),
  );
});
