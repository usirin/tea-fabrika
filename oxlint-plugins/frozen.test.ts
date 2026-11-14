// Today's version's frozen paths, named once in frozen.mjs (decision 0525), and the checks that
// leave them out. The answers are written apart from frozen.mjs.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { parse } from "yaml";
import { oxfmtArgs } from "./format.ts";
import { frozen, isFrozen, livePackages, liveRoots, packageDirs, shared } from "./frozen.mjs";
import { oxlintArgs } from "./lint.ts";

const options = { seed: 119120, numRuns: 200 };

it("F6: pinned: the list is the one 0525 names", () => {
  // pinned: 0525's sketch, `frozen` and `shared` as the decision writes them.
  expect([...frozen]).toEqual(["apps/", "programs/", "packages/", "bin/"]);
  expect([...shared]).toEqual(["packages/fabrika-design/"]);
});

const segment = () => fc.stringMatching(/^[a-z][a-z0-9._-]{0,10}$/);

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

// ---------------------------------------------------------------- the whole-repo runs leave them out

const ROOT = join(import.meta.dirname, "..");
const temps: string[] = [];

afterAll(() => {
  for (const at of temps) {
    rmSync(at, { recursive: true, force: true });
  }
});

/** A folder of top-level entries, as a whole run sees the repo, inside this one so its config runs. */
const tree = (files: Readonly<Record<string, string>>) => {
  const at = mkdtempSync(join(import.meta.dirname, ".plant-frozen-"));
  temps.push(at);

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, file)), { recursive: true });
    writeFileSync(join(at, file), text);
  }

  return at;
};

const BROKEN = "declare const x: number;\nexport const a = x as any;\n";

it("S1: scenario: a whole lint.ts run's oxlint arguments report a break in a live folder and none in a frozen one", () => {
  // scenario: one oxlint run in a folder laid out like the repo, with the arguments lint.ts builds.
  const at = tree({
    "next/plant/a.ts": BROKEN,
    "apps/plant/a.ts": BROKEN,
    "packages/pipeline/plant/a.ts": BROKEN,
    "packages/fabrika-design/plant/a.ts": BROKEN,
    "scripts/plant/a.ts": BROKEN,
  });
  const ran = spawnSync(join(ROOT, "node_modules", ".bin", "oxlint"), oxlintArgs([], readdirSync(at)), {
    cwd: at,
    encoding: "utf8",
  });
  const report = JSON.parse(ran.stdout) as {
    readonly diagnostics: readonly { readonly code: string; readonly filename: string }[];
  };
  const hit = report.diagnostics
    .filter((d) => d.code === "fabrika(no-type-assertions)")
    .map((d) => d.filename)
    .sort();
  expect(hit).toEqual(["next/plant/a.ts", "packages/fabrika-design/plant/a.ts", "scripts/plant/a.ts"]);
});

it("S2: a path run of lint.ts and format.ts passes exactly the paths it was given", () => {
  const flag = fc.constantFrom("--fix", "--check", "--quiet");
  const given = fc.oneof(
    fc
      .tuple(fc.constantFrom("apps", "next", "packages", ".", "oxlint-plugins"), fc.array(segment(), { maxLength: 3 }))
      .map(([top, rest]) => [top, ...rest].join("/")),
    flag,
  );
  fc.assert(
    fc.property(fc.array(given, { maxLength: 6 }), fc.uniqueArray(name, { maxLength: 12 }), (args, entries) => {
      fc.pre(args.some((arg) => !arg.startsWith("-")));
      const paths = (list: readonly string[]) => list.filter((arg) => !arg.startsWith("-"));
      expect(paths(oxlintArgs(args, entries))).toEqual(paths(args));
      expect(paths(oxfmtArgs(args, entries))).toEqual(paths(args));
    }),
    { seed: 119120, numRuns: 100 },
  );
});

it("S3: scenario: a whole format.ts --check run's arguments report a misformatted live file and not a frozen one", () => {
  // scenario: one oxfmt run in a folder laid out like the repo, with the arguments format.ts builds.
  const UGLY = "export   const a   = 1\n";
  const at = tree({
    "next/plant/a.ts": UGLY,
    "programs/plant/a.ts": UGLY,
    "bin/plant/a.ts": UGLY,
    "packages/fabrika-design/plant/a.ts": UGLY,
  });
  const ran = spawnSync(join(ROOT, "node_modules", ".bin", "oxfmt"), oxfmtArgs(["--check"], readdirSync(at)), {
    cwd: at,
    encoding: "utf8",
  });
  const said = `${ran.stdout}${ran.stderr}`;
  expect(ran.status).toBe(1);
  expect(said).toContain("next/plant/a.ts");
  expect(said).toContain("packages/fabrika-design/plant/a.ts");
  expect(said).not.toContain("programs/plant/a.ts");
  expect(said).not.toContain("bin/plant/a.ts");
});

// ---------------------------------------------------------------- the typecheck leaves them out

// vector: `pnpm ls -r --depth -1 --json` on main at 60a795c, its paths made repo-relative.
const WORKSPACE = JSON.parse(readFileSync(join(import.meta.dirname, "frozen.workspace.json"), "utf8")) as readonly {
  readonly name: string;
  readonly path: string;
}[];

const LIVE = [
  ".agents",
  ".github/ci",
  "docs/tutorials/agents",
  "docs/tutorials/two-hosts",
  "next/apps/fabrika",
  "next/packages/libfabrika",
  "next/packages/tuval",
  "next/programs/chaos",
  "next/programs/checklist",
  "next/programs/counter",
  "next/programs/inbox",
  "next/programs/pipeline",
  "oxlint-plugins",
  "packages/fabrika-design",
];

it("S8: vector: livePackages keeps the live workspace packages and drops today's frozen ones", () => {
  expect(livePackages(WORKSPACE.map((p) => p.path))).toEqual(LIVE);
  const dropped = WORKSPACE.map((p) => p.path).filter((p) => p !== "." && !LIVE.includes(p));
  expect(dropped.sort()).toEqual(
    [
      "apps/fabrika",
      "packages/fabrika",
      "packages/ledger-server",
      "packages/pipeline",
      "packages/promises",
      ...[
        "compare",
        "counter",
        "experiment",
        "experiments",
        "map",
        "markdown",
        "pipeline",
        "ticket",
        "trace",
        "tracker",
      ].map((name) => `programs/${name}`),
    ].sort(),
  );
});

it("S8b: vector: the real pnpm-workspace.yaml, read by packageDirs, gives the live packages pnpm itself listed", () => {
  // vector: the same saved `pnpm ls` output as S8, against the real workspace file and tree.
  const { packages } = parse(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")) as { packages: string[] };
  expect(livePackages(packageDirs(ROOT, packages))).toEqual(LIVE);
  expect(packageDirs(ROOT, packages)).toEqual(
    WORKSPACE.map((p) => p.path)
      .filter((p) => p !== ".")
      .sort(),
  );
});

it("S8c: packageDirs finds exactly the folders under each glob that hold a package.json, one level for *, and refuses a ! glob", () => {
  const folder = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
  const entry = fc.record({ name: folder, manifest: fc.boolean(), deeper: fc.boolean() });
  const globs = ["next/apps/*", "packages/*", "programs/*", "tools/one"];
  fc.assert(
    fc.property(
      fc.uniqueArray(entry, { selector: (e) => e.name, maxLength: 6 }),
      fc.uniqueArray(entry, { selector: (e) => e.name, maxLength: 6 }),
      fc.boolean(),
      (apps, programs, literal) => {
        const at = mkdtempSync(join(tmpdir(), "frozen-workspace-"));
        temps.push(at);
        const want: string[] = [];
        const lay = (dir: string, e: { name: string; manifest: boolean; deeper: boolean }) => {
          mkdirSync(join(at, dir, e.name, "inner"), { recursive: true });

          if (e.manifest) {
            writeFileSync(join(at, dir, e.name, "package.json"), "{}\n");
            want.push(`${dir}/${e.name}`);
          }

          // A package one level deeper is no match for `*`.
          if (e.deeper) {
            writeFileSync(join(at, dir, e.name, "inner", "package.json"), "{}\n");
          }
        };

        for (const e of apps) {
          lay("next/apps", e);
        }

        for (const e of programs) {
          lay("programs", e);
        }

        if (literal) {
          mkdirSync(join(at, "tools", "one"), { recursive: true });
          writeFileSync(join(at, "tools", "one", "package.json"), "{}\n");
          want.push("tools/one");
        }

        expect(packageDirs(at, globs)).toEqual(want.sort());
        expect(() => packageDirs(at, [...globs, "!programs/x"])).toThrow();
      },
    ),
    { seed: 119120, numRuns: 50 },
  );
});

it("S8d: scenario: frozen.mjs packages prints a temp workspace's live packages from any folder, and exits 2 on a bad workspace file", () => {
  // scenario: a temp checkout with a copy of frozen.mjs, its oxlint-plugins/node_modules a link to
  // the real one (read, never written), as stylelint.test.ts's runnerRepo does. No pnpm runs.
  const at = mkdtempSync(join(tmpdir(), "frozen-checkout-"));
  temps.push(at);
  mkdirSync(join(at, "oxlint-plugins"));
  writeFileSync(join(at, "oxlint-plugins", "frozen.mjs"), readFileSync(join(import.meta.dirname, "frozen.mjs")));
  symlinkSync(join(import.meta.dirname, "node_modules"), join(at, "oxlint-plugins", "node_modules"), "dir");

  for (const dir of ["next/apps/fabrika", "packages/pipeline", "packages/fabrika-design", "apps/fabrika", "tools/x"]) {
    mkdirSync(join(at, dir), { recursive: true });
    writeFileSync(join(at, dir, "package.json"), "{}\n");
  }

  const elsewhere = mkdtempSync(join(tmpdir(), "frozen-elsewhere-"));
  temps.push(elsewhere);
  const run = () =>
    spawnSync(process.execPath, [join(at, "oxlint-plugins", "frozen.mjs"), "packages"], {
      cwd: elsewhere,
      encoding: "utf8",
    });
  const write = (text: string) => writeFileSync(join(at, "pnpm-workspace.yaml"), text);

  write("packages:\n  - apps/*\n  - packages/*\n  - next/apps/*\n  - tools/x\n");
  const good = run();
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout.trim().split("\n")).toEqual(["next/apps/fabrika", "packages/fabrika-design", "tools/x"]);

  for (const bad of ["packages: [\n", "catalog:\n  a: 1\n", "packages:\n  - apps/*\n"]) {
    write(bad);
    const out = run();
    expect(out.status, bad).toBe(2);
    expect(out.stdout, bad).toBe("");
  }

  rmSync(join(at, "pnpm-workspace.yaml"));
  const missing = run();
  expect(missing.status).toBe(2);
  expect(missing.stdout).toBe("");
});

it("D1: scenario: no tracked test file sits under a frozen path (0525)", () => {
  // scenario: the real index. Today's tests and their test-only support left with 0525.
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 ** 28 });
  expect(listed.status).toBe(0);
  const files = listed.stdout.split("\0").filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((file) => isFrozen(file) && /\.test[.-]/.test(file))).toEqual([]);
});

it("D8: scenario: every named entry of a frozen package.json is a tracked file or build output under dist/", () => {
  // scenario: the real index and each frozen package's manifest. A named export is a package's
  // public surface, so a deleted target is frozen product code deleted. A `*` target names nothing.
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 ** 28 });
  expect(listed.status).toBe(0);
  const tracked = new Set(listed.stdout.split("\0").filter(Boolean));
  const manifests = [...tracked].filter((file) => isFrozen(file) && file.endsWith("/package.json"));
  expect(manifests.length).toBeGreaterThan(0);
  /** Every string target below a manifest value, conditions and subpaths included. */
  const targets = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(targets)
        : [];
  const missing = manifests.flatMap((file) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as Record<string, unknown>;
    const dir = dirname(file);
    return ["exports", "main", "module", "types", "bin"]
      .flatMap((key) => targets(manifest[key]))
      .filter((target) => !target.includes("*"))
      .map((target) => join(dir, target))
      .filter((path) => !tracked.has(path) && !path.split("/").includes("dist"));
  });
  expect(missing).toEqual([]);
});
