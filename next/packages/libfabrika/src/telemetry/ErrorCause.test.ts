// T695, next/. Telemetry's translated errors keep the failure they wrap (decision 0043 rule 12).
// Audit sites: `Trace.ts:123` (`sinkError`, the sink's one thrown-value translation),
// `Archive.ts:21` (a WebCrypto digest that rejects), `Archive.ts:58` (an R2 call that rejects),
// `Archive.ts:68` (a `head` answer that does not decode), `Records.ts:444` (a part's answer that
// does not decode). `Sink.ts:393` needs a database and runs in `node/ErrorCause.test.ts`.
import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { Archive, type BucketCalls, sha256 } from "./Archive.ts";
import { type RecordCalls, RecordManager } from "./Records.ts";
import { Chain, SinkError, sinkError } from "./Trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

/** A spy on WebCrypto's digest that rejects with `failure`, restored when the Effect ends. */
const digestRejects = <A, E>(failure: unknown, work: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockRejectedValue(failure)),
    () => work,
    (spy) => Effect.sync(() => spy.mockRestore()),
  );

const put = (body: Uint8Array) => Archive.use((archive) => archive.put("spans/1", body));
const bodies = fc.uint8Array({ maxLength: 64 });

describe("T695, sinkError keeps the thrown value", () => {
  // C1 and C3, Trace.ts:123. Plant: `new SinkError({ reason: ..., held: 0 })` with no cause.
  law(
    "C1: any thrown value, a SchemaError included, becomes a SinkError whose cause is that value",
    fc.record({ failure: failures, raw: fc.jsonValue() }),
    ({ failure, raw }) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.flip(Schema.decodeUnknownEffect(Schema.Struct({ n: Schema.Int }))(raw));

        for (const thrown of [failure, decoded]) {
          const error = sinkError(thrown);
          expect(error.reason).toBe(Schema.isSchemaError(thrown) ? "bad_row" : "storage");
          expect(error.cause).toBe(thrown);
        }
      }),
  );
});

describe("T695, the archive keeps what failed", () => {
  // C1, Archive.ts:21. Plant: `const fail = () => new SinkError({ reason: "storage", held: 0 })`.
  law(
    "C1: a digest that rejects is `storage` with the rejected value as its cause, on any archive",
    fc.record({ failure: failures, body: bodies, onBucket: fc.boolean() }),
    ({ failure, body, onBucket }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => Promise.resolve(),
          head: () => Promise.resolve(null),
        };
        const archive = onBucket ? Archive.bucket(calls) : Archive.memory;
        const direct = yield* Effect.flip(digestRejects(failure, sha256(body)));
        const stored = yield* Effect.flip(digestRejects(failure, Effect.provide(put(body), archive)));

        for (const error of [direct, stored]) {
          expect(error.reason).toBe("storage");
          expect(error.cause).toBe(failure);
        }
      }),
  );

  // C5, Archive.ts:58: one callback serves `put` and `head`. Plant: the zero-argument `fail`.
  law(
    "C5: whichever bucket call rejects, the archive fails `unreachable` with that value as its cause",
    fc.record({ failure: failures, body: bodies, call: fc.constantFrom("put", "head") }),
    ({ failure, body, call }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => (call === "put" ? Promise.reject(failure) : Promise.resolve()),
          head: () => (call === "head" ? Promise.reject(failure) : Promise.resolve(null)),
        };
        const error = yield* Effect.flip(Effect.provide(put(body), Archive.bucket(calls)));
        expect(error.reason).toBe("unreachable");
        expect(error.cause).toBe(failure);
      }),
  );

  // C3, Archive.ts:68. Plant: `Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 }))`.
  law(
    "C3: a `head` answer with a damaged hash field is `bad_row` carrying the decoder's SchemaError",
    fc.record({ body: bodies, bad: fc.oneof(fc.integer(), fc.boolean(), fc.array(fc.string())) }),
    ({ body, bad }) =>
      Effect.gen(function* () {
        const calls: BucketCalls = {
          put: () => Promise.resolve(),
          // A valid head is `{ sha256: string }`; this one's hash is the wrong type.
          head: () => Promise.resolve(JSON.parse(JSON.stringify({ sha256: bad }))),
        };
        const error = yield* Effect.flip(Effect.provide(put(body), Archive.bucket(calls)));
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

describe("T695, a remote record part keeps what failed", () => {
  const chain = Chain.cases.spans.make({});

  // C3, Records.ts:444. Plant: `Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 }))`.
  law(
    "C3: a part's `content` answer with a damaged field is `bad_row` carrying the decoder's SchemaError",
    fc.record({ spanId: fc.string(), bad: fc.oneof(fc.string(), fc.integer()) }),
    ({ spanId, bad }) =>
      Effect.gen(function* () {
        const calls: RecordCalls = {
          write: () => Effect.succeed({ _tag: "written" }),
          read: () => Effect.succeed({ spans: [], after: 0, rolled: false }),
          // A valid answer is `absent { rolled: boolean }`; this one's flag is the wrong type.
          content: () => Effect.succeed({ _tag: "absent", rolled: bad }),
          deleteContent: () => Effect.succeed({ _tag: "absent", rolled: false }),
        };
        const error = yield* Effect.flip(
          Effect.provide(
            RecordManager.use((records) => records.content(chain, spanId)),
            RecordManager.remote(() => calls),
          ),
        );
        expect(error).toBeInstanceOf(SinkError);
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C4, Records.ts:441: a part's own SinkError passes through. Plant: wrap it as `fail(cause)`.
  law(
    "C4: a SinkError a part fails with comes out as that same object, its cause untouched",
    fc.record({ failure: failures, reason: fc.constantFrom("unreachable", "bad_row", "storage") }),
    ({ failure, reason }) =>
      Effect.gen(function* () {
        const thrown = new SinkError({ reason, held: 0, cause: failure });
        const calls: RecordCalls = {
          write: () => Effect.fail(thrown),
          read: () => Effect.fail(thrown),
          content: () => Effect.fail(thrown),
          deleteContent: () => Effect.fail(thrown),
        };
        const error = yield* Effect.flip(
          Effect.provide(
            RecordManager.use((records) => records.content(chain, "span-1")),
            RecordManager.remote(() => calls),
          ),
        );
        expect(error).toBe(thrown);
        expect(error.cause).toBe(failure);
      }),
  );
});
