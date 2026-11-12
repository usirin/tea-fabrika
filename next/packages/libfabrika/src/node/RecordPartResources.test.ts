// T641 slice 1, R3 to R6: the Node stores behind `RecordPartTest.suite` give back each handle and
// folder they acquire (0061). The laws watch the real handles, files and finalizer order.
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Schema, type Scope } from "effect";
import type { Sql } from "../Sql.ts";
import type * as RecordPartTest from "../telemetry/RecordPartTest.ts";
import * as RecordPartSupport from "./RecordPart.test-support.ts";

// R6, a type law: a store hands its body only `Sql`, never the driver's handle, and acquiring one
// needs a Scope. `pnpm typecheck` checks these two lines.
expectTypeOf<Parameters<Parameters<RecordPartTest.Store["use"]>[0]>[0]>().toEqualTypeOf<Sql>();
expectTypeOf<Effect.Services<ReturnType<RecordPartTest.Open>>>().toEqualTypeOf<Scope.Scope>();

const Mode = Schema.Literals(["file", "memory"]);

// SQLite text holds well-formed UTF-16 only: a lone surrogate comes back as U+FFFD.
const Row = Schema.String.check(
  Schema.isMaxLength(12),
  Schema.makeFilter((row) => !/\p{Surrogate}/u.test(row)),
);

const Move = Schema.Union([
  Schema.Struct({ move: Schema.Literal("open"), mode: Mode }),
  Schema.Struct({
    move: Schema.Literal("use"),
    // Which store, of those already open: taken modulo how many there are.
    store: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
    exit: Schema.Literals(["succeed", "fail", "throw", "interrupt"]),
    row: Row,
  }),
]);

/** Every step the support took, and the checks every law ends with once the outer scope closed. */
const watched = () => {
  const events: Array<RecordPartSupport.Event> = [];
  const opened = () => events.flatMap((e) => (e.step === "opened" ? [e.db] : []));
  const closes = (db: unknown) => events.filter((e) => e.step === "closed" && e.db === db).length;
  const folders = () => events.flatMap((e) => (e.step === "folder" ? [e.path] : []));
  const released = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const db of opened()) {
      expect(db.isOpen).toBe(false);
      expect(closes(db)).toBe(1);
    }

    expect(yield* Effect.forEach(folders(), (path) => fs.exists(path), { concurrency: 1 })).toEqual(
      folders().map(() => false),
    );
  });
  return { events, opened, closes, folders, released };
};

/** A watch that records each step and fails the `failing`-th folder or handle acquisition. */
const failingAt = (failing: number, events: Array<RecordPartSupport.Event>) => {
  let seen = 0;
  const watch: RecordPartSupport.Watch = (event) => {
    events.push(event);

    if ((event.step === "folder" || event.step === "opening") && seen++ === failing) {
      throw new Error("planted acquisition failure");
    }
  };
  return { watch, seen: () => seen };
};

const write = (row: string) => (sql: Sql) =>
  Effect.sync(() => {
    sql.exec("CREATE TABLE IF NOT EXISTS saved (row TEXT)");
    sql.exec("INSERT INTO saved (row) VALUES (?)", row);
  });

const saved = (sql: Sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name = 'saved'").length === 0
    ? []
    : sql.exec("SELECT row FROM saved ORDER BY rowid").map((r) => r["row"]);

describe("T641 record-part stores on node:sqlite", () => {
  it.effect.prop(
    "R3: a use releases its handle on success, failure, a thrown assertion and interruption",
    { moves: Schema.Array(Move).check(Schema.isMaxLength(12)) },
    ({ moves }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const watch = watched();
        const open = RecordPartSupport.make((event) => watch.events.push(event));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const stores: Array<RecordPartTest.Store> = [];

            for (const move of moves) {
              if (move.move === "open") {
                stores.push(yield* open(move.mode));
                continue;
              }

              const store = stores[move.store % stores.length];

              if (store === undefined) {
                continue;
              }

              const before = watch.opened().length;
              const body = (sql: Sql) =>
                Effect.gen(function* () {
                  yield* write(move.row)(sql);
                  // Every folder acquired so far is still there while a use runs.
                  const folders = watch.folders();
                  expect(yield* Effect.forEach(folders, (path) => fs.exists(path), { concurrency: 1 })).toEqual(
                    folders.map(() => true),
                  );
                });

              if (move.exit === "interrupt") {
                const ready = yield* Deferred.make<void>();
                const fiber = yield* Effect.forkChild(
                  store.use((sql) =>
                    body(sql).pipe(Effect.andThen(Deferred.succeed(ready, undefined)), Effect.andThen(Effect.never)),
                  ),
                );
                yield* Deferred.await(ready);
                yield* Fiber.interrupt(fiber);
              } else {
                const exit = yield* Effect.exit(
                  store.use((sql) =>
                    body(sql).pipe(
                      Effect.andThen(
                        move.exit === "fail"
                          ? Effect.fail("planted failure")
                          : move.exit === "throw"
                            ? Effect.sync(() => expect(move.row).toBe(`${move.row}!`))
                            : Effect.void,
                      ),
                    ),
                  ),
                );
                expect(Exit.isSuccess(exit)).toBe(move.exit === "succeed");
                expect(Exit.hasFails(exit)).toBe(move.exit === "fail");
                expect(Exit.hasDies(exit)).toBe(move.exit === "throw");
              }

              // The use returned only after its one handle closed, once.
              const handles = watch.opened().slice(before);
              expect(handles).toHaveLength(1);
              expect(handles[0]!.isOpen).toBe(false);
              expect(watch.closes(handles[0])).toBe(1);
            }
          }),
        );
        yield* watch.released;
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.prop(
    "R4: an acquisition that fails part way releases every folder and handle acquired before it",
    {
      modes: Schema.Array(Mode).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
      failAt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
    },
    ({ modes, failAt }) =>
      Effect.gen(function* () {
        // Each file store makes a folder, and each store opens one handle: the points that may fail.
        const points = modes.filter((mode) => mode === "file").length + modes.length;
        const failing = failAt % points;
        const watch = watched();
        const failure = failingAt(failing, watch.events);
        const open = RecordPartSupport.make(failure.watch);
        // Every store stays open while the next one is acquired: nested uses inside one scope.
        const nest = (stores: ReadonlyArray<RecordPartTest.Store>): Effect.Effect<void> => {
          const [first, ...rest] = stores;
          return first === undefined ? Effect.void : first.use(() => nest(rest));
        };
        const exit = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const stores: Array<RecordPartTest.Store> = [];

              for (const mode of modes) {
                stores.push(yield* open(mode));
              }

              yield* nest(stores);
            }),
          ),
        );
        expect(Exit.hasDies(exit)).toBe(true);
        expect(failure.seen()).toBe(failing + 1);
        yield* watch.released;
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.prop(
    "R5: a reopen closes the previous handle before it opens the next, on the same saved rows",
    { cuts: Schema.Array(Schema.Array(Row).check(Schema.isMaxLength(4))).check(Schema.isMaxLength(6)) },
    ({ cuts }) =>
      Effect.gen(function* () {
        const watch = watched();
        const open = RecordPartSupport.make((event) => watch.events.push(event));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* open("file");
            const kept: Array<string> = [];

            for (const cut of [...cuts, []]) {
              yield* store.use((sql) =>
                Effect.gen(function* () {
                  const [now, ...earlier] = watch.opened().toReversed();
                  expect(now!.isOpen).toBe(true);

                  for (const db of earlier) {
                    expect(db.isOpen).toBe(false);
                  }

                  // Each earlier handle closed before this one began to open.
                  const opening = watch.events.findLastIndex((e) => e.step === "opening");
                  expect(watch.events.slice(0, opening).filter((e) => e.step === "closed")).toHaveLength(
                    earlier.length,
                  );
                  expect(saved(sql)).toEqual(kept);

                  for (const row of cut) {
                    yield* write(row)(sql);
                  }
                }),
              );
              kept.push(...cut);
            }
          }),
        );
        expect(watch.opened()).toHaveLength(cuts.length + 1);
        yield* watch.released;
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
