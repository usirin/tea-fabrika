// P15 slice 1, next/. The CodeStore's database laws, a suite that the module owning a real SQLite
// driver runs (0062): `CodeStoreTest.suite(database)`. Law L13 of the approved plan: each walk picks
// put, get, corrupt and reopen from what it has stored so far, and every answer is compared with the
// walk's own record of each hash's first bytes.
//
// Test contract (the plan's shapes): `CodeStore.ts` holds the contract only, `CodeStore` with `put`
// and `get` and `CodeStoreError` (tagged `Storage` or `BadRow`, 0119). `CodeStoreSql.layer(sql)` is its layer, one
// table `code (hash PRIMARY KEY, source TEXT)`. `get` decodes through `BuiltProgram`, so a row whose
// bytes no longer hash to its key fails `bad_row`; it never reads as absent or as the wrong bytes.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Option, Schema, Scope } from "effect";
import { expectTypeOf } from "vitest";
import type { Sql } from "../Sql.ts";
import { BuiltProgram, hash } from "./Built.ts";
import type { CodeStoreError } from "./CodeStore.ts";
import { CodeStore } from "./CodeStore.ts";
import * as CodeStoreSql from "./CodeStoreSql.ts";

const SEED = 119120;
const RUNS = 100;

/** A real SQLite database: each run of the inner Effect is a new connection to the same file,
 *  closed with its scope. Each run of the outer Effect is a new, empty database. */
export type Database = Effect.Effect<Effect.Effect<Sql, never, Scope.Scope>, never, Scope.Scope>;

// The service speaks runtime types and its own error, never a lower module's (0091).
type Service = CodeStore["Service"];
expectTypeOf<Effect.Error<ReturnType<Service["put"]>>>().toEqualTypeOf<CodeStoreError>();
expectTypeOf<Effect.Error<ReturnType<Service["get"]>>>().toEqualTypeOf<CodeStoreError>();
expectTypeOf<Effect.Success<ReturnType<Service["get"]>>>().toEqualTypeOf<Option.Option<BuiltProgram>>();
expectTypeOf<CodeStoreError["reason"]["_tag"]>().toEqualTypeOf<"Storage" | "BadRow">();
expectTypeOf<Effect.Services<ReturnType<Service["get"]>>>().toEqualTypeOf<never>();

const nth = <A>(items: ReadonlyArray<A>, i: number): A => {
  const item = items[i % items.length];

  if (item === undefined) {
    throw new Error("a walk chose from an empty list");
  }

  return item;
};

/** A bundle's text: quotes, a slash, a line break and a non-ASCII letter, so a lost byte shows. */
const source = Arbitrary.array(
  Arbitrary.schema(
    Schema.Literals(["export ", "default ", "{", "}", '"', "'", "\\", "\n", "雪", "🫖", "a", "1", "</script>"]),
  ),
  { minLength: 1, maxLength: 40 },
).pipe(Arbitrary.map((parts) => parts.join("")));

const pick = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })));
const Cell = Arbitrary.all({ move: pick, pick, text: source, junk: source });
const Tape = Arbitrary.array(Cell, { minLength: 1, maxLength: 40 });
type Cell = typeof Cell extends Arbitrary.Arbitrary<infer A> ? A : never;

/** A checked bundle: its bytes and their own hash, decoded through the shape `put` takes. */
const built = (text: string) =>
  hash(text).pipe(
    Effect.flatMap((digest) => Schema.decodeUnknownEffect(BuiltProgram)({ hash: digest, source: text })),
    Effect.orDie,
  );

/** The reason a failed read gave, or none when it read. */
const failure = <A>(exit: Exit.Exit<A, CodeStoreError>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit))?.reason._tag : undefined;

/** Every move the walks reached, across runs. */
const seen = new Set<string>();

/** One walk: put, get, corrupt and reopen, each picked from what the walk has stored so far. */
const walk = (database: Database, tape: ReadonlyArray<Cell>) =>
  Effect.gen(function* () {
    const open = yield* database;
    const parent = yield* Scope.Scope;
    let scope = yield* Scope.fork(parent);
    let sql = yield* open.pipe(Scope.provide(scope));
    const store = () => CodeStore.pipe(Effect.provide(CodeStoreSql.layer(sql)));
    let codes = yield* store();
    /** The walk's own record: each hash's first bytes, and the rows it broke. */
    const kept = new Map<string, string>();
    const broken = new Set<string>();
    const text = (digest: string) => kept.get(digest) ?? "";

    for (const cell of tape) {
      const hashes = [...kept.keys()];
      const options = [
        "put_new",
        "get_unknown",
        ...(hashes.length > 0 ? ["put_again", "get", "get", "corrupt", "reopen"] : []),
      ];
      const move = nth(options, cell.move);
      seen.add(move);

      switch (move) {
        case "put_new": {
          const code = yield* built(cell.text);
          yield* codes.put(code);

          if (!kept.has(code.hash)) {
            kept.set(code.hash, code.source);
          }

          break;
        }
        case "put_again": {
          // The same hash again: the first row stays as it is, broken or not.
          const digest = nth(hashes, cell.pick);
          yield* codes.put({ hash: digest, source: text(digest) });
          break;
        }
        case "get_unknown": {
          const code = yield* built(`${cell.junk}\0unstored`);
          const got = yield* codes.get(code.hash);
          expect(got).toEqual(kept.has(code.hash) ? Option.some(code) : Option.none());
          break;
        }
        case "get": {
          const digest = nth(hashes, cell.pick);
          const got = yield* Effect.exit(codes.get(digest));
          // A row whose bytes do not hash to its key fails as bad_row, never as absent or other bytes.
          expect(failure(got)).toBe(broken.has(digest) ? "BadRow" : undefined);
          expect(Exit.isSuccess(got) ? got.value : null).toEqual(
            broken.has(digest) ? null : Option.some({ hash: digest, source: text(digest) }),
          );
          seen.add(broken.has(digest) ? "bad_row" : "same_bytes");
          break;
        }
        case "corrupt": {
          // The disk changes under the store: the row keeps its key, not its bytes.
          const digest = nth(hashes, cell.pick);

          if (cell.junk !== text(digest)) {
            sql.exec("UPDATE code SET source=? WHERE hash=?", cell.junk, digest);
            broken.add(digest);
          }

          break;
        }
        case "reopen": {
          yield* Scope.close(scope, Exit.void);
          scope = yield* Scope.fork(parent);
          sql = yield* open.pipe(Scope.provide(scope));
          codes = yield* store();
          seen.add("reopened");
          break;
        }
      }
    }

    // Every kept row reads back after a last reopen, with its first bytes.
    yield* Scope.close(scope, Exit.void);
    sql = yield* open;
    codes = yield* store();

    for (const [digest, first] of kept) {
      const got = yield* Effect.exit(codes.get(digest));
      expect(failure(got)).toBe(broken.has(digest) ? "BadRow" : undefined);
      expect(Exit.isSuccess(got) ? got.value : null).toEqual(
        broken.has(digest) ? null : Option.some({ hash: digest, source: first }),
      );
    }
  });

export const suite = (database: Database) =>
  describe("P15 slice 1: the CodeStore on a real database", () => {
    it.live.prop(
      "L13: a put then get answers the same bytes; a second put is a no-op; a row that no longer hashes to its key is bad_row; rows survive a reopen",
      [Tape],
      ([tape]) => Effect.scoped(walk(database, tape)),
      { timeout: 120_000, arbitrary: { seed: SEED, runs: RUNS } },
    );

    it("scenario: L13's walks reached every move, so no move went untested", () => {
      for (const move of ["put_new", "put_again", "get_unknown", "bad_row", "same_bytes", "reopened"]) {
        expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
      }
    });
  });
