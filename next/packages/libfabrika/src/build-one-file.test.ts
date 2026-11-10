// P16, next/. P12's out/files/ledger inputs remain. P16 adds the client's entry, resolution
// root and explicit program selections. Implementation owns those signature adjustments.
// Builder contract: `libfabrika/src/build.ts` exports `build(options)`, an Effect that needs
// FileSystem and Path and fails with BuildError's `reason`.
// P14 (A10): `build` also takes `tab: {entry, styles}`, the tab's entry module and its stylesheets in
// the order the page applies them, and builds them into the same tables: the entry as one
// Compiler-checked ES module at `/window.js` that names no `node:` module, and the page at
// `/index.html` (`text/html; charset=utf-8`) that holds every stylesheet's rules in the given order
// and loads `/window.js`. Without `tab` neither route exists. A failure publishes nothing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import * as fc from "fast-check";
import { type Rule, transform } from "lightningcss";
import { parseSync } from "oxc-parser";
import { rolldown, type RolldownOptions, type OutputOptions, type RolldownOutput } from "rolldown";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const homes: string[] = [];
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

const text = fc
  .array(fc.constantFrom("雪", "🫖", "'", '"', "\\", "\r\n", "\n", "</script>", "a"), {
    minLength: 1,
    maxLength: 12,
  })
  .map((xs) => xs.join(""));

const graph = fc.record({ text, chaos: fc.boolean(), count: fc.integer({ min: 1, max: 3 }) });
const runs = { seed: 119120, numRuns: 3 };
// Three real clean-build samples took 5.6 s under load. Allow 10 s per generated sample.
const buildTimeout = (samples = runs.numRuns) => samples * 10_000;
type Selection = { readonly name: string; readonly package: string; readonly export: string };

type Built = {
  readonly brain: string;
  readonly build: string;
  readonly programs: Readonly<Record<string, { readonly hash: string; readonly source: string }>>;
  readonly assets: Readonly<Record<string, { readonly hash: string; readonly type: string; readonly body: string }>>;
};

type Build = {
  readonly build: (options: {
    readonly out: string;
    readonly root: string;
    readonly entry: string;
    readonly programs: readonly Selection[];
    readonly files: readonly string[];
    readonly ledger: readonly unknown[];
    readonly chaos: boolean;
    readonly tab?: { readonly entry: string; readonly styles: readonly string[] };
  }) => Effect.Effect<Built, unknown>;
};

const fixture = (value: string, count = 1) => {
  const home = mkdtempSync("/tmp/fh.");
  homes.push(home);
  writeFileSync(join(home, "package.json"), '{"type":"module"}');
  mkdirSync(join(home, "node_modules/@p16"), { recursive: true });

  for (const name of ["effect", "@demlik", "@kampus"]) {
    symlinkSync(join(ROOT, "next/apps/fabrika/node_modules", name), join(home, "node_modules", name), "dir");
  }

  const programs: Selection[] = [];
  symlinkSync(join(import.meta.dirname, "../node_modules/react"), join(home, "node_modules/react"));

  for (let n = 0; n < count; n++) {
    const name = `program${n}`,
      pkg = join(home, "programs", name);
    mkdirSync(pkg, { recursive: true });
    // Workspace packages resolve by name, but their real source is outside node_modules.
    symlinkSync(pkg, join(home, "node_modules/@p16", name), "dir");
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: `@p16/${name}`,
        type: "module",
        exports: { ".": "./program.ts", "./window": "./window.tsx" },
      }),
    );
    writeFileSync(
      join(pkg, "program.ts"),
      `import {counter} from "@kampus/counter"; globalThis.__p16Inner = ${JSON.stringify(value + n)}; export const program = {...counter, name:${JSON.stringify(name)}};`,
    );
    writeFileSync(
      join(pkg, "window.tsx"),
      `import "./window.css"; globalThis.__p16Ready = import("./chunk.ts"); export const View${n} = () => <b>${n}</b>;`,
    );
    writeFileSync(join(pkg, "chunk.ts"), `export const text = ${JSON.stringify(value + n)};`);
    writeFileSync(join(pkg, "window.css"), `b { --p16: ${n}; }`);
    programs.push({ name, package: `@p16/${name}`, export: "program" });
  }

  cpSync(join(ROOT, "next/apps/fabrika/src"), join(home, "src"), {
    recursive: true,
    filter: (p) => !p.endsWith(".test.ts"),
  });
  vi.stubEnv("TYPESAFE_API_KEY", undefined);
  vi.stubEnv("FABRIKA_HOME", home);
  return {
    home,
    options: {
      out: join(home, "dist"),
      root: home,
      entry: join(home, "src/brain.ts"),
      programs,
      files: [],
      ledger: [],
      chaos: false,
    },
  };
};

const api = async () => {
  const file = join(import.meta.dirname, "build.ts");
  assert(existsSync(file), "P16 not built: libfabrika/build reusable one-file build is absent");
  return vi.importActual<Build>(pathToFileURL(file).href);
};

const build = async (options: Parameters<Build["build"]>[0]) =>
  Effect.runPromise((await api()).build(options).pipe(Effect.provide(NodeServices.layer)));

const strings = (source: string) => {
  const parsed = parseSync("brain.mjs", source);
  assert.equal(parsed.errors.length, 0);
  const found: string[] = [];
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== "object") {
      return;
    }

    if ("type" in x && x.type === "Literal" && "value" in x && typeof x.value === "string") {
      found.push(x.value);
    }

    for (const child of Object.values(x)) {
      visit(child);
    }
  };
  visit(parsed.program);
  return found;
};

const embedded = (brain: string, sources: readonly string[]) => {
  assert(sources.length > 0);

  for (const source of sources) {
    assert(strings(brain).includes(source), "compiled text changed or executed");
  }
};

const inert = (file: string) =>
  execFileSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--input-type=module",
      "-e",
      `
import {readFileSync} from 'node:fs';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
const context=createContext({console,TextEncoder,TextDecoder,URL,URLSearchParams,crypto,fetch,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone,performance,Buffer,process:{env:{NODE_ENV:'test'}}});
const module=new SourceTextModule(readFileSync(process.argv[1],'utf8'),{context});
await module.link(async name=>{const values=name==='cloudflare:workers'?{DurableObject:class{},WorkerEntrypoint:class{},RpcTarget:class{},env:{}}:name.startsWith('node:')?await import(name):(()=>{throw Error('unfinished bundle '+name)})();return new SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v)},{context})});
await module.evaluate(); if(context.__p16Inner!==undefined)throw Error('inner code executed');
`,
      file,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

const observe = async () => {
  const emitted: string[] = [];
  const native = await vi.importActual<{
    rolldown: (o: RolldownOptions) => Promise<{
      generate: (o: OutputOptions) => Promise<RolldownOutput>;
      close: () => Promise<void>;
    }>;
  }>("rolldown");
  vi.doMock("rolldown", () => ({
    ...native,
    rolldown: async (options: RolldownOptions) => {
      const handle = await native.rolldown(options);
      return {
        ...handle,
        generate: async (o: OutputOptions) => {
          const out = await handle.generate(o);

          for (const item of out.output) {
            emitted.push(
              item.type === "chunk"
                ? item.code
                : typeof item.source === "string"
                  ? item.source
                  : new TextDecoder().decode(item.source),
            );
          }

          return out;
        },
        close: () => handle.close(),
      };
    },
  }));
  vi.resetModules();
  return emitted;
};

afterEach(() => {
  vi.doUnmock("rolldown");
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();

  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("P16 p33 one-file build", () => {
  it(
    "text embedding: generated compiled bytes survive exactly and outer import is inert",
    { timeout: buildTimeout() },
    async () => {
      await fc.assert(
        fc.asyncProperty(graph, async ({ text, count, chaos }) => {
          const actual = await observe();
          const f = fixture(text, count),
            built = await build({ ...f.options, chaos });
          const bytes = readFileSync(built.brain, "utf8");
          embedded(bytes, [
            ...Object.values(built.programs).map((p) => p.source),
            ...Object.values(built.assets).map((a) => a.body),
          ]);
          const inner = actual.slice(0, -1);
          expect(inner.length).toBeGreaterThanOrEqual(count + 3);
          embedded(bytes, inner);
          expect(Object.keys(built.programs)).toHaveLength(count);

          for (const p of Object.values(built.programs)) {
            expect(p.hash).toBe(sha(p.source));
          }

          inert(built.brain);
          const planted = join(f.home, "executed.mjs");
          writeFileSync(planted, `globalThis.__p16Inner = true;\n${bytes}`);
          expect(() => inert(planted)).toThrow();
        }),
        runs,
      );
    },
  );
  it("same file: clean builds ignore time and checkout path for equal chaos", { timeout: buildTimeout() }, async () => {
    await fc.assert(
      fc.asyncProperty(graph, async ({ text, count, chaos }) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2030-01-01"));
        const a = fixture(text, count),
          first = await build({ ...a.options, chaos });
        vi.setSystemTime(new Date("2031-01-01"));
        const b = fixture(text, count),
          second = await build({ ...b.options, chaos });
        expect(readFileSync(second.brain)).toEqual(readFileSync(first.brain));

        for (const f of [a, b]) {
          expect(readFileSync(first.brain, "utf8")).not.toContain(f.home);
        }

        expect(readdirSync(join(a.home, "dist")).filter((p) => /\.(?:m?js|css)$/.test(p))).toEqual(["brain.mjs"]);
        // Plants: a checkout path or a build time inside the bytes. Each clock was faked above.
        const bytes = readFileSync(second.brain, "utf8");

        for (const marker of [
          a.home,
          b.home,
          String(new Date("2030-01-01").getTime()),
          String(new Date("2031-01-01").getTime()),
          "2030-01-01T",
          "2031-01-01T",
        ]) {
          expect(bytes, "no build time or checkout location in the brain").not.toContain(marker);
        }

        expect(sha(readFileSync(second.brain))).toBe(second.build);
      }),
      runs,
    );
  });
  it(
    "table: duplicate selections fail with a typed error and keep the last good file",
    { timeout: buildTimeout() },
    async () => {
      await fc.assert(
        fc.asyncProperty(text, async (value) => {
          const f = fixture(value),
            previous = `last-good-${value}`;
          mkdirSync(f.options.out);
          writeFileSync(join(f.options.out, "brain.mjs"), previous);
          const result = await Effect.runPromise(
            Effect.result(
              (await api()).build({
                ...f.options,
                programs: [f.options.programs[0]!, f.options.programs[0]!],
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          );
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "BuildError", reason: "table" },
          });
          expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(previous);
        }),
        runs,
      );
    },
  );
  it(
    "table: a selection name or export that is not a whole name fails typed and keeps the last good file",
    { timeout: buildTimeout() },
    async () => {
      // Each bad text has a good name inside it, so a check on only its start or end lets it pass.
      const word = fc.stringMatching(/^[A-Za-z_][\w]{0,6}$/);
      const bad = fc.oneof(
        fc.tuple(fc.constantFrom("1", "-", " ", ".", "/"), word).map(([a, b]) => a + b),
        fc.tuple(word, fc.constantFrom(" ", ".", "/", ":", '"', "\n"), word).map((p) => p.join("")),
      );
      const f = fixture("table"),
        previous = "last-good-table";
      mkdirSync(f.options.out);
      writeFileSync(join(f.options.out, "brain.mjs"), previous);
      const selection = f.options.programs[0]!;
      await fc.assert(
        fc.asyncProperty(bad, fc.constantFrom("name", "export"), async (value, field) => {
          const result = await Effect.runPromise(
            Effect.result(
              (await api()).build({
                ...f.options,
                programs: [{ ...selection, [field]: value }],
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          );
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "BuildError", reason: "table" },
          });
          expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(previous);
        }),
        { ...runs, numRuns: 30 },
      );
    },
  );
  it(
    "plants: actual Rolldown bytes catch escaping, newline normalization and executable source",
    { timeout: buildTimeout(8) },
    async () => {
      await fc.assert(
        fc.asyncProperty(text, async (value) => {
          const f = fixture(value),
            file = join(f.home, "inner.ts");
          writeFileSync(file, `export const text=${JSON.stringify(`${value}\r\n\\雪</script>`)};`);
          const handle = await rolldown({ input: file });
          let source = "";

          try {
            const out = await handle.generate({ format: "esm" });

            for (const item of out.output) {
              if (item.type === "chunk") {
                source = item.code;
              }
            }
          } finally {
            await handle.close();
          }

          embedded(`export const source=${JSON.stringify(source)};`, [source]);

          for (const changed of [source.replaceAll("\\r\\n", "\\n"), source.replaceAll("\\\\", "\\"), `${source}\n`]) {
            assert.notEqual(changed, source);
            expect(() => embedded(`export const source=${JSON.stringify(changed)}`, [source])).toThrow(
              "compiled text changed",
            );
          }

          expect(() => embedded(source, [source])).toThrow("compiled text changed");
        }),
        { ...runs, numRuns: 8 },
      );
    },
  );
});

// P14 (A10): the tab's page and script in P16's tables.
/** A module specifier naming a `node:` module: an import, a re-export, a dynamic import, a require
 *  or Node's `getBuiltinModule`, as Effect's async-hooks probe names one. React DOM's minified
 *  object key `{node:n}` is not one. */
const NODE_NAME = /(?:\b(?:from|import|require|getBuiltinModule)\s*\(?\s*|\?\.\s*\(\s*)["'`]node:/;

/** Any import of another module: a static import or re-export, or a dynamic import of a path. */
const IMPORTS =
  /(?:^|[;}\n])\s*(?:import\s*(?:[\w$*{][^;]*?\bfrom\s*)?["'`]|export\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*["'`])|\bimport\s*\(\s*["'`]/;

const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";

const parsedRules = (css: string): unknown => {
  let rules: Rule[] = [];
  transform({
    filename: "law.css",
    code: Buffer.from(css),
    visitor: {
      StyleSheet: (sheet) => {
        rules = sheet.rules;
      },
    },
  });
  return JSON.parse(JSON.stringify(rules, (key, value) => (key === "loc" ? undefined : value)));
};

/** The rules of every `<style>` in the page, in document order, as one list. */
const pageRules = (page: string): unknown =>
  parsedRules([...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n"));

const tabCase = fc.record({
  marks: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/), { minLength: 2, maxLength: 3 }),
  label: fc.stringMatching(/^[a-z0-9 ]{1,16}$/),
});

/** A tab entry with one view (TSX, so it goes through the Compiler) and Effect, and its stylesheets. */
const tabFixture = (marks: readonly string[], label: string) => {
  const f = fixture("tab");
  const dir = join(f.home, "tab");
  mkdirSync(dir);
  const view = join(dir, "view.tsx");
  writeFileSync(view, `export const Tip = () => <b>${label}</b>;`);
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import {Effect} from "effect"; import {Tip} from "./view.tsx"; export const mounted = [Tip, Effect.succeed(${JSON.stringify(label)})];`,
  );
  const styles = marks.map((mark, n) => {
    const file = join(dir, `s${n}.css`);
    writeFileSync(file, `.${mark} { --p14-order: ${n}; }\n.${mark} b { color: red; }\n`);
    return file;
  });
  return { ...f, view, entry, styles, options: { ...f.options, tab: { entry, styles } } };
};

const snapshot = (dir: string) =>
  readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name)).toString("base64")]);

describe("P14 the tab's page and script ride in the one build (A10)", () => {
  it(
    "the tab's entry is one script at /window.js naming no node: module, and /index.html holds the styles in order and loads it",
    { timeout: buildTimeout() * 2 },
    async () => {
      await fc.assert(
        fc.asyncProperty(tabCase, async ({ marks, label }) => {
          const f = tabFixture(marks, label);
          const built = await build(f.options);
          const script = built.assets["/window.js"];
          const page = built.assets["/index.html"];
          expect(script?.type, "the tab's script is in the table").toBe(JS);
          expect(page?.type, "the page is in the table").toBe(HTML);
          expect(script!.hash).toBe(sha(script!.body));
          expect(page!.hash).toBe(sha(page!.body));
          expect(script!.body).toContain(label);
          expect(script!.body, "the tab's script names no node: module").not.toMatch(NODE_NAME);
          expect(script!.body, "the tab's script is one module and imports nothing").not.toMatch(IMPORTS);
          expect(page!.body).toMatch(/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/window\.js")[^>]*>/);
          const given = marks.map((_, n) => readFileSync(f.styles[n]!, "utf8"));
          expect(pageRules(page!.body), "the page holds every style's rules, in the given order").toEqual(
            parsedRules(given.join("\n")),
          );
          // Plant: the same styles in another order are caught by that check.
          expect(pageRules(page!.body)).not.toEqual(parsedRules([...given].reverse().join("\n")));
          expect(readdirSync(f.options.out), "only the brain is published").toEqual(["brain.mjs"]);
          embedded(readFileSync(built.brain, "utf8"), [script!.body, page!.body]);
          // Without a tab, neither route exists.
          const bare = await build({ ...fixture("bare").options });
          expect(Object.keys(bare.assets)).not.toContain("/index.html");
          expect(Object.keys(bare.assets)).not.toContain("/window.js");
        }),
        runs,
      );
    },
  );

  // Plant for the two checks above: each way a script names a node: module or another module is
  // caught, and a minified object key `node:` or a word `import` inside a name is not.
  it("the node: and import checks catch every form and pass an object key", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z_]{1,12}$/),
        fc.constantFrom("'", '"', "`"),
        fc.constantFrom(" ", "", "\n  "),
        (module, q, gap) => {
          for (const form of [
            `import x from${gap}${q}node:${module}${q};`,
            `import${gap}${q}node:${module}${q};`,
            `export {x} from${gap}${q}node:${module}${q};`,
            `const m = import(${gap}${q}node:${module}${q});`,
            `const m = require(${gap}${q}node:${module}${q});`,
            `globalThis.process?.getBuiltinModule?.(${q}node:${module}${q})`,
          ]) {
            expect(`a();${form}b();`, form).toMatch(NODE_NAME);
          }

          for (const form of [
            `import x from${gap}${q}./${module}.js${q};`,
            `import{a}from${q}./${module}.js${q};`,
            `import${gap}${q}./${module}.js${q};`,
            `export * from ${q}./${module}.js${q};`,
            `export{a}from${q}./${module}.js${q};`,
            `const m = import(${gap}${q}./${module}.js${q});`,
          ]) {
            expect(`a();${form}b();`, form).toMatch(IMPORTS);
          }

          expect(`var o={node:${module},offset:1};f({node:n});`).not.toMatch(NODE_NAME);
          expect(`var ${module}import=1;export{${module}import as default};`).not.toMatch(IMPORTS);
          expect(`throw Error("cannot import ${module} from here");`).not.toMatch(IMPORTS);
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });

  for (const [plant, source] of [
    [
      "skipped function",
      'import {useRef} from "react"; export const Tip = () => {const r = useRef(1); return <b>{r.current}</b>;}',
    ],
    ["purity error", "export const Tip = () => <b>{Date.now()}</b>;"],
    ["unlisted directive", 'export const Tip = () => {"use no memo"; return <b>ok</b>;}'],
  ] as const) {
    it(
      `a Compiler finding in the tab's views publishes nothing: ${plant}`,
      { timeout: buildTimeout() * 2 },
      async () => {
        await fc.assert(
          fc.asyncProperty(tabCase, async ({ marks, label }) => {
            const f = tabFixture(marks, label);
            await build(f.options);
            const before = snapshot(f.options.out);
            writeFileSync(f.view, source);
            const failed = await Effect.runPromise(
              Effect.result((await api()).build(f.options)).pipe(Effect.provide(NodeServices.layer)),
            );
            expect(failed, "the tab's TSX is checked even with files: []").toMatchObject({
              _tag: "Failure",
              failure: { _tag: "BuildError", reason: "compiler" },
            });
            expect(snapshot(f.options.out)).toEqual(before);
            expect(readdirSync(f.home).filter((n) => n.startsWith(".fabrika-build-"))).toEqual([]);
          }),
          runs,
        );
      },
    );
  }

  it(
    "a tab entry that cannot bundle publishes nothing and leaves no temporary folder",
    { timeout: buildTimeout() * 2 },
    async () => {
      await fc.assert(
        fc.asyncProperty(tabCase, async ({ marks, label }) => {
          const f = tabFixture(marks, label);
          await build(f.options);
          const before = snapshot(f.options.out);
          writeFileSync(f.entry, 'import {gone} from "./nothing-here.ts"; export const x = gone; ((');
          const failed = await Effect.runPromise(
            Effect.result((await api()).build(f.options)).pipe(Effect.provide(NodeServices.layer)),
          );
          expect(failed).toMatchObject({ _tag: "Failure", failure: { _tag: "BuildError" } });
          expect(snapshot(f.options.out)).toEqual(before);
          expect(readdirSync(f.home).filter((n) => n.startsWith(".fabrika-build-"))).toEqual([]);
        }),
        runs,
      );
    },
  );

  it(
    "a good rebuild replaces the script, and the page, the brain and its hash follow it",
    { timeout: buildTimeout() * 2 },
    async () => {
      await fc.assert(
        fc.asyncProperty(tabCase, fc.stringMatching(/^[a-z0-9]{8,16}$/), async ({ marks, label }, mark) => {
          const f = tabFixture(marks, label);
          const first = await build(f.options);
          const word = `p14-rebuild-mark-${mark}`;
          writeFileSync(f.view, `export const Tip = () => <b>{${JSON.stringify(word)}}</b>;`);
          const second = await build(f.options);
          expect(first.assets["/window.js"], "the tab's script is in the table").toBeDefined();
          expect(first.assets["/window.js"]?.body).not.toContain(word);
          expect(second.assets["/window.js"]?.body).toContain(word);
          expect(second.build).not.toBe(first.build);
          expect(second.build).toBe(sha(readFileSync(second.brain)));
          embedded(readFileSync(second.brain, "utf8"), [second.assets["/window.js"]!.body]);
        }),
        runs,
      );
    },
  );
});
