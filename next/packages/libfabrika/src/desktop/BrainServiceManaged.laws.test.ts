// P19 next/. L1/L2/L4/L5 drive the real service through held native replies and TestClock.
import { expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Fiber, Formatter, Layer, Logger, Schema, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as Outside from "./BrainControl.test-support.ts";
import { BrainService } from "./BrainService.ts";
import * as ServiceTest from "./BrainServiceTest.ts";

const schedule = Schema.Struct({
  steps: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
    Schema.isMinLength(15),
    Schema.isMaxLength(60),
  ),
  repeat: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 5 })),
  initial: Schema.Literals(["absent", "matching", "foreign", "starting"]),
});

const checks = (numRuns: number) => ({ arbitrary: { seed: 119120, numRuns } });
type Outside = Effect.Success<ReturnType<typeof Outside.make>>;

const progress = Effect.fnUntraced(function* (outside: Outside, n: number, action: "up" | "stop", wait = false) {
  yield* Effect.yieldNow;
  const call = yield* outside.take;

  if (call === undefined) {
    yield* TestClock.adjust("1 millis");
    return;
  }

  const before = yield* outside.read;

  if (call.action === "start") {
    yield* outside.observe({ job: Outside.loaded(), listener: "waiting", children: "alive" });
  }

  if (call.action === "ready" && !wait) {
    yield* outside.observe({ listener: n % 3 === 0 ? "waiting" : "ready" });
  }

  if (call.action === "inspect" && action === "stop" && outside.calls.includes("stop") && !wait && n % 3 !== 0) {
    yield* outside.observe({ job: Outside.absent });
  }

  if (call.action === "cleanup" && !wait) {
    yield* outside.observe({ children: "gone", listener: "waiting" });
  }

  expect(
    call.action !== "remove" ||
      (before.job._tag === "absent" && before.children === "gone" && before.listener !== "ready"),
  ).toBe(true);
  yield* call.release;
  yield* Effect.yieldNow;
  yield* TestClock.adjust("1 millis");
});

const finish = Effect.fnUntraced(function* <A, E>(
  outside: Outside,
  fiber: Fiber.Fiber<A, E>,
  action: "up" | "stop",
  steps: ReadonlyArray<number>,
) {
  for (let n = 0; n < 100 && fiber.pollUnsafe() === undefined; n++) {
    yield* progress(outside, n < (steps[0] ?? 0) % 3 ? 0 : n, action);
  }

  expect(fiber.pollUnsafe(), "bounded operation completes").toBeDefined();
  return yield* Fiber.await(fiber);
});

const reason = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);

it.effect.prop(
  "L1 absent installs once, matches reuse, foreign jobs are untouched",
  [schedule],
  ([v]) =>
    Effect.gen(function* () {
      const job =
        v.initial === "absent"
          ? Outside.absent
          : v.initial === "foreign"
            ? Outside.foreign
            : Outside.loaded(Outside.spec, v.initial === "starting" ? null : 81);
      const outside = yield* Outside.make({
        job,
        file: v.initial === "absent" ? "absent" : "matching",
        listener: "ready",
      });
      const settings = yield* ServiceTest.timing();
      const context = yield* Layer.build(ServiceTest.layer(outside, settings));
      const brain = Context.get(context, BrainService);

      for (let i = 0; i < v.repeat; i++) {
        const from = outside.calls.length;
        const result = yield* finish(outside, yield* Effect.forkScoped(brain.up), "up", v.steps);
        expect(Exit.isSuccess(result)).toBe(v.initial !== "foreign");
        expect(outside.calls.slice(from)[0]).toBe("inspect");

        if (Exit.isSuccess(result)) {
          expect(result.value.url).toBe(Outside.spec.url);
        }
      }

      const wanted = v.initial === "absent" ? 1 : 0;
      expect(outside.calls.filter((a) => a === "install")).toHaveLength(wanted);
      expect(outside.calls.filter((a) => a === "start")).toHaveLength(wanted);
      expect(outside.calls).not.toContain("stop");
    }),
  checks(200),
);

it.effect.prop(
  "L2 stop confirms absence, children and removal in order, including an absent job",
  [schedule],
  ([v]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make({
        job: v.initial === "absent" ? Outside.absent : Outside.loaded(),
        file: "matching",
        children: "alive",
        listener: "ready",
      });
      const settings = yield* ServiceTest.timing();
      const context = yield* Layer.build(ServiceTest.layer(outside, settings));
      const brain = Context.get(context, BrainService);

      for (let i = 0; i < v.repeat; i++) {
        const from = outside.calls.length;
        const stopped = yield* Effect.forkScoped(brain.stop);
        yield* Effect.yieldNow;
        expect(stopped.pollUnsafe()).toBeUndefined();
        const result = yield* finish(outside, stopped, "stop", v.steps);
        expect(Exit.isSuccess(result)).toBe(true);
        const calls = outside.calls.slice(from);
        expect(calls[0]).toBe("inspect");
        expect(calls).toContain("cleanup");
        expect(calls.indexOf("remove")).toBeGreaterThan(calls.indexOf("cleanup"));
        expect(yield* outside.read).toMatchObject({ job: Outside.absent, file: "absent", children: "gone" });
      }
    }),
  checks(200),
);

it.effect.prop(
  "L4 whole operations serialize while a native start is held, even after cancellation",
  [schedule, Schema.Boolean],
  ([v, cancel]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make();
      const settings = yield* ServiceTest.timing();
      const context = yield* Layer.build(ServiceTest.layer(outside, settings));
      const brain = Context.get(context, BrainService);
      const up = yield* Effect.forkScoped(brain.up);
      yield* Effect.yieldNow;
      const held = yield* outside.take;
      expect(held?.action).toBe("inspect");
      const stop = yield* Effect.forkScoped(brain.stop);
      const repeat = yield* Effect.forkScoped(brain.up);
      yield* Effect.yieldNow;
      expect(outside.pending).toHaveLength(0);
      expect(outside.calls).toEqual(["inspect"]);

      if (cancel) {
        yield* Fiber.interrupt(repeat);
      }

      yield* held?.release ?? Effect.die("no held inspect");
      expect(Exit.isSuccess(yield* finish(outside, up, "up", v.steps))).toBe(true);
      expect(Exit.isSuccess(yield* finish(outside, stop, "stop", v.steps))).toBe(true);

      if (!cancel) {
        expect(Exit.isSuccess(yield* finish(outside, repeat, "up", v.steps))).toBe(true);
      }

      expect(outside.calls.indexOf("stop")).toBeGreaterThan(outside.calls.indexOf("ready"));
    }),
  checks(150),
);

it.effect.prop(
  "L5 each deadline fails visibly, leaves the plist and retries the same address",
  [schedule, Schema.Literals(["up", "stop"])],
  ([v, action]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make({
        job: action === "stop" ? Outside.loaded() : Outside.absent,
        file: "matching",
        children: "alive",
      });
      const settings = yield* ServiceTest.timing();
      const context = yield* Layer.build(ServiceTest.layer(outside, settings));
      const brain = Context.get(context, BrainService);
      const first = yield* Effect.forkScoped(brain[action]);

      for (let n = 0; n < 30 && first.pollUnsafe() === undefined; n++) {
        yield* progress(outside, n, action, true);
      }

      yield* TestClock.adjust("30 millis");
      expect(first.pollUnsafe()).toBeDefined();
      expect(reason(yield* Fiber.await(first))).toMatchObject({
        _tag: "BrainServiceError",
        reason: { _tag: "Timeout", action },
      });
      expect(outside.calls).not.toContain("remove");
      expect((yield* outside.read).file).toBe("matching");
      const from = outside.calls.length;
      yield* outside.observe({ listener: "ready", children: "gone" });
      const retry = yield* finish(outside, yield* Effect.forkScoped(brain[action]), action, v.steps);
      expect(Exit.isSuccess(retry)).toBe(true);
      expect(outside.calls.slice(from)[0]).toBe("inspect");

      if (Exit.isSuccess(retry) && action === "up") {
        expect(retry.value).toEqual({ url: Outside.spec.url });
      }
    }),
  checks(100),
);

const Secret = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9]{8,20}$/));

it.effect.prop(
  "L10 [secrets] failed flows hide sentinel text and bytes in every public output",
  [schedule, Secret],
  ([v, word]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+ &=`;
      const outside = yield* Outside.make();
      const settings = yield* ServiceTest.timing();
      const logs: Array<string> = [],
        spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const logger = Logger.make((options) => {
        logs.push(Formatter.formatJson(options.message));
      });
      const work = Effect.gen(function* () {
        const context = yield* Layer.build(ServiceTest.layer(outside, settings));
        const brain = Context.get(context, BrainService);
        const fiber = yield* Effect.forkScoped(v.initial === "absent" ? brain.up : brain.stop);

        for (let n = 0; n < (v.steps[0] ?? 0) % 7; n++) {
          yield* Effect.yieldNow;

          if (["ready", "remove"].includes(outside.pending[0]?.action ?? "")) {
            break;
          }

          yield* progress(outside, n, v.initial === "absent" ? "up" : "stop");
        }

        yield* Effect.yieldNow;
        const call = yield* outside.take;
        expect(call).toBeDefined();
        yield* call?.fail(secret) ?? Effect.die("no held command to fail");
        yield* Effect.yieldNow;
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        const outputs = [
          Formatter.formatJson(exit),
          Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
          ...logs,
          Formatter.formatJson(
            spans.map((s) => ({ attributes: [...s.attributes], events: s.events, status: s.status })),
          ),
          Outside.spec.url,
        ];

        for (const output of outputs) {
          for (const form of [
            secret,
            encodeURIComponent(secret),
            JSON.stringify(secret).slice(1, -1),
            JSON.stringify([...new TextEncoder().encode(secret)]),
          ]) {
            expect(output).not.toContain(form);
          }
        }
      });
      yield* work.pipe(Effect.withTracer(tracer), Effect.provide(Logger.layer([logger])));
    }),
  checks(100),
);

it.effect.prop(
  "L1 a lost bootstrap race re-inspects and accepts only matching ownership",
  [schedule, Schema.Boolean],
  ([v, matching]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make();
      const context = yield* Layer.build(ServiceTest.layer(outside, yield* ServiceTest.timing()));
      const brain = Context.get(context, BrainService);
      const up = yield* Effect.forkScoped(brain.up);

      for (let n = 0; n < 10 && !outside.pending.some((call) => call.action === "start"); n++) {
        yield* progress(outside, n, "up");
      }

      const held = yield* outside.take;
      expect(held?.action).toBe("start");
      yield* outside.observe({ job: matching ? Outside.loaded() : Outside.foreign, listener: "ready" });
      yield* held?.fail("lost-bootstrap-race") ?? Effect.die("no start command to race");
      const result = yield* finish(outside, up, "up", v.steps);
      expect(Exit.isSuccess(result)).toBe(matching);
      expect(outside.calls.filter((action) => action === "inspect").length).toBeGreaterThanOrEqual(2);
      expect(outside.calls.filter((action) => action === "start")).toHaveLength(1);
      expect(outside.calls).not.toContain("stop");
    }),
  checks(200),
);

it.effect.prop(
  "L1 and L2 foreign listeners fail up, and foreign jobs cannot be stopped",
  [schedule],
  ([v]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make({ job: Outside.loaded(), listener: "foreign" });
      const context = yield* Layer.build(ServiceTest.layer(outside, yield* ServiceTest.timing()));
      const brain = Context.get(context, BrainService);
      const up = yield* Effect.forkScoped(brain.up);

      for (let n = 0; n < 30 && up.pollUnsafe() === undefined; n++) {
        yield* progress(outside, n, "up", true);
      }

      const failed = yield* Fiber.await(up);
      expect(reason(failed)).toMatchObject({ _tag: "BrainServiceError", reason: { _tag: "Conflict" } });
      yield* outside.observe({ job: Outside.foreign });
      const stopped = yield* finish(outside, yield* Effect.forkScoped(brain.stop), "stop", v.steps);
      expect(reason(stopped)).toMatchObject({ _tag: "BrainServiceError", reason: { _tag: "Conflict" } });
      expect(outside.calls).not.toContain("start");
      expect(outside.calls).not.toContain("stop");
      expect(outside.calls).not.toContain("remove");
    }),
  checks(200),
);
