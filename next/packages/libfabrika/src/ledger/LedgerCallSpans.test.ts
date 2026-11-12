// T285, PR 1, next/. Keep remote calls traced once, including decoding failures.
// Plants: duplicate forwarding spans, missing argument tags, or recovery inside ledger.call.
import { Cause, Effect, Exit, Option, Stream, Tracer } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Ledger, LedgerError, type LedgerCalls } from "./Ledger.ts";
import * as LedgerRemote from "./LedgerRemote.ts";
import { Appended, Entry, Line, PAGE, Waited } from "./Log.ts";

const CHECK = { seed: 119120, numRuns: 40 };
const text = fc.string({ minLength: 1, maxLength: 260 });

const hex = (bytes: number) =>
  fc.uint8Array({ minLength: bytes, maxLength: bytes }).map((a) => `1${Buffer.from(a).toString("hex").slice(1)}`);

const context = fc.record({ traceId: hex(16), spanId: hex(8) });

const cut = (key: string, value: string) =>
  value.length <= 128 ? { [key]: value } : { [key]: value.slice(0, 128), [`${key}.length`]: value.length };

const capture = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

const line = (traceId: string, body: string) =>
  Line.make({
    by: "writer",
    for: "person",
    sentAt: "writer-clock",
    seen: 0,
    parent: null,
    traceId,
    build: "build",
    _tag: "saved",
    body,
  });

describe("ledger.call, next/ tracing keep-laws", () => {
  it("generated calls and pages have one span with argument tags already set at send", async () => {
    await fc.assert(
      fc.asyncProperty(
        context,
        text,
        fc.array(
          fc.record({
            stream: text,
            id: text,
            body: text,
            pages: fc.integer({ min: 0, max: 2 }),
            tail: fc.integer({ min: 0, max: PAGE - 1 }),
            refused: fc.boolean(),
            ready: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        async (parent, reader, calls) => {
          const { spans, tracer } = capture();
          const sent: Array<{
            method: string;
            stream: string;
            active: Array<{ name: string; attributes: Record<string, unknown> }>;
          }> = [];
          let rows: ReadonlyArray<Entry> = [];
          let append: Appended = Appended.cases.placed.make({ rev: 1, pos: 1 });
          let wait: Waited = Waited.cases.parked.make({});
          const sending = (method: string, stream: string) => {
            const active = spans.filter((s) => s.status._tag === "Started");
            sent.push({
              method,
              stream,
              active: active.map((s) => ({
                name: s.name,
                attributes: Object.fromEntries(s.attributes),
              })),
            });
          };
          const stub: LedgerCalls = {
            async append(stream) {
              sending("append", stream);
              return append;
            },
            async read(stream, after, readerId) {
              sending("read", stream);
              expect(readerId).toBe(reader);
              return rows.filter((r) => r.rev > after).slice(0, PAGE);
            },
            async wait(stream, _after, readerId) {
              sending("wait", stream);
              expect(readerId).toBe(reader);
              return wait;
            },
          };
          await Effect.runPromise(
            Effect.gen(function* () {
              const ledger = yield* Ledger;

              for (const c of calls) {
                const value = line(parent.traceId, c.body);
                append = c.refused
                  ? Appended.cases.refused.make({ reason: "id_reused" })
                  : Appended.cases.placed.make({ rev: 1, pos: 1 });
                wait = c.ready ? Waited.cases.ready.make({ rev: 1 }) : Waited.cases.parked.make({});
                rows = Array.from({ length: c.pages * PAGE + c.tail }, (_, i) =>
                  Entry.make({
                    ...value,
                    id: `${c.id}-${i}`,
                    stream: c.stream,
                    rev: i + 1,
                    pos: i + 1,
                    arrivedAt: i,
                  }),
                );
                expect(yield* ledger.append(c.stream, c.id, value)).toEqual(append);
                expect(yield* Stream.runCollect(ledger.read(c.stream, 0))).toEqual(rows);
                expect(yield* ledger.wait(c.stream, rows.length)).toEqual(wait);
              }
            }).pipe(
              Effect.provide(LedgerRemote.layer(stub, { reader })),
              Effect.withParentSpan(Tracer.externalSpan(parent)),
              Effect.withTracer(tracer),
            ),
          );
          expect(sent).toHaveLength(calls.reduce((n, c) => n + c.pages + 3, 0));

          for (const { method, stream, active } of sent) {
            expect(active).toEqual([
              {
                name: "ledger.call",
                attributes: {
                  "rpc.method": method,
                  ...cut("messaging.destination.name", stream),
                  ...cut("fab.ledger.reader", reader),
                },
              },
            ]);
          }

          expect(spans.map((s) => s.name)).toEqual(sent.map(() => "ledger.call"));

          for (const span of spans) {
            expect(span.traceId).toBe(parent.traceId);
            expect(Option.getOrThrow(span.parent).spanId).toBe(parent.spanId);
            expect(span.status._tag).toBe("Ended");

            if (span.status._tag === "Ended") {
              expect(Exit.isSuccess(span.status.exit)).toBe(true);
            }
          }
        },
      ),
      CHECK,
    );
  });

  it("generated unreachable and malformed replies end failed with the typed reason", async () => {
    await fc.assert(
      fc.asyncProperty(
        context,
        text,
        text,
        fc.array(
          fc.record({
            method: fc.constantFrom("append", "read", "wait"),
            unreachable: fc.boolean(),
            bad: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        async (parent, reader, stream, calls) => {
          const { spans, tracer } = capture();

          for (const c of calls) {
            const send = async () => {
              if (c.unreachable) {
                throw new Error("generated remote failure");
              }

              return c.bad;
            };
            const stub: LedgerCalls = { append: send, read: send, wait: send };
            const result = await Effect.runPromise(
              Effect.gen(function* () {
                const ledger = yield* Ledger;
                const operation: Effect.Effect<unknown, LedgerError> =
                  c.method === "read"
                    ? Stream.runCollect(ledger.read(stream, 0))
                    : c.method === "wait"
                      ? ledger.wait(stream, 0)
                      : ledger.append(stream, "id", line(parent.traceId, "body"));
                return yield* Effect.exit(operation);
              }).pipe(
                Effect.provide(LedgerRemote.layer(stub, { reader })),
                Effect.withParentSpan(Tracer.externalSpan(parent)),
                Effect.withTracer(tracer),
              ),
            );
            const reason = c.unreachable ? "unreachable" : "bad_row";
            expect(Exit.isFailure(result)).toBe(true);

            if (Exit.isFailure(result)) {
              expect(Cause.squash(result.cause)).toEqual(new LedgerError({ reason }));
            }

            const span = spans.at(-1)!;
            expect(span.name).toBe("ledger.call");
            expect(span.traceId).toBe(parent.traceId);
            expect(Option.getOrThrow(span.parent).spanId).toBe(parent.spanId);
            expect(Object.fromEntries(span.attributes)).toEqual({
              "rpc.method": c.method,
              ...cut("messaging.destination.name", stream),
              ...cut("fab.ledger.reader", reader),
              "fab.ledger.reason": reason,
            });
            expect(span.status._tag).toBe("Ended");

            if (span.status._tag === "Ended") {
              expect(Exit.isFailure(span.status.exit)).toBe(true);
            }
          }

          expect(spans).toHaveLength(calls.length);
        },
      ),
      CHECK,
    );
  });
});
