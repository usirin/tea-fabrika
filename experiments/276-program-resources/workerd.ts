import * as Cloudflare from "@alchemy.run/cloudflare";
// Experiment 276, part b on workerd: bundle worker.ts (the engine included) the way the brain is
// bundled (libfabrika's node/build/bundle.ts: Rolldown, platform "browser", `cloudflare:workers`
// and `node:*` left to the runtime), then start it in the local runtime through Alchemy, as the
// app's local instance does (next/apps/fabrika/src/instance.ts), and drive the same five steps.
//
// Run from the repo root:
//   EXP276_HOME=<temp folder> nice -n 19 node experiments/276-program-resources/workerd.ts [out.json]
// One local runtime, closed with the scope at the end. No account, no network, no key.
import { NodeServices } from "@effect/platform-node";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { deploy } from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import { localState } from "alchemy/State/LocalState";
import { Effect, Layer, Logger, Scope } from "effect";
import { rolldown } from "rolldown";

const home = process.env.EXP276_HOME;

if (!home) {
  throw new Error("set EXP276_HOME to a temp folder");
}

process.env.DO_NOT_TRACK = "1";
process.env.ALCHEMY_HOME = `${home}/alchemy-home`;

const here = new URL(".", import.meta.url).pathname;
const port = Number(process.env.EXP276_PORT ?? 18276);

// A baseline Worker with the same object and Effect but no engine, so the engine's share shows.
const baseline = [
  `import { DurableObject } from "cloudflare:workers";`,
  `import { Effect, Schema } from "effect";`,
  `const Row = Schema.Struct({ seq: Schema.Number, body: Schema.String });`,
  `export class Brain extends DurableObject {`,
  `  apply() { return Effect.runPromise(Schema.decodeUnknownEffect(Row)({ seq: 1, body: "" })); }`,
  `}`,
  `export default { fetch: () => new Response("ok") };`,
].join("\n");

const bundle = async (minify: boolean, input = `${here}worker.ts`) => {
  const b = await rolldown({
    input,
    platform: "browser",
    external: ["cloudflare:workers", /^node:/],
    cwd: here,
    onLog: () => {},
    plugins: [
      {
        name: "baseline",
        resolveId: (id) => (id === "exp276:baseline" ? id : null),
        load: (id) => (id === "exp276:baseline" ? baseline : null),
      },
    ],
  });
  const out = await b.generate({ format: "esm", codeSplitting: false, minify });
  await b.close();
  const [chunk] = out.output.filter((o) => o.type === "chunk");

  if (!chunk || chunk.type !== "chunk") {
    throw new Error("no chunk");
  }

  const byPackage: Record<string, number> = {};

  for (const [id, info] of Object.entries(chunk.modules)) {
    const m = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(id);
    const name = m?.[1] ?? "experiment";
    byPackage[name] = (byPackage[name] ?? 0) + info.renderedLength;
  }

  return {
    code: chunk.code,
    bytes: new TextEncoder().encode(chunk.code).byteLength,
    imports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    byPackage,
    modules: Object.keys(chunk.modules).length,
    alchemyModules: Object.keys(chunk.modules)
      .filter((id) => id.includes("/alchemy/src/"))
      .map((id) => id.replace(/.*\/alchemy\/src\//, "")),
  };
};

const main = async () => {
  const fs = await import("node:fs/promises");
  const gzip = (await import("node:zlib")).gzipSync;
  const t0 = performance.now();
  const plain = await bundle(false);
  const bundleMs = performance.now() - t0;
  const min = await bundle(true);
  const base = await bundle(true, "exp276:baseline");
  const workerFile = `${home}/worker.js`;
  await fs.writeFile(workerFile, plain.code);

  const sizes = {
    bundleMs: Math.round(bundleMs),
    plain: { bytes: plain.bytes, gzip: gzip(plain.code).byteLength, modules: plain.modules },
    minified: { bytes: min.bytes, gzip: gzip(min.code).byteLength },
    baselineMinified: { bytes: base.bytes, gzip: gzip(base.code).byteLength },
    imports: plain.imports,
    dynamicImports: plain.dynamicImports,
    byPackage: plain.byPackage,
    alchemyModules: plain.alchemyModules,
  };

  const stack = Alchemy.Stack(
    "exp276",
    { providers: Cloudflare.providers(), state: Alchemy.localState() },
    Effect.gen(function* () {
      const worker = yield* Cloudflare.Workers.Worker("Exp276", {
        name: "exp276",
        main: workerFile,
        bundle: false,
        compatibility: { date: "2026-10-12" },
        observability: { enabled: false },
        dev: { host: "127.0.0.1", port, strictPort: true },
        env: { BRAIN: Cloudflare.DurableObject("Brain") },
      });
      return { url: worker.url };
    }),
  );

  const engine = Layer.mergeAll(
    Layer.succeed(AlchemyContext, { dotAlchemy: `${home}/.alchemy`, dev: true, adopt: false }),
    Layer.succeed(ArtifactStore, createArtifactStore()),
    Interaction.layerNonInteractive(),
    AuthProvidersLive,
  );

  const call = async (path: string) => {
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json();
    return { status: res.status, roundTripMs: Math.round((performance.now() - t) * 100) / 100, body };
  };

  const run = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = performance.now();
    yield* deploy({ stack, stage: "local", dev: true, scope }).pipe(
      Effect.provide(localState()),
      Effect.provide(engine),
      Effect.provide(NodeServices.layer),
      Effect.provide(Logger.layer([])),
    );
    // Alchemy forks the workerd start; wait until the Worker answers.
    const ready = yield* Effect.promise(async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/nothing`);

          if (res.status === 404) {
            return performance.now() - started;
          }
        } catch {}

        await new Promise((r) => setTimeout(r, 100));
      }

      return Number.NaN;
    });

    if (Number.isNaN(ready)) {
      return yield* Effect.die(new Error("workerd never answered"));
    }

    const steps = yield* Effect.promise(async () => {
      const out = [];

      for (const [label, v] of [
        ["1 apply", "v1"],
        ["2 apply again, no change", "v1"],
        ["3 change one prop (every)", "v2"],
        ["4 drop the process", "v3"],
        ["5 apply again, no change", "v3"],
        ["6 bare services: change back to v1", "v1&bare"],
        ["7 remove the program", "gone"],
        ["8 declare v1 again", "v1"],
      ] as const) {
        out.push({ label, ...(await call(`/apply?v=${v}`)) });
      }

      const noChange: Array<number> = [];

      for (let i = 0; i < 50; i++) {
        noChange.push((await call("/apply?v=v1")).roundTripMs);
      }

      noChange.sort((a, b) => a - b);
      const rows = await call("/rows");
      return { out, noChange, rows: rows.body };
    });
    yield* Scope.close(scope, Effect.void as never);
    return { readyMs: Math.round(ready), ...steps };
  });

  const result = await Effect.runPromise(run as Effect.Effect<any>);
  const pct = (xs: Array<number>, p: number) => xs[Math.floor((xs.length - 1) * p)];
  const report = {
    sizes,
    readyMs: result.readyMs,
    steps: result.out,
    noChangeRoundTrip: { n: result.noChange.length, p50: pct(result.noChange, 0.5), p95: pct(result.noChange, 0.95) },
    ledgerRows: result.rows.length,
  };
  const text = JSON.stringify(report, null, 2);

  if (process.argv[2]) {
    await fs.writeFile(process.argv[2], `${text}\n`);
  }

  console.log(text);
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
