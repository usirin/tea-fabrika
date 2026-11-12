// P17b slice 2, next/. Public runner laws; the app supplies real SQLite and the real checklist.
// After build plants: dispatch before save/publish; replay a folded fire; turn a failed check
// into done; retry interrupted fire; leak a marker into each saved answer/view/report/reason.
import { Outcome } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Chaos, type Handler, type Incoming, Nemesis, type ProgramRunner, type Update } from "@kampus/libfabrika";
import { Arbitrary, Deferred, Effect, Fiber, Schema, type Scope } from "effect";
import { chaos } from "./program.ts";

const SEED = 119120;
const arbitrary = { seed: SEED, runs: 25 };
const NAME = "chaos:1";
const TARGET = "checklist:1";
type Runner = ProgramRunner["Service"];

/** Each session is a new set of scoped connections to the same real database files. */
export type Open = Effect.Effect<
  {
    readonly session: (
      name: string,
      programName: string,
      program: unknown,
      handlers: Readonly<Record<string, Handler<never>>>,
      observe?: (update: Update) => Effect.Effect<void>,
    ) => Effect.Effect<
      {
        readonly runner: Runner;
        readonly process: string;
        readonly alarms: Array<number | null>;
        readonly watches: Array<Update>;
        readonly recorded: Effect.Effect<{
          readonly rows: ReadonlyArray<{
            readonly name: string;
            readonly attributes: Readonly<Record<string, unknown>>;
            readonly events: ReadonlyArray<unknown>;
            readonly links: ReadonlyArray<unknown>;
          }>;
          readonly health: ReadonlyArray<unknown>;
        }>;
      },
      never,
      Scope.Scope
    >;
    readonly snapshot: (name: string) => Effect.Effect<{
      readonly model: unknown;
      readonly after: number;
      readonly cmds: ReadonlyArray<unknown>;
    }>;
    readonly letters: (name: string) => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly m: unknown;
        readonly by: string;
        readonly parent: string | null;
        readonly rev: number;
        readonly pos: number;
      }>
    >;
    readonly check: (target: Chaos.Target) => Effect.Effect<Chaos.Report, Nemesis.NemesisError>;
    readonly letter: (n: number, input: unknown) => Incoming;
  },
  never,
  Scope.Scope
>;

type World = Open extends Effect.Effect<infer A, never, Scope.Scope> ? A : never;

const bounded = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const experiments = Arbitrary.all({
  seed: bounded(1, 0xffffffff),
  most: bounded(1, 6),
  gap: bounded(1, 1000),
  duplicates: bounded(1, 4),
  cut: bounded(0, 8),
  late: bounded(0, 10000),
});

const uncertainExperiments = Arbitrary.flatMap(experiments, (input) =>
  Arbitrary.map(bounded(1, input.most + 1), (ordinal) => ({ ...input, most: input.most + 1, ordinal })),
);

const experimentId = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000000");

const fireRequest = Schema.toType(Chaos.Fire);
const now = () => Effect.succeed(Outcome.ok(100));
const read = (world: World, binding: Chaos.Target) => () => world.check(binding).pipe(Effect.map(Outcome.ok));
const phase = (raw: unknown) => Schema.decodeUnknownSync(chaos.state.schema)(raw);

const target = (process: string) =>
  Chaos.Target.make({
    program: "fabrika/checklist",
    name: TARGET,
    process,
    client: "client:1",
    key: "public:1",
  });

const startTarget = Effect.fnUntraced(function* (world: World, checklist: unknown) {
  const session = yield* world.session(TARGET, "fabrika/checklist", checklist, {});
  const added = yield* session.runner.msg(world.letter(100, { type: "add", name: "task" }));
  expect(added._tag).toBe("accepted");
  const checked = yield* session.runner.msg(world.letter(101, { type: "check", name: "task", note: "agent-note" }));
  expect(checked._tag).toBe("accepted");
  return target(session.process);
});

const nextDeadline = Effect.fnUntraced(function* (world: World) {
  const saved = yield* world.snapshot(NAME);
  return chaos.wake(phase(saved.model));
});

const noLeak = (value: unknown, marker: string, output: string) => {
  const json = JSON.stringify(value);
  expect(json, `${output} has a concrete output`).toBeTypeOf("string");

  for (const encoded of [
    marker,
    encodeURIComponent(marker),
    encodeURIComponent(encodeURIComponent(marker)),
    btoa(marker),
  ]) {
    expect(json, `${output} leaks ${encoded}`).not.toContain(encoded);
  }
};

/** Every law here opens real files, so each property has 25 runs. */
export const suite = (open: Open, checklist: unknown) =>
  describe("P17b slice 2 real runner", () => {
    it.effect.prop(
      "a forged chaos declaration cannot grant fire to another registered program",
      [experiments, Arbitrary.schema(Schema.NonEmptyString)],
      ([input, generated]) =>
        Effect.forEach(
          [...new Set(["fabrika/chaos", "chaos", "queue", generated, `${generated}/chaos`])],
          (registered) =>
            Effect.scoped(
              Effect.gen(function* () {
                const world = yield* open;
                const binding = yield* startTarget(world, checklist);
                const calls: Array<unknown> = [];
                // The declaration always claims the qualified owner. Registration is trusted by the host.
                const { runner } = yield* world.session(NAME, registered, chaos, {
                  now,
                  fire: (request) =>
                    Effect.sync(() => {
                      calls.push(request);
                      return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
                    }),
                  inspect: read(world, binding),
                });
                yield* runner.msg(
                  world.letter(1, {
                    type: "start",
                    id: experimentId,
                    seed: input.seed,
                    most: 1,
                    gap: input.gap,
                    target: binding,
                  }),
                );
                const deadline = yield* nextDeadline(world);

                if (deadline === null) {
                  return yield* Effect.die(new Error("experiment lost its deadline"));
                }

                yield* runner.due(deadline);
                const allowed = registered === chaos.name;
                expect(calls).toHaveLength(allowed ? 1 : 0);
                const answers = (yield* world.letters(NAME)).filter((letter) =>
                  Schema.is(Schema.Struct({ type: Schema.Literals(["fire_ok", "fire_err"]) }))(letter.m),
                );
                expect(answers).toHaveLength(1);
                expect(answers[0]?.m).toMatchObject(
                  allowed
                    ? { type: "fire_ok" }
                    : { type: "fire_err", error: Schema.TaggedStruct("bad_cmd", {}).make({}), reason: "bad_cmd" },
                );
              }),
            ),
          { concurrency: 1, discard: true },
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "a checklist-shaped target cannot name the chaos process or its registered name",
      [experiments, Arbitrary.schema(Schema.Literals(["name", "process"]))],
      ([input, collision]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const calls: Array<unknown> = [];
            const { runner, process } = yield* world.session(NAME, chaos.name, chaos, {
              now,
              fire: (request) =>
                Effect.sync(() => {
                  calls.push(request);
                  return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
                }),
              inspect: read(world, binding),
            });
            const before = yield* runner.open("watch");
            const unsafe = { ...binding, [collision]: collision === "name" ? NAME : process };
            expect(Schema.is(Chaos.Target)(unsafe), "the schema alone cannot check the trusted binding").toBe(true);
            const sent = yield* runner.msg(
              world.letter(1, {
                type: "start",
                id: experimentId,
                seed: input.seed,
                most: input.most,
                gap: input.gap,
                target: unsafe,
              }),
            );
            expect(sent._tag).toBe("refused");
            yield* runner.due(100_000_000);
            expect(calls).toEqual([]);
            const after = yield* runner.open("after-refusal");
            expect(after.view).toEqual(before.view);
            expect(chaos.wake(phase(after.view))).toBeNull();
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "saved Asked and the installed watcher revision precede fire; duplicate alarms and reopen never refire",
      [experiments],
      ([input]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const calls: Array<Chaos.Fire> = [];
            const published: Array<Update> = [];
            const observations: Array<{
              readonly request: Chaos.Fire;
              readonly model: ReturnType<typeof phase>;
              readonly pos: number | undefined;
              readonly view: number | undefined;
            }> = [];
            const fire: Handler<never> = (raw) =>
              Effect.gen(function* () {
                const request = Schema.decodeUnknownSync(fireRequest)(raw);
                const saved = yield* world.snapshot(NAME);
                const installed = (yield* world.letters(NAME)).find((letter) => letter.rev === saved.after);
                observations.push({
                  request,
                  model: phase(saved.model),
                  pos: installed?.pos,
                  view: published.at(-1)?.rev,
                });
                calls.push(request);
                return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
              });
            const handlers = { now, fire, inspect: read(world, binding) };
            const start = { type: "start", id: experimentId, ...input, target: binding };
            // Only the declared start fields are sent; test controls are never program inputs.
            const startInput = {
              type: start.type,
              id: start.id,
              seed: start.seed,
              most: start.most,
              gap: start.gap,
              target: binding,
            };

            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers, (u) =>
                  Effect.sync(() => void published.push(u)),
                );
                yield* runner.open("watch");
                expect((yield* runner.msg(world.letter(1, startInput)))._tag).toBe("accepted");
              }),
            );

            for (let ordinal = 1; ordinal <= input.most; ordinal++) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers, (u) =>
                    Effect.sync(() => void published.push(u)),
                  );
                  yield* runner.open("watch");
                  expect(calls).toHaveLength(ordinal - 1);
                  const deadline = yield* nextDeadline(world);
                  expect(deadline).not.toBeNull();

                  if (deadline === null) {
                    return yield* Effect.die(new Error("experiment lost its next deadline"));
                  }

                  const at = deadline + input.late;
                  yield* runner.due(at);
                  expect(calls).toHaveLength(ordinal);
                  expect(observations).toHaveLength(ordinal);
                  const observed = observations.at(-1);

                  if (observed === undefined) {
                    return yield* Effect.die(new Error("the controlled fire did not observe storage"));
                  }

                  const savedPhase = observed.model.phase;
                  expect(["active", "checking"]).toContain(savedPhase._tag);

                  if (savedPhase._tag !== "active" && savedPhase._tag !== "checking") {
                    return yield* Effect.die(new Error("fire began before the experiment was saved"));
                  }

                  expect(savedPhase.experiment.asked).toContainEqual(
                    expect.objectContaining({ ordinal: observed.request.ordinal, fault: observed.request.fault }),
                  );
                  expect(observed.pos, "saved turn has an inbox letter").toBeDefined();
                  expect(observed.view, "view installed before outside effect").toBe(observed.pos);

                  for (let n = 0; n < input.duplicates; n++) {
                    yield* runner.due(at);
                  }

                  expect(calls).toHaveLength(ordinal);
                  const next = yield* nextDeadline(world);

                  if (ordinal < input.most) {
                    expect(next).toBeGreaterThanOrEqual(at + input.gap);
                  }
                }),
              );
            }

            const final = phase((yield* world.snapshot(NAME)).model);
            expect(final.phase._tag).toBe("done");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("after-reopen");
                yield* runner.due(100_000_000);
                expect(phase((yield* world.snapshot(NAME)).model)).toEqual(final);
              }),
            );
            expect(calls.map((c) => [c.id, c.ordinal])).toEqual(
              Array.from({ length: input.most }, (_, i) => [experimentId, i + 1]),
            );
            const letters = yield* world.letters(NAME);
            const answers = letters.filter((l) => Schema.is(Schema.Struct({ type: Schema.Literal("fire_ok") }))(l.m));
            expect(answers).toHaveLength(input.most);
            const timers = letters.filter((l) => Schema.is(Schema.Struct({ type: Schema.Literal("timer") }))(l.m));
            expect(timers).toHaveLength(input.most);

            for (const [index, answer] of answers.entries()) {
              const timer = timers[index];
              expect(timer).toBeDefined();
              expect(answer.id.endsWith(`/${timer?.pos}/0/answer`)).toBe(true);
              expect(answer.parent).toBe(timer?.parent);
            }

            expect(new Set(answers.map((l) => l.id)).size).toBe(input.most);
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "failed, refused, interrupted and missing fire results remain visible after reopen and later faults continue",
      [uncertainExperiments, Arbitrary.schema(Schema.Literals(["refused", "off", "failed", "interrupted", "missing"]))],
      ([input, mode]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const entered = yield* Deferred.make<void>();
            const calls: Array<number> = [];
            const fire: Handler<never> = (raw) =>
              Effect.gen(function* () {
                const request = Schema.decodeUnknownSync(fireRequest)(raw);
                calls.push(request.ordinal);
                expect(calls.filter((ordinal) => ordinal === request.ordinal)).toHaveLength(1);

                if (request.ordinal !== input.ordinal) {
                  return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
                }

                switch (mode) {
                  case "refused":
                    return Outcome.ok(Chaos.Fired.cases.refused.make({ reason: "stale" }));
                  case "off":
                    return Outcome.err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: null }) }));
                  case "failed":
                    return yield* Effect.die(new TypeError("controlled outside failure"));
                  case "interrupted":
                    yield* Deferred.succeed(entered, undefined);
                    return yield* Effect.interrupt;
                  case "missing":
                    yield* Deferred.succeed(entered, undefined);
                    return yield* Effect.never;
                }
              });
            const handlers = { now, fire, inspect: read(world, binding) };
            const uncertain = mode === "missing" || mode === "interrupted";
            // The random cut can be before, on or after the uncertain fault, including the final one.
            const cuts = [...new Set([input.cut % (input.most + 1), input.ordinal, input.most])].sort((a, b) => a - b);

            for (const [index, cut] of cuts.entries()) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const before = index === 0 ? null : yield* world.snapshot(NAME);
                  const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                  yield* runner.open("reopen");

                  if (before === null) {
                    yield* runner.msg(
                      world.letter(1, {
                        type: "start",
                        id: experimentId,
                        seed: input.seed,
                        most: input.most,
                        gap: input.gap,
                        target: binding,
                      }),
                    );
                  } else {
                    expect(yield* world.snapshot(NAME), "reopen preserves the saved requests and answers").toEqual(
                      before,
                    );
                  }

                  while (calls.length < cut) {
                    const model = phase((yield* world.snapshot(NAME)).model);
                    expect(model.phase._tag).toBe("active");

                    if (model.phase._tag !== "active") {
                      return yield* Effect.die(new Error("an unanswered fault blocked the remaining schedule"));
                    }

                    const { ordinal, deadline } = model.phase.experiment;
                    const at = deadline + input.late;

                    if (uncertain && ordinal === input.ordinal) {
                      const child = yield* runner.due(at).pipe(Effect.forkScoped);
                      yield* Deferred.await(entered);
                      yield* Fiber.interrupt(child);
                    } else {
                      yield* runner.due(at);
                    }

                    expect(calls).toEqual(Array.from({ length: ordinal }, (_, n) => n + 1));

                    for (let n = 0; n < input.duplicates; n++) {
                      yield* runner.due(at);
                    }

                    expect(calls).toHaveLength(ordinal);
                  }
                }),
              );
            }

            expect(calls).toEqual(Array.from({ length: input.most }, (_, n) => n + 1));
            const final = phase((yield* world.snapshot(NAME)).model);
            // Interrupting the last fire also leaves its following check undispatched. That saved
            // checking phase is honest uncertainty; reopening must not guess or retry either Cmd.
            expect(final.phase._tag).toBe(
              uncertain && input.ordinal === input.most ? "checking" : mode === "refused" ? "done" : "incomplete",
            );
            expect(chaos.wake(final)).toBeNull();

            if (final.phase._tag === "idle" || final.phase._tag === "starting" || final.phase._tag === "stopped") {
              return yield* Effect.die(new Error("the experiment lost its history"));
            }

            expect(final.phase.experiment.asked.map((a) => a.ordinal)).toEqual(calls);
            expect(final.phase.experiment.answers.map((a) => a.ordinal).sort((a, b) => a - b)).toEqual(
              calls.filter((ordinal) => !uncertain || ordinal !== input.ordinal),
            );
            const letters = yield* world.letters(NAME);
            const result = letters
              .map((l) => l.m)
              .filter((m) =>
                Schema.is(Schema.Struct({ cmd: Schema.Struct({ ordinal: Schema.Literal(input.ordinal) }) }))(m),
              );

            if (mode === "missing" || mode === "interrupted") {
              expect(result).toHaveLength(0);
            } else {
              expect(result).toHaveLength(1);
              expect(result[0]).toMatchObject(
                mode === "refused"
                  ? { type: "fire_ok", value: Chaos.Fired.cases.refused.make({ reason: "stale" }) }
                  : {
                      type: "fire_err",
                      error: Schema.TaggedStruct(mode === "off" ? "NemesisError" : "handler_failed", {}).make({}),
                      reason: mode === "off" ? "NemesisError" : "handler_failed",
                    },
              );
            }

            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("final-reopen");
                yield* runner.due(100_000_000);
                expect(phase((yield* world.snapshot(NAME)).model)).toEqual(final);
                expect(calls).toHaveLength(input.most);
              }),
            );
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "delayed fire callbacks after reopen fill only their experiment and never refire saved faults",
      [
        uncertainExperiments,
        Arbitrary.schema(Schema.Literals(["current", "replaced"])),
        Arbitrary.schema(Schema.Literals(["fired", "refused", "off", "failed"])),
      ],
      ([input, delivery, outcome]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const nextEntered = yield* Deferred.make<void>();
            const nextRelease = yield* Deferred.make<void>();
            const nextId = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000001");
            const calls: Array<Chaos.Fire> = [];
            const fire: Handler<never> = (raw) =>
              Effect.gen(function* () {
                const request = Schema.decodeUnknownSync(fireRequest)(raw);
                calls.push(request);
                expect(calls.filter((c) => c.id === request.id && c.ordinal === request.ordinal)).toHaveLength(1);

                if (request.id === experimentId && request.ordinal === input.ordinal) {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);

                  if (outcome === "off") {
                    return Outcome.err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: null }) }));
                  }

                  if (outcome === "failed") {
                    return yield* Effect.die(new TypeError("delayed outside failure"));
                  }

                  if (outcome === "refused") {
                    return Outcome.ok(Chaos.Fired.cases.refused.make({ reason: "stale" }));
                  }
                }

                if (request.id === nextId && request.ordinal === input.ordinal) {
                  yield* Deferred.succeed(nextEntered, undefined);
                  yield* Deferred.await(nextRelease);
                }

                return Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }));
              });
            const handlers = {
              now: (raw: unknown) => {
                const request = Schema.decodeUnknownSync(Schema.Struct({ id: Chaos.ExperimentId }))(raw);
                return Effect.succeed(
                  Outcome.ok(request.id === nextId ? 100 + (input.most + 1) * (input.gap + input.late) : 100),
                );
              },
              fire,
              inspect: read(world, binding),
            };
            const start = (id: typeof Chaos.ExperimentId.Type) => ({
              type: "start",
              id,
              seed: input.seed,
              most: input.most,
              gap: input.gap,
              target: binding,
            });
            const advance = Effect.fnUntraced(function* (runner: Runner, through: number) {
              while (true) {
                const model = phase((yield* world.snapshot(NAME)).model);

                if (model.phase._tag !== "active" || model.phase.experiment.ordinal > through) {
                  return;
                }

                const { ordinal, deadline } = model.phase.experiment;
                const at = deadline + input.late;
                const before = calls.length;
                yield* runner.due(at);
                expect(calls).toHaveLength(before + 1);
                expect(calls.at(-1)?.ordinal).toBe(ordinal);

                for (let n = 0; n < input.duplicates; n++) {
                  yield* runner.due(at);
                }

                expect(calls).toHaveLength(before + 1);
              }
            });

            // The pending callback keeps its scoped connections until it returns. Each reopened
            // runner below has fresh connections, and sees only the saved state and ledger.
            const original = yield* world.session(NAME, chaos.name, chaos, handlers);
            yield* original.runner.msg(world.letter(1, start(experimentId)));
            yield* advance(original.runner, input.ordinal - 1);
            const deadline = yield* nextDeadline(world);

            if (deadline === null) {
              return yield* Effect.die(new Error("the selected fault has no deadline"));
            }

            const pending = yield* original.runner.due(deadline + input.late).pipe(Effect.forkScoped);
            yield* Deferred.await(entered);
            const cut = input.ordinal + (input.cut % (input.most - input.ordinal + 1));
            const saved = yield* world.snapshot(NAME);
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("reopen-with-pending-callback");
                expect(yield* world.snapshot(NAME)).toEqual(saved);
                yield* advance(runner, cut);
              }),
            );
            const before = phase((yield* world.snapshot(NAME)).model);
            expect(calls.map((c) => c.ordinal)).toEqual(Array.from({ length: cut }, (_, n) => n + 1));

            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("before-callback");
                expect(phase((yield* world.snapshot(NAME)).model)).toEqual(before);

                const newer =
                  delivery === "replaced"
                    ? yield* Effect.gen(function* () {
                        expect((yield* runner.msg(world.letter(2, { type: "stop" })))._tag).toBe("accepted");
                        expect((yield* runner.msg(world.letter(3, start(nextId))))._tag).toBe("accepted");
                        yield* advance(runner, input.ordinal - 1);
                        const deadline = yield* nextDeadline(world);

                        if (deadline === null) {
                          return yield* Effect.die(new Error("the new experiment lost its matching fault"));
                        }

                        const pending = yield* runner.due(deadline + input.late).pipe(Effect.forkScoped);
                        yield* Deferred.await(nextEntered);
                        return pending;
                      })
                    : null;

                const current = phase((yield* world.snapshot(NAME)).model);
                const count = calls.length;
                yield* Deferred.succeed(release, undefined);
                yield* Fiber.join(pending);
                expect(calls).toHaveLength(count);
                const after = phase((yield* world.snapshot(NAME)).model);

                if (delivery === "replaced") {
                  expect(after, "an old fire and its old check cannot settle the current experiment").toEqual(current);
                } else {
                  if (
                    current.phase._tag === "idle" ||
                    current.phase._tag === "starting" ||
                    current.phase._tag === "stopped" ||
                    after.phase._tag === "idle" ||
                    after.phase._tag === "starting" ||
                    after.phase._tag === "stopped"
                  ) {
                    return yield* Effect.die(new Error("the delayed answer lost the experiment"));
                  }

                  expect(after.phase.experiment.asked).toEqual(current.phase.experiment.asked);
                  expect(after.phase.experiment.schedule).toEqual(current.phase.experiment.schedule);
                  expect(after.phase.experiment.answers).toHaveLength(current.phase.experiment.answers.length + 1);
                  const answer = after.phase.experiment.answers.find((a) => a.ordinal === input.ordinal);
                  expect(answer?.result._tag).toBe(outcome === "off" || outcome === "failed" ? "failed" : "answered");
                }

                if (newer !== null) {
                  yield* Deferred.succeed(nextRelease, undefined);
                  yield* Fiber.join(newer);
                }

                yield* advance(runner, input.most);
              }),
            );

            const final = phase((yield* world.snapshot(NAME)).model);
            expect(final.phase._tag).toBe(
              delivery === "replaced" ||
                (outcome !== "off" && outcome !== "failed" && (cut < input.most || input.ordinal === input.most))
                ? "done"
                : "incomplete",
            );
            expect(chaos.wake(final)).toBeNull();
            expect(calls.filter((c) => c.id === experimentId).map((c) => c.ordinal)).toEqual(
              Array.from({ length: delivery === "replaced" ? cut : input.most }, (_, n) => n + 1),
            );
            expect(calls.filter((c) => c.id === nextId).map((c) => c.ordinal)).toEqual(
              Array.from({ length: delivery === "replaced" ? input.most : 0 }, (_, n) => n + 1),
            );
            const late = (yield* world.letters(NAME)).filter((letter) =>
              Schema.is(
                Schema.Struct({
                  cmd: Schema.Struct({ id: Schema.Literal(experimentId), ordinal: Schema.Literal(input.ordinal) }),
                }),
              )(letter.m),
            );
            expect(late).toHaveLength(1);
            expect(late[0]?.m).toMatchObject({
              type: outcome === "off" || outcome === "failed" ? "fire_err" : "fire_ok",
            });
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("after-callback-reopen");
                yield* runner.due(100_000_000);
                expect(phase((yield* world.snapshot(NAME)).model)).toEqual(final);
              }),
            );
            expect(new Set(calls.map((c) => `${c.id}/${c.ordinal}`)).size).toBe(calls.length);
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "failed checks stay incomplete after a new database connection",
      [experiments, Arbitrary.schema(Schema.Literals(["off", "failed"]))],
      ([input, mode]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const handlers: Readonly<Record<string, Handler<never>>> = {
              now,
              fire: () => Effect.succeed(Outcome.ok(Chaos.Fired.cases.fired.make({ hit: null }))),
              inspect: () =>
                mode === "off"
                  ? Effect.succeed(Outcome.err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: null }) })))
                  : Effect.die(new RangeError("controlled check failure")),
            };
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("watch");
                yield* runner.msg(
                  world.letter(1, {
                    type: "start",
                    id: experimentId,
                    seed: input.seed,
                    most: 1,
                    gap: input.gap,
                    target: binding,
                  }),
                );
                const deadline = yield* nextDeadline(world);

                if (deadline === null) {
                  return yield* Effect.die(new Error("experiment lost its deadline"));
                }

                yield* runner.due(deadline + input.late);
              }),
            );
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("after-reopen");
                const model = phase((yield* world.snapshot(NAME)).model);
                expect(model.phase._tag).toBe("incomplete");
                expect(chaos.wake(model)).toBeNull();
              }),
            );
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    for (const output of ["answers", "view", "report", "reasons", "attributes", "events", "links", "health"] as const) {
      it.effect.prop(
        `[secrets] ${output} keeps body and private error markers out, including encoded forms`,
        [
          experiments,
          Arbitrary.schema(Schema.String.check(Schema.isMinLength(12), Schema.isMaxLength(40))),
          Arbitrary.schema(Schema.Literals(["off", "failed", "refused", "fired"])),
        ],
        ([input, text, mode]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const marker = `private-${Array.from(new TextEncoder().encode(text), (b) =>
                b.toString(16).padStart(2, "0"),
              )
                .join("")
                .slice(0, 80)}-end ?/+=%`;
              const world = yield* open;
              const binding = yield* startTarget(world, checklist);
              const body = yield* world.session(TARGET, "fabrika/checklist", checklist, {});
              yield* body.runner.msg(world.letter(102, { type: "uncheck", name: "task" }));
              yield* body.runner.msg(world.letter(103, { type: "check", name: "task", note: marker }));
              const handlers: Readonly<Record<string, Handler<never>>> = {
                now,
                fire: () =>
                  mode === "off"
                    ? Effect.succeed(
                        Outcome.err(
                          new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: new Error(marker) }) }),
                        ),
                      )
                    : mode === "failed"
                      ? Effect.die(new URIError(`https://invalid.test/?private=${encodeURIComponent(marker)}`))
                      : Effect.succeed(
                          Outcome.ok(
                            mode === "refused"
                              ? Chaos.Fired.cases.refused.make({ reason: "stale" })
                              : Chaos.Fired.cases.fired.make({ hit: null }),
                          ),
                        ),
                inspect: read(world, binding),
              };
              const { runner, recorded } = yield* world.session(NAME, chaos.name, chaos, handlers);
              yield* runner.open("watch");
              yield* runner.msg(
                world.letter(1, {
                  type: "start",
                  id: experimentId,
                  seed: input.seed,
                  most: 1,
                  gap: input.gap,
                  target: binding,
                }),
              );
              const deadline = yield* nextDeadline(world);

              if (deadline === null) {
                return yield* Effect.die(new Error("experiment lost its deadline"));
              }

              yield* runner.due(deadline);
              const letters = yield* world.letters(NAME);
              const answers = letters.filter(
                (l) =>
                  Schema.is(Schema.Struct({ type: Schema.String }))(l.m) &&
                  /_(ok|err)$/.test(Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))(l.m).type),
              );
              expect(answers.length).toBeGreaterThanOrEqual(3);

              const view = (yield* runner.open("shown")).view;
              const report = yield* world.check(binding);
              const reasons = answers.map(
                (a) =>
                  Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.optional(Schema.String) }))(a.m).reason ??
                  "ok",
              );
              expect(reasons).toHaveLength(answers.length);
              const { rows, health } = yield* recorded;
              const commands = rows.filter((row) => row.name === "runner.cmd");
              expect(commands.length, "real Cmd spans reached the stored job record").toBeGreaterThanOrEqual(3);
              expect(health.length, "ended spans reached stored health").toBeGreaterThan(0);

              const outputs = {
                answers: answers.map((answer) => answer.m),
                view,
                report,
                reasons,
                attributes: commands.map((row) => row.attributes),
                events: commands.map((row) => row.events),
                links: commands.map((row) => row.links),
                health,
              };
              noLeak(outputs[output], marker, output);

              if (mode === "failed") {
                expect(commands.some((row) => row.attributes["error.type"] === "URIError")).toBe(true);
              }

              const saved = JSON.stringify(yield* world.letters(TARGET));
              expect(saved, "the private body reached real storage").toContain(marker);
            }),
          ),
        { arbitrary, timeout: 120_000 },
      );
    }
  });
