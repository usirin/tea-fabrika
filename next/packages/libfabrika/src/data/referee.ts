import { Context, Effect, Layer } from "effect";
import type { Rev } from "../Rev.ts";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./ledger-store.ts";
import { Doorbell, type LedgerError } from "./ledger.ts";
import type { Appended, Entry, Waited } from "./log.ts";

export { STREAM, tag } from "./ledger-store.ts";

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
