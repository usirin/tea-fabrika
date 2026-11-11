import { Effect, Schema } from "effect";
import { cloudflareSql } from "../ledger/CloudflareSql.ts";
import { recordPart } from "../telemetry/RecordPart.ts";
import { SinkError } from "../telemetry/Sink.ts";
import { type Chain } from "../telemetry/Trace.ts";

type Part = ReturnType<typeof recordPart>;
type Rows = Parameters<Part["write"]>[0];
type Deletion = Parameters<Part["deleteContent"]>[1];

const part = Effect.fnUntraced(function* (
  ctx: DurableObjectState,
  bytes: number | undefined,
  chain: Chain,
  at: number,
) {
  const [, name] = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
  )(ctx.id.name).pipe(Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 })));
  const expected = chain._tag === "spans" ? `spans/${at}` : `job/${chain.process}/${at}`;

  if (name !== expected) {
    return yield* new SinkError({ reason: "bad_row", held: 0 });
  }

  return recordPart(cloudflareSql(ctx.storage), chain, at, bytes ?? 1_000_000_000);
});

export const recordWrite = Effect.fn(function* (
  ctx: DurableObjectState,
  bytes: number | undefined,
  chain: Chain,
  at: number,
  rows: Rows,
) {
  return yield* (yield* part(ctx, bytes, chain, at)).write(rows);
});

export const recordRead = Effect.fn(function* (
  ctx: DurableObjectState,
  bytes: number | undefined,
  chain: Chain,
  at: number,
  after: number,
) {
  return yield* (yield* part(ctx, bytes, chain, at)).read(after);
});

export const recordContent = Effect.fn(function* (
  ctx: DurableObjectState,
  bytes: number | undefined,
  chain: Chain,
  at: number,
  id: string,
) {
  return yield* (yield* part(ctx, bytes, chain, at)).content(id);
});

export const recordDelete = Effect.fn(function* (
  ctx: DurableObjectState,
  bytes: number | undefined,
  chain: Chain,
  at: number,
  id: string,
  by: Deletion,
) {
  return yield* (yield* part(ctx, bytes, chain, at)).deleteContent(id, by);
});
