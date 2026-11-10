// P12, next/. Exercise the real build entry. A Compiler failure must preserve every last-good byte.
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
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, FileSystem, Layer, type Path } from "effect";
import * as fc from "fast-check";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";

const homes: Array<string> = [];

const runNode = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(work.pipe(Effect.provide(NodeServices.layer)));

const discovery = (files: Array<string>) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      glob: () => Effect.succeed(files),
    })),
  );

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

/** A module specifier naming a `node:` module: a static import or re-export, a dynamic import or a
 *  require. An object key such as React DOM's minified `{node:n}` is not one. */
const NODE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["'`]node:/;

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
      const failed = await runNode(Effect.exit(build(options)));
      expect(Exit.isFailure(failed), "reachable input is checked even with files: []").toBe(true);
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
    "default discovery publishes one view module beside the tab's window.js, and custom modules export program",
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
        // `out` holds one `<hash>.js` per discovered view and P14's `window.js`; `brain.mjs` and
        // `page.html` are not `.js`.
        const scripts = readdirSync(out).filter((file) => file.endsWith(".js"));
        const views = scripts.filter((file) => file !== "window.js");
        expect(scripts).toContain("window.js");
        expect(views).toHaveLength(1);
        const compiled = await import(pathToFileURL(join(out, views[0]!)).href);
        expect(compiled.label).toBe(label);
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
      const failed = await runNode(Effect.exit(build(options)));
      expect(Exit.isFailure(failed), name).toBe(true);
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
        Effect.exit(
          build({
            out,
            files: [file],
            ledger: [{ file: stale, fn: "Tip", reason: "test plant" }],
          }),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
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
});

// P14 (ticket 286), the plan's "Build, screens and styles". Written before the browser half of
// `build.ts`. The shape these laws hold it to:
// - `build({out, browser})`: `browser` is the entry module to bundle for the tab, default
//   `src/entry/browser.tsx`. It goes through the same Compiler plugin and the same ledger check.
// - The result gains `page` (the HTML), `script` (the browser bundle as text) and `style`, the CSS
//   collected in order, each `{source: "manti" | "tokens" | "tuval", css}`.
// - `out` gains `window.js` (the script) and `page.html` (the page). The page holds every style text
//   in that order and loads `/window.js`; the script imports nothing from outside itself.
// - A failure of any kind (a Compiler finding, a bundle error) publishes nothing: every byte of the
//   last good `out`, `brain.mjs` and the browser files included, stays as it was.
describe("P14 browser build", () => {
  const fixture = (name: string, view: string) => {
    const folder = home();
    mkdirSync(join(folder, "node_modules"));
    symlinkSync(
      resolve(import.meta.dirname, "../../../../node_modules/.pnpm/react@19.3.1/node_modules/react"),
      join(folder, "node_modules/react"),
    );
    const entry = join(folder, "entry.tsx");
    writeFileSync(join(folder, `${name}.tsx`), view);
    writeFileSync(entry, `import {Tip} from "./${name}.tsx"; export const mounted = Tip;`);
    return { folder, entry, file: join(folder, `${name}.tsx`), out: join(folder, "dist") };
  };
  const sources = ["manti", "tokens", "tuval"];

  it("publishes the page, the script and the brain together, with the styles in order", async () => {
    const { build } = await import("./build.ts");
    const out = join(home(), "dist");
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const built = (await runNode(build({ out }))) as unknown as {
      page: string;
      script: string;
      style: ReadonlyArray<{ source: string; css: string }>;
    };
    expect(built.style.map((s) => s.source)).toEqual(sources);

    for (const s of built.style) {
      expect(s.css.length, `${s.source} css is not empty`).toBeGreaterThan(0);
    }

    const at = built.style.map((s) => built.page.indexOf(s.css));
    expect(
      at.every((n) => n >= 0),
      "the page holds every style text",
    ).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(built.page).toContain("/window.js");
    expect(readFileSync(join(out, "window.js"), "utf8")).toBe(built.script);
    expect(readFileSync(join(out, "page.html"), "utf8")).toBe(built.page);
    expect(readdirSync(out)).toContain("brain.mjs");
    // A self-contained browser script: no bare or platform import left, no Node, Worker or MCP name.
    expect(built.script).not.toMatch(/(?:^|\n)\s*import\s[^;]*from\s*["'](?!\.|\/|https?:)/);

    expect(built.script, "no node: module is imported or required").not.toMatch(NODE_SPECIFIER);

    for (const word of ["cloudflare:", "@modelcontextprotocol", 'require("react']) {
      expect(built.script).not.toContain(word);
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
          ];

          for (const form of forms) {
            expect(`a();${form}b();`, form).toMatch(NODE_SPECIFIER);
          }

          expect(`var o={node:${module},offset:1};f({node:n});`).not.toMatch(NODE_SPECIFIER);
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });

  for (const [plant, source] of plants) {
    law(`a Compiler finding in the browser entry's views publishes nothing: ${plant}`, async ({ name }) => {
      const { build } = await import("./build.ts");
      const { folder, entry, file, out } = fixture(name, clean);
      const options = { out, files: [], ledger: [], browser: entry };
      await runNode(build(options));
      const before = snapshot(out);
      expect(before.map(([n]) => n)).toEqual(expect.arrayContaining(["window.js", "page.html", "brain.mjs"]));
      writeFileSync(file, source);
      const failed = await runNode(Effect.exit(build(options)));
      expect(Exit.isFailure(failed), "the browser entry's TSX is checked even with files: []").toBe(true);
      expect(snapshot(out)).toEqual(before);
      expect(readdirSync(folder).filter((n) => n.startsWith(".fabrika-build-"))).toEqual([]);
    });
  }

  law("a browser bundle that cannot build publishes nothing and leaves no temporary folder", async ({ name }) => {
    const { build } = await import("./build.ts");
    const { folder, entry, out } = fixture(name, clean);
    const options = { out, files: [], ledger: [], browser: entry };
    await runNode(build(options));
    const before = snapshot(out);
    writeFileSync(entry, 'import {gone} from "./nothing-here.ts"; export const x = gone; ((');
    const failed = await runNode(Effect.exit(build(options)));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(snapshot(out)).toEqual(before);
    expect(readdirSync(folder).filter((n) => n.startsWith(".fabrika-build-"))).toEqual([]);
  });
  law("a good rebuild replaces every file at once and the build hash follows the script", async ({ name, mark }) => {
    const { build } = await import("./build.ts");
    const { entry, file, out } = fixture(name, clean);
    const options = { out, files: [], ledger: [], browser: entry };
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const first = (await runNode(build(options))) as unknown as { script: string };
    writeFileSync(file, `export const Tip = () => <b>{${JSON.stringify(mark)}}</b>;`);
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const second = (await runNode(build(options))) as unknown as { script: string };
    expect(readFileSync(join(out, "window.js"), "utf8")).toBe(second.script);
    expect(second.script).toContain(mark);
    expect(first.script).not.toContain(mark);
  });
});
