import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLifecycle } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import type { BrainEvent } from "@kampus/libfabrika/brain-event";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { vi } from "vitest";

// P12, next/. Exercise startDev twice with one real home. Deployment and HTTP are fake.
// The link law skips only the flush-to-disk waits. The outbox's own law in
// next/packages/libfabrika/src/node/dev/local-dev.test.ts pins the sync calls and their order.
vi.mock("../alchemy.run.ts", () => ({
  stack: (_built: unknown, _config: unknown, local: Context.Context<never>) => local,
}));

vi.mock("alchemy/Deploy", () => ({
  deploy: ({ stack }: { stack: Context.Context<never> }) =>
    Effect.gen(function* () {
      const entries = [...stack.mapUnsafe.values()] as Array<unknown>;
      const plugin = entries.find((entry) => typeof entry === "object" && entry !== null && "sockets" in entry);

      if (typeof plugin !== "object" || plugin === null || !("start" in plugin)) {
        return yield* Effect.die("test deployment has no control plugin");
      }

      const start = plugin.start as (ports: Record<string, number>) => Effect.Effect<unknown>;
      const observe = Context.get(stack, RuntimeLifecycle);
      observe({ type: "start", worker: "fabrika", pid: 27001 });
      yield* start({ "fabrika-control": 27002 });
      // Let the real lifecycle queue consume its start event before the real outbox flush.
      yield* Effect.yieldNow;
    }),
}));

const fileWithoutSync = (file: FileSystem.File): FileSystem.File => ({
  [FileSystem.FileTypeId]: file[FileSystem.FileTypeId],
  get stat() {
    return file.stat;
  },
  sync: Effect.void,
  seek: (offset, from) => file.seek(offset, from),
  read: (buffer, options) => file.read(buffer, options),
  readAlloc: (size, options) => file.readAlloc(size, options),
  truncate: (length) => file.truncate(length),
  write: (buffer) => file.write(buffer),
  writeAll: (buffer) => file.writeAll(buffer),
});

const filesWithoutSync = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) =>
    FileSystem.make({
      ...fs,
      open: (...args) => Effect.map(fs.open(...args), fileWithoutSync),
    }),
  ),
).pipe(Layer.provideMerge(NodeServices.layer));

// A test's folder, its stubbed home and its fetch spy all go back through the test's scope (0061).
const sandbox = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p12-m-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => vi.stubEnv("FABRIKA_HOME", folder)),
    () => Effect.sync(() => vi.unstubAllEnvs()),
  );
  return folder;
});

const spyOnFetch = (impl: typeof fetch) =>
  Effect.acquireRelease(
    Effect.sync(() => vi.spyOn(globalThis, "fetch").mockImplementation(impl)),
    () => Effect.sync(() => vi.restoreAllMocks()),
  );

// The installed runner takes runs and a seed, so the old example runs first from this callback.
const buildsPair = Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString]);
const pinned: ReadonlyArray<readonly [string, string]> = [["build-a", "build-b"]];

it.live.prop(
  "a later dev command links its first start to the last runtime in that home",
  [buildsPair],
  ([generated]) =>
    Effect.forEach(
      [...pinned, generated],
      (builds) =>
        Effect.gen(function* () {
          const { startDev } = yield* Effect.promise(() => import("./instance.ts"));
          const folder = yield* sandbox;
          const events: Array<typeof BrainEvent.Type> = [];
          yield* spyOnFetch(async (_url, options) => {
            const call = JSON.parse(String(options?.body)) as {
              method: string;
              args: Array<typeof BrainEvent.Type>;
            };

            if (call.method === "brain") {
              events.push(call.args[0]!);
            }

            return Response.json({ value: call.method === "info" ? [] : null });
          });
          const config = {
            home: folder,
            name: "life-contract",
            person: "person-test",
            founder: "public-test-key",
            window: null,
            port: 18787,
            rateLimit: { limit: 100_000, window: 60_000 },
          };

          for (const build of builds) {
            yield* Effect.scoped(startDev({ build, brain: "unused.mjs", programs: {} }, config)).pipe(
              Effect.provide(ProcessIdGenerator.layer),
              Effect.provide(SecureRandom.layerWebCrypto),
              Effect.provide(filesWithoutSync),
            );
          }

          const starts = events.filter((event) => event._tag === "started");
          expect(starts).toHaveLength(2);
          expect(starts[1]).toMatchObject({ after: starts[0]!.start, build: builds[1] });
          expect(starts[1]!.start).not.toBe(starts[0]!.start);
        }),
      { discard: true, concurrency: 1 },
    ),
  { arbitrary: { seed: 119120, runs: 20 } },
);

it.live.prop(
  "instance readiness waits for the started event to reach the ledger",
  [Schema.String.check(Schema.isUUID())],
  ([build]) =>
    Effect.gen(function* () {
      const folder = yield* sandbox;
      const reached = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const events: Array<typeof BrainEvent.Type> = [];
      yield* spyOnFetch(async (_url, options) => {
        const call = JSON.parse(String(options?.body)) as {
          method: string;
          args: Array<typeof BrainEvent.Type>;
        };

        if (call.method === "brain") {
          events.push(call.args[0]!);
          Effect.runSync(Deferred.succeed(reached, undefined));
          await Effect.runPromise(Deferred.await(release));
        }

        return Response.json({ value: call.method === "write" ? { _tag: "written" } : null });
      });
      const { startDev } = yield* Effect.promise(() => import("./instance.ts"));
      yield* Effect.gen(function* () {
        const starting = yield* Effect.forkChild(
          startDev(
            { build, brain: "unused.mjs", programs: {} },
            {
              home: folder,
              name: "life-contract",
              person: "person-test",
              founder: "public-test",
              window: null,
              port: 18787,
              rateLimit: { limit: 100_000, window: 60_000 },
            },
          ),
        );
        yield* Deferred.await(reached);
        yield* Effect.yieldNow;
        expect(starting.pollUnsafe()).toBeUndefined();
        expect(events).toMatchObject([{ _tag: "started", reason: "open", build }]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(starting);
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.scoped,
        Effect.provide(ProcessIdGenerator.layer),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(NodeServices.layer),
      );
    }),
  { arbitrary: { seed: 119120, runs: 10 } },
);
