// T246, next/: fromHere reads the writer's current span. Its entry joins P37's ledger.call
// record by traceId, including an own write. With no span, the helper fails instead of making one.
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Layer, Schema, Stream, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as data from "../data/index.ts";
import { inputParents } from "../Id.test-support.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Doorbell, Ledger, type LedgerCalls } from "./Ledger.ts";
import { lineFor } from "./Log.ts";
import { nodeSql } from "./NodeSqlite.ts";
import { Referee } from "./Referee.ts";

const traceIds = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/))).pipe(
  Arbitrary.filter((traceId) => traceId !== "0".repeat(32)),
);

const SENT = "2026-11-07T21:10:01.204Z";

const from = {
  by: "SHA256:writer-a",
  for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  seen: 0,
  parent: null,
  build: "b-7c1d073",
} as const;

const opened: Array<DatabaseSync> = [];

afterAll(() => {
  for (const db of opened.splice(0)) {
    if (db.isOpen) {
      db.close();
    }
  }
});

describe("T518, TraceId generation", () => {
  // Plant: a lookahead in the schema's pattern prevents Effect Arbitrary generation.
  it.effect.prop(
    "Effect Arbitrary generates 200 decodable trace ids and their all-zero form is refused",
    { sampleSeed: Schema.Int },
    ({ sampleSeed }) =>
      Effect.gen(function* () {
        const values = yield* Arbitrary.sampleEffect(Arbitrary.schema(data.TraceId), {
          count: 200,
          seed: sampleSeed,
        });
        expect(values).toHaveLength(200);

        for (const value of values) {
          expect(Schema.decodeUnknownSync(data.TraceId)(value)).toBe(value);
          expect(value).toMatch(/^[0-9a-f]{32}$/);
          const zero = value.replace(/[0-9a-f]/g, "0");
          expect(() => Schema.decodeUnknownSync(data.TraceId)(zero)).toThrow();
        }
      }),
    { arbitrary: { seed: 119120, runs: 40 } },
  );
});

describe("T246, fromHere", () => {
  // Plant: fromHere returns a fresh random traceId instead of the current span's.
  it.effect.prop(
    "an entry with a generated parent or null joins the ledger.call span P37 records",
    { input: inputParents, own: Schema.Boolean, traceId: traceIds },
    ({ input, own, traceId }) => {
      const parent = own ? null : input;
      const db = new DatabaseSync(":memory:");
      opened.push(db);
      const sql = nodeSql(db);
      const world = Layer.mergeAll(
        Referee.layer(sql).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
        SpanSink.layer(sql, { object: "gateway:t1" }),
        RecordManager.memory(1024 * 1024 * 1024),
        Archive.memory,
      );
      return Effect.gen(function* () {
        expect(data.fromHere, "fromHere reads the span already in scope").toBeTypeOf("function");
        yield* TestClock.setTime(Date.parse(SENT));
        const referee = yield* Referee;
        // The test's object-call bridge runs the real referee; it invents no answer or stored row.
        const calls: LedgerCalls = {
          append: (stream, id, line) => Effect.runPromise(referee.append(stream, id, line)),
          read: (stream, after, reader) => Effect.runPromise(referee.read(stream, after, reader)),
          wait: (stream, after, reader) => Effect.runPromise(referee.wait(stream, after, reader)),
        };
        const writer = { ...from, parent };
        yield* Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          expect(span.traceId).toBe(traceId);
          const stamped = yield* data.fromHere(writer);
          expect(stamped).toEqual({ ...writer, sentAt: SENT, traceId });
          const ledger = yield* Ledger;
          expect(yield* ledger.append("notes:1", "w-1", lineFor(stamped, { _tag: "saved", note: "n-1" }))).toEqual({
            _tag: "placed",
            rev: 1,
            pos: 1,
          });
        }).pipe(
          Effect.withSpan("notes.save"),
          Effect.withParentSpan(Tracer.externalSpan({ traceId, spanId: "00f067aa0ba902b7" })),
          Effect.provide(Ledger.remote(calls, { reader: "gateway:t1" })),
        );
        const [entry, ...rest] = yield* referee.read("notes:1", 0, "gateway:t1");
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({ id: "w-1", parent, traceId });
        yield* SpanSink.use((sink) => sink.flush);
        const spans = yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })));
        const append = spans.filter(
          (span) => span.name === "ledger.call" && span.attributes["rpc.method"] === "append",
        );
        expect(append).toHaveLength(1);
        expect(append[0]?.traceId).toBe(traceId);
        expect(entry?.traceId).toBe(append[0]?.traceId);
      }).pipe(Effect.provide(world));
    },
    { arbitrary: { seed: 119120, runs: 40 } },
  );

  // Plant: fromHere falls back to a random id, or starts its own root span.
  it("no span no write: fromHere fails with NoSuchElementError outside a span", () => {
    expect(data.fromHere, "fromHere requires a writer's span").toBeTypeOf("function");
    const exit = Effect.runSyncExit(data.fromHere(from));
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.match(exit, { onFailure: Cause.squash, onSuccess: () => undefined });
    expect(Cause.isNoSuchElementError(error)).toBe(true);
  });
});
