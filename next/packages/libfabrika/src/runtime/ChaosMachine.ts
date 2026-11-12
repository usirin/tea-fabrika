/**
 * Bounded chaos: saved requests precede outside work, and unanswered work stays unknown.
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import * as Chaos from "./Chaos.ts";
import * as ChaosSchedule from "./ChaosSchedule.ts";

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Positive = Count.check(Schema.isGreaterThanOrEqualTo(1));
const Errors = ["NemesisError", "handler_failed", "bad_cmd"] as const;
const SettledErrors = [...Errors, "malformed_result"] as const;
const Error = Schema.Union(SettledErrors.map((tag) => Schema.TaggedStruct(tag, {})));
const Request = Schema.Struct({ id: Chaos.ExperimentId });
const Inspect = Schema.Struct({ ...Request.fields, target: Chaos.Target });

/**
 * Ask the host for authoritative time for this experiment.
 * @stability unstable
 * @category commands
 */
export const now = Cmd.make("now", { input: Schema.toType(Request), ok: Count, err: Errors });

/**
 * Request the recorded fault through the trusted host handler.
 * @stability unstable
 * @category commands
 */
export const fire = Cmd.make("fire", { input: Schema.toType(Chaos.Fire), ok: Schema.toType(Chaos.Fired), err: Errors });

/**
 * Read the target's bounded history once the fault cap is reached.
 * @stability unstable
 * @category commands
 */
export const inspect = Cmd.make("inspect", {
  input: Schema.toType(Inspect),
  ok: Schema.toType(Chaos.Report),
  err: Errors,
});

const Asked = Schema.Struct({ ordinal: Positive, fault: Chaos.Fault, deadline: Count, at: Count });

const Did = Schema.Struct({
  ordinal: Positive,
  at: Count,
  result: Schema.TaggedUnion({ answered: { value: Chaos.Fired }, failed: { reason: Schema.Literals(SettledErrors) } }),
});

const Experiment = Schema.Struct({
  number: Positive,
  start: Chaos.Start,
  schedule: ChaosSchedule.Schedule,
  ordinal: Positive,
  deadline: Count,
  asked: Schema.Array(Asked),
  answers: Schema.Array(Did),
});
type Experiment = typeof Experiment.Type;

const Phase = Schema.TaggedUnion({
  idle: {},
  starting: { start: Chaos.Start },
  active: { experiment: Experiment },
  checking: { experiment: Experiment },
  done: { experiment: Experiment, report: Chaos.Report },
  incomplete: { experiment: Experiment, reason: Schema.Literals(["clock", "overflow", "check", "unanswered", "fire"]) },
  stopped: { start: Chaos.Start, asked: Schema.Array(Asked), answers: Schema.Array(Did) },
});

/**
 * The complete saved control state, including the next display number.
 * @stability unstable
 * @category schemas
 */
export const Model = Schema.Struct({ number: Count, phase: Phase });
type Model = typeof Model.Type;

const startMsg = Schema.Struct({ type: Schema.Literal("start"), ...Chaos.Start.fields });
const stopMsg = Schema.Struct({ type: Schema.Literal("stop") });
const timerMsg = Schema.Struct({ type: Schema.Literal("timer"), at: Count });
const errorFields = { error: Error, at: Count, reason: Schema.optionalKey(Schema.String) };

/**
 * Inputs and the settled host answers, with their original request identity.
 * @stability unstable
 * @category schemas
 */
export const Msg = Schema.Union([
  startMsg,
  stopMsg,
  timerMsg,
  Schema.Struct({
    type: Schema.Literal("now_ok"),
    cmd: Schema.Struct({ type: Schema.Literal("now"), ...Request.fields }),
    value: Count,
    at: Count,
  }),
  Schema.Struct({
    type: Schema.Literal("now_err"),
    cmd: Schema.Struct({ type: Schema.Literal("now"), ...Request.fields }),
    ...errorFields,
  }),
  Schema.Struct({
    type: Schema.Literal("fire_ok"),
    cmd: Schema.Struct({ type: Schema.Literal("fire"), ...Chaos.Fire.fields }),
    value: Chaos.Fired,
    at: Count,
  }),
  Schema.Struct({
    type: Schema.Literal("fire_err"),
    cmd: Schema.Struct({ type: Schema.Literal("fire"), ...Chaos.Fire.fields }),
    ...errorFields,
  }),
  Schema.Struct({
    type: Schema.Literal("inspect_ok"),
    cmd: Schema.Struct({ type: Schema.Literal("inspect"), ...Inspect.fields }),
    value: Chaos.Report,
    at: Count,
  }),
  Schema.Struct({
    type: Schema.Literal("inspect_err"),
    cmd: Schema.Struct({ type: Schema.Literal("inspect"), ...Inspect.fields }),
    ...errorFields,
  }),
]);
type Msg = typeof Msg.Type;

const unfinished = (phase: typeof Phase.Type) =>
  phase._tag === "starting" || phase._tag === "active" || phase._tag === "checking";

const initialExperiment = (m: Model, start: typeof Chaos.Start.Type, deadline: number): Experiment => ({
  number: m.number,
  start,
  schedule: ChaosSchedule.seed(start.seed),
  ordinal: 1,
  deadline,
  asked: [],
  answers: [],
});

const incomplete = (m: Model, experiment: Experiment, reason: typeof Phase.cases.incomplete.Type.reason): Model => ({
  ...m,
  phase: Phase.cases.incomplete.make({ experiment, reason }),
});

const receive = (m: Model, msg: Extract<Msg, { type: "fire_ok" | "fire_err" }>): Model => {
  const p = m.phase;

  if (p._tag === "idle" || p._tag === "starting") {
    return m;
  }

  const history = p._tag === "stopped" ? p : p.experiment;

  if (
    history.start.id !== msg.cmd.id ||
    !history.asked.some((a) => a.ordinal === msg.cmd.ordinal) ||
    history.answers.some((a) => a.ordinal === msg.cmd.ordinal)
  ) {
    return m;
  }

  const result =
    msg.type === "fire_ok"
      ? Did.fields.result.cases.answered.make({ value: msg.value })
      : Did.fields.result.cases.failed.make({ reason: msg.error._tag });
  const answers = [...history.answers, Did.make({ ordinal: msg.cmd.ordinal, at: msg.at, result })];

  if (p._tag === "stopped") {
    return { ...m, phase: Phase.cases.stopped.make({ ...p, answers }) };
  }

  return { ...m, phase: { ...p, experiment: { ...p.experiment, answers } } };
};

/**
 * One machine owns all transitions. Its Cmds are data for the runner.
 * @stability unstable
 * @category machines
 */
export const chaosMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [now, fire, inspect],
  init: (saved) => [saved ?? Model.make({ number: 0, phase: Phase.cases.idle.make({}) }), []],
  update: {
    start: (m, msg) => {
      if (unfinished(m.phase) || m.number === Number.MAX_SAFE_INTEGER) {
        return [m, []];
      }

      const { type: _type, ...start } = msg;
      return [{ number: m.number + 1, phase: Phase.cases.starting.make({ start }) }, [now({ id: start.id })]];
    },
    now_ok: (m, msg) => {
      if (m.phase._tag !== "starting" || m.phase.start.id !== msg.cmd.id) {
        return [m, []];
      }

      const deadline = msg.value + m.phase.start.gap;
      const experiment = initialExperiment(m, m.phase.start, Number.isSafeInteger(deadline) ? deadline : 0);
      return [
        Number.isSafeInteger(deadline)
          ? { ...m, phase: Phase.cases.active.make({ experiment }) }
          : incomplete(m, experiment, "overflow"),
        [],
      ];
    },
    now_err: (m, msg) =>
      m.phase._tag === "starting" && m.phase.start.id === msg.cmd.id
        ? [incomplete(m, initialExperiment(m, m.phase.start, 0), "clock"), []]
        : [m, []],
    timer: (m, msg) => {
      if (m.phase._tag !== "active" || msg.at < m.phase.experiment.deadline) {
        return [m, []];
      }

      const e = m.phase.experiment;
      const last = e.ordinal === e.start.most;
      const deadline = msg.at + e.start.gap;

      if (!last && !Number.isSafeInteger(deadline)) {
        return [incomplete(m, e, "overflow"), []];
      }

      const { fault, schedule } = ChaosSchedule.draw(e.schedule, e.start);
      const experiment = {
        ...e,
        schedule,
        ordinal: last ? e.ordinal : e.ordinal + 1,
        deadline: last ? e.deadline : deadline,
        asked: [...e.asked, Asked.make({ ordinal: e.ordinal, fault, deadline: e.deadline, at: msg.at })],
      };
      const request = fire({ id: e.start.id, ordinal: e.ordinal, target: e.start.target, fault });
      return [
        { ...m, phase: last ? Phase.cases.checking.make({ experiment }) : Phase.cases.active.make({ experiment }) },
        last ? [request, inspect({ id: e.start.id, target: e.start.target })] : [request],
      ];
    },
    fire_ok: (m, msg) => [receive(m, msg), []],
    fire_err: (m, msg) => [receive(m, msg), []],
    inspect_ok: (m, msg) => {
      if (m.phase._tag !== "checking" || m.phase.experiment.start.id !== msg.cmd.id) {
        return [m, []];
      }

      const e = m.phase.experiment;
      return [
        e.answers.length !== e.asked.length
          ? incomplete(m, e, "unanswered")
          : e.answers.some((a) => a.result._tag === "failed")
            ? incomplete(m, e, "fire")
            : { ...m, phase: Phase.cases.done.make({ experiment: e, report: msg.value }) },
        [],
      ];
    },
    inspect_err: (m, msg) =>
      m.phase._tag === "checking" && m.phase.experiment.start.id === msg.cmd.id
        ? [incomplete(m, m.phase.experiment, "check"), []]
        : [m, []],
    stop: (m) => {
      const p = m.phase;

      if (p._tag === "idle" || p._tag === "stopped") {
        return [m, []];
      }

      return [
        {
          ...m,
          phase:
            p._tag === "starting"
              ? Phase.cases.stopped.make({ start: p.start, asked: [], answers: [] })
              : Phase.cases.stopped.make({
                  start: p.experiment.start,
                  asked: p.experiment.asked,
                  answers: p.experiment.answers,
                }),
        },
        [],
      ];
    },
  },
});

/**
 * The next saved deadline, or no alarm when work is stopped or awaiting a check.
 * @stability unstable
 * @category scheduling
 */
export const wake = (model: Model): number | null =>
  model.phase._tag === "active" ? model.phase.experiment.deadline : null;

/**
 * Active experiments cannot be replaced by another start.
 * @stability unstable
 * @category validation
 */
export const refuse = (model: Model, msg: Msg): { readonly reason: string } | null =>
  msg.type === "start" && (unfinished(model.phase) || model.number === Number.MAX_SAFE_INTEGER)
    ? { reason: "active" }
    : null;
