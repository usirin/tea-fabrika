// The log's shapes: what a writer hands in, what the referee keeps, and what it answers. Tier 1,
// P6 (laws p68 and p92). The one file `no-hand-tag` lets write `_tag`: the log stores any event and
// knows no cases, so a line's `_tag` is an open string, the case as the writer's own schema wrote it.
// `lineFor` and `valueFor` turn a schema's value into a line and an entry back, so no other file
// writes the key.
import { DateTime, Effect, Schema } from "effect";
import { ParentText, Rev } from "../Rev.ts";

export { InputId } from "../Id.ts";

/** A W3C trace id: 32 lowercase hex characters, never all zeros. */
export const TraceId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/),
  Schema.makeFilter((traceId) => traceId !== "0".repeat(32), { expected: "a nonzero W3C trace id" }),
);

const Text = Schema.NonEmptyString;

/** What a writer hands in to `append`. Every key is required, so a writer can leave none out (p92). */
export const Line = Schema.Struct({
  /** Who wrote it, stamped by the door from the checked key. */
  by: Text,
  /** The person the writer works for, from its grant. */
  for: Text,
  /** The writer's own clock, as it sent it. Shown, never decides. */
  sentAt: Schema.String,
  /** The last rev the writer had folded (S1). */
  seen: Rev,
  /** The input that made this write, or null for an own write (p68). */
  parent: Schema.NullOr(ParentText),
  /** The request this write belongs to. Shown and checked for delivery, never decides. */
  traceId: TraceId,
  /** The build of the code that wrote it (H6). */
  build: Text,
  /** The event's case. */
  _tag: Text,
  /** The event's fields, kept as JSON. */
  body: Schema.Json,
});
export type Line = typeof Line.Type;

/** Uses the caller's span: unnamed `fn` keeps the stack frame without inventing a trace. */
export const fromHere = Effect.fn(function* (from: Omit<Line, "_tag" | "body" | "sentAt" | "traceId">) {
  const span = yield* Effect.currentSpan;
  const sentAt = DateTime.formatIso(yield* DateTime.now);
  return { ...from, sentAt, traceId: span.traceId };
});

/** A value a schema made, as a line: its case as the line's case, the rest as its body. */
export const lineFor = <A extends { readonly _tag: string } & Schema.JsonObject>(
  from: Omit<Line, "_tag" | "body">,
  { _tag, ...body }: A,
) => ({ ...from, _tag, body });

/** The reverse of `lineFor`: an entry as the value its schema made, for that schema to decode. */
export const valueFor = (entry: Entry): unknown => Object.assign({}, entry.body, { _tag: entry._tag });

/** One entry: the line, plus what only the referee knows. */
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
export type Entry = typeof Entry.Type;

/** An entry as its row holds it: the body as JSON text. */
export const Row = Schema.Struct({ ...Entry.fields, body: Schema.fromJsonString(Schema.Json) });

/** What `append` answers. A resend gets its first placing again. */
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
export type Appended = typeof Appended.Type;

/** What `wait` answers, at once: the stream's newest rev, or parked until a ring. */
export const Waited = Schema.TaggedUnion({ ready: { rev: Rev }, parked: {} });
export type Waited = typeof Waited.Type;

/** The most entries one read answers. A guess: far under an object call's message for small events. */
export const PAGE = 256;
