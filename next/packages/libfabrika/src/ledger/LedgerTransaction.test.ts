// P33, p79 atomic exit's storage contract. Each plant is named beside its law.
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream, Tracer } from "effect";
import type { Sql } from "../Sql.ts";
import { Doorbell, Ledger, LedgerError } from "./Ledger.ts";
import { LedgerTransaction } from "./LedgerTransaction.ts";
import type { Line } from "./Log.ts";
import { nodeSql } from "./NodeSqlite.ts";

const opened: Array<DatabaseSync> = [];

afterEach(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
});

const line = (n: number): Line => ({
  by: "SHA256:brain",
  for: "person-a",
  sentAt: "2026-11-07T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
  _tag: "fact",
  body: { n },
});

const setup = (
  ring: (to: string, stream: string, rev: number) => Effect.Effect<void, LedgerError> = () => Effect.void,
) => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  const backend = nodeSql(db);
  const fault: { after: number | null; passed: number } = { after: null, passed: 0 };
  const sql: Sql = {
    ...backend,
    exec: (query, ...params) => {
      if (/^\s*INSERT\s+INTO\s+entries\b/i.test(query)) {
        if (fault.after === 0) {
          throw new Error("planted SQLITE_FULL");
        }

        if (fault.after !== null) {
          fault.after--;
        }

        const rows = backend.exec(query, ...params);
        fault.passed++;
        return rows;
      }

      return backend.exec(query, ...params);
    },
  };
  const layer = Layer.mergeAll(Ledger.sql(sql, { reader: "watcher" }), LedgerTransaction.layer(sql)).pipe(
    Layer.provide(Layer.succeed(Doorbell, { ring })),
  );
  return { db, sql, fault, layer };
};

// A platform callback throws before Effect receives it; LedgerTransaction must catch it.
const diskFailure = (code: string): never => {
  throw Object.assign(new Error("disk"), { code });
};

describe("p79, LedgerTransaction", () => {
  it.effect("plant, separate numbering: reads see earlier writes and share P6's rev and pos", () => {
    const store = setup();
    return Effect.gen(function* () {
      const ledger = yield* Ledger;
      const tx = yield* LedgerTransaction;
      expect(yield* ledger.append("a", "one", line(1))).toEqual({ _tag: "placed", rev: 1, pos: 1 });
      expect(
        yield* tx.transact((turn) => {
          const a = turn.append("a", "two", line(2));
          const b = turn.append("b", "three", line(3));
          return { a, b, read: [...turn.read("a", 1)].map((row) => row.id) };
        }),
      ).toEqual({ a: { rev: 2, pos: 2 }, b: { rev: 3, pos: 1 }, read: ["two"] });
      expect(yield* ledger.append("b", "four", line(4))).toEqual({
        _tag: "placed",
        rev: 4,
        pos: 2,
      });
    }).pipe(Effect.provide(store.layer));
  });
  it.effect.prop(
    "plant, swallow a later storage failure: an earlier successful INSERT rolls back",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [2, generated],
        (value) => {
          const store = setup();
          return Effect.gen(function* () {
            const ledger = yield* Ledger;
            const tx = yield* LedgerTransaction;
            yield* ledger.append("a", "one", line(1));
            store.fault.after = 1;
            const before = store.fault.passed;
            expect(
              (yield* Effect.flip(
                tx.transact((turn) => {
                  turn.append("a", "two", line(value));
                  turn.append("b", "three", line(3));
                }),
              )).reason,
            ).toBe("storage");
            expect(store.fault.passed - before).toBe(1);
            store.fault.after = null;
            expect((yield* Stream.runCollect(ledger.read("a", 0))).map((row) => row.id)).toEqual(["one"]);
            expect(yield* Stream.runCollect(ledger.read("b", 0))).toEqual([]);
            expect(yield* ledger.append("b", "after", line(4))).toEqual({
              _tag: "placed",
              rev: 2,
              pos: 1,
            });
          }).pipe(Effect.provide(store.layer));
        },
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "plant, drop a string code: a platform error's code rides as a span tag",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["EIO", generated],
        (value) => {
          const store = setup();
          const spans: Array<Tracer.NativeSpan> = [];
          const tracer = Tracer.make({
            span: (options) => {
              const span = new Tracer.NativeSpan(options);
              spans.push(span);
              return span;
            },
          });
          return Effect.gen(function* () {
            const tx = yield* LedgerTransaction;
            const error = yield* Effect.flip(tx.transact(() => diskFailure(value)));
            expect(error.reason).toBe("storage");
            const codes = spans.flatMap((span) =>
              [...span.attributes].filter(([key]) => key.endsWith(".code")).map(([, value]) => value),
            );
            expect(codes).toEqual([value]);
          }).pipe(Effect.provide(store.layer), Effect.withTracer(tracer));
        },
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const reason of ["id_reused", "seen_ahead", "bad_trace"] as const) {
    it.effect.prop(
      `plant, keep the first append on ${reason}: refusal aborts the entire turn`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [2, generated],
          (value) => {
            const store = setup();
            return Effect.gen(function* () {
              const ledger = yield* Ledger;
              const tx = yield* LedgerTransaction;
              yield* ledger.append("a", "one", line(1));
              const refused =
                reason === "seen_ahead"
                  ? { ...line(3), seen: 900 }
                  : reason === "bad_trace"
                    ? { ...line(3), traceId: "wrong" }
                    : line(3);
              expect(
                (yield* Effect.flip(
                  tx.transact((turn) => {
                    turn.append("b", "early", line(value));
                    turn.append("a", reason === "id_reused" ? "one" : "late", refused);
                  }),
                )).reason,
              ).toBe("refused");
              expect(yield* Stream.runCollect(ledger.read("b", 0))).toEqual([]);
              expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
            }).pipe(Effect.provide(store.layer));
          },
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("plant, reappend on retry: the original placings return without new rows or rings", () => {
    const rings: Array<string> = [];
    const store = setup((_to, stream) =>
      Effect.sync(() => {
        rings.push(stream);
      }),
    );
    return Effect.gen(function* () {
      const ledger = yield* Ledger;
      const tx = yield* LedgerTransaction;
      yield* ledger.wait("a", 0);
      yield* ledger.wait("b", 0);
      const write = () => tx.transact((turn) => [turn.append("a", "one", line(1)), turn.append("b", "two", line(2))]);
      const a = yield* write();
      expect(yield* write()).toEqual(a);
      expect(rings.sort()).toEqual(["a", "b"]);
      expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
    }).pipe(Effect.provide(store.layer));
  });
  it.effect("plant, ring before commit: every notification sees both committed appends", () => {
    const observations: Array<{ inTransaction: boolean; rows: number }> = [];
    const store = setup(() =>
      Effect.sync(() => {
        observations.push({
          inTransaction: store.db.isTransaction,
          rows: Number(store.db.prepare("SELECT count(*) AS n FROM entries").get()?.["n"]),
        });
      }),
    );
    return Effect.gen(function* () {
      const ledger = yield* Ledger;
      const tx = yield* LedgerTransaction;
      yield* ledger.wait("a", 0);
      yield* ledger.wait("b", 0);
      store.fault.after = 1;
      yield* Effect.flip(
        tx.transact((turn) => {
          turn.append("a", "one", line(1));
          turn.append("b", "two", line(2));
        }),
      );
      expect(observations).toEqual([]);
      store.fault.after = null;
      yield* tx.transact((turn) => {
        turn.append("a", "one", line(1));
        turn.append("b", "two", line(2));
      });
      expect(observations).toEqual([
        { inTransaction: false, rows: 2 },
        { inTransaction: false, rows: 2 },
      ]);
    }).pipe(Effect.provide(store.layer));
  });
  it.effect.prop(
    "plant, undo a commit on notification failure: a failed bell cannot lose entries",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) => {
          let rings = 0;
          const store = setup(() =>
            Effect.sync(() => {
              rings++;
            }).pipe(Effect.andThen(Effect.fail(new LedgerError({ reason: "unreachable" })))),
          );
          return Effect.gen(function* () {
            const ledger = yield* Ledger;
            const tx = yield* LedgerTransaction;
            yield* ledger.wait("a", 0);
            const write = () => tx.transact((turn) => turn.append("a", "one", line(value)));
            expect(yield* write()).toEqual({ rev: 1, pos: 1 });
            expect(yield* write()).toEqual({ rev: 1, pos: 1 });
            expect(rings).toBe(1);
            expect(yield* Stream.runCollect(ledger.read("a", 0))).toHaveLength(1);
          }).pipe(Effect.provide(store.layer));
        },
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect("plant, one page is all history: a turn reads past P6's 256-row page", () => {
    const store = setup();
    return Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      yield* tx.transact((turn) => {
        for (let n = 1; n <= 260; n++) {
          turn.append("a", `m${n}`, line(n));
        }
      });
      expect(yield* tx.transact((turn) => [...turn.read("a", 0)].map((row) => row.rev))).toEqual(
        Array.from({ length: 260 }, (_, i) => i + 1),
      );
    }).pipe(Effect.provide(store.layer));
  });
  it.effect.prop(
    "plant, reset corrupt storage: a malformed saved row fails as bad_row",
    {
      generated: Schema.String.check(
        Schema.makeFilter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
      ),
    },
    ({ generated }) =>
      Effect.forEach(
        ["not JSON", generated],
        (value) => {
          const store = setup();
          return Effect.gen(function* () {
            const tx = yield* LedgerTransaction;
            yield* tx.transact((turn) => turn.append("a", "one", line(1)));
            store.db.prepare("UPDATE entries SET body=?").run(value);
            expect((yield* Effect.flip(tx.transact((turn) => [...turn.read("a", 0)]))).reason).toBe("bad_row");
          }).pipe(Effect.provide(store.layer));
        },
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});
