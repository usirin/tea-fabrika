/**
 * The ledger as a service: `append`, `read` and `wait`, the same three calls for every caller. This
 * file is the contract only (0095). In the project object the service is the referee on that
 * object's SQLite (`LedgerSql.layer`); in any other object it is the project's stub
 * (`LedgerRemote.layer`).
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";
import type { Rev } from "../Rev.ts";
import type { Appended, Entry, Line, Waited } from "./Log.ts";

/**
 * Error for a ledger call that got no usable answer: the call never reached the referee, a row or an
 * answer did not decode, storage threw, or a line the caller could not go on without was refused.
 *
 * **Details**
 *
 * A refused line is not an error by itself: `append` answers `refused` as data, with its reason.
 * `reason: "refused"` is for a caller that needed the write, such as a step inside a ledger
 * transaction, where failing is what rolls the turn back.
 *
 * @stability unstable
 * @category errors
 */
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

/**
 * Service that rings a waiter, at most once, when an append lands past the rev it parked at.
 *
 * **Details**
 *
 * The referee calls `ring(to, stream, rev)` for each ring an append takes out, where `to` is the
 * reader that parked and `rev` is the new entry's. A ring that fails is gone all the same, kept
 * only in its span, and it never changes the append. In the project object a ring is a call to the
 * gateway connection named `to`.
 *
 * @stability unstable
 * @category services
 */
export class Doorbell extends Context.Service<
  Doorbell,
  { readonly ring: (to: string, stream: string, rev: Rev) => Effect.Effect<void, LedgerError> }
>()("@kampus/libfabrika/ledger/Ledger.Doorbell") {}

/**
 * The ledger's three calls as the project object answers them across an object call: plain
 * arguments in, a Promise of an unchecked answer out.
 *
 * **Details**
 *
 * `LedgerRemote.layer` takes one and decodes every answer, so a caller never reads an answer that
 * was not checked. The project object's binding type includes these calls.
 *
 * @stability unstable
 * @category models
 */
export type LedgerCalls = {
  append(stream: string, id: string, line: unknown): Promise<unknown>;
  read(stream: string, after: number, reader: string): Promise<unknown>;
  wait(stream: string, after: number, reader: string): Promise<unknown>;
};

/**
 * Service for the record: one append-only log per project, with named streams inside it.
 *
 * **Details**
 *
 * Every caller gets the same three calls, whether its layer is the referee in the same object or a
 * stub to the project object. A call fails only when the ledger could not answer; a line the
 * referee will not write comes back as `refused`, as data.
 *
 * @stability unstable
 * @category services
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    /**
     * Writes one line to `stream` under `id`. The same id with the same content gets its first
     * placing again and writes nothing, so a resend is safe.
     */
    readonly append: (stream: string, id: string, line: Line) => Effect.Effect<Appended, LedgerError>;
    /** The stream's entries past `after`, oldest first, read in pages as the Stream runs. */
    readonly read: (stream: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
    /** Never blocks: `ready` with the stream's newest rev, or `parked` until a ring. */
    readonly wait: (stream: string, after: Rev) => Effect.Effect<Waited, LedgerError>;
  }
>()("@kampus/libfabrika/ledger/Ledger") {}
