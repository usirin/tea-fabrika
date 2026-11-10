import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { LAG_P99, logSteps, sampleLag } from "./log.ts";

// The host's wide log, piece by piece: one `key=value` line as a lane step begins and as it ends
// with its outcome, read off the step's own span; and one lag line from a second's event-loop
// delay, when its p99 passes `LAG_P99`. Today's version. The lines are caught through Effect's
// `Logger`, in the format host/main.ts writes host/log in (`Logger.formatSimple`).
//
//   a span gets tea.lane.run=r-build-3 tea.lane.step=build    message=step_began run=r-build-3 step=build
//   it ends with tea.outcome=send:builder:checks_red           message=step_ended run=r-build-3 step=build outcome=send:builder:checks_red
//   a second whose delay p99 is 240 ms                         level=WARN message=lag nodejs.eventloop.delay.p99=0.24 nodejs.eventloop.delay.max=0.4
//
// The lag fields are OpenTelemetry's Node.js runtime names, in its unit, seconds
// (opentelemetry.io/docs/specs/semconv/runtime/nodejs-metrics/, read 2026-11-03). OTel marks them
// Development, so they may still change there.
//
// The threshold, 0.05 s (50 ms): a long task is one over 50 ms (W3C Long Tasks API; web.dev's RAIL model
// asks for input handled within 50 ms). An idle test host measured on 2026-11-03, on a laptop
// under load (load average about 12), had a second's p99 at most 23.61 ms, over 90 one-second
// windows at Node's default 10 ms resolution, a bare Node process 16.97 ms. So 50 ms is about
// twice what idle shows, and no idle second writes a line.

/** Every line logged while `effect` runs, as host/log would hold it. */
const logged = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: string[] = [];
    const caught = Logger.make((o) => {
      lines.push(Logger.formatSimple.log(o));
    });
    yield* effect.pipe(Effect.provide(Logger.layer([caught])));
    // A line may be written by a fiber of its own: give it a moment.
    yield* Effect.sleep("20 millis");
    return lines;
  });

const fieldsOf = (line: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const [, key = "", raw = ""] = m;
    out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
  }

  return out;
};

/**
 * A delay histogram as Node's `monitorEventLoopDelay` gives one: nanoseconds, and a reset. It is
 * made from seconds, the lag line's unit.
 */
const histogram = (p99: number, max: number) => {
  const asked: number[] = [];
  let resets = 0;
  return {
    percentile: (p: number) => {
      asked.push(p);
      return p99 * 1e9;
    },
    max: max * 1e9,
    reset: () => {
      resets += 1;
    },
    asked,
    resets: () => resets,
  };
};

describe("a lane step's lines", () => {
  it("writes one as the step begins and one as it ends, with its outcome", async () => {
    const lines = await Effect.runPromise(
      logged(
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              "tea.lane.run": "r-build-3",
              "tea.lane.step": "build",
            });
            yield* Effect.sleep("5 millis");
            yield* Effect.annotateCurrentSpan({ "tea.outcome": "send:builder:checks_red" });
          }).pipe(Effect.withSpan("run a step"));
          // A span that is no lane step says nothing.
          yield* Effect.void.pipe(Effect.withSpan("read the ticket"));
        }).pipe(Effect.provide(logSteps)),
      ),
    );
    const fields = lines.map(fieldsOf);
    expect(fields.map((f) => f.message)).toEqual(["step_began", "step_ended"]);
    expect(fields[0]).toMatchObject({ level: "INFO", run: "r-build-3", step: "build" });
    expect(fields[0]?.outcome).toBeUndefined();
    expect(fields[1]).toMatchObject({
      level: "INFO",
      run: "r-build-3",
      step: "build",
      outcome: "send:builder:checks_red",
    });
  });

  it("still ends with a line when the step broke before it said its outcome", async () => {
    const lines = await Effect.runPromise(
      logged(
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({ "tea.lane.run": "r-plan-1", "tea.lane.step": "plan" });
          return yield* Effect.die("the agent's box went away");
        }).pipe(Effect.withSpan("run a step"), Effect.exit, Effect.provide(logSteps)),
      ),
    );
    const ended = lines.map(fieldsOf).filter((f) => f.message === "step_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ run: "r-plan-1", step: "plan" });
  });
});

describe("the event loop's lag", () => {
  it("passes at 0.05 s, a long task's length", () => {
    expect(LAG_P99).toBe(0.05);
  });

  it("writes one warning when a second's p99 passes the line, and starts the next second fresh", async () => {
    const h = histogram(0.24, 0.4);
    const lines = await Effect.runPromise(logged(sampleLag(h)));
    expect(lines).toHaveLength(1);
    expect(fieldsOf(lines[0] ?? "")).toMatchObject({
      level: "WARN",
      message: "lag",
      "nodejs.eventloop.delay.p99": "0.24",
      "nodejs.eventloop.delay.max": "0.4",
    });
    expect(h.asked).toContain(99);
    expect(h.resets()).toBe(1);
  });

  it("writes nothing at or under the line, and still starts the next second fresh", async () => {
    for (const p99 of [0.012, 0.02361, LAG_P99]) {
      const h = histogram(p99, 0.03);
      const lines = await Effect.runPromise(logged(sampleLag(h)));
      expect(lines).toEqual([]);
      expect(h.resets()).toBe(1);
    }
  });
});
