import { Context, Effect, Layer } from "effect";
import { ledgerStore } from "./ledger-store.ts";
import { Doorbell, type LedgerError } from "./ledger.ts";
import type { Appended, Entry, Rev, Waited } from "./log.ts";

export { STREAM, tag } from "./ledger-store.ts";
export type SqlValue = string | number | null;

/** workerd's SQLite and node:sqlite supply the same synchronous operations. */
export interface Sql {
  readonly exec: (query: string, ...params: ReadonlyArray<SqlValue>) => ReadonlyArray<Record<string, SqlValue>>;
  readonly transaction: <A>(step: () => A) => A;
  readonly size: () => number;
}

export class Referee extends Context.Service<
  Referee,
  {
    readonly append: (stream: string, id: string, line: unknown) => Effect.Effect<Appended, LedgerError>;
    readonly read: (stream: string, after: Rev, reader: string) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>;
    readonly wait: (stream: string, after: Rev, reader: string) => Effect.Effect<Waited, LedgerError>;
  }
>()("@kampus/libfabrika/Referee") {
  static readonly layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
    Layer.effect(
      Referee,
      Effect.gen(function* () {
        return ledgerStore(sql, yield* Doorbell);
      }),
    );
}
