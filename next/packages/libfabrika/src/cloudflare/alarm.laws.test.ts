// Ticket 866, next/. Exercise the real Cloudflare Alarm through processRuntime.
import { createHash } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Layer } from "effect";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Writer } from "../access/SessionManager.ts";
import { Alarm } from "../runtime/Entry.ts";
import { ProgramRunner, Sent } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { processRuntime } from "./runtime.ts";

type State = Parameters<typeof processRuntime>[0];
type Environment = Parameters<typeof processRuntime>[1];
const platform = <A>(value: object): A => value as A;

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
            sql: {
              exec: (query: string) => {
                expect(query).toBe("SELECT name FROM sqlite_master WHERE name='process_state'");
                return [];
              },
            },
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
                      swap: () => Effect.sync(unexpected),
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
