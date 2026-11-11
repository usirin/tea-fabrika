// T695, next/. The ledger's translated errors keep the failure they wrap (decision 0043 rule 12,
// `.patterns/effect-errors-keep-their-cause.md`). A suite on any `Sql`, read through its module as
// `LedgerCauseTest.suite(law, fresh, corrupt)`; the module that owns the driver runs it (0062).
//
// Audit sites: `Ledger.ts:86` (a rejected stub call), `Ledger.ts:91` (an answer that does not
// decode), both now in `LedgerRemote.ts` (0095), `internal/ledgerStore.ts:192` (a throw in the atomic step, and its pass-through branch).
import { describe, expect } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { Doorbell, Ledger, LedgerError, type LedgerCalls } from "./Ledger.ts";
import * as LedgerRemote from "./LedgerRemote.ts";
import * as LedgerSql from "./LedgerSql.ts";
import { Appended, type Line, lineFor, Waited } from "./Log.ts";
import { Referee } from "./Referee.ts";
import * as RefereeSql from "./RefereeSql.ts";

const READER = "connection:t1";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

const methods = fc.constantFrom("append", "read", "wait");
type Method = "append" | "read" | "wait";

const Saved = Schema.TaggedStruct("saved", { note: Schema.String });

const line = (note: string): Line =>
  lineFor(
    {
      by: "SHA256:writer-a",
      for: "owner",
      sentAt: "2026-11-07T21:10:01.204Z",
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: "b-7c1d073",
    },
    Saved.make({ note }),
  );

const ring = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** One call on the ledger, by name, run to its end: a read is collected whole. */
const callOn = (method: Method) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    if (method === "append") {
      return yield* ledger.append("notes:1", "w-1", line("n-1"));
    }

    if (method === "read") {
      return yield* Stream.runCollect(ledger.read("notes:1", 0));
    }

    return yield* ledger.wait("notes:1", 0);
  });

/** A stub whose every call rejects with `failure`. */
const rejecting = (failure: unknown): LedgerCalls => ({
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  append: () => Promise.reject(failure),
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  read: () => Promise.reject(failure),
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  wait: () => Promise.reject(failure),
});

/** A stub whose every call answers `raw`. */
const answering = (raw: unknown): LedgerCalls => ({
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  append: () => Promise.resolve(raw),
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  read: () => Promise.resolve(raw),
  // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
  wait: () => Promise.resolve(raw),
});

/** A valid answer for each call, then one schema-required field damaged. */
const damaged = (method: Method, rev: number, bad: string): unknown => {
  if (method === "append") {
    return { ...Appended.cases.placed.make({ rev, pos: rev }), rev: bad };
  }

  if (method === "read") {
    return [{ rev: bad }];
  }

  return { ...Waited.cases.ready.make({ rev }), rev: bad };
};

/** The same `Sql`, but its next atomic step throws `failure` once the tables exist. */
const throwing = (sql: Sql, failure: unknown): { readonly sql: Sql; readonly arm: () => void } => {
  let armed = false;
  return {
    sql: {
      ...sql,
      transaction: (step) => {
        if (armed) {
          throw failure;
        }

        return sql.transaction(step);
      },
    },
    arm: () => {
      armed = true;
    },
  };
};

/** Runs one property: generated input, each case an Effect on the real code. The runner gives it. */
export type Law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown>) => void;

/**
 * The ledger's laws on a fresh `Sql` each. `corrupt` is the runner's plant on a stored row: it sets
 * the first entry's required integer `seen` to `text`, since only a test file writes ledger tables.
 */
export const suite = (law: Law, fresh: () => Sql, corrupt: (sql: Sql, text: string) => void) => {
  describe("T695, LedgerRemote.layer keeps what failed", () => {
    // C1, LedgerRemote.ts (was Ledger.ts:86). Plant: `catch: () => new LedgerError({ reason: "unreachable" })`.
    law(
      "C1: a generated rejection on any call is `unreachable` with that very value as its cause",
      fc.record({ method: methods, failure: failures }),
      ({ method, failure }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(callOn(method));
          expect(error).toBeInstanceOf(LedgerError);
          expect(error.reason).toBe("unreachable");
          expect(error.cause).toBe(failure);
        }).pipe(Effect.provide(LedgerRemote.layer(rejecting(failure), { reader: READER }))),
    );

    // C3, LedgerRemote.ts (was Ledger.ts:91). Plant: `Effect.mapError(() => new LedgerError({ reason: "bad_row" }))`.
    law(
      "C3: an answer with a damaged required field is `bad_row` carrying the decoder's SchemaError",
      fc.record({ method: methods, rev: fc.integer({ min: 1, max: 1_000 }), bad: fc.string() }),
      ({ method, rev, bad }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(callOn(method));
          expect(error.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        }).pipe(Effect.provide(LedgerRemote.layer(answering(damaged(method, rev, bad)), { reader: READER }))),
    );

    // C2: a remote call whose referee failed keeps the whole chain: the outer `unreachable` holds
    // the referee's own `storage` error, which holds what SQLite threw. Plant: replace the inner
    // cause with its message (`cause: String(error)` in ledgerStore.ts or Ledger.ts).
    law(
      "C2: a referee's typed failure across the stub keeps its tag, its reason and its own cause",
      fc.record({ methodsRun: fc.array(methods, { minLength: 1, maxLength: 4 }), failure: failures }),
      ({ methodsRun, failure }) =>
        Effect.gen(function* () {
          const planted = throwing(fresh(), failure);
          const referee = yield* Effect.provide(
            Effect.gen(function* () {
              return yield* Referee;
            }),
            RefereeSql.layer(planted.sql).pipe(Layer.provide(ring)),
          );
          // The stub bridges to the real referee, as a Durable Object stub does: through a Promise.
          const calls: LedgerCalls = {
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Durable Object stub answers with a Promise
            append: (stream, id, raw) => Effect.runPromise(referee.append(stream, id, raw)),
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Durable Object stub answers with a Promise
            read: (stream, after, reader) => Effect.runPromise(referee.read(stream, after, reader)),
            // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Durable Object stub answers with a Promise
            wait: (stream, after, reader) => Effect.runPromise(referee.wait(stream, after, reader)),
          };
          const remote = LedgerRemote.layer(calls, { reader: READER });
          // Setup on the real referee first: the tables exist, then the disk fails.
          yield* Effect.provide(callOn("append"), remote);
          planted.arm();

          for (const method of methodsRun) {
            const outer = yield* Effect.flip(Effect.provide(callOn(method), remote));
            expect(outer.reason).toBe("unreachable");
            expect(outer.cause).toBeInstanceOf(LedgerError);
            const inner = outer.cause as LedgerError;
            expect(inner._tag).toBe("LedgerError");
            expect(inner.reason).toBe("storage");
            expect(inner.cause).toBe(failure);
          }
        }),
    );
  });

  describe("T695, LedgerSql.layer keeps what the store threw", () => {
    // C1, ledgerStore.ts:192. Plant: drop `cause` from the `storage` failure.
    law(
      "C1: a generated throw in the atomic step is `storage` with the thrown value as its cause",
      fc.record({ method: methods, failure: failures }),
      ({ method, failure }) =>
        Effect.gen(function* () {
          const planted = throwing(fresh(), failure);
          const ledger = LedgerSql.layer(planted.sql, { reader: READER }).pipe(Layer.provide(ring));
          yield* Effect.provide(callOn("append"), ledger);
          planted.arm();
          const error = yield* Effect.flip(Effect.provide(callOn(method), ledger));
          expect(error.reason).toBe("storage");
          expect(error.cause).toBe(failure);
        }),
    );

    // C3, ledgerStore.ts:192. Plant: drop `cause` from the `bad_row` failure.
    law(
      "C3: a stored row damaged after a valid append is `bad_row` carrying the decoder's SchemaError",
      fc.record({ notes: fc.array(fc.string(), { minLength: 1, maxLength: 4 }), bad: fc.string() }),
      ({ notes, bad }) =>
        Effect.gen(function* () {
          const sql = fresh();
          const ledger = LedgerSql.layer(sql, { reader: READER }).pipe(Layer.provide(ring));
          yield* Effect.provide(
            Effect.forEach(notes, (note, n) => Ledger.use((l) => l.append("notes:1", `w-${n}`, line(note))), {
              concurrency: 1,
            }),
            ledger,
          );
          // A required integer column now holds text, as a row this ledger never wrote.
          corrupt(sql, `x${bad}`);
          const error = yield* Effect.flip(Effect.provide(callOn("read"), ledger));
          expect(error.reason).toBe("bad_row");
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        }),
    );

    // C4, ledgerStore.ts:188. Plant: `return Effect.fail(new LedgerError({ reason: error.reason }))`.
    law(
      "C4: a LedgerError thrown inside the step comes out as that same object, its chain untouched",
      fc.record({
        method: methods,
        reason: fc.constantFrom("unreachable", "bad_row", "storage", "refused", "crypto"),
        failure: failures,
      }),
      ({ method, reason, failure }) =>
        Effect.gen(function* () {
          const thrown = new LedgerError({ reason, cause: failure });
          const planted = throwing(fresh(), thrown);
          const ledger = LedgerSql.layer(planted.sql, { reader: READER }).pipe(Layer.provide(ring));
          yield* Effect.provide(callOn("append"), ledger);
          planted.arm();
          const error = yield* Effect.flip(Effect.provide(callOn(method), ledger));
          expect(error).toBe(thrown);
          expect(error.cause).toBe(failure);
        }),
    );
  });
};
