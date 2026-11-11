// The Referee on any `Sql`: the project object's SQLite, and node:sqlite in tests (0095).
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { Referee } from "./Referee.ts";

export const layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
  Layer.effect(
    Referee,
    Effect.gen(function* () {
      return ledgerStore(sql, yield* Doorbell);
    }),
  );
