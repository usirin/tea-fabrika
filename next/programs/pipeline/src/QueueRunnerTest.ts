import { describe, expect, it } from "@effect/vitest";
import type * as CiTest from "@kampus/libfabrika/ci/CiTest";
import type * as CodeHostTest from "@kampus/libfabrika/codehost/CodeHostTest";
import { Arbitrary, Cause, Effect, Exit, Fiber, Logger, Redacted, Schema, type Scope, type Tracer } from "effect";
import * as fc from "fast-check";
import * as Mail from "./Mail.ts";
import type { queue } from "./Queue.ts";

type QueueModel = ReturnType<typeof queue>["machine"]["model"]["Type"];

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
  readonly letters: ReadonlyArray<{ readonly name: string; readonly m: unknown }>;
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
  readonly host: CodeHostTest.Control["Service"];
  readonly ci: CiTest.Control["Service"];
  readonly moveMain: Effect.Effect<void>;
  readonly moveBeforeMerge: Effect.Effect<void>;
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
        yield* h.step;
        yield* h.step;
        const before = yield* h.host.read(2);
        expect(before).toBeDefined();
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
              });
              // These faults are consumed before random moves may abandon the first child.
              yield* h.host.fail("update", { kind: "fault", reason: "unavailable" });
              yield* h.host.fail("update", { kind: "defect" });
              yield* h.ci.fail("start", { kind: "fault", reason: "rate_limited" });
              yield* h.ci.fail("at", { kind: "defect" });
              yield* h.enqueue(1, "initial");
              yield* inspect;
              yield* finish(h);
              yield* inspect;
              const cells: Array<Cell> = [];
              fc.modelRun(() => ({ model: { cells }, real: {} }), commands);

              for (const cell of cells) {
                const state = (yield* h.snapshot).model;
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

                yield* inspect;
              }

              const s = yield* h.snapshot;
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
      { arbitrary: { seed: 119120, runs: 40, size: 24 } },
    );
  });
