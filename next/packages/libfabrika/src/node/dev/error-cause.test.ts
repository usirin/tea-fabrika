// T695, next/. The brain's local outbox keeps the failure behind each BrainError (decision 0043 rule
// 12). Disk goes through Effect's FileSystem, which each law supplies with generated failures.
// Audit sites: `local-dev.ts:42` (reading the pending file), `:63` (a durable write), `:82` (the
// last start's file), `:99` (an event to add that does not decode). An `id_reused` refusal has no
// cause. `dev.ts`'s sites run inside `startDev`, against the local runtime's socket: a container's job.
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as fc from "fast-check";
import { brainOutbox } from "./local-dev.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;
const HOME = "/home-t695";

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new RangeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

const started = (id: string) => ({
  _tag: "started",
  id,
  start: `start-${id}`,
  at: 1,
  after: null,
  build: "b-1",
  reason: "open",
  pid: 7,
});

const disk = (calls: Partial<FileSystem.FileSystem>) => Layer.merge(FileSystem.layerNoop(calls), Path.layer);
const fails = <A>(failure: unknown) => Effect.fail(failure as never) as Effect.Effect<A, never>;
const pendingFile = (path: string) => path.endsWith("brain.pending.jsonl");

type Read = "exists" | "read" | "decode";
type Call = "pending" | "last" | "add";

/** The outbox's disk, where reading the pending file goes wrong at `read`. */
const brokenPending = (read: Read, failure: unknown, bad: string) =>
  disk({
    exists: (path) => (read === "exists" && pendingFile(path) ? fails(failure) : Effect.succeed(pendingFile(path))),
    readFileString: () => (read === "read" ? fails(failure) : Effect.succeed(`${bad}\n`)),
  });

const run = (call: Call) =>
  Effect.gen(function* () {
    const outbox = yield* brainOutbox(HOME);
    return call === "pending"
      ? yield* outbox.pending
      : call === "last"
        ? yield* outbox.last
        : yield* outbox.add(started("e-1"));
  });

describe("T695, the brain's outbox keeps what the disk did", () => {
  // C1 and C3, local-dev.ts:42, through every call that reads. Plant: `Effect.mapError(() => new BrainError(...))`.
  law(
    "C1: reading the pending file fails `bad_row` with the disk's failure or the decoder's SchemaError",
    fc.record({
      read: fc.constantFrom<Read>("exists", "read", "decode"),
      call: fc.constantFrom<Call>("pending", "last", "add"),
      failure: failures,
      bad: fc.oneof(
        fc.constant(JSON.stringify({ _tag: "started", id: 5 })),
        fc.string().map((s) => `{${s}`),
      ),
    }),
    ({ read, call, failure, bad }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Effect.provide(run(call), brokenPending(read, failure, bad)));
        expect(error._tag).toBe("BrainError");
        expect(error.reason).toBe("bad_row");
        const cause = (error as { readonly cause?: unknown }).cause;

        if (read === "decode") {
          expect(Schema.isSchemaError(cause), "the cause is the decoder's own failure").toBe(true);
        } else {
          expect(cause).toBe(failure);
        }
      }),
  );

  // C1, local-dev.ts:63. Plant: `Effect.mapError(() => new BrainError({ reason: "storage" }))`.
  law(
    "C1: a durable write whose disk call fails is `storage` with that failure as its cause",
    fc.record({
      step: fc.constantFrom("makeDirectory", "open", "rename"),
      failure: failures,
      id: fc.string({ minLength: 1 }),
    }),
    ({ step, failure, id }) =>
      Effect.gen(function* () {
        const layer = disk({
          exists: () => Effect.succeed(false),
          makeDirectory: () => (step === "makeDirectory" ? fails(failure) : Effect.void),
          open: () => fails(failure),
          rename: () => fails(failure),
        });
        const error = yield* Effect.flip(
          Effect.provide(brainOutbox(HOME).pipe(Effect.flatMap((outbox) => outbox.add(started(id)))), layer),
        );
        expect(error._tag).toBe("BrainError");
        expect(error.reason).toBe("storage");
        expect((error as { readonly cause?: unknown }).cause).toBe(failure);
      }),
  );

  // C3, local-dev.ts:82. Plant: `Effect.mapError(() => new BrainError({ reason: "bad_row" }))`.
  law(
    "C3: a last-start file that does not decode fails `bad_row` with the decoder's SchemaError",
    fc.record({
      bad: fc.oneof(
        fc.constant('""'),
        fc.constant("7"),
        fc.string().map((s) => `"${s}`),
      ),
    }),
    ({ bad }) =>
      Effect.gen(function* () {
        const layer = disk({
          exists: (path) => Effect.succeed(!pendingFile(path)),
          readFileString: () => Effect.succeed(bad),
        });
        const error = yield* Effect.flip(Effect.provide(run("last"), layer));
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError((error as { readonly cause?: unknown }).cause), "the decoder's failure").toBe(true);
      }),
  );

  // C3, local-dev.ts:99. Plant: `Effect.mapError(() => new BrainError({ reason: "bad_row" }))`.
  law(
    "C3: an event with a damaged field fails `bad_row` with the decoder's SchemaError",
    fc.record({
      field: fc.constantFrom("id", "start", "at", "pid", "reason"),
      bad: fc.oneof(fc.constant(""), fc.boolean()),
    }),
    ({ field, bad }) =>
      Effect.gen(function* () {
        const raw = { ...started("e-1"), [field]: bad };
        const error = yield* Effect.flip(
          Effect.provide(brainOutbox(HOME).pipe(Effect.flatMap((outbox) => outbox.add(raw))), disk({})),
        );
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError((error as { readonly cause?: unknown }).cause), "the decoder's failure").toBe(true);
      }),
  );

  // C6, local-dev.ts:107: a reused id with other content is refused with no underlying failure.
  law(
    "C6: an event that reuses a pending id with other content fails `id_reused` with no cause",
    fc.record({ id: fc.string({ minLength: 1 }), pid: fc.integer({ min: 8, max: 1_000 }) }),
    ({ id, pid }) =>
      Effect.gen(function* () {
        const layer = disk({
          exists: (path) => Effect.succeed(pendingFile(path)),
          readFileString: () => Effect.succeed(`${JSON.stringify(started(id))}\n`),
        });
        const error = yield* Effect.flip(
          Effect.provide(
            brainOutbox(HOME).pipe(Effect.flatMap((outbox) => outbox.add({ ...started(id), pid }))),
            layer,
          ),
        );
        expect(error.reason).toBe("id_reused");
        expect((error as { readonly cause?: unknown }).cause).toBeUndefined();
      }),
  );
});
