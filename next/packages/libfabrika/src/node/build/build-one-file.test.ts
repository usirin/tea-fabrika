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
import { Effect, FileSystem, Path } from "effect";
import * as fc from "fast-check";
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
    const short = `program${n}`,
      name = `p16/${short}`,
      pkg = join(home, "programs", short);
    mkdirSync(pkg, { recursive: true });
    // Workspace packages resolve by name, but their real source is outside node_modules.
    symlinkSync(pkg, join(home, "node_modules/@p16", short), "dir");
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: `@p16/${short}`,
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
    programs.push({ name, package: `@p16/${short}`, export: "program" });
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
      // P40: one `/` between two segments is a qualified name, so a name's bad text puts its
      // separator inside one segment of a good name, and a bare word is bad on its own.
      const word = fc.stringMatching(/^[A-Za-z_][\w]{0,6}$/);
      const separated = (seps: ReadonlyArray<string>) =>
        fc.oneof(
          fc.tuple(fc.constantFrom("1", "-", " ", ".", "/"), word).map(([a, b]) => a + b),
          fc.tuple(word, fc.constantFrom(...seps), word).map((p) => p.join("")),
        );
      const bad = fc.oneof(
        fc.tuple(fc.constant("export" as const), separated([" ", ".", "/", ":", '"', "\n"])),
        fc.tuple(
          fc.constant("name" as const),
          fc.oneof(
            word,
            fc.tuple(word, separated([" ", ".", ":", '"', "\n"])).map(([pack, program]) => `${pack}/${program}`),
            fc.tuple(separated([" ", ".", ":", '"', "\n"]), word).map(([pack, program]) => `${pack}/${program}`),
          ),
        ),
      );
      const f = fixture("table"),
        previous = "last-good-table";
      mkdirSync(f.options.out);
      writeFileSync(join(f.options.out, "brain.mjs"), previous);
      const selection = f.options.programs[0]!;
      await fc.assert(
        fc.asyncProperty(bad, async ([field, value]) => {
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

// P40 slice 1. A program's identity is `pack/program`. The walk holds the module fixtures on disk,
// the current selections, and the last brain the builder published. Each step picks what is
// possible there: select a module under a fresh qualified name, fork a selection into another pack
// under the same short name with its own module, edit a module's body, build, or try a bad build
// that duplicates, mutates or breaks a current selection. A bad build is refused and leaves the
// last published brain byte for byte. Fixtures live in scoped temp folders.
type Pick = { readonly name: string; readonly module: string };

const p40Runs = { seed: 119120, numRuns: 6 };

const nameBreaks: ReadonlyArray<(name: string) => string> = [
  (name) => name.split("/")[1]!,
  (name) => `/${name}`,
  (name) => `${name}/`,
  (name) => name.replace("/", "//"),
  (name) => `${name}/extra`,
  (name) => `../${name}`,
  (name) => name.replace("/", "/./"),
  (name) => name.replace("/", "."),
  (name) => name.replace("/", " "),
  (name) => `${name}${"x".repeat(257 - name.length)}`,
];

const p40Home = Effect.fn("p40.home")(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "p40-" });
  yield* fs.writeFileString(path.join(home, "package.json"), '{"type":"module"}');
  yield* fs.makeDirectory(path.join(home, "node_modules/@p40"), { recursive: true });
  yield* fs.makeDirectory(path.join(home, "programs"));

  for (const name of ["effect", "@demlik", "@kampus", "@alchemy.run"]) {
    yield* fs.symlink(path.join(ROOT, "next/apps/fabrika/node_modules", name), path.join(home, "node_modules", name));
  }

  yield* fs.symlink(
    path.join(import.meta.dirname, "../../../node_modules/react"),
    path.join(home, "node_modules/react"),
  );
  yield* fs.copy(path.join(ROOT, "next/apps/fabrika/src"), path.join(home, "src"));
  return home;
});

// One module fixture: a package that exports `program`, its body carrying the given marker.
const p40Module = Effect.fn("p40.module")(function* (home: string, id: string, marker: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const pkg = path.join(home, "programs", id),
    link = path.join(home, "node_modules/@p40", id);
  yield* fs.makeDirectory(pkg, { recursive: true });

  if (!(yield* fs.exists(link))) {
    yield* fs.symlink(pkg, link);
  }

  yield* fs.writeFileString(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: `@p40/${id}`, type: "module", exports: { ".": "./program.ts" } }),
  );
  yield* fs.writeFileString(
    path.join(pkg, "program.ts"),
    `import {counter} from "@kampus/counter"; globalThis.__p40 = ${JSON.stringify(marker)}; export const program = counter;`,
  );
});

const p40Walk = Effect.fn("p40.walk")(function* (tape: ReadonlyArray<number>) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const { build } = yield* Effect.promise(api);
  const home = yield* p40Home();
  const out = path.join(home, "dist"),
    brain = path.join(out, "brain.mjs");
  const options = { out, root: home, entry: path.join(home, "src/brain.ts"), files: [], ledger: [], chaos: false };
  const markers = new Map<string, string>();
  let selected: ReadonlyArray<Pick> = [],
    published: string | undefined,
    builds = 0,
    refusals = 0,
    forks = 0;

  const addModule = Effect.fnUntraced(function* (n: number) {
    const id = `m${markers.size}`,
      marker = `p40-${id}-${n}`;
    yield* p40Module(home, id, marker);
    markers.set(id, marker);
    return id;
  });
  const selections = (picks: ReadonlyArray<Pick>, exported = (_: Pick) => "program") =>
    picks.map((p) => ({ name: p.name, package: `@p40/${p.module}`, export: exported(p) }));
  const onDisk = Effect.fnUntraced(function* () {
    // The digest of the brain's bytes stands for the bytes: any changed byte changes it.
    return (yield* fs.exists(brain)) ? sha(yield* fs.readFile(brain)) : undefined;
  });

  const good = Effect.fnUntraced(function* () {
    const built = yield* build({ ...options, programs: selections(selected) });
    builds++;
    // L1: the table holds exactly the selected qualified names, each one pack and one program.
    expect(Object.keys(built.programs).sort()).toEqual(selected.map((p) => p.name).sort());

    for (const p of selected) {
      expect(p.name.split("/")).toHaveLength(2);
      const entry = built.programs[p.name]!;
      expect(entry.hash).toBe(sha(entry.source));
      // L3: each entry carries its own module's body and no other module's.
      expect(entry.source, `${p.name} carries ${p.module}`).toContain(markers.get(p.module)!);

      for (const [id, marker] of markers) {
        if (id !== p.module) {
          expect(entry.source, `${p.name} carries only ${p.module}`).not.toContain(marker);
        }
      }
    }

    // L3: equal short names in two packs keep two entries, and different bodies keep two hashes.
    for (const a of selected) {
      for (const b of selected) {
        if (a.name !== b.name && a.name.split("/")[1] === b.name.split("/")[1] && a.module !== b.module) {
          expect(built.programs[a.name]!.hash).not.toBe(built.programs[b.name]!.hash);
        }
      }
    }

    // L4: the brain's embedded table keys each program by its whole qualified name.
    const literals = new Set(strings(yield* fs.readFileString(built.brain)));

    for (const p of selected) {
      expect(literals.has(p.name), `the brain's table keys ${p.name}`).toBe(true);
    }

    published = sha(yield* fs.readFile(built.brain));
    expect(published).toBe(built.build);
  });

  // L5: a refused build changes nothing on disk, whatever was published before it.
  const refused = Effect.fnUntraced(function* (programs: ReturnType<typeof selections>, reason?: string) {
    const result = yield* Effect.result(build({ ...options, programs }));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: reason === undefined ? { _tag: "BuildError" } : { _tag: "BuildError", reason },
    });
    expect(yield* onDisk(), "the last published brain stays").toBe(published);
    refusals++;
  });

  const bad = Effect.fnUntraced(function* (n: number) {
    const target = selected[n % selected.length]!;
    const kind = Math.floor(n / selected.length) % 3;

    if (kind === 0) {
      return yield* refused(selections([...selected, target]), "table");
    }

    if (kind === 1) {
      const broken = nameBreaks[Math.floor(n / selected.length / 3) % nameBreaks.length]!(target.name);
      return yield* refused(selections(selected.map((p) => (p === target ? { ...p, name: broken } : p))), "table");
    }

    // A selection whose module lacks the export it names.
    return yield* refused(selections(selected, (p) => (p === target ? "absent" : "program")));
  });

  const steps: ReadonlyArray<{
    readonly possible: () => boolean;
    readonly run: (n: number) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path>;
  }> = [
    {
      possible: () => true,
      run: Effect.fnUntraced(function* (n) {
        const module = markers.size === 0 || n % 2 === 0 ? yield* addModule(n) : [...markers.keys()][n % markers.size]!;
        selected = [...selected, { name: `pack${n % 3}/program${selected.length}`, module }];
      }),
    },
    {
      possible: () => selected.length > 0,
      run: Effect.fnUntraced(function* (n) {
        const from = selected[n % selected.length]!;
        const short = from.name.split("/")[1]!;
        const pack = `fork${selected.length}`;
        selected = [...selected, { name: `${pack}/${short}`, module: yield* addModule(n) }];
        forks++;
      }),
    },
    {
      possible: () => markers.size > 0,
      run: Effect.fnUntraced(function* (n) {
        const id = [...markers.keys()][n % markers.size]!;
        const marker = `p40-${id}-edit-${n}`;
        yield* p40Module(home, id, marker);
        markers.set(id, marker);
      }),
    },
    { possible: () => selected.length > 0, run: () => good() },
    { possible: () => selected.length > 0, run: (n) => bad(n) },
  ];

  for (const n of tape) {
    const possible = steps.filter((s) => s.possible());
    yield* possible[n % possible.length]!.run(Math.floor(n / possible.length));
  }

  // Every walk ends with a fork, a good build and a bad one, so no law holds on an empty trace.
  const last = tape.at(-1) ?? 0;
  yield* steps[0]!.run(last);
  yield* steps[1]!.run(last);
  yield* good();
  yield* bad(last);
  // Then each way of breaking a name, on one current selection: a table refusal costs no bundle.
  const target = selected[last % selected.length]!;

  for (const broken of nameBreaks) {
    yield* refused(selections(selected.map((p) => (p === target ? { ...p, name: broken(target.name) } : p))), "table");
  }

  expect(builds).toBeGreaterThan(0);
  expect(refusals).toBeGreaterThan(0);
  expect(forks).toBeGreaterThan(0);
});

describe("P40 qualified selections through the real builder", () => {
  it(
    "L1, L3, L4 and L5: qualified selections build and embed under their own names, equal short names keep their own code, and a refused build keeps the last good brain",
    { timeout: 20 * p40Runs.numRuns * 10_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 10 }), async (tape) => {
          await Effect.runPromise(Effect.scoped(p40Walk(tape)).pipe(Effect.provide(NodeServices.layer)));
        }),
        p40Runs,
      );
    },
  );
});
