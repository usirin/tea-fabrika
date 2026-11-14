// p65, `next/` stands alone (docs/plan/tier-1-detail.md, "Packages" and p65). `package.json` alone
// stops neither a walk up to the root's `node_modules` nor a Node import at a top level, so this
// test reads the imports and bundles the top levels. With `layers.test.ts`. Item 9 of the detail's
// exam; written by the exam (Tier 1, P1).
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
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { rolldown, type Plugin } from "rolldown";

const NEXT = resolve(import.meta.dirname, "../../../..");

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

const IMPORTS = [
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const importsIn = (text: string): ReadonlyArray<string> =>
  IMPORTS.flatMap((pattern) => [...text.matchAll(pattern)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])));

const importsInFile = (file: string): ReadonlyArray<string> => importsIn(readFileSync(file, "utf8"));

const isRelative = (spec: string): boolean => spec.startsWith(".");

/** `@kampus/libfabrika/transport/Wire` is `{name: "@kampus/libfabrika", subpath: "./transport/Wire"}`. */
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

/** What an import of a subpath reaches through an `exports` map. */
type Reached =
  | { readonly kind: "file"; readonly file: string }
  | { readonly kind: "refused" }
  | { readonly kind: "missing" };

/**
 * Node's rule for a subpath (ticket 477, PR 9): an exact key without a `*` first; else, among the keys
 * with one `*` that the subpath fits, the one whose part before the `*` is longest, then the longer
 * key. A `null` target refuses the subpath, so `"./ledger/internal/*": null` beats `"./ledger/*"`. The
 * `*` of the target takes what the `*` of the key matched.
 */
const exportAt = (map: ReadonlyMap<string, string | undefined>, subpath: string): Reached => {
  if (map.has(subpath) && !subpath.includes("*")) {
    const file = map.get(subpath);
    return file === undefined ? { kind: "refused" } : { kind: "file", file };
  }

  const [best] = [...map.keys()]
    .map((key) => ({ key, parts: key.split("*") }))
    .filter(
      ({ key, parts }) =>
        parts.length === 2 &&
        subpath.length >= key.length &&
        subpath.startsWith(parts[0] ?? "") &&
        subpath.endsWith(parts[1] ?? ""),
    )
    .sort((a, b) => (b.parts[0] ?? "").length - (a.parts[0] ?? "").length || b.key.length - a.key.length);

  if (best === undefined) {
    return { kind: "missing" };
  }

  const file = map.get(best.key);
  const matched = subpath.slice((best.parts[0] ?? "").length, subpath.length - (best.parts[1] ?? "").length);
  return file === undefined ? { kind: "refused" } : { kind: "file", file: file.split("*").join(matched) };
};

const ownerAt = (packages: ReadonlyArray<Package>, file: string): Package | undefined =>
  packages.find((pkg) => file.startsWith(`${pkg.dir}${sep}`));

/** A path as the messages show it: relative to `from`, with `/`. */
const shown = (from: string, file: string): string => relative(from, file).split(sep).join("/");

// Planted trees: each scan is seen to fire on a planted break before it is trusted on `next/`.
// A tree is planted in the scope of the test that reads it, which removes it when the test ends (0061).
const plant = (files: Readonly<Record<string, string | object>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));

      for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
      }

      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
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

/** `node:fs`, `fs`, `cloudflare:workers`: the platform's own, not a package anyone lists. */
const isPlatform = (spec: string): boolean => spec.includes(":") || builtinModules.includes(spec.split("/")[0] ?? "");

/** Every name a manifest lists, in any of its four dependency fields. */
const listed = (m: Package["manifest"]): ReadonlyMap<string, string> =>
  new Map(
    [m.dependencies, m.devDependencies, m.peerDependencies, m.optionalDependencies].flatMap((names) =>
      Object.entries(names ?? {}),
    ),
  );

/** p65's one outside package (docs/direction/fabrika-design-package.md): the design package, shared by
 *  both versions, which the window (`@kampus/tuval`) and the app import. No other `next/` package may. */
const DESIGN = "@kampus/fabrika-design";
const DESIGN_TAKERS: ReadonlySet<string> = new Set(["@kampus/tuval", "@kampus/fabrika"]);

/** Each package's `package.json`: private at 0.0.0, no side effects, a typecheck, nothing of today's. */
const manifestFaults = (next: string): ReadonlyArray<string> => {
  const packages = packagesIn(next);
  const ours = new Set(packages.map((pkg) => pkg.manifest.name));
  return packages.flatMap((pkg) => {
    const location = shown(next, `${pkg.dir}${sep}package.json`);
    const m = pkg.manifest;
    return [
      ...(m.private === true ? [] : [`${location}: not private`]),
      ...(m.version === "0.0.0" ? [] : [`${location}: version is not 0.0.0`]),
      ...(m.sideEffects === false ? [] : [`${location}: sideEffects is not false`]),
      ...(m.scripts?.["typecheck"] === undefined ? [`${location}: no typecheck script`] : []),
      ...[...listed(m)].flatMap(([name, range]) => [
        ...(name.endsWith("-old") ? [`${location}: depends on ${name}, today's version`] : []),
        ...(range.startsWith("workspace:") && !ours.has(name) && !(name === DESIGN && DESIGN_TAKERS.has(m.name))
          ? [`${location}: depends on ${name}, a workspace package outside next/`]
          : []),
      ]),
    ];
  });
};

/** Files the exam owns that may sit outside a package until `next/apps/fabrika` has one. */
const EXAM = /^apps\/fabrika\/(?:e2e\.ts$|e2e\/|src\/exam\/)/;

/** Every import that walks out: unlisted, outside an exports map, out of its package, or no package at all. */
const importFaults = (next: string): ReadonlyArray<string> => {
  const packages = packagesIn(next);
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  return codeFiles(next).flatMap((file) => {
    const location = shown(next, file);
    const pkg = ownerAt(packages, file);

    if (pkg === undefined) {
      return EXAM.test(location) ? [] : [`${location}: sits in no package`];
    }

    const names = listed(pkg.manifest);
    return importsInFile(file).flatMap((spec) => {
      const found: Array<string> = [];

      if (isRelative(spec)) {
        if (!pointsAt(file, spec).startsWith(`${pkg.dir}${sep}`)) {
          found.push(`${location} imports "${spec}": a relative path out of its package`);
        }

        return found;
      }

      if (isPlatform(spec)) {
        return found;
      }

      const { name, subpath } = packageAt(spec);

      if (name !== pkg.manifest.name && !names.has(name)) {
        found.push(`${location} imports "${spec}": ${name} is not in its package.json`);
      }

      const target = byName.get(name);
      const reached = target === undefined ? undefined : exportAt(exportMap(target), subpath);

      if (reached?.kind === "missing") {
        found.push(`${location} imports "${spec}": ${subpath} is not in ${name}'s exports`);
      }

      if (reached?.kind === "refused") {
        found.push(`${location} imports "${spec}": ${subpath} is refused by ${name}'s exports`);
      }

      if (reached?.kind === "file" && !existsSync(reached.file)) {
        found.push(`${location} imports "${spec}": ${subpath} names no file in ${name}`);
      }

      const inApp = pkg.group === "apps" && shown(pkg.dir, file) !== "src/entry/electron-main.ts";

      if (name === "electron" && inApp) {
        found.push(`${location} imports "${spec}": in an app, only src/entry/electron-main.ts may`);
      }

      return found;
    });
  });
};

/** What a top level bundled for a browser must not reach. */
const FORBIDDEN: ReadonlyArray<{ readonly name: string; readonly test: (spec: string) => boolean }> = [
  {
    name: "node:*",
    test: (spec) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0] ?? ""),
  },
  { name: "electron", test: (spec) => spec === "electron" || spec.startsWith("electron/") },
  { name: "cloudflare:*", test: (spec) => spec.startsWith("cloudflare:") },
  { name: "@modelcontextprotocol/*", test: (spec) => spec.startsWith("@modelcontextprotocol/") },
];

/** The front files the library's old barrels (`/transport`, `/data`, `/coordination`, `/door`) reached.
 *  A tab runs the transport's (Tier 1, P7), holds a read copy of the data's later (P6), and the menu
 *  bar and the gateway share the coordination's (P9). The platform variants, `NodeSqlite` and
 *  `CloudflareSql`, were never in a barrel. */
const FRONTS: ReadonlyArray<string> = [
  "telemetry/Archive",
  "telemetry/RecordPart",
  "telemetry/Records",
  "telemetry/Sink",
  "telemetry/Trace",
  "ledger/Ledger",
  "ledger/LedgerTransaction",
  "ledger/Log",
  "ledger/Referee",
  "transport/Answer",
  "transport/Handshake",
  "transport/Hello",
  "transport/Sshsig",
  "transport/Webauthn",
  "transport/Wire",
  "access/Access",
  "access/Authorization",
  "access/ClientManager",
  "access/SessionManager",
  "access/Text",
  "presence/Connections",
  "processes/Mailbox",
  "processes/Process",
  "processes/ProcessIdGenerator",
  "processes/ProcessManager",
  "runtime/ProcessStore",
  "runtime/RecoveryStore",
  "gateway/Gateway",
  "gateway/GatewayNonce",
  "gateway/GatewayStore",
  "desktop/BrainService",
  "desktop/BrainControl",
  "desktop/BrainProbe",
  "desktop/BrainSpec",
  // P18 L8: the one window client bundles for a browser with no Node or DOM shim.
  "client/WindowMachine",
  "client/WindowStart",
  "client/Headless",
];

/** The detail's list, the top level of the library, of tuval and of notes, plus the library's front
 *  files above. Every program's `/window` comes on top. */
const BROWSER: Readonly<Record<string, ReadonlyArray<string>>> = {
  "@kampus/libfabrika": [".", ...FRONTS.map((front) => `./${front}`)],
  "@kampus/tuval": ["."],
  "@kampus/notes": ["."],
};

const browserEntries = (
  packages: ReadonlyArray<Package>,
): ReadonlyArray<{ readonly label: string; readonly file: string }> =>
  packages.flatMap((pkg) => {
    const name = pkg.manifest.name;
    const keys = [...(BROWSER[name] ?? []), ...(pkg.group === "programs" ? ["./window"] : [])];
    return keys.flatMap((key) => {
      const reached = exportAt(exportMap(pkg), key);
      return reached.kind === "file" && existsSync(reached.file)
        ? [{ label: key === "." ? name : `${name}${key.slice(1)}`, file: reached.file }]
        : [];
    });
  });

/** Bundles `file` for a browser with no Node shims and lists each forbidden module it reaches. */
const reach = async (next: string, label: string, file: string): Promise<ReadonlyArray<string>> => {
  const hits: Array<string> = [];
  const watch: Plugin = {
    name: "forbidden",
    resolveId(source, importer) {
      const rule = FORBIDDEN.find((f) => f.test(source));

      if (rule === undefined) {
        return undefined;
      }

      hits.push(`${label} reaches ${rule.name}: "${source}" from ${shown(next, importer ?? file)}`);
      return { id: source, external: true };
    },
  };
  let bundle: Awaited<ReturnType<typeof rolldown>> | undefined;

  try {
    bundle = await rolldown({
      input: file,
      platform: "browser",
      logLevel: "silent",
      plugins: [watch],
    });
    await bundle.generate({ format: "esm" });
    return hits;
  } catch (error) {
    return [...hits, `${label} does not bundle: ${String(error)}`];
  } finally {
    await bundle?.close();
  }
};

const bundleFaults = async (next: string): Promise<ReadonlyArray<string>> => {
  const all = await Promise.all(browserEntries(packagesIn(next)).map(({ label, file }) => reach(next, label, file)));
  return all.flat();
};

/** What a browser bundle of `file` loads, and what its output keeps, each relative to `next`. Tree
 *  shaking drops a module from the output, never from the loaded list. A bundle that fails throws. */
const bundleContents = async (
  next: string,
  file: string,
): Promise<{ readonly loaded: ReadonlyArray<string>; readonly output: ReadonlyArray<string> }> => {
  const loaded: Array<string> = [];
  const watch: Plugin = {
    name: "loaded",
    load(id) {
      loaded.push(shown(next, id));
      return null;
    },
  };
  const bundle = await rolldown({ input: file, platform: "browser", logLevel: "silent", plugins: [watch] });

  try {
    const { output } = await bundle.generate({ format: "esm" });
    const kept = output.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : []));
    return { loaded, output: kept.map((id) => shown(next, id)) };
  } finally {
    await bundle.close();
  }
};

/** The Ledger contract's implementation: its two layers, their helpers, the referee and its store
 *  (ticket 702's plan: `Ledger.ts` imports neither implementation, nor either helper, nor `Referee`). */
const LEDGER_IMPLEMENTATION: ReadonlyArray<string> = [
  "packages/libfabrika/src/ledger/LedgerSql.ts",
  "packages/libfabrika/src/ledger/LedgerRemote.ts",
  "packages/libfabrika/src/ledger/Referee.ts",
  "packages/libfabrika/src/ledger/internal/ledgerStore.ts",
  "packages/libfabrika/src/ledger/internal/ledgerPages.ts",
  "packages/libfabrika/src/ledger/internal/ledgerTrace.ts",
];

describe("the real next/", () => {
  it("P17a: the public door exists and bundles for a browser", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportAt(exportMap(library!), "./gateway/Gateway");
    expect(entry.kind, "P17a exports the library gateway front").toBe("file");
    expect(await reach(NEXT, "@kampus/libfabrika/gateway/Gateway", entry.kind === "file" ? entry.file : "")).toEqual(
      [],
    );
  });
  it("P11: libfabrika exports its required browser entry instead of silently skipping it", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportMap(library!).get(".");
    expect(entry, "P11 adds libfabrika's browser-safe app entry").toBeDefined();
    expect(await reach(NEXT, "@kampus/libfabrika", entry!)).toEqual([]);
  });
  it("P11: every front file the browser check lists is exported and exists, so none is silently skipped", () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const missing = (BROWSER["@kampus/libfabrika"] ?? []).filter((key) => {
      const reached = exportAt(exportMap(library!), key);
      return !(reached.kind === "file" && existsSync(reached.file));
    });
    expect(missing).toEqual([]);
  });
  // pinned: one named public contract (0095, ticket 702). Bundled alone for a browser, the Ledger
  // contract loads none of its implementation, so a tab that yields `Ledger` never carries SQL.
  // The entry must exist and the bundle must build: a missing entry or a failed bundle is red.
  it("pinned: contract only Ledger reaches no store", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportAt(exportMap(library!), "./ledger/Ledger");
    expect(entry.kind, "libfabrika exports the Ledger contract").toBe("file");
    const file = entry.kind === "file" ? entry.file : "";
    expect(existsSync(file), "the Ledger contract file exists").toBe(true);
    const { loaded, output } = await bundleContents(NEXT, file);
    expect(loaded, "the bundle loaded its entry").toContain(shown(NEXT, file));
    expect(output, "the bundle kept its entry").toContain(shown(NEXT, file));
    expect(loaded.filter((id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
    expect(output.filter((id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
  });

  it("has packages that are private at 0.0.0, with no side effects, a typecheck, and nothing of today's", () => {
    expect(manifestFaults(NEXT)).toEqual([]);
  });

  it("imports only what each package lists, through exports maps, inside its own package", () => {
    expect(importFaults(NEXT)).toEqual([]);
  });

  it("bundles each top level for a browser without node, electron, cloudflare or MCP", async () => {
    expect(await bundleFaults(NEXT)).toEqual([]);
  });
});

describe("reading imports", () => {
  it("finds static, type, re-export, bare, multi-line and dynamic imports, and skips comments", () => {
    const dynamic = `const m = ${"import"}("@pierre/highlights");`; // built from two strings, so no scan reads it as this file's own import
    const text = lines(
      'import {Effect} from "effect";',
      'import type {Wire} from "./wire.ts";',
      'export {fold} from "./fold.ts";',
      'import "./style.css";',
      "import {",
      "\ta,",
      "\tb,",
      '} from "@kampus/libfabrika";',
      dynamic,
      '// import {x} from "not-this";',
      ' * import {y} from "nor-this";',
    );
    expect([...importsIn(text)].sort()).toEqual(
      ["effect", "./wire.ts", "./fold.ts", "./style.css", "@kampus/libfabrika", "@pierre/highlights"].sort(),
    );
  });
});

describe("planted breaks", () => {
  it.effect("P17a: the door browser check catches a Node import", () =>
    Effect.gen(function* () {
      const tree = yield* plant({
        "packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
          exports: { "./gateway/*": "./src/gateway/*.ts", "./gateway/internal/*": null },
        }),
        "packages/libfabrika/src/gateway/Gateway.ts": lines('export {readFileSync} from "node:fs";'),
      });
      expect(
        (yield* Effect.promise(() => bundleFaults(tree))).some(
          (fault) => fault.includes("@kampus/libfabrika/gateway/Gateway") && fault.includes("node:fs"),
        ),
      ).toBe(true);
    }),
  );
  const library = manifest("@kampus/libfabrika", {
    exports: { ".": "./src/index.ts", "./transport/*": "./src/transport/*.ts", "./transport/internal/*": null },
    dependencies: { effect: "catalog:" },
  });
  const tree = plant({
    "packages/libfabrika/package.json": library,
    "packages/libfabrika/src/index.ts": lines(
      'import {Effect} from "effect";',
      'import {readFileSync} from "node:fs";',
    ),
    "packages/libfabrika/src/transport/Wire.ts": lines("export const wire = 1;"),
    "packages/libfabrika/src/transport/internal/binary.ts": lines("export const binary = 1;"),
    "packages/tuval/package.json": manifest("@kampus/tuval", {
      dependencies: {
        "@kampus/libfabrika": "workspace:*",
        "@kampus/fabrika-old": "workspace:*",
        "@kampus/fabrika-design": "workspace:*",
      },
    }),
    "packages/tuval/src/index.ts": lines(
      'import {wire} from "@kampus/libfabrika/transport/Wire";',
      'import {binary} from "@kampus/libfabrika/transport/internal/binary";',
      'import {nope} from "@kampus/libfabrika/transport/Nope";',
      'import {log} from "@kampus/libfabrika/src/ledger/Log.ts";',
      'import {lane} from "@kampus/pipeline";',
    ),
    "programs/counter/package.json": {
      name: "@kampus/counter",
      version: "1.0.0",
      exports: { ".": "./src/index.ts" },
    },
    "programs/counter/src/index.ts": lines('import {run} from "../../../packages/libfabrika/src/index.ts";'),
    // p65: the design package is the window's and the app's only, so the library may not name it.
    "packages/design-taker/package.json": manifest("@kampus/design-taker", {
      dependencies: { "@kampus/fabrika-design": "workspace:*" },
    }),
    "apps/fabrika/package.json": manifest("@kampus/fabrika", {
      dependencies: { electron: "catalog:" },
    }),
    "apps/fabrika/src/entry/electron-main.ts": lines('import {app} from "electron";'),
    "apps/fabrika/src/brain.ts": lines('import {app} from "electron";'),
    "src/stray.ts": lines("export const stray = 1;"),
  });

  it.effect("fires on each manifest break", () =>
    Effect.gen(function* () {
      expect([...manifestFaults(yield* tree)].sort()).toEqual(
        [
          "packages/tuval/package.json: depends on @kampus/fabrika-old, today's version",
          "packages/tuval/package.json: depends on @kampus/fabrika-old, a workspace package outside next/",
          "programs/counter/package.json: not private",
          "programs/counter/package.json: version is not 0.0.0",
          "programs/counter/package.json: sideEffects is not false",
          "programs/counter/package.json: no typecheck script",
          "packages/design-taker/package.json: depends on @kampus/fabrika-design, a workspace package outside next/",
        ].sort(),
      );
    }),
  );

  it.effect("fires on each import break, and on nothing else", () =>
    Effect.gen(function* () {
      expect([...importFaults(yield* tree)].sort()).toEqual(
        [
          'packages/tuval/src/index.ts imports "@kampus/libfabrika/src/ledger/Log.ts": ./src/ledger/Log.ts is not in @kampus/libfabrika\'s exports',
          'packages/tuval/src/index.ts imports "@kampus/libfabrika/transport/internal/binary": ./transport/internal/binary is refused by @kampus/libfabrika\'s exports',
          'packages/tuval/src/index.ts imports "@kampus/libfabrika/transport/Nope": ./transport/Nope names no file in @kampus/libfabrika',
          'packages/tuval/src/index.ts imports "@kampus/pipeline": @kampus/pipeline is not in its package.json',
          'programs/counter/src/index.ts imports "../../../packages/libfabrika/src/index.ts": a relative path out of its package',
          'apps/fabrika/src/brain.ts imports "electron": in an app, only src/entry/electron-main.ts may',
          "src/stray.ts: sits in no package",
        ].sort(),
      );
    }),
  );

  it.effect("lets the exam's own files sit outside a package until the app has one", () =>
    Effect.gen(function* () {
      const early = yield* plant({
        "apps/fabrika/e2e.ts": lines('import {Effect} from "effect";'),
        "apps/fabrika/e2e/door.test.ts": lines('import {it} from "vitest";'),
        "apps/fabrika/src/exam/deps.test.ts": lines('import {it} from "vitest";'),
        "apps/fabrika/src/brain.ts": lines('import {Effect} from "effect";'),
      });
      expect(importFaults(early)).toEqual(["apps/fabrika/src/brain.ts: sits in no package"]);
    }),
  );

  it.effect("fires on a top level that reaches node, cloudflare, MCP or electron", () =>
    Effect.gen(function* () {
      const bundles = yield* plant({
        "packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
          exports: { ".": "./src/index.ts", "./transport/*": "./src/transport/*.ts" },
        }),
        "packages/libfabrika/src/index.ts": lines(
          'import {readFileSync} from "node:fs";',
          "export const read = readFileSync;",
        ),
        "packages/libfabrika/src/transport/Wire.ts": lines(
          'import {createHash} from "node:crypto";',
          "export const hash = createHash;",
        ),
        "packages/tuval/package.json": manifest("@kampus/tuval"),
        "packages/tuval/src/index.ts": lines("export const clean = 1;"),
        "programs/notes/package.json": manifest("@kampus/notes", {
          exports: { ".": "./src/program.ts", "./window": "./src/view.ts" },
        }),
        "programs/notes/src/program.ts": lines(
          'import {serve} from "@modelcontextprotocol/server";',
          "export const s = serve;",
        ),
        "programs/notes/src/view.ts": lines('export {DurableObject} from "cloudflare:workers";'),
        "programs/chaos/package.json": manifest("@kampus/chaos", {
          exports: { ".": "./src/index.ts", "./window": "./src/window.ts" },
        }),
        "programs/chaos/src/index.ts": lines('import {app} from "electron";', "export const a = app;"),
        "programs/chaos/src/window.ts": lines('export {a} from "./index.ts";'),
      });
      expect([...(yield* Effect.promise(() => bundleFaults(bundles)))].sort()).toEqual(
        [
          '@kampus/libfabrika reaches node:*: "node:fs" from packages/libfabrika/src/index.ts',
          '@kampus/libfabrika/transport/Wire reaches node:*: "node:crypto" from packages/libfabrika/src/transport/Wire.ts',
          '@kampus/notes reaches @modelcontextprotocol/*: "@modelcontextprotocol/server" from programs/notes/src/program.ts',
          '@kampus/notes/window reaches cloudflare:*: "cloudflare:workers" from programs/notes/src/view.ts',
          '@kampus/chaos/window reaches electron: "electron" from programs/chaos/src/index.ts',
        ].sort(),
      );
    }),
  );
});

// Ticket 477, kind 2 (PR 9): each module has a pair of keys, `"./<module>/*": "./src/<module>/*.ts"` and
// `"./<module>/internal/*": null`. The exam reads an exports map the way Node does: a pattern key holds
// one `*`, and `"./ledger/internal/*": null` beats `"./ledger/*"` because its part before the `*` is
// longer. Fixed seed, as `layers.test.ts` and the lead scripts' laws use.
describe("a module's front files and its internal/ in the exports map", () => {
  const options = { seed: 119120, numRuns: 200 };
  const LIBRARY = "@kampus/libfabrika";
  const MODULES = [
    "telemetry",
    "ledger",
    "transport",
    "processes",
    "presence",
    "access",
    "runtime",
    "gateway",
    "desktop",
    "client",
  ] as const;
  const module = fc.constantFrom(...MODULES);
  const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/);
  const real = () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === LIBRARY);
    expect(library, "the library is a package of next/").toBeDefined();
    return library!;
  };

  // pinned: the pair the plan writes (PR 9), since each module's two keys are written by hand.
  it("pinned: every module has the pair of keys the plan gives it", () => {
    const exports = real().manifest.exports;
    const keys = typeof exports === "object" && exports !== null ? Object.fromEntries(Object.entries(exports)) : {};

    for (const each of MODULES) {
      expect(keys[`./${each}/*`], `./${each}/*`).toBe(`./src/${each}/*.ts`);
      expect(keys[`./${each}/internal/*`], `./${each}/internal/*`).toBeNull();
    }
  });

  // Plant: pick the first key that fits, in the map's order, and not the longest. Then a map with
  // `./ledger/*` before the null key lets `ledger/internal/ledgerStore` through.
  it("Node's rule: the longest pattern wins, and null refuses, whatever the order of the keys", () => {
    const sub = fc.tuple(
      module,
      fc.constantFrom("front", "internal"),
      name,
      fc.shuffledSubarray(["pattern", "null"], { minLength: 2 }),
    );
    fc.assert(
      fc.property(sub, ([each, kind, stem, order]) => {
        const entries = order.map((key): [string, string | undefined] =>
          key === "pattern" ? [`./${each}/*`, `/pkg/src/${each}/*.ts`] : [`./${each}/internal/*`, undefined],
        );
        const at = kind === "front" ? `./${each}/${stem}` : `./${each}/internal/${stem}`;
        expect(exportAt(new Map(entries), at)).toEqual(
          kind === "front" ? { kind: "file", file: `/pkg/src/${each}/${stem}.ts` } : { kind: "refused" },
        );
        expect(exportAt(new Map(entries), `./other/${stem}`)).toEqual({ kind: "missing" });
      }),
      options,
    );
  });

  // The app imports a subpath of the library whose real `exports` is read from the real package. A
  // front file is reached. An internal file is refused even though it exists, and a name no file has
  // reaches nothing. Plant: `ledger/internal/ledgerStore` imported from the app, which must fail.
  const stemName = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]{0,8}$/));
  type Case = readonly [(typeof MODULES)[number], "front" | "internal" | "missing", string];
  // pinned: the plan's plant (ticket 477), the ledger's store imported from the app, runs first.
  const pinned: ReadonlyArray<Case> = [["ledger", "internal", "ledgerStore"]];
  it.effect.prop(
    "each module's front files are reached and its internal/ is refused to other packages",
    [Schema.Literals(MODULES), Schema.Literals(["front", "internal", "missing"]), stemName],
    (generated) =>
      Effect.forEach(
        [...pinned, generated],
        ([each, kind, stem]) =>
          Effect.gen(function* () {
            const subpath = kind === "internal" ? `${each}/internal/${stem}` : `${each}/${stem}`;
            const tree = yield* plant({
              "packages/libfabrika/package.json": manifest(LIBRARY, { exports: real().manifest.exports }),
              [`packages/libfabrika/src/${each}/internal/${stem}.ts`]: lines("export const inside = 1;"),
              ...(kind === "missing"
                ? {}
                : { [`packages/libfabrika/src/${subpath}.ts`]: lines("export const front = 1;") }),
              "apps/fabrika/package.json": manifest("@kampus/fabrika", { dependencies: { [LIBRARY]: "workspace:*" } }),
              "apps/fabrika/src/use.ts": lines(`import {x} from "${LIBRARY}/${subpath}";`),
            });
            const faults = importFaults(tree).map((fault) => fault.replace(/^.*: /, ""));

            expect(faults).toEqual(
              kind === "front"
                ? []
                : kind === "internal"
                  ? [`./${subpath} is refused by ${LIBRARY}'s exports`]
                  : [`./${subpath} names no file in ${LIBRARY}`],
            );
          }),
        { discard: true, concurrency: 1 },
      ),
    { arbitrary: { seed: options.seed, runs: 60 } },
  );
});

it("format: L12 desktop contracts bundle for a browser without their implementations", async () => {
  // The three public contracts are a client import protocol. Loading one must not load its driver.
  // After build plant: route a contract through BrainServiceManaged; this must fail even if all
  // platform imports were tree-shaken from the emitted bytes.
  const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
  expect(library).toBeDefined();
  const implementation =
    /packages\/libfabrika\/src\/(?:desktop\/(?:BrainServiceManaged|internal\/)|node\/launchd\/|cloudflare\/)/;

  for (const name of ["BrainService", "BrainControl", "BrainProbe"]) {
    const entry = exportAt(exportMap(library!), `./desktop/${name}`);
    expect(entry.kind).toBe("file");
    const file = entry.kind === "file" ? entry.file : "";
    expect(existsSync(file)).toBe(true);
    const { loaded, output } = await bundleContents(NEXT, file);
    expect(loaded).toContain(shown(NEXT, file));
    expect(loaded.filter((path) => implementation.test(path))).toEqual([]);
    expect(output.filter((path) => implementation.test(path))).toEqual([]);
  }
});
