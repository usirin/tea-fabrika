// Experiment 285, next/. A Worker source provider of our own: the module a Worker's `source` prop
// names. Alchemy imports it by its specifier and calls `make` with the prop's plain options, so no
// function crosses Alchemy's local provider. The build plugins are made here, inside the provider.
//
// The contract is `WorkerSourceModule` in `@alchemy.run/cloudflare/src/Workers/Source.ts`.
import type { SourceProvider } from "@alchemy.run/cloudflare/Workers/Source";
import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { compiler, embed, type Seen } from "./plugins.ts";

/** The `options` of the `source` prop. Plain JSON. */
const Options = Schema.Struct({
  /** The Worker's entry file. */
  main: Schema.String,
  /** A JSON file that holds the program table. The real build would make the table here instead. */
  tables: Schema.String,
  /** The Durable Object classes the entry hosts. Alchemy writes a bridge class for each. */
  objects: Schema.Array(Schema.String),
  /** The name written into the bundle in place of the instance's own, so every instance gets the same bytes. */
  fixed: Schema.Struct({ name: Schema.String, stage: Schema.String }),
});

const Tables = Schema.fromJsonString(
  Schema.Struct({
    programs: Schema.Record(Schema.String, Schema.Struct({ hash: Schema.String, source: Schema.String })),
    assets: Schema.Record(
      Schema.String,
      Schema.Struct({ hash: Schema.String, type: Schema.String, body: Schema.String }),
    ),
  }),
);

/** What Alchemy asked this provider for, in order: the call, the stage it came from, the bundle's hash. */
export const asked: Array<{ call: "make" | "build" | "hash" | "dev" | "rebuild"; from?: string; bundle?: string }> = [];

const make = (raw: unknown) =>
  Effect.gen(function* () {
    const options = yield* Schema.decodeUnknownEffect(Options)(raw).pipe(Effect.orDie);
    const fs = yield* FileSystem.FileSystem;
    const bundler = yield* WorkerBundle;
    asked.push({ call: "make" });
    const seen: Seen = { builds: 0, files: 0, typed: 0, memoized: 0 };
    const bundled = (ctx: { readonly id: string; readonly compatibility: { date: string; flags: Array<string> } }) =>
      Effect.gen(function* () {
        const tables = yield* fs
          .readFileString(options.tables)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Tables)), Effect.orDie);
        return yield* bundler.build({
          id: ctx.id,
          main: options.main,
          compatibility: ctx.compatibility,
          entry: {
            kind: "effect",
            // Only `kind` is read when the entry is written (Sources/Rolldown.ts, makeEffectVirtualEntry).
            exports: Object.fromEntries(options.objects.map((name) => [name, { kind: "durableObject" } as never])),
          },
          stack: options.fixed,
          extraOptions: {
            input: { plugins: [compiler(seen), embed(tables)] },
            output: { codeSplitting: false, sourcemap: false },
          },
        });
      });
    return {
      ownsAssets: false,
      build: (ctx) =>
        bundled(ctx).pipe(
          Effect.map((bundle) => {
            asked.push({ call: "build", from: ctx.stack.stage, bundle: bundle.hash });
            return { bundle, assets: undefined, hash: { bundle: bundle.hash } };
          }),
        ),
      hash: (ctx) =>
        bundled(ctx).pipe(
          Effect.map((bundle) => {
            asked.push({ call: "hash", from: ctx.stack.stage, bundle: bundle.hash });
            return { bundle: bundle.hash };
          }),
        ),
      // Bundle mode: the host runs workerd, and takes each bundle this stream gives it.
      dev: (ctx) =>
        Effect.sync(() => {
          const event = (call: "dev" | "rebuild") =>
            bundled(ctx).pipe(
              Effect.map((output) => {
                asked.push({ call, from: ctx.stack.stage, bundle: output.hash });
                return { _tag: "Success" as const, output };
              }),
            );
          const rebuilds = fs.watch(options.tables).pipe(
            Stream.debounce("200 millis"),
            Stream.flatMap(() =>
              Stream.concat(Stream.make({ _tag: "Start" as const }), Stream.fromEffect(event("rebuild"))),
            ),
            Stream.catchCause(() => Stream.empty),
          );
          return { mode: "bundle" as const, bundles: Stream.concat(Stream.fromEffect(event("dev")), rebuilds) };
        }),
    } satisfies SourceProvider;
  });

export default { make };
