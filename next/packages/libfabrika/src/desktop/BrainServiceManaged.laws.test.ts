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
  sameArity: Schema.Boolean,
});

const checks = (runs: number) => ({ arbitrary: { seed: 119120, runs } });
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
            ? {
                ...Outside.foreign,
                args: v.sameArity ? Outside.spec.args.map((arg) => `${arg}.foreign`) : Outside.foreign.args,
              }
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
        let loaded = 1 + ((v.steps[0] ?? 0) % 3);
        let children = 1 + ((v.steps[1] ?? 0) % 3);
        let listener = 1 + ((v.steps[2] ?? 0) % 3);

        // These facts are controlled independently: bootout never implies child or listener cleanup.
        for (let n = 0; n < 100 && stopped.pollUnsafe() === undefined; n++) {
          yield* Effect.yieldNow;
          const held = yield* outside.take;

          if (held === undefined) {
            yield* TestClock.adjust("1 millis");
            continue;
          }

          const world = yield* outside.read;
          expect(stopped.pollUnsafe(), `stop waits for ${held.action}`).toBeUndefined();

          if (held.action === "inspect" && outside.calls.slice(from).includes("stop")) {
            // First confirm that a successful bootout while still loaded cannot finish stop.
            if (world.job._tag === "loaded") {
              yield* held.release;
              yield* Effect.yieldNow;
              expect(stopped.pollUnsafe()).toBeUndefined();
              expect(outside.calls.slice(from)).not.toContain("remove");

              if (--loaded === 0) {
                yield* outside.observe({ job: Outside.absent });
              }

              continue;
            }
          }

          if (held.action === "cleanup" && (world.children === "alive" || world.listener === "ready")) {
            yield* held.release;
            yield* Effect.yieldNow;
            expect(stopped.pollUnsafe()).toBeUndefined();
            expect(outside.calls.slice(from)).not.toContain("remove");

            if (world.children === "alive" && --children === 0) {
              yield* outside.observe({ children: "gone" });
            } else if (world.children === "gone" && --listener === 0) {
              yield* outside.observe({ listener: "waiting" });
            }

            continue;
          }

          if (held.action === "remove") {
            expect(world).toMatchObject({
              job: Outside.absent,
              children: "gone",
              listener: "waiting",
              file: i === 0 ? "matching" : "absent",
            });
          }

          yield* held.release;
          yield* Effect.yieldNow;
        }

        expect(stopped.pollUnsafe()).toBeDefined();
        expect(Exit.isSuccess(yield* Fiber.await(stopped))).toBe(true);
        const calls = outside.calls.slice(from);
        expect(calls[0]).toBe("inspect");
        expect(calls).toContain("cleanup");
        expect(calls).toContain("remove");
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

      for (let n = 0; n < 10 && !outside.pending.some((call) => call.action === "start"); n++) {
        yield* progress(outside, n, "up");
      }

      const held = yield* outside.take;
      expect(held?.action).toBe("start");
      const before = outside.calls.slice();
      const stop = yield* Effect.forkScoped(brain.stop);
      const repeat = yield* Effect.forkScoped(brain.up);
      yield* Effect.yieldNow;
      expect(outside.pending).toHaveLength(0);
      expect(outside.calls).toEqual(before);
      expect(stop.pollUnsafe()).toBeUndefined();
      expect(repeat.pollUnsafe()).toBeUndefined();

      if (cancel) {
        yield* Fiber.interrupt(repeat);
      }

      yield* outside.observe({ job: Outside.loaded(), listener: "ready", children: "alive" });

      if ((v.steps[1] ?? 0) % 2 === 0) {
        yield* Fiber.interrupt(up);
        const interrupted = yield* Fiber.await(up);
        expect(Exit.isFailure(interrupted)).toBe(true);
        // A late native completion after cancellation cannot complete the following stop.
        yield* held?.release ?? Effect.die("no held start");
      } else {
        yield* held?.release ?? Effect.die("no held start");
        expect(Exit.isSuccess(yield* finish(outside, up, "up", v.steps))).toBe(true);
      }

      expect(Exit.isSuccess(yield* finish(outside, stop, "stop", v.steps))).toBe(true);

      if (!cancel) {
        expect(Exit.isSuccess(yield* finish(outside, repeat, "up", v.steps))).toBe(true);
      }

      expect(outside.calls.filter((action) => action === "inspect").length).toBeGreaterThanOrEqual(2);
      expect(outside.calls.indexOf("stop")).toBeGreaterThan(outside.calls.indexOf("start"));
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
  "L5 asynchronous record delivery cannot replace a lifecycle Timeout",
  [schedule, Schema.Literals(["up", "stop"]), Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))],
  ([v, action, deliveryDelay]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make({
        job: action === "stop" ? Outside.loaded() : Outside.absent,
        file: "matching",
        children: "alive",
      });
      const settings = yield* ServiceTest.timing();
      let flushes = 0;
      const context = yield* Layer.build(
        ServiceTest.layer(outside, settings, {
          batch: (work) => work,
          flush: Effect.gen(function* () {
            flushes++;
            yield* Effect.sleep(`${deliveryDelay} millis`);
            return { sent: 0 };
          }),
          summaries: () => Effect.succeed([]),
          sums: () => Effect.succeed([]),
        }),
      );
      const brain = Context.get(context, BrainService);
      const first = yield* Effect.forkScoped(brain[action]);

      // Hold whichever native command this walk reaches, then expire the lifecycle.
      for (let n = 0; n < (v.steps[0] ?? 0) % 3; n++) {
        yield* progress(outside, n, action, true);
      }

      yield* Effect.yieldNow;
      expect(outside.pending.length).toBeGreaterThan(0);
      yield* TestClock.adjust("30 millis");
      expect(first.pollUnsafe(), "record delivery also has a bounded wait").toBeDefined();
      expect(flushes).toBeGreaterThan(0);
      expect(reason(yield* Fiber.await(first))).toMatchObject({
        _tag: "BrainServiceError",
        reason: { _tag: "Timeout", action },
      });
      expect(outside.calls).not.toContain("remove");
      expect((yield* outside.read).file).toBe("matching");
    }),
  checks(100),
);

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

        // A failed bootstrap re-inspects ownership before settling the operation.
        for (let n = 0; n < 100 && fiber.pollUnsafe() === undefined; n++) {
          yield* Effect.yieldNow;
          const retry = yield* outside.take;

          if (retry !== undefined) {
            yield* retry.fail(secret);
          }
        }

        expect(fiber.pollUnsafe(), "failed native replies settle the operation").toBeDefined();
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
