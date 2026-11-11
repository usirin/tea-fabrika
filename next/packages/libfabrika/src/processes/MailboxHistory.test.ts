// P11 adds history without changing P9 Letter. One reader must keep entry timing and build.
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream, Tracer } from "effect";
import * as fc from "fast-check";
import { processId } from "../Id.test-support.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { lineFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox, type From } from "./Mailbox.ts";

const opened: DatabaseSync[] = [];

afterAll(() => {
  for (const db of opened) {
    db.close();
  }
});

const from: From = {
  by: "SHA256:sender",
  for: "person",
  sentAt: "2026-11-08T01:00:00Z",
  seen: 0,
  parent: `in-${Effect.runSync(processId)}-1`,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "build-original",
};

const world = () => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  return Mailbox.layer.pipe(
    Layer.provideMerge(
      LedgerSql.layer(nodeSql(db), { reader: "p11-history" }).pipe(
        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
      ),
    ),
  );
};

const check = <A, E, R>(arb: fc.Arbitrary<A>, examples: A[], law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        {
          seed: 119120,
          numRuns: 40,
          includeErrorInReport: true,
          examples: examples.map((a): [A] => [a]),
        },
      ),
    );
  });

const metadata = fc.record({ build: fc.string({ minLength: 1 }), sentAt: fc.string() });

describe("P11 richer mailbox history", () => {
  it.effect("each history read ends one mailbox.read span", () =>
    check(fc.array(fc.jsonValue(), { maxLength: 10 }), [], (messages) => {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;

        for (const [i, m] of messages.entries()) {
          yield* mailbox.send("counter:1", `letter:${i}`, m, from);
        }

        expect(yield* Stream.runCollect(mailbox.read("counter:1", 0))).toHaveLength(messages.length);
        expect(spans.filter((s) => s.name === "mailbox.read" && s.status._tag === "Ended")).toHaveLength(1);
      }).pipe(Effect.provide(world()), Effect.withTracer(tracer));
    }),
  );
  it.effect("plant, project away build or clocks: rich history preserves the original entry", () =>
    check(metadata, [{ build: from.build, sentAt: from.sentAt }], (over) =>
      Effect.gen(function* () {
        const original = { ...from, ...over };
        const mailbox = yield* Mailbox;
        const ledger = yield* Ledger;
        yield* mailbox.send("counter:1", "a", { type: "add", n: 1 }, original);
        yield* ledger.append("elsewhere", "noise", lineFor(from, { _tag: "noise" }));
        yield* mailbox.send("counter:1", "b", { type: "add", n: 2 }, { ...original, seen: 2, build: "build-later" });
        const entries = yield* Stream.runCollect(ledger.read("counter:1/inbox", 0));
        const rich = yield* Stream.runCollect(mailbox.read("counter:1", 0));
        const plain = yield* Stream.runCollect(mailbox.receive("counter:1", 0));
        expect(rich).toEqual(
          entries.map((row) => ({
            id: row.id,
            m: Schema.decodeUnknownSync(Schema.Struct({ m: Schema.Json }))(row.body).m,
            by: row.by,
            for: row.for,
            sentAt: row.sentAt,
            parent: row.parent,
            traceId: row.traceId,
            rev: row.rev,
            pos: row.pos,
            build: row.build,
            seen: row.seen,
            arrivedAt: row.arrivedAt,
          })),
        );
        expect(rich.map(({ build: _build, seen: _seen, arrivedAt: _arrivedAt, ...letter }) => letter)).toEqual(plain);
        expect(rich.map((row) => row.pos)).toEqual([1, 2]);
        expect(rich.map((row) => row.rev)).toEqual([1, 3]);
        expect(yield* Stream.runCollect(mailbox.read("counter:1", 1))).toEqual(rich.slice(1));
      }).pipe(Effect.provide(world())),
    ),
  );
  it.effect("plant, replace first delivery metadata: resend keeps its first build and clocks", () =>
    check(metadata, [{ build: "retry-build", sentAt: "later" }], (retry) =>
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        const first = yield* mailbox.send("counter:1", "a", { type: "add", n: 1 }, from);
        const before = yield* Stream.runCollect(mailbox.read("counter:1", 0));
        expect(yield* mailbox.send("counter:1", "a", { type: "add", n: 1 }, { ...from, ...retry, seen: 1 })).toEqual(
          first,
        );
        expect(yield* Stream.runCollect(mailbox.read("counter:1", 0))).toEqual(before);
      }).pipe(Effect.provide(world())),
    ),
  );
});
