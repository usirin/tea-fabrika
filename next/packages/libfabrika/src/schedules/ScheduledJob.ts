/**
 * A machine that picks the next due time of a repeating job. The runner owns the alarm.
 *
 * @stability unstable
 */
import type { AnyCmdDef, CmdOf, Reducer, Settled } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { Duration, Option, Result, Schema } from "effect";

/**
 * Schema for the job's state: `idle` with the next due time, or `running` with the time of the
 * timer message that started it. Both keep the period in milliseconds.
 *
 * @stability unstable
 * @category models
 */
export const Model = Schema.TaggedUnion({
  idle: { next: Schema.Number, period: Schema.Int },
  running: { due: Schema.Number, period: Schema.Int },
});
/**
 * The job's state: `idle` with the next due time, or `running` with the time of the timer message
 * that started it.
 *
 * @stability unstable
 * @category models
 */
export type Model = typeof Model.Type;

const Timer = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number });

/**
 * The period given to `make` is not a whole, positive number of milliseconds.
 *
 * @stability unstable
 * @category errors
 */
export class ScheduledJobError extends Schema.TaggedError<ScheduledJobError>()("ScheduledJobError", {
  reason: Schema.Literals(["bad_period"]),
}) {}

/**
 * Returns the time the runner should wake the job next, or null while the job is running.
 *
 * @stability unstable
 * @category getters
 */
export const wake = (model: Model): number | null => (model._tag === "idle" ? model.next : null);

/**
 * Creates the machine for a repeating job, as a `Result` that holds `ScheduledJobError` for a bad
 * period.
 *
 * **Details**
 *
 * The machine starts idle and due at time 0, unless it is given a saved state. A timer message at
 * or after the due time starts the job: the machine runs `work` with the timer's time and the
 * period. When
 * the command settles, ok or error, it goes idle again and the next due time is the settle time
 * plus the period. A timer message that arrives early, or while running, changes nothing.
 *
 * **Gotchas**
 *
 * The period must come to a whole number of milliseconds. A fraction of a millisecond is refused.
 *
 * @stability unstable
 * @category constructors
 */
export const make = <C extends AnyCmdDef>(config: {
  readonly period: Duration.Input;
  readonly cmd: C;
  readonly work: (due: number, period: number) => CmdOf<C>;
}) => {
  if (typeof config.period === "number" && !Number.isSafeInteger(config.period)) {
    return Result.fail(new ScheduledJobError({ reason: "bad_period" }));
  }

  const duration = Duration.fromInput(config.period);
  const period = Option.isSome(duration) ? Duration.toMillis(duration.value) : Number.NaN;

  const nanos = Option.flatMap(duration, Duration.toNanos);

  if (!Number.isSafeInteger(period) || period <= 0 || Option.isNone(nanos) || nanos.value % 1_000_000n !== 0n) {
    return Result.fail(new ScheduledJobError({ reason: "bad_period" }));
  }

  const settle = (s: Model, m: { readonly at: number }): readonly [Model, readonly CmdOf<C>[]] =>
    s._tag === "running" ? [Model.cases.idle.make({ next: m.at + s.period, period: s.period }), []] : [s, []];

  const machine = Machine.make({
    model: Model,
    msg: Timer,
    cmds: [config.cmd],
    init: (loaded) => [loaded ?? Model.cases.idle.make({ next: 0, period }), []],
    // Computed command keys form the settled-message reducer for this command.
    update: {
      timer: (s: Model, m: { readonly at: number }): readonly [Model, readonly CmdOf<C>[]] =>
        s._tag === "idle" && m.at >= s.next
          ? [Model.cases.running.make({ due: m.at, period: s.period }), [config.work(m.at, s.period)]]
          : [s, []],
      [config.cmd.okType]: settle,
      [config.cmd.errType]: settle,
    } as Reducer<Model, typeof Timer.Type | Settled<C>, CmdOf<C>>,
  });

  return Result.succeed({ machine });
};
