// T936 slice 2, next/: L5 and L6 on real databases (0062), and no driver. The module that owns a driver
// calls `RecoveryStoreReadsTest.suite(open)`; `open` acquires one empty database in a scope and gives
// it back when that scope closes.
//
// L5 counts the rows `Sql.exec` returns during one save, through a wrapper this file owns, never wall
// time. L6 runs one tape on two databases: on the first through one long-lived store, on the twin
// through a fresh store for every call. After each cell both hold the same rows, and a fresh store
// on each answers the same, so the long-lived store never answers or writes from text that was not
// committed.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { Receipt } from "./internal/recovery.ts";
import { recoveryStore } from "./RecoveryStore.ts";

const SEED = 119120;
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

/** Runs one law's property on fresh databases from the shared seed. */
const property = <A>(
  arbitrary: fc.Arbitrary<A>,
  runs: number,
  law: (value: A) => Effect.Effect<void, never, Scope.Scope>,
) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
    const checked = fc.asyncProperty(arbitrary, (value) => Effect.runPromise(Effect.scoped(law(value))));
    const options = { seed: SEED, numRuns: runs, includeErrorInReport: true };
    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
    yield* Effect.tryPromise({ try: () => fc.assert(checked, options), catch: (cause) => cause });
  });

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

const MOVES = ["save", "big", "cut", "retry", "other", "load", "receipt", "input"] as const;
type Move = (typeof MOVES)[number];

export const suite = (open: Effect.Effect<Sql, never, Scope.Scope>) =>
  describe("T936 slice 2: the recovery save reads only what changed", () => {
    it.effect(
      "L5: after a load every save returns one row from SQL, however many receipts are kept; a save with no load before it returns 1 + n rows once, then 1",
      () =>
        property(Growth, 50, ({ kept, tape }) =>
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
              const world = new Map(Array.from({ length: history }, (_, i) => [`l-${i}`, 0] as const));
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
              const committed = (save: Sent) => {
                world.n = save.n;

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
              const possible = (): ReadonlyArray<Move> => MOVES.filter((move) => move !== "retry" || failed !== null);

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
                    // A second store on the same database; its journal text is one no other save writes.
                    const save = value(cell, 1000 + ++others);
                    expect(
                      yield* both(save.saved, fresh(a).save(save.saved)),
                      "L6: the second store's save commits",
                    ).toBe(true);
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
          yield* property(Tape, 100, law);
          // An empty walk cannot pass: every move ran, and a cut landed inside a transaction.
          expect([...done].sort()).toEqual([...MOVES, "cut_hit"].sort());
        }),
      600_000,
    );
  });
