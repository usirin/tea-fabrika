// T695, next/. A program's checked steps keep the failure behind each ProgramDown or BuildError
// (decision 0043 rule 12), through the real Node execution and loader.
// Audit sites: `Program.ts:474` (a saved model that does not decode), `Program.ts:529` and `:536`
// (a step's model or view that does not encode, alone or together), `Program.ts:565` (a refusal
// that does not decode), `State.ts:19`, `:36`, `:56` and `:69` (saved state: a bad row, a throwing
// upgrade, a bad upgraded model; a future version has no cause), `Execution.ts:151` and
// `Entry.ts:92` (a declaration that does not load), `Built.ts:63` (built tables that do not decode).
// C7: `Execution.ts:38`, the RPC failure reply, carries no input-bearing text of a cause, and
// `Program.ts:379`, a ProgramDown's class, reads as it did before the cause was kept.
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

/** The v1-to-v2 upgrade, which misbehaves as `faults` says. */
const upgrades = (faults: Faults) => [
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
];

/** A counter program, v2 with one upgrade from v1, that misbehaves as `faults` says. */
const program = (faults: Faults) => ({
  name: "cause-counter",
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (loaded) => [loaded ?? { count: 0 }, []],
    update: {
      inc: (s) => [(faults.model === undefined ? { count: s.count + 1 } : faults.model) as typeof s, []],
    },
  }),
  state: { v: 2, schema: Model, upgrades: upgrades(faults) },
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

/** A model keyed by input: a decoder's failure path names the key that held the bad value. */
const Seen = Schema.Struct({ count: Schema.Int, seen: Schema.Record(Schema.String, Schema.Int) });

/** The same counter over `Seen`, so a failure's path can hold input text. */
const seenProgram = (faults: Faults) => ({
  ...program(faults),
  machine: Machine.make({
    model: Seen,
    msg: Msg,
    cmds: [],
    init: (loaded) => [loaded ?? { count: 0, seen: {} }, []],
    update: {
      inc: (s) => [(faults.model === undefined ? { ...s, count: s.count + 1 } : faults.model) as typeof s, []],
    },
  }),
  state: { v: 2, schema: Seen, upgrades: upgrades(faults) },
  view: { data: Seen, select: (s: typeof Seen.Type) => s },
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
        const error = yield* Effect.flip<unknown, ProgramDown, never>(
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

const row1 = { v: 1, build: "b-1", model: { count: 1 }, after: 0 };

/** A step, upgrade or load that fails at a site this ticket gave a cause, and the call it makes. */
const causedAt = {
  saved_model: (bad: unknown) => nodeExecution(program({})).init({ count: bad }),
  step_model: (bad: unknown) => nodeExecution(program({ model: { count: bad } })).step({ count: 1 }, { type: "inc" }),
  step_view: (bad: unknown) => nodeExecution(program({ view: { count: bad } })).step({ count: 1 }, { type: "inc" }),
  refusal: (bad: unknown) =>
    nodeExecution(program({ refusal: { ...Refusal, reason: bad } })).step({ count: 1 }, { type: "inc" }),
  saved_row: (bad: unknown) => nodeExecution(program({})).upgrade({ ...row1, after: bad }),
  upgrade_throws: (bad: unknown) => nodeExecution(program({ upgrade: { throws: bad } })).upgrade(row1),
  upgrade_gives: (bad: unknown) => nodeExecution(program({ upgrade: { gives: { count: bad } } })).upgrade(row1),
  load: (bad: unknown) => nodeExecution({ name: bad, v: "1" }).init(null),
} as const;

// C7, Program.ts:379 and Runner.ts:742. A ProgramDown's class is the code-defined summary that
// crosses RPC and is stored as an observation's `error`. A cause kept in memory leaves it as it
// was before the cause was kept: the cause-free ProgramDown's own class. Plant: `errorClass` reads
// the cause first, as it does for a program's own throw.
law(
  "C7: a ProgramDown from a site that now keeps its cause reports the class it reported without one",
  fc.record({
    site: fc.constantFrom(...(Object.keys(causedAt) as Array<keyof typeof causedAt>)),
    // Never a valid Int, number, string or name: each site fails for this value alone.
    bad: fc.oneof(fc.boolean(), failures),
  }),
  ({ site, bad }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip<unknown, ProgramDown, never>(causedAt[site](bad));
      expect(error).toBeInstanceOf(ProgramDown);
      expect(error.cause, "the site keeps a cause in memory").toBeDefined();
      const before = new ProgramDown({ reason: error.reason }).errorClass;
      expect(error.errorClass, "the class an observation stores").toBe(before);
      expect(executionFailure(error).error, "the class the RPC reply carries").toBe(before);
    }),
);

// C7 [secrets], Execution.ts:38. A ProgramDown's cause stays in memory; the reply that crosses RPC
// holds no sentinel from the input that failed, raw, JSON-escaped or URL-encoded. The input is a
// saved model, a saved row, an upgraded model or a stepped model, each holding a generated
// sentinel as a record key (a decoder's failure path names it) and as the bad value. A program's
// own throw is not input: its text already rides in deletable content (Runner.test.ts, "content
// deletable separately"). Plant: `cause: { failure: decoded.failure, raw }` at Program.ts:474, and
// the reply's `content` as `Cause.pretty` of the cause.
describe("T695, C7 [secrets]: an execution failure reply holds no input-bearing text", () => {
  const words = fc.stringMatching(/^[a-z]{12}$/);
  const forms = (text: string) => [text, JSON.stringify(text).slice(1, -1), encodeURIComponent(text)];
  const calls = ["init", "step", "fold", "upgrade_row", "upgrade_gives", "encode"] as const;

  /** The call that feeds `seen`, keyed by `key`, to the decoder at one site. */
  const feed = (call: (typeof calls)[number], seen: Record<string, unknown>) => {
    const saved = { count: 1, seen };
    const inc = { type: "inc" };

    switch (call) {
      case "init":
        return nodeExecution(seenProgram({})).init(saved);
      case "step":
        return nodeExecution(seenProgram({})).step(saved, inc);
      case "fold":
        return nodeExecution(seenProgram({})).fold(saved, inc);
      case "upgrade_row":
        return nodeExecution(seenProgram({})).upgrade({ v: 1, build: seen, model: null, after: 0 });
      case "upgrade_gives":
        return nodeExecution(seenProgram({ upgrade: { gives: saved } })).upgrade({ ...row1, model: saved });
      case "encode":
        return nodeExecution(seenProgram({ model: saved })).step({ count: 0, seen: {} }, inc);
    }
  };

  law(
    "C7: generated failures of input holding sentinel keys and values leave none in the RPC reply",
    fc.record({
      steps: fc.array(fc.record({ call: fc.constantFrom(...calls), key: words, value: words }), {
        minLength: 1,
        maxLength: 4,
      }),
      decor: fc.constantFrom(' "quoted" ', " /path?x=1&y=2 ", "\n\t", " ü ", "@example.org"),
    }),
    ({ steps, decor }) =>
      Effect.gen(function* () {
        for (const { call, key, value } of steps) {
          const keyCore = `sntlk${key}`;
          const valueCore = `sntlv${value}`;
          const keyText = `${decor}${keyCore}${decor}`;
          const valueText = `${decor}${valueCore}${decor}`;
          const error = yield* Effect.flip<unknown, ProgramDown, never>(feed(call, { [keyText]: valueText }));
          expect(error).toBeInstanceOf(ProgramDown);
          const reply = JSON.stringify(executionFailure(error));

          for (const form of [keyCore, valueCore, ...forms(keyText), ...forms(valueText)]) {
            expect(reply.includes(form), "the RPC reply holds a cause's input-bearing text").toBe(false);
          }
        }
      }),
  );
});
