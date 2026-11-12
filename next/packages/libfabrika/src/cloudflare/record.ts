import { DurableObjectState as ObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Context, Effect, Layer, Option, Schema, Scope } from "effect";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { recordPart } from "../telemetry/RecordPart.ts";
import { SinkError } from "../telemetry/Sink.ts";
import { type Chain } from "../telemetry/Trace.ts";
import { cloudflareSql } from "./CloudflareSql.ts";
import { RecordPart, type RecordShape } from "./objects.ts";
import { recordedLayer, settingsFailure, type Env } from "./runtime.ts";
import * as SettingsRuntime from "./SettingsRuntime.ts";

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
  )(ctx.id.name).pipe(Effect.mapError((cause) => new SinkError({ reason: "bad_row", held: 0, cause })));
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

export const RecordPartLive = RecordPart.make(
  Effect.gen(function* () {
    const state = yield* ObjectState;
    const env = yield* WorkerEnvironment;
    const Legacy = Schema.Struct({
      limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Int.check(Schema.isGreaterThan(0)) })),
    });
    // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy supplies the Worker's typed binding handles
    const bindings = env as unknown as Env;
    const recorded = recordedLayer(bindings);
    const ready = Layer.effect(
      RecordedStart,
      RecordedStart.pipe(
        Effect.tap((start) =>
          Schema.decodeUnknownEffect(Legacy)(start.input).pipe(
            Effect.mapError((cause) => new SinkError({ reason: "bad_row", held: 0, cause })),
          ),
        ),
      ),
    ).pipe(Layer.provide(recorded));
    const owner = SettingsRuntime.runtime(ready);
    const scope = yield* Effect.serviceOption(Scope.Scope);

    if (Option.isSome(scope)) {
      yield* Scope.addFinalizer(scope.value, owner.disposeEffect);
    }

    const cap = settingsFailure(owner.context).pipe(
      Effect.map((context) => Context.get(context, RecordedStart).input.limits?.recordBytes),
    );
    // oxlint-disable-next-line fabrika/no-type-assertions -- edge: raw storage until PR 8; not reported, 0042 amendment 2026-11-09
    const raw = state.raw as unknown as DurableObjectState;
    return Effect.succeed({
      write: (chain, at, rows) => cap.pipe(Effect.flatMap((bytes) => recordWrite(raw, bytes, chain, at, rows))),
      read: (chain, at, after) => cap.pipe(Effect.flatMap((bytes) => recordRead(raw, bytes, chain, at, after))),
      content: (chain, at, id) => cap.pipe(Effect.flatMap((bytes) => recordContent(raw, bytes, chain, at, id))),
      deleteContent: (chain, at, id, by) =>
        cap.pipe(Effect.flatMap((bytes) => recordDelete(raw, bytes, chain, at, id, by))),
    } satisfies RecordShape);
  }),
);
