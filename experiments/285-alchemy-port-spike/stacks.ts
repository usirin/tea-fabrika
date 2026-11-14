// Experiment 285, next/. The two stacks every question runs on.
//
//   bundled   Alchemy bundles `probe.ts` itself: where the port ends (slice S8).
//   prebuilt  our own build of `entry.template.txt`, run with `bundle: false`: main today, and slice S7.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { bundle } from "@kampus/libfabrika/node/build";
import * as Alchemy from "alchemy";
import { unreachableChunksPlugin } from "alchemy/Bundle/UnreachableChunksPlugin";
import { type Deferred, Effect, FileSystem, Path } from "effect";
import { HOME, providers, type Socket } from "./harness.ts";
import * as probe from "./probe.ts";

export type Build = "bundled" | "prebuilt";

/** The brain phase of libfabrika's build, on this folder's entry: one file, the same options as main. */
export const prebuild = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // The entry is kept as text in this folder, since its class exports are read only by workerd.
  const entry = path.join(HOME, "src/entry.ts");
  yield* fs.writeFileString(entry, yield* fs.readFileString(path.join(HOME, "src/entry.template.txt")));
  const began = performance.now();
  const output = yield* bundle(entry, [unreachableChunksPlugin()], {
    phase: "brain",
    cwd: HOME,
    define: { "globalThis.__ALCHEMY_RUNTIME__": "true" },
  });
  const code = output.output
    .filter((o) => o.type === "chunk")
    .map((o) => o.code)
    .join("\n");
  const out = path.join(HOME, "built");
  yield* fs.makeDirectory(out, { recursive: true });
  yield* fs.writeFileString(path.join(out, "brain.mjs"), code);
  return {
    file: path.join(out, "brain.mjs"),
    bytes: new TextEncoder().encode(code).byteLength,
    chunks: output.output.length,
    ms: Math.round(performance.now() - began),
  };
});

export const stack = (
  build: Build,
  sockets: ReadonlyArray<Socket>,
  ports: Deferred.Deferred<Record<string, number>>,
  built?: string,
) =>
  Alchemy.Stack(
    "spike285",
    { providers: providers(sockets, ports), state: Alchemy.localState() },
    build === "bundled"
      ? probe.Probe.pipe(
          Effect.map((worker) => ({ url: worker.url })),
          Effect.provide(probe.default),
        )
      : Effect.gen(function* () {
          const worker = yield* Cloudflare.Workers.Worker("Probe285", {
            main: built ?? "",
            bundle: false,
            compatibility: { date: "2026-10-12" },
            observability: { enabled: false },
            dev: { host: "127.0.0.1" },
            env: {
              // Alchemy finds a hosted class at env[<class name>].
              Echo: Cloudflare.DurableObject("Echo"),
              Turn: Cloudflare.DurableObject("Turn"),
              PLAIN: Cloudflare.DurableObject("PlainEcho"),
            },
          });
          return { url: worker.url };
        }),
  );
