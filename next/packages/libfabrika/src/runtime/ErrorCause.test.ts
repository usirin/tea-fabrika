// T695, next/. A program's checked steps keep the failure behind each ProgramDown or BuildError
// (decision 0043 rule 12), through the real Node execution and loader.
// Audit sites: `Program.ts:474` (a saved model that does not decode), `Program.ts:529` and `:536`
// (a step's model or view that does not encode, alone or together), `Program.ts:565` (a refusal
// that does not decode), `State.ts:19`, `:36`, `:56` and `:69` (saved state: a bad row, a throwing
// upgrade, a bad upgraded model; a future version has no cause), `Execution.ts:151` and
// `Entry.ts:92` (a declaration that does not load), `Built.ts:63` (built tables that do not decode).
// C7: `Execution.ts:38`, the RPC failure reply, carries no input-bearing text of a cause.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as fc from "fast-check";
import { BuildError, decodeBuilt } from "./Built.ts";
import { ProgramLoader } from "./Entry.ts";
import { executionFailure, nodeExecution } from "./Execution.ts";
import { ProgramDown, stepper } from "./Program.ts";

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

/** A cause that is, or holds, a decoder's failure: one value, or the list a check met. */
const holdsSchemaError = (cause: unknown): boolean =>
  Schema.isSchemaError(cause) || (Array.isArray(cause) && cause.some(holdsSchemaError));

const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("inc") });
const Refusal = { reason: "limit", now: 3, most: 3 };

/** What a generated program does wrong, if anything. */
type Faults = {
  readonly model?: unknown;
  readonly view?: unknown;
  readonly refusal?: unknown;
  readonly upgrade?: { readonly throws: unknown } | { readonly gives: unknown };
};

/** A counter program, v2 with one upgrade from v1, that misbehaves as `faults` says. */
const program = (faults: Faults) => ({
  name: "cause-counter",
  machine: Machine.make({
    model: Model,
    msg: Msg,
    init: (loaded) => [loaded ?? { count: 0 }, []],
    update: {
      inc: (s) => [(faults.model === undefined ? { count: s.count + 1 } : faults.model) as typeof s, []],
    },
  }),
  state: {
    v: 2,
    schema: Model,
    upgrades: [
      {
        from: 1,
        name: "one-to-two",
        run: (old: unknown) => {
          const upgrade = faults.upgrade;

          if (upgrade !== undefined && "throws" in upgrade) {
            throw upgrade.throws;
          }

          return upgrade === undefined ? old : upgrade.gives;
        },
      },
    ],
  },
  msg: Msg,
  view: {
    data: Model,
    select: (s: typeof Model.Type) => (faults.view === undefined ? s : faults.view) as typeof s,
  },
  refuse: () => (faults.refusal === undefined ? null : faults.refusal),
  inputs: {},
  outputs: {},
  writes: {},
  wake: () => null,
});

/** A value that is not an Int, as a damaged field holds it. */
const notInt = fc.oneof(fc.string(), fc.boolean(), fc.double({ noInteger: true, noNaN: true }));

describe("T695, a step's ProgramDown keeps what failed", () => {
  // C3, Program.ts:474. Plant: `throw new ProgramDown({ reason })` without the decode failure.
  law(
    "C3: a saved model with a damaged field fails `saved_state` with the decoder's SchemaError",
    fc.record({ call: fc.constantFrom("init", "step", "fold"), bad: notInt }),
    ({ call, bad }) =>
      Effect.gen(function* () {
        const run = nodeExecution(program({}));
        const saved = { count: bad };
        const work =
          call === "init"
            ? run.init(saved)
            : call === "step"
              ? run.step(saved, { type: "inc" })
              : run.fold(saved, { type: "inc" });
        const error = yield* Effect.flip(work);
        expect(error).toBeInstanceOf(ProgramDown);
        expect(error.reason).toBe("saved_state");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C3, Program.ts:529 and :536: several results meet at one check. Plant: drop the failures.
  law(
    "C3: a step whose model, view or both fail to encode keeps `step` and those failures",
    fc
      .record({
        model: fc.option(notInt, { nil: undefined }),
        view: fc.option(notInt, { nil: undefined }),
        count: fc.integer(),
      })
      .filter((faults) => faults.model !== undefined || faults.view !== undefined),
    ({ model, view, count }) =>
      Effect.gen(function* () {
        const faults: Faults = {
          ...(model === undefined ? {} : { model: { count: model } }),
          ...(view === undefined ? {} : { view: { count: view } }),
        };
        const error = yield* Effect.flip(nodeExecution(program(faults)).step({ count }, { type: "inc" }));
        expect(error.reason, "the reason stays the one the check returned").toBe("step");
        expect(holdsSchemaError(error.cause), "the cause holds the failed results").toBe(true);
      }),
  );

  // C3, Program.ts:565. Plant: `throw new ProgramDown({ reason: "step" })` with no cause.
  law(
    "C3: a refusal with a damaged field fails `step` with the decoder's SchemaError",
    fc.record({
      count: fc.integer(),
      field: fc.constantFrom("reason", "now", "most"),
      bad: fc.oneof(fc.boolean(), fc.object()),
    }),
    ({ count, field, bad }) =>
      Effect.gen(function* () {
        const refusal = { ...Refusal, [field]: bad };
        const error = yield* Effect.flip(nodeExecution(program({ refusal })).step({ count }, { type: "inc" }));
        expect(error.reason).toBe("step");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

describe("T695, saved state keeps what failed", () => {
  const row = (v: number, model: unknown) => ({ v, build: "b-1", model, after: 0 });

  // C3, State.ts:36. Plant: replace `row.failure` with `undefined`.
  law(
    "C3: a saved row with a damaged required field fails `saved_state` with the decoder's SchemaError",
    fc.record({
      field: fc.constantFrom("v", "build", "after"),
      bad: fc.oneof(fc.constant(""), fc.constant(-1), fc.boolean()),
    }),
    ({ field, bad }) =>
      Effect.gen(function* () {
        const saved = { ...row(2, { count: 1 }), [field]: field === "build" && bad === -1 ? "" : bad };
        const error = yield* Effect.flip(nodeExecution(program({})).upgrade(saved));
        expect(error.reason).toBe("saved_state");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C6, State.ts:36. Plant: make the cause field required, or invent an error for the branch.
  law(
    "C6: a saved row from a future version fails `saved_state` with no cause",
    fc.record({ ahead: fc.integer({ min: 1, max: 1_000 }), count: fc.integer() }),
    ({ ahead, count }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(nodeExecution(program({})).upgrade(row(2 + ahead, { count })));
        expect(error.reason).toBe("saved_state");
        expect(error.cause).toBeUndefined();
      }),
  );

  // C1, State.ts:19 and :56. Plant: the zero-argument `down` as the upgrade's `catch`.
  law(
    "C1: an upgrade that throws a generated value fails `saved_state` with that value as its cause",
    fc.record({ failure: failures, count: fc.integer() }),
    ({ failure, count }) =>
      Effect.gen(function* () {
        const run = nodeExecution(program({ upgrade: { throws: failure } }));
        const error = yield* Effect.flip(run.upgrade(row(1, { count })));
        expect(error.reason).toBe("saved_state");
        expect(error.cause).toBe(failure);
      }),
  );

  // C3, State.ts:69. Plant: replace `decoded.failure` with `undefined`.
  law(
    "C3: an upgrade that gives a damaged model fails `saved_state` with the decoder's SchemaError",
    fc.record({ bad: notInt }),
    ({ bad }) =>
      Effect.gen(function* () {
        const run = nodeExecution(program({ upgrade: { gives: { count: bad } } }));
        const error = yield* Effect.flip(run.upgrade(row(1, { count: 1 })));
        expect(error.reason).toBe("saved_state");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

describe("T695, a declaration that does not load keeps why", () => {
  const broken = fc.record(
    { name: fc.oneof(fc.integer(), fc.constant(null)), v: fc.string() },
    { noNullPrototype: true },
  );

  // C1, Execution.ts:151 and Entry.ts:92. Plant: `Effect.mapError(() => new ProgramDown({ reason: "load" }))`.
  law(
    "C1: a damaged declaration fails `load` with the stepper's own failure, from the execution and the loader",
    fc.record({ declared: broken, call: fc.constantFrom("execution", "loader") }),
    ({ declared, call }) =>
      Effect.gen(function* () {
        const expected = stepper(declared);
        expect(Result.isFailure(expected)).toBe(true);
        const error = yield* Effect.flip(
          call === "execution"
            ? nodeExecution(declared).init(null)
            : Effect.provide(
                ProgramLoader.use((loader) => loader.load("broken")),
                ProgramLoader.layer({ broken: declared }, {}),
              ),
        );
        expect(error).toBeInstanceOf(ProgramDown);
        expect((error as ProgramDown).reason).toBe("load");
        expect(Schema.isSchemaError((error as ProgramDown).cause), "the cause is the stepper's SchemaError").toBe(true);
        expect((error as ProgramDown).cause).toEqual(Result.isFailure(expected) ? expected.failure : null);
      }),
  );

  // C3, Built.ts:63. Plant: `Effect.mapError(() => new BuildError({ reason: "table" }))`.
  law(
    "C3: built tables with a damaged program or asset map fail `table` with the decoder's SchemaError",
    fc.record({ programs: fc.oneof(fc.string(), fc.array(fc.integer())), assets: fc.constant({}) }),
    (raw) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodeBuilt(raw));
        expect(error).toBeInstanceOf(BuildError);
        expect(error.reason).toBe("table");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

// C7 [secrets], Execution.ts:38. A ProgramDown's cause stays in memory; the reply that crosses RPC
// holds no sentinel from the input that failed, raw, JSON-escaped or URL-encoded. The input is a
// saved model, a saved row or an upgraded model. A program's own throw is not input: its text
// already rides in deletable content (Runner.test.ts, "content deletable separately"). Effect's
// SchemaError holds no input value, so the slip this catches is a cause that carries the input
// itself. Plant: `cause: { failure: decoded.failure, raw }` at Program.ts:474.
describe("T695, C7 [secrets]: an execution failure reply holds no input-bearing text", () => {
  const words = fc.stringMatching(/^[a-z]{12}$/).map((word) => `sntl${word}`);
  const forms = (core: string, text: string) => [
    core,
    text,
    JSON.stringify(text).slice(1, -1),
    encodeURIComponent(text),
  ];

  law(
    "C7: generated decode failures of saved input carrying sentinels leave none in the RPC reply",
    fc.record({
      steps: fc.array(fc.record({ call: fc.constantFrom("step", "upgrade_row", "upgrade_gives"), word: words }), {
        minLength: 1,
        maxLength: 4,
      }),
      decor: fc.constantFrom(' "quoted" ', " /path?x=1&y=2 ", "\n\t", " ü "),
    }),
    ({ steps, decor }) =>
      Effect.gen(function* () {
        for (const { call, word } of steps) {
          const text = `${decor}${word}${decor}`;
          const work =
            call === "step"
              ? nodeExecution(program({})).step({ count: { input: text } }, { type: "inc" })
              : call === "upgrade_row"
                ? nodeExecution(program({})).upgrade({ v: 1, build: { input: text }, model: null, after: 0 })
                : nodeExecution(program({ upgrade: { gives: { count: text } } })).upgrade(row1);
          const error = yield* Effect.flip(work);
          expect(error).toBeInstanceOf(ProgramDown);
          const reply = JSON.stringify(executionFailure(error));

          for (const form of forms(word, text)) {
            expect(reply.includes(form), "the RPC reply holds a cause's input-bearing text").toBe(false);
          }
        }
      }),
  );
});

const row1 = { v: 1, build: "b-1", model: { count: 1 }, after: 0 };
