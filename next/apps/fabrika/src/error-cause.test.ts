// T695, next/. The app's own wiring keeps the failure it translates (decision 0043 rule 12).
// Audit sites: `build.ts:34` (finding the `.tsx` files the Compiler checks) and `runtime.ts:15`
// (the instance's settings). `local-instance.ts:20` and `:26` translate a failed module import, which no
// generated input can cause in-process.
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { build } from "./build.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { type Env, settings } from "./runtime.ts";

// The brain reads its embedded tables from the build's generated module; these laws build nothing.
vi.mock("virtual:fabrika-built", () => ({ programs: {}, assets: {} }));

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;

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

const valid = RecordWireTest.settingsFixture({
  name: "instance",
  person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  founder: "ssh-ed25519 AAAA",
  window: null,
  port: 8787,
  build: "b-1",
});

describe("T695, the app's wiring keeps what failed", () => {
  // C1, build.ts:34. Plant: `Effect.mapError(() => new BuildError({ reason: "read" }))`.
  law(
    "C1: a search for the Compiler's files that fails is `read` with that failure as its cause",
    fc.record({ failure: failures, out: fc.stringMatching(/^[a-z]{1,8}$/) }),
    ({ failure, out }) =>
      Effect.gen(function* () {
        const disk = Layer.merge(FileSystem.layerNoop({ glob: () => Effect.fail(failure as never) }), Path.layer);
        const error = yield* Effect.flip(Effect.provide(build({ out: `/tmp-t695/${out}` }), disk));
        expect(error._tag).toBe("BuildError");
        expect(error.reason).toBe("read");
        expect(error.cause).toBe(failure);
      }),
  );

  // C3, runtime.ts:15. Plant: `Effect.mapError(() => new LedgerError({ reason: "bad_row" }))`.
  law(
    "C3: instance settings with a damaged required field fail `bad_row` with the decoder's SchemaError",
    fc.record({
      field: fc.constantFrom("name", "person", "founder", "port", "build"),
      bad: fc.oneof(fc.constant(""), fc.constant(0), fc.constant(70_000), fc.boolean()),
    }),
    ({ field, bad }) =>
      Effect.gen(function* () {
        const damaged =
          field === "person" || field === "founder"
            ? { ...valid, founding: { ...valid.founding, [field]: bad } }
            : field === "port"
              ? {
                  ...valid,
                  settings: { ...valid.settings, values: { ...valid.settings.values, "instance.port": bad } },
                }
              : { ...valid, [field]: bad };
        const instance = JSON.stringify(damaged);
        const error = yield* Effect.flip(settings({ INSTANCE: instance } as Env));
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});
