// P11, next/. Program is a declaration schema; stepper exposes init/step/fold from the plan.
// Imports are inside each law so an absent planned module reports every law, not zero tests.
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Predicate, Result, Schema, SchemaIssue } from "effect";
import * as fc from "fast-check";
import { ParentText } from "../coordination/index.ts";
import { ProgramLoader } from "./Entry.ts";
import { Declaration } from "./Execution.ts";
import { Input, Program, Refusal, stepper } from "./Program.ts";

const Model = Schema.Struct({ count: Schema.Int, replies: Schema.Int });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("throw") }),
]);

const save = Cmd.make("save", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Int,
  err: ["disk"],
});

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [save],
  init: (loaded) => [loaded ?? { count: 0, replies: 0 }, []],
  update: {
    add: (s, m) => [{ ...s, count: s.count + m.n }, [save({ n: m.n })]],
    throw: () => {
      throw new Error("planted reducer failure");
    },
    save_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
    save_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
  },
});

const authoring = () => ({
  name: "test-counter",
  machine,
  state: { v: 1, upgrades: [] },
  view: (s: Model) => ({ count: s.count }),
  refuse: (s: Model, m: typeof Msg.Type) =>
    m.type === "add" && s.count + m.n > 10 ? { reason: "limit", now: s.count, most: 10 } : null,
  inputs: {},
  outputs: {},
  writes: {},
  wake: () => null,
});

const spec = () => Program.make(authoring());
const SEED = 119120;
const parameters = { seed: SEED, numRuns: 100 };

type Policy = typeof import("./Runner.ts").Supervision.Type.policy;
// Bounded waits keep valid samples inside their period; corrupt commands push each numeric edge.

const policies = fc
  .record({
    maxDeliveries: fc.integer({ min: 1, max: 32 }),
    extra: fc.nat({ max: 8 }),
    wait: fc.integer({ min: 1, max: 100 }),
    period: fc.integer({ min: 10_000, max: 120_000 }),
  })
  .map(({ maxDeliveries, extra, wait, period }): Policy => ({
    maxDeliveries,
    intensity: maxDeliveries + extra,
    periodMs: period,
    backoff: { minMs: wait, maxMs: wait, resetAfterMs: period },
  }));

type PolicyModel = { valid: boolean; checked: boolean; policy: Policy | undefined };
type PolicyReal = { raw: Record<string, unknown>; checked: unknown; described: unknown | null; calls: string[] };

const policyCheck = (value: unknown, policy: Policy | undefined) => {
  const fields = Schema.decodeUnknownSync(Schema.Struct({ policy: Schema.optionalKey(Schema.Unknown) }))(value);
  expect(fields).toEqual(policy === undefined ? {} : { policy });
};

const corruptPolicy = (policy: Policy, field: number, n: number): unknown => {
  if (field < 18) {
    const key = ["maxDeliveries", "intensity", "periodMs", "minMs", "maxMs", "resetAfterMs"][Math.floor(field / 3)]!;
    const value = field % 3 === 0 ? 0 : field % 3 === 1 ? -n - 1 : n + 0.5;
    return field < 9 ? { ...policy, [key]: value } : { ...policy, backoff: { ...policy.backoff, [key]: value } };
  }

  switch (field) {
    case 18:
      return { ...policy, maxDeliveries: 33 + n };
    case 19:
      return { ...policy, intensity: policy.maxDeliveries - 1 };
    case 20:
      return { ...policy, backoff: { ...policy.backoff, minMs: policy.backoff.maxMs + 1 } };
    default:
      return { ...policy, periodMs: policy.intensity * policy.backoff.minMs - n };
  }
};

it("P1: policy survives authoring, decoding and Node description, while malformed declarations fail", () => {
  const commands = fc.commands<PolicyModel, PolicyReal>(
    [
      fc.option(policies, { nil: undefined }).map((policy): fc.Command<PolicyModel, PolicyReal> => ({
        check: () => true,
        run: (m, r) => {
          delete r.raw.policy;

          if (policy !== undefined) {
            r.raw.policy = policy;
          }

          m.policy = policy;
          m.valid = true;
          m.checked = false;
          r.described = null;
        },
        toString: () => `declare(${JSON.stringify(policy)})`,
      })),
      fc
        .tuple(fc.integer({ min: 0, max: 21 }), fc.nat({ max: 100 }))
        .map(([field, n]): fc.Command<PolicyModel, PolicyReal> => ({
          check: (m) => m.valid && m.policy !== undefined,
          run: (m, r) => {
            r.raw.policy = corruptPolicy(m.policy!, field, n);
            m.valid = false;
            m.checked = false;
            r.described = null;
          },
          toString: () => `corrupt(${field},${n})`,
        })),
      fc
        .constantFrom("make", "makeEffect", "decode", "describe")
        .map((action): fc.Command<PolicyModel, PolicyReal> => ({
          check: (m) => action === "make" || action === "makeEffect" || action === "decode" || m.checked,
          run: (m, r) => {
            if (action === "make") {
              const construct = () => Reflect.apply(Program.make, Program, [r.raw]);

              if (!m.valid) {
                expect(construct).toThrow();
              } else {
                r.checked = construct();
                policyCheck(r.checked, m.policy);
                m.checked = true;
              }
            } else if (action === "makeEffect") {
              const result = Effect.runSync(Effect.result(Reflect.apply(Program.makeEffect, Program, [r.raw])));
              expect(Result.isSuccess(result)).toBe(m.valid);

              if (Result.isSuccess(result)) {
                r.checked = result.success;
                policyCheck(r.checked, m.policy);
                m.checked = true;
              } else {
                expect(SchemaIssue.isIssue(result.failure)).toBe(true);
              }
            } else if (action === "decode") {
              const raw = {
                ...spec(),
                machine: r.raw.machine,
                ...(Object.hasOwn(r.raw, "policy") ? { policy: r.raw.policy } : {}),
              };
              const decoded = Schema.decodeUnknownResult(Program.schema)(m.checked ? r.checked : raw);
              expect(Result.isSuccess(decoded)).toBe(m.valid);

              if (Result.isSuccess(decoded)) {
                r.checked = decoded.success;
                policyCheck(r.checked, m.policy);
                m.checked = true;
              }

              if (r.described !== null) {
                policyCheck(Schema.decodeUnknownSync(Declaration)(r.described), m.policy);
              }
            } else {
              const described = Effect.runSync(
                ProgramLoader.use((loader) => loader.load("test")).pipe(
                  Effect.provide(ProgramLoader.layer({ test: r.checked }, {})),
                ),
              ).declaration;
              policyCheck(described, m.policy);
              policyCheck(Schema.decodeUnknownSync(Declaration)(described), m.policy);
              r.described = described;
            }

            expect(r.calls).toEqual([]);
          },
          toString: () => action,
        })),
    ],
    { maxCommands: 80, size: "max" },
  );
  fc.assert(
    fc.property(commands, (moves) => {
      const calls: string[] = [];
      const fields = authoring();
      const raw = {
        ...fields,
        machine: Machine.make({
          ...machine,
          init: () => {
            calls.push("init");
            return [{ count: 0, replies: 0 }, []];
          },
        }),
      };
      fc.modelRun(
        () => ({
          model: { valid: true, checked: false, policy: undefined },
          real: { raw, checked: null, described: null, calls },
        }),
        moves,
      );
    }),
    parameters,
  );
});

const model = fc.record({ count: fc.integer(), replies: fc.nat() });

const declarations = fc
  .record({
    name: fc.string({ minLength: 1 }),
    v: fc.integer({ min: 1 }),
    initial: model,
    description: fc.string(),
    personDescription: fc.string(),
    query: fc.integer(),
  })
  .map(({ name, v, initial, ...data }) => {
    const modelSchema = Schema.Struct(Model.fields);
    const msgSchema = Schema.Union(Msg.members);
    return {
      ...data,
      initial,
      modelSchema,
      msgSchema,
      fields: {
        ...authoring(),
        name,
        state: { v, upgrades: [] },
        machine: Machine.make({
          ...machine,
          cmds: [save],
          model: modelSchema,
          msg: msgSchema,
          init: (loaded) => [loaded ?? initial, []],
        }),
      },
    };
  });

// Other laws use the loader so they do not choose stepper's Effect or Result API.
const load = (raw: unknown) =>
  Effect.runSync(
    Effect.gen(function* () {
      return (yield* (yield* ProgramLoader).load("test")).stepper;
    }).pipe(Effect.provide(ProgramLoader.layer({ test: raw }, {}))),
  );

describe("Program.make authoring laws, next/", () => {
  it("fills the load declaration from the machine without copying or wrapping it", () => {
    fc.assert(
      fc.property(declarations, ({ fields, initial, modelSchema, msgSchema, description, personDescription }) => {
        const p = Program.make({
          ...fields,
          inputs: { add: description, throw: { description: personDescription, personOnly: true } },
        });
        expect(p.machine).toBe(fields.machine);
        expect(fields.machine.model).toBe(modelSchema);
        expect(fields.machine.msg).toBe(msgSchema);
        expect(p.state.schema).toBe(fields.machine.model);
        expect(p.msg).toBe(fields.machine.msg);
        expect(p.view.data).toBe(Schema.Json);
        expect(p.inputs.add).toMatchObject({ _tag: "write", description, personOnly: false });
        expect(p.inputs.throw).toMatchObject({
          _tag: "write",
          description: personDescription,
          personOnly: true,
        });
        expect(p.inputs.add.schema).toBe(fields.machine.msg);
        expect(p.inputs.throw.schema).toBe(fields.machine.msg);
        expect(Result.isSuccess(Schema.decodeUnknownResult(Program.schema)(p))).toBe(true);
        expect(load(p).init(null)).toMatchObject({ model: initial, view: { count: initial.count } });
      }),
      parameters,
    );
  });
  it("checks the declaration without calling program code or running a Cmd", () => {
    fc.assert(
      fc.property(declarations, ({ fields, description, query }) => {
        const calls: string[] = [];
        const never = (name: string): never => {
          calls.push(name);
          throw new Error(name);
        };
        const untouched = Machine.make({
          model: fields.machine.model,
          msg: fields.machine.msg,
          cmds: [save],
          init: () => never("init"),
          update: {
            add: () => never("update"),
            throw: () => never("update"),
            save_ok: () => never("update"),
            save_err: () => never("update"),
          },
        });
        const p = Program.make({
          ...fields,
          machine: untouched,
          view: () => never("view"),
          refuse: () => never("refuse"),
          wake: () => never("wake"),
          inputs: {
            read: Input.cases.read.make({
              schema: Schema.Struct({ offset: Schema.Int }),
              description,
              answer: () => never("answer"),
            }),
          },
        });
        expect(p.machine).toBe(untouched);
        expect(calls).toEqual([]);
        expect(p.inputs.read._tag).toBe("read");
        expect(p.inputs.read.description).toBe(description);
        expect(Schema.decodeUnknownSync(p.inputs.read.schema)({ offset: query })).toEqual({
          offset: query,
        });
      }),
      parameters,
    );
  });

  for (const [label, broken] of [
    ["empty name", fc.constant({ name: "" })],
    ["missing machine", fc.jsonValue().map((machine) => ({ machine }))],
    ["invalid version", fc.integer({ max: 0 }).map((v) => ({ state: { v, upgrades: [] } }))],
    ["non-function view", fc.jsonValue().map((view) => ({ view }))],
    ["non-function refusal", fc.jsonValue().map((refuse) => ({ refuse }))],
    ["non-schema output", fc.jsonValue().map((rows) => ({ outputs: { rows } }))],
  ] as const) {
    it(`throws for ${label}, while makeEffect reports a bare schema issue without a defect`, () => {
      fc.assert(
        fc.property(declarations, broken, ({ fields }, change) => {
          // Deliberately untrusted JavaScript reaches the same constructors without a cast.
          const raw: unknown = { ...fields, ...change };
          const make = Reflect.get(Program, "make");
          const makeEffect = Reflect.get(Program, "makeEffect");
          expect(() => Reflect.apply(make, Program, [raw])).toThrow();
          let checked: Effect.Effect<unknown, unknown> = Effect.void;
          expect(() => {
            checked = Reflect.apply(makeEffect, Program, [raw]);
          }).not.toThrow();
          const exit = Effect.runSyncExit(Effect.result(checked));
          expect(Exit.isSuccess(exit)).toBe(true);

          if (!Exit.isSuccess(exit)) {
            return;
          }

          expect(Result.isFailure(exit.value)).toBe(true);

          if (Result.isFailure(exit.value)) {
            expect(
              SchemaIssue.isIssue(exit.value.failure),
              "makeEffect must fail with the bare SchemaIssue.Issue",
            ).toBe(true);
          }
        }),
        parameters,
      );
    });
  }

  it("makeEffect also constructs and loads a valid program", () => {
    fc.assert(
      fc.property(declarations, ({ fields, initial }) => {
        const p = Effect.runSync(Program.makeEffect(fields));
        expect(p.machine).toBe(fields.machine);
        expect(load(p).init(null)).toMatchObject({ _tag: "stepped", model: initial });
      }),
      parameters,
    );
  });

  for (const [label, change] of [
    ["initial view", fc.integer().map((n) => ({ view: () => () => n }))],
    ["initial wake", fc.string().map((text) => ({ wake: () => text }))],
  ] as const) {
    it(`defers a broken ${label} to checked initialization`, () => {
      fc.assert(
        fc.property(declarations, change, ({ fields }, broken) => {
          const raw: unknown = { ...fields, ...broken };
          const p = Reflect.apply(Program.make, Program, [raw]);
          expect(() => load(p).init(null)).toThrowError(expect.objectContaining({ reason: "load" }));
        }),
        parameters,
      );
    });
  }

  it("rejects a model that encodes to a non-JSON value", () => {
    fc.assert(
      fc.property(declarations, fc.integer(), ({ fields, initial }, n) => {
        const NonJson = Schema.Struct({ count: Schema.Int, body: Schema.Unknown });
        const nonJson = Machine.make({
          model: NonJson,
          msg: Msg,
          cmds: [],
          init: () => [{ count: initial.count, body: () => n }, []],
          update: { add: (s) => [s, []], throw: (s) => [s, []] },
        });
        const p = Program.make({
          ...fields,
          machine: nonJson,
          view: (s) => ({ count: s.count }),
          refuse: () => null,
        });
        expect(() => load(p).init(null)).toThrowError(expect.objectContaining({ reason: "load" }));
      }),
      parameters,
    );
  });
  it("stepper returns a typed load failure for broken unknown declarations without throwing", () => {
    const missing = fc.constantFrom(
      "name",
      "machine",
      "state",
      "msg",
      "view",
      "refuse",
      "inputs",
      "outputs",
      "writes",
      "wake",
    );
    const malformed = fc
      .option(
        fc.oneof(
          fc.tuple(declarations, missing).map(([{ fields }, field]) => {
            const raw: Record<string, unknown> = { ...Program.make(fields) };
            delete raw[field];
            return raw;
          }),
          fc
            .tuple(declarations, fc.jsonValue(), fc.constantFrom("msg", "state", "view", "outputs"))
            .map(([{ fields }, bad, field]) => {
              const p = Program.make(fields);
              return {
                ...p,
                ...(field === "state"
                  ? { state: { ...p.state, schema: bad } }
                  : field === "view"
                    ? { view: { ...p.view, data: bad } }
                    : field === "outputs"
                      ? { outputs: { rows: bad } }
                      : { msg: bad }),
              };
            }),
          fc
            .tuple(declarations, fc.jsonValue(), fc.constantFrom("refuse", "wake", "view", "init"))
            .map(([{ fields }, bad, field]) => {
              const p = Program.make(fields);
              return {
                ...p,
                ...(field === "init"
                  ? { machine: { ...p.machine, init: bad } }
                  : field === "view"
                    ? { view: { ...p.view, select: bad } }
                    : { [field]: bad }),
              };
            }),
        ),
        { nil: null },
      )
      .map((raw) => ({ bug: "generated broken declaration", raw }));
    fc.assert(
      fc.property(malformed, ({ raw }) => {
        // Expect Result<Stepper, SchemaError> or Effect<Stepper, SchemaIssue.Issue>.
        // ProgramDown belongs to ProgramLoader; this failure keeps Schema's details.
        let checked: unknown;
        expect(() => {
          checked = stepper(raw);
        }).not.toThrow();
        const isLoadEffect = (u: unknown): u is Effect.Effect<unknown, unknown> => Effect.isEffect(u);
        let result: Result.Result<unknown, unknown>;

        if (Result.isResult(checked)) {
          result = checked;
        } else {
          expect(isLoadEffect(checked)).toBe(true);

          if (!isLoadEffect(checked)) {
            return;
          }

          const exit = Effect.runSyncExit(Effect.result(checked));
          expect(Exit.isSuccess(exit)).toBe(true);

          if (!Exit.isSuccess(exit)) {
            return;
          }

          result = exit.value;
        }

        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(Schema.isSchemaError(result.failure) || SchemaIssue.isIssue(result.failure)).toBe(true);
        }
      }),
      {
        ...parameters,
        examples: [[{ bug: "null module threw ProgramDown instead of a typed failure", raw: null }]],
      },
    );
  });
});

describe("P11 program contract and p22 refusal", () => {
  for (const field of ["state", "msg", "view", "refuse", "inputs", "outputs", "writes", "wake"]) {
    it(`plant, omit ${field}: incomplete declarations are refused`, async () => {
      const { Program } = await import("./Program.ts");
      const raw: Record<string, unknown> = { ...spec() };
      delete raw[field];
      expect(() => Schema.decodeUnknownSync(Program.schema)(raw)).toThrow();
    });
  }

  it("plant, skip declaration checks: schemas and functions are checked, not mere presence", async () => {
    const { Program } = await import("./Program.ts");

    for (const broken of [
      { machine: { ...machine, update: 3 } },
      { state: { v: 0, schema: Model, upgrades: [] } },
      { state: { v: 1, schema: {}, upgrades: [] } },
      { msg: {} },
      { view: { data: Model, select: 3 } },
      { refuse: 3 },
      { wake: "later" },
      { outputs: { rows: {} } },
      { writes: { saved: { schema: {}, personOnly: false } } },
    ]) {
      expect(() => Schema.decodeUnknownSync(Program.schema)({ ...spec(), ...broken })).toThrow();
    }
  });
  it.effect.prop(
    "plant, let settled bypass program.msg: only fold accepts checked Cmd replies",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [3, generated],
        (value) =>
          Effect.promise(async () => {
            const p = load(spec());
            const before = { count: 2, replies: 0 };
            const ok = { type: "save_ok", cmd: save({ n: value }), value, at: 42 };
            const err = { type: "save_err", cmd: save({ n: value }), error: { _tag: "disk" }, at: 42 };

            for (const reply of [ok, err]) {
              expect(p.fold(before, reply)).toMatchObject({
                _tag: "stepped",
                model: { count: 2, replies: 1 },
              });
              expect(p.step(before, reply)).toEqual({ _tag: "refused", reason: "bad_msg" });
            }

            for (const reply of [
              { ...ok, cmd: { type: "other", n: value } },
              { ...ok, at: "42" },
              { ...ok, value: "3" },
              { ...err, error: { _tag: 3 } },
            ]) {
              expect(p.step(before, reply)).toEqual({ _tag: "refused", reason: "bad_msg" });
              expect(() => p.fold(before, reply)).toThrowError(
                expect.objectContaining({ _tag: "ProgramDown", reason: "saved_letter" }),
              );
            }
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "a Cmd with an async result schema cannot settle before validation finishes",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) =>
          Effect.promise(async () => {
            const asyncSave = {
              ...save,
              schema: {
                ...save.schema,
                ok: { "~standard": { validate: (value: unknown) => Promise.resolve({ value }) } },
              },
            };
            const broken: unknown = { ...spec(), machine: { ...machine, cmds: [asyncSave] } };
            const p = load(broken);
            expect(
              p.step({ count: 0, replies: 0 }, { type: "save_ok", cmd: save({ n: value }), value, at: 42 }),
            ).toEqual({ _tag: "refused", reason: "bad_msg" });
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "a saved-state failure conforms to its error schema",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["bad", generated],
        (value) =>
          Effect.promise(async () => {
            const { ProgramDown } = await import("./Program.ts");
            let error: unknown;

            try {
              load(spec()).init({ count: value, replies: 0 });
            } catch (thrown) {
              error = thrown;
            }

            expect(error).toMatchObject({ _tag: "ProgramDown", reason: "saved_state" });
            expect(Schema.is(ProgramDown)(error)).toBe(true);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it("plant, reject every declaration: a complete pure tea program loads and steps", async () => {
    const { Program } = await import("./Program.ts");
    const p = load(Schema.decodeUnknownSync(Program.schema)(spec()));
    expect(p.init(null)).toMatchObject({
      _tag: "stepped",
      model: { count: 0, replies: 0 },
      view: { count: 0 },
      cmds: [],
      wake: null,
    });
    expect(p.step({ count: 2, replies: 0 }, { type: "add", n: 3 })).toMatchObject({
      _tag: "stepped",
      model: { count: 5, replies: 0 },
      view: { count: 5 },
      cmds: [save({ n: 3 })],
    });
  });
  it.effect.prop(
    "plant, collapse refusals: bad_msg differs from the program's limit fields",
    { generated: Refusal },
    ({ generated }) =>
      Effect.forEach(
        [{ reason: "" }, { reason: "limit", now: 7, most: 10 }, generated],
        (refusal) =>
          Effect.promise(async () => {
            const p = load(spec());
            const before = { count: 7, replies: 0 };
            expect(p.step(before, { type: "add", n: "3" })).toEqual({
              _tag: "refused",
              reason: "bad_msg",
            });
            expect(p.step(before, { type: "add", n: 4 })).toEqual({
              _tag: "refused",
              reason: "limit",
              now: 7,
              most: 10,
            });
            expect(before).toEqual({ count: 7, replies: 0 });

            // Review 2: an empty reason is legal and must survive the real stepper too.
            const checked = load({ ...spec(), refuse: () => refusal });
            expect(checked.step(before, { type: "add", n: 4 })).toEqual({
              _tag: "refused",
              ...refusal,
            });
            expect(before).toEqual({ count: 7, replies: 0 });
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it("plant, run refusal during replay: fold applies a once-accepted letter despite today's limit", async () => {
    const p = load(spec());
    expect(p.fold({ count: 9, replies: 0 }, { type: "add", n: 4 })).toMatchObject({
      _tag: "stepped",
      model: { count: 13, replies: 0 },
      cmds: [save({ n: 4 })],
    });
  });
  it.effect.prop(
    "p25 plant, turn a thrown step into a refusal: ProgramDown retains its failure class",
    { generated: Model },
    ({ generated }) =>
      Effect.forEach(
        [{ count: 0, replies: 0 }, generated],
        (value) =>
          Effect.promise(async () => {
            expect(() => load(spec()).step(value, { type: "throw" })).toThrowError(
              expect.objectContaining({ _tag: "ProgramDown", reason: "step" }),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const part of ["model", "view", "cmd"] as const) {
    it.effect.prop(
      `p25 plant, trust the returned ${part}: a malformed pure result is ProgramDown`,
      { generated: Model.check(Schema.makeFilter((model) => model.count < 10)) },
      ({ generated }) =>
        Effect.forEach(
          [{ count: 0, replies: 0 }, generated],
          (value) =>
            Effect.promise(async () => {
              const broken: unknown = {
                ...spec(),
                machine: {
                  ...machine,
                  update: {
                    ...machine.update,
                    add: () =>
                      part === "model"
                        ? [{ count: "bad", replies: 0 }, []]
                        : [{ count: 1, replies: 0 }, part === "cmd" ? [{ type: "save", n: "bad" }] : []],
                  },
                },
                view: part === "view" ? { data: Model, select: () => ({ count: "bad" }) } : spec().view,
              };
              expect(() => load(broken).step(value, { type: "add", n: 1 })).toThrowError(
                expect.objectContaining({ _tag: "ProgramDown", reason: "step" }),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "plant, treat a saved poison letter as fresh bad_msg: folding fails closed",
    { generated: Schema.NullOr(Schema.String) },
    ({ generated }) =>
      Effect.forEach(
        [null, generated],
        (value) =>
          Effect.promise(async () => {
            expect(() => load(spec()).fold({ count: 0, replies: 0 }, { type: "add", n: value })).toThrowError(
              expect.objectContaining({ _tag: "ProgramDown", reason: "saved_letter" }),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it("plant, give read ports write fields: read and write declarations are exclusive", async () => {
    const { Input } = await import("./Program.ts");
    const decode = Schema.decodeUnknownSync(Input);
    expect(
      decode({
        _tag: "read",
        schema: Schema.Null,
        description: "Read count",
        answer: (v: unknown) => v,
      }),
    ).toMatchObject({ _tag: "read" });
    expect(decode({ _tag: "write", schema: Msg, description: "Add", personOnly: false })).toMatchObject({
      _tag: "write",
      personOnly: false,
    });
    expect(() => decode({ _tag: "read", schema: Msg, description: "bad", personOnly: true })).toThrow();
    expect(() =>
      decode({
        _tag: "write",
        schema: Msg,
        description: "bad",
        personOnly: false,
        answer: () => null,
      }),
    ).toThrow();
  });
  it.effect.prop(
    "plant, synthesize a parent: Write requires caused.parent or explicit own",
    { generated: Schema.String.check(Schema.makeFilter((s) => !Schema.is(ParentText)(s))) },
    ({ generated }) =>
      Effect.forEach(
        ["forged", generated],
        (value) =>
          Effect.promise(async () => {
            const { Write } = await import("./Program.ts");
            const decode = Schema.decodeUnknownSync(Write);
            expect(decode({ _tag: "own", event: { _tag: "polled", changed: false } })).toMatchObject({
              _tag: "own",
            });
            expect(() => decode({ _tag: "caused", event: { _tag: "saved" } })).toThrow();
            expect(() => decode({ _tag: "caused", parent: value, event: { _tag: "saved" } })).toThrow();
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P34 a program sets its own maxDeliveries, next/", () => {
  // The declaration takes an optional limit, an integer 1 to 32. The default (3) is the wiring's.
  const withLimit = (fields: object, maxDeliveries: unknown): unknown => ({
    ...fields,
    maxDeliveries,
  });
  const refused = (raw: unknown) => {
    const make = Reflect.get(Program, "make");
    const makeEffect = Reflect.get(Program, "makeEffect");
    expect(() => Reflect.apply(make, Program, [raw])).toThrow();
    const exit = Effect.runSyncExit(Effect.result(Reflect.apply(makeEffect, Program, [raw])));
    expect(Exit.isSuccess(exit) && Result.isFailure(exit.value)).toBe(true);
  };

  it("p80 plant, drop or invent the program's limit: a generated limit 1 to 32 survives make, decode and load, and none stays none", () => {
    fc.assert(
      fc.property(declarations, fc.option(fc.integer({ min: 1, max: 32 }), { nil: undefined }), ({ fields }, limit) => {
        const raw = limit === undefined ? fields : withLimit(fields, limit);
        const own = (u: unknown) =>
          typeof u === "object" && u !== null && Object.hasOwn(u, "maxDeliveries")
            ? Reflect.get(u, "maxDeliveries")
            : undefined;
        const p: unknown = Reflect.apply(Reflect.get(Program, "make"), Program, [raw]);
        expect(own(p)).toBe(limit);
        const decoded = Schema.decodeUnknownResult(Program.schema)(p);
        expect(Result.isSuccess(decoded)).toBe(true);

        if (Result.isSuccess(decoded)) {
          expect(own(decoded.success)).toBe(limit);
        }

        expect(own(load(p).program)).toBe(limit);
        const effect: unknown = Effect.runSync(Reflect.apply(Reflect.get(Program, "makeEffect"), Program, [raw]));
        expect(own(effect)).toBe(limit);
      }),
      { ...parameters, examples: [[fc.sample(declarations, { seed: SEED, numRuns: 1 })[0]!, 7]] },
    );
  });

  it("p80 plant, accept any limit: 0, 33, 1.5 and every generated value outside 1 to 32 fail to decode", () => {
    fc.assert(
      fc.property(
        declarations,
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.integer({ min: 33 }),
          fc.double({ min: 1, max: 32, noNaN: true }).filter((n) => !Number.isInteger(n)),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, "3", null),
        ),
        ({ fields }, limit) => {
          refused(withLimit(fields, limit));
          const checked = withLimit(Program.make(fields), limit);
          expect(Result.isFailure(Schema.decodeUnknownResult(Program.schema)(checked))).toBe(true);
          expect(Result.isFailure(stepper(checked))).toBe(true);
        },
      ),
      {
        ...parameters,
        // The amendment's three named values.
        examples: [
          [fc.sample(declarations, { seed: SEED, numRuns: 1 })[0]!, 0],
          [fc.sample(declarations, { seed: SEED, numRuns: 1 })[0]!, 33],
          [fc.sample(declarations, { seed: SEED, numRuns: 1 })[0]!, 1.5],
        ],
      },
    );
  });
});

// T737 D4 to D6, next/. Program's guards read their input with Predicate now. Independent copies of
// the checks before that change are the oracles: same acceptance, and the machine and a saved Msg
// keep their identity, since a Struct projection would strip their fields.
const oldIsSteps = (u: unknown) =>
  typeof u === "object" &&
  u !== null &&
  "update" in u &&
  typeof u.update === "object" &&
  u.update !== null &&
  "init" in u &&
  typeof u.init === "function";

const oldTyped = (u: unknown): u is { readonly type: string } =>
  typeof u === "object" && u !== null && "type" in u && typeof u.type === "string";

const oldCode = (u: unknown) => typeof u === "function";

/** A made program's `machine`. A value Reflect.get cannot read fails the law, as its throw did. */
const madeMachine = (made: unknown): unknown => {
  expect(Predicate.isObjectKeyword(made)).toBe(true);
  return Predicate.isObjectKeyword(made) ? Reflect.get(made, "machine") : undefined;
};

class Shaped {
  readonly extra = 1;
}

/** Callable kinds and things that only look like one. */
const callables = {
  arrow: () => () => 0,
  function: () =>
    function named() {
      return 0;
    },
  async: () => async () => 0,
  generator: () =>
    function* gen() {
      yield 0;
    },
  class: () => class Callable {},
  bound: () => ((a: number) => a).bind(null, 1),
  proxy: () => new Proxy(() => 0, {}),
  object: () => ({ call: () => 0 }),
  prototype: () => Object.create(Function.prototype),
  null: () => null,
  undefined: () => undefined,
  string: () => "() => 0",
  number: () => 0,
  array: () => [() => 0],
} as const;

const Callable = fc.constantFrom(...(Object.keys(callables) as Array<keyof typeof callables>));

/** Where a machine's fields live and what they hold. */
const MachineRecipe = fc.record({
  container: fc.constantFrom("plain", "plain", "inherited", "array", "instance", "function", "null", "string"),
  update: fc.constantFrom("table", "table", "array", "null", "function", "string", "missing", "inherited"),
  init: Callable,
  cmds: fc.constantFrom("given", "missing", "garbage", "number"),
  schemas: fc.constantFrom("own", "own", "inherited", "missing", "bad"),
  extra: fc.option(fc.dictionary(fc.string({ maxLength: 4 }), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 }), {
    nil: undefined,
  }),
});
type MachineRecipe = typeof MachineRecipe extends fc.Arbitrary<infer A> ? A : never;

const built = (r: MachineRecipe, base: typeof machine): unknown => {
  const own: Record<string, unknown> = { ...r.extra };
  const inherited: Record<string, unknown> = {};
  const table = { ...base.update };

  if (r.update === "inherited") {
    inherited.update = table;
  } else if (r.update !== "missing") {
    own.update =
      r.update === "table"
        ? table
        : r.update === "array"
          ? Object.assign([], table)
          : r.update === "null"
            ? null
            : r.update === "function"
              ? Object.assign(() => 0, table)
              : "update";
  }

  own.init = callables[r.init]();

  if (r.cmds !== "missing") {
    own.cmds = r.cmds === "given" ? [save] : r.cmds === "garbage" ? "cmds" : 3;
  }

  if (r.schemas !== "missing") {
    const target = r.schemas === "inherited" ? inherited : own;
    target.model = r.schemas === "bad" ? {} : base.model;
    target.msg = r.schemas === "bad" ? {} : base.msg;
  }

  switch (r.container) {
    case "plain":
      return Object.assign(Object.create(inherited), own);
    case "inherited":
      return Object.create(Object.assign({}, inherited, own));
    case "array":
      return Object.assign(Object.setPrototypeOf([], Object.assign(Object.create(Array.prototype), inherited)), own);
    case "instance":
      return Object.assign(
        Object.setPrototypeOf(new Shaped(), Object.assign(Object.create(Shaped.prototype), inherited)),
        own,
      );
    case "function":
      return Object.assign(() => 0, inherited, own);
    case "null":
      return null;
    case "string":
      return "machine";
  }
};

const Callables = fc.record({
  select: Callable,
  refuse: Callable,
  wake: Callable,
  run: fc.option(Callable, { nil: undefined }),
});

describe("T737 Program guards keep acceptance and identity, next/", () => {
  it("D4: declarations and authored programs accept the same machines and callables, and keep the machine", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(declarations, MachineRecipe, Callables, ({ fields }, recipe, fns) => {
        const m = built(recipe, fields.machine);
        const p = Program.make(fields);
        const upgrades = fns.run === undefined ? [] : [{ name: "up", from: 1, run: callables[fns.run]() }];
        const raw: unknown = {
          ...p,
          machine: m,
          state: { ...p.state, upgrades },
          view: { ...p.view, select: callables[fns.select]() },
          refuse: callables[fns.refuse](),
          wake: callables[fns.wake](),
        };
        const codeOk =
          oldCode(callables[fns.select]()) &&
          oldCode(callables[fns.refuse]()) &&
          oldCode(callables[fns.wake]()) &&
          upgrades.every((u) => oldCode(u.run));
        const ok = oldIsSteps(m) && codeOk;
        const decoded = Schema.decodeUnknownResult(Program.schema)(raw);
        expect(Result.isSuccess(decoded)).toBe(ok);

        if (Result.isSuccess(decoded)) {
          expect(decoded.success.machine).toBe(m);
        }

        // tea may throw on a machine whose cmds it cannot read; only an accepted one gets that far.
        const loaded = Result.try({ try: () => stepper(raw), catch: () => "thrown" as const });

        if (Result.isSuccess(loaded)) {
          expect(Result.isSuccess(loaded.success)).toBe(ok);

          if (Result.isSuccess(loaded.success)) {
            expect(loaded.success.success.program.machine).toBe(m);
          }
        } else {
          expect(ok).toBe(true);
        }

        // Authoring also needs the machine's model and Msg schemas, own or inherited.
        const authored = {
          ...fields,
          machine: m,
          state: { v: fields.state.v, upgrades },
          view: callables[fns.select](),
          refuse: callables[fns.refuse](),
          wake: callables[fns.wake](),
        };
        const schemasOk =
          typeof m === "object" &&
          m !== null &&
          "model" in m &&
          Schema.isSchema(m.model) &&
          "msg" in m &&
          Schema.isSchema(m.msg);
        const made = Effect.runSyncExit(Reflect.apply(Program.makeEffect, Program, [authored]));
        expect(Exit.isSuccess(made)).toBe(ok && schemasOk);

        if (Exit.isSuccess(made)) {
          expect(madeMachine(made.value)).toBe(m);
        }

        seen.add(`${ok}:${recipe.container}:${recipe.update}`);
        seen.add(`init:${recipe.init}:${oldCode(callables[recipe.init]())}`);
        seen.add(`cmds:${recipe.cmds}:${ok}`);
      }),
      { seed: SEED, numRuns: 1_000 },
    );

    for (const side of [
      "true:plain:table",
      "true:array:table",
      "true:plain:array",
      "true:inherited:table",
      "true:instance:table",
      "true:plain:inherited",
      "false:function:table",
      "false:plain:function",
      "false:plain:null",
      "false:plain:missing",
      "cmds:missing:true",
      "cmds:garbage:true",
      "init:class:true",
      "init:prototype:false",
    ]) {
      expect(seen, side).toContain(side);
    }
  });

  it("D4: a getter- or proxy-backed machine sees the same reads, in order, and the same answer as the old guard", () => {
    const Read = fc.constantFrom("table", "table", "array", "null", "function", "string", "throw");
    const Field = fc.record({ present: fc.boolean(), reads: fc.array(Read, { minLength: 1, maxLength: 3 }) });
    const Backed = fc.record({
      kind: fc.constantFrom("proxy", "proxy", "getters"),
      target: fc.constantFrom("object", "object", "array", "function"),
      update: Field,
      init: Field,
      throwOnHas: fc.option(fc.constantFrom("update", "init"), { nil: undefined }),
    });
    type Backed = typeof Backed extends fc.Arbitrary<infer A> ? A : never;
    type Field = Backed["update"];

    const value = (read: string): unknown => {
      switch (read) {
        case "table":
          return {};
        case "array":
          return [];
        case "null":
          return null;
        case "function":
          return () => 0;
        case "string":
          return "update";
        default:
          throw new Error("read");
      }
    };

    /** A machine whose field reads are logged, and whose nth read of a field gives that field's nth value. */
    const backed = (b: Backed, trace: Array<string>): unknown => {
      const count = new Map<string, number>();
      const fields: Record<string, Field> = { update: b.update, init: b.init };
      const next = (key: string) => {
        const field = fields[key]!;
        const n = count.get(key) ?? 0;
        count.set(key, n + 1);
        const read = field.reads[Math.min(n, field.reads.length - 1)]!;
        // An init that reads as a table or array is given a callable instead, so init varies too.
        return key === "init" && read === "table" ? () => 0 : value(read);
      };
      const target: object = b.target === "array" ? [] : b.target === "function" ? () => 0 : {};

      if (b.kind === "getters") {
        for (const key of Object.keys(fields).filter((k) => fields[k]!.present)) {
          Object.defineProperty(target, key, {
            get: () => {
              trace.push(`get:${key}`);
              return next(key);
            },
          });
        }

        return target;
      }

      return new Proxy(target, {
        has: (t, key) => {
          trace.push(`has:${String(key)}`);

          if (key === b.throwOnHas) {
            throw new Error("has");
          }

          return typeof key === "string" && key in fields ? fields[key]!.present : Reflect.has(t, key);
        },
        get: (t, key, receiver) => {
          trace.push(`get:${String(key)}`);
          return typeof key === "string" && key in fields ? next(key) : Reflect.get(t, key, receiver);
        },
      });
    };

    const outcome = (run: () => Result.Result<unknown, unknown>) => {
      const ran = Result.try({ try: run, catch: () => "thrown" as const });
      return Result.isFailure(ran) ? "thrown" : Result.isSuccess(ran.success) ? "accepted" : "refused";
    };

    const oldMachine = Schema.declare((u: unknown): u is unknown => oldIsSteps(u), { expected: "a tea machine" });
    const seen = new Set<string>();
    fc.assert(
      fc.property(declarations, Backed, ({ fields }, b) => {
        const before: Array<string> = [];
        const old = outcome(() => Schema.decodeUnknownResult(oldMachine)(backed(b, before)));
        const after: Array<string> = [];
        const p = Program.make(fields);
        const now = outcome(() => Schema.decodeUnknownResult(Program.schema)({ ...p, machine: backed(b, after) }));
        expect(after).toEqual(before);
        expect(now).toBe(old);
        seen.add(old);
      }),
      {
        ...parameters,
        numRuns: 1_000,
        examples: [
          // pinned: review of T737 round 3. The first rewrite read update once, so an update that reads
          // as a table and then null passed where the old guard refused it.
          [
            fc.sample(declarations, { seed: SEED, numRuns: 1 })[0]!,
            {
              kind: "proxy",
              target: "object",
              update: { present: true, reads: ["table", "null"] },
              init: { present: true, reads: ["function"] },
              throwOnHas: undefined,
            },
          ],
        ],
      },
    );
    expect([...seen].sort()).toEqual(["accepted", "refused", "thrown"]);
  });

  it("D5: an authored program keeps the machine it was given, and refuses an equal-shaped replacement read later", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(declarations, fc.integer({ min: 1, max: 3 }), fc.boolean(), ({ fields }, cycle, effect) => {
        // The first read gives the authored machine; later reads cycle through equal-shaped copies.
        const copies = [fields.machine, { ...fields.machine }, { ...fields.machine }].slice(0, cycle);
        let reads = 0;
        const spec: Record<string, unknown> = { ...fields };
        Object.defineProperty(spec, "machine", { enumerable: true, get: () => copies[reads++ % cycle] });
        const made = effect
          ? Effect.runSyncExit(Reflect.apply(Program.makeEffect, Program, [spec]))
          : Result.try({ try: (): unknown => Reflect.apply(Program.make, Program, [spec]), catch: () => null });
        const value = Exit.isExit(made)
          ? Exit.isSuccess(made)
            ? made.value
            : undefined
          : Result.isSuccess(made)
            ? made.success
            : undefined;
        expect(value !== undefined).toBe(cycle === 1);

        if (value !== undefined) {
          expect(madeMachine(value)).toBe(fields.machine);
        }

        seen.add(`${cycle}:${effect}`);
      }),
      parameters,
    );
    expect(seen.size).toBe(6);
  });

  const oldSettled = (msg: unknown): boolean | undefined => {
    if (!oldTyped(msg) || (msg.type !== "save_ok" && msg.type !== "save_err")) {
      return undefined;
    }

    const cmd = "cmd" in msg ? msg.cmd : undefined;

    if (!(oldTyped(cmd) && cmd.type === "save") || !("at" in msg) || typeof msg.at !== "number") {
      return false;
    }

    if (msg.type === "save_ok") {
      return "value" in msg && Schema.is(Schema.Int)(msg.value);
    }

    const error = "error" in msg ? msg.error : undefined;
    return typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string";
  };

  const Answer = fc.record({
    container: fc.constantFrom("plain", "plain", "plain", "array", "instance", "inherited", "function"),
    type: fc.constantFrom("save_ok", "save_ok", "save_err", "save_err", "", "other", 7, "missing"),
    cmd: fc.constantFrom("pending", "pending", "pending", "other", "missing", "untyped", "array"),
    at: fc.constantFrom<unknown>(
      42,
      42,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "42",
      "missing",
      "inherited",
    ),
    value: fc.constantFrom<unknown>(3, 3, -1, "3", 1.5, "missing", "inherited"),
    error: fc.constantFrom("tag", "tag", "empty", "number", "array", "function", "null", "inherited", "missing"),
    extra: fc.option(fc.string({ maxLength: 3 }), { nil: undefined }),
    saved: fc.boolean(),
  });
  type Answer = typeof Answer extends fc.Arbitrary<infer A> ? A : never;

  /** One generated answer to a Cmd the walk saw the machine return. */
  const answer = (a: Answer, pending: unknown): unknown => {
    const own: Record<string, unknown> = a.extra === undefined ? {} : { extra: a.extra };
    const inherited: Record<string, unknown> = {};

    if (a.type !== "missing") {
      own.type = a.type;
    }

    if (a.cmd !== "missing") {
      own.cmd =
        a.cmd === "pending"
          ? pending
          : a.cmd === "other"
            ? { type: "other", n: 1 }
            : a.cmd === "untyped"
              ? { type: 7 }
              : Object.assign([], pending);
    }

    if (a.at !== "missing") {
      (a.at === "inherited" ? inherited : own).at = a.at === "inherited" ? 42 : a.at;
    }

    if (a.value !== "missing") {
      (a.value === "inherited" ? inherited : own).value = a.value === "inherited" ? 3 : a.value;
    }

    if (a.error !== "missing") {
      own.error =
        a.error === "tag"
          ? { _tag: "disk" }
          : a.error === "empty"
            ? { _tag: "" }
            : a.error === "number"
              ? { _tag: 3 }
              : a.error === "array"
                ? Object.assign([], { _tag: "disk" })
                : a.error === "function"
                  ? Object.assign(() => 0, { _tag: "disk" })
                  : a.error === "null"
                    ? null
                    : Object.create({ _tag: "disk" });
    }

    switch (a.container) {
      case "plain":
        return Object.assign(Object.create(inherited), own);
      case "array":
        return Object.assign(Object.setPrototypeOf([], Object.assign(Object.create(Array.prototype), inherited)), own);
      case "instance":
        return Object.assign(
          Object.setPrototypeOf(new Shaped(), Object.assign(Object.create(Shaped.prototype), inherited)),
          own,
        );
      case "inherited":
        return Object.create(Object.assign({}, inherited, own));
      case "function":
        return Object.assign(() => 0, inherited, own);
    }
  };

  const Move = fc.record({
    fresh: fc.nat({ max: 9 }),
    n: fc.integer({ min: -3, max: 3 }),
    pick: fc.nat(),
    answer: Answer,
  });

  it("D6: saved and fresh answers to the machine's own Cmds keep the old checks' acceptance and the saved Msg itself", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(fc.array(Move, { minLength: 1, maxLength: 30, size: "max" }), (moves) => {
        const received: Array<unknown> = [];
        const recorded = Machine.make({
          model: Model,
          msg: Msg,
          cmds: [save],
          init: (loaded) => [loaded ?? { count: 0, replies: 0 }, []],
          update: {
            add: (s, m) => {
              received.push(m);
              return [{ ...s, count: s.count + m.n }, [save({ n: m.n })]];
            },
            throw: (s) => [s, []],
            save_ok: (s, m) => {
              received.push(m);
              return [{ ...s, replies: s.replies + 1 }, []];
            },
            save_err: (s, m) => {
              received.push(m);
              return [{ ...s, replies: s.replies + 1 }, []];
            },
          },
        });
        const loaded = stepper(Program.make({ ...authoring(), machine: recorded, refuse: () => null }));
        expect(Result.isSuccess(loaded)).toBe(true);

        if (Result.isFailure(loaded)) {
          return;
        }

        const p = loaded.success;
        const start = p.init(null);
        let model = start._tag === "stepped" ? start.model : null;
        const pending: Array<unknown> = [];

        for (const { fresh, n, pick, answer: a } of moves) {
          // Answer a Cmd the machine really returned, once one exists.
          if (fresh < 3 || pending.length === 0) {
            const stepped = p.step(model, { type: "add", n, extra: "kept out by the Msg schema" });
            expect(stepped).toMatchObject({ _tag: "stepped" });

            if (stepped._tag === "stepped") {
              model = stepped.model;
              pending.push(...stepped.cmds);
            }

            continue;
          }

          const cmd = pending[pick % pending.length];
          const msg = answer(a, cmd);
          const before = received.length;

          if (!a.saved) {
            // A fresh input never settles a Cmd, and never reaches the machine.
            expect(p.step(model, msg)).toEqual({ _tag: "refused", reason: "bad_msg" });
            expect(received.length).toBe(before);
            seen.add(`fresh:${oldSettled(msg) === true}`);
            continue;
          }

          const typed = oldTyped(msg);
          const settled = oldSettled(msg);
          const expected =
            typed && !["add", "throw", "save_ok", "save_err"].includes(msg.type)
              ? "skipped"
              : settled === true
                ? "applied"
                : "down";
          const folded = Result.try({ try: () => p.fold(model, msg), catch: (e) => e });

          if (expected === "down") {
            expect(Result.isFailure(folded) ? folded.failure : folded.success).toMatchObject({
              _tag: "ProgramDown",
              reason: "saved_letter",
            });
            expect(received.length).toBe(before);
          } else {
            expect(Result.isSuccess(folded)).toBe(true);

            if (Result.isSuccess(folded) && folded.success._tag === "stepped") {
              if (expected === "applied") {
                // The machine gets the saved Msg itself, inherited and extra fields included.
                expect(received.slice(before)).toHaveLength(1);
                expect(received[before]).toBe(msg);
              } else {
                expect(folded.success.model).toEqual(model);
                expect(received.length).toBe(before);
              }

              model = folded.success.model;
            }
          }

          seen.add(`${expected}:${a.container}`);
          seen.add(`${expected}:at:${typeof a.at === "number" && !Number.isFinite(a.at) ? "nonfinite" : String(a.at)}`);
          seen.add(`${expected}:error:${a.type === "save_err" ? a.error : "-"}`);
        }
      }),
      { seed: SEED, numRuns: 300 },
    );

    for (const side of [
      "fresh:true",
      "fresh:false",
      "applied:plain",
      "applied:array",
      "applied:instance",
      "applied:inherited",
      "down:function",
      "skipped:plain",
      "applied:at:nonfinite",
      "applied:at:inherited",
      "down:at:42",
      "applied:error:empty",
      "applied:error:inherited",
      "applied:error:array",
      "down:error:function",
      "down:error:number",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});
