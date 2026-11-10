import {
  ByteSize,
  type Cause,
  Clock,
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
  const at: number[] = [];
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
      Effect.gen(function* () {
        at.push(yield* Clock.currentTimeMillis);
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
    at,
    logs,
    events,
    refuse: Effect.sync(() => {
      unreadable = true;
    }),
    allow: Effect.sync(() => {
      unreadable = false;
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

// One input space for L2, L6 and L7. fast-check is used for offsets and operation
// sequences: there is no domain Schema for an editor's writes and OS hints.
const timeline = fc.array(
  fc.record({
    kind: fc.constantFrom("write", "rename", "remove", "cut", "refuse"),
    text: fc.string({ minLength: 2 }),
    cut: fc.nat(),
    offset: fc.integer({ min: 0, max: 999 }),
    lead: fc.integer({ min: 1, max: 48 }),
    lag: fc.integer({ min: 1, max: 48 }),
    older: fc.option(fc.integer({ min: 1, max: 49 }), { nil: null }),
    hints: fc.constantFrom("none", "one", "two", "other"),
    first: fc.integer({ min: -51, max: 1100 }),
    second: fc.integer({ min: -51, max: 1100 }),
    anchor: fc.constantFrom("offset", "save", "done", "tick", "settle"),
    edge: fc.constantFrom(-1, 0, 1),
  }),
  { minLength: 1, maxLength: 8 },
);

type Timeline = ReturnType<typeof timeline.generate>["value"];

const caseAt = (change: Partial<Timeline[number]>): Timeline[number] => ({
  kind: "cut",
  text: "ab",
  cut: 0,
  offset: 0,
  lead: 10,
  lag: 20,
  older: null,
  hints: "none",
  first: 0,
  second: 0,
  anchor: "offset",
  edge: 0,
  ...change,
});

const timelineRuns = {
  ...runs,
  examples: [
    // pinned: review 2's old hint closes a fixed window between the two parts.
    [[caseAt({ older: 30 })]],
    // pinned: a closing read itself finds a partial text before the tick.
    [[caseAt({ older: 40, lead: 20 })]],
    // pinned: review 1's late and duplicate hints must not postpone the bound.
    [[caseAt({ kind: "write", offset: 1, hints: "one", first: 1039 })]],
    [[caseAt({ kind: "write", offset: 1, hints: "two", first: 1000, second: 1039 })]],
    // pinned: review 1's poll must not replace the watch's hearing source.
    [[caseAt({ kind: "write", offset: 980, hints: "one", first: 0 })]],
    // scenario: chokidar 5 awaitWriteFinish's ENOENT/cancel and error exits,
    // index.js:608-653,747-749. Our reader reports none/refused exactly once.
    [[caseAt({ kind: "remove", older: 30 }), caseAt({ kind: "refuse", older: 30 })]],
    // Keep the original silent split-write timing in the shared input too.
    [[caseAt({})]],
  ] satisfies [Timeline][],
};

const play = Effect.fnUntraced(function* (steps: Timeline, law: "L2" | "L6" | "L7") {
  const h = yield* start();
  expect(h.got).toEqual([{ _tag: "none" }]);
  expect(h.logs).toEqual([{ file: name, by: "start" }]);
  let now = 0;
  const until = Effect.fnUntraced(function* (end: number) {
    while (now < end) {
      const next = Math.min(end, (Math.floor(now / 50) + 1) * 50);
      yield* advance(next - now);
      now = next;
    }
  });

  for (const [i, step] of steps.entries()) {
    // Precondition for a per-save bound: no later save replaces it before its
    // bound. Slots leave > POLL + SETTLE between saves, and drain late hints.
    const base = i * 6000;
    yield* until(base);
    yield* h.allow;
    yield* h.fs.writeFileString(file, `before:${i}`);
    yield* h.event();
    yield* until(base + 50);
    const from = h.got.length;
    const tick = base + (step.kind === "cut" ? 1000 : 2000);
    const begins = step.kind === "cut" ? tick - step.lead : base + 1000 + step.offset;
    const done = step.kind === "cut" ? tick + 1 + ((step.lag - 1) % (49 - step.lead)) : begins;
    const full = `${i}:${step.text}`;
    // Prefix the part too, so it cannot equal a preceding save or the full text.
    const part = `${i}:${step.text.slice(0, 1 + (step.cut % (step.text.length - 1)))}`;
    const expected =
      step.kind === "remove"
        ? { _tag: "none" }
        : step.kind === "refuse"
          ? { _tag: "refused", line: 1, why: "it could not be read: permission denied" }
          : { _tag: "read", value: full };
    const anchor =
      step.anchor === "save"
        ? begins
        : step.anchor === "done"
          ? done
          : step.anchor === "tick"
            ? tick
            : begins - (step.older ?? 0) + 50;
    // Choose an arbitrary offset or before/at/after a named boundary. Keep the
    // hint count independent: none, one, two, or one for another file.
    const first = step.anchor === "offset" ? begins + step.first : anchor + step.edge;
    const hints = step.hints === "none" ? [] : step.hints === "two" ? [first, begins + step.second] : [first];
    const matching = step.hints === "other" ? [] : [...hints];
    const other = step.hints === "other" ? hints : [];

    if (step.older !== null) {
      matching.push(begins - step.older);
    }

    matching.sort((a, b) => a - b);
    let oldEnd = -1;

    for (const hint of matching.filter((at) => at < begins)) {
      if (hint >= oldEnd) {
        oldEnd = hint + 50;
      }
    }

    const deadline = done + 1050;
    const end = Math.max(deadline, ...matching, ...other) + 1050;
    const times = new Set([begins, done, deadline, end, ...matching, ...other]);

    // Every possible timer end is 50 ms after a hint, tick or closing read.
    // Stop there before doing same-time file/event actions: timer wins ties.
    for (const at of [...times]) {
      for (let next = at + 50; next <= end; next += 50) {
        times.add(next);
      }
    }

    for (const at of [...times].sort((a, b) => a - b)) {
      yield* until(at);

      if (at === begins) {
        if (step.kind === "refuse") {
          yield* h.refuse;
        } else if (step.kind === "cut") {
          yield* h.fs.writeFileString(file, part);
        } else {
          yield* save(h.fs, { kind: step.kind, text: full });
        }
      }

      if (step.kind === "cut" && at === done) {
        yield* h.fs.writeFileString(file, full);
      }

      for (const hint of matching) {
        if (hint === at) {
          yield* h.event();
        }
      }

      for (const hint of other) {
        if (hint === at) {
          yield* h.event("/settings/other.toml");
        }
      }

      yield* drain;

      if (at === deadline && law === "L2") {
        expect(h.got.at(-1)).toEqual(expected);
      }
    }

    if (law === "L2") {
      // Every emitted value must be a completed save, in time order, not merely
      // a text that becomes a completed save at some future point.
      for (let n = from; n < h.got.length; n++) {
        expect(h.at[n]).toBeGreaterThanOrEqual(done);
        expect(h.got[n]).toEqual(expected);
      }

      expect(h.got.slice(from)).toEqual([expected]);
    }

    if (law === "L6" && step.kind === "cut") {
      expect(h.got).not.toContainEqual({ _tag: "read", value: part });
      expect(h.got.at(-1)).toEqual(expected);
    }

    if (law === "L7") {
      expect(h.logs).toHaveLength(h.got.length);

      for (let n = from; n < h.got.length; n++) {
        // A preceding matching hint counts only while its window is still
        // open. A late hint after the answer cannot relabel that answer.
        const watch =
          (n === from && oldEnd > begins) ||
          matching.some((at) => at >= (n === from ? begins : h.at[n - 1]!) && at < h.at[n]!);
        expect(h.logs[n]).toEqual({ file: name, by: watch ? "watch" : "poll" });
      }
    }
  }
});

for (const law of ["L2", "L6", "L7"] as const) {
  it(`${law}: shared save/hint timeline, including an already-open settle`, async () => {
    await fc.assert(
      fc.asyncProperty(timeline, (steps) => go(play(steps, law))),
      timelineRuns,
    );
  });
}

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
  const hints = fc.array(
    fc.record({
      kind: fc.constantFrom("sent", "dropped", "late", "twice", "other"),
      before: fc.integer({ min: 0, max: 999 }),
      first: fc.integer({ min: 0, max: 1100 }),
      second: fc.integer({ min: 0, max: 1100 }),
    }),
    { minLength: 1, maxLength: 8 },
  );
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

          let now = 50;
          // Stop at each possible poll/settle boundary, without extending the save's bound.
          const until = Effect.fnUntraced(function* (end: number) {
            while (now < end) {
              const next = Math.min(end, (Math.floor(now / 50) + 1) * 50);
              yield* advance(next - now);
              now = next;
            }
          });

          for (const [i, step] of steps.entries()) {
            const hint = events[i % events.length]!; // hints has minLength: 1
            yield* until(now + hint.before);
            yield* save(h.fs, step);
            history.push(answer(step));
            const saved = now;
            const offsets =
              hint.kind === "dropped" ? [] : hint.kind === "twice" ? [hint.first, hint.second] : [hint.first];
            const times = new Set([1050, ...offsets, ...offsets.map((offset) => offset + 50)]);

            for (const offset of [...times].sort((a, b) => a - b)) {
              yield* until(saved + offset);

              for (const event of offsets) {
                if (event === offset) {
                  yield* h.event(hint.kind === "other" ? "/settings/other.toml" : file);
                }
              }

              if (offset === 1050) {
                expect(h.got.at(-1)).toEqual(answer(step));
              }
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
    {
      ...runs,
      // pinned: review 1 found a late hint and a spaced duplicate postponing a poll's answer.
      examples: [
        [[{ kind: "write", text: "late" }], [{ kind: "late", before: 951, first: 1039, second: 0 }]],
        [[{ kind: "write", text: "twice" }], [{ kind: "twice", before: 951, first: 1000, second: 1039 }]],
      ],
    },
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
          // A2: the closing read can discover changed text and start another
          // settle. 1050 is no longer a completion deadline. The shared L2
          // checks completion at done + 1050; this check keeps L6's promise.
          expect(h.got).not.toContainEqual({ _tag: "read", value: part });
        }),
      ),
    ),
    runs,
  );
});

it("L7: each new answer logs the file and the way it was heard", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ text: fc.string(), event: fc.boolean(), before: fc.integer({ min: 0, max: 999 }) }), {
        minLength: 2,
        maxLength: 8,
      }),
      (steps) =>
        go(
          Effect.gen(function* () {
            const h = yield* start();
            const expected = [{ file: name, by: "start" }];

            for (const [i, step] of steps.entries()) {
              // Each iteration starts on a tick; keep offset zero and also reach the next tick's settle.
              yield* advance(step.before);
              // Unique text makes each save a new answer.
              yield* h.fs.writeFileString(file, `${i}:${step.text}`);

              if (step.event) {
                yield* h.event();
              }

              const toTick = 1000 - step.before;
              yield* advance(Math.min(50, toTick));

              if (toTick < 50) {
                yield* advance(50 - toTick);
              }

              const atSettle = h.got.at(-1);

              yield* advance(Math.max(0, toTick - 50));
              yield* advance(Math.min(50, toTick));
              expected.push({ file: name, by: step.event ? "watch" : "poll" });
              expect(h.logs).toEqual(expected);
              expect(h.logs).toHaveLength(h.got.length);

              if (step.event) {
                expect(atSettle).toEqual({ _tag: "read", value: `${i}:${step.text}` });
              }

              yield* advance(950);
            }
          }),
        ),
    ),
    {
      ...runs,
      // pinned: review 1 found that the tick at 1000 replaced the watch hint from 980.
      examples: [
        [
          [
            { text: "overlap", event: true, before: 980 },
            { text: "silent", event: false, before: 0 },
          ],
        ],
      ],
    },
  );
});
