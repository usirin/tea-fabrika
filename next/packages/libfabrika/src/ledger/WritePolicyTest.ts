// P34c, next/. A policy is synchronous: its charge must roll back with the entry.
// New contract used here: WritePolicy { admit(entry): Result<void, "quota"> }.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Layer, Result, Schema } from "effect";
import type { Scope } from "effect";
import type { Sql } from "../Sql.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction } from "./LedgerTransaction.ts";
import * as LedgerTransactionSql from "./LedgerTransactionSql.ts";
import { Appended, type Entry, Line, Row, lineFor } from "./Log.ts";
import { Referee } from "./Referee.ts";
import * as RefereeSql from "./RefereeSql.ts";
import { WritePolicy } from "./WritePolicy.ts";

export interface Store {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
}

const required = <A>(value: A | undefined): A => Option.getOrThrow(Option.fromUndefinedOr(value));

const Cell = Schema.Struct({
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  text: Schema.String,
});

const Tape = Schema.Array(Cell).check(Schema.isMinLength(10), Schema.isMaxLength(30));
const options = { arbitrary: { seed: 119120, runs: 40 } };
const body = Schema.TaggedStruct("saved", { text: Schema.String });

const line = (text: string): Line =>
  lineFor(
    {
      by: "SHA256:writer",
      for: "test-person",
      sentAt: "2099-01-01T00:00:00Z",
      seen: 0,
      parent: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      build: "test",
    },
    body.make({ text }),
  );

// The encoder orders schema fields and includes every committed Entry field, not the SQL body cell.
const size = (entry: Entry) =>
  new TextEncoder().encode(
    JSON.stringify(
      Schema.encodeSync(
        Schema.toCodecJson(
          Schema.Struct({
            id: Row.fields.id,
            stream: Row.fields.stream,
            pos: Row.fields.pos,
            rev: Row.fields.rev,
            arrivedAt: Row.fields.arrivedAt,
            ...Line.fields,
          }),
        ),
      )(entry),
    ),
  ).length;

const rows = (sql: Sql) => {
  // oxlint-disable-next-line fabrika/no-ledger-sql -- Independent SQL oracle checks committed rows and transaction rollback (Q3/Q4).
  return sql.exec("SELECT * FROM entries ORDER BY rev").map((row) => Schema.decodeUnknownSync(Row)(row));
};

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P34c ledger admission", () => {
    it.effect.prop(
      "Q3 equal retries precede admission, even full and reopened; changed content keeps id_reused",
      { tape: Tape },
      ({ tape }) =>
        Effect.gen(function* () {
          const store = yield* open;
          const { sql } = store;
          sql.exec("CREATE TABLE test_charge (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)");
          let full = false;
          let calls = 0;
          const layer = Layer.mergeAll(RefereeSql.layer(sql), LedgerTransactionSql.layer(sql)).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Doorbell, { ring: () => Effect.void }),
                Layer.succeed(WritePolicy, {
                  admit: (entry) => {
                    calls++;

                    if (full) {
                      return Result.fail("quota");
                    }

                    sql.exec("INSERT INTO test_charge VALUES (?, ?)", entry.id, size(entry));
                    return Result.succeed(undefined);
                  },
                }),
              ),
            ),
          );
          const call = <A, E>(work: Effect.Effect<A, E, Referee>) => work.pipe(Effect.provide(layer));
          const history: Array<{ id: string; line: Line; answer: unknown }> = [];

          for (const [n, cell] of tape.entries()) {
            full = false;
            const id = `write:${n}`;
            const first = line(cell.text);
            const answer = yield* call(Referee.use((r) => r.append("facts", id, first)));
            expect(answer).toHaveProperty("_tag", "placed");
            history.push({ id, line: first, answer });
            full = true;
            yield* store.reopen;
            const chosen = required(history[cell.pick % history.length]);
            const before = rows(sql);
            const charged = sql.exec("SELECT * FROM test_charge ORDER BY id");
            const checked = calls;
            expect(
              yield* call(
                Referee.use((r) => r.append("facts", chosen.id, { ...chosen.line, sentAt: "1900", build: "new" })),
              ),
            ).toEqual(chosen.answer);
            expect(yield* call(Referee.use((r) => r.append("facts", chosen.id, line(`${cell.text}changed`))))).toEqual(
              Appended.cases.refused.make({ reason: "id_reused" }),
            );
            expect(calls, "neither a retry nor an ID conflict reaches admission").toBe(checked);
            expect(yield* call(Referee.use((r) => r.append("facts", `${id}:excess`, line(cell.text))))).toEqual(
              Appended.cases.refused.make({ reason: "quota" }),
            );
            expect(rows(sql)).toEqual(before);
            expect(sql.exec("SELECT * FROM test_charge ORDER BY id")).toEqual(charged);
          }
        }),
      options,
    );

    it.effect.prop(
      "Q4 refusal or storage cut rolls the entire multi-write transaction and its charges back",
      { tape: Tape },
      ({ tape }) =>
        Effect.gen(function* () {
          const store = yield* open;
          const { sql } = store;
          sql.exec("CREATE TABLE test_charge (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)");
          let at = 0;
          let cut = -1;
          let refuse = true;
          const rings: Array<unknown> = [];
          const layer = Layer.mergeAll(RefereeSql.layer(sql), LedgerTransactionSql.layer(sql)).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Doorbell, {
                  ring: (...args) =>
                    Effect.sync(() => {
                      rings.push(args);
                    }),
                }),
                Layer.succeed(WritePolicy, {
                  admit: (entry) => {
                    if (at++ === cut) {
                      if (refuse) {
                        return Result.fail("quota");
                      }

                      // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- Synchronous SQL callback injects a driver fault inside the transaction.
                      throw new Error("SQLITE_FULL at admission");
                    }

                    sql.exec("INSERT INTO test_charge VALUES (?, ?)", entry.id, size(entry));
                    return Result.succeed(undefined);
                  },
                }),
              ),
            ),
          );
          const run = <A, E, R extends Referee | LedgerTransaction>(work: Effect.Effect<A, E, R>) =>
            work.pipe(Effect.provide(layer));

          for (const [n, cell] of tape.entries()) {
            const width = 2 + (cell.pick % 4);
            yield* run(Referee.use((r) => r.read("facts", 0, "reader")));
            const before = rows(sql);
            const charge = sql.exec("SELECT * FROM test_charge ORDER BY id");
            yield* run(Referee.use((r) => r.wait("facts", before.length, "waiter")));
            // oxlint-disable-next-line fabrika/no-ledger-sql -- Independent SQL oracle checks committed rows and transaction rollback (Q3/Q4).
            const waiting = sql.exec("SELECT * FROM rings");
            const rang = rings.length;

            // Every actual boundary, including after the last admitted row, for this generated bundle.
            for (let boundary = 0; boundary < width; boundary++) {
              cut = boundary;
              at = 0;
              refuse = cell.pick % 2 === 0;
              expect(
                yield* Effect.result(
                  run(
                    LedgerTransaction.use((t) =>
                      t.transact((turn) => {
                        for (let j = 0; j < width; j++) {
                          turn.append("facts", `bundle:${n}:${j}`, line(cell.text));
                        }
                      }),
                    ),
                  ),
                ),
              ).toHaveProperty("_tag", "Failure");
              expect(rows(sql)).toEqual(before);
              expect(sql.exec("SELECT * FROM test_charge ORDER BY id")).toEqual(charge);
              // oxlint-disable-next-line fabrika/no-ledger-sql -- Independent SQL oracle checks committed rows and transaction rollback (Q3/Q4).
              expect(sql.exec("SELECT * FROM rings")).toEqual(waiting);
              expect(rings.length).toBe(rang);
              yield* store.reopen;
            }

            cut = -1;
            at = 0;
            yield* run(
              LedgerTransaction.use((t) =>
                t.transact((turn) => {
                  for (let j = 0; j < width; j++) {
                    turn.append("facts", `bundle:${n}:${j}`, line(cell.text));
                  }
                }),
              ),
            );
            const committed = rows(sql);
            expect(committed.length).toBe(before.length + width);
            expect(committed.map((e) => e.rev)).toEqual(Array.from({ length: committed.length }, (_, j) => j + 1));
            expect(rings.length).toBe(rang + 1);

            for (const e of committed) {
              expect(sql.exec("SELECT bytes FROM test_charge WHERE id = ?", e.id)).toEqual([{ bytes: size(e) }]);
            }
          }
        }),
      options,
    );
  });
