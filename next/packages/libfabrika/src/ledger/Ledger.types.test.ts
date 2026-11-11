// Ticket 702, next/ (0095, slice 1): `Ledger.ts` holds the contract, with its service type written
// out, and each layer is a sibling file read through its module. tsc checks the uncalled cases.
import { DatabaseSync } from "node:sqlite";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Context, Effect, Layer, Schema, type Stream } from "effect";
import type { Rev } from "../Rev.ts";
import type { Sql } from "../Sql.ts";
import type * as LedgerFront from "./Ledger.ts";
import { Doorbell, Ledger, type LedgerCalls, type LedgerError } from "./Ledger.ts";
import * as LedgerRemote from "./LedgerRemote.ts";
import * as LedgerSql from "./LedgerSql.ts";
import type { Appended, Entry, Line, Waited } from "./Log.ts";
import { nodeSql } from "./NodeSqlite.ts";

const checkTypes = () => {
  // The three calls, as the contract writes them. A wrong error or result type fails here.
  expectTypeOf<Context.Service.Shape<typeof Ledger>>().toEqualTypeOf<{
    readonly append: (stream: string, id: string, line: Line) => Effect.Effect<Appended, LedgerError>;
    readonly read: (stream: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
    readonly wait: (stream: string, after: Rev) => Effect.Effect<Waited, LedgerError>;
  }>();
  // Each layer: what it takes, what it serves, and what it still needs.
  expectTypeOf(LedgerSql.layer).parameters.toEqualTypeOf<[Sql, { readonly reader: string }]>();
  expectTypeOf(LedgerSql.layer).returns.toEqualTypeOf<Layer.Layer<Ledger, never, Doorbell>>();
  expectTypeOf(LedgerRemote.layer).parameters.toEqualTypeOf<[LedgerCalls, { readonly reader: string }]>();
  expectTypeOf(LedgerRemote.layer).returns.toEqualTypeOf<Layer.Layer<Ledger>>();
  // No static layer is left on the class, and the contract module exports no layer.
  expectTypeOf<"sql" extends keyof typeof Ledger ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"remote" extends keyof typeof Ledger ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof LedgerFront ? true : false>().toEqualTypeOf<false>();
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** A stub that is never called: building the remote layer makes no call. */
const unused = (): never => {
  throw new Error("the remote layer called its stub while it was built");
};

const stub: LedgerCalls = { append: unused, read: unused, wait: unused };

const memory = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

it.effect.prop(
  "each sibling layer serves the Ledger contract for any reader, and the class has no static layer",
  { reader: Schema.String },
  ({ reader }) =>
    Effect.scoped(
      Effect.gen(function* () {
        expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
        expect(Object.hasOwn(Ledger, "sql")).toBe(false);
        expect(Object.hasOwn(Ledger, "remote")).toBe(false);
        const sql = nodeSql(yield* memory);
        const layers = [
          LedgerSql.layer(sql, { reader }).pipe(Layer.provide(quiet)),
          LedgerRemote.layer(stub, { reader }),
        ];

        for (const layer of layers) {
          const ledger = yield* Ledger.pipe(Effect.provide(layer));
          expect([typeof ledger.append, typeof ledger.read, typeof ledger.wait]).toEqual([
            "function",
            "function",
            "function",
          ]);
        }
      }),
    ),
  { arbitrary: { seed: 119120, runs: 20 } },
);
