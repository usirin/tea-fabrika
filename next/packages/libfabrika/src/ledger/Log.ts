/**
 * The log's shapes: what a writer hands in, what the referee keeps, and what it answers.
 *
 * This is the one file the `no-hand-tag` lint rule lets write `_tag`. The log stores any event and
 * knows no cases, so a line's `_tag` is an open string: the case as the writer's own schema wrote
 * it. `lineFor` and `valueFor` turn a schema's value into a line and an entry back, so no other
 * file writes the key.
 *
 * @stability unstable
 */
import { DateTime, Effect, Schema } from "effect";
import { ParentText, Rev } from "../Rev.ts";

export { InputId } from "../Id.ts";

/**
 * Schema for a W3C trace id: 32 lowercase hex characters, never all zeros.
 *
 * @stability unstable
 * @category schemas
 */
export const TraceId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/),
  Schema.makeFilter((traceId) => traceId !== "0".repeat(32), { expected: "a nonzero W3C trace id" }),
);

const Text = Schema.NonEmptyString;

/**
 * Schema for a line: what a writer hands to `append`. Every key is required, so a writer can
 * leave none out, and the referee refuses a line with a key it does not know.
 *
 * @stability unstable
 * @category schemas
 */
export const Line = Schema.Struct({
  /** Who wrote it, stamped by the door from the checked key. */
  by: Text,
  /** The person the writer works for, from its grant. */
  for: Text,
  /** The writer's own clock, as it sent it. Shown, never decides. */
  sentAt: Schema.String,
  /** The last rev the writer had folded. An append whose `seen` is past the log's head is refused. */
  seen: Rev,
  /** The input that made this write, or null for an own write. */
  parent: Schema.NullOr(ParentText),
  /** The request this write belongs to. Shown and checked for delivery, never decides. */
  traceId: TraceId,
  /** The build of the code that wrote it. */
  build: Text,
  /** The event's case. */
  _tag: Text,
  /** The event's fields, kept as JSON. */
  body: Schema.Json,
});
/**
 * A line: one write as its writer hands it in, before the referee gives it a place.
 *
 * @stability unstable
 * @category models
 */
export type Line = typeof Line.Type;

/**
 * Completes a line's sender fields from where the caller stands: `sentAt` from the clock now, and
 * `traceId` from the current span.
 *
 * **Details**
 *
 * It opens no span of its own, so the write joins the caller's trace and never starts a new one.
 *
 * **Gotchas**
 *
 * It fails with `NoSuchElementError` when no span is open.
 *
 * @stability unstable
 * @category constructors
 */
export const fromHere = Effect.fn(function* (from: Omit<Line, "_tag" | "body" | "sentAt" | "traceId">) {
  const span = yield* Effect.currentSpan;
  const sentAt = DateTime.formatIso(yield* DateTime.now);
  return { ...from, sentAt, traceId: span.traceId };
});

/**
 * Builds a line from a value a schema made: the value's `_tag` becomes the line's case, and its
 * other fields the body.
 *
 * @stability unstable
 * @category constructors
 */
export const lineFor = <A extends { readonly _tag: string } & Schema.JsonObject>(
  from: Omit<Line, "_tag" | "body">,
  { _tag, ...body }: A,
) => ({ ...from, _tag, body });

/**
 * Returns an entry as the value its schema made, the reverse of `lineFor`: the body's fields with
 * the entry's `_tag` beside them. The result is unchecked, for that schema to decode.
 *
 * @stability unstable
 * @category converting
 */
export const valueFor = (entry: Entry): unknown => Object.assign({}, entry.body, { _tag: entry._tag });

/**
 * Schema for one entry of the log: a line, with the stream and id it was appended under and the
 * place and time the referee gave it.
 *
 * @stability unstable
 * @category schemas
 */
export const Entry = Schema.Struct({
  id: Text,
  stream: Text,
  /** Its place in its stream. */
  pos: Rev,
  /** Its place in the whole log. */
  rev: Rev,
  /** The referee's clock when it arrived, in ms since 1970. Never goes back along rev. */
  arrivedAt: Schema.Int,
  ...Line.fields,
});
/**
 * One entry of the log, as `read` gives it back.
 *
 * @stability unstable
 * @category models
 */
export type Entry = typeof Entry.Type;

/**
 * Schema for an entry as its SQLite row holds it: the same fields, with the body as JSON text.
 *
 * @stability unstable
 * @category schemas
 */
export const Row = Schema.Struct({ ...Entry.fields, body: Schema.fromJsonString(Schema.Json) });

/**
 * Schema for what `append` answers: `placed`, with the entry's `rev` and `pos`, or `refused`, with
 * a reason. A resend gets its first placing again.
 *
 * **Details**
 *
 * The referee refuses with `bad_line` when the stream, the id or the line has the wrong shape,
 * `bad_parent` when `parent` is neither null nor an input's id, `bad_trace` when `traceId` is not a trace id,
 * `seen_ahead` when `seen` is past the log's head, `id_reused` when the stream holds that id with
 * other content, and `too_big` when the row would pass `ROW_BYTES`. `forbidden` is never the
 * referee's own answer: a service above it gives it for a write that is not the writer's to make.
 *
 * @stability unstable
 * @category schemas
 */
export const Appended = Schema.TaggedUnion({
  placed: { rev: Rev, pos: Rev },
  refused: {
    reason: Schema.Literals([
      "bad_line",
      "bad_parent",
      "bad_trace",
      "seen_ahead",
      "id_reused",
      "too_big",
      // Not the ledger's own answer: a writer above it refused a write that is not its to make.
      "forbidden",
    ]),
  },
});
/**
 * An `append`'s answer: `placed` or `refused`.
 *
 * @stability unstable
 * @category models
 */
export type Appended = typeof Appended.Type;

/**
 * Schema for what `wait` answers, at once: `ready` with the stream's newest rev, or `parked` until
 * a ring.
 *
 * @stability unstable
 * @category schemas
 */
export const Waited = Schema.TaggedUnion({ ready: { rev: Rev }, parked: {} });
/**
 * A `wait`'s answer: `ready` or `parked`.
 *
 * @stability unstable
 * @category models
 */
export type Waited = typeof Waited.Type;

/**
 * The most bytes one entry's row may hold: Cloudflare's row limit. Past it `append` answers
 * `too_big`, on every `Sql`, so a test on Node refuses what the project object would.
 *
 * @stability unstable
 * @category constants
 */
export const ROW_BYTES = 2_000_000;

/**
 * The most entries one page of a read holds. A guess: far under the size of an object call's
 * message for small events. `Ledger.read` hides it by pulling page after page; a page shorter than
 * this is the last.
 *
 * @stability unstable
 * @category constants
 */
export const PAGE = 256;
