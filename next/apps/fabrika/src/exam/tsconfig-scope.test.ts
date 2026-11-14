// e2e typecheck, next/. Every TypeScript file of a next/ package is in the program its `typecheck`
// script checks. The app's tsconfig once named its files by hand, and `e2e/` and `e2e.ts` were never
// on the list, so 19 type errors stood there unseen from 2026-11-06 (0524: no list lets broken code
// pass). These laws read each package's real program through the tsgo API, as `secret-types.test.ts`
// does, and plant files in temp folders that are acquired in a scope (0061). Nothing is written inside
// the repo.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import fc from "fast-check";
import { API } from "typescript/unstable/sync";

/** A tracked TypeScript file that its package's program does not hold. */
type Gap = { readonly package: string; readonly file: string };

const TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/;

/** The one script each package's `typecheck` runs, so the tsconfig opened here is the one checked. */
const TYPECHECK = "tsc --noEmit -p .";

const SEED = 119120;

const Manifest = Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) });

const readManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", { code: Schema.Number }) {}

/** A property fast-check found false, with its counterexample in the cause. */
class Falsified extends Schema.TaggedError<Falsified>()("Falsified", { cause: Schema.Defect() }) {}

/** Runs one fast-check `assert`; a counterexample fails the test as `Falsified`. */
const falsified = (check: () => Promise<void>) =>
  Effect.tryPromise({ try: check, catch: (cause) => new Falsified({ cause }) });

/** One tsgo API process for `cwd`, closed with the scope. */
const api = (cwd: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new API({ cwd })),
    (opened) => Effect.sync(() => opened.close()),
  );

/** One snapshot with these projects open, disposed with the scope. */
const snapshot = (opened: API, configs: ReadonlyArray<string>) =>
  Effect.acquireRelease(
    Effect.sync(() => opened.updateSnapshot({ openProjects: [...configs] })),
    (taken) => Effect.sync(() => taken.dispose()),
  );

/**
 * Every file `tracked` lists under one of `packages` (repo-relative folders under `root`) that the
 * program of that package's own `tsconfig.json` does not hold. A project the API cannot open
 * reports every file of its package, never none.
 */
const outside = Effect.fnUntraced(function* (
  root: string,
  packages: ReadonlyArray<string>,
  tracked: ReadonlyArray<string>,
) {
  const path = yield* Path.Path;
  const configs = packages.map((p) => path.join(root, p, "tsconfig.json"));
  const taken = yield* snapshot(yield* api(root), configs);

  return packages.flatMap((p, i): Array<Gap> => {
    const config = configs[i];
    const project = config === undefined ? undefined : taken.getProject(config);
    const held = new Set(project?.program.getSourceFileNames().map((f) => path.relative(root, f)) ?? []);
    return tracked.filter((f) => f.startsWith(`${p}/`) && !held.has(f)).map((file) => ({ package: p, file }));
  });
}, Effect.scoped);

/** The repo's root, as its real path, so a linked temp or home folder compares equal. */
const repoRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.realPath(path.resolve(import.meta.dirname, "../../../../.."));
});

/** Every TypeScript file git tracks under `next/`, or would track: untracked files not ignored count too. */
const trackedTypeScript = Effect.fnUntraced(function* (root: string) {
  const run = yield* ChildProcess.make(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "next/"],
    { cwd: root },
  );
  const [out, code] = yield* Effect.all([run.stdout.pipe(Stream.decodeText(), Stream.mkString), run.exitCode], {
    concurrency: 2,
  });

  if (code !== 0) {
    return yield* new GitFailed({ code });
  }

  return out.split("\0").filter((f) => TYPESCRIPT.test(f));
}, Effect.scoped);

/** Every `next/<group>/<name>` folder that holds a package manifest, with its manifest's scripts. */
const nextPackages = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<{ readonly dir: string; readonly typecheck: string | undefined }> = [];

  for (const group of (yield* fs.readDirectory(path.join(root, "next"))).sort()) {
    const groupDir = path.join(root, "next", group);

    if ((yield* fs.stat(groupDir)).type !== "Directory") {
      continue;
    }

    for (const name of (yield* fs.readDirectory(groupDir)).sort()) {
      const manifest = path.join(groupDir, name, "package.json");

      if (!(yield* fs.exists(manifest))) {
        continue;
      }

      const { scripts } = yield* readManifest(yield* fs.readFileString(manifest));
      found.push({ dir: `next/${group}/${name}`, typecheck: scripts?.["typecheck"] });
    }
  }

  return found;
});

it.effect(
  "pinned: e2e typecheck gap, every tracked TypeScript file of each next/ package is in the program its typecheck script checks",
  () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      const packages = yield* nextPackages(root);
      const tracked = yield* trackedTypeScript(root);

      expect(packages.length).toBeGreaterThan(0);
      expect(packages.filter((p) => p.typecheck !== TYPECHECK).map((p) => p.dir)).toEqual([]);
      expect(tracked.filter((f) => !packages.some((p) => f.startsWith(`${p.dir}/`)))).toEqual([]);

      const gaps = yield* outside(
        root,
        packages.map((p) => p.dir),
        tracked,
      );
      expect(gaps.map((g) => `${g.package}: ${g.file}`)).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  60_000,
);

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

const Planted = fc.record({
  folder: fc.oneof(
    fc.constantFrom("e2e", "e2e/node", ""),
    word.map((w) => `e2e/${w}`),
  ),
  name: word,
  suffix: fc.constantFrom(".test.ts", ".test-support.ts", ".laws.test.ts", ".ts"),
  word,
});

type Plant = typeof Planted extends fc.Arbitrary<infer T> ? T : never;

const APP = "next/apps/fabrika";

/**
 * Plants `export const planted: number = "<word>";` at the generated path of a temp copy of the app,
 * which holds the base tsconfig and the app's real `tsconfig.json` at their repo paths and links the
 * root's and the app's `node_modules`, so types and Effect's plugin resolve as on the tree. Answers
 * whether the program holds the file and the diagnostics on it, as code and line.
 */
const plantTypeError = Effect.fnUntraced(function* (planted: Plant) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const at = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "tsconfig-scope-" }));
  const app = path.join(at, APP);
  yield* fs.makeDirectory(app, { recursive: true });
  yield* fs.copyFile(path.join(root, "tsconfig.base.json"), path.join(at, "tsconfig.base.json"));
  yield* fs.copyFile(path.join(root, APP, "tsconfig.json"), path.join(app, "tsconfig.json"));
  yield* fs.symlink(path.join(root, "node_modules"), path.join(at, "node_modules"));
  yield* fs.symlink(path.join(root, APP, "node_modules"), path.join(app, "node_modules"));

  const file = path.join(app, planted.folder, `${planted.name}${planted.suffix}`);
  const text = `export const planted: number = "${planted.word}";\n`;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, text);

  const config = path.join(app, "tsconfig.json");
  const project = (yield* snapshot(yield* api(at), [config])).getProject(config);

  if (project === undefined) {
    return yield* Effect.die(new Error(`the API opened no project at ${config}`));
  }

  const { program } = project;
  const held = program.getSourceFileNames().includes(file);
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter((d) => d.fileName === file)
    .map((d) => ({ code: d.code, line: text.slice(0, d.pos).split("\n").length }));
  return { held, diagnostics };
}, Effect.scoped);

it.effect(
  "a planted type error in any new TypeScript file of next/apps/fabrika fails its type check",
  () =>
    falsified(() =>
      fc.assert(
        fc.asyncProperty(Planted, (planted) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { held, diagnostics } = yield* plantTypeError(planted);
              expect(diagnostics).toEqual([{ code: 2322, line: 1 }]);
              expect(held).toBe(true);
            }).pipe(Effect.provide(NodeServices.layer)),
          ),
        ),
        {
          seed: SEED,
          numRuns: 5,
          // The bug's file: e2e/node/P19Launchd.test-support.ts sent SIGTERM unseen until this law.
          examples: [[{ folder: "e2e/node", name: "P19Launchd", suffix: ".test-support.ts", word: "milk" }]],
        },
      ),
    ),
  120_000,
);

const segment = /^[a-z][a-z0-9]{0,6}$/;

const Scoped = fc.record({
  name: fc.stringMatching(segment),
  files: fc.uniqueArray(
    fc
      .record({
        under: fc.boolean(),
        dirs: fc.array(fc.stringMatching(segment), { maxLength: 2 }),
        name: fc.stringMatching(segment),
        ext: fc.constantFrom(".ts", ".tsx"),
      })
      .map(({ under, dirs, name, ext }) => [...(under ? ["src"] : []), ...dirs, `${name}${ext}`].join("/")),
    { minLength: 1, maxLength: 12 },
  ),
});

it.effect(
  "outside names each generated file left out of a package's include, and none it holds",
  () =>
    falsified(() =>
      fc.assert(
        fc.asyncProperty(Scoped, ({ name, files }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const at = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "tsconfig-scope-" }));
              const pkg = `next/programs/${name}`;
              const dir = path.join(at, pkg);
              yield* fs.makeDirectory(dir, { recursive: true });
              yield* fs.writeFileString(
                path.join(dir, "tsconfig.json"),
                JSON.stringify({ compilerOptions: { strict: true, types: [] }, include: ["src"] }),
              );

              for (const file of files) {
                const full = path.join(dir, file);
                yield* fs.makeDirectory(path.dirname(full), { recursive: true });
                yield* fs.writeFileString(full, "export {};\n");
              }

              const tracked = files.map((f) => `${pkg}/${f}`);
              const gaps = yield* outside(at, [pkg], tracked);
              expect(gaps.map((g) => g.file).sort()).toEqual(
                tracked.filter((f) => !f.startsWith(`${pkg}/src/`)).sort(),
              );
              expect(gaps.every((g) => g.package === pkg)).toBe(true);
            }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
          ),
        ),
        { seed: SEED, numRuns: 10 },
      ),
    ),
  120_000,
);
