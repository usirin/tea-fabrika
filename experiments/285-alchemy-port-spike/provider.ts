// Experiment 285, next/. The follow-up question: can our build plug into Alchemy through a Worker's
// `source` prop, the designed way, in place of `bundle: false` beside it?
//
// `table-source.ts` is the provider. This script names it in a Worker's `source` prop, starts the
// Worker on the local runtime under two stage names, changes the table while it runs, and calls
// the provider's `build` and `hash` directly, as a deploy would.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { getCompatibility, getToolingCompatibility } from "@alchemy.run/cloudflare/Workers/Compatibility";
import * as Alchemy from "alchemy";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { Deferred, Effect, FileSystem, Path, Schedule } from "effect";
import { call, HOME, providers, ROOT, run, save, start } from "./harness.ts";
import * as sourced from "./sourced.ts";
import source, { asked } from "./table-source.ts";

const sha = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

await run(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // The real table, from the app's own build, saved as the plain file the provider reads.
    const app: typeof import("../../next/apps/fabrika/src/build.ts") = yield* Effect.promise(
      () => import(pathToFileURL(path.join(ROOT, "next/apps/fabrika/src/build.ts")).href),
    );
    const today = yield* app.build({ out: path.join(HOME, "app-out") });
    const tables = path.join(HOME, "tables.json");
    const table = { programs: today.programs, assets: today.assets };
    yield* fs.writeFileString(tables, JSON.stringify(table));

    // The prop. Every field here is plain data.
    const prop = {
      provider: pathToFileURL(path.join(HOME, "src/table-source.ts")).href,
      devMode: "bundle" as const,
      options: {
        main: path.join(HOME, "src/sourced.ts"),
        tables,
        objects: ["Tally"],
        fixed: { name: "fabrika", stage: "one-build" },
      },
    };
    const stack = Effect.gen(function* () {
      const ports = yield* Deferred.make<Record<string, number>>();
      return Alchemy.Stack(
        "spike285",
        { providers: providers([], ports), state: Alchemy.localState() },
        Cloudflare.Workers.Worker("Sourced285", {
          source: prop,
          compatibility: { date: "2026-10-12" },
          observability: { enabled: false },
          dev: { host: "127.0.0.1" },
          // Alchemy finds a hosted class at env[<class name>].
          env: { Tally: Cloudflare.DurableObject("Tally") },
        }).pipe(Effect.map((worker) => ({ url: worker.url }))),
      );
    });
    const answers = (door: string) =>
      Effect.gen(function* () {
        const table = yield* call(`${door}/table`);
        const first = yield* call(`${door}/tally`);
        const second = yield* call(`${door}/tally`);
        return { table: { status: table.status, body: table.text.slice(0, 200) }, tally: [first.text, second.text] };
      });

    // 1, 2 and 5. The Worker on the local runtime, named `local`. Then 4: change the table.
    const local = yield* Effect.scoped(
      Effect.gen(function* () {
        const out = (yield* start(yield* stack)) as { url: string };
        const door = out.url.replace(/\/$/, "");
        const before = yield* answers(door);
        const began = performance.now();
        const more = { ...table, programs: { ...table.programs, "spike/added": { hash: sha("x"), source: "x" } } };
        yield* fs.writeFileString(tables, JSON.stringify(more));
        const after = yield* call(`${door}/table`).pipe(
          Effect.flatMap((reply) =>
            reply.text.includes("spike/added") ? Effect.succeed(reply.text) : Effect.fail("not yet"),
          ),
          Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
          Effect.orElseSucceed(() => "the rebuild never reached the Worker"),
        );
        const rebuildMs = Math.round(performance.now() - began);
        yield* fs.writeFileString(tables, JSON.stringify(table));
        // Wait for the table to be the first one again, so the next start begins from it.
        yield* call(`${door}/table`).pipe(
          Effect.flatMap((reply) => (reply.text.includes("spike/added") ? Effect.fail("not yet") : Effect.void)),
          Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
          Effect.ignore,
        );
        return { before, afterTheTableChanged: after, rebuildMs };
      }),
    );
    const askedLocally = asked.splice(0);

    // 3. The same Worker under another stage name.
    const other = yield* Effect.scoped(
      Effect.gen(function* () {
        const out = (yield* start(yield* stack, "other")) as { url: string };
        return yield* answers(out.url.replace(/\/$/, ""));
      }),
    );
    const askedElsewhere = asked.splice(0);

    // 2 and 3. What a deploy calls: `build` and `hash`, from two stage names.
    const provider = yield* source.make(prop.options);
    const compatibility = getToolingCompatibility(
      getCompatibility({ compatibility: { date: "2026-10-12" } }),
      prop.options.main,
    );
    const context = (place: string) => ({
      id: "Sourced285",
      fqn: "Sourced285",
      workerName: "sourced285",
      compatibility,
      entry: { kind: "external" as const },
      stack: { name: "spike285", stage: place },
      env: undefined,
      selfUrl: undefined,
      extraOptions: undefined,
      assets: undefined,
    });
    const direct = Effect.gen(function* () {
      const one = yield* provider.build(context("local"));
      const two = yield* provider.build(context("cloud"));
      const hashed = yield* provider.hash(context("cloud"), undefined);
      const files = (one.bundle?.files ?? []).map((f) => ({
        path: f.path,
        bytes: typeof f.content === "string" ? new TextEncoder().encode(f.content).byteLength : f.content.byteLength,
        sha: sha(f.content),
      }));
      return {
        files,
        sameBytesFromTwoStages: one.bundle?.hash === two.bundle?.hash,
        hashAnswer: hashed,
        hashMatchesBuild: hashed.bundle === one.bundle?.hash,
        bundle: one.bundle?.hash,
      };
    }).pipe(Effect.provideService(ArtifactStore, createArtifactStore()));
    const deployCalls = yield* direct;

    const last = yield* fs.readFileString(path.join(process.env.S285_OUT ?? "", "provider.json")).pipe(
      Effect.map((saved) => (JSON.parse(saved) as { deployCalls?: { bundle?: string } }).deployCalls?.bundle),
      Effect.orElseSucceed(() => undefined),
    );
    const hashes = [...askedLocally, ...askedElsewhere].filter((a) => a.call === "dev").map((a) => a.bundle);

    yield* save("provider", {
      prop: {
        ...prop,
        provider: "file URL of table-source.ts",
        options: { ...prop.options, main: "sourced.ts", tables: "tables.json" },
      },
      workerFileExports: Object.keys(sourced),
      local,
      askedLocally,
      other,
      askedElsewhere,
      devBundleSameOnBothStages: hashes.length === 2 && hashes[0] === hashes[1],
      devBundleSameAsBuild: hashes[0] === deployCalls.bundle,
      deployCalls,
      sameAsLastLaunch: last === undefined ? "no earlier run" : last === deployCalls.bundle,
    });
  }),
);
