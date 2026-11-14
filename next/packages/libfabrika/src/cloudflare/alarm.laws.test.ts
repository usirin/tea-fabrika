// Ticket 866, next/. Exercise the real Cloudflare Alarm through processRuntime.
import { createHash } from "node:crypto";
import {
  DurableObjectState as ObjectState,
  fromDurableObjectState,
} from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Cause, Deferred, Effect, Exit, Layer, Option, type Scope } from "effect";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Writer } from "../access/SessionManager.ts";
import { LedgerError } from "../ledger/Ledger.ts";
import { Alarm } from "../runtime/Entry.ts";
import { ProgramRunner, Sent } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import * as ProcessObject from "./ProcessObject.ts";
import { processRuntime } from "./runtime.ts";

type State = Parameters<typeof processRuntime>[0];
type Environment = Parameters<typeof processRuntime>[1];
const platform = <A>(value: object): A => value as A;

// Ticket 502 slice S2: keep only what the Process object's Layer hands to Alchemy's `make`, so law
// A2 can run its `alarm` slot on Node. Every other name in objects.ts stays as it is.
const made = vi.hoisted((): { value?: object } => ({}));

vi.mock("./objects.ts", async (original) => {
  const actual = await original<typeof import("./objects.ts")>();
  const { Layer } = await import("effect");
  return {
    ...actual,
    Process: {
      make: (implementation: object) => {
        made.value = implementation;
        return Layer.empty;
      },
    },
  };
});

const unexpected = () => {
  throw new Error("unexpected platform call");
};

const checkAlarmTime = (at: number) => {
  if (at <= 0) {
    throw new TypeError("setAlarm requires a time greater than 0");
  }
};

// The process records its start with the Project object before it runs (T753), so the law's
// environment carries a start's input, and its Project answers that one call and no other.
const start = StartsTest.fixture({ name: "alarm-project", port: 8787 }, (algorithm, data) =>
  createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
);

const categories = ["zero", "negative", "past", "now", "future", "far", "clear"] as const;
type Move = (typeof categories)[number] | "replace" | "repeat" | "advance" | "clear-again";

// fc.gen is needed because each draw depends on the alarm state reached by the previous operation.
it("A1: supported alarm operations preserve the logical wake and schedule or clear the platform alarm", async () => {
  await fc.assert(
    fc.asyncProperty(fc.gen(), (draw) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let now = draw(fc.integer, { min: 2, max: 2_000_000_000_000 });
          let armed: number | null = null;
          let eligible: number | null = null;
          const captured = yield* Deferred.make<Alarm["Service"]>();
          const requests: number[] = [];
          const values = new Map<string, unknown>([
            [
              "descriptor",
              {
                id: "alarm-process",
                name: "alarm:866",
                program: "test/alarm",
                build: "test-build",
                owner: Writer.cases.person.make({ key: "test-key", for: "test-person" }),
              },
            ],
          ]);
          const storage = platform<State["storage"]>({
            get: async (key: string) => {
              expect(["descriptor", "wake"]).toContain(key);
              return values.get(key);
            },
            put: async (key: string, value: unknown) => {
              expect(key).toBe("wake");
              values.set(key, value);
            },
            delete: async (key: string) => {
              expect(key).toBe("wake");
              return values.delete(key);
            },
            setAlarm: async (at: number) => {
              requests.push(at);
              checkAlarmTime(at);
              armed = at;
              eligible = at <= now ? now : at;
            },
            deleteAlarm: async () => {
              armed = null;
              eligible = null;
            },
            sql: { exec: unexpected },
            transactionSync: unexpected,
          });
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(SpanSink, "layer").mockReturnValue(
                Layer.succeed(SpanSink, {
                  batch: (work) => work,
                  flush: Effect.succeed({ sent: 0 }),
                  check: Effect.void,
                  summaries: unexpected,
                  sums: unexpected,
                }),
              ),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(ProgramRunner, "withLoader").mockImplementation(() =>
                Layer.effect(
                  ProgramRunner,
                  Effect.gen(function* () {
                    yield* Deferred.succeed(captured, yield* Alarm);
                    return ProgramRunner.of({
                      init: () => Effect.void,
                      msg: () => Effect.succeed(Sent.cases.accepted.make({ rev: 0, pos: 0 })),
                      open: () => Effect.succeed({ rev: 0, view: {} }),
                      due: () => Effect.void,
                      mailed: Effect.void,
                      restart: () => Effect.void,
                    });
                  }),
                ),
              ),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          const stub = new Proxy({}, { get: unexpected });
          const project = new Proxy(
            {},
            { get: (_target, key) => (key === "settingsStart" ? async () => StartsTest.reply(start) : unexpected()) },
          );
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() =>
              processRuntime(
                platform<State>({ id: { name: JSON.stringify(["alarm-project", "alarm:866"]) }, storage }),
                platform<Environment>({
                  INSTANCE: JSON.stringify(start),
                  PROJECT: { getByName: () => project },
                  MEASUREMENTS: stub,
                }),
                {},
              ),
            ),
            (runtime) => runtime.disposeEffect,
          );
          yield* runtime.contextEffect;
          const alarm = yield* Deferred.await(captured);
          let requested: number | null = null;
          const covered = new Set<Move>();
          const goals: Move[] = [...categories, "replace", "repeat", "advance", "clear-again"];
          const moves = draw(fc.integer, { min: 12, max: 20 });

          for (let index = 0; index < moves; index++) {
            const possible = goals.filter((move) =>
              move === "replace" || move === "repeat"
                ? requested !== null && armed !== null
                : move === "clear"
                  ? covered.has("replace") && covered.has("repeat")
                  : move === "clear-again"
                    ? requested === null && covered.has("clear")
                    : true,
            );
            const missing = possible.filter((move) => !covered.has(move));
            const choices: Move[] =
              covered.has("clear") && !covered.has("clear-again") && requested === null
                ? ["clear-again" as const]
                : missing.length > 0
                  ? missing
                  : possible;
            const move: Move = draw(fc.constantFrom, ...choices);
            const before = requests.length;

            if (move === "advance") {
              now += draw(fc.integer, { min: 1, max: 1_000_000 });

              if (armed !== null && armed <= now) {
                eligible = now;
              }
            } else {
              const gap = draw(fc.integer, { min: 1, max: now - 1 });
              const at: number | null =
                move === "clear" || move === "clear-again"
                  ? null
                  : move === "repeat"
                    ? requested
                    : move === "zero"
                      ? 0
                      : move === "negative"
                        ? -gap
                        : move === "past"
                          ? now - gap
                          : move === "now"
                            ? now
                            : move === "far"
                              ? draw(fc.integer, { min: 4_000_000_000_000_000, max: 8_000_000_000_000_000 })
                              : move === "replace"
                                ? requested! + draw(fc.integer, { min: 1, max: 1_000_000 })
                                : now + gap;
              const exit = yield* Effect.exit(alarm.set(at));
              expect(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "alarm operation").toBe(
                true,
              );
              requested = at;
              expect(requests.length).toBe(before + (at === null ? 0 : 1));
            }

            if (requested === null) {
              expect(values.has("wake")).toBe(false);
              expect(armed).toBeNull();
              expect(eligible).toBeNull();
            } else {
              expect(values.get("wake")).toBe(requested);
              expect(armed).toBeGreaterThan(0);

              if (requested <= 0) {
                expect(armed).toBe(1);
              } else {
                expect(armed).toBe(requested);
              }

              if (requested <= now) {
                expect(eligible).toBeLessThanOrEqual(now);
              } else {
                expect(eligible).toBe(requested);
              }
            }

            covered.add(move);
          }

          expect([...covered].sort()).toEqual([...goals].sort());
        }).pipe(Effect.scoped),
      ),
    ),
    { numRuns: 100, seed: 119120 },
  );
});

// Ticket 502 slice S2, law 10, next/. The Process object's Layer hands the platform alarm to the
// service through Alchemy's `alarm` slot, whose type has no failure. So an alarm that fails must die
// as a defect: the bridge then rejects, and the platform delivers the alarm again. An alarm that
// answers done is never delivered again, so a caught failure would lose the wake.
// Only the platform is fake, as in A1: storage, the project stub and the runner under the service.
// Plant: catch the alarm's failure in the Layer and answer done.
type Slots = { readonly alarm: () => Effect.Effect<void, never, RuntimeContext> };

type Constructor = Effect.Effect<
  Effect.Effect<Slots, never, ObjectState | RuntimeContext | Scope.Scope>,
  never,
  ObjectState | WorkerEnvironment | Scope.Scope
>;

const outcomes = ["done", "storage", "fails", "dies"] as const;

const Delivery = fc.record({
  wake: fc.option(fc.integer({ min: 1, max: 2_000_000_000_000 }), { nil: undefined }),
  outcome: fc.constantFrom(...outcomes),
  text: fc.string(),
});

it("A2: an alarm that fails dies as a defect, one that is done ran its saved wake once, and no saved wake runs nothing", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(Delivery, { minLength: 1, maxLength: 6 }), (deliveries) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let now = deliveries[0]!;
          const dues: number[] = [];
          const values = new Map<string, unknown>([
            [
              "descriptor",
              {
                id: "alarm-process",
                name: "alarm:502",
                program: "test/alarm",
                build: "test-build",
                owner: Writer.cases.person.make({ key: "test-key", for: "test-person" }),
              },
            ],
          ]);
          const storage = platform<State["storage"]>({
            get: (key: string) => {
              expect(["descriptor", "wake"]).toContain(key);
              // The platform's storage rejects; the service turns that into its typed failure.
              return key === "wake" && now.outcome === "storage"
                ? Promise.reject(new Error(now.text))
                : Promise.resolve(key === "wake" ? now.wake : values.get(key));
            },
            put: unexpected,
            delete: unexpected,
            setAlarm: unexpected,
            deleteAlarm: unexpected,
            sql: { exec: unexpected },
            transactionSync: unexpected,
          });
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(SpanSink, "layer").mockReturnValue(
                Layer.succeed(SpanSink, {
                  batch: (work) => work,
                  flush: Effect.succeed({ sent: 0 }),
                  check: Effect.void,
                  summaries: unexpected,
                  sums: unexpected,
                }),
              ),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(ProgramRunner, "withLoader").mockImplementation(() =>
                Layer.succeed(
                  ProgramRunner,
                  ProgramRunner.of({
                    init: () => Effect.void,
                    msg: () => Effect.succeed(Sent.cases.accepted.make({ rev: 0, pos: 0 })),
                    open: () => Effect.succeed({ rev: 0, view: {} }),
                    due: (at) =>
                      Effect.suspend(() => {
                        dues.push(at);
                        return now.outcome === "fails"
                          ? Effect.fail(new LedgerError({ reason: "storage", message: now.text }))
                          : now.outcome === "dies"
                            ? Effect.die(new Error(now.text))
                            : Effect.void;
                      }),
                    mailed: Effect.void,
                    restart: () => Effect.void,
                  }),
                ),
              ),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          const stub = new Proxy({}, { get: unexpected });
          const project = new Proxy(
            {},
            { get: (_target, key) => (key === "settingsStart" ? async () => StartsTest.reply(start) : unexpected()) },
          );
          ProcessObject.layer({ programs: {} });
          const constructor = platform<Constructor>(Option.getOrThrow(Option.fromUndefinedOr(made.value)));
          const state = fromDurableObjectState(
            platform<Parameters<typeof fromDurableObjectState>[0]>({
              id: { name: JSON.stringify(["alarm-project", "alarm:502"]) },
              storage,
              abort: unexpected,
            }),
          );
          const environment = platform<WorkerEnvironment["Service"]>({
            INSTANCE: JSON.stringify(start),
            PROJECT: { getByName: () => project },
            MEASUREMENTS: stub,
          });
          const context = platform<RuntimeContext["Service"]>({});
          const object = yield* constructor.pipe(
            Effect.flatten,
            Effect.provideService(WorkerEnvironment, environment),
            Effect.provideService(ObjectState, state),
            Effect.provideService(RuntimeContext, context),
          );

          for (const delivery of deliveries) {
            now = delivery;
            const before = dues.length;
            const exit = yield* Effect.exit(object.alarm().pipe(Effect.provideService(RuntimeContext, context)));
            const ran = delivery.wake !== undefined && delivery.outcome !== "storage";
            const failed = delivery.outcome === "storage" || (ran && delivery.outcome !== "done");
            expect(dues.slice(before), "the saved wake is run once, and only when one is saved").toEqual(
              ran ? [delivery.wake] : [],
            );
            expect(Exit.isFailure(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "the alarm is done").toBe(
              failed,
            );

            if (Exit.isFailure(exit)) {
              // A defect, never a typed failure: the slot's type has none, and the bridge rejects on it.
              expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(false);
              expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true);
            }
          }
        }).pipe(Effect.scoped),
      ),
    ),
    { numRuns: 100, seed: 119120 },
  );
});
