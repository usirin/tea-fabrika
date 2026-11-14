// T936 slice 2, next/: L5 and L6 on real databases (0062), and no driver. The module that owns a driver
// calls `RecoveryStoreReadsTest.suite(open)`; `open` acquires one empty database in a scope and gives
// it back when that scope closes.
//
// L5 counts the rows `Sql.exec` returns during one save, through a wrapper this file owns, never wall
// time. L6 runs one tape on two databases: on the first through one long-lived store, on the twin
// through a fresh store for every call. After each cell both hold the same rows, and a fresh store
// on each answers the same, so the long-lived store never answers or writes from text that was not
// committed. L7 records every row write `Sql.exec` is sent during a save that changes nothing, and
// there must be none.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { property } from "../Testing.test-support.ts";
import { Receipt } from "./internal/recovery.ts";
import { recoveryStore } from "./RecoveryStore.ts";

const NAME = "writer:1";
const PROCESS = "process_0000000000e008000000000001";
/** Far above what a tape writes, so only a save that adds the huge receipt passes it. */
const CAPACITY = 1024 ** 2;
/** The largest number of receipts L5 keeps before its tape. */
const TOP = 1000;

/** A journal as the runner saves it: its own fields beside every receipt it holds. */
const Journal = Schema.Struct({ name: Schema.String, n: Schema.Int, receipts: Schema.Array(Receipt) });
type Journal = typeof Journal.Type;

const receipt = (letter: string, value: number, pad = ""): Receipt => ({
  letter,
  input: { type: "save", value, pad },
  errors: [],
  tries: 1,
  result: null,
  process: PROCESS,
});

const journal = (n: number, receipts: ReadonlyMap<string, number>): Journal => ({
  name: NAME,
  n,
  receipts: [...receipts].map(([letter, value]) => receipt(letter, value)),
});

/** A save the walk sends: the journal, and the value of each receipt it carries. */
type Sent = { readonly saved: Journal; readonly n: number; readonly values: ReadonlyMap<string, number> };

const sent = (n: number, values: ReadonlyMap<string, number>): Sent => ({ saved: journal(n, values), n, values });

const store = (sql: Sql) => recoveryStore(sql, { name: NAME, capacity: CAPACITY, schema: Journal });

/** The store's Sql, counting every row `exec` returns. */
const counted = (sql: Sql) => {
  const count = { rows: 0 };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      const rows = sql.exec(query, ...params);
      count.rows += rows.length;
      return rows;
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, count };
};

/** The store's Sql, recording every statement it is sent that writes a row. */
const writing = (sql: Sql) => {
  const writes: Array<string> = [];
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query)) {
        writes.push(query);
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, writes };
};

/** The store's Sql, with a cut that throws on the `after`-th INSERT once armed. */
const cutting = (sql: Sql) => {
  const fault: { after: number | null; hit: boolean } = { after: null, hit: false };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (/^\s*INSERT\b/i.test(query) && fault.after !== null) {
        if (fault.after === 0) {
          fault.after = null;
          fault.hit = true;
          throw new Error("SQLITE_FULL planted at a write inside the save's transaction");
        }

        fault.after--;
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, fault };
};

/** Every recovery row, in one order, so two databases compare byte for byte. */
const rows = (sql: Sql) => ({
  recovery: sql.exec("SELECT name, value FROM process_recovery ORDER BY name"),
  receipts: sql.exec("SELECT name, letter, value FROM process_receipts ORDER BY name, letter"),
});

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** One L5 save: how many new receipts it adds, and whether it changes one kept receipt. */
const Grow = fc.record({
  adds: fc.integer({ min: 0, max: 3 }),
  change: fc.boolean(),
  pick: fc.nat(),
  value: fc.integer({ min: 0, max: 9 }),
});

const Growth = fc.record({
  kept: fc.integer({ min: 0, max: TOP }),
  tape: fc.array(Grow, { minLength: 10, maxLength: 60, size: "max" }),
});

/** One L6 cell. Each number is read against the state the walk has reached. */
const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  keep: fc.boolean(),
  n: fc.integer({ min: 0, max: 2 }),
  value: fc.integer({ min: 0, max: 9 }),
  adds: fc.integer({ min: 0, max: 2 }),
  change: fc.boolean(),
  drop: fc.nat(),
  k: fc.integer({ min: 0, max: 2 }),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
const Tape = fc.array(Cell, { minLength: 5, maxLength: 40, size: "max" });

/** One L7 case: a journal, and who sends it again unchanged. */
const Same = fc.record({
  n: fc.integer({ min: 0, max: 2 }),
  values: fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 30 }),
  again: fc.constantFrom("same store", "same store after a load", "fresh store"),
});

const MOVES = ["save", "big", "cut", "retry", "other", "again", "load", "receipt", "input"] as const;
type Move = (typeof MOVES)[number];

export const suite = (open: Effect.Effect<Sql, never, Scope.Scope>) =>
  describe("T936 slice 2: the recovery save reads only what changed", () => {
    it.effect(
      "L5: after a load every save returns one row from SQL, however many receipts are kept; a save with no load before it returns 1 + n rows once, then 1",
      () =>
        property(
          Growth,
          ({ kept, tape }) =>
            Effect.gen(function* () {
              const seen: Array<string> = [];
              let wrong = false;

              // The generated history, and the domain's end, so a failure prints the count at TOP; each
              // through a store that loaded first and one that did not.
              const runs = [...new Set([kept, TOP])]
                .sort((a, b) => a - b)
                .flatMap((history) => [true, false].map((loaded) => ({ history, loaded })));

              for (const { history, loaded } of runs) {
                const sql = yield* open;
                const world = new Map<string, number>(
                  Array.from({ length: history }, (_, i): [string, number] => [`l-${i}`, 0]),
                );
                yield* store(sql).save(journal(0, world)).pipe(Effect.orDie);
                const { sql: watched, count } = counted(sql);
                const saver = store(watched);

                if (loaded) {
                  yield* saver.load.pipe(Effect.orDie);
                }

                let made = world.size;
                let last = { n: 0, rows: 0, expected: 0 };

                for (const [i, grow] of tape.entries()) {
                  if (grow.change && world.size > 0) {
                    world.set(choose([...world.keys()], grow.pick), grow.value);
                  }

                  for (let a = 0; a < grow.adds; a++) {
                    world.set(`l-${made++}`, grow.value);
                  }

                  const n = sql.exec("SELECT letter FROM process_receipts WHERE name=?", NAME).length;
                  const before = count.rows;
                  yield* saver.save(journal(0, world)).pipe(Effect.orDie);
                  const got = count.rows - before;
                  // The journal row is read on every save; the receipt rows once, by a store that never loaded.
                  const expected = i === 0 && !loaded ? 1 + n : 1;
                  last = { n, rows: got, expected };

                  if (i === 0) {
                    seen.push(`${loaded ? "loaded" : "cold"}, first save at n=${n}: ${got} rows (law: ${expected})`);
                  }

                  wrong ||= got !== expected;
                }

                seen.push(`last save at n=${last.n}: ${last.rows} rows (law: ${last.expected})`);
              }

              expect(wrong, `L5: rows SQL returned during a save, by receipts kept: ${seen.join("; ")}`).toBe(false);
            }),
          { numRuns: 50 },
        ),
      600_000,
    );

    it.effect(
      "L6: one long-lived store leaves the same rows and answers as a fresh store per call, across failed saves and a second store's writes",
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = (tape: ReadonlyArray<Cell>) =>
            Effect.gen(function* () {
              const a = yield* open;
              const twin = yield* open;
              const { sql: cut, fault } = cutting(a);
              const kept = store(cut);
              const world = { n: 0, receipts: new Map<string, number>() };
              let failed: Sent | null = null;
              /** The long-lived store's last committed save, which its owner may send again. */
              const mine: { last: Sent | null } = { last: null };
              let made = 0;
              let others = 0;

              /** The value a save sends: the world with one receipt changed, some added, some left out. */
              const value = (cell: Cell, n: number): Sent => {
                const receipts = new Map(world.receipts);

                if (cell.change && receipts.size > 0) {
                  receipts.set(choose([...receipts.keys()], cell.pick), cell.value);
                }

                for (let i = 0; i < cell.adds; i++) {
                  receipts.set(`l-${made++}`, cell.value);
                }

                // A left-out receipt stays stored, as the runner's old snapshots rely on.
                return sent(n, new Map([...receipts].filter((_, i) => ((cell.drop >> (i % 30)) & 1) === 0)));
              };
              const committed = (save: Sent, by: "kept" | "other" = "kept") => {
                world.n = save.n;

                if (by === "kept") {
                  mine.last = save;
                }

                for (const [letter, v] of save.values) {
                  world.receipts.set(letter, v);
                }
              };
              /** The twin's answer: a fresh store on the twin for this one call. */
              const fresh = (sql: Sql) => store(sql);
              const both = Effect.fnUntraced(function* (saved: Journal, onA: Effect.Effect<void, unknown>) {
                const left = yield* Effect.exit(onA);
                const right = yield* Effect.exit(fresh(twin).save(saved));
                expect(
                  Exit.isSuccess(left),
                  "L6: the long-lived store and the twin's fresh store agree on a save",
                ).toBe(Exit.isSuccess(right));
                return Exit.isSuccess(left);
              });
              const possible = (): ReadonlyArray<Move> =>
                MOVES.filter((move) =>
                  move === "retry" ? failed !== null : move === "again" ? mine.last !== null : true,
                );

              for (const cell of tape) {
                const move = choose(possible(), cell.move);
                const n = cell.keep ? world.n : cell.n;

                switch (move) {
                  case "save": {
                    const save = value(cell, n);
                    expect(yield* both(save.saved, kept.save(save.saved)), "L6: a plain save commits").toBe(true);
                    committed(save);
                    break;
                  }
                  case "big": {
                    const save = value(cell, n);
                    const saved = {
                      ...save.saved,
                      receipts: [...save.saved.receipts, receipt("huge", 0, "x".repeat(CAPACITY))],
                    };
                    expect(yield* both(saved, kept.save(saved)), "L6: a save past capacity is refused").toBe(false);
                    // Its retry sends the same journal without the receipt that did not fit.
                    failed = save;
                    break;
                  }
                  case "cut": {
                    const save = value(cell, n);
                    fault.after = cell.k;
                    fault.hit = false;
                    const exit = yield* Effect.exit(kept.save(save.saved));
                    fault.after = null;

                    if (fault.hit) {
                      // The cut rolled the transaction back, so the twin is not sent this save.
                      expect(Exit.isFailure(exit), "L6: a save cut at a write fails").toBe(true);
                      failed = save;
                      done.add("cut_hit");
                    } else {
                      expect(Exit.isSuccess(exit), "L6: a save the cut did not reach commits").toBe(true);
                      expect(Exit.isSuccess(yield* Effect.exit(fresh(twin).save(save.saved)))).toBe(true);
                      committed(save);
                    }

                    break;
                  }
                  case "retry": {
                    // The runner sends its model again: the failed save's own text.
                    if (failed === null) {
                      return yield* Effect.die(new Error("a retry ran with no failed save"));
                    }

                    const save = failed;
                    expect(yield* both(save.saved, kept.save(save.saved)), "L6: a retried save commits").toBe(true);
                    committed(save);
                    failed = null;
                    break;
                  }
                  case "other": {
                    // A second store on the same database. Either it keeps the journal row's text and
                    // changes a receipt the long-lived store last wrote, so only receipts move, or it
                    // writes a journal text no other save writes.
                    const base = value(cell, cell.keep ? world.n : 1000 + ++others);
                    const own = cell.keep && mine.last !== null ? [...mine.last.values] : [];
                    let save = base;

                    if (own.length > 0) {
                      const [letter, v] = choose(own, cell.pick);
                      save = sent(base.n, new Map([...base.values, [letter, (v + 1 + (cell.value % 9)) % 10]]));
                    }

                    expect(
                      yield* both(save.saved, fresh(a).save(save.saved)),
                      "L6: the second store's save commits",
                    ).toBe(true);

                    if (save.n === world.n) {
                      done.add("other_receipts_only");
                    }

                    committed(save, "other");
                    break;
                  }
                  case "again": {
                    // The owner sends its own last save again, blind to what a second store wrote since.
                    if (mine.last === null) {
                      return yield* Effect.die(new Error("an again ran with no save of its own"));
                    }

                    const save = mine.last;

                    // The journal row is the one this store last wrote, but a receipt under it is not.
                    if (
                      save.n === world.n &&
                      [...save.values].some(([letter, v]) => world.receipts.get(letter) !== v)
                    ) {
                      done.add("again_over_other");
                    }

                    expect(yield* both(save.saved, kept.save(save.saved)), "L6: a save sent again commits").toBe(true);
                    committed(save);
                    break;
                  }
                  case "load": {
                    const got = yield* kept.load.pipe(Effect.orDie);
                    expect(got, "L6: the long-lived store loads what a fresh store loads").toEqual(
                      yield* fresh(twin).load.pipe(Effect.orDie),
                    );
                    break;
                  }
                  case "receipt":
                  case "input": {
                    const letter = choose([...world.receipts.keys(), "l-missing"], cell.pick);
                    const read = (s: ReturnType<typeof store>) =>
                      move === "receipt" ? s.receipt(letter) : s.input(letter);
                    const got = yield* read(kept).pipe(Effect.orDie);
                    expect(got, `L6: the long-lived store's ${move} of ${letter} is the fresh stores'`).toEqual(
                      yield* read(fresh(twin)).pipe(Effect.orDie),
                    );
                    expect(got).toEqual(yield* read(fresh(a)).pipe(Effect.orDie));
                    break;
                  }
                }

                done.add(move);
                const loads = {
                  a: yield* fresh(a).load.pipe(Effect.orDie),
                  twin: yield* fresh(twin).load.pipe(Effect.orDie),
                };
                expect(loads.a, `L6: after ${move}, a fresh store loads the same journal from both databases`).toEqual(
                  loads.twin,
                );
                expect(rows(a), `L6: after ${move}, both databases hold the same recovery rows`).toEqual(rows(twin));
              }
            });
          yield* property(Tape, law, { numRuns: 100 });
          // An empty walk cannot pass: every move ran, a cut landed inside a transaction, a second store
          // changed only receipts under a journal row it left as it was, and the long-lived store then
          // sent its own last save over that change.
          expect([...done].sort()).toEqual([...MOVES, "cut_hit", "other_receipts_only", "again_over_other"].sort());
        }),
      600_000,
    );

    it.effect(
      "L7: a save that changes no row writes no row, through the same store, after a load, or a fresh one",
      () =>
        property(
          Same,
          ({ n, values, again }) =>
            Effect.gen(function* () {
              const sql = yield* open;
              const { sql: watched, writes } = writing(sql);
              const saved = journal(n, new Map(values.map((value, i): [string, number] => [`l-${i}`, value])));
              const first = store(watched);
              yield* first.save(saved).pipe(Effect.orDie);
              const before = rows(sql);
              const sender = again === "fresh store" ? store(watched) : first;

              if (again === "same store after a load") {
                yield* sender.load.pipe(Effect.orDie);
              }

              const from = writes.length;
              yield* sender.save(saved).pipe(Effect.orDie);
              expect(writes.slice(from), `L7: rows written by a save sent again unchanged, ${again}`).toEqual([]);
              expect(rows(sql), "L7: the rows are as the first save left them").toEqual(before);
            }),
          { numRuns: 100 },
        ),
    );
  });
