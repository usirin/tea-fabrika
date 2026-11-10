import {
  ByteSize,
  type Cause,
  Effect,
  Equal,
  FileSystem,
  Logger,
  Option,
  Path,
  PlatformError,
  Queue,
  Result,
  type Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { expect, it } from "vitest";
import { type Setting, settingsFile } from "./settings.ts";

// Today's version. No disk, OS watch, or real sleep. @effect/vitest is not a dependency
// of today's app; use its installed fast-check with a fresh TestClock per generated run.
const runs = { seed: 119120, numRuns: 20, endOnFailure: true };
const name = "keybindings.toml";
const file = `/settings/${name}`;
const swap = "/settings/swap";

const info: FileSystem.File.Info = {
  type: "Directory",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0n,
  ino: Option.none(),
  mode: 0,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(0),
  blksize: Option.none(),
  blocks: Option.none(),
};

const denied = () =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "readFileString",
  });

// A merge starts child fibers in several scheduler turns. These fixed yields do
// not retry an assertion or move time; they let queued stream work finish.
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true, concurrency: 1 });

const advance = Effect.fnUntraced(function* (millis: number) {
  yield* drain;
  yield* TestClock.adjust(millis);
  yield* drain;
});

const start = Effect.fnUntraced(function* (ready = true) {
  const files = new Map<string, string>();
  const events = yield* Queue.unbounded<FileSystem.WatchEvent, PlatformError.PlatformError | Cause.Done>();
  let unreadable = false;
  const got: Setting<string>[] = [];
  const logs: Record<string, unknown>[] = [];
  const backend = FileSystem.WatchBackend.of({
    register: (_path, _stat, options) =>
      Option.some(
        Stream.unwrap(
          Effect.sync(() => {
            if (ready) {
              options?.onReady?.();
            }

            return Stream.fromQueue(events);
          }),
        ),
      ),
  });
  const make = Effect.gen(function* () {
    const watch = yield* FileSystem.WatchBackend;
    return FileSystem.makeNoop({
      makeDirectory: () => Effect.void,
      readFileString: (path) =>
        Effect.suspend(() => {
          if (unreadable) {
            return Effect.fail(denied());
          }

          const text = files.get(path);
          return text === undefined
            ? Effect.fail(
                PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
              )
            : Effect.succeed(text);
        }),
      writeFileString: (path, text) =>
        Effect.sync(() => {
          files.set(path, text);
        }),
      rename: (from, to) =>
        Effect.sync(() => {
          files.set(to, files.get(from)!);
          files.delete(from);
        }),
      remove: (path) =>
        Effect.sync(() => {
          files.delete(path);
        }),
      watch: (path, options) => Option.getOrThrow(watch.register(path, info, options)),
    });
  });
  const fs = yield* make.pipe(Effect.provideService(FileSystem.WatchBackend, backend));
  yield* settingsFile("/settings", name, Result.succeed).pipe(
    Stream.runForEach((answer) =>
      Effect.sync(() => {
        got.push(answer);
      }),
    ),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provide(Path.layer),
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const row = Logger.formatStructured.log(options);

          if (row.message === "settings_heard") {
            logs.push(row.annotations);
          }
        }),
      ]),
    ),
    Effect.forkScoped,
  );
  // Zero elapsed time: let all runnable fibers reach their first suspension.
  yield* drain;
  return {
    fs,
    got,
    logs,
    events,
    refuse: Effect.sync(() => {
      unreadable = true;
    }),
    event: (path = file): Effect.Effect<boolean> => Queue.offer(events, { _tag: "Update", path }),
  };
});

const go = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestClock.layer())));

// The plan's bound is one second plus 50 ms to settle. Separate clock steps let
// the merged tick reach debounce before its 50 ms timer is advanced.
const bound = Effect.gen(function* () {
  yield* advance(1000);
  yield* advance(50);
});

const saves = fc.array(
  fc.record({
    kind: fc.constantFrom("write", "rename", "remove"),
    text: fc.string(),
  }),
  { minLength: 1, maxLength: 8 },
);

type Save = ReturnType<typeof saves.generate>["value"][number];

const save = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, step: Save) {
  if (step.kind === "remove") {
    yield* fs.remove(file);
  } else if (step.kind === "rename") {
    yield* fs.writeFileString(swap, step.text);
    yield* fs.rename(swap, file);
  } else {
    yield* fs.writeFileString(file, step.text);
  }
});

const answer = (step: Save) => (step.kind === "remove" ? { _tag: "none" } : { _tag: "read", value: step.text });

it("L1: silent watch still hears every save within the bound", async () => {
  await fc.assert(
    fc.asyncProperty(saves, (steps) =>
      go(
        Effect.gen(function* () {
          const h = yield* start();

          for (const step of steps) {
            yield* save(h.fs, step);
            yield* bound;
            expect(h.got.at(-1)).toEqual(answer(step));
          }
        }),
      ),
    ),
    runs,
  );
});

it("L2: mixed event hints preserve file order and the poll floor", async () => {
  const hints = fc.array(fc.constantFrom("sent", "dropped", "late", "twice", "other"), { minLength: 1, maxLength: 8 });
  await fc.assert(
    fc.asyncProperty(saves, hints, (steps, events) =>
      go(
        Effect.gen(function* () {
          const h = yield* start();
          // Ensure polling is still required after the first successful watch event.
          yield* h.fs.writeFileString(file, "first");
          yield* h.event();
          yield* advance(50);
          const history: { _tag: string; value?: string }[] = [{ _tag: "none" }, { _tag: "read", value: "first" }];

          for (const [i, step] of steps.entries()) {
            yield* save(h.fs, step);
            history.push(answer(step));
            const hint = events[i % events.length];

            if (hint === "sent" || hint === "twice") {
              yield* h.event();
            }

            if (hint === "twice") {
              yield* h.event();
            }

            if (hint === "other") {
              yield* h.event("/settings/other.toml");
            }

            yield* bound;
            expect(h.got.at(-1)).toEqual(answer(step));

            if (hint === "late") {
              yield* h.event();
              yield* advance(50);
            }
          }

          let cursor = 0;

          for (const said of h.got) {
            const index = history.findIndex(
              (value, i) =>
                i >= cursor && value._tag === said._tag && (said._tag !== "read" || value.value === said.value),
            );
            expect(index).toBeGreaterThanOrEqual(cursor);
            cursor = index;
          }
        }),
      ),
    ),
    runs,
  );
});

it("L3: failed or ended watch leaves later saves audible", async () => {
  await fc.assert(
    fc.asyncProperty(fc.nat({ max: 5 }), fc.boolean(), fc.string(), (count, fails, text) =>
      go(
        Effect.gen(function* () {
          const h = yield* start();

          for (let i = 0; i < count; i++) {
            yield* h.event();
            yield* advance(50);
          }

          if (fails) {
            yield* Queue.fail(h.events, denied());
          } else {
            yield* Queue.end(h.events);
          }

          yield* drain;
          yield* h.fs.writeFileString(file, text);
          yield* bound;
          expect(h.got.at(-1)).toEqual({ _tag: "read", value: text });
        }),
      ),
    ),
    runs,
  );
});

it("L4 scenario: first answer needs no ready signal or elapsed time; one start covers the fixed gate", async () => {
  await go(
    Effect.gen(function* () {
      const h = yield* start(false);
      expect(h.got).toEqual([{ _tag: "none" }]);
    }),
  );
});

it("L5: repeated saves and unreadable ticks never repeat an answer", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
      fc.integer({ min: 2, max: 5 }),
      (texts, ticks) =>
        go(
          Effect.gen(function* () {
            const h = yield* start();

            for (const text of texts) {
              for (let repeat = 0; repeat < 2; repeat++) {
                yield* h.fs.writeFileString(file, text);
                yield* h.event();
                yield* bound;
              }
            }

            yield* h.refuse;

            for (let tick = 0; tick < ticks; tick++) {
              yield* h.event();
              yield* bound;
            }

            expect(h.got.at(-1)?._tag).toBe("refused");

            for (let i = 1; i < h.got.length; i++) {
              expect(Equal.equals(h.got[i - 1], h.got[i])).toBe(false);
            }
          }),
        ),
    ),
    runs,
  );
});

it("L6: a tick between two write parts waits for the settled text", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 2 }), fc.nat(), (text, cut) =>
      go(
        Effect.gen(function* () {
          const h = yield* start();
          const part = text.slice(0, 1 + (cut % (text.length - 1)));
          yield* advance(990);
          yield* h.fs.writeFileString(file, part);
          yield* advance(10); // one second tick
          yield* advance(20); // inside the plan's 50 ms settle
          yield* h.fs.writeFileString(file, text);
          yield* advance(30);
          expect(h.got).toEqual([{ _tag: "none" }, { _tag: "read", value: text }]);
        }),
      ),
    ),
    runs,
  );
});

it("L7: each new answer logs the file and the way it was heard", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ text: fc.string(), event: fc.boolean() }), { minLength: 2, maxLength: 8 }),
      (steps) =>
        go(
          Effect.gen(function* () {
            const h = yield* start();
            const expected = [{ file: name, by: "start" }];

            for (const [i, step] of steps.entries()) {
              // Unique text makes each save a new answer. Poll-aligned steps distinguish watch from poll.
              yield* h.fs.writeFileString(file, `${i}:${step.text}`);

              if (step.event) {
                yield* h.event();
              }

              yield* advance(50);

              if (step.event) {
                expect(h.got.at(-1)).toEqual({ _tag: "read", value: `${i}:${step.text}` });
              }

              yield* advance(950);
              yield* advance(50);
              expected.push({ file: name, by: step.event ? "watch" : "poll" });
              expect(h.logs).toEqual(expected);
              expect(h.logs).toHaveLength(h.got.length);
              yield* advance(950);
            }
          }),
        ),
    ),
    runs,
  );
});
