import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Fiber, Logger, Redacted, Schema, type Scope, type Tracer } from "effect";
import * as fc from "fast-check";
import { vi } from "vitest";
import * as Mail from "./Mail.ts";
import type { queue } from "./Queue.ts";

type QueueModel = ReturnType<typeof queue>["machine"]["model"]["Type"];

type Fault<R> =
  | { readonly kind: "fault"; readonly reason: R }
  | { readonly kind: "defect" }
  | { readonly kind: "interrupt" };

export type Snapshot = {
  readonly model: QueueModel | null;
  readonly view: unknown;
  readonly starts: ReadonlyArray<{
    readonly name: string;
    readonly process: string;
    readonly program: string;
    readonly state: string;
    readonly reason: unknown;
  }>;
  readonly letters: ReadonlyArray<{
    readonly name: string;
    readonly id: string;
    readonly pos: number;
    readonly m: unknown;
  }>;
  readonly saved: ReadonlyArray<unknown>;
};

/** One host, with real runners, starts, mail and stores; the caller owns the driver. */
export type World = {
  readonly enqueue: (change: number, ref: string | null) => Effect.Effect<unknown, unknown>;
  readonly drop: (change: number) => Effect.Effect<unknown, unknown>;
  readonly resume: Effect.Effect<unknown, unknown>;
  readonly reopen: Effect.Effect<void, unknown>;
  readonly step: Effect.Effect<void, unknown>;
  readonly green: (change: number) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<Snapshot, unknown>;
  readonly host: {
    readonly fail: (
      method: "update" | "merge",
      fault: Fault<"unavailable" | "rate_limited" | "refused">,
    ) => Effect.Effect<void>;
    readonly calls: () => ReadonlyArray<{ readonly method: string; readonly change: number }>;
    readonly read: (change: number) => Effect.Effect<{ readonly head: string } | undefined>;
  };
  readonly ci: {
    readonly fail: (method: "start" | "at", fault: Fault<"unavailable" | "rate_limited">) => Effect.Effect<void>;
    readonly starts: () => ReadonlyArray<string>;
  };
  readonly moveMain: Effect.Effect<void>;
  readonly moveBeforeMerge: Effect.Effect<void>;
  readonly allowStart: (allowed: boolean) => Effect.Effect<void>;
};

export type Driver = {
  readonly open: (token?: Redacted.Redacted<string>) => Effect.Effect<World, unknown, Scope.Scope>;
  readonly capture: () => { readonly tracer: Tracer.Tracer; readonly text: () => ReadonlyArray<string> };
  readonly unleaked: (outputs: ReadonlyArray<string>, secrets: ReadonlyArray<string>) => void;
};

const replies = (snapshot: Snapshot, change: number) =>
  snapshot.letters.filter((l) => l.name === `lane:${change}`).map((l) => Schema.decodeUnknownSync(Mail.Reply)(l.m));

const finish = Effect.fnUntraced(function* (h: World) {
  for (let turn = 0; turn < 96; turn++) {
    const state = (yield* h.snapshot).model;

    if (state?._tag === "idle" || state?._tag === "stopped") {
      return;
    }

    for (let change = 1; change <= 6; change++) {
      yield* h.green(change);
    }

    yield* h.step;
  }

  expect((yield* h.snapshot).model?._tag, "a finite landing finishes").toBe("idle");
});

const started = (s: Snapshot) => s.starts.filter((p) => p.program === "pipeline/merger");

const allNormal = (s: Snapshot) => {
  for (const merger of started(s)) {
    expect(merger.state).toBe("ended");
    expect(merger.reason).toHaveProperty("_tag", "normal");
  }
};

const secret = Arbitrary.schema(
  Schema.Struct({
    prefix: Schema.Literals(["ghp_", "github_pat_"]),
    body: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{32}$/)),
    form: Schema.Literals(["token", "bearer", "url"]),
  }),
).pipe(
  Arbitrary.map(({ prefix, body, form }) => {
    const token = `${prefix}${body}`;
    return {
      token,
      text:
        form === "bearer" ? `Bearer ${token}` : form === "url" ? `https://invalid.test/?access_token=${token}` : token,
    };
  }),
);

const cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  reason: fc.constantFrom("unavailable", "rate_limited", "refused"),
  fault: fc.constantFrom("fault", "defect", "interrupt"),
});

type Cell = typeof cell extends fc.Arbitrary<infer A> ? A : never;

const q5Runs = 200;
const s2Runs = 40;

// Effect Arbitrary has no command-list generator. A generated seed draws fast-check's tape.
const tapes = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 31 - 1 }))).pipe(
  Arbitrary.map((seed) => {
    const tape = fc.sample(
      fc.commands(
        [
          cell.map((value): fc.Command<{ cells: Array<Cell> }, object> => ({
            check: () => true,
            run: (m) => {
              m.cells.push(value);
            },
            toString: () => JSON.stringify(value),
          })),
        ],
        { maxCommands: 24, size: "max" },
      ),
      { seed, numRuns: 1 },
    )[0];

    if (tape === undefined) {
      throw new Error("the command generator must return its one requested tape");
    }

    return tape;
  }),
);

export const suite = (driver: Driver) =>
  describe("the queue on real runners, next/", () => {
    it.effect.prop(
      "Q5: a real refused start stops, keeps the entry and resumes under a fresh name",
      {
        change: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
        ref: Schema.NonEmptyString.check(Schema.isMaxLength(24)),
      },
      ({ change, ref }) =>
        Effect.gen(function* () {
          const h = yield* driver.open();
          yield* h.allowStart(false);
          yield* h.enqueue(change, ref);
          const refused = yield* h.snapshot;
          expect(refused.letters).toContainEqual(
            expect.objectContaining({
              name: "queue:1",
              m: expect.objectContaining({ type: "start_child_err", reason: "forbidden" }),
            }),
          );
          expect(refused.model?._tag).toBe("stopped");
          expect(refused.model).toHaveProperty("reason._tag", "start_refused");
          expect(refused.model).toMatchObject({
            attempt: 1,
            reason: { change, name: `merger:${change}.1`, refusal: "forbidden" },
            line: [{ change }],
          });
          expect(started(refused)).toEqual([]);
          expect(replies(refused, change)).toEqual([]);
          yield* h.allowStart(true);
          yield* h.resume;
          expect(started(yield* h.snapshot).map((p) => p.name)).toEqual([`merger:${change}.2`]);
          yield* finish(h);
          const landed = yield* h.snapshot;
          expect(landed.model?._tag).toBe("idle");
          expect(replies(landed, change)).toHaveLength(1);
          expect(replies(landed, change)[0]).toHaveProperty("_tag", "merged");
          expect(replies(landed, change)[0]).toHaveProperty("ref", ref);
          allNormal(landed);
        }).pipe(Effect.scoped),
      // 200 isolated worlds each refuse a real start, then start and finish a real merger.
      // Measured 23.5 s locally; 500 ms per world gives about four times that total.
      { timeout: q5Runs * 500, arbitrary: { seed: 119120, runs: q5Runs } },
    );
    it.effect.prop(
      "QR5: each start is answered and folded once across reopens",
      {
        reopens: Schema.Array(Schema.Boolean).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
        change: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
        ref: Schema.NonEmptyString.check(Schema.isMaxLength(24)),
      },
      ({ reopens, change, ref }) =>
        Effect.gen(function* () {
          const h = yield* driver.open();
          yield* h.allowStart(false);
          const answerIds: Array<string> = [];
          const inspect = (s: Snapshot, attempts: number, refused: number) => {
            const queue = s.starts.find((p) => p.name === "queue:1");
            expect(queue).toBeDefined();
            const inbox = s.letters.filter((l) => l.name === "queue:1");
            const requests = inbox.filter((l) =>
              Schema.is(Schema.Struct({ type: Schema.Literals(["enqueue", "resume"]) }))(l.m),
            );
            const answers = inbox.filter((l) =>
              Schema.is(Schema.Struct({ type: Schema.Literals(["start_child_ok", "start_child_err"]) }))(l.m),
            );
            expect(requests).toHaveLength(attempts);
            expect(answers.map((l) => l.id)).toEqual(requests.map((l) => `${queue?.process}/${l.pos}/0/answer`));
            expect(answers.slice(0, answerIds.length).map((l) => l.id)).toEqual(answerIds);
            expect(new Set(answers.map((l) => l.id)).size).toBe(attempts);

            for (const answer of answers.slice(0, refused)) {
              expect(answer.m).toMatchObject({
                type: "start_child_err",
                cmd: { type: "start_child" },
                reason: "forbidden",
              });
              expect(Schema.decodeUnknownSync(Schema.Struct({ cmd: Schema.Unknown }))(answer.m).cmd).toEqual({
                type: "start_child",
              });
            }

            expect(s.model?.attempt).toBe(attempts);
            expect(s.model?.late).toBe(0);
            return answers.map((l) => l.id);
          };

          for (const [index, before] of reopens.entries()) {
            if (before) {
              yield* h.reopen;
            }

            yield* index === 0 ? h.enqueue(change, ref) : h.resume;

            if (!before) {
              yield* h.reopen;
            }

            yield* h.step;
            const s = yield* h.snapshot;
            expect(s.model?._tag).toBe("stopped");
            expect(s.model).toHaveProperty("reason._tag", "start_refused");
            expect(s.model).toMatchObject({
              reason: { change, name: `merger:${change}.${index + 1}`, refusal: "forbidden" },
              line: [{ change }],
            });
            expect(started(s)).toEqual([]);
            answerIds.splice(0, answerIds.length, ...inspect(s, index + 1, index + 1));
          }

          yield* h.allowStart(true);
          yield* h.resume;
          yield* h.reopen;
          yield* finish(h);
          const s = yield* h.snapshot;
          inspect(s, reopens.length + 1, reopens.length);
          expect(started(s).map((p) => p.name)).toEqual([`merger:${change}.${reopens.length + 1}`]);
          expect(s.model?._tag).toBe("idle");
          expect(replies(s, change)).toHaveLength(1);
          expect(replies(s, change)[0]).toHaveProperty("_tag", "merged");
          expect(replies(s, change)[0]).toHaveProperty("ref", ref);
          allNormal(s);
        }).pipe(Effect.scoped),
      { arbitrary: { seed: 119120, runs: 30 } },
    );
    it.effect("scenario: QR1 three real children land in arrival order and end normally", () =>
      Effect.gen(function* () {
        // Only real runners save a child start, its first letter and mail between processes.
        const h = yield* driver.open();

        for (let change = 1; change <= 3; change++) {
          yield* h.enqueue(change, `own:${change}`);
        }

        expect(started(yield* h.snapshot)).toHaveLength(1);
        yield* finish(h);
        const s = yield* h.snapshot;
        expect(s.model?._tag).toBe("idle");
        expect(started(s).map((p) => p.name)).toEqual(["merger:1.1", "merger:2.2", "merger:3.3"]);
        expect(
          h.host
            .calls()
            .filter((c) => c.method === "merge")
            .map((c) => c.change),
        ).toEqual([1, 2, 3]);

        for (let change = 1; change <= 3; change++) {
          expect(replies(s, change)).toHaveLength(1);
          expect(replies(s, change)[0]).toHaveProperty("_tag", "merged");
          expect(replies(s, change)[0]).toMatchObject({ type: "reply", ref: `own:${change}` });
          const first = s.letters.filter(
            (l) =>
              l.name === `merger:${change}.${change}` &&
              typeof l.m === "object" &&
              l.m !== null &&
              Reflect.get(l.m, "type") === "land",
          );
          expect(first).toHaveLength(1);
          expect(first[0]?.m).toMatchObject({ type: "land", change, ref: String(change), reply: "queue:1" });
        }

        allNormal(s);
      }),
    );
    it.effect("scenario: QR2 reopening the saved landing starts no child twice", () =>
      Effect.gen(function* () {
        // Reopening real stores exercises the runner's recovery rather than a JSON round trip.
        const h = yield* driver.open();
        yield* h.enqueue(1, "first");
        yield* h.enqueue(2, "second");
        const before = yield* h.snapshot;
        expect(before.model?._tag).toBe("landing");
        yield* h.reopen;
        expect((yield* h.snapshot).model).toEqual(before.model);
        yield* finish(h);
        const s = yield* h.snapshot;
        expect(started(s).map((p) => p.name)).toEqual(["merger:1.1", "merger:2.2"]);
        expect(replies(s, 1)).toHaveLength(1);
        expect(replies(s, 2)).toHaveLength(1);
        expect(s.model?._tag).toBe("idle");
        allNormal(s);
      }),
    );
    it.effect("scenario: QR3 main moves while checks run, so the new head is checked before merge", () =>
      Effect.gen(function* () {
        // This is the clash of 0146: checks on the old main cannot authorize a later landing.
        const h = yield* driver.open();
        yield* h.enqueue(1, "first");
        yield* h.enqueue(2, "clash");
        // Both original heads pass alone. The second must also pass with the first on main.
        yield* h.green(1);
        yield* h.green(2);

        for (let turn = 0; turn < 32; turn++) {
          const current = yield* h.host.read(2);

          if (current !== undefined && h.ci.starts().includes(current.head)) {
            break;
          }

          yield* h.step;
        }

        const before = yield* h.host.read(2);
        expect(before).toBeDefined();
        expect(h.ci.starts()).toContain(before?.head);
        expect(replies(yield* h.snapshot, 1)).toHaveLength(1);
        expect(h.host.calls().filter((c) => c.method === "merge" && c.change === 2)).toEqual([]);
        yield* h.green(2);
        yield* h.moveMain;
        yield* h.step;
        const after = yield* h.host.read(2);
        expect(after?.head).not.toBe(before?.head);
        expect(h.host.calls().filter((c) => c.method === "merge" && c.change === 2)).toEqual([]);
        expect(h.ci.starts()).toContain(after?.head);
        yield* finish(h);
        const s = yield* h.snapshot;
        const answer = replies(s, 2)[0];
        expect(answer).toHaveProperty("_tag", "merged");
        expect(answer).toHaveProperty("head", after?.head);

        if (answer?._tag === "merged") {
          expect(answer.tree).toBe(answer.checked);
        }

        expect(s.model?._tag).toBe("idle");
        expect(h.host.calls().filter((c) => c.method === "update" && c.change === 2).length).toBeGreaterThanOrEqual(3);
      }),
    );
    it.effect("scenario: QR4 an outside write after the last look stops the line until resume", () =>
      Effect.gen(function* () {
        // The squash can still race the last look. The post-merge tree comparison must catch it.
        const h = yield* driver.open();
        yield* h.enqueue(1, "drift");
        yield* h.enqueue(2, "waiting");
        yield* h.moveBeforeMerge;
        yield* finish(h);
        const s = yield* h.snapshot;
        const answer = replies(s, 1)[0];
        expect(s.model?._tag).toBe("stopped");
        expect(answer?._tag).toBe("merged");

        if (answer?._tag === "merged") {
          expect(answer.tree).not.toBe(answer.checked);
          expect(s.model).toMatchObject({
            reason: { commit: answer.commit, tree: answer.tree, checked: answer.checked },
          });
        }

        expect(started(s)).toHaveLength(1);
        expect(replies(s, 2)).toEqual([]);
        yield* h.resume;
        expect(started(yield* h.snapshot)).toHaveLength(2);
        yield* finish(h);
        expect(replies(yield* h.snapshot, 2)).toHaveLength(1);
      }),
    );

    it.effect.prop(
      "S2: [secrets] service failures stay out of queue mail, first letters, models, views, spans and logs",
      [secret, tapes],
      ([value, commands]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const capture = driver.capture();
            const logs: Array<string> = [];
            yield* Effect.forEach(
              ["log", "info", "warn", "error", "debug"] as const,
              (method) =>
                Effect.acquireRelease(
                  Effect.sync(() =>
                    vi.spyOn(console, method).mockImplementation((...args: ReadonlyArray<unknown>) => {
                      logs.push(args.map((arg) => `${String(arg)} ${JSON.stringify(arg)}`).join(" "));
                    }),
                  ),
                  (spy) => Effect.sync(() => spy.mockRestore()),
                ),
              { discard: true, concurrency: 1 },
            );
            const logger = Logger.map(Logger.formatSimple, (line) => {
              logs.push(line);
            });
            yield* Effect.gen(function* () {
              const h = yield* driver.open(Redacted.make(value.text));
              const inspect = Effect.gen(function* () {
                const s = yield* h.snapshot;
                driver.unleaked(
                  [
                    JSON.stringify(s.letters),
                    JSON.stringify(s.saved),
                    JSON.stringify(s.model),
                    JSON.stringify(s.view),
                    ...capture.text(),
                    ...logs,
                  ],
                  [value.text, value.token],
                );
                return s;
              });
              // These faults are consumed before random moves may abandon the first child.
              yield* h.host.fail("update", { kind: "fault", reason: "unavailable" });
              yield* h.host.fail("update", { kind: "defect" });
              yield* h.ci.fail("start", { kind: "fault", reason: "rate_limited" });
              yield* h.ci.fail("at", { kind: "defect" });
              yield* h.enqueue(1, "initial");
              yield* inspect;
              yield* finish(h);
              // Each look's snapshot is the state the next move reads: nothing runs in between.
              let seen = yield* inspect;
              const cells: Array<Cell> = [];
              fc.modelRun(() => ({ model: { cells }, real: {} }), commands);

              for (const cell of cells) {
                const state = seen.model;
                const current = state?._tag === "landing" || state?._tag === "starting" ? state.current.change : null;
                const moves = ["enqueue", "drop", "tick", "fault", "green", "reopen"];

                if (state?._tag === "stopped") {
                  moves.push("resume");
                }

                const move = moves[cell.move % moves.length];

                if (move === "enqueue") {
                  yield* h.enqueue((cell.pick % 5) + 2, cell.pick % 2 === 0 ? `own:${cell.pick}` : null);
                } else if (move === "drop") {
                  yield* h.drop(current !== null && cell.pick % 2 === 0 ? current : (cell.pick % 5) + 2);
                } else if (move === "reopen") {
                  yield* h.reopen;
                } else if (move === "resume") {
                  yield* h.resume;
                } else if (move === "green") {
                  if (current !== null) {
                    yield* h.green(current);
                  }
                } else if (move === "fault") {
                  if (cell.pick % 2 === 0) {
                    yield* h.host.fail(
                      cell.pick % 3 === 0 ? "merge" : "update",
                      cell.fault === "fault" ? { kind: "fault", reason: cell.reason } : { kind: cell.fault },
                    );
                  } else {
                    yield* h.ci.fail(
                      cell.pick % 3 === 0 ? "start" : "at",
                      cell.fault === "fault"
                        ? { kind: "fault", reason: cell.reason === "refused" ? "unavailable" : cell.reason }
                        : { kind: cell.fault },
                    );
                  }
                } else {
                  const result = yield* Fiber.await(yield* Effect.forkChild(h.step));

                  if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
                    yield* h.reopen;
                  } else if (Exit.isFailure(result)) {
                    return yield* Effect.failCause(result.cause);
                  }
                }

                seen = yield* inspect;
              }

              const s = seen;
              expect(s.letters.some((l) => l.name === "queue:1")).toBe(true);
              expect(s.letters.some((l) => l.name === "lane:1")).toBe(true);
              expect(started(s).length).toBeGreaterThan(0);
              const spans = capture.text().join("\n");
              expect(spans).toContain("start_child");
              expect(spans).toContain("merger:1.1");
              yield* inspect;
            }).pipe(Effect.withTracer(capture.tracer), Effect.provide(Logger.layer([logger])));
          }),
        ),
      // Each world finishes a faulted landing, then walks up to 24 moves, including store reopens.
      // Measured 14.6 s for 40 worlds locally, 35.3 s before the leak check asserted once for each
      // look; 3 s per world covers that counted work.
      { timeout: s2Runs * 3_000, arbitrary: { seed: 119120, runs: s2Runs, size: 24 } },
    );
  });
