import { Effect, Layer, type Option, Tracer } from "effect";

// The host's wide log, beyond what each part says of itself: one `key=value` line as a lane step
// begins and one as it ends, read off the step's own span; and one when the host's thread is
// starved. Today's version. The lines go to whatever loggers the host runs with: host/main.ts
// writes them to host/log (`Logger.formatSimple`), as every other line there.
//
//   a span gets tea.lane.run=r-build-3 tea.lane.step=build    level=INFO message=step_began run=r-build-3 step=build
//   it ends with tea.outcome=send:builder:checks_red           level=INFO message=step_ended run=r-build-3 step=build outcome=send:builder:checks_red
//   a second whose delay p99 is 240 ms                         level=WARN message=lag nodejs.eventloop.delay.p99=0.24 nodejs.eventloop.delay.max=0.4
//
// The step lines need the lane to tag "run a step" with its run and step as it begins
// (packages/pipeline, stages/pipeline/program.ts); its outcome comes at its end. A step that broke
// before it said one ends with no `outcome`. A span that is no lane step says nothing.
//
// The lag fields are OpenTelemetry's Node.js runtime names, in its unit, seconds
// (opentelemetry.io/docs/specs/semconv/runtime/nodejs-metrics/, read 2026-11-03). OTel marks them
// Development, so they may still change there. Node's `monitorEventLoopDelay` gives nanoseconds.
// host/run.ts reads it about once a second (`sampleLag`), and resets it each time, so each line
// is one second's delay.

/** The span tags a lane step carries (packages/pipeline, stages/traced.ts `LANE`, and `tea.outcome`). */
const TAG = { run: "tea.lane.run", step: "tea.lane.step", outcome: "tea.outcome" } as const;

/**
 * A second's p99 past this is a lag line, in seconds: 0.05 s, 50 ms. A long task is one over
 * 50 ms (W3C Long Tasks API), and web.dev's RAIL model asks for input handled within 50 ms. An idle
 * test host measured on 2026-11-03, on a laptop under load, had a second's p99 at most 23.61 ms,
 * over 90 one-second windows at Node's default 10 ms resolution; a bare Node process 16.97 ms.
 */
export const LAG_P99 = 0.05;

/** Nanoseconds as seconds, to the microsecond: the histogram counts at 10 ms, so no more is real. */
const seconds = (ns: number): number => Math.round(ns / 1e3) / 1e6;

/** A delay histogram, as Node's `monitorEventLoopDelay` gives one: nanoseconds, and a reset. */
interface DelayHistogram {
  readonly percentile: (p: number) => number;
  readonly max: number;
  readonly reset: () => void;
}

/** Read one second's delay, start the next second fresh, and say a lag line if its p99 passed `LAG_P99`. */
export const sampleLag = (histogram: DelayHistogram) =>
  Effect.suspend(() => {
    const p99 = seconds(histogram.percentile(99));
    const max = seconds(histogram.max);
    histogram.reset();
    return p99 <= LAG_P99
      ? Effect.void
      : Effect.logWarning("lag").pipe(
          Effect.annotateLogs({
            "nodejs.eventloop.delay.p99": p99,
            "nodejs.eventloop.delay.max": max,
          }),
        );
  });

/** One INFO line, its message and its fields. */
type Say = (message: string, fields: Readonly<Record<string, unknown>>) => void;

/** A span, as the tracer under it made it, that says a lane step's begin and end as its tags come. */
class StepSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly #span: Tracer.Span;
  readonly #say: Say;
  #began = false;

  constructor(span: Tracer.Span, say: Say) {
    this.#span = span;
    this.#say = say;
  }

  get name(): string {
    return this.#span.name;
  }

  get spanId(): string {
    return this.#span.spanId;
  }

  get traceId(): string {
    return this.#span.traceId;
  }

  get parent(): Option.Option<Tracer.AnySpan> {
    return this.#span.parent;
  }

  get annotations() {
    return this.#span.annotations;
  }

  get status(): Tracer.SpanStatus {
    return this.#span.status;
  }

  get attributes(): ReadonlyMap<string, unknown> {
    return this.#span.attributes;
  }

  get links(): ReadonlyArray<Tracer.SpanLink> {
    return this.#span.links;
  }

  get sampled(): boolean {
    return this.#span.sampled;
  }

  get kind(): Tracer.SpanKind {
    return this.#span.kind;
  }

  /** Its run and step, as tagged so far: a run comes with its step. */
  #where(): Record<string, unknown> {
    const run = this.#span.attributes.get(TAG.run);
    return {
      ...(run === undefined ? {} : { run }),
      step: this.#span.attributes.get(TAG.step),
    };
  }

  attribute(key: string, value: unknown): void {
    this.#span.attribute(key, value);

    if (key !== TAG.step || this.#began) {
      return;
    }

    this.#began = true;
    this.#say("step_began", this.#where());
  }

  end(endTime: bigint, exit: Parameters<Tracer.Span["end"]>[1]): void {
    this.#span.end(endTime, exit);

    if (!this.#began) {
      return;
    }

    const outcome = this.#span.attributes.get(TAG.outcome);
    this.#say("step_ended", { ...this.#where(), ...(outcome === undefined ? {} : { outcome }) });
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    this.#span.event(name, startTime, attributes);
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.#span.addLinks(links);
  }
}

/**
 * The tracer in use, its spans kept as it keeps them, and a lane step's begin and end said as
 * log lines (`step_began`, `step_ended`) to the loggers it is provided with. host/run.ts provides
 * it over `recordTracing`.
 */
export const logSteps: Layer.Layer<never> = Layer.effect(
  Tracer.Tracer,
  Effect.gen(function* () {
    const under = yield* Effect.tracer;
    const services = yield* Effect.context<never>();
    const say: Say = (message, fields) => {
      Effect.runForkWith(services)(Effect.logInfo(message).pipe(Effect.annotateLogs(fields)));
    };
    return Tracer.make({
      span: (options) => new StepSpan(under.span(options), say),
      ...(under.context === undefined ? {} : { context: under.context }),
    });
  }),
);
