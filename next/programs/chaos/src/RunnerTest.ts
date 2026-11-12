// P17b slice 2, next/. Public runner laws; the app supplies real SQLite and the real checklist.
// After build plants: dispatch before save/publish; replay a folded fire; turn a failed check
// into done; retry interrupted fire; leak a marker into each saved answer/view/report/reason.
import { Outcome } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Chaos, type Handler, Nemesis, type ProgramRunner, type Update } from "@kampus/libfabrika";
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
    readonly letter: (n: number, input: unknown) => unknown;
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

const experimentId = Schema.decodeUnknownSync(Chaos.ExperimentId)("chaos_0000000000e008000000000000");

const fireRequest = Schema.toType(Chaos.Fire);
const now = () => Effect.succeed(Outcome.Ok(100));
const read = (world: World, binding: Chaos.Target) => () => world.check(binding).pipe(Effect.map(Outcome.Ok));
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
      "saved Asked and the installed watcher revision precede fire; duplicate alarms and reopen never refire",
      [experiments],
      ([input]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const binding = yield* startTarget(world, checklist);
            const calls: Array<Chaos.Fire> = [];
            const published: Array<Update> = [];
            const fire: Handler<never> = (raw) =>
              Effect.gen(function* () {
                const request = Schema.decodeUnknownSync(fireRequest)(raw);
                const saved = yield* world.snapshot(NAME);
                const model = phase(saved.model);
                expect(model.phase._tag).toBe("active");

                if (model.phase._tag !== "active") {
                  return yield* Effect.die(new Error("fire began before the experiment was saved"));
                }

                expect(model.phase.experiment.asked).toContainEqual(
                  expect.objectContaining({
                    ordinal: request.ordinal,
                    fault: request.fault,
                  }),
                );
                expect(published.at(-1)?.rev, "view installed before outside effect").toBe(saved.after);
                calls.push(request);
                return Outcome.Ok(Chaos.Fired.cases.fired.make({ hit: null }));
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
            expect(answers.every((l) => l.parent !== null)).toBe(true);
            expect(new Set(answers.map((l) => l.id)).size).toBe(input.most);
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );

    it.effect.prop(
      "failed, refused, interrupted and missing fire results remain visible after reopen and later faults continue",
      [experiments, Arbitrary.schema(Schema.Literals(["refused", "off", "failed", "interrupted", "missing"]))],
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

                if (request.ordinal !== 1) {
                  return Outcome.Ok(Chaos.Fired.cases.fired.make({ hit: null }));
                }

                switch (mode) {
                  case "refused":
                    return Outcome.Ok(Chaos.Fired.cases.refused.make({ reason: "stale" }));
                  case "off":
                    return Outcome.Err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: null }) }));
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
            const most = input.most + 1;
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                yield* runner.open("watch");
                yield* runner.msg(
                  world.letter(1, {
                    type: "start",
                    id: experimentId,
                    seed: input.seed,
                    most,
                    gap: input.gap,
                    target: binding,
                  }),
                );
                const deadline = yield* nextDeadline(world);

                if (deadline === null) {
                  return yield* Effect.die(new Error("experiment lost its first deadline"));
                }

                if (mode === "missing" || mode === "interrupted") {
                  const child = yield* runner.due(deadline).pipe(Effect.forkScoped);
                  yield* Deferred.await(entered);
                  yield* Fiber.interrupt(child);
                } else {
                  yield* runner.due(deadline);
                }
              }),
            );

            const first = phase((yield* world.snapshot(NAME)).model);
            expect(JSON.stringify(first)).toContain('"ordinal":1');

            for (let ordinal = 2; ordinal <= most; ordinal++) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const { runner } = yield* world.session(NAME, chaos.name, chaos, handlers);
                  yield* runner.open("reopen");
                  expect(calls.filter((n) => n === 1)).toHaveLength(1);
                  const deadline = yield* nextDeadline(world);

                  if (deadline === null) {
                    return yield* Effect.die(new Error("an unanswered fault blocked the remaining schedule"));
                  }

                  yield* runner.due(deadline + input.late);
                }),
              );
            }

            expect(calls).toEqual(Array.from({ length: most }, (_, n) => n + 1));
            const final = phase((yield* world.snapshot(NAME)).model);
            expect(final.phase._tag).toBe(mode === "refused" ? "done" : "incomplete");
            const letters = yield* world.letters(NAME);
            const result = letters
              .map((l) => l.m)
              .filter((m) => Schema.is(Schema.Struct({ cmd: Schema.Struct({ ordinal: Schema.Literal(1) }) }))(m));

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
                expect(phase((yield* world.snapshot(NAME)).model)).toEqual(final);
              }),
            );
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
              fire: () => Effect.succeed(Outcome.Ok(Chaos.Fired.cases.fired.make({ hit: null }))),
              inspect: () =>
                mode === "off"
                  ? Effect.succeed(Outcome.Err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: null }) })))
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

    it.effect.prop(
      "[secrets] body and private error markers stay out of each saved answer, shown state, report and reason",
      [
        experiments,
        Arbitrary.schema(Schema.String.check(Schema.isMinLength(12), Schema.isMaxLength(40))),
        Arbitrary.schema(Schema.Literals(["off", "failed", "refused", "fired"])),
      ],
      ([input, text, mode]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const marker = `private-${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0"))
              .join("")
              .slice(0, 80)}-end`;
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
                      Outcome.Err(new Nemesis.NemesisError({ reason: new Nemesis.Off({ cause: new Error(marker) }) })),
                    )
                  : mode === "failed"
                    ? Effect.die(new URIError(marker))
                    : Effect.succeed(
                        Outcome.Ok(
                          mode === "refused"
                            ? Chaos.Fired.cases.refused.make({ reason: "stale" })
                            : Chaos.Fired.cases.fired.make({ hit: null }),
                        ),
                      ),
              inspect: read(world, binding),
            };
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

            yield* runner.due(deadline);
            const letters = yield* world.letters(NAME);
            const answers = letters.filter(
              (l) =>
                Schema.is(Schema.Struct({ type: Schema.String }))(l.m) &&
                /_(ok|err)$/.test(Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))(l.m).type),
            );
            expect(answers.length).toBeGreaterThanOrEqual(3);

            for (const answer of answers) {
              noLeak(answer.m, marker, `answer ${answer.id}`);
            }

            noLeak((yield* runner.open("shown")).view, marker, "shown state");
            noLeak(yield* world.check(binding), marker, "report JSON");
            const reasons = answers.map(
              (a) =>
                Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.optional(Schema.String) }))(a.m).reason ?? "ok",
            );
            expect(reasons).toHaveLength(answers.length);
            noLeak(reasons, marker, "answer reasons");
            const saved = JSON.stringify(yield* world.letters(TARGET));
            expect(saved, "the private body reached real storage").toContain(marker);
          }),
        ),
      { arbitrary, timeout: 120_000 },
    );
  });
