// p32 and p65, strict layers (docs/plan/tier-1-detail.md, "Strict layers"). `pnpm lint:layers`
// (code-graph, `layer-rules.json`) fails an upward import. This test catches what code-graph cannot
// yet: an import that skips a layer, and which package names each part may import. Its
// skipped-layer half goes when demlik issue 763 lands. Written by the exam (Tier 1, P1).
//
// A folder of the same package is named by its folder, another package by its import name, so the
// exports map carries the rule across. `next/apps/*` has no row: it is the wiring. A program's
// files that its `.` export reaches are what the box loads; the rest of the program is its window.
//
// A library file's part is read from the rule file's rows (`layer-rules.json`), the list `pnpm
// lint:layers` reads too, so the exam keeps no second list of the library's paths (ticket 477, PR
// 0). `rows.ts` picks the row the way code-graph does, and `rowParts` maps a row to its part. A
// library file under `src/` that no row claims fails: it cannot pass by having no row.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { type Row, rowsAt } from "./rows.ts";

const NEXT = resolve(import.meta.dirname, "../../../..");

/** The layer of each row that names one, by row name. A row with no `layer` has none here. */
const layersByName = (rows: ReadonlyArray<Row>): ReadonlyMap<string, number> =>
  new Map(rows.flatMap((row) => (row.layer === undefined ? [] : [[row.name, row.layer] as const])));

// The reader. Each exam file stands alone and carries its own copy, since a shared helper file
// would export names only tests call, which `pnpm lint:dead` refuses. An import is found by reading
// text: a line that starts with `import` or `export` and names a `from`, a line that is only
// `import` and a quoted name, or a dynamic import call with a quoted name. Planted code is written
// as one-line strings, so no line of an exam file starts with a planted `import`.

const GROUPS = ["packages", "programs", "apps"] as const; // pnpm-workspace.yaml's next/ globs

const Names = Schema.optional(Schema.Record(Schema.String, Schema.String));

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  sideEffects: Schema.optional(Schema.Unknown),
  scripts: Names,
  exports: Schema.optional(Schema.Unknown),
  dependencies: Names,
  devDependencies: Names,
  peerDependencies: Names,
  optionalDependencies: Names,
});

type Package = {
  readonly dir: string;
  readonly group: (typeof GROUPS)[number];
  readonly manifest: typeof Manifest.Type;
};

const readManifest = Schema.decodeUnknownSync(Manifest);

/** Every package under `next`: a child folder of a group that holds a `package.json`. */
const packagesIn = (next: string): ReadonlyArray<Package> =>
  GROUPS.flatMap((group) => {
    const folder = join(next, group);

    if (!existsSync(folder)) {
      return [];
    }

    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")))
      .map((entry) => ({
        dir: join(folder, entry.name),
        group,
        manifest: readManifest(JSON.parse(readFileSync(join(folder, entry.name, "package.json"), "utf8"))),
      }));
  });

/** Every `.ts` and `.tsx` file below `dir`, leaving out `node_modules`, `dist` and dot folders. */
const codeFiles = (dir: string): ReadonlyArray<string> =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);

        if (!entry.isDirectory()) {
          return /\.tsx?$/.test(entry.name) ? [path] : [];
        }

        const skip = ["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".");
        return skip ? [] : codeFiles(path);
      });

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file);

const IMPORTS = [
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const importsIn = (text: string): ReadonlyArray<string> =>
  IMPORTS.flatMap((pattern) => [...text.matchAll(pattern)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])));

const importsInFile = (file: string): ReadonlyArray<string> => importsIn(readFileSync(file, "utf8"));

const isRelative = (spec: string): boolean => spec.startsWith(".");

/** `@kampus/libfabrika/transport` is `{name: "@kampus/libfabrika", subpath: "./transport"}`. */
const packageAt = (spec: string): { readonly name: string; readonly subpath: string } => {
  const parts = spec.split("/");
  const size = spec.startsWith("@") ? 2 : 1;
  const rest = parts.slice(size);
  return {
    name: parts.slice(0, size).join("/"),
    subpath: rest.length === 0 ? "." : `./${rest.join("/")}`,
  };
};

/** The file a relative import names, as Node and the bundlers find it, or where it points if none. */
const pointsAt = (from: string, spec: string): string => {
  const base = join(dirname(from), spec);
  const tries = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")];
  return tries.find((path) => existsSync(path) && statSync(path).isFile()) ?? base;
};

/** A package's `exports` map, each key with the file it points at. */
const exportMap = (pkg: Package): ReadonlyMap<string, string | undefined> => {
  const target = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return join(pkg.dir, value);
    }

    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    const conditions = new Map(Object.entries(value));
    return target(conditions.get("import") ?? conditions.get("default"));
  };
  const exports = pkg.manifest.exports;

  if (typeof exports !== "object" || exports === null) {
    return exports === undefined ? new Map() : new Map([[".", target(exports)]]);
  }

  const entries = Object.entries(exports);

  if (!entries.every(([key]) => key.startsWith("."))) {
    return new Map([[".", target(exports)]]);
  }

  return new Map(entries.map(([key, value]) => [key, target(value)]));
};

const ownerAt = (packages: ReadonlyArray<Package>, file: string): Package | undefined =>
  packages.find((pkg) => file.startsWith(`${pkg.dir}${sep}`));

/** A path as the messages show it: relative to `from`, with `/`. */
const shown = (from: string, file: string): string => relative(from, file).split(sep).join("/");

// Planted trees: each scan is seen to fire on a planted break before it is trusted on `next/`.
// A planter owns every tree its test plants. The test's scope removes them when the test ends (0061).
const planter = Effect.acquireRelease(
  Effect.sync(() => {
    const roots: Array<string> = [];
    const plant = (files: Readonly<Record<string, string | object>>): string => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));
      roots.push(root);

      for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
      }

      return root;
    };
    return { plant, roots };
  }),
  ({ roots }) =>
    Effect.sync(() => {
      for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
      }
    }),
);

const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;

/** A `package.json` the way p65 wants one; `extra` overrides or adds fields. */
const manifest = (name: string, extra: object = {}): object => ({
  name,
  version: "0.0.0",
  private: true,
  sideEffects: false,
  scripts: { typecheck: "tsc --noEmit" },
  exports: { ".": "./src/index.ts" },
  ...extra,
});

const LIBRARY = "@kampus/libfabrika";
const TUVAL = "@kampus/tuval";
// P14, p65's one outside package (docs/direction/fabrika-design-package.md): the window takes the design
// package's public names, its root and its stylesheet, and nothing deeper.
const DESIGN = "@kampus/fabrika-design";

// The transport front files a client reaches, one subpath each (the exports map's `./transport/*`), P14
// slice 2's three contracts and the Link machine among them: the same reach, file by file.
const TRANSPORT = [
  `${LIBRARY}/transport`,
  ...["Answer", "ClientKey", "ClientRows", "Hello", "Link", "Sshsig", "Webauthn", "Wire"].map(
    (front) => `${LIBRARY}/transport/${front}`,
  ),
];

// P18 L8: the one window client's front files, one subpath each (the exports map's `./client/*`).
// Tuval's window reaches the parent and the start through these and nothing deeper.
const CLIENT = ["WindowMachine", "WindowStart", "Headless"].map((front) => `${LIBRARY}/client/${front}`);

/** What each part may import beyond itself: the detail's table, as it stands. */
const allowed: Readonly<Record<string, ReadonlyArray<string>>> = {
  id: [],
  "id-test-support": ["id"],
  "libfabrika-entry": ["id", "transport", "data", "coordination", "app", "mcp", "door"],
  transport: ["id"],
  data: ["id"],
  coordination: ["data", "id"],
  app: ["coordination", "id"],
  node: ["app", "coordination", "data", "id", "desktop-core"],
  "desktop-core": ["app", "coordination", "data", "id"],
  workers: ["app", "coordination", "data", "transport", "id"],
  door: ["app", "coordination", "data", "transport", "id"], // P17a: the library's door composes all four
  mcp: ["app", "transport", "id"], // the named exception: the bridge is a client, as a window is
  client: ["app", "transport", "id"], // P18: the window client, the bridge's reach, beside the door
  desktop: [LIBRARY], // the app layer's names, nothing lower
  window: ["desktop", LIBRARY, ...TRANSPORT, ...CLIENT, DESIGN, `${DESIGN}/tokens.css`], // a window is a client (the note's T3); P14: and it takes the design's public names
  dom: ["desktop"],
  browser: ["dom", "desktop", ...TRANSPORT], // its key signs transport's helloText; P14: its layers meet transport's contracts
  electron: ["dom", "desktop", ...TRANSPORT, `${LIBRARY}/coordination`], // the menu bar signs what the door takes
  headless: ["desktop"],
  program: [LIBRARY], // `.`, what the box loads: no tuval and no React
  "program-window": [LIBRARY, TUVAL], // `./window`: public names only
};

/** The folders under `src/` of tuval, each a part above. The library's come from the rule file. */
const FOLDERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [TUVAL]: ["desktop", "window", "dom", "browser", "electron", "headless"],
};

/** The part each of the library's rows in the rule file is, in the table above. Modules, not the old parts. */
const rowParts: Readonly<Record<string, string>> = {
  "next-shared": "id",
  "next-id-test-support": "id-test-support",
  "next-libfabrika-entry": "libfabrika-entry",
  "next-transport": "transport",
  "next-telemetry": "data",
  "next-ledger": "data",
  "next-ci": "data",
  "next-codehost": "data",
  "next-repositories": "data",
  "next-settings": "data", // T664: layer 2 beside the ledger, and node/settings/ imports it
  "next-processes": "coordination",
  "next-presence": "coordination",
  // P39: the jobs module is coordination, so it may import data and id and nothing above them.
  "next-jobs": "coordination",
  "next-packs": "coordination",
  "next-access": "coordination",
  "next-runtime": "app",
  "next-mcp": "mcp",
  "next-client": "client",
  "next-door": "door",
  "next-desktop-core": "desktop-core",
  "next-schedules": "door", // T762: layer 6 beside the door; it imports only tea and effect today
  "next-node": "node",
  "next-workers": "workers",
};

// Files of the runtime module that stay coordination until old PR 13: three import the ledger, which
// the app part may not, and `coordination/index.ts` re-exports names that import it. Each is a prefix
// of a path below `src/`.
const stillCoordination: ReadonlyArray<string> = [
  "runtime/ProcessStore",
  "runtime/RecoveryStore",
  "runtime/internal/recovery",
  "coordination/index",
];

const RuleFile = Schema.Struct({
  layers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      paths: Schema.Array(Schema.String),
      layer: Schema.optionalKey(Schema.Number),
    }),
  ),
});

/** The rule file's rows, as `pnpm lint:layers` reads them. Their paths start at the top of the repo. */
const REAL: ReadonlyArray<Row> = Schema.decodeUnknownSync(RuleFile)(
  JSON.parse(readFileSync(resolve(NEXT, "../layer-rules.json"), "utf8")),
).layers;

/** A file's path as the rule file names it: `next` stands for the repo's `next/` folder. */
const ruled = (next: string, file: string): string => `next/${shown(next, file)}`;

const SRC = "next/packages/libfabrika/src/";

/**
 * The part of a library path (from the top of the repo), when exactly one row claims it and that row
 * is mapped by `parts`. A runtime file in `stillCoordination` reads as coordination.
 */
const partOfPath = (rows: ReadonlyArray<Row>, path: string, parts: Readonly<Record<string, string>>): string | null => {
  const [row, ...more] = rowsAt(rows, path);
  const part = row === undefined || more.length > 0 ? null : (parts[row] ?? null);
  return part === "app" && stillCoordination.some((own) => path.startsWith(`${SRC}${own}`)) ? "coordination" : part;
};

const libraryPart = (
  rows: ReadonlyArray<Row>,
  next: string,
  file: string,
  parts: Readonly<Record<string, string>>,
): string | null => partOfPath(rows, ruled(next, file), parts);

/** The files a program's `.` export reaches by relative imports: what the box loads. */
const boxFor = (pkg: Package): ReadonlySet<string> => {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) {
      return;
    }

    seen.add(file);

    for (const spec of importsInFile(file).filter(isRelative)) {
      const next = pointsAt(file, spec);

      if (existsSync(next) && statSync(next).isFile()) {
        walk(next);
      }
    }
  };
  const entry = exportMap(pkg).get(".");

  if (entry !== undefined && existsSync(entry)) {
    walk(entry);
  }

  return seen;
};

/** The folder under `src/` a library file sits in, or null for an entry file at `src/` itself. */
const folderAt = (pkg: Package, file: string): string | null => {
  const src = join(pkg.dir, "src");

  if (!file.startsWith(`${src}${sep}`)) {
    return null;
  }

  const inside = file.slice(src.length + 1).split(sep);
  return inside.length === 1 ? null : (inside[0] ?? null);
};

/** The part a file of `pkg` belongs to, or null when the table has no row for it. */
const partAt = (
  rows: ReadonlyArray<Row>,
  next: string,
  pkg: Package,
  box: ReadonlySet<string>,
  file: string,
  parts: Readonly<Record<string, string>>,
): string | null => {
  if (pkg.group === "programs") {
    return box.has(file) ? "program" : "program-window";
  }

  if (pkg.manifest.name === LIBRARY) {
    return libraryPart(rows, next, file, parts);
  }

  const folder = folderAt(pkg, file);
  return folder !== null && FOLDERS[pkg.manifest.name]?.includes(folder) === true ? folder : null;
};

/** Every import in `next` that breaks the table, or that the library makes upward. */
const faults = (
  next: string,
  rows: ReadonlyArray<Row> = REAL,
  parts: Readonly<Record<string, string>> = rowParts,
): ReadonlyArray<string> => {
  const packages = packagesIn(next);
  const above = new Set(
    packages.filter((pkg) => pkg.group !== "packages" || pkg.manifest.name === TUVAL).map((pkg) => pkg.manifest.name),
  );
  return codeFiles(next).flatMap((file) => {
    const pkg = ownerAt(packages, file);

    if (pkg === undefined) {
      return [];
    }

    const location = shown(next, file);
    const found: Array<string> = [];

    // Across the whole library, tests included: nothing imports tuval, a program or the app.
    if (pkg.manifest.name === LIBRARY) {
      for (const spec of importsInFile(file).filter((s) => !isRelative(s))) {
        if (above.has(packageAt(spec).name)) {
          found.push(`${location} imports "${spec}": the library imports nothing above it`);
        }
      }
    }

    if (isTest(file)) {
      return found;
    }

    const folders = FOLDERS[pkg.manifest.name];
    const folder = folderAt(pkg, file);

    if (folders !== undefined && folder !== null && !folders.includes(folder)) {
      return [...found, `${location}: the folder "${folder}" has no row in the exam's table`];
    }

    const part = partAt(rows, next, pkg, pkg.group === "programs" ? boxFor(pkg) : new Set(), file, parts);

    // A library file under `src/` needs exactly one row, and that row must be a part of the table.
    if (part === null && pkg.manifest.name === LIBRARY && file.startsWith(`${join(pkg.dir, "src")}${sep}`)) {
      const claimed = rowsAt(rows, ruled(next, file));
      const message =
        folder !== null && claimed.length === 0
          ? `the folder "${folder}" has no row in the exam's table`
          : `the rule file's rows that claim it are [${claimed.join(", ")}], and a library file needs exactly one that is a part`;
      return [...found, `${location}: ${message}`];
    }

    if (part === null) {
      return found;
    } // the wiring, or an entry file at src/

    const may = allowed[part] ?? [];

    for (const spec of importsInFile(file)) {
      if (isRelative(spec)) {
        if (pkg.group === "programs") {
          continue;
        } // a program's own files, box and window alike

        const target = pointsAt(file, spec);

        if (!target.startsWith(`${pkg.dir}${sep}`)) {
          continue;
        } // leaving the package: deps.test.ts

        const there = partAt(rows, next, pkg, new Set(), target, parts) ?? "an entry file";

        if (there !== part && !may.includes(there)) {
          found.push(`${location} imports "${spec}": ${part} may not import ${there}`);
        }
      } else if (packageAt(spec).name.startsWith("@kampus/") && !may.includes(spec)) {
        found.push(`${location} imports "${spec}": ${part} may not import it`);
      }
    }

    return found;
  });
};

describe("the real next/", () => {
  it("keeps every part to the imports the table allows", () => {
    expect(faults(NEXT)).toEqual([]);
  });
});

describe("planted breaks", () => {
  it.effect("P17a: the gateway composes lower parts; lower parts cannot import it", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      // A module and the part the exam reads it as.
      const lower = [
        ["runtime", "app"],
        ["processes", "coordination"],
        ["ledger", "data"],
        ["transport", "transport"],
      ] as const;
      const tree = plant({
        "packages/libfabrika/package.json": manifest(LIBRARY),
        "packages/libfabrika/src/gateway/Gateway.ts": lines(
          'import {run} from "../runtime/Runner.ts";',
          'import {member} from "../processes/Process.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        ...Object.fromEntries(
          lower.map(([module]) => [
            `packages/libfabrika/src/${module}/Up.ts`,
            lines('import {Gateway} from "../gateway/Gateway.ts";'),
          ]),
        ),
      });
      expect([...faults(tree)].sort()).toEqual(
        lower
          .map(
            ([module, part]) =>
              `packages/libfabrika/src/${module}/Up.ts imports "../gateway/Gateway.ts": ${part} may not import door`,
          )
          .sort(),
      );
    }),
  );
  // scenario: P18 L8, two fixed imports probe the client's row: the library imports nothing above it,
  // and no module below the client imports it.
  it.effect(
    "P18 L8: the client takes runtime, transport and Id, may not import tuval, and transport may not import it",
    () =>
      Effect.gen(function* () {
        const { plant } = yield* planter;
        const tree = plant({
          "packages/libfabrika/package.json": manifest(LIBRARY),
          "packages/libfabrika/src/client/WindowStart.ts": lines(
            'import {Client} from "../runtime/Client.ts";',
            'import {Link} from "../transport/Link.ts";',
            'import {Generator} from "../Id.ts";',
            'import {mount} from "@kampus/tuval";',
          ),
          "packages/libfabrika/src/transport/Dial.ts": lines('import {start} from "../client/WindowStart.ts";'),
          "packages/libfabrika/src/runtime/Client.ts": lines("export const Client = 1;"),
          "packages/libfabrika/src/transport/Link.ts": lines("export const Link = 1;"),
          "packages/tuval/package.json": manifest(TUVAL),
          "packages/tuval/src/index.ts": lines("export const mount = 1;"),
        });
        expect([...faults(tree)].sort()).toEqual(
          [
            'packages/libfabrika/src/client/WindowStart.ts imports "@kampus/tuval": the library imports nothing above it',
            'packages/libfabrika/src/client/WindowStart.ts imports "@kampus/tuval": client may not import it',
            'packages/libfabrika/src/transport/Dial.ts imports "../client/WindowStart.ts": transport may not import client',
          ].sort(),
        );
      }),
  );
  const lib = (extra: object = {}) =>
    manifest(LIBRARY, {
      exports: {
        ".": "./src/index.ts",
        "./transport/*": "./src/transport/*.ts",
        "./transport/internal/*": null,
        "./ledger/*": "./src/ledger/*.ts",
        "./ledger/internal/*": null,
        "./access/*": "./src/access/*.ts",
        "./access/internal/*": null,
      },
      ...extra,
    });
  const planted = planter.pipe(
    Effect.map(({ plant }) =>
      plant({
        "packages/libfabrika/package.json": lib(),
        "packages/libfabrika/src/index.ts": lines('export {run} from "./runtime/Runner.ts";'),
        "packages/libfabrika/src/transport/Wire.ts": lines('import {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/ledger/Log.ts": lines('import {view} from "@kampus/tuval";'),
        "packages/libfabrika/src/ledger/Log.test.ts": lines('import {counter} from "@kampus/counter";'),
        "packages/libfabrika/src/processes/Mailbox.ts": lines('import {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/runtime/Runner.ts": lines(
          'import {mailbox} from "../processes/Mailbox.ts";',
          'import {log} from "../ledger/Log.ts";',
        ),
        "packages/libfabrika/src/mcp/tools.ts": lines(
          'import {run} from "../runtime/Runner.ts";',
          'import type {Wire} from "../transport/Wire.ts";',
        ),
        "packages/libfabrika/src/sync/Merge.ts": lines("export const merge = 1;"),
        "packages/tuval/package.json": manifest(TUVAL),
        "packages/tuval/src/index.ts": lines('export {fold} from "./desktop/fold.ts";'),
        "packages/tuval/src/desktop/layout.ts": lines('import {run} from "@kampus/libfabrika";'),
        "packages/tuval/src/desktop/fold.ts": lines('import {log} from "@kampus/libfabrika/data";'),
        "packages/tuval/src/window/main.ts": lines(
          'import {layout} from "../desktop/layout.ts";',
          'import {wire} from "@kampus/libfabrika/transport";',
        ),
        // P14 slice 2 (L19): the window takes the link and the design package, never a browser layer; the
        // browser layers take transport's contracts, never the design package.
        "packages/tuval/src/window/machine.ts": lines(
          'import {Link} from "@kampus/libfabrika/transport/Link";',
          'import {Client} from "@kampus/libfabrika";',
          'import {themes} from "@kampus/fabrika-design";',
          'import {key} from "../browser/key.ts";',
        ),
        "packages/tuval/src/browser/rows.ts": lines(
          'import {ClientRows} from "@kampus/libfabrika/transport/ClientRows";',
          'import {Client} from "@kampus/libfabrika";',
          'import {themes} from "@kampus/fabrika-design";',
        ),
        "packages/tuval/src/dom/root.ts": lines('import {layout} from "../desktop/layout.ts";'),
        "packages/tuval/src/browser/key.ts": lines(
          'import {root} from "../dom/root.ts";',
          'import {wire} from "@kampus/libfabrika/transport";',
        ),
        "packages/tuval/src/electron/menu.ts": lines('import {grant} from "@kampus/libfabrika/coordination";'),
        "packages/tuval/src/headless/run.ts": lines('import {main} from "../window/main.ts";'),
        "programs/notes/package.json": manifest("@kampus/notes", {
          exports: { ".": "./src/program.ts", "./window": "./src/view.tsx" },
        }),
        "programs/notes/src/program.ts": lines(
          'import {root} from "./root.ts";',
          'import {defineProgram} from "@kampus/libfabrika";',
        ),
        "programs/notes/src/root.ts": lines('import {send} from "@kampus/tuval";'),
        "programs/notes/src/view.tsx": lines(
          'import {notes} from "./program.ts";',
          'import {useModel} from "@kampus/tuval";',
        ),
        "programs/notes/src/tile.ts": lines('import {wire} from "@kampus/libfabrika/transport";'),
        "programs/counter/package.json": manifest("@kampus/counter"),
        "programs/counter/src/index.ts": lines('import {defineProgram} from "@kampus/libfabrika";'),
        "apps/fabrika/package.json": manifest("@kampus/fabrika"),
        "apps/fabrika/src/brain.ts": lines(
          'import {log} from "@kampus/libfabrika/data";',
          'import {fold} from "@kampus/tuval";',
        ),
      }),
    ),
  );

  // Everything else in the tree is clean, the named exceptions included: mcp, the window, the
  // browser key and the electron menu reach transport; the menu reaches coordination; a program's
  // window imports its own program; the app imports anything.
  // scenario: fixed imports probe the strict-layer table's allowed and refused package names.
  it.effect("fires on each planted break, and on nothing else", () =>
    Effect.gen(function* () {
      const tree = yield* planted;
      expect([...faults(tree)].sort()).toEqual(
        [
          'packages/libfabrika/src/transport/Wire.ts imports "../ledger/Log.ts": transport may not import data',
          'packages/libfabrika/src/ledger/Log.ts imports "@kampus/tuval": the library imports nothing above it',
          'packages/libfabrika/src/ledger/Log.ts imports "@kampus/tuval": data may not import it',
          'packages/libfabrika/src/ledger/Log.test.ts imports "@kampus/counter": the library imports nothing above it',
          'packages/libfabrika/src/runtime/Runner.ts imports "../ledger/Log.ts": app may not import data',
          'packages/libfabrika/src/sync/Merge.ts: the folder "sync" has no row in the exam\'s table',
          'packages/tuval/src/desktop/fold.ts imports "@kampus/libfabrika/data": desktop may not import it',
          'packages/tuval/src/headless/run.ts imports "../window/main.ts": headless may not import window',
          'packages/tuval/src/window/machine.ts imports "../browser/key.ts": window may not import browser',
          'packages/tuval/src/browser/rows.ts imports "@kampus/libfabrika": browser may not import it',
          'packages/tuval/src/browser/rows.ts imports "@kampus/fabrika-design": browser may not import it',
          'programs/notes/src/root.ts imports "@kampus/tuval": program may not import it',
          'programs/notes/src/tile.ts imports "@kampus/libfabrika/transport": program-window may not import it',
        ].sort(),
      );
    }),
  );
});

// Ticket 477, PR 0: the laws of the row reader. Fixed seed, as the lead scripts' laws use.
const options = { seed: 119120, numRuns: 500 };

describe("the rule file's rows give a file its part", () => {
  // The tool's rule, written a second way, by segments and with no regex over the whole path, so
  // the reader is checked against the rule and not against itself.
  const one = (segment: string, name: string): boolean => {
    const [head = "", ...rest] = segment.split("*");

    if (rest.length === 0) {
      return head === name;
    }

    let at = head.length;

    if (!name.startsWith(head)) {
      return false;
    }

    for (const piece of rest.slice(0, -1)) {
      const next = name.indexOf(piece, at);

      if (next < 0) {
        return false;
      }

      at = next + piece.length;
    }

    const tail = rest.at(-1) ?? "";
    return name.length - tail.length >= at && name.endsWith(tail) && name.length > 0;
  };
  const claims = (pattern: ReadonlyArray<string>, path: ReadonlyArray<string>): boolean => {
    const [segment, ...rest] = pattern;

    if (segment === undefined) {
      return true;
    }

    if (segment === "**") {
      return claims(rest, path) || (path.length > 0 && claims(pattern, path.slice(1)));
    }

    const [name, ...below] = path;
    return name !== undefined && one(segment, name) && claims(rest, below);
  };
  const weight = (pattern: string): number => {
    const segments = pattern.split("/");
    const count = (keep: (segment: string) => boolean) => segments.filter(keep).length;
    // Three numbers compared in order. Each is under 1,000 here, so one number holds them.
    return (
      count((s) => s !== "**") * 1_000_000 +
      count((s) => !s.includes("*")) * 1_000 +
      [...pattern].filter((c) => c !== "*" && c !== "/").length
    );
  };
  const expected = (rows: ReadonlyArray<Row>, path: string): ReadonlyArray<string> => {
    const found = rows.flatMap((row) =>
      row.paths
        .filter((pattern) => claims(pattern.split("/"), path.split("/")))
        .map((pattern) => ({ name: row.name, weight: weight(pattern) })),
    );
    const top = Math.max(...found.map((f) => f.weight));
    return [...new Set(found.filter((f) => f.weight === top).map((f) => f.name))].sort();
  };

  const folder = fc.constantFrom("src", "app", "data", "door", "runtime", "internal");
  const file = fc.constantFrom("Log.ts", "log.ts", "index.ts", "ProcessStore.ts", "Log.test.ts");
  const segment = fc.oneof(
    { arbitrary: folder, weight: 6 },
    { arbitrary: fc.constantFrom("*", "**", "d*", "*a", "*t*"), weight: 2 },
  );
  const pattern = fc
    .tuple(
      fc.array(segment, { minLength: 1, maxLength: 4 }),
      fc.option(fc.oneof(file, fc.constantFrom("*.ts", "ProcessStore*", "*.test.ts")), {
        nil: undefined,
      }),
    )
    .map(([folders, last]) => [...folders, ...(last === undefined ? [] : [last])].join("/"));
  const rows: fc.Arbitrary<ReadonlyArray<Row>> = fc
    .array(fc.array(pattern, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 })
    .map((each) => each.map((paths, n) => ({ name: `row-${n}`, paths })));
  const path = fc
    .tuple(fc.array(folder, { minLength: 1, maxLength: 4 }), file)
    .map(([folders, last]) => [...folders, last].join("/"));

  // Plant: pick the first row whose pattern matches, in the rule file's order, and not the most
  // specific. Then `src/runtime/ProcessStore*` in a later row loses to `src/runtime` in an earlier
  // one, and a file the plan keeps in coordination reads as app.
  it("the rows for a file are the ones code-graph's rule gives, for any rows and any path", () => {
    fc.assert(
      fc.property(fc.tuple(rows, path), ([given, at]) => {
        expect([...rowsAt(given, at)].sort()).toEqual(expected(given, at));
      }),
      {
        ...options,
        numRuns: 3000,
        examples: [
          // pinned: the plan's own case (ticket 477, PR 5). The longer pattern is in the later row.
          [
            [
              [
                { name: "row-0", paths: ["src/runtime"] },
                { name: "row-1", paths: ["src/runtime/ProcessStore*"] },
              ],
              "src/runtime/ProcessStore.ts",
            ],
          ],
        ],
      },
    );
  });

  // Plant: the same as above. The order of the rows, and of the paths in a row, changes nothing.
  it("the answer does not depend on the order of the rows", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(rows, path)
          .chain(([given, at]) =>
            fc.tuple(fc.constant(given), fc.shuffledSubarray([...given], { minLength: given.length }), fc.constant(at)),
          ),
        ([given, shuffled, at]) => {
          expect([...rowsAt(shuffled, at)].sort()).toEqual([...rowsAt(given, at)].sort());
        },
      ),
      options,
    );
  });

  // The exam's part for a file is the row's part, `rowParts` says which, and a runtime file in
  // `stillCoordination` reads as coordination. Rows are named as the real ones, so each maps.
  // Plant: pick the first matching row, in the rule file's order, and not the most specific; or leave
  // the `runtime` row's part out of `rowParts`.
  it("the part of a path is the part of the module code-graph gives it, for any rows and any path", () => {
    const top = SRC.slice(0, -1);
    const moduleFolder = fc.constantFrom("runtime", "internal", "coordination", "ledger", "processes", "gateway");
    const moduleFile = fc.constantFrom(
      "Log.ts",
      "index.ts",
      "ProcessStore.ts",
      "recovery.ts",
      "RecoveryStore.test.ts",
      "Runner.ts",
    );
    const modulePattern = fc
      .tuple(
        fc.array(
          fc.oneof({ arbitrary: moduleFolder, weight: 6 }, { arbitrary: fc.constantFrom("*", "**", "r*"), weight: 1 }),
          { minLength: 0, maxLength: 3 },
        ),
        fc.option(fc.oneof(moduleFile, fc.constantFrom("*.ts", "ProcessStore*", "recovery*")), { nil: undefined }),
      )
      .filter(([folders, last]) => folders.length > 0 || last !== undefined)
      .map(([folders, last]) => [top, ...folders, ...(last === undefined ? [] : [last])].join("/"));
    const named: fc.Arbitrary<ReadonlyArray<Row>> = fc
      .array(fc.array(modulePattern, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 })
      .map((each) => each.map((paths, n) => ({ name: Object.keys(rowParts)[n] ?? "none", paths })));
    const at = fc
      .tuple(fc.array(moduleFolder, { minLength: 0, maxLength: 3 }), moduleFile)
      .map(([folders, last]) => [top, ...folders, last].join("/"));
    const partExpected = (given: ReadonlyArray<Row>, path: string): string | null => {
      const rows = expected(given, path);
      const part = rows.length === 1 ? (rowParts[rows[0] ?? ""] ?? null) : null;
      const rest = path.slice(SRC.length);
      return part === "app" && stillCoordination.some((own) => rest.startsWith(own)) ? "coordination" : part;
    };

    fc.assert(
      fc.property(fc.tuple(named, at), ([given, path]) => {
        expect(partOfPath(given, path, rowParts)).toBe(partExpected(given, path));
      }),
      {
        ...options,
        numRuns: 3000,
        examples: [
          // pinned: the plan's case (ticket 477). The runtime row claims the folder and a longer file
          // pattern in a later row claims the store, which stays coordination.
          [
            [
              [
                { name: "next-runtime", paths: [`${top}/runtime`] },
                { name: "next-processes", paths: [`${top}/runtime/ProcessStore*`] },
              ],
              `${top}/runtime/ProcessStore.ts`,
            ],
          ],
        ],
      },
    );
  });

  // The files that stay coordination, by their prefix, whatever follows it. Plant: empty
  // `stillCoordination`. Then `runtime/ProcessStore.ts` reads as app, and the ledger import it makes
  // is a fault.
  it("the runtime files that import the ledger, and the coordination barrel, read as coordination", () => {
    // `coordination/index.ts` is one file; the runtime ones are a name and what may follow it.
    const own = stillCoordination.flatMap((prefix) =>
      (prefix.startsWith("runtime/") ? ["", ".ts", ".test.ts", "Spec.ts"] : [".ts"]).map((rest) => `${prefix}${rest}`),
    );
    fc.assert(
      fc.property(fc.constantFrom(...own), fc.constantFrom("", ".ts", ".test.ts", "Spec.ts"), (file, rest) => {
        expect(partOfPath(REAL, `${SRC}${file}`, rowParts)).toBe("coordination");
        expect(partOfPath(REAL, `${SRC}runtime/Runner${rest}`, rowParts)).toBe("app");
      }),
      options,
    );
  });

  // vector: answers of code-graph 0.15.0 on the real rule file, worked out from its built source
  // (`src/layers/classify.ts`), since `pnpm lint:layers` runs that tool on these same rows and the
  // exam must name the same row. A file pattern beats its folder, a deeper folder beats a higher
  // one, and a folder claims only at a `/`.
  it("vector: the real rule file gives the rows code-graph gives", () => {
    expect(rowsAt(REAL, "packages/fabrika/src/agents/claude.ts")).toEqual(["fabrika-entry"]);
    expect(rowsAt(REAL, "packages/fabrika/src/agents/claude/rules.ts")).toEqual(["fabrika-agents"]);
    expect(rowsAt(REAL, "packages/pipeline/src/laws/explore.ts")).toEqual(["own-search"]);
    expect(rowsAt(REAL, "packages/pipeline/src/laws/walk.ts")).toEqual(["pipeline"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/Testing.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/runtime/Runner.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/runtime/ProcessStore.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/coordination/index.ts")).toEqual(["next-runtime"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/gateway/internal/waiting.ts")).toEqual(["next-door"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/cloudflare/runtime.ts")).toEqual(["next-workers"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/telemetry/internal/measurements.ts")).toEqual(["next-telemetry"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/jobs/internal/job.ts")).toEqual(["next-jobs"]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/data/index.ts")).toEqual([]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/apple/runner.ts")).toEqual([]);
    expect(rowsAt(REAL, "next/packages/libfabrika/src/testing.tsx")).toEqual([]);
  });
});

describe("every library file has exactly one row", () => {
  const under = "next/packages/libfabrika/src/";
  /** The library's folders the real rule file names: every row's folder pattern under `src/`. */
  const folders = REAL.flatMap((row) => row.paths)
    .filter((pattern) => pattern.startsWith(under) && !pattern.endsWith(".ts") && !pattern.includes("*"))
    .map((pattern) => pattern.slice(under.length));
  const tops = ["id", "testing", "index", "processid", "sql", "rev"];
  const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,8}$/);
  // A Mac's disk ignores case, so a made-up name may not differ from a real one by case alone.
  const unlisted = (taken: ReadonlyArray<string>) => name.filter((n) => !taken.includes(n.toLowerCase()));

  // Plant: let a library file with no row pass, as the reader did before for a file at the top of
  // `src/` (it answered "an entry file" and checked nothing). Then `src/sync/Merge.ts` and a new
  // top file import anything.
  it.effect("a file in a row's folder has one row; a file no row claims fails, wherever it is", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      fc.assert(
        fc.property(
          fc.constantFrom(...folders),
          fc.constantFrom("", "internal/"),
          name,
          unlisted(folders),
          unlisted(tops),
          (folder, inner, file, stray, loose) => {
            const src = "packages/libfabrika/src";
            const tree = plant({
              "packages/libfabrika/package.json": manifest(LIBRARY),
              [`${src}/${folder}/${inner}${file}.ts`]: lines("export const a = 1;"),
              [`${src}/${stray}/${inner}${file}.ts`]: lines("export const a = 1;"),
              [`${src}/${stray}/${file}.test.ts`]: lines("export const a = 1;"),
              [`${src}/${loose}.ts`]: lines("export const a = 1;"),
              [`${src}/${loose}.test.ts`]: lines("export const a = 1;"),
            });

            expect(rowsAt(REAL, `next/${src}/${folder}/${inner}${file}.ts`)).toHaveLength(1);
            // Which files fail, not what the message says.
            expect(
              faults(tree)
                .map((fault) => fault.split(/:| imports /)[0])
                .sort(),
            ).toEqual([`${src}/${stray}/${inner}${file}.ts`, `${src}/${loose}.ts`].sort());
          },
        ),
        {
          ...options,
          numRuns: 60,
          // pinned: the plan's plant (ticket 477), a new folder with no row, and a new top file.
          examples: [["ledger", "", "Merge", "sync", "Loose"]],
        },
      );
    }),
  );

  // scenario: two rows that claim one file equally, since code-graph stops on that file and names
  // no row, and the exam must not pick one for it.
  it.effect("scenario: a file two rows claim equally fails", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        "packages/libfabrika/package.json": manifest(LIBRARY),
        "packages/libfabrika/src/ledger/Log.ts": lines("export const a = 1;"),
      });
      const twice = [...REAL, { name: "next-runtime", paths: ["next/packages/libfabrika/src/ledger"] }];
      expect(faults(tree)).toEqual([]);
      expect(faults(tree, twice)).toHaveLength(1);
    }),
  );
});

describe("planted breaks in the module folders", () => {
  // The rule file has a row per module, and the exam maps each row to its part (`rowParts`). Reading
  // `runtime` as the coordination part is the plant.
  const asCoordination = { ...rowParts, "next-runtime": "coordination" };
  const planted = planter.pipe(
    Effect.map(({ plant }) =>
      plant({
        "packages/libfabrika/package.json": manifest(LIBRARY),
        "packages/libfabrika/src/Id.ts": lines("export const id = 1;"),
        "packages/libfabrika/src/telemetry/Sink.ts": lines('import {id} from "../Id.ts";'),
        "packages/libfabrika/src/ledger/Log.ts": lines('import {sink} from "../telemetry/Sink.ts";'),
        "packages/libfabrika/src/ledger/Ledger.ts": lines('import {mailbox} from "../processes/Mailbox.ts";'),
        "packages/libfabrika/src/transport/Wire.ts": lines('import {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/processes/Mailbox.ts": lines(
          'import {log} from "../ledger/Log.ts";',
          'import {Gateway} from "../gateway/Gateway.ts";',
        ),
        "packages/libfabrika/src/access/Access.ts": lines(
          'import {mailbox} from "../processes/Mailbox.ts";',
          'import {run} from "../runtime/Runner.ts";',
        ),
        "packages/libfabrika/src/runtime/Runner.ts": lines(
          'import {mailbox} from "../processes/Mailbox.ts";',
          'import {store} from "./ProcessStore.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        "packages/libfabrika/src/runtime/ProcessStore.ts": lines('import {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/runtime/RecoveryStore.ts": lines('import {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/runtime/internal/recovery.ts": lines('import {log} from "../../ledger/Log.ts";'),
        "packages/libfabrika/src/runtime/internal/supervisor.ts": lines('import {log} from "../../ledger/Log.ts";'),
        "packages/libfabrika/src/coordination/index.ts": lines('export {log} from "../ledger/Log.ts";'),
        "packages/libfabrika/src/gateway/Gateway.ts": lines(
          'import {run} from "../runtime/Runner.ts";',
          'import {members} from "../access/Access.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        "packages/libfabrika/src/gateway/internal/waiting.ts": lines('import {wire} from "../../transport/Wire.ts";'),
      }),
    ),
  );

  // scenario: each line is one named wall of today's table, met in a module folder, since the modules
  // must leave every wall standing: the ledger may not import processes, transport may not import
  // the ledger, processes and access may not import the gateway or the runtime, and the runtime may
  // not import the ledger or transport. Three runtime files and `coordination/index.ts` stay
  // coordination, so their ledger imports pass until old PR 13 cuts them.
  // Plant: map `runtime` to the coordination part (`asCoordination`). Then the runner's ledger and
  // transport imports pass, and the tree's faults change.
  it.effect("scenario: every upward or skipped-part import fires in the module folders, and nothing else", () =>
    Effect.gen(function* () {
      const tree = yield* planted;
      const at = (file: string) => `packages/libfabrika/src/${file}`;
      expect([...faults(tree)].sort()).toEqual(
        [
          `${at("ledger/Ledger.ts")} imports "../processes/Mailbox.ts": data may not import coordination`,
          `${at("transport/Wire.ts")} imports "../ledger/Log.ts": transport may not import data`,
          `${at("processes/Mailbox.ts")} imports "../gateway/Gateway.ts": coordination may not import door`,
          `${at("access/Access.ts")} imports "../runtime/Runner.ts": coordination may not import app`,
          `${at("runtime/Runner.ts")} imports "../ledger/Log.ts": app may not import data`,
          `${at("runtime/Runner.ts")} imports "../transport/Wire.ts": app may not import transport`,
          `${at("runtime/internal/supervisor.ts")} imports "../../ledger/Log.ts": app may not import data`,
        ].sort(),
      );
      expect(faults(tree, REAL, asCoordination)).not.toEqual(faults(tree));
    }),
  );

  // scenario: the real rule file claims every module folder, since a move must not land ahead of its
  // rule file change: a file planted in a module folder always has a row.
  it.effect("scenario: on the real rule file every module folder has a row", () =>
    Effect.gen(function* () {
      const tree = yield* planted;
      const unclaimed = faults(tree)
        .filter((fault) => !fault.includes(" imports "))
        .map((fault) => fault.split(": ")[0]);
      expect(unclaimed).toEqual([]);
    }),
  );

  // scenario: the patched code-graph reads a package import by its subpath (demlik issue 915), since
  // `--layers` once mapped every import of a workspace package to the alphabetically first `exports`
  // file. Package `a` exports `.` as `src/index.ts` and `./low` as `src/aaa-low.ts`, which sorts
  // first. `b` imports `"a"`, the root, and sits below `aaa-low.ts` and above `index.ts`. The
  // patched tool reads the import as `index.ts`, a downward edge, so no upward site shows.
  // Plant: drop the patch. `packageSourceEntry` then sorts `./src/aaa-low.ts` before
  // `./src/index.ts`, `b` reads as importing the high row, and the tool reports 1 UP and exits 1.
  it.effect("scenario: a root import of a package reads the root file, not its first-sorting subpath", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const root = plant({
        "package.json": { name: "plant", private: true, workspaces: ["pkgs/*"] },
        "pnpm-workspace.yaml": 'packages:\n  - "pkgs/*"\n',
        "pkgs/a/package.json": { name: "a", exports: { ".": "./src/index.ts", "./low": "./src/aaa-low.ts" } },
        "pkgs/a/src/aaa-low.ts": "export const low = 1;\n",
        "pkgs/a/src/index.ts": "export const root = 1;\n",
        "pkgs/b/package.json": { name: "b" },
        "pkgs/b/src/b.ts": 'import { root } from "a";\nexport const b = root;\n',
        "rules.json": {
          layers: [
            { name: "high", paths: ["pkgs/a/src/aaa-low.ts"] },
            { name: "mid", paths: ["pkgs/b"] },
            { name: "low", paths: ["pkgs/a/src/index.ts"] },
          ],
        },
      });
      const bin = resolve(NEXT, "..", "node_modules", ".bin", "code-graph");
      const run = spawnSync(bin, [".", "--layers", "--layer-rules", "rules.json"], { cwd: root, encoding: "utf8" });
      expect(run.stdout).toContain("1 down, 0 sideways, 0 UP");
      expect(run.status).toBe(0);
    }),
  );

  // scenario: the patched code-graph reads a subpath the package's `exports` map lacks as unresolved
  // (demlik issue 915), since Node refuses such a subpath (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and the
  // tool's own kind for an import it cannot place is `unresolved`. Package `a` exports `.` as
  // `src/index.ts` and `./low` as `src/low.ts`, and no `./missing`. `b` sits below `index.ts` and
  // imports `"a/missing"`; `c` sits above it and imports `"a"`, the bare name. The patched tool reads
  // the first as unresolved, no edge and no UP, and the second as `index.ts`, one downward edge.
  // Plant: drop the bare-name check, so every miss falls back to the package's entry. `a/missing`
  // then lands on `index.ts`, `b` reads as importing a higher row, and the tool reports 1 UP and
  // exits 1.
  it.effect("scenario: an unexported subpath of a package is unresolved, not the package's entry file", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const root = plant({
        "package.json": { name: "plant", private: true, workspaces: ["pkgs/*"] },
        "pnpm-workspace.yaml": 'packages:\n  - "pkgs/*"\n',
        "pkgs/a/package.json": { name: "a", exports: { ".": "./src/index.ts", "./low": "./src/low.ts" } },
        "pkgs/a/src/index.ts": "export const root = 1;\n",
        "pkgs/a/src/low.ts": "export const low = 1;\n",
        "pkgs/b/package.json": { name: "b" },
        "pkgs/b/src/b.ts": 'import { missing } from "a/missing";\nexport const b = missing;\n',
        "pkgs/c/package.json": { name: "c" },
        "pkgs/c/src/c.ts": 'import { root } from "a";\nexport const c = root;\n',
        "rules.json": {
          layers: [
            { name: "top", paths: ["pkgs/c"] },
            { name: "mid", paths: ["pkgs/a/src/index.ts"] },
            { name: "bottom", paths: ["pkgs/b"] },
          ],
        },
      });
      const bin = resolve(NEXT, "..", "node_modules", ".bin", "code-graph");
      const run = spawnSync(bin, [".", "--layers", "--layer-rules", "rules.json"], { cwd: root, encoding: "utf8" });
      expect(run.stdout).toContain("1 down, 0 sideways, 0 UP");
      expect(run.stdout).toContain("1 unresolved");
      expect(run.stdout).toContain("pkgs/b/src/b.ts:1 a/missing");
      expect(run.status).toBe(0);
    }),
  );
});

// Ticket 477, kind 2: the layers. The rule file gives each module a `layer`, and the patched code-graph
// (demlik issue 913) ranks a row by it: rows on one layer share a rank, and an import between two of
// them is a break in either direction.
describe("layers", () => {
  const bin = resolve(NEXT, "..", "node_modules", ".bin", "code-graph");
  type Edge = `${string} -> ${string} [${"sideways" | "upward"}]`;

  /** Run the tool's `--layers` on a planted root: the rows it saw break, as `from -> to [kind]`. */
  const runTool = (
    root: string,
    rows: ReadonlyArray<Row>,
  ): { readonly edges: ReadonlyArray<Edge>; readonly summary: string; readonly status: number | null } => {
    writeFileSync(join(root, "rules.json"), JSON.stringify({ layers: rows }));
    const run = spawnSync(bin, [".", "--layers", "--layer-rules", "rules.json"], { cwd: root, encoding: "utf8" });
    const edges = [
      ...new Set(
        [...run.stdout.matchAll(/^\s+\S+:\d+\s+(\S+) -> (\S+)\s+\S+\s+\("[^"]*"\)(?:\s+\[(sideways|upward)\])?/gm)].map(
          (m): Edge => `${m[1]} -> ${m[2]} [${m[3] ?? "upward"}]` as Edge,
        ),
      ),
    ].sort();
    return { edges, summary: /scanned .*/.exec(run.stdout)?.[0] ?? run.stdout + run.stderr, status: run.status };
  };

  const root = (files: Readonly<Record<string, string>>) =>
    planter.pipe(Effect.map(({ plant }) => plant({ "package.json": { name: "plant", private: true }, ...files })));

  // scenario: L12 uses the actual repository row and real tool to refuse peers and platform code.
  it.effect("scenario: T878 L12 repositories cannot import a peer, packs or Node wiring", () =>
    Effect.gen(function* () {
      const tree = yield* root({
        "next/packages/libfabrika/src/repositories/Repositories.ts": lines(
          'import {setting} from "../settings/Setting.ts";',
          'import {open} from "../packs/Open.ts";',
          'import {git} from "../node/repositories/RepositoriesGit.ts";',
          'import {id} from "../Id.ts";',
          "export {setting, open, git, id};",
        ),
        "next/packages/libfabrika/src/settings/Setting.ts": lines("export const setting = 1;"),
        "next/packages/libfabrika/src/packs/Open.ts": lines("export const open = 1;"),
        "next/packages/libfabrika/src/node/repositories/RepositoriesGit.ts": lines("export const git = 1;"),
        "next/packages/libfabrika/src/Id.ts": lines("export const id = 1;"),
      });
      const run = runTool(tree, REAL);
      expect(run.edges).toEqual([
        "next-repositories -> next-node [upward]",
        "next-repositories -> next-packs [upward]",
        "next-repositories -> next-settings [sideways]",
      ]);
      expect(run.status).toBe(1);
    }),
  );

  // scenario: a planted tree of four rows on three layers, with one upward, two sideways (one each
  // way) and two downward imports, since the law is about the tool's answer on a known tree. `mid1`
  // and `mid2` share layer 1.
  // Plant: remove the layer code from the patch. The tool then ranks by place in the list, `mid1`
  // is above `mid2`, and the sideways imports pass: the second run below is that tool's answer.
  it.effect("scenario: two rows on one layer share a rank, and an import between them breaks in either direction", () =>
    Effect.gen(function* () {
      const tree = yield* root({
        "p/top/t.ts": lines(
          'import {m} from "../mid1/m.ts";',
          'import {l} from "../low/l.ts";',
          "export const t = [m, l];",
        ),
        "p/mid1/m.ts": lines(
          'import {n} from "../mid2/n.ts";',
          'import {t} from "../top/t.ts";',
          "export const m = [n, t];",
        ),
        "p/mid2/n.ts": lines('import {m} from "../mid1/m.ts";', "export const n = m;"),
        "p/low/l.ts": lines("export const l = 1;"),
      });
      const layers: ReadonlyArray<Row> = [
        { name: "top", layer: 2, paths: ["p/top"] },
        { name: "mid1", layer: 1, paths: ["p/mid1"] },
        { name: "mid2", layer: 1, paths: ["p/mid2"] },
        { name: "low", layer: 0, paths: ["p/low"] },
      ];
      const ranked = runTool(tree, layers);
      expect(ranked.edges).toEqual(["mid1 -> mid2 [sideways]", "mid1 -> top [upward]", "mid2 -> mid1 [sideways]"]);
      expect(ranked.summary).toContain("2 down, 2 sideways, 1 UP");
      expect(ranked.status).toBe(1);

      const listed = runTool(
        tree,
        layers.map(({ layer: _layer, ...row }) => row),
      );
      expect(listed.edges).toEqual(["mid1 -> top [upward]", "mid2 -> mid1 [upward]"]);
      expect(listed.summary).toContain("0 sideways");
    }),
  );

  // The rule file's modules on the real file: one probe file per row that has a layer, each importing
  // the probe of every other row. The tool breaks exactly the imports that do not go down a layer.
  const SRC_ROWS = REAL.filter((row) => row.layer !== undefined && row.paths.every((p) => p.startsWith(SRC)));
  const probe = (row: Row): string => {
    const first = row.paths[0] ?? "";
    return first.endsWith(".ts") ? first : `${first}/Probe.ts`;
  };
  const expectedEdges = (rows: ReadonlyArray<Row>): ReadonlyArray<Edge> => {
    const layers = layersByName(rows);
    return SRC_ROWS.flatMap((from) =>
      SRC_ROWS.flatMap((to): ReadonlyArray<Edge> => {
        const [a, b] = [layers.get(from.name), layers.get(to.name)];
        return from.name === to.name || a === undefined || b === undefined || a > b
          ? []
          : [`${from.name} -> ${to.name} [${a === b ? "sideways" : "upward"}]`];
      }),
    ).sort();
  };
  const plantedReal = planter.pipe(
    Effect.map(({ plant }) =>
      plant({
        "package.json": { name: "plant", private: true },
        ...Object.fromEntries(
          SRC_ROWS.map((row) => [
            probe(row),
            lines(
              ...SRC_ROWS.filter((other) => other.name !== row.name).map((other, n) => {
                const spec = relative(dirname(probe(row)), probe(other));
                return `import * as m${n} from "${spec.startsWith(".") ? spec : `./${spec}`}";`;
              }),
              "export const p = 1;",
            ),
          ]),
        ),
      }),
    ),
  );

  // scenario: the real rule file, since "no module imports a higher layer or its own layer" is only
  // true of the rows as written. Every ordered pair of modules is one planted import.
  it.effect("scenario: on the real rule file only downward imports between modules pass", () =>
    Effect.gen(function* () {
      const realTree = yield* plantedReal;
      const run = runTool(realTree, REAL);
      expect(run.edges).toEqual(expectedEdges(REAL));
      expect(run.edges).not.toContain("next-node -> next-workers [sideways]");
      expect(run.edges).toContain("next-processes -> next-presence [sideways]");
      expect(run.edges).toContain("next-transport -> next-ledger [sideways]");
      expect(run.edges).not.toContain("next-runtime -> next-ledger [upward]");
    }),
  );

  // scenario: the plan's plant for "no module imports another module on its own layer". `next-access` is
  // put on layer 5 beside `next-runtime`: an import from the runtime to access, which went down,
  // must now fail, and no other pair changes.
  it.effect("scenario: a module put beside the runtime refuses an import from the runtime", () =>
    Effect.gen(function* () {
      const realTree = yield* plantedReal;
      const beside = REAL.map((row) => (row.name === "next-access" ? { ...row, layer: 5 } : row));
      const before = runTool(realTree, REAL).edges;
      const after = runTool(realTree, beside);
      expect(after.edges).toEqual(expectedEdges(beside));
      expect(after.edges.filter((edge) => !before.includes(edge))).toEqual([
        "next-access -> next-runtime [sideways]",
        "next-runtime -> next-access [sideways]",
      ]);
      expect(before.filter((edge) => !after.edges.includes(edge))).toEqual(["next-access -> next-runtime [upward]"]);
    }),
  );

  // pinned: the plan's layer table (ticket 477, 0043), since the rows are written by hand and this
  // is the one place that says which module is on which layer.
  it("pinned: the modules are on the layers the plan gives them", () => {
    expect(Object.fromEntries(layersByName(REAL))).toEqual({
      "next-node": 9,
      "next-workers": 8,
      "next-libfabrika-entry": 7,
      "next-client": 6, // P18: the window client, beside the door
      "next-door": 6,
      "next-desktop-core": 6,
      "next-schedules": 6,
      "next-runtime": 5,
      "next-access": 4,
      "next-processes": 3,
      "next-presence": 3,
      "next-jobs": 3,
      "next-packs": 3,
      "next-ci": 2,
      "next-codehost": 2,
      "next-repositories": 2,
      "next-ledger": 2,
      "next-transport": 2,
      "next-settings": 2, // T664's approved plan: settings sits on layer 2, above telemetry
      "next-telemetry": 1,
      "next-shared": 0,
    });
  });

  // Plant: derive a row's rank from its place in the list, not from its `layer`. Then changing
  // one layer moves nothing, and the moved row's rank is not the one it was given.
  it("changing one row's layer moves that module and no other", () => {
    const given = fc
      .uniqueArray(fc.constantFrom(...Object.keys(rowParts)), { minLength: 1, maxLength: 10 })
      .chain((names) =>
        fc.tuple(
          fc.array(fc.option(fc.integer({ min: 0, max: 8 }), { nil: undefined }), {
            minLength: names.length,
            maxLength: names.length,
          }),
          fc.constant(names),
          fc.nat({ max: names.length - 1 }),
          fc.integer({ min: 0, max: 8 }),
        ),
      );
    fc.assert(
      fc.property(given, ([layers, names, mover, to]) => {
        const rows: ReadonlyArray<Row> = names.map((name, n) => {
          const layer = layers[n];
          return layer === undefined ? { name, paths: [name] } : { name, paths: [name], layer };
        });
        const moved = rows.map((row, n) => (n === mover ? { ...row, layer: to } : row));
        const before = layersByName(rows);
        const after = layersByName(moved);
        const [name = ""] = [names[mover]];

        expect(after.get(name)).toBe(to);
        expect([...after].filter(([other]) => other !== name)).toEqual([...before].filter(([other]) => other !== name));
        // Moving a module does not touch the order of the rows, so no other module's place changed either.
        expect(moved.map((row) => row.name)).toEqual(rows.map((row) => row.name));
      }),
      { ...options, numRuns: 1000 },
    );
  });
});

// format: these paths are the module's import contract, so each forbidden destination is a lint input.
it.effect("format: P21 L12 desktop rules accept access and refuse gateway and platform modules", () =>
  Effect.gen(function* () {
    const { plant } = yield* planter;
    const root = plant({
      "packages/libfabrika/package.json": manifest(LIBRARY),
      "packages/libfabrika/src/desktop/Menu.ts": lines(
        'import { Grant } from "../access/Access.ts";',
        'import { Gateway } from "../gateway/Gateway.ts";',
        'import { load } from "../node/settings/Load.ts";',
        'import { object } from "../cloudflare/objects.ts";',
        'import { TouchId } from "../electron/TouchId.ts";',
      ),
    });
    const found = faults(root);
    expect(found.some((f) => f.includes('imports "../access/Access.ts"'))).toBe(false);

    for (const path of [
      "../gateway/Gateway.ts",
      "../node/settings/Load.ts",
      "../cloudflare/objects.ts",
      "../electron/TouchId.ts",
    ]) {
      expect(found.some((f) => f.includes(`imports "${path}"`))).toBe(true);
    }
  }),
);
