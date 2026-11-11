// P12 and P16, next/. Exercise the real build entry. A Compiler failure must preserve every
// last-good byte. P16: the app's build hands its selections to libfabrika's one-file build, so
// only brain.mjs is published, and every failure is BuildError with its `reason`.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, type Path, PlatformError } from "effect";
import * as fc from "fast-check";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";

const homes: Array<string> = [];

const runNode = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(work.pipe(Effect.provide(NodeServices.layer)));

const discovery = (files: Array<string>, seen?: { calls: number }) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      glob: () =>
        Effect.sync(() => {
          if (seen) {
            seen.calls++;
          }

          return files;
        }),
    })),
  );

const refused = (reason: string) => ({ _tag: "Failure", failure: { _tag: "BuildError", reason } });

afterEach(() => {
  for (const h of homes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }
});

const home = () => {
  const h = mkdtempSync(join(tmpdir(), "p12-b-"));
  homes.push(h);
  return h;
};

// `mark` is a non-empty word no bundle holds by chance, for a law that looks for it in a script;
// `label` stays any string, for the law that reads it back from the compiled module.
const generated = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/),
  label: fc.string(),
  mark: fc.stringMatching(/^[a-z0-9]{8,16}$/).map((s) => `p14-rebuild-mark-${s}`),
});

const chosen = { name: "view", label: "view-built", mark: "p14-rebuild-mark-chosen" };

/** A module specifier naming a `node:` module: a static import or re-export, a dynamic import, a
 *  require or Node's `getBuiltinModule`, as Effect's async-hooks probe names one. An object key such
 *  as React DOM's minified `{node:n}` is not one. */
const NODE_SPECIFIER = /(?:\b(?:from|import|require|getBuiltinModule)\s*\(?\s*|\?\.\s*\(\s*)["'`]node:/;

/** Any import of another module: a static import or re-export, or a dynamic import of a path. */
const IMPORTS =
  /(?:^|[;}\n])\s*(?:import\s*(?:[\w$*{][^;]*?\bfrom\s*)?["'`]|export\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*["'`])|\bimport\s*\(\s*["'`]/;

const law = (name: string, check: (input: ReturnType<typeof generated.generate>["value"]) => Promise<void>) =>
  it(name, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async (input) => {
        try {
          await check(input);
        } finally {
          for (const h of homes.splice(0)) {
            rmSync(h, { recursive: true, force: true });
          }
        }
      }),
      { seed: 119120, numRuns: 3, examples: [[chosen]] },
    );
  });

const snapshot = (dir: string): ReadonlyArray<readonly [string, string]> =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map(
      (f) =>
        [
          relative(dir, join(f.parentPath, f.name)),
          readFileSync(join(f.parentPath, f.name)).toString("base64"),
        ] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b));

const clean = "export const Tip = (p: {text: string}) => <b>{p.text}</b>;";

const plants = [
  [
    "skipped function",
    'import {useRef} from "react"; export const Tip = () => {const r = useRef(1); return <b>{r.current}</b>;}',
  ],
  ["purity error", "export const Tip = () => <b>{Date.now()}</b>;"],
  ["unlisted directive", 'export const Tip = () => {"use no memo"; return <b>ok</b>;}'],
] as const;

describe("P12 Rolldown build", () => {
  for (const [plant, source] of plants) {
    law(`every reachable TSX input passes the Compiler check: ${plant}`, async ({ name }) => {
      const { build } = await import("./build.ts");
      const folder = home(),
        file = join(folder, `${name}.tsx`),
        program = join(folder, "program.ts"),
        out = join(folder, "dist");
      mkdirSync(join(folder, "node_modules"));
      symlinkSync(
        resolve(import.meta.dirname, "../../../../node_modules/.pnpm/react@19.3.1/node_modules/react"),
        join(folder, "node_modules/react"),
      );
      writeFileSync(file, clean);
      writeFileSync(
        program,
        `import {Tip} from "./${name}.tsx"; import {counter} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))}; export const program = {...counter, fixture: Tip};`,
      );
      const options = { out, files: [], ledger: [], programs: { counter: program } };
      await runNode(build(options));
      const before = snapshot(out);
      writeFileSync(file, source);
      const failed = await runNode(Effect.result(build(options)));
      expect(failed, "reachable input is checked even with files: []").toMatchObject(refused("compiler"));
      expect(snapshot(out)).toEqual(before);
    });
  }

  law("Compiler ledger rows use the same repo-relative paths as discovered inputs", async ({ name }) => {
    const { build } = await import("./build.ts");
    const folder = home(),
      file = join(folder, `${name}.tsx`),
      root = resolve(import.meta.dirname, "../../../..");
    writeFileSync(file, 'export const Tip = () => {"use no memo"; return <b>approved</b>;}');
    const path = relative(root, file);
    const result = await runNode(
      Effect.exit(
        build({
          out: join(folder, "dist"),
          ledger: [{ file: path, fn: "Tip", reason: "fixture approval" }],
        }),
      ).pipe(Effect.provide(discovery([path]))),
    );
    expect(result).toMatchObject({ _tag: "Success" });
  });
  law(
    "default discovery checks a view without publishing siblings and custom modules export program",
    async ({ name, label }) => {
      const { build } = await import("./build.ts");
      const parent = home(),
        folder = join(parent, "owned"),
        view = join(folder, `${name}.tsx`),
        program = join(folder, "program.ts"),
        out = join(folder, "dist");
      mkdirSync(folder);
      writeFileSync(view, `export const label = ${JSON.stringify(label)};`);
      writeFileSync(
        program,
        `export {counter as program} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))};`,
      );
      chmodSync(parent, 0o500);

      try {
        const built = await runNode(
          build({ out, programs: { counter: program } }).pipe(
            Effect.provide(discovery([relative(resolve(import.meta.dirname, "../../../.."), view)])),
          ),
        );
        expect(built.programs.counter?.hash).toMatch(/^[a-f0-9]{64}$/);
        // P16 replaces P12's loose view files: the one published file is the brain.
        expect(readdirSync(out)).toEqual(["brain.mjs"]);
        // Discovery must still reach the real Compiler.
        const before = snapshot(out);
        writeFileSync(view, plants[1][1]);
        const failed = await runNode(
          Effect.result(build({ out, programs: { counter: program } })).pipe(
            Effect.provide(discovery([relative(resolve(import.meta.dirname, "../../../.."), view)])),
          ),
        );
        expect(failed, "default discovery must check its TSX inputs").toMatchObject(refused("compiler"));
        expect(snapshot(out)).toEqual(before);
      } finally {
        chmodSync(parent, 0o700);
      }
    },
  );
  law("Compiler plant: calling compile without check publishes a skipped or impure rebuild", async ({ name }) => {
    const { build } = await import("./build.ts");
    const h = home(),
      file = join(h, `${name}.tsx`),
      out = join(h, "dist");
    writeFileSync(file, clean);
    const options = { out, files: [file], ledger: [] };
    const good = await runNode(build(options));
    expect(good).toMatchObject({ build: expect.any(String) });
    const before = snapshot(out);
    expect(before.length).toBeGreaterThan(0);

    for (const [name, source] of plants) {
      writeFileSync(file, source);
      const failed = await runNode(Effect.result(build(options)));
      expect(failed, name).toMatchObject(refused("compiler"));
      expect(snapshot(out), name).toEqual(before);
    }
  });
  law("Compiler plant: checking transformed files misses a stale ledger row or deleted input", async ({ name }) => {
    const { build } = await import("./build.ts");
    const h = home(),
      file = join(h, `${name}.tsx`),
      out = join(h, "dist");
    writeFileSync(file, clean);
    await runNode(build({ out, files: [file], ledger: [] }));
    const before = snapshot(out);

    for (const stale of [file, join(h, "gone.tsx")]) {
      const result = await runNode(
        Effect.result(
          build({
            out,
            files: [file],
            ledger: [{ file: stale, fn: "Tip", reason: "test plant" }],
          }),
        ),
      );
      expect(result).toMatchObject(refused("compiler"));
      expect(snapshot(out)).toEqual(before);
    }
  });
  law(
    "sealed program plant: generated source must execute without host imports or ambient bindings",
    async ({ name }) => {
      const { build } = await import("./build.ts");
      const built = await runNode(build({ out: join(home(), "dist") }));
      expect(built.brain).toEqual(expect.any(String));
      expect(built.programs.counter).toMatchObject({
        hash: expect.any(String),
        source: expect.any(String),
      });
      // The native Worker entry may import cloudflare:workers. Its execution is checked on workerd.
      const file = join(home(), `${name}.mjs`);
      writeFileSync(file, built.programs.counter!.source);
      const bundle = await rolldown({
        input: file,
        platform: "browser",
        external: ["cloudflare:workers"],
      });

      try {
        const generated = await bundle.generate({ format: "esm" });
        expect(generated.output.some((o) => o.type === "chunk" && o.exports.includes("default"))).toBe(true);
      } finally {
        await bundle.close();
      }

      expect(built.build.length).toBeGreaterThan(0);
    },
  );
  law("discovery keeps program TSX and leaves out test files and installed dependencies", async ({ name }) => {
    const { build } = await import("./build.ts");
    const folder = home(),
      out = join(folder, "dist"),
      root = resolve(import.meta.dirname, "../../../.."),
      good = join(folder, `${name}.tsx`),
      test = join(folder, `${name}.test.tsx`),
      dependency = join(folder, "node_modules", `${name}.tsx`);
    mkdirSync(join(folder, "node_modules"));
    writeFileSync(good, clean);
    writeFileSync(test, "this is invalid TSX");
    writeFileSync(dependency, "this is invalid TSX");
    const seen = { calls: 0 };
    const built = await runNode(
      build({ out, ledger: [] }).pipe(
        Effect.provide(
          discovery(
            [good, test, dependency].map((file) => relative(root, file)),
            seen,
          ),
        ),
      ),
    );
    expect(seen.calls, "default discovery ran").toBeGreaterThan(0);
    expect(built.brain).toBe(join(out, "brain.mjs"));
    expect(readFileSync(built.brain, "utf8").length).toBeGreaterThan(0);
    // Plant: the same good file, refused, still fails through discovery.
    writeFileSync(good, plants[0][1]);
    const failed = await runNode(
      Effect.result(build({ out, ledger: [] })).pipe(Effect.provide(discovery([relative(root, good)]))),
    );
    expect(failed).toMatchObject(refused("compiler"));
  });
  law("discovery plant: a disk failure is a typed BuildError and preserves the last good file", async ({ label }) => {
    const { build } = await import("./build.ts");
    const folder = home(),
      out = join(folder, "dist");
    mkdirSync(out);
    writeFileSync(join(out, "brain.mjs"), label);
    const before = snapshot(out);
    let calls = 0;
    const failing = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fs) => ({
        ...fs,
        glob: () => {
          calls++;
          return Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "glob",
              description: "planted discovery disk failure",
            }),
          );
        },
      })),
    );
    // Effect.result catches typed failures only. A defect escapes this law.
    const result = await runNode(Effect.result(build({ out, ledger: [] })).pipe(Effect.provide(failing)));
    expect(calls).toBeGreaterThan(0);
    expect(result).toMatchObject(refused("read"));
    expect(snapshot(out)).toEqual(before);
  });
});

// P14 (ticket 286), the plan's "Build, screens and styles", on P16's tables (A10). The app only
// selects: its build hands libfabrika the tab's entry (`src/entry/browser.tsx`) and the three
// stylesheets in the page's order, Manti's, then `@kampus/fabrika-design/tokens.css`, then
// `@kampus/tuval/style.css`. The shape these laws hold it to:
// - The result's `assets` holds `/window.js`, the tab's script (one ES module that names no `node:`
//   module and imports nothing), and `/index.html`, the page (`text/html; charset=utf-8`), which holds
//   the three stylesheets' rules in that order and loads `/window.js`.
// - Only `brain.mjs` is published (P16), and it embeds both.
// The fixture laws of P14's browser bundle (a Compiler finding in the tab's views, a tab entry that
// cannot bundle, a good rebuild) moved with the bundle into libfabrika's build-one-file.test.ts.
describe("P14 browser build", () => {
  const STYLES = ["@manti-ui/styles/index.css", "@kampus/fabrika-design/tokens.css", "@kampus/tuval/style.css"];
  // The CSS parser libfabrika's build uses, read from the library's own dependencies: a law
  // compares rules, not text, since the build may print a stylesheet again.
  type Css = {
    readonly transform: (o: {
      filename: string;
      code: Uint8Array;
      visitor: { StyleSheet: (sheet: { rules: Array<unknown> }) => void };
    }) => unknown;
  };
  const css = createRequire(resolve(import.meta.dirname, "../../../packages/libfabrika/package.json"))(
    "lightningcss",
  ) as Css;
  const parsedRules = (text: string): unknown => {
    let rules: Array<unknown> = [];
    css.transform({
      filename: "law.css",
      code: Buffer.from(text),
      visitor: {
        StyleSheet: (sheet) => {
          rules = sheet.rules;
        },
      },
    });
    return JSON.parse(JSON.stringify(rules, (key, value) => (key === "loc" ? undefined : value)));
  };
  const pageRules = (page: string): unknown =>
    parsedRules([...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n"));

  // scenario: one real app build through Rolldown, the Compiler and lightningcss on the repo's own
  // entry and stylesheets; its output is fixed by those real files, so there is nothing to generate.
  it("scenario: the brain carries the page and the script in its tables, with Manti's styles, then the tokens, then Tuval's", async () => {
    const { build } = await import("./build.ts");
    const out = join(home(), "dist");
    const built = await runNode(build({ out }));
    const script = built.assets["/window.js"];
    const page = built.assets["/index.html"];
    expect(script?.type, "the tab's script is in the table").toBe("text/javascript; charset=utf-8");
    expect(page?.type, "the page is in the table").toBe("text/html; charset=utf-8");
    const given = STYLES.map((module) => readFileSync(fileURLToPath(import.meta.resolve(module)), "utf8"));

    for (const [n, text] of given.entries()) {
      expect(text.length, `${STYLES[n]} is not empty`).toBeGreaterThan(0);
    }

    expect(pageRules(page!.body), "Manti's rules, then the tokens', then Tuval's").toEqual(
      parsedRules(given.join("\n")),
    );
    // Plant: the tokens before Manti's are caught by that check.
    expect(pageRules(page!.body)).not.toEqual(parsedRules([given[1], given[0], given[2]].join("\n")));
    expect(page!.body).toMatch(/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/window\.js")[^>]*>/);
    expect(readdirSync(out), "only the brain is published").toEqual(["brain.mjs"]);
    const brain = readFileSync(built.brain, "utf8");
    expect(brain.length).toBeGreaterThan(script!.body.length);
    expect(script!.body, "no node: module is imported, required or probed").not.toMatch(NODE_SPECIFIER);
    expect(script!.body, "one module that imports nothing").not.toMatch(IMPORTS);

    for (const word of ["cloudflare:", "@modelcontextprotocol", 'require("react']) {
      expect(script!.body).not.toContain(word);
    }
  });

  // Plant for the check above: each way a script names a node: module is caught, and a minified
  // object key `node:` is not.
  it("the node: check catches every specifier form and passes an object key", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z_]{1,12}$/),
        fc.constantFrom("'", '"', "`"),
        fc.constantFrom(" ", "", "\n  "),
        (module, q, gap) => {
          const forms = [
            `import x from${gap}${q}node:${module}${q};`,
            `import${gap}${q}node:${module}${q};`,
            `export {x} from${gap}${q}node:${module}${q};`,
            `const m = import(${gap}${q}node:${module}${q});`,
            `const m = require(${gap}${q}node:${module}${q});`,
            `globalThis.process?.getBuiltinModule?.(${q}node:${module}${q})`,
          ];

          for (const form of forms) {
            expect(`a();${form}b();`, form).toMatch(NODE_SPECIFIER);
          }

          expect(`a();import{x}from${q}./${module}.js${q};b();`).toMatch(IMPORTS);
          expect(`var o={node:${module},offset:1};f({node:n});`).not.toMatch(NODE_SPECIFIER);
          expect(`throw Error("cannot import ${module} from here");`).not.toMatch(IMPORTS);
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });
});
