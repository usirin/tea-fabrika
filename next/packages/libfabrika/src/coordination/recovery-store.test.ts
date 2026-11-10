// P34, next/. RecoveryStore's proposed storage contract is load/save/input/receipt.
// load/save keep the versioned supervisor snapshot. input and receipt are name+letter lookups.
// No test implements recovery or supplies a fake store. SQL corruption is planted after save.
import { existsSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { type Context, Effect, Exit, type Layer, Schema } from "effect";
import type { LedgerError } from "../data/ledger.ts";
import { type Sql } from "../data/referee.ts";
import { A, B, from, storage } from "./process.test-support.ts";

type Store = {
  readonly load: Effect.Effect<unknown, LedgerError>;
  readonly save: (value: unknown) => Effect.Effect<void, LedgerError>;
  readonly input: (letter: string) => Effect.Effect<unknown, LedgerError>;
  readonly receipt: (letter: string) => Effect.Effect<unknown, LedgerError>;
};

type Subject = {
  readonly RecoveryStore: Context.Service<Store, Store> & {
    readonly layer: (sql: Sql, who: { name: string; capacity: number }) => Layer.Layer<Store>;
  };
};

const modulePath = "./recovery-store.ts";

const subject = async (): Promise<Subject> => {
  expect(existsSync(new URL(modulePath, import.meta.url)), "P34 durable RecoveryStore is missing").toBe(true);
  return await import(modulePath);
};

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const input = {
  id: "poison",
  envelope: {
    id: `in-${A}-1`,
    by: { _tag: "person", key: "SHA256:caller", for: from().for },
    arrivedAt: 1,
    input: { type: "save", text: "original dead input" },
  },
  sentAt: from().sentAt,
  seen: 0,
  span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
};

const terminal = {
  letter: "poison",
  input,
  errors: ["TypeError", "RangeError", "TypeError"],
  tries: 3,
  result: { _tag: "refused", reason: "dead" },
  process: B,
};

const snapshot = {
  v: 1,
  name: "counter:1",
  policy,
  seq: 3,
  recovery: {
    _tag: "ending",
    process: B,
    failure: {
      _tag: "fresh",
      process: B,
      letter: "poison",
      build: "build-a",
      seq: 3,
      error: "TypeError",
    },
  },
  pending: { type: "dead", id: "dead:poison:3", process: B, from: from() },
  attempt: null,
  build: "build-a",
  restarts: [100, 300],
  observations: [1, 2, 3].map((seq) => ({
    seq,
    process: seq === 3 ? B : A,
    letter: "poison",
    phase: "fresh",
    error: seq === 2 ? "RangeError" : "TypeError",
    at: seq,
  })),
  receipts: [terminal],
};

describe("P34 recovery storage", () => {
  it("storage plant, eager table creation: building the Layer leaves SQLite alone", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const before = disk.sql.exec("SELECT name FROM sqlite_master");
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* S;
      }).pipe(Effect.provide(S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3 }))),
    );
    expect(disk.sql.exec("SELECT name FROM sqlite_master")).toEqual(before);
  });

  it("p80 storage plant, memory-only receipt: full decision and original input survive replacement and reopen", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3 });
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* S).save(snapshot);
      }).pipe(Effect.provide(layer())),
    );
    disk.reopen();
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* S;
        expect(yield* s.load).toEqual(snapshot);
        expect(yield* s.input("poison")).toEqual(input);
        expect(yield* s.receipt("poison")).toEqual(terminal);
        expect(yield* s.input("different")).toBeNull();
      }).pipe(Effect.provide(layer())),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* (yield* S).receipt("poison")).toBeNull();
      }).pipe(Effect.provide(S.layer(disk.sql, { name: "other:1", capacity: 1024 ** 3 }))),
    );
  });

  it.effect.prop(
    "storage plant, evict receipts at capacity: failed new save preserves all old bytes",
    { generated: Schema.Int.check(Schema.isBetween({ minimum: 128 * 1024, maximum: 256 * 1024 })) },
    ({ generated }) =>
      Effect.forEach(
        [128 * 1024, generated],
        (value) =>
          Effect.promise(async () => {
            const { RecoveryStore: S } = await subject();
            const disk = storage();
            const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 64 * 1024 });
            await Effect.runPromise(
              Effect.gen(function* () {
                const s = yield* S;
                yield* s.save(snapshot);
                const full = {
                  ...snapshot,
                  receipts: [
                    ...snapshot.receipts,
                    { ...terminal, letter: "other", input: { ...input, padding: "x".repeat(value) } },
                  ],
                };
                expect(yield* Effect.flip(s.save(full))).toMatchObject({ reason: "storage" });
                expect(yield* s.load).toEqual(snapshot);
              }).pipe(Effect.provide(layer())),
            );
            disk.reopen();
            await Effect.runPromise(
              Effect.gen(function* () {
                const s = yield* S;
                expect(yield* s.receipt("poison")).toEqual(terminal);
                expect(yield* s.input("poison")).toEqual(input);
              }).pipe(Effect.provide(layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect.prop(
    "wake probe plant, reset corrupt state: malformed durable snapshot fails closed with bad_row",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["broken", generated],
        (corrupt) =>
          Effect.promise(async () => {
            const { RecoveryStore: S } = await subject();
            const disk = storage();
            const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3 });
            await Effect.runPromise(
              Effect.gen(function* () {
                yield* (yield* S).save(snapshot);
              }).pipe(Effect.provide(layer())),
            );
            // Find the actual saved JSON column, without prescribing the store's table names.
            let planted = 0;
            const quote = (word: string) => `"${word.replaceAll('"', '""')}"`;

            for (const { name } of disk.sql.exec(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )) {
              const table = quote(String(name));

              for (const row of disk.sql.exec(`SELECT rowid, * FROM ${table}`)) {
                for (const [column, value] of Object.entries(row)) {
                  if (typeof value === "string" && value.includes('"recovery"')) {
                    disk.sql.exec(
                      `UPDATE ${table} SET ${quote(column)}=? WHERE rowid=?`,
                      JSON.stringify({ v: 999, recovery: corrupt }),
                      row.rowid!,
                    );
                    planted++;
                  }
                }
              }
            }

            expect(planted, "the cut must corrupt real saved supervision bytes").toBeGreaterThan(0);
            disk.reopen();
            await Effect.runPromise(
              Effect.gen(function* () {
                expect(yield* Effect.flip((yield* S).load)).toMatchObject({ reason: "bad_row" });
              }).pipe(Effect.provide(layer())),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it("storage plant, acknowledge before durable save: SQLITE_FULL is a failure and earlier state survives", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    let fail = false;
    const sql: Sql = {
      ...disk.sql,
      exec: (q, ...args) => {
        if (fail && /^\s*(INSERT|UPDATE|REPLACE)/i.test(q)) {
          throw new Error("SQLITE_FULL");
        }

        return disk.sql.exec(q, ...args);
      },
    };
    const layer = () => S.layer(sql, { name: "counter:1", capacity: 1024 ** 3 });
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* S;
        yield* s.save(snapshot);
        fail = true;
        const result = yield* Effect.exit(s.save({ ...snapshot, seq: 4 }));
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layer())),
    );
    fail = false;
    disk.reopen();
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* (yield* S).load).toEqual(snapshot);
      }).pipe(Effect.provide(layer())),
    );
  });

  it("p80 plant, clamp invalid settings: refused policy cannot change an existing saved decision", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3 });
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* S;
        yield* s.save(snapshot);
        expect((yield* Effect.exit(s.save({ ...snapshot, policy: { ...policy, maxDeliveries: 33 } })))._tag).toBe(
          "Failure",
        );
        expect(yield* s.load).toEqual(snapshot);
      }).pipe(Effect.provide(layer())),
    );
    disk.reopen();
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* (yield* S).load).toEqual(snapshot);
      }).pipe(Effect.provide(layer())),
    );
  });
});
