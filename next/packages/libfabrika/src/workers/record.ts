import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Schema } from "effect";
import { type Chain, recordPart, SinkError } from "../data/index.ts";
import { workerSql } from "../data/worker-sql.ts";
import { RecordPart, type RecordShape } from "./objects.ts";

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

  return recordPart(workerSql(ctx.storage), chain, at, bytes ?? 1_000_000_000);
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

export const RecordPartLive = RecordPart.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const env = yield* Cloudflare.WorkerEnvironment;
      const config = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Number })) }),
        ),
      )(env.STAGE);
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: raw storage until PR 8; not reported, 0042 amendment 2026-11-09
      const raw = state.raw as unknown as DurableObjectState;
      const cap = config.limits?.recordBytes;
      return {
        write: (chain, at, rows) => recordWrite(raw, cap, chain, at, rows),
        read: (chain, at, after) => recordRead(raw, cap, chain, at, after),
        content: (chain, at, id) => recordContent(raw, cap, chain, at, id),
        deleteContent: (chain, at, id, by) => recordDelete(raw, cap, chain, at, id, by),
      } satisfies RecordShape;
    });
  }),
);
