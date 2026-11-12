// Today's version, ticket 102 round 24: the shared host's nonblocking SQLite retry.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Ledger } from "./ledger.ts";
import * as driver from "./sqlite-driver.ts";
import { layerSqliteSync } from "./sqlite.ts";

const runs = { arbitrary: { seed: 119120, numRuns: 12 } };
const periods = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }));
const event = { kind: "test", writer: "user:owner" };

const database = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "sql-retry-"))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );
  const path = join(dir, "ledger.sqlite");
  const context = yield* Layer.build(layerSqliteSync({ path, tickMs: 60_000, pollMs: 60_000 }));
  const ledger = Context.get(context, Ledger);
  yield* ledger.register("retry", "user:owner");
  const lock = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(path)),
    (db) => Effect.sync(() => db.close()),
  );
  return { ledger, lock };
});

afterEach(() => vi.restoreAllMocks());

/** A synchronous driver fault after the real commit, once, including extended busy codes. */
const busyAfterCommit = (code: number) => {
  const dispatch = driver.dispatch;
  let calls = 0;
  vi.spyOn(driver, "dispatch").mockImplementation((...args) => {
    const answer = dispatch(...args);

    if (args[4] === "append") {
      calls++;

      if (calls === 1) {
        throw Object.assign(new Error("busy after commit"), { errcode: code });
      }
    }

    return answer;
  });
  return () => calls;
};

describe("ask desk round 24: a held SQLite write lock", () => {
  // Plant: remove the Effect retry, so the first SQLITE_BUSY escapes.
  it.effect.prop(
    "succeeds once the lock is released within the limit",
    { periods },
    ({ periods }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { ledger, lock } = yield* database;
          lock.exec("BEGIN IMMEDIATE");
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lock.isTransaction) {
                lock.exec("ROLLBACK");
              }
            }),
          );
          let done = false;
          const call = yield* ledger.append("retry/inbox", "any", event).pipe(
            Effect.result,
            Effect.tap(() =>
              Effect.sync(() => {
                done = true;
              }),
            ),
            Effect.forkChild,
          );
          yield* TestClock.adjust(periods * 25);
          expect(done).toBe(false);
          expect(lock.prepare("SELECT * FROM events WHERE kind = 'test'").all()).toHaveLength(0);
          lock.exec("COMMIT");
          yield* TestClock.adjust(25);
          expect(done).toBe(true);
          expect(Result.isSuccess(yield* Fiber.join(call))).toBe(true);
          expect(lock.prepare("SELECT * FROM events WHERE kind = 'test'").all()).toHaveLength(1);
        }),
      ),
    runs,
  );

  // Plant: extend the retry beyond SQLite's 10 s limit, or leave Busy unmapped.
  it.effect.prop(
    "returns the store's busy error after the limit without a write",
    { periods },
    ({ periods }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { ledger, lock } = yield* database;
          lock.exec("BEGIN IMMEDIATE");
          yield* Effect.addFinalizer(() => Effect.sync(() => lock.exec("ROLLBACK")));
          let done = false;
          const call = yield* ledger.append("retry/inbox", "any", event).pipe(
            Effect.result,
            Effect.tap(() =>
              Effect.sync(() => {
                done = true;
              }),
            ),
            Effect.forkChild,
          );
          yield* TestClock.adjust(10_000 - periods * 25);
          expect(done).toBe(false);
          yield* TestClock.adjust(periods * 25 + 25);
          expect(done).toBe(true);
          const result = yield* Fiber.join(call);
          expect(Result.isFailure(result)).toBe(true);

          if (Result.isFailure(result)) {
            expect(result.failure).toMatchObject({
              _tag: "LedgerUnreachable",
              method: "sqlite",
              message: expect.stringMatching(/locked|busy/i),
            });
          }

          expect(lock.prepare("SELECT * FROM events WHERE kind = 'test'").all()).toHaveLength(0);
        }),
      ),
    runs,
  );

  // The real transaction commits before this injected busy error. A second append has no id
  // to dedupe it. Plant: change `isBusy(e) && !committed` to `isBusy(e)`.
  it.effect.prop(
    "never retries a call that committed before reporting busy",
    { code: Schema.Literals([5, 261, 517]) },
    ({ code }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { ledger, lock } = yield* database;
          const calls = busyAfterCommit(code);
          yield* Effect.addFinalizer(() => Effect.sync(() => vi.restoreAllMocks()));
          const call = yield* ledger.append("retry/inbox", "any", event).pipe(Effect.result, Effect.forkChild);
          yield* TestClock.adjust(50);
          const result = yield* Fiber.join(call);
          expect(calls()).toBe(1);
          expect(lock.prepare("SELECT * FROM events WHERE kind = 'test'").all()).toHaveLength(1);
          expect(Result.isFailure(result)).toBe(true);

          if (Result.isFailure(result)) {
            expect(result.failure).toMatchObject({
              _tag: "LedgerUnreachable",
              method: "sqlite",
              message: "busy after commit",
            });
          }
        }),
      ),
    runs,
  );
});
