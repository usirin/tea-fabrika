/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
import { Context, type Effect, Schema } from "effect";

/** The class of a failure, from a fixed list of words. Never a message, a stack or a value. */
export const ErrorClass = Schema.Literals([
  "AbortError",
  "DataError",
  "InvalidAccessError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "TypeError",
  "UnknownError",
  "other",
]);
export type ErrorClass = typeof ErrorClass.Type;

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * One checked observation. Ids, counts, durations and fixed words only: no program body, no key
 * material, no message text. Client clocks and durations are measurements, never authority.
 */
export const ClientRecord = Schema.TaggedUnion({
  key: { result: Schema.Literals(["created", "reused", "replaced"]) },
  connect: {
    dial: Count,
    result: Schema.Literals(["online", "waiting", "closed", "stalled", "removed"]),
    ms: Ms,
  },
  press: {
    command: Schema.String,
    via: Schema.Literals(["button", "key"]),
    pid: Schema.String,
    viewRev: Count,
    seen: Count,
    letter: Schema.String,
    depth: Count,
  },
  reply: {
    letter: Schema.String,
    result: Schema.Literals(["accepted", "refused", "unreachable", "unknown"]),
    attempts: Count,
    ms: Ms,
    reason: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/))),
  },
  /** A view's start and end (plan A8): a `whole` view installed, an `asked` for one, and one `patch`
   *  row for a run of installed patches when it ends, never one per patch. */
  view: {
    pid: Schema.String,
    result: Schema.Literals(["whole", "patch", "asked"]),
    rev: Count,
    /** On a `patch` row only: how many patches the run installed. */
    patches: Schema.optionalKey(Count),
  },
  persist: { result: Schema.Literals(["granted", "refused", "failed"]) },
  failure: {
    op: Schema.Literals(["key", "connect", "request", "view", "persist", "record"]),
    error: ErrorClass,
  },
});
export type ClientRecord = typeof ClientRecord.Type;

/** A record as a client keeps and sends it: a stable row id, the tab, the build and its own time. */
export const ClientRow = Schema.Struct({
  id: Schema.String,
  tab: Schema.String,
  build: Schema.String,
  sentAt: Schema.String,
  record: ClientRecord,
});
export type ClientRow = typeof ClientRow.Type;

export class ClientRowsError extends Schema.TaggedError<ClientRowsError>()("ClientRowsError", {
  op: Schema.Literals(["open", "write"]),
  error: ErrorClass,
}) {}

export class ClientRows extends Context.Service<
  ClientRows,
  {
    readonly put: (row: ClientRow) => Effect.Effect<void, ClientRowsError>;
  }
>()("@kampus/libfabrika/transport/ClientRows") {}
