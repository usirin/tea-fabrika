import { Context } from "effect";
import type { Effect } from "effect";
import type { Rev } from "../Rev.ts";
import type { LedgerError } from "./Ledger.ts";
import type { Appended, Entry, Waited } from "./Log.ts";

export class Referee extends Context.Service<
  Referee,
  {
    readonly append: (stream: string, id: string, line: unknown) => Effect.Effect<Appended, LedgerError>;
    readonly read: (stream: string, after: Rev, reader: string) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>;
    readonly wait: (stream: string, after: Rev, reader: string) => Effect.Effect<Waited, LedgerError>;
  }
>()("@kampus/libfabrika/Referee") {}
