// The ledger as a service: append, read and wait, the same three calls for every caller (D6). This
// file is the contract only (0095). In the project object it is the referee on that object's
// SQLite (`LedgerSql.layer`); in any other object it is the project's stub (`LedgerRemote.layer`).
// Tier 1, P6 (laws p18 to p20, p94 and p95).
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";
import type { Rev } from "../Rev.ts";
import type { Appended, Entry, Line, Waited } from "./Log.ts";

export class LedgerError extends Schema.TaggedError<LedgerError>()("LedgerError", {
  /** `unreachable`: a call that never reached the referee. `bad_row`: an answer or a row that does
   *  not decode. `storage`: SQLite threw, for example `SQLITE_FULL`. `refused`: the ledger refused
   *  a line the caller needed written.
   *  `crypto`: WebCrypto threw or rejected. */
  reason: Schema.Literals(["unreachable", "bad_row", "storage", "refused", "crypto"]),
  /** What the thrown error said. It rides in the span's failure, never in a tag. */
  message: Schema.optional(Schema.String),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Rings a waiter, at most once. P12's thin class gives the real one: a call to the gateway. */
export class Doorbell extends Context.Service<
  Doorbell,
  { readonly ring: (to: string, stream: string, rev: Rev) => Effect.Effect<void, LedgerError> }
>()("@kampus/libfabrika/ledger/Ledger.Doorbell") {}

/** What the project object answers across an object call. Its answers are decoded by the caller. */
export type LedgerCalls = {
  append(stream: string, id: string, line: unknown): Promise<unknown>;
  read(stream: string, after: number, reader: string): Promise<unknown>;
  wait(stream: string, after: number, reader: string): Promise<unknown>;
};

export class Ledger extends Context.Service<
  Ledger,
  {
    readonly append: (stream: string, id: string, line: Line) => Effect.Effect<Appended, LedgerError>;
    /** The stream's entries past `after`, oldest first, read in pages as the Stream runs. */
    readonly read: (stream: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
    /** Never blocks: `ready` with the stream's newest rev, or `parked` until a ring. */
    readonly wait: (stream: string, after: Rev) => Effect.Effect<Waited, LedgerError>;
  }
>()("@kampus/libfabrika/ledger/Ledger") {}
