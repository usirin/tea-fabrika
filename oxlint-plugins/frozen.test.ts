// Today's version's frozen paths, named once in frozen.mjs (decision 0525), and the checks that
// leave them out. The answers are written apart from frozen.mjs.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import * as fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { oxfmtArgs } from "./format.ts";
import { frozen, livePackages, liveRoots, shared } from "./frozen.mjs";
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
  const root = join(tmpdir(), "repo");
  const listed = WORKSPACE.map((p) => ({ ...p, path: join(root, p.path) }));
  expect(livePackages(listed, root)).toEqual(LIVE);
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

it("S8: scenario: pnpm typecheck runs each live package's typecheck and no frozen one's", () => {
  // scenario: scripts/typecheck.sh with a stand-in pnpm first on PATH. It answers `pnpm ls` with
  // the vector above, laid at this checkout, and records every other call. Nothing is type-checked.
  const bin = mkdtempSync(join(tmpdir(), "typecheck-pnpm-"));
  temps.push(bin);
  const log = join(bin, "calls.jsonl");
  const listed = JSON.stringify(WORKSPACE.map((p) => ({ ...p, path: join(ROOT, p.path) })));
  writeFileSync(
    join(bin, "pnpm"),
    [
      `#!${process.execPath}`,
      'const { appendFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      `if (args[0] === "ls") { process.stdout.write(${JSON.stringify(listed)}); process.exit(0); }`,
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "pnpm"), 0o755);
  const ran = spawnSync("sh", ["scripts/typecheck.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: [bin, process.env["PATH"]].join(delimiter) },
  });
  expect(ran.status, `${ran.stdout}${ran.stderr}`).toBe(0);
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as readonly string[]);
  const filters = (args: readonly string[]) =>
    args.flatMap((arg, i) =>
      arg.startsWith("--filter=") ? [arg.slice(9)] : arg === "--filter" ? [args[i + 1] ?? ""] : [],
    );
  const recursive = calls.filter((args) => args.includes("-r") || args.includes("--recursive"));
  expect(recursive.length).toBeGreaterThan(0);

  for (const args of recursive) {
    expect(args).toContain("typecheck");
    expect(
      filters(args)
        .map((f) => f.replace(/^\.\//, ""))
        .sort(),
    ).toEqual([...LIVE].sort());
  }
});
