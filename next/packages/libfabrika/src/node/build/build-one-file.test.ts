// P16, next/. P12's out/files/ledger inputs remain. P16 adds the client's entry, resolution
// root and explicit program selections. Implementation owns those signature adjustments.
// Builder contract: `libfabrika/src/build.ts` exports `build(options)`, an Effect that needs
// FileSystem and Path and fails with BuildError's `reason`.
// P14 slice 1 (ticket 698): `build` also takes `tab: {entry, styles}`, a browser entry and its
// stylesheets in the order the page applies them. The tab's own Rolldown call compiles the entry
// into `/window.js` and emits the page at `/index.html` (`text/html; charset=utf-8`), which embeds
// every stylesheet in order and loads `/window.js`. Without `tab` neither route exists.
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
import { Effect, Tracer } from "effect";
import * as fc from "fast-check";
import { type Rule, transform } from "lightningcss";
import { parseSync } from "oxc-parser";
import { rolldown, type RolldownOptions, type OutputOptions, type RolldownOutput } from "rolldown";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../../../..");
const homes: string[] = [];
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
// The brain's exact bytes as one string: latin1 maps each byte 0 to 255 to one char.
const brainBytes = (file: string) => readFileSync(file, "latin1");

const text = fc
  .array(fc.constantFrom("雪", "🫖", "'", '"', "\\", "\r\n", "\n", "</script>", "a"), {
    minLength: 1,
    maxLength: 12,
  })
  .map((xs) => xs.join(""));

const graph = fc.record({ text, chaos: fc.boolean(), count: fc.integer({ min: 1, max: 3 }) });
const runs = { seed: 119120, numRuns: 3 };
// A clean build measured 0.12 to 0.3 s on a laptop; 10 s per generated sample is the budget.
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

  for (const name of ["effect", "@demlik", "@kampus", "@alchemy.run"]) {
    symlinkSync(join(ROOT, "next/apps/fabrika/node_modules", name), join(home, "node_modules", name), "dir");
  }

  const programs: Selection[] = [];
  symlinkSync(join(import.meta.dirname, "../../../node_modules/react"), join(home, "node_modules/react"));

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
  // Plants: normalize embedded newlines, or build this Set from sources instead of brain.
  const found = new Set(strings(brain));

  for (const source of sources) {
    assert(found.has(source), "compiled text changed or executed");
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
  it("scenario: latin1 preserves an invalid UTF-8 byte difference that utf8 hides", () => {
    // Plant: make brainBytes read utf8; replacement characters hide this byte difference.
    const home = mkdtempSync("/tmp/fh.");
    homes.push(home);
    const first = join(home, "first.mjs");
    const second = join(home, "second.mjs");
    writeFileSync(first, Buffer.from([0x61, 0xff, 0x62]));
    writeFileSync(second, Buffer.from([0x61, 0xfe, 0x62]));
    expect(readFileSync(second, "utf8")).toBe(readFileSync(first, "utf8"));
    expect(brainBytes(second)).not.toBe(brainBytes(first));
  });
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
        // Plants: publish `// ${new Date().getUTCFullYear() % 7}`, or flip one byte of the second brain.
        expect(brainBytes(second.brain), "two clean builds write the same bytes").toBe(brainBytes(first.brain));

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

// P14 slice 1 (ticket 698): S1.1, S1.2 and S1.7. Each is a generated walk from a fixture with no
// output yet. Every step reads the walk's state (the tab's files now, the last good output, which
// faults the files hold) and picks a move that state allows; the build runs for real each time.
// Build walks are slow (a tab build bundles Effect and React's JSX runtime), so each runs a small
// fixed count: 4 walks of up to 4 builds, about a minute on a laptop.
const walks = { seed: 119120, numRuns: 4 };
const walkTimeout = buildTimeout(walks.numRuns * 5);
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const PAGE = "/index.html";
const SCRIPT = "/window.js";
const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/** A module specifier naming a `node:` module: an import, a re-export, a dynamic import, a require
 *  or Node's `getBuiltinModule`, as Effect's async-hooks probe names one. A minified `{node:n}` key is not. */
const NODE_NAME = /(?:\b(?:from|import|require|getBuiltinModule)\s*\(?\s*|\?\.\s*\(\s*)["'`]node:/;

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

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;
// A style element ends at its first `</style`, as an HTML tokenizer reads raw text; what is left is markup.
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

/** One Rolldown call as the build made it: its input and every file it emitted, by name. */
type Call = {
  readonly input: unknown;
  readonly files: ReadonlyArray<{ readonly fileName: string; readonly type: string; readonly text: string }>;
};

// The real Rolldown, observed per call. A page made after the tab's call is in no call's output.
const observeCalls = async () => {
  const calls: Call[] = [];
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
          calls.push({
            input: options.input,
            files: out.output.map((item) => ({
              fileName: item.fileName,
              type: item.type,
              text:
                item.type === "chunk"
                  ? item.code
                  : typeof item.source === "string"
                    ? item.source
                    : new TextDecoder().decode(item.source),
            })),
          });
          return out;
        },
        close: () => handle.close(),
      };
    },
  }));
  vi.resetModules();
  return calls;
};

/** Every span a build opened, with its attributes, events and end, as plain data. */
const tracing = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

const runBuild = async (options: Parameters<Build["build"]>[0], tracer?: Tracer.Tracer) => {
  const work = (await api()).build(options);
  return Effect.runPromise(
    Effect.result(tracer === undefined ? work : work.pipe(Effect.withTracer(tracer))).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
};

/** A stylesheet of the walk: its mark, whether its text tries to end its `<style>` element, and
 *  whether the listed file holds only a local `@import` of the file with its rules. */
type Style = { readonly mark: string; readonly trap: boolean; readonly split?: boolean };
/** The tab's files now: the label its view shows and its stylesheets in page order. */
type Tab = { readonly label: string; readonly styles: ReadonlyArray<Style> };
type TabMove = "add" | "bare" | "label" | "style" | "reorder" | "trap" | "split" | "drop" | "same";

// The trap sits in a comment and in a string, so a build that drops comments still meets one.
const styleText = (style: Style, n: number) =>
  `.${style.mark} { --p14-order: ${n}; }\n.${style.mark} b { color: red; }\n${
    style.trap
      ? `/* </style><script>globalThis.__p14Escaped = 1</script><style> */\n.${style.mark}-t { order: ${n}; }\n.${style.mark}-t::after { content: "</style><script>globalThis.__p14Escaped = 2</script><style>"; }\n`
      : ""
  }`;

/** A fixture with one program window and a tab folder whose files the walk rewrites. */
const tabHome = (value: string) => {
  const f = fixture(value);
  const dir = join(f.home, "tab");
  mkdirSync(dir);
  const view = join(dir, "view.tsx");
  const entry = join(dir, "entry.tsx");
  const write = (tab: Tab) => {
    writeFileSync(view, `export const Tip = () => <b>{${JSON.stringify(tab.label)}}</b>;`);
    writeFileSync(
      entry,
      `import {Effect} from "effect"; import {Tip} from "./view.tsx"; export const mounted = [Tip, Effect.succeed(${JSON.stringify(tab.label)})];`,
    );
    return tab.styles.map((style, n) => {
      const file = join(dir, `s${n}.css`);

      if (style.split === true) {
        mkdirSync(join(dir, "parts"), { recursive: true });
        writeFileSync(join(dir, "parts", `s${n}.css`), styleText(style, n));
        writeFileSync(file, `@import "./parts/s${n}.css";\n`);
      } else {
        writeFileSync(file, styleText(style, n));
      }

      return file;
    });
  };
  /** A helper module chain from the entry: `depth` files, the last naming `line`. */
  const chain = (depth: number, line: string) => {
    for (let n = 1; n <= depth; n++) {
      writeFileSync(
        join(dir, `h${n}.ts`),
        n === depth ? line : `export * from "./h${n + 1}.ts"; export const h${n} = ${n};`,
      );
    }

    writeFileSync(
      entry,
      `import {Effect} from "effect"; import {Tip} from "./view.tsx"; ${
        depth === 0 ? line : 'export * from "./h1.ts";'
      } export const mounted = [Tip, Effect.succeed("boundary")];`,
    );
  };
  return { ...f, dir, view, entry, write, chain };
};

/** The temporary folders a build makes beside `out`; none may outlive the build. */
const leftovers = (home: string) =>
  readdirSync(home).filter((n) => n.startsWith(".fabrika-build-") || n.endsWith(".old"));

const outFiles = (out: string) => (existsSync(out) ? snapshot(out) : []);

const snapshot = (dir: string) =>
  readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name)).toString("base64")]);

/** S1.1's check of one successful build against the walk's state. */
const checkCarried = (
  built: Built,
  state: { readonly tab: Tab | null; readonly entry: string; readonly styles: readonly string[] },
  calls: ReadonlyArray<Call>,
  spans: ReadonlyArray<Tracer.NativeSpan>,
  out: string,
) => {
  expect(readdirSync(out), "only the brain is published").toEqual(["brain.mjs"]);
  const brain = readFileSync(built.brain);
  expect(sha(brain), "the build is its brain's hash").toBe(built.build);

  for (const [route, asset] of Object.entries(built.assets)) {
    expect(asset.hash, `${route}'s hash is its own body's`).toBe(sha(asset.body));
  }

  embedded(brain.toString("utf8"), [
    ...Object.values(built.programs).map((p) => p.source),
    ...Object.values(built.assets).map((a) => a.body),
  ]);
  const tabCalls = calls.filter((c) => c.input === state.entry);

  if (state.tab === null) {
    expect(Object.keys(built.assets), "without a tab there is no page").not.toContain(PAGE);
    expect(Object.keys(built.assets), "without a tab there is no tab script").not.toContain(SCRIPT);
    expect(tabCalls).toEqual([]);
  } else {
    const script = built.assets[SCRIPT],
      page = built.assets[PAGE];
    expect(script?.type, "the tab's script is carried").toBe(JS);
    expect(page?.type, "the page is carried").toBe(HTML);
    expect(script!.body).toContain(state.tab.label);
    expect(script!.body, "the tab's script names no node: module").not.toMatch(NODE_NAME);
    // The page comes out of the tab's own call: that one call emitted exactly the carried script and page.
    expect(tabCalls, "one Rolldown call built the tab").toHaveLength(1);
    const [tab] = tabCalls;
    const chunks = tab!.files.filter((x) => x.type === "chunk"),
      pages = tab!.files.filter((x) => x.type === "asset" && x.fileName === "index.html");
    expect(
      chunks.map((c) => c.text),
      "the carried script is the tab call's one chunk",
    ).toEqual([script!.body]);
    expect(
      pages.map((p) => p.text),
      "the carried page is the tab call's own asset",
    ).toEqual([page!.body]);
    expect(tab!.files, "the tab's call emitted nothing the brain does not carry").toHaveLength(2);
    expect(
      calls.filter((c) => c !== tab && c.files.some((x) => x.text === page!.body)),
      "no other call emitted the page",
    ).toEqual([]);
    // Its stylesheets in the given order, each element closed only by itself, and one script: /window.js.
    // The rules are the walk's own: a listed file's local `@import` is inlined, so the page asks for no file.
    const given = state.tab.styles.map((style, n) => styleText(style, n));
    expect(state.styles, "the walk listed one file per stylesheet").toHaveLength(given.length);
    expect(pageRules(page!.body), "the page holds every stylesheet's rules, in order").toEqual(
      parsedRules(given.join("\n")),
    );
    expect(page!.body, "no stylesheet in the page imports another file").not.toMatch(/@import\b/i);
    const markup = page!.body.replace(STYLE, "");
    expect(count(page!.body, STYLE), "one style element per stylesheet").toBe(given.length);
    expect(count(markup, /<\/?style\b/gi), "no stylesheet text ends its element early").toBe(0);
    expect(count(markup, /<script\b/gi), "the page's one script").toBe(1);
    expect(page!.body).toMatch(/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/window\.js")[^>]*>/);
    // Byte accounting: the measured tab call holds the page, and the published window bytes hold it too.
    const tabBytes = tab!.files.reduce((total, x) => total + utf8(x.text), 0);
    const bundles = spans.filter((s) => s.name === "build.bundle");
    expect(
      bundles.some((s) => s.attributes.get("output.bytes") === tabBytes && s.attributes.get("output.files") === 2),
      "the tab's measured call counts its script and its page",
    ).toBe(true);
  }

  const emit = spans.find((s) => s.name === "build.emit");
  expect(emit?.attributes.get("window.bytes"), "the published window bytes are every carried file's").toBe(
    Object.values(built.assets).reduce((total, a) => total + utf8(a.body), 0),
  );
};

const word = fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/);
const choices = fc.array(fc.record({ move: fc.nat(), word }), { minLength: 2, maxLength: 4 });

/** Modules a browser tab has no way to load: Node's and the Workers runtime's. */
const BOUNDARY = ["node:fs", "node:path", "cloudflare:workers", "cloudflare:sockets"] as const;

/** Each way a module can name another, each one that keeps the name in the bundle. */
const NAMING: ReadonlyArray<(specifier: string) => string> = [
  (s) => `import * as m from ${JSON.stringify(s)}; export const used = m;`,
  (s) => `import ${JSON.stringify(s)};`,
  (s) => `export * from ${JSON.stringify(s)};`,
  (s) => `export const later = () => import(${JSON.stringify(s)});`,
];

/** Local references a stylesheet can make to a file next to it. */
const LOCAL_URL = ['"./img.png"', "img.png", "'../tab/img.png'"] as const;
// Each boundary walk builds 3 to 6 times; 8 walks reach every case above from seed 119120.
const boundaryWalks = { seed: 119120, numRuns: 8 };

describe("P14 slice 1: the tab's page and script ride in the one build", () => {
  it(
    "S1.1 generated build walks: a complete tab build carries exactly its emitted page, script and styles; hashes, types and bytes agree",
    { timeout: walkTimeout },
    async () => {
      const reached = new Set<string>();
      await fc.assert(
        fc.asyncProperty(word, choices, async (value, steps) => {
          const calls = await observeCalls();
          const f = tabHome(value);
          let tab: Tab | null = null;
          let last: string | null = null;

          for (const { move, word } of steps) {
            // The moves this state allows: a tab can be added, or a present one edited, restyled,
            // reordered, trapped, split behind a local `@import`, dropped or rebuilt unchanged.
            const allowed: ReadonlyArray<TabMove> =
              tab === null
                ? ["add", "bare"]
                : [
                    "label",
                    ...(tab.styles.length < 3 ? (["style"] as const) : []),
                    ...(tab.styles.length > 1 ? (["reorder"] as const) : []),
                    "trap",
                    "split",
                    "drop",
                    "same",
                  ];
            const chosen: TabMove = allowed[move % allowed.length]!;
            reached.add(chosen);
            const before = tab;
            tab =
              chosen === "add"
                ? { label: `p14-${word}`, styles: [{ mark: `a${word}`, trap: move % 2 === 0 }] }
                : chosen === "bare" || chosen === "drop"
                  ? null
                  : chosen === "label"
                    ? { ...tab!, label: `p14-${word}-${tab!.label.length}` }
                    : chosen === "style"
                      ? { ...tab!, styles: [...tab!.styles, { mark: `s${tab!.styles.length}${word}`, trap: false }] }
                      : chosen === "reorder"
                        ? { ...tab!, styles: [...tab!.styles.slice(1), tab!.styles[0]!] }
                        : chosen === "trap" || chosen === "split"
                          ? {
                              ...tab!,
                              styles: tab!.styles.map((s, n) =>
                                n !== move % tab!.styles.length
                                  ? s
                                  : chosen === "trap"
                                    ? { ...s, trap: !s.trap }
                                    : { ...s, split: s.split !== true },
                              ),
                            }
                          : tab;
            const styles = tab === null ? [] : f.write(tab);

            if (tab?.styles.some((s) => s.trap) === true) {
              reached.add("trapped");
            }

            if (tab?.styles.some((s) => s.split === true) === true) {
              reached.add("imported");
            }

            const { spans, tracer } = tracing();
            const start = calls.length;
            const result = await runBuild(
              { ...f.options, ...(tab === null ? {} : { tab: { entry: f.entry, styles } }) },
              tracer,
            );
            expect(result._tag, `${chosen} builds`).toBe("Success");
            const built = (result as { readonly success: Built }).success;
            checkCarried(built, { tab, entry: f.entry, styles }, calls.slice(start), spans, f.options.out);

            if (chosen === "same") {
              expect(brainBytes(built.brain), "the same inputs build the same bytes").toBe(last);
            }

            if (chosen === "label" && before !== null) {
              expect(built.assets[SCRIPT]?.body, "an edited view replaces the script").not.toContain(
                JSON.stringify(before.label),
              );
            }

            last = brainBytes(built.brain);
          }
        }),
        walks,
      );
      // A run that never reached a tab cannot claim this law.
      expect(reached.has("add"), "the walks built a tab").toBe(true);
      expect(reached.has("trapped"), "the walks built a stylesheet that tries to end its element").toBe(true);
      expect(reached.has("imported"), "the walks built a stylesheet behind a local @import").toBe(true);
      expect([...reached].filter((m) => m !== "add" && m !== "bare").length, "and changed it").toBeGreaterThan(1);
    },
  );

  it(
    "S1.2 generated failure walks: a failed compile, bundle or read keeps the last good brain and leaves no temporary output",
    { timeout: walkTimeout },
    async () => {
      const reached = new Set<string>();
      await fc.assert(
        fc.asyncProperty(word, choices, async (value, steps) => {
          const f = tabHome(value);
          // The walk's state: the tab files as written (with any fault they hold), and the last good output.
          let tab: Tab | null = null;
          let fault: "compiler" | "bundle" | "read" | null = null;
          let good: Array<Array<string>> | null = null;

          for (const { move, word } of steps) {
            // A fault targets a phase this build reaches: a tab's compile, bundle or stylesheet
            // read only once a tab exists; a bad selection table always.
            const allowed = [
              "build",
              ...(tab === null ? (["add"] as const) : (["compiler", "bundle", "read"] as const)),
              "table",
            ] as const;
            const chosen = allowed[move % allowed.length]!;
            let styles: readonly string[] = [];

            if (chosen === "add") {
              tab = { label: `p14-${word}`, styles: [{ mark: `a${word}`, trap: false }] };
            }

            if (tab !== null) {
              styles = f.write(tab);
              fault = chosen === "compiler" || chosen === "bundle" || chosen === "read" ? chosen : null;

              if (fault === "compiler") {
                // A purity error in the tab's TSX: the Compiler check finds it even with `files: []`.
                writeFileSync(f.view, "export const Tip = () => <b>{Date.now()}</b>;");
              }

              if (fault === "bundle") {
                writeFileSync(f.entry, 'import {gone} from "./nothing-here.ts"; export const x = gone; ((');
              }

              if (fault === "read") {
                styles = [...styles, join(f.dir, `missing-${word}.css`)];
              }
            }

            const options = {
              ...f.options,
              ...(chosen === "table" ? { programs: [f.options.programs[0]!, f.options.programs[0]!] } : {}),
              ...(tab === null ? {} : { tab: { entry: f.entry, styles } }),
            };
            const result = await runBuild(options);
            const fails = chosen === "table" || fault !== null;
            reached.add(`${chosen}${good === null ? "" : "-after-good"}`);

            if (fails) {
              expect(result, `${chosen} fails typed`).toMatchObject({
                _tag: "Failure",
                failure: { _tag: "BuildError", ...(chosen === "bundle" ? {} : { reason: chosen }) },
              });
              expect(outFiles(f.options.out), "the last good output, or none, is what stays").toEqual(good ?? []);
            } else {
              expect(result._tag, `${chosen} builds`).toBe("Success");
              good = outFiles(f.options.out);
              expect(good.map(([name]) => name)).toEqual(["brain.mjs"]);
            }

            expect(leftovers(f.home), "no temporary folder outlives an attempt").toEqual([]);
          }
        }),
        walks,
      );
      expect(
        ["compiler", "bundle", "read"].some((fault) => reached.has(`${fault}-after-good`)),
        "a tab fault was reached after a good build",
      ).toBe(true);
    },
  );

  it(
    "S1.2 generated boundary walks: a tab that reaches a node: or cloudflare: module, or a stylesheet that names a local file, fails typed and keeps the last good brain",
    { timeout: buildTimeout(boundaryWalks.numRuns * 6) },
    async () => {
      const reached = new Set<string>();
      await fc.assert(
        fc.asyncProperty(
          word,
          fc.array(fc.record({ move: fc.nat(), word }), { minLength: 3, maxLength: 6 }),
          async (value, steps) => {
            const f = tabHome(value);
            // The walk's state: whether a tab exists, and the last good output (none before the first).
            let tab: Tab | null = null;
            let good: Array<Array<string>> | null = null;

            for (const { move, word } of steps) {
              // A boundary fault needs a tab to reach; before one exists the walk adds it or builds plain.
              const allowed = tab === null ? (["add", "plain"] as const) : (["build", "import", "url"] as const);
              const chosen = allowed[move % allowed.length]!;
              const detail = Math.floor(move / allowed.length);

              if (chosen === "add") {
                tab = { label: `p14-${word}`, styles: [{ mark: `a${word}`, trap: false }] };
              }

              let styles: readonly string[] = tab === null ? [] : f.write(tab);
              let label: string = chosen;

              if (chosen === "import") {
                // The module named, how the tab names it, and how many local modules sit between.
                const specifier = BOUNDARY[detail % BOUNDARY.length]!;
                const form = NAMING[Math.floor(detail / BOUNDARY.length) % NAMING.length]!;
                const depth = Math.floor(detail / (BOUNDARY.length * NAMING.length)) % 3;
                f.chain(depth, form(specifier));
                label = `import-${specifier.split(":")[0]}-${depth === 0 ? "direct" : "transitive"}`;
              }

              if (chosen === "url") {
                // A local file named by `url()`, in the listed stylesheet or in one it imports. The file exists.
                const imported = detail % 2 === 1;
                const ref = LOCAL_URL[Math.floor(detail / 2) % LOCAL_URL.length]!;
                const first = tab!.styles[0]!;
                styles = f.write({ ...tab!, styles: [{ ...first, split: imported }, ...tab!.styles.slice(1)] });
                writeFileSync(join(f.dir, "img.png"), "not a picture");
                writeFileSync(
                  imported ? join(f.dir, "parts", "s0.css") : styles[0]!,
                  `${styleText(first, 0)}.${first.mark}-u { background: url(${ref}); }\n`,
                );
                label = `url-${imported ? "imported" : "listed"}`;
              }

              const result = await runBuild({
                ...f.options,
                ...(tab === null ? {} : { tab: { entry: f.entry, styles } }),
              });
              reached.add(label);

              if (chosen === "import" || chosen === "url") {
                reached.add(`${chosen}${good === null ? "" : "-after-good"}`);
                expect(result._tag, `${label} fails`).toBe("Failure");
                expect(result, `${label} fails typed`).toMatchObject({ failure: { _tag: "BuildError" } });
                expect(outFiles(f.options.out), "the last good output, or none, is what stays").toEqual(good ?? []);
              } else {
                expect(result._tag, `${label} builds`).toBe("Success");
                good = outFiles(f.options.out);
              }

              expect(leftovers(f.home), "no temporary folder outlives an attempt").toEqual([]);
            }
          },
        ),
        boundaryWalks,
      );

      // A run that never reached a case cannot claim it.
      for (const label of [
        "import-node-direct",
        "import-node-transitive",
        "import-cloudflare-direct",
        "import-cloudflare-transitive",
        "url-listed",
        "url-imported",
        "import-after-good",
        "url-after-good",
      ]) {
        expect(reached.has(label), `the walks reached ${label}`).toBe(true);
      }
    },
  );

  it(
    "S1.7 [secrets] generated build and request walks: output, responses, errors and spans copy no unrelated credential",
    { timeout: walkTimeout },
    async () => {
      const { fetch } = await import("../../cloudflare/fetch.ts");
      const secrets = fc.record({
        token: fc.stringMatching(/^[A-Za-z0-9]{20,32}$/).map((s) => `sk-p14-${s}`),
        name: fc.constantFrom("CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN", "FABRIKA_SECRET"),
      });
      const reached = new Set<string>();
      await fc.assert(
        fc.asyncProperty(word, secrets, choices, async (value, { token, name }, steps) => {
          const f = tabHome(value);
          // The credentials sit where a build could pick them up: the environment, a token file in
          // the root and a key file beside the tab's entry. Nothing imports them.
          vi.stubEnv(name, token);
          writeFileSync(join(f.home, ".npmrc"), `//registry.npmjs.org/:_authToken=${token}\n`);
          writeFileSync(join(f.dir, "credentials.json"), JSON.stringify({ token }));
          const forms = [
            token,
            encodeURIComponent(token),
            Buffer.from(token).toString("base64"),
            Buffer.from(token).toString("base64url"),
            Buffer.from(token).toString("hex"),
          ];
          const clean = (output: string, label: string) => {
            for (const form of forms) {
              expect(output.includes(form), `${label} copies no credential`).toBe(false);
            }
          };
          const tab: Tab = { label: `p14-${value}`, styles: [{ mark: `a${value}`, trap: false }] };

          for (const { move, word } of steps) {
            // A failed attempt is possible from any state; a good one repairs the files first.
            const fail = move % 3 === 0;
            const styles = f.write(tab);

            if (fail) {
              writeFileSync(f.view, `export const Tip = () => <b>{Date.now()} ${word}</b>;`);
            }

            const { spans, tracer } = tracing();
            const result = await runBuild({ ...f.options, tab: { entry: f.entry, styles } }, tracer);
            const seen = JSON.stringify(
              spans.map((s) => ({ name: s.name, attributes: [...s.attributes], events: s.events, status: s.status })),
              (_key, v: unknown) => (typeof v === "bigint" ? String(v) : v),
            );

            if (result._tag === "Failure") {
              reached.add("failure");
              clean(JSON.stringify(result.failure), "an error");
              clean(String(result.failure), "an error's text");
              // Spans last: a span that holds a leaked output fails here too, after the output itself.
              clean(seen, "a span");
              continue;
            }

            const built = (result as { readonly success: Built }).success;
            const page = built.assets[PAGE]?.body ?? "";

            for (const [, url] of page.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
              clean(url!, "a page URL");
              clean(decodeURIComponent(url!), "a decoded page URL");
            }

            for (const [route, asset] of Object.entries(built.assets)) {
              clean(route, "a route");
              clean(asset.body, `${route}`);
            }

            clean(readFileSync(built.brain, "latin1"), "the brain");

            // Every carried route as the brain answers it, by its plain and its encoded URL.
            const port = 8787;
            // A file route reaches no object: each binding answers nothing but the name lookup.
            const binding = { getByName: () => ({}) };
            // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only what file routes touch
            const env = {
              PROJECT: binding,
              CONNECTION: binding,
              PROCESS: binding,
              RECORD: binding,
            } as unknown as Parameters<typeof fetch>[1];
            const config = { name: "p14", port, person: "p", founder: "f", window: null, build: built.build };

            for (const route of ["/", ...Object.keys(built.assets)]) {
              for (const url of [route, route.split("/").map(encodeURIComponent).join("/")]) {
                const response = await Effect.runPromise(
                  fetch(
                    new Request(`http://127.0.0.1:${port}${url}`, { headers: { host: `127.0.0.1:${port}` } }),
                    env,
                    config,
                    built.assets,
                  ),
                );
                reached.add(route === "/" && response.headers.get("content-type") === HTML ? "page" : "file");
                clean(response.url, "a response URL");
                clean(JSON.stringify([...response.headers]), "response headers");
                clean(await response.text(), `the answer at ${url}`);
              }
            }

            clean(seen, "a span");
          }
        }),
        walks,
      );
      expect([...reached].sort(), "the walks reached a served page and a failed attempt").toEqual(
        expect.arrayContaining(["failure", "page"]),
      );
    },
  );
});
