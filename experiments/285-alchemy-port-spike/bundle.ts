// Experiment 285, next/. Question 3: can Alchemy's bundler carry the brain's compiler plugin and
// program table, how many files come out, and do two bundles of one source give the same bytes?
//
// The table is the real one: the app's own build runs first and its programs and assets are handed
// on. Alchemy's bundler is called the way its Worker resource calls it (`WorkerBundle.build`), then
// the same Worker is started on the local runtime, where Alchemy bundles in watch mode. The table
// reaches the bundle two ways: by our two plugins, and by an alias to files, with no plugin.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { getCompatibility, getToolingCompatibility } from "@alchemy.run/cloudflare/Workers/Compatibility";
import { WorkerBundle, type WorkerBuildOptions } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import { bundle } from "@kampus/libfabrika/node/build";
import * as Alchemy from "alchemy";
import { Deferred, Effect, FileSystem, Path } from "effect";
import * as brainlike from "./brainlike.ts";
import { BuildInput } from "./build-input.ts";
import { call, HOME, median, providers, ROOT, run, save, start } from "./harness.ts";
import { compiler, embed, tableFiles, type Seen } from "./plugins.ts";

const sha = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

const size = (content: string | Uint8Array) =>
  typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength;

type Files = ReadonlyArray<{ readonly path: string; readonly content: string | Uint8Array }>;

const listed = (files: Files) => files.map((f) => ({ path: f.path, bytes: size(f.content), sha: sha(f.content) }));

const code = (files: Files) =>
  files.filter((f) => !f.path.endsWith(".map")).toSorted((a, b) => (a.path < b.path ? -1 : 1));

const same = (a: Files, b: Files) => JSON.stringify(listed(code(a))) === JSON.stringify(listed(code(b)));
const total = (files: Files) => code(files).reduce((sum, f) => sum + size(f.content), 0);

const text = (files: Files, name: string) => {
  const found = files.find((f) => f.path === name)?.content ?? "";
  return typeof found === "string" ? found : new TextDecoder().decode(found);
};

/** Where two texts first differ, with the words around it. */
const firstDifference = (a: string, b: string) => {
  let at = 0;

  while (at < a.length && at < b.length && a[at] === b[at]) {
    at++;
  }

  return at === a.length && at === b.length
    ? null
    : { at, a: a.slice(Math.max(0, at - 30), at + 30), b: b.slice(Math.max(0, at - 30), at + 30) };
};

const ONE_FILE = { codeSplitting: false, sourcemap: false } as const;

await run(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // 1. Today's build of the real brain: the table to embed, and the numbers to compare with.
    const app: typeof import("../../next/apps/fabrika/src/build.ts") = yield* Effect.promise(
      () => import(pathToFileURL(path.join(ROOT, "next/apps/fabrika/src/build.ts")).href),
    );
    const todayMs: Array<number> = [];
    let today = yield* app.build({ out: path.join(HOME, "app-out") });

    for (let n = 0; n < 3; n++) {
      const began = performance.now();
      today = yield* app.build({ out: path.join(HOME, "app-out") });
      todayMs.push(Math.round(performance.now() - began));
    }

    const todayBytes = size(yield* fs.readFileString(today.brain));
    const tables = { programs: today.programs, assets: today.assets };
    const folder = path.join(HOME, "src/table");
    yield* fs.makeDirectory(folder, { recursive: true });

    for (const [name, body] of Object.entries(tableFiles(tables))) {
      yield* fs.writeFileString(path.join(folder, name), body);
    }

    const alias = { "virtual:fabrika-built": path.join(folder, "built.js") };

    // How many `.tsx` files today's real brain entry reaches: what the compiler plugin has to do there.
    const reached = { modules: 0, tsx: 0 };
    yield* bundle(
      path.join(ROOT, "next/apps/fabrika/src/brain.ts"),
      [
        {
          name: "count",
          transform(_code, id) {
            reached.modules++;
            reached.tsx += id.endsWith(".tsx") ? 1 : 0;
          },
        },
        embed({ programs: {}, assets: {} }),
      ],
      { phase: "brain", cwd: ROOT, define: { "globalThis.__ALCHEMY_RUNTIME__": "true" } },
    );

    // 2. Alchemy's bundler, called as its Worker resource calls it.
    const bundler = yield* WorkerBundle;
    const entry = path.join(HOME, "src/brainlike.ts");
    const compatibility = getToolingCompatibility(getCompatibility({ compatibility: { date: "2026-10-12" } }), entry);
    const seen: Seen = { builds: 0, files: 0, typed: 0, memoized: 0 };
    const built = (place: string, extraOptions: WorkerBuildOptions) => {
      const began = performance.now();
      return bundler
        .build({
          id: "BrainLike285",
          main: entry,
          compatibility,
          entry: { kind: "effect", exports: {} },
          stack: { name: "spike285", stage: place },
          extraOptions,
        })
        .pipe(Effect.map((out) => ({ files: out.files as Files, ms: Math.round(performance.now() - began) })));
    };
    const byPlugins = (output?: WorkerBuildOptions["output"]) => ({
      input: { plugins: [compiler(seen), embed(tables)] },
      ...(output === undefined ? {} : { output }),
    });
    const byAlias = (output?: WorkerBuildOptions["output"]) => ({
      input: { resolve: { alias } },
      ...(output === undefined ? {} : { output }),
    });
    yield* built("local", byPlugins()); // warm the bundler, so the three timed runs are alike
    const sawOne = { ...seen };
    const first = yield* built("local", byPlugins());
    const second = yield* built("local", byPlugins());
    const third = yield* built("local", byPlugins());
    const elsewhere = yield* built("cloud", byPlugins());
    const oneFile = yield* built("local", byPlugins(ONE_FILE));
    const oneFileAgain = yield* built("local", byPlugins(ONE_FILE));
    const oneFileElsewhere = yield* built("cloud", byPlugins(ONE_FILE));
    const plain = yield* built("local", byPlugins({ ...ONE_FILE, minify: false }));
    const aliased = yield* built("local", byAlias());
    const aliasedAgain = yield* built("local", byAlias());
    const aliasedOneFile = yield* built("local", byAlias(ONE_FILE));

    // 3. What Node says to a Worker file that names the table module, or a `.tsx` file, at its top.
    const fixed = path.join(HOME, "src/static-table.ts");
    yield* fs.writeFileString(fixed, `import { programs } from "virtual:fabrika-built";\nexport const n = programs;\n`);
    const onNode = (file: string) =>
      Effect.promise(() =>
        import(pathToFileURL(file).href).then(
          () => "imported",
          (error: { code?: string; message?: string }) =>
            `${error.code}: ${String(error.message).replaceAll(HOME, "<home>").slice(0, 120)}`,
        ),
      );
    const atPlan = yield* onNode(fixed);
    const tsxAtPlan = yield* onNode(path.join(HOME, "src/view.tsx"));

    // 4. The same Worker on the local runtime: Alchemy bundles it in watch mode and workerd runs it.
    const served = (input: (typeof BuildInput)["Service"]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const ports = yield* Deferred.make<Record<string, number>>();
          const before = { ...seen };
          const stack = Alchemy.Stack(
            "spike285",
            { providers: providers([], ports), state: Alchemy.localState() },
            brainlike.BrainLike.pipe(
              Effect.map((worker) => ({ url: worker.url })),
              Effect.provide(brainlike.default),
              Effect.provideService(BuildInput, input),
            ),
          );
          const out = (yield* start(stack)) as { url: string };
          const door = out.url.replace(/\/$/, "");
          const answer = yield* call(`${door}/table`);
          const table = (answer.status === 200 ? JSON.parse(answer.text) : { programs: {}, assets: 0 }) as {
            programs: Record<string, { hash: string; same: boolean; bytes: number }>;
            assets: number;
          };
          const [route, asset] = Object.entries(today.assets)[0] ?? ["/none", undefined];
          const reply = yield* call(`${door}${route}`);
          const bundles = path.join(HOME, ".alchemy/bundles");
          const watched: Array<{ path: string; content: Uint8Array }> = [];

          for (const name of yield* fs.readDirectory(bundles, { recursive: true })) {
            const file = path.join(bundles, name);

            if ((yield* fs.stat(file)).type === "File") {
              watched.push({ path: path.basename(name), content: yield* fs.readFile(file) });
            }
          }

          return {
            pluginCalls: { builds: seen.builds - before.builds, files: seen.files - before.files },
            status: answer.status,
            error: answer.status === 200 ? undefined : answer.text.slice(0, 200),
            programs: Object.keys(table.programs).length,
            everyProgramHashHolds:
              Object.keys(table.programs).length > 0 && Object.values(table.programs).every((p) => p.same),
            tableMatchesToday:
              Object.keys(table.programs).length === Object.keys(today.programs).length &&
              Object.entries(table.programs).every(([name, p]) => today.programs[name]?.hash === p.hash),
            assets: table.assets,
            asset: { route, status: reply.status, hashHolds: asset !== undefined && sha(reply.text) === asset.hash },
            watched,
          };
        }),
      );
    const devPlugins = yield* served({ plugins: [compiler(seen), embed(tables)] });
    const devAlias = yield* served({ alias });

    // 5. One bundle for every instance: our build calls Alchemy's bundler once, with the plugins and
    //    a fixed name in place of the instance's, and the stack runs that file with `bundle: false`.
    const shared = yield* built("shared", byPlugins(ONE_FILE));
    const sharedAgain = yield* built("shared", byPlugins(ONE_FILE));
    const sharedFile = path.join(HOME, "shared/brainlike.js");
    yield* fs.makeDirectory(path.dirname(sharedFile), { recursive: true });
    yield* fs.writeFileString(sharedFile, text(shared.files, "brainlike.js"));
    const devShared = yield* Effect.scoped(
      Effect.gen(function* () {
        const ports = yield* Deferred.make<Record<string, number>>();
        const stack = Alchemy.Stack(
          "spike285",
          { providers: providers([], ports), state: Alchemy.localState() },
          Cloudflare.Workers.Worker("BrainLike285", {
            main: sharedFile,
            bundle: false,
            compatibility: { date: "2026-10-12" },
            observability: { enabled: false },
            dev: { host: "127.0.0.1" },
          }).pipe(Effect.map((worker) => ({ url: worker.url }))),
        );
        const out = (yield* start(stack)) as { url: string };
        const door = out.url.replace(/\/$/, "");
        const answer = yield* call(`${door}/table`);
        const [route, asset] = Object.entries(today.assets)[0] ?? ["/none", undefined];
        const reply = yield* call(`${door}${route}`);
        return {
          status: answer.status,
          programs:
            answer.status === 200 ? Object.keys((JSON.parse(answer.text) as { programs: object }).programs).length : 0,
          asset: { route, status: reply.status, hashHolds: asset !== undefined && sha(reply.text) === asset.hash },
        };
      }),
    );

    const before = yield* fs.readFileString(path.join(process.env.S285_OUT ?? "", "bundle.json")).pipe(
      Effect.map((saved) => (JSON.parse(saved) as { plugins?: { files?: unknown } }).plugins?.files),
      Effect.orElseSucceed(() => undefined),
    );

    yield* save("bundle", {
      today: {
        ms: todayMs,
        medianMs: median(todayMs),
        brainBytes: todayBytes,
        build: today.build,
        programs: Object.keys(today.programs).length,
        assets: Object.keys(today.assets).length,
        brainEntryReaches: reached,
      },
      plugins: {
        compilerSaw: sawOne,
        files: listed(first.files),
        codeFiles: code(first.files).length,
        codeBytes: total(first.files),
        ms: [first.ms, second.ms, third.ms],
        medianMs: median([first.ms, second.ms, third.ms]),
        sameBytesThreeTimes: same(first.files, second.files) && same(second.files, third.files),
        sameAsLastLaunch:
          before === undefined ? "no earlier run" : JSON.stringify(before) === JSON.stringify(listed(first.files)),
        otherStageSame: same(first.files, elsewhere.files),
        otherStageDiffers: firstDifference(text(first.files, "brainlike.js"), text(elsewhere.files, "brainlike.js")),
        oneFile: listed(oneFile.files),
        oneFileSameTwice: same(oneFile.files, oneFileAgain.files),
        oneFileOtherStageSame: same(oneFile.files, oneFileElsewhere.files),
        oneFileNotMinified: listed(plain.files),
      },
      alias: {
        codeFiles: code(aliased.files).length,
        codeBytes: total(aliased.files),
        sameBytesTwice: same(aliased.files, aliasedAgain.files),
        oneFile: listed(aliasedOneFile.files),
      },
      onNode: { tableModule: atPlan, tsxFile: tsxAtPlan },
      oneBundleForEveryInstance: {
        file: listed(shared.files),
        sameBytesTwice: same(shared.files, sharedAgain.files),
        bundledAs: "shared",
        ranAs: "local",
        ...devShared,
      },
      localRuntime: {
        plugins: { ...devPlugins, watched: listed(code(devPlugins.watched)) },
        alias: {
          ...devAlias,
          watched: listed(code(devAlias.watched)),
          watchSameBytesAsBuild: same(aliased.files, devAlias.watched),
          watchDiffers: firstDifference(text(aliased.files, "brainlike.js"), text(devAlias.watched, "brainlike.js")),
        },
      },
    });
  }),
);
