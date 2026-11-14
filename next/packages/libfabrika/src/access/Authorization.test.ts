// P17a, next/. The real SQLite turn decides membership and the append together.
// Plants: cached admission, check then append in another turn, duplicate before admission,
// dropped corrupt known events, and a missing refusal span. No replacement writer lives here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Result, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Line, lineFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { MemberEvent } from "./Access.ts";
import { ClientManager } from "./ClientManager.ts";
import * as ClientManagerLedger from "./ClientManagerLedger.ts";

let appendAdmitted: typeof import("./Authorization.ts").appendAdmitted;

beforeEach(async () => {
  ({ appendAdmitted } = await vi.importActual<typeof import("./Authorization.ts")>("./Authorization.ts"));
});

const checks = { seed: 119120, numRuns: 35 };

// Every world is a node:sqlite file in its own temp folder. The scope of one property run closes
// the connection, then removes the folder (0061).
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p17-auth-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

const open = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(path)),
    (db) =>
      Effect.sync(() => {
        if (db.isOpen) {
          db.close();
        }
      }),
  );

const root = "person-public-key",
  old = "old-client-public-key",
  other = "other-client-public-key";

const person = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const sentAt = "2026-11-08T04:00:00.000Z",
  traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

const founder = {
  name: "P17 project",
  person,
  keys: [root],
  window: old,
  by: "SHA256:root",
  build: "test",
};

const from = {
  by: "SHA256:root",
  for: person,
  sentAt,
  seen: 0,
  parent: null,
  traceId,
  build: "test",
};

const signed = { text: "already checked by the door", armored: "test signature", signer: root };

const revoke = (key: string, id: string) =>
  MemberEvent.cases.revoked.make({
    revoke: {
      id,
      key,
      for: person,
      to: "p17",
      sentAt,
      saw: { label: "Old client", location: "test", method: "panel", check: "touch" },
    },
    signed,
  });

const grant = () =>
  MemberEvent.cases.granted.make({
    grant: {
      id: "other",
      key: other,
      for: person,
      to: "p17",
      as: "window",
      sentAt,
      saw: {
        code: "1234",
        label: "Other client",
        location: "test",
        method: "compare",
        check: "touch",
        has: [],
      },
    },
    signed,
  });

const line = (body: string): Line =>
  lineFor({ ...from, by: "SHA256:old" }, Schema.TaggedStruct("saved", { text: Schema.String }).make({ text: body }));

type Observed = {
  turn: number;
  op: "read" | "get" | "head" | "append";
  stream: string;
  after?: number;
  inside: boolean;
};

const worldOn = (db: DatabaseSync, path: string, fail: boolean) => {
  const base = nodeSql(db);
  const sql: Sql = {
    ...base,
    exec: (query, ...args) => {
      if (fail && /^INSERT INTO entries/.test(query) && args[1] === "notes") {
        throw new Error("planted storage error, body must not become a tag");
      }

      return base.exec(query, ...args);
    },
  };
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const ledger = LedgerSql.layer(sql, { reader: "p17" }).pipe(Layer.provide(quiet));
  const transaction = LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet));
  const observations: Observed[] = [];
  let turns = 0;
  const observed = Layer.effect(
    LedgerTransaction,
    Effect.map(LedgerTransaction, (real) => ({
      transact: <A>(step: (turn: LedgerTurn) => A) =>
        real.transact((turn) => {
          const n = ++turns;
          return step({
            read: (stream, after) => {
              observations.push({ turn: n, op: "read", stream, after, inside: db.isTransaction });
              return turn.read(stream, after);
            },
            get: (stream, id) => {
              observations.push({ turn: n, op: "get", stream, inside: db.isTransaction });
              return turn.get(stream, id);
            },
            head: (stream) => {
              observations.push({ turn: n, op: "head", stream, inside: db.isTransaction });
              return turn.head(stream);
            },
            append: (stream, id, value) => {
              observations.push({ turn: n, op: "append", stream, inside: db.isTransaction });
              return turn.append(stream, id, value);
            },
          });
        }),
    })),
  ).pipe(Layer.provide(transaction));
  const layer = Layer.mergeAll(
    ledger,
    observed,
    ClientManagerLedger.layer(founder).pipe(Layer.provide(ledger)),
    SpanSink.layer(sql, { object: "process_01m6v5270hetdrt4r8h9vvjwjs" }),
    RecordManager.memory(1024 * 1024),
    Archive.memory,
  );
  return { db, sql, path, observations, layer };
};

/** A world on a fresh file, or on `path` opened again after a test closed it by hand. */
const world = (path?: string, fail = false) =>
  Effect.gen(function* () {
    const file = path ?? join(yield* folder, "home.db");
    return worldOn(yield* open(file), file, fail);
  });

const read = (stream: string) => Ledger.use((l) => Stream.runCollect(l.read(stream, 0)));

const boot = ClientManager.use((clients) => clients.members).pipe(
  Effect.andThen(ClientManager.use((clients) => clients.write(grant(), from))),
  Effect.asVoid,
);

const remove = (id = "revoked") => ClientManager.use((clients) => clients.write(revoke(old, id), from));

describe("P17a, appendAdmitted", () => {
  it("reads all current membership and appends in that same real transaction, including duplicates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.string({ maxLength: 30 }),
        fc.constantFrom(0, 1, 257),
        (before, after, at, body, history) =>
          Effect.runPromise(
            Effect.flatMap(world(), (w) =>
              Effect.gen(function* () {
                yield* TestClock.setTime(at);
                yield* boot;

                for (let n = 0; n < before; n++) {
                  const write = { stream: "notes", id: `before-${n}`, line: line(body) };
                  const placed = yield* appendAdmitted(old, write);
                  expect(placed._tag).toBe("placed");
                  expect(yield* appendAdmitted(old, write)).toEqual(placed);
                }

                // Unknown future events stay readable. Put revoke past the first ledger page too.
                const future = Schema.TaggedStruct("future.member", { n: Schema.Int });

                for (let n = 0; n < history; n++) {
                  yield* Ledger.use((l) =>
                    l.append("gateway/access", `future-${n}`, lineFor(from, future.make({ n }))),
                  );
                }

                yield* remove(); // Same clock. Ledger order, not timestamp, ends permission.

                for (let n = 0; n < after; n++) {
                  expect(
                    yield* Effect.flip(appendAdmitted(old, { stream: "notes", id: `after-${n}`, line: line(body) })),
                  ).toMatchObject({ _tag: "NotGranted" });
                }

                expect(
                  yield* Effect.flip(appendAdmitted(old, { stream: "notes", id: "before-0", line: line(body) })),
                ).toMatchObject({ _tag: "NotGranted" });
                expect((yield* appendAdmitted(other, { stream: "notes", id: "other", line: line(body) }))._tag).toBe(
                  "placed",
                );
                expect((yield* read("notes")).map((row) => row.id)).toEqual([
                  ...Array.from({ length: before }, (_, n) => `before-${n}`),
                  "other",
                ]);
                const appends = w.observations.filter((x) => x.op === "append");
                expect(appends).toHaveLength(before * 2 + 1);

                for (const write of appends) {
                  expect(
                    w.observations
                      .filter((x) => x.turn === write.turn)
                      .map(({ op, stream, after, inside }) => ({ op, stream, after, inside })),
                  ).toEqual([
                    { op: "read", stream: "gateway/access", after: 0, inside: true },
                    { op: "append", stream: "notes", after: undefined, inside: true },
                  ]);
                }
              }).pipe(Effect.provide(w.layer), Effect.provide(TestClock.layer())),
            ).pipe(Effect.scoped),
          ),
      ),
      checks,
    );
  });
  it("a write paused before its transaction cannot use admission from before revoke", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 0, max: 500 }),
        fc.string({ maxLength: 20 }),
        (reopen, at, body) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const w = yield* world();
              yield* boot.pipe(Effect.provide(w.layer));

              if (reopen) {
                w.db.close();
              }

              const fresh = reopen ? yield* world(w.path) : w;
              yield* Effect.gen(function* () {
                yield* TestClock.setTime(at);
                const real = yield* LedgerTransaction,
                  entered = yield* Deferred.make<void>(),
                  release = yield* Deferred.make<void>();
                const paused: typeof LedgerTransaction.Service = {
                  transact: (step) =>
                    Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                      Effect.andThen(real.transact(step)),
                    ),
                };
                const pending = yield* Effect.forkChild(
                  Effect.result(
                    appendAdmitted(old, { stream: "notes", id: "late", line: line(body) }).pipe(
                      Effect.provideService(LedgerTransaction, paused),
                    ),
                  ),
                );
                yield* Deferred.await(entered);
                yield* remove();
                yield* Deferred.succeed(release, undefined);
                const result = yield* Fiber.join(pending);
                expect(Result.isFailure(result)).toBe(true);

                if (Result.isSuccess(result)) {
                  return yield* Effect.die(new Error("late append passed revoke"));
                }

                expect(result.failure).toMatchObject({ _tag: "NotGranted" });
                expect(yield* read("notes")).toEqual([]);
              }).pipe(Effect.provide(fresh.layer), Effect.provide(TestClock.layer()));
            }).pipe(Effect.scoped),
          ),
      ),
      { ...checks, numRuns: 20 },
    );
  });
  it("corrupt known membership refuses with bad_row and writes nothing, including after reopen", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("json", "known_fact", "row"),
        fc.boolean(),
        fc.string({ maxLength: 30 }),
        (damage, reopen, body) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const w = yield* world();
              yield* boot.pipe(Effect.provide(w.layer));

              if (damage === "json") {
                w.db.exec("UPDATE entries SET body='not JSON' WHERE stream='gateway/access' AND id='founded'");
              } else if (damage === "known_fact") {
                w.db.exec("UPDATE entries SET body='{}' WHERE stream='gateway/access' AND id='founded'");
              } else {
                w.db.exec("UPDATE entries SET seen=-1 WHERE stream='gateway/access' AND id='founded'");
              }

              if (reopen) {
                w.db.close();
              }

              const fresh = reopen ? yield* world(w.path) : w;
              yield* Effect.gen(function* () {
                expect(
                  yield* Effect.flip(appendAdmitted(old, { stream: "notes", id: "bad-history", line: line(body) })),
                ).toMatchObject({ _tag: "LedgerError", reason: "bad_row" });
                expect(yield* read("notes")).toEqual([]);
              }).pipe(Effect.provide(fresh.layer));
            }).pipe(Effect.scoped),
          ),
      ),
      checks,
    );
  });
  it("reopened storage keeps revocation and the earlier accepted letter", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 30 }), fc.integer({ min: 1, max: 5 }), (body, attempts) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = yield* world();
            yield* boot.pipe(
              Effect.andThen(appendAdmitted(old, { stream: "notes", id: "accepted", line: line(body) })),
              Effect.andThen(remove()),
              Effect.provide(w.layer),
            );
            w.db.close();
            const fresh = yield* world(w.path);
            yield* Effect.gen(function* () {
              for (let n = 0; n < attempts; n++) {
                expect(
                  yield* Effect.flip(
                    appendAdmitted(old, {
                      stream: "notes",
                      id: n === 0 ? "accepted" : `late-${n}`,
                      line: line(body),
                    }),
                  ),
                ).toMatchObject({ _tag: "NotGranted" });
              }

              expect(
                (yield* appendAdmitted(other, {
                  stream: "notes",
                  id: "still-live",
                  line: line(body),
                }))._tag,
              ).toBe("placed");
              expect((yield* read("notes")).map((row) => row.id)).toEqual(["accepted", "still-live"]);
            }).pipe(Effect.provide(fresh.layer));
          }).pipe(Effect.scoped),
        ),
      ),
      { ...checks, numRuns: 20 },
    );
  });
  it("P37 records each ended admitted-append outcome and keeps body and error text out of tags", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("placed", "not_granted", "bad_row", "storage"),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 25 }),
        (outcome, id, text) =>
          Effect.runPromise(
            Effect.flatMap(world(undefined, outcome === "storage"), (w) => {
              const marker = `p17-private-body-${text}`;
              return Effect.gen(function* () {
                yield* boot;
                yield* SpanSink.use((sink) => sink.flush);

                if (outcome === "not_granted") {
                  yield* remove();
                }

                if (outcome === "bad_row") {
                  w.db.exec("UPDATE entries SET body='{}' WHERE stream='gateway/access' AND id='founded'");
                }

                // Do not wrap the call in a test span. The operation must end its own span.
                const result = yield* Effect.result(appendAdmitted(old, { stream: "notes", id, line: line(marker) }));
                expect(Result.isSuccess(result)).toBe(outcome === "placed");
                yield* SpanSink.use((sink) => sink.flush);
                const rows = yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })));
                const operations = rows.filter(
                  (row) =>
                    Object.values(row.attributes).includes(id) &&
                    Object.values(row.attributes).includes("notes") &&
                    Object.values(row.attributes).includes(outcome),
                );
                expect(operations, "the operation's own ended span records its id, stream and outcome").toHaveLength(1);

                for (const row of operations) {
                  expect(row.attributes).toMatchObject({
                    "fab.authorization.id": id,
                    "fab.authorization.stream": "notes",
                    "fab.authorization.outcome": outcome,
                  });
                  expect(row.ok).toBe(outcome === "placed");
                  expect(row.endTimeUnixNano).toBeDefined();
                  const tags = JSON.stringify(row.attributes);
                  expect(tags).not.toContain(marker);
                  expect(tags).not.toContain("planted storage error");
                }
              }).pipe(Effect.provide(w.layer));
            }).pipe(Effect.scoped),
          ),
      ),
      { ...checks, numRuns: 24 },
    );
  });
});
