// P16, next/. P12's out/files/ledger inputs remain. P16 adds the client's entry, resolution
// root and explicit program selections. Implementation owns those signature adjustments.
// Builder contract: `libfabrika/src/build.ts` exports `build(options)`, an Effect that needs
// FileSystem and Path and fails with BuildError's `reason`.
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
import { parseSync } from "oxc-parser";
import { rolldown, type RolldownOptions, type OutputOptions, type RolldownOutput } from "rolldown";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
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
