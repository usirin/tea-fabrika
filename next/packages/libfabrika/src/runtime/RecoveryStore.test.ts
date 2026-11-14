// P34, next/. RecoveryStore's proposed storage contract is load/save/input/receipt.
// load/save keep the versioned supervisor snapshot: from P34c slice 2, version 2 with one `journal`.
// input and receipt are name+letter lookups.
// No test implements recovery or supplies a fake store. SQL corruption is planted after save.
// Ticket 921 slice 1: the store fails with its own `RecoveryStoreError`, whose tagged reason keeps
// the fault from below (0043 rule 12, 0055, 0119). This file names no ledger file.
import { existsSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { type Context, Effect, Exit, type Layer, Schema } from "effect";
import * as fc from "fast-check";
import { A, B, from, storage } from "../processes/Process.test-support.ts";
import type { Sql } from "../Sql.ts";
import { Supervision } from "./internal/supervisor.ts";

/** The store's own error as these laws read it: its tag, and a tagged reason with the fault it kept. */
type Fault = {
  readonly _tag: "RecoveryStoreError";
  readonly reason: { readonly _tag: "Storage" | "BadRow"; readonly cause: unknown };
};

type Store = {
  readonly load: Effect.Effect<unknown, Fault>;
  readonly save: (value: unknown) => Effect.Effect<void, Fault>;
  readonly input: (letter: string) => Effect.Effect<unknown, Fault>;
  readonly receipt: (letter: string) => Effect.Effect<unknown, Fault>;
};

type Subject = {
  readonly RecoveryStore: Context.Service<Store, Store> & {
    readonly layer: (
      sql: Sql,
      options: { name: string; capacity: number; schema: typeof Supervision },
    ) => Layer.Layer<Store>;
  };
};

const modulePath = "./RecoveryStore.ts";

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

/** The saved shape before P34c slice 2: independent recovery, pending and attempt fields. */
const before = {
  v: 1,
  name: "counter:1",
  policy,
  seq: 3,
  recovery: {
    _tag: "ending",
    process: B,
    failure: { _tag: "fresh", process: B, letter: "poison", build: "build-a", seq: 3, error: "TypeError" },
  },
  pending: { type: "dead", id: "dead:poison:3", process: B, from: from() },
  attempt: null,
  build: "build-a",
  restarts: [],
  observations: [],
  receipts: [],
};

const snapshot = {
  v: 2,
  name: "counter:1",
  policy,
  seq: 3,
  // The dead write still to do, for this exact fresh failure and its terminal receipt.
  journal: {
    _tag: "writing_dead",
    failure: { _tag: "fresh", process: B, letter: "poison", build: "build-a", seq: 3, error: "TypeError" },
    reason: { _tag: "crashed", phase: "step", error: "TypeError" },
    from: from(),
  },
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
  crashes: 3,
  healthyAt: 0,
  requests: [],
};

describe("P34 recovery storage", () => {
  it("storage plant, eager table creation: building the Layer leaves SQLite alone", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const before = disk.sql.exec("SELECT name FROM sqlite_master");
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* S;
      }).pipe(Effect.provide(S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision }))),
    );
    expect(disk.sql.exec("SELECT name FROM sqlite_master")).toEqual(before);
  });

  it("p80 storage plant, memory-only receipt: full decision and original input survive replacement and reopen", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
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
      }).pipe(Effect.provide(S.layer(disk.sql, { name: "other:1", capacity: 1024 ** 3, schema: Supervision }))),
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
            const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 64 * 1024, schema: Supervision });
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
                expect(yield* Effect.flip(s.save(full))).toMatchObject({
                  _tag: "RecoveryStoreError",
                  reason: { _tag: "Storage" },
                });
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
    "wake probe plant, reset corrupt state: malformed durable snapshot fails closed with BadRow",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["broken", generated, before],
        (corrupt) =>
          Effect.promise(async () => {
            const { RecoveryStore: S } = await subject();
            const disk = storage();
            const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
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
                  if (typeof value === "string" && value.includes('"journal"')) {
                    disk.sql.exec(
                      `UPDATE ${table} SET ${quote(column)}=? WHERE rowid=?`,
                      // An old saved shape fails explicitly too: it is never silently reset (P34c slice 2).
                      JSON.stringify(typeof corrupt === "string" ? { v: 999, journal: corrupt } : corrupt),
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
                expect(yield* Effect.flip((yield* S).load)).toMatchObject({
                  _tag: "RecoveryStoreError",
                  reason: { _tag: "BadRow" },
                });
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
    const full = new Error("SQLITE_FULL");
    const sql: Sql = {
      ...disk.sql,
      exec: (q, ...args) => {
        if (fail && /^\s*(INSERT|UPDATE|REPLACE)/i.test(q)) {
          throw full;
        }

        return disk.sql.exec(q, ...args);
      },
    };
    const layer = () => S.layer(sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* S;
        yield* s.save(snapshot);
        fail = true;
        const result = yield* Effect.exit(s.save({ ...snapshot, seq: 4 }));
        expect(Exit.isFailure(result)).toBe(true);
        // Law 8 for `save`: the throw comes back as the store's own error, with SQLite's fault under
        // its reason. Plant: build the error without `cause`.
        const fault = yield* Effect.flip(s.save({ ...snapshot, seq: 4 }));
        expect(fault._tag).toBe("RecoveryStoreError");
        expect(fault.reason._tag).toBe("Storage");
        expect(fault.reason.cause).toBe(full);
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
    const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
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
  // scenario: the plan's storage rule names one case, the shape saved before this slice: it fails
  // explicitly and is never reset. Generated malformed rows are the corrupt-state property above.
  it("scenario: P34c slice 2, an old saved shape is refused before writing, and the saved journal stays", async () => {
    const { RecoveryStore: S } = await subject();
    const disk = storage();
    const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* S;
        yield* s.save(snapshot);
        const refused = yield* Effect.flip(s.save(before));
        expect(refused).toMatchObject({ _tag: "RecoveryStoreError", reason: { _tag: "BadRow" } });
        expect(Schema.isSchemaError(refused.reason.cause), "the decoder's own failure").toBe(true);
        expect(yield* s.load).toEqual(snapshot);
      }).pipe(Effect.provide(layer())),
    );
  });

  // J9. Receipts live apart from the journal: a save that omits a receipt keeps it, through reopen.
  // Plant: delete receipts omitted from a compact snapshot.
  it("J9: a snapshot that omits receipts keeps every earlier receipt, its tries and its input", async () => {
    const { RecoveryStore: S } = await subject();
    const receipt = fc.record({
      tries: fc.integer({ min: 0, max: 3 }),
      dead: fc.boolean(),
      text: fc.string({ maxLength: 40 }),
    });
    const letters = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/), { minLength: 1, maxLength: 6 });
    await fc.assert(
      fc.asyncProperty(
        letters,
        fc.array(receipt, { minLength: 6, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        async (ids, bodies, kept) => {
          const all = ids.map((letter, n) => {
            const body = bodies[n]!;
            const tries = body.dead ? Math.max(body.tries, 1) : body.tries;
            return {
              letter,
              input: tries === 0 && n % 2 === 0 ? null : { ...input, id: letter, text: body.text },
              ...(tries === 0 && n % 2 === 0 ? { digest: `sha256:${letter}` } : {}),
              errors: Array.from({ length: tries }, () => "TypeError"),
              tries,
              result: body.dead ? { _tag: "refused", reason: "dead" } : null,
              process: A,
            };
          });
          const idle = { ...snapshot, journal: { _tag: "idle", process: A } };
          const disk = storage();
          const layer = () => S.layer(disk.sql, { name: "counter:1", capacity: 1024 ** 3, schema: Supervision });
          await Effect.runPromise(
            Effect.gen(function* () {
              const s = yield* S;
              yield* s.save({ ...idle, receipts: all });
              // A compact snapshot: only some receipts ride along.
              yield* s.save({ ...idle, seq: 4, receipts: all.filter((_, n) => kept[n]) });
            }).pipe(Effect.provide(layer())),
          );
          disk.reopen();
          await Effect.runPromise(
            Effect.gen(function* () {
              const s = yield* S;

              for (const r of all) {
                expect(yield* s.receipt(r.letter)).toEqual(r);
              }

              const loaded = (yield* s.load) as { receipts: ReadonlyArray<unknown>; seq: number };
              expect(loaded.seq).toBe(4);
              expect(loaded.receipts).toHaveLength(all.length);
            }).pipe(Effect.provide(layer())),
          );
        },
      ),
      { seed: 119120, numRuns: 40 },
    );
  });
});
