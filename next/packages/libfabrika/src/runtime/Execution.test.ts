// P12, next/. An Effect adapter must never put a Promise where P11 expects a checked Step.
// These use a production RPC client interface. The real Worker Loader is checked by instance-wire.
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import * as fc from "fast-check";
import { executionFailure, nodeExecution, workerExecution } from "./Execution.ts";
import { stepper, Step, type Admission, type Prepared, type ProgramDown } from "./Program.ts";
import { Saved } from "./State.ts";

const SEED = 119120;
const noSavedModel: [number, null] = [0, null];
const savedModel: [number, { count: number }] = [2, { count: 2 }];
const refusalBoundary: [number, { count: number }] = [3, { count: 3 }];
const aboveRefusal: [number, null] = [6, null];
const nullReply: [fc.JsonValue, boolean, string] = [null, false, "bad"];
const missingModel: [fc.JsonValue, boolean, string] = [{ model: {} }, false, "bad"];
const malformedModel: [fc.JsonValue, boolean, string] = [{ _tag: "stepped", model: 1 }, false, "bad"];
const rejectedReply: [fc.JsonValue, boolean, string] = ["reject", true, "bad"];
const upgradeAndReply: [number, number, number, string] = [2, 7, 42, "bad"];

const rejectedRpc = async (): Promise<never> => {
  throw new Error("private RPC body");
};

const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("inc") });

const work = Cmd.make("work", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Int,
  err: ["disk"],
});

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [work],
  init: (loaded) => [loaded ?? { count: 0 }, []],
  update: {
    inc: (s) => [{ count: s.count + 1 }, []],
    work_ok: (s) => [s, []],
    work_err: (s) => [s, []],
  },
});

const declared = {
  name: "adapter-counter",
  machine,
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: (s: typeof Model.Type) => (s.count === 3 ? { reason: "limit", now: 3, most: 3 } : null),
  inputs: {},
  outputs: {},
  writes: {},
  wake: () => null,
};

describe("P13 split execution", () => {
  it("A9: fresh and update decode separately; lost, malformed and missing Worker calls stay undecided", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.array(fc.noBias(fc.nat()), { minLength: 10, maxLength: 40 }), (tape) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const pure = Result.getOrThrow(stepper(declared));
            let model = { count: 0 };
            const history: Array<{ count: number }> = [];

            for (const n of tape) {
              const phase = n % 2 === 0 ? "fresh" : "update";
              const available =
                history.length === 0 ? ["ok", "rpc", "decode", "missing"] : ["ok", "rpc", "decode", "missing", "retry"];
              const mode = available[Math.floor(n / 2) % available.length]!;
              reached.add(`${phase}:${mode}`);
              let composed = 0;
              const invoke = (f: () => Result.Result<unknown, unknown>) => {
                if (mode === "rpc") {
                  return rejectedRpc();
                }

                if (mode === "decode") {
                  return { _tag: phase === "fresh" ? "stepped" : "admitted", model: { count: 1 } };
                }

                return Result.getOrThrow(f());
              };
              const calls = {
                init: async (s: unknown) => pure.init(s),
                step: async (s: unknown, m: unknown) => {
                  composed++;
                  return pure.step(s, m);
                },
                fresh: async (s: unknown, m: unknown) => invoke(() => pure.fresh(s, m)),
                update: async (s: unknown, m: unknown) => invoke(() => pure.update(s, m)),
                audit: async () => ({ _tag: "ok", value: { type: "inc" } }),
                fold: async (s: unknown, m: unknown) => pure.fold(s, m),
                upgrade: async (saved: unknown) => ({ saved, ran: [] }),
                reply: async () => null,
              };

              if (mode === "missing") {
                Reflect.deleteProperty(calls, phase);
              }

              const remote = workerExecution(calls);
              const selected = mode === "retry" ? history[n % history.length]! : model;
              const call: Effect.Effect<Admission | Prepared, ProgramDown> = remote[phase](selected, { type: "inc" });
              const result = yield* Effect.result(call);
              expect(composed, "new calls cannot fall back to composed step").toBe(0);

              if (mode === "rpc" || mode === "decode" || mode === "missing") {
                expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "ProgramDown" } });

                if (Result.isFailure(result)) {
                  expect(["rpc", "decode"]).toContain(result.failure.source);
                }
              } else if (phase === "fresh") {
                expect(Result.getOrThrow(result)).toEqual(
                  selected.count === 3 ? { _tag: "refused", reason: "limit", now: 3, most: 3 } : { _tag: "admitted" },
                );
              } else {
                const prepared = Result.getOrThrow(result);
                expect(prepared).toMatchObject({ _tag: "stepped", model: { count: selected.count + 1 } });
                history.push(selected);
                model = { count: selected.count + 1 };
              }
            }
          }),
        ),
      ),
      { seed: SEED, numRuns: 100 },
    );

    for (const phase of ["fresh", "update"]) {
      for (const mode of ["ok", "rpc", "decode", "missing", "retry"]) {
        expect(reached.has(`${phase}:${mode}`)).toBe(true);
      }
    }
  });

  it("A5, A9: audit RPC failure is AuditError; checked program failures preserve their source", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.noBias(fc.nat()), { minLength: 8, maxLength: 30 }), (tape) =>
        Effect.runPromise(
          Effect.gen(function* () {
            for (const n of tape) {
              const mode = ["rpc", "decode", "checked", "ok"][n % 4]!;
              const node = nodeExecution(declared);
              const failure = yield* Effect.flip(node.step({ count: "invalid" }, { type: "inc" }));
              const rpc = async () => (mode === "checked" ? executionFailure(failure) : null);
              const remote = workerExecution({
                init: rpc,
                step: rpc,
                fold: rpc,
                reply: rpc,
                upgrade: rpc,
                fresh: rpc,
                update: rpc,
                audit: async () => {
                  if (mode === "rpc") {
                    return rejectedRpc();
                  }

                  return mode === "ok" ? { _tag: "ok", value: { type: "inc" } } : { _tag: "unrecognized" };
                },
              });

              if (mode === "checked") {
                expect((yield* Effect.flip(remote.fresh({}, {}))).source).toBeUndefined();
                expect((yield* Effect.flip(remote.update({}, {}))).source).toBeUndefined();
              }

              const audit = yield* Effect.exit(remote.audit({ type: "inc" }));
              expect(audit._tag).toBe(mode === "ok" ? "Success" : "Failure");

              if (mode === "ok") {
                expect(audit).toMatchObject({ _tag: "Success", value: { type: "inc" } });
              } else {
                expect(Exit.isFailure(audit)).toBe(true);

                if (Exit.isFailure(audit)) {
                  expect(Cause.hasDies(audit.cause)).toBe(false);
                  expect(Cause.squash(audit.cause)).toMatchObject({
                    _tag: "AuditError",
                    reason: { _tag: expect.any(String) },
                  });
                  expect(Cause.pretty(audit.cause)).not.toContain(`private-${n}`);
                }
              }
            }
          }),
        ),
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
});

type Execution = {
  init: (saved: unknown) => Effect.Effect<Step, unknown>;
  step: (model: unknown, msg: unknown) => Effect.Effect<Step, unknown>;
  fold: (model: unknown, msg: unknown) => Effect.Effect<Step, unknown>;
  upgrade: (saved: unknown) => Effect.Effect<unknown, unknown>;
  reply: (cmd: unknown, outcome: unknown) => Effect.Effect<unknown, unknown>;
};

describe("P12 Effect execution adapter", () => {
  it("P11 handoff plant: treating an RPC Promise as a pure Step breaks checked parity", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ min: 0, max: 6 }), fc.nat({ max: 1_000_000 })),
        fc.option(fc.record({ count: fc.integer() }), { nil: null }),
        (n, saved) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const pure = yield* Effect.fromResult(stepper(declared));
              const node: Execution = nodeExecution(declared);
              // Independent pure implementation stays in P11. RPC introduces a genuine async boundary.
              const remote: Execution = workerExecution({
                init: async (saved: unknown) => pure.init(saved),
                step: async (model: unknown, msg: unknown) => pure.step(model, msg),
                fresh: async (model: unknown, msg: unknown) => Result.getOrThrow(pure.fresh(model, msg)),
                update: async (model: unknown, msg: unknown) => Result.getOrThrow(pure.update(model, msg)),
                audit: async (msg: unknown) => ({
                  _tag: "ok",
                  value: await Effect.runPromise(nodeExecution(declared).audit(msg)),
                }),
                fold: async (model: unknown, msg: unknown) => pure.fold(model, msg),
                upgrade: async (saved: unknown) => Saved.upgrade(saved, declared.state, "build-a"),
                reply: rejectedRpc,
              });
              expect(yield* node.init(saved)).toEqual(pure.init(saved));
              expect(yield* remote.init(saved)).toEqual(pure.init(saved));

              for (const msg of [{ type: "inc" }, { type: "missing" }]) {
                expect(yield* node.step({ count: n }, msg)).toEqual(pure.step({ count: n }, msg));
                expect(yield* remote.step({ count: n }, msg)).toEqual(pure.step({ count: n }, msg));
                expect(yield* remote.fold({ count: n }, msg)).toEqual(pure.fold({ count: n }, msg));
              }
            }),
          ),
      ),
      { seed: SEED, examples: [noSavedModel, savedModel, refusalBoundary, aboveRefusal] },
    );
  });
  it("P11 handoff plant: decode every RPC result; an invalid model or rejected RPC is ProgramDown", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue().filter((raw) => !Schema.is(Step)(raw)),
        fc.boolean(),
        fc.string(),
        (answer, reject, bad) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const node: Execution = nodeExecution(declared);
              expect(Exit.isFailure(yield* Effect.exit(node.init({ count: bad })))).toBe(true);
              const rpc = reject ? rejectedRpc : async () => answer;
              const remote: Execution = workerExecution({
                init: rpc,
                step: rpc,
                fresh: rpc,
                update: rpc,
                audit: rpc,
                fold: rpc,
                upgrade: rpc,
                reply: rpc,
              });

              for (const [action, reason] of [
                [remote.init(null), "load"],
                [remote.step({}, {}), "step"],
                [remote.fold({}, {}), "saved_letter"],
              ] as const) {
                const result = yield* Effect.flip(action);
                expect(result).toMatchObject({ _tag: "ProgramDown", reason });
                expect(JSON.stringify(result)).not.toContain("private RPC body");
              }
            }),
          ),
      ),
      { seed: SEED, examples: [nullReply, missingModel, malformedModel, rejectedReply] },
    );
  });
  it("P11 handoff plant: upgrades and typed Cmd replies must be checked inside execution", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), fc.nat(), fc.nat(), fc.string(), (n, after, at, bad) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const upgraded = {
              ...declared,
              state: {
                v: 2,
                schema: Model,
                upgrades: [
                  {
                    name: "rename",
                    from: 1,
                    run: (raw: unknown) => ({
                      count: Schema.decodeUnknownSync(Schema.Struct({ total: Schema.Int }))(raw).total,
                    }),
                  },
                ],
              },
            };
            const node: Execution = nodeExecution(upgraded, "build-b");
            const saved = { v: 1, build: "build-a", after, model: { total: n } };
            expect(yield* node.upgrade(saved)).toEqual(Saved.upgrade(saved, upgraded.state, "build-b"));
            expect(saved).toEqual({ v: 1, build: "build-a", after, model: { total: n } });
            const cmd = work({ n });
            expect(yield* node.reply(cmd, { ...Outcome.ok(n), at })).toEqual(work.ok(cmd, n, at));
            expect(Exit.isFailure(yield* Effect.exit(node.reply(cmd, { ...Outcome.ok(bad), at })))).toBe(true);
            expect(Exit.isFailure(yield* Effect.exit(node.upgrade({ ...saved, model: { total: bad } })))).toBe(true);
          }),
        ),
      ),
      { seed: SEED, examples: [upgradeAndReply] },
    );
  });
});
