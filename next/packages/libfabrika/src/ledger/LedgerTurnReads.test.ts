// T936 slice 1, next/: L3 and L4, the ledger turn's two indexed reads on node:sqlite (0062). This
// module owns the driver, so the laws open node:sqlite themselves, as LedgerTransaction.test.ts does.
//
// L3: `get(stream, id)` and `head(stream)` answer what `read(stream, 0)` holds, inside the turn that
// appended and in a later turn. L4: SQLite answers both through an index of `entries`, never a scan.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import * as fc from "fast-check";
import type { Sql, SqlValue } from "../Sql.ts";
import { property } from "../Testing.test-support.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction, type LedgerTurn } from "./LedgerTransaction.ts";
import * as LedgerTransactionSql from "./LedgerTransactionSql.ts";
import type { Line } from "./Log.ts";
import { nodeSql } from "./NodeSqlite.ts";

// A fresh in-memory node:sqlite, closed by the test's scope (0061).
const memory = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

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

/** Every query the store sends while `capture` is on, with its parameters. */
const recorded = (db: DatabaseSync) => {
  const backend = nodeSql(db);
  const seen: Array<{ readonly query: string; readonly params: ReadonlyArray<SqlValue> }> = [];
  const state = { capture: false };
  const sql: Sql = {
    ...backend,
    exec: (query, ...params) => {
      if (state.capture) {
        seen.push({ query, params });
      }

      return backend.exec(query, ...params);
    },
  };
  const layer = LedgerTransactionSql.layer(sql).pipe(
    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
  );
  return { seen, state, layer };
};

/** Three streams that share ids, so a lookup that drops `stream` or `id` answers another entry. */
const STREAMS = ["a", "b/inbox", "c/outbox"] as const;
const IDS = ["one", "two", "three", "four"] as const;
/** Names no append uses: an empty stream and a missing id. */
const ABSENT = { stream: "never", id: "missing" } as const;

/** One append: which stream and id it reuses, and a body from a small set, so resends happen. */
const Append = fc.record({ stream: fc.nat(), id: fc.nat(), body: fc.integer({ min: 0, max: 2 }) });
type Append = typeof Append extends fc.Arbitrary<infer A> ? A : never;
const Log = fc.array(Append, { minLength: 0, maxLength: 40, size: "max" });

/** What the turn answers through `get` and `head`, beside what `read(stream, 0)` holds. */
const view = (turn: LedgerTurn) =>
  [...STREAMS, ABSENT.stream].map((stream) => {
    const all = [...turn.read(stream, 0)];
    return {
      stream,
      head: turn.head(stream),
      last: all.at(-1)?.rev ?? 0,
      gets: [...IDS, ABSENT.id].map((id) => ({
        id,
        got: turn.get(stream, id),
        first: Option.fromUndefinedOr(all.find((entry) => entry.id === id)),
      })),
    };
  });

const agrees = (seen: ReturnType<typeof view>, moment: string) => {
  for (const { stream, head, last, gets } of seen) {
    expect(head, `${moment}: head(${stream}) is the last rev read(${stream}, 0) holds, or 0`).toBe(last);

    for (const { id, got, first } of gets) {
      expect(got, `${moment}: get(${stream}, ${id}) is read(${stream}, 0)'s entry under ${id}`).toEqual(first);
    }
  }
};

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

describe("T936 slice 1: the ledger turn's indexed reads", () => {
  it.effect(
    "L3: in any log over three streams with reused ids, get equals read's first entry under the id, and head equals read's last rev or 0",
    () =>
      Effect.gen(function* () {
        const outcomes = new Set<string>();
        const law = (log: ReadonlyArray<Append>) =>
          Effect.flatMap(memory, (db) => {
            const store = recorded(db);
            return Effect.gen(function* () {
              const tx = yield* LedgerTransaction;
              agrees(yield* tx.transact(view), "an empty log");

              for (const append of log) {
                const stream = choose(STREAMS, append.stream);
                const id = choose(IDS, append.id);
                // The turn that appends answers its own reads: they see the append before it commits.
                const inside = yield* Effect.exit(
                  tx.transact((turn) => {
                    turn.append(stream, id, line(append.body));
                    return view(turn);
                  }),
                );

                if (Exit.isSuccess(inside)) {
                  agrees(inside.value, `inside the turn that appended ${stream}/${id}`);
                  outcomes.add("appended");
                } else {
                  // A reused id with another body is refused, and the turn rolls back.
                  outcomes.add("refused");
                }

                agrees(yield* tx.transact(view), `after ${stream}/${id}`);
              }
            }).pipe(Effect.provide(store.layer));
          });
        yield* property(Log, law, { numRuns: 50 });
        // An empty walk cannot pass: appends landed, and reused ids were refused.
        expect([...outcomes].sort()).toEqual(["appended", "refused"]);
      }),
    120_000,
  );

  // SQLite 3.54.0 under Node 26.13.0 (the lockfile's Node), read once by the tests step for the
  // plan's two queries:
  //   SELECT * FROM entries WHERE stream = ? AND id = ?
  //     -> SEARCH entries USING INDEX sqlite_autoindex_entries_2 (stream=? AND id=?)
  //   SELECT coalesce(max(rev), 0) AS rev FROM entries WHERE stream = ?
  //     -> SEARCH entries USING COVERING INDEX entries_by_stream (stream=?)
  // and a query by `id = ?` alone -> SCAN entries. The law reads the plan of whatever queries the
  // store really sends, so it holds whichever index the build picks, as long as it leads with stream.
  it.effect(
    "L4 pinned: get's and head's queries search an index of entries that leads with stream, never SCAN entries (experiment 258's whole-stream scan)",
    () =>
      Effect.flatMap(memory, (db) => {
        const store = recorded(db);
        return Effect.gen(function* () {
          const tx = yield* LedgerTransaction;
          yield* tx.transact((turn) => {
            for (const [n, stream] of STREAMS.entries()) {
              for (const id of IDS) {
                turn.append(stream, id, line(n));
              }
            }
          });
          const sent = (read: (turn: LedgerTurn) => unknown) =>
            Effect.gen(function* () {
              const from = store.seen.length;
              yield* tx.transact((turn) => {
                store.state.capture = true;

                try {
                  return read(turn);
                } finally {
                  store.state.capture = false;
                }
              });
              return store.seen.slice(from);
            });
          const queries = {
            get: yield* sent((turn) => turn.get("b/inbox", "two")),
            head: yield* sent((turn) => turn.head("b/inbox")),
          };

          for (const [read, sentQueries] of Object.entries(queries)) {
            const entries = sentQueries.filter(({ query }) => /\bentries\b/.test(query));
            expect(entries.length, `${read} asks SQLite for entries`).toBeGreaterThan(0);

            for (const { query, params } of entries) {
              const details = db
                .prepare(`EXPLAIN QUERY PLAN ${query}`)
                .all(...params)
                .map((row) => String(row["detail"]));
              const named = details.filter((detail) => /\bentries\b/.test(detail));
              expect(named.length, `${read}: the plan of ${query} names entries`).toBeGreaterThan(0);

              for (const detail of named) {
                expect(detail, `${read}: ${query} never scans entries`).not.toMatch(/\bSCAN entries\b/);
                expect(detail, `${read}: ${query} searches an index that leads with stream`).toMatch(
                  /^SEARCH entries USING (?:COVERING )?INDEX \S+ \(stream=\?/,
                );
              }
            }
          }
        }).pipe(Effect.provide(store.layer));
      }),
  );
});
