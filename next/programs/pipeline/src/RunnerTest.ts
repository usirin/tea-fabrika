import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Fiber, Logger, Redacted, Schema, type Scope, type Tracer } from "effect";
import * as Mail from "./Mail.ts";
import type { merger } from "./Merger.ts";

type Model = ReturnType<typeof merger>["machine"]["model"]["Type"];
type Saved = { readonly name: string; readonly at: number };

type Fault<R> =
  | { readonly kind: "fault"; readonly reason: R }
  | { readonly kind: "defect" }
  | { readonly kind: "interrupt" };

/** The Node caller supplies the real runner, stores and service controls. The suite owns the laws. */
export type World = {
  readonly host: {
    readonly fail: (
      method: "change" | "update" | "merge",
      fault: Fault<"unavailable" | "rate_limited" | "refused">,
    ) => Effect.Effect<void>;
    readonly crashMerge: Effect.Effect<void>;
    readonly calls: () => ReadonlyArray<{ readonly method: string }>;
    readonly read: (change: number) => Effect.Effect<{ readonly state: string } | undefined>;
  };
  readonly ci: {
    readonly fail: (method: "start" | "at", fault: Fault<"unavailable" | "rate_limited">) => Effect.Effect<void>;
  };
  readonly alarms: { readonly saved: Effect.Effect<ReadonlyArray<Saved>> };
  readonly current: () => {
    readonly model: Effect.Effect<Model | null, unknown>;
    readonly letters: (name: string) => Effect.Effect<ReadonlyArray<{ readonly m: unknown }>, unknown>;
    readonly checkpoint: Effect.Effect<unknown, unknown>;
  };
  readonly reset: Effect.Effect<void>;
  readonly reopen: Effect.Effect<void, unknown>;
  readonly fire: Effect.Effect<void, unknown>;
  readonly green: Effect.Effect<void>;
  readonly deliver: (input: unknown) => Effect.Effect<unknown, unknown>;
  readonly land: (ref: string) => Effect.Effect<unknown, unknown>;
  readonly savedReplies: Effect.Effect<ReadonlyArray<unknown>, unknown>;
};

export type Driver = {
  readonly open: (token?: Redacted.Redacted<string>) => Effect.Effect<World, unknown, Scope.Scope>;
  readonly capture: () => { readonly tracer: Tracer.Tracer; readonly text: () => ReadonlyArray<string> };
  readonly unleaked: (outputs: ReadonlyArray<string>, secrets: ReadonlyArray<string>) => void;
};

const NAME = "merger:1";

const replies = Effect.fnUntraced(function* (h: World) {
  return (yield* h.current().letters("queue")).map((letter) => Schema.decodeUnknownSync(Mail.Reply)(letter.m));
});

const finish = Effect.fnUntraced(function* (h: World) {
  for (let i = 0; i < 128; i++) {
    if ((yield* h.current().model)?._tag === "idle") {
      return;
    }

    yield* h.green;
    const result = yield* Fiber.await(yield* Effect.forkChild(h.fire));

    if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
      yield* h.reopen;
    } else if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause);
    }
  }

  expect((yield* h.current().model)?._tag).toBe("idle");
});

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
        form === "token"
          ? token
          : form === "bearer"
            ? `Bearer ${token}`
            : `https://invalid.test/auth?access_token=${token}`,
    };
  }),
);

export const suite = (driver: Driver) =>
  describe("the merger on the real Node runner", () => {
    it.effect("scenario: R1 lands one checked change through saved commands and alarms", () =>
      Effect.gen(function* () {
        // Only the runner saves commands, answers and alarms; one change keeps this integration short.
        const h = yield* driver.open();
        yield* h.land("r1");
        expect((yield* h.current().model)?._tag).toBe("checking");
        yield* h.green;
        yield* h.fire;
        const all = yield* replies(h);
        expect(all).toHaveLength(1);
        expect(all[0]?._tag).toBe("merged");
        expect(all[0]?.ref).toBe("r1");
        expect(yield* h.alarms.saved).toEqual([]);
      }),
    );
    it.effect("scenario: R2 reopens while checking and fires the same saved alarm", () =>
      Effect.gen(function* () {
        // Reopen exercises the runner's own database recovery, not a pure reducer's JSON round trip.
        const h = yield* driver.open();
        yield* h.land("r2");
        const before = yield* h.alarms.saved;
        expect(before.length).toBeGreaterThan(0);
        const model = yield* h.current().model;
        expect(model?._tag).toBe("checking");

        if (model?._tag === "checking") {
          expect(model.step._tag).toBe("waiting");
          expect(before).toContainEqual({ name: NAME, at: model.step.at });
        }

        yield* h.reopen;
        expect(yield* h.current().model).toEqual(model);
        expect(yield* h.alarms.saved).toEqual(before);
        yield* h.green;
        yield* h.fire;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(1);
        expect(yield* replies(h)).toHaveLength(1);
      }),
    );
    it.effect("scenario: R3 retries an interrupted merge only at its saved asking deadline", () =>
      Effect.gen(function* () {
        // The handler merged before interruption. Recovery cannot assume it is safe to call it again.
        const h = yield* driver.open();
        yield* h.land("r3");
        yield* h.green;
        yield* h.host.crashMerge;
        const crashed = yield* Effect.forkChild(h.fire);
        const exit = yield* Fiber.await(crashed);
        expect(Exit.isFailure(exit)).toBe(true);
        expect((yield* h.current().model)?._tag).toBe("merging");
        expect((yield* h.host.read(1))?.state).toBe("merged");
        expect(yield* replies(h)).toEqual([]);
        yield* h.reopen;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(1);
        yield* h.fire;
        expect(h.host.calls().filter((c) => c.method === "merge")).toHaveLength(2);
        expect((yield* replies(h))[0]?._tag).toBe("merged");
        expect((yield* replies(h))[0]?.ref).toBe("r3");
        expect(yield* replies(h)).toHaveLength(1);
      }),
    );
    type Real = { h: World; inspect: Effect.Effect<void, unknown>; token: Redacted.Redacted<string> };
    const Cell = Schema.Struct({
      pick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      reason: Schema.Literals(["unavailable", "rate_limited", "refused"]),
      move: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    });
    const step = Effect.fnUntraced(function* (cell: typeof Cell.Type, m: { n: number }, r: Real) {
      const state = yield* r.h.current().model;

      if (state === null || state._tag === "idle") {
        if (state?._tag === "idle") {
          yield* r.inspect;
          r.h = yield* driver.open(r.token);
        }

        yield* r.h.host.fail(
          "change",
          cell.pick % 2 === 0 ? { kind: "fault", reason: cell.reason } : { kind: "defect" },
        );
        yield* r.h.land(`job${++m.n}`);
      } else {
        const possible = [
          "fire",
          "reopen",
          "busy",
          ...(state._tag === "merging" ? [] : ["abandon"]),
          "fault",
          "green",
          "crash",
        ];
        const move = possible[cell.move % possible.length];

        if (move === "reopen") {
          yield* r.h.reopen;
        } else if (move === "busy") {
          yield* r.h.land(`busy${m.n}`);
        } else if (move === "abandon") {
          yield* r.h.deliver(Mail.Abandon.make({ type: "abandon", ref: state.job.ref }));
        } else if (move === "fault") {
          if (state._tag === "checking" && cell.pick % 3 !== 0) {
            yield* r.h.ci.fail(
              cell.pick % 3 === 1 ? "start" : "at",
              cell.pick % 2 === 0
                ? { kind: "fault", reason: cell.reason === "refused" ? "unavailable" : cell.reason }
                : { kind: "defect" },
            );
          } else {
            yield* r.h.host.fail(
              state._tag === "reading"
                ? cell.pick % 3 === 0
                  ? "update"
                  : "change"
                : state._tag === "updating"
                  ? "update"
                  : "merge",
              cell.pick % 2 === 0 ? { kind: "fault", reason: cell.reason } : { kind: "defect" },
            );
          }
        } else if (move === "green") {
          yield* r.h.green;
        } else {
          if (move === "crash") {
            yield* r.h.green;
            yield* r.h.host.crashMerge;
          }

          const result = yield* Fiber.await(yield* Effect.forkChild(r.h.fire));

          if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
            yield* r.h.reopen;
          } else if (Exit.isFailure(result)) {
            return yield* Effect.failCause(result.cause);
          }
        }
      }

      yield* r.inspect;
    });
    const once = Effect.fnUntraced(function* (
      value: typeof secret extends Arbitrary.Arbitrary<infer A> ? A : never,
      commands: ReadonlyArray<typeof Cell.Type>,
    ) {
      const captured = driver.capture();
      const logs: Array<string> = [];
      const logger = Logger.map(Logger.formatSimple, (line) => {
        logs.push(line);
      });
      yield* Effect.gen(function* () {
        const h = yield* driver.open(Redacted.make(value.text));
        yield* h.host.fail("update", { kind: "fault", reason: "unavailable" });
        yield* h.host.fail("update", { kind: "defect" });
        yield* h.ci.fail("start", { kind: "fault", reason: "unavailable" });
        yield* h.ci.fail("start", { kind: "defect" });
        yield* h.ci.fail("at", { kind: "fault", reason: "rate_limited" });
        yield* h.ci.fail("at", { kind: "defect" });
        yield* h.land("initial");
        yield* h.land("busy");
        const inspect = Effect.gen(function* () {
          const letters = [...(yield* h.current().letters(NAME)), ...(yield* h.current().letters("queue"))];
          const checkpoint = yield* h.current().checkpoint;
          const savedReplies = yield* h.savedReplies;
          driver.unleaked(
            [
              JSON.stringify(letters),
              JSON.stringify(checkpoint),
              JSON.stringify(savedReplies),
              ...captured.text(),
              ...logs,
            ],
            [value.text, value.token, encodeURIComponent(value.text)],
          );
        });
        // Drain the scripted failures through the saved alarms before the random walk can abandon.
        yield* inspect;
        yield* finish(h);
        yield* inspect;
        const failures = (yield* h.current().letters(NAME)).map((letter) => letter.m);

        for (const reason of ["unavailable", "handler_failed"]) {
          expect(failures).toContainEqual(
            expect.objectContaining({
              type: "checks_err",
              cmd: expect.objectContaining({ start: true }),
              error: Schema.TaggedStruct(reason, {}).make({}),
            }),
          );
        }

        yield* inspect;
        const walking = yield* driver.open(Redacted.make(value.text));
        yield* walking.land("walking");
        const walk: Real = {
          h: walking,
          token: Redacted.make(value.text),
          inspect: Effect.suspend(() =>
            Effect.gen(function* () {
              driver.unleaked(
                [
                  JSON.stringify(yield* walk.h.current().checkpoint),
                  JSON.stringify(yield* walk.h.current().letters(NAME)),
                  JSON.stringify(yield* walk.h.current().letters("queue")),
                  JSON.stringify(yield* walk.h.savedReplies),
                  ...captured.text(),
                  ...logs,
                ],
                [value.text, value.token],
              );
            }),
          ),
        };
        const model = { n: 0 };

        for (const command of commands) {
          yield* step(command, model, walk);
        }

        // Finish a real checked merge so captures cannot be empty even when the random walk abandoned.
        yield* finish(walk.h);
        yield* walk.inspect;
        const status = yield* h.host.read(1);

        if (status?.state === "open") {
          const final = yield* driver.open(Redacted.make(value.text));
          yield* final.land("finish");
          yield* finish(final);
          driver.unleaked(
            [
              JSON.stringify(yield* final.current().checkpoint),
              JSON.stringify(yield* final.current().letters(NAME)),
              JSON.stringify(yield* final.current().letters("queue")),
              ...captured.text(),
              ...logs,
            ],
            [value.text, value.token],
          );
        }

        yield* inspect;
        const spans = captured.text().join("\n");
        expect(spans).toContain("fab.change");
        expect(spans).toContain("fab.head");
        expect((yield* h.current().letters(NAME)).length).toBeGreaterThan(0);
        expect((yield* h.savedReplies).some((reply) => reply !== null)).toBe(true);
      }).pipe(Effect.withTracer(captured.tracer), Effect.provide(Logger.layer([logger])));
    });
    it.effect.prop(
      "S1: [secrets] generated service failures stay out of every durable record, span and log",
      [secret, Arbitrary.array(Arbitrary.schema(Cell), { maxLength: 24 })],
      ([value, commands]) => Effect.scoped(once(value, commands)),
      { arbitrary: { seed: 119120, runs: 40, size: 24 } },
    );
  });
