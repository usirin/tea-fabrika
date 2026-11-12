import type { AnyCmdDef, CmdOf, Reducer, Settled } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { Duration, Option, Result, Schema } from "effect";

export const Model = Schema.TaggedUnion({
  idle: { next: Schema.Number, period: Schema.Int },
  running: { due: Schema.Number, period: Schema.Int },
});
export type Model = typeof Model.Type;

const Timer = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number });

export class ScheduledJobError extends Schema.TaggedError<ScheduledJobError>()("ScheduledJobError", {
  reason: Schema.Literals(["bad_period"]),
}) {}

export const wake = (model: Model): number | null => (model._tag === "idle" ? model.next : null);

/** The runner owns the alarm; this machine only chooses its next due time. */
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
