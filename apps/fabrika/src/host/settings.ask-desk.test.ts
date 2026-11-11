// Today's version, ticket 102 round 24: polling covers saves the folder watch misses.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, FileSystem, Result, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { type Setting, settingsFile } from "./settings.ts";

/** main's settle in apps/fabrika/src/host/settings.ts (`SETTLE_MS`, not exported): the text must stay still this long. */
const SETTLE_MS = 50;

const runs = { arbitrary: { seed: 119120, numRuns: 12 } };

const watching = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "settings-poll-"))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );
  const path = join(dir, "keybindings.toml");
  writeFileSync(path, "before");
  const fs = yield* FileSystem.FileSystem;
  const first = yield* Deferred.make<void>();
  const read = yield* Deferred.make<void>();
  const second = yield* Deferred.make<void>();
  const answers: Setting<string>[] = [];
  let reads = 0;
  // Keep real file reads and writes. Only the watch is silent, as when FSEvents misses a save.
  const silent = FileSystem.FileSystem.of({
    ...fs,
    watch: (_path, options) =>
      Stream.unwrap(
        Effect.sync(() => {
          options?.onReady?.();
          return Stream.never;
        }),
      ),
    readFileString: (...args) =>
      fs.readFileString(...args).pipe(
        Effect.tap(() =>
          Effect.gen(function* () {
            reads++;

            if (reads > 1) {
              yield* Deferred.succeed(read, undefined);
            }
          }),
        ),
      ),
  });
  yield* settingsFile(dir, "keybindings.toml", Result.succeed).pipe(
    Stream.runForEach((answer) =>
      Effect.gen(function* () {
        answers.push(answer);
        yield* Deferred.succeed(first, undefined);

        if (answers.length > 1) {
          yield* Deferred.succeed(second, undefined);
        }
      }),
    ),
    Effect.provideService(FileSystem.FileSystem, silent),
    Effect.forkScoped,
  );
  // Live deadlines make a missing poll fail, rather than hang on an unmoved test clock.
  yield* TestClock.withLive(Deferred.await(first).pipe(Effect.timeout("1 second")));
  return { path, answers, read, second, reads: () => reads };
}).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(NodePath.layer));

describe("ask desk round 24: settings with a silent folder watch", () => {
  // Plant: remove the poll from `Stream.merge(saves, again, ...)`.
  it.effect.prop(
    "hears a missed save by the next poll period",
    { value: Schema.NonEmptyString.check(Schema.isPattern(/^[^\uD800-\uDFFF]*$/u)) },
    ({ value }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* watching;
          writeFileSync(watch.path, `after:${value}`);
          yield* TestClock.adjust(999);
          expect(watch.answers).toEqual([{ _tag: "read", value: "before" }]);
          // The poll period passes on the test clock and the poll reads the file (a real read).
          yield* TestClock.adjust(1);
          yield* Deferred.await(watch.read);
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
          // The save is only said once the text has stayed still for the settle.
          yield* TestClock.adjust(SETTLE_MS);
          yield* Deferred.await(watch.second);
          // The read's observer and the answer run on the same stream fiber.
          yield* Effect.yieldNow;
          expect(watch.answers).toEqual([
            { _tag: "read", value: "before" },
            { _tag: "read", value: `after:${value}` },
          ]);
        }),
      ),
    runs,
  );

  // Plant: remove `Stream.changesWith((a, b) => a === b)`.
  it.effect.prop(
    "an unchanged reread says nothing",
    { periods: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })) },
    ({ periods }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* watching;
          yield* TestClock.adjust(periods * 1000);
          yield* TestClock.withLive(Deferred.await(watch.read).pipe(Effect.timeout("1 second")));
          yield* Effect.yieldNow;
          expect(watch.reads()).toBeGreaterThan(1);
          expect(watch.answers).toEqual([{ _tag: "read", value: "before" }]);
        }),
      ),
    runs,
  );
});
