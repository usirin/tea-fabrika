// machine.ts: the one tea machine that walks a flow (0064, 0046). Today's lead tooling. It holds the
// flow, where it is, and every step attempt with its outcome; it does no input or output. Its one
// Cmd, `step_run`, is done by the `Runners` service, which the walk wires in.
//
//   running  one step attempt in flight at `position`
//   done     every step ended done or skip
//   parked   a step asked (or needs the lead and this process is not the lead's); `--resume` goes on
//   stuck    a step was stuck, failed, sent the flow nowhere, or the attempts ran out; `--resume`
//            tries that step again
//
// tea saves the Model before it runs a transition's Cmds, so the state file holds a step's attempt
// before the step starts and its outcome once it ends. A resume is `init` with the saved Model: it
// starts a new attempt at the saved position and never runs a step again whose outcome is recorded
// done or skip. An attempt left with no outcome (the process died mid-step) stays in the history,
// and the step runs again: a step must be safe to run twice.

import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Flow } from "./Flow.ts";
import { Answer, Outcome, Spent } from "./Outcome.ts";
import { Step } from "./Step.ts";

/** One try of one step: when it started and ended (ms, the run's clock), its outcome, its spend. */
export const Attempt = Schema.Struct({
  position: Schema.Int,
  name: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.NullOr(Schema.Number),
  outcome: Schema.NullOr(Outcome),
  spent: Schema.NullOr(Spent),
});
export type Attempt = typeof Attempt.Type;

const History = Schema.Array(Attempt);

export const Model = Schema.TaggedUnion({
  running: { flow: Flow, position: Schema.Int, history: History },
  done: { flow: Flow, history: History },
  parked: { flow: Flow, position: Schema.Int, history: History, reason: Schema.String },
  stuck: { flow: Flow, position: Schema.Int, history: History, reason: Schema.String },
});
export type Model = typeof Model.Type;

/** Run one step; the runner's answer comes back as `step_run_ok`. */
export const stepRun = Cmd.make("step_run", {
  input: Schema.Struct({ position: Schema.Int, step: Step }),
  ok: Answer,
  err: ["StepFailed"],
});

/** What `init` reads: the flow from the flow file, and the clock at boot. */
export type Ctx = { readonly flow: Flow; readonly at: number };

type Next = readonly [Model, ReadonlyArray<ReturnType<typeof stepRun>>];

const stay = (s: Model): Next => [s, []];

/** The history with its last attempt closed. */
const closed = (
  history: ReadonlyArray<Attempt>,
  at: number,
  outcome: Outcome,
  spent: Answer["spent"],
): ReadonlyArray<Attempt> =>
  history.map((a, i) => (i === history.length - 1 ? { ...a, endedAt: at, outcome, spent } : a));

/**
 * The flow machine. `lead` says whether this process was started by the lead session: a step marked
 * `lead` is run only then, and otherwise the flow parks on it with `ask`.
 */
export const make = ({ lead }: { readonly lead: boolean }) => {
  /** Start an attempt at `position`, or end the flow when it may not start. */
  const enter = (flow: Flow, history: ReadonlyArray<Attempt>, position: number, at: number): Next => {
    const step = flow.steps[position];

    if (step === undefined) {
      return stay(Model.cases.stuck.make({ flow, position, history, reason: `the flow has no step ${position}` }));
    }

    if (history.length >= flow.attempts) {
      const reason = `${flow.attempts} step attempts ran (the flow's cap); it stops before ${step.name}`;
      return stay(Model.cases.stuck.make({ flow, position, history, reason }));
    }

    const attempt = { position, name: step.name, startedAt: at, endedAt: null, outcome: null, spent: null };

    if (step.lead && !lead) {
      const reason = `${step.name} acts in the lead session's name; the lead runs this flow again with --resume --lead`;
      const asked = { ...attempt, endedAt: at, outcome: Outcome.cases.ask.make({ reason }) };
      return stay(Model.cases.parked.make({ flow, position, history: [...history, asked], reason }));
    }

    return [
      Model.cases.running.make({ flow, position, history: [...history, attempt] }),
      [stepRun({ position, step })],
    ];
  };

  return Machine.make({
    model: Model,
    msg: Schema.Never,
    cmds: [stepRun],
    types: { ctx: {} as Ctx },
    init: (loaded, ctx): Next => {
      if (loaded === null) {
        return enter(ctx.flow, [], 0, ctx.at);
      }

      if (loaded._tag === "done") {
        return stay(loaded);
      }

      return enter(loaded.flow, loaded.history, loaded.position, ctx.at);
    },
    update: {
      step_run_ok: (s, m): Next => {
        if (s._tag !== "running" || m.cmd.position !== s.position) {
          return stay(s);
        }

        const { flow, position } = s;
        const { outcome, spent } = m.value;
        const history = closed(s.history, m.at, outcome, spent);
        const name = m.cmd.step.name;

        if (outcome._tag === "done" || outcome._tag === "skip") {
          return position + 1 >= flow.steps.length
            ? stay(Model.cases.done.make({ flow, history }))
            : enter(flow, history, position + 1, m.at);
        }

        if (outcome._tag === "send") {
          const to = flow.steps.findIndex((step) => step.name === outcome.to);
          return to === -1
            ? stay(
                Model.cases.stuck.make({
                  flow,
                  position,
                  history,
                  reason: `${name} sent the flow to ${outcome.to}, which is no step of it: ${outcome.reason}`,
                }),
              )
            : enter(flow, history, to, m.at);
        }

        if (outcome._tag === "ask") {
          return stay(Model.cases.parked.make({ flow, position, history, reason: `${name} asks: ${outcome.reason}` }));
        }

        return stay(Model.cases.stuck.make({ flow, position, history, reason: `${name}: ${outcome.reason}` }));
      },
      step_run_err: (s, m): Next => {
        if (s._tag !== "running" || m.cmd.position !== s.position) {
          return stay(s);
        }

        const why =
          m.error._tag === "StepFailed" ? String(m.error.reason) : `its answer did not parse (${m.error._tag})`;
        const reason = `${m.cmd.step.name} failed: ${why}`;
        const history = closed(s.history, m.at, Outcome.cases.stuck.make({ reason }), null);
        return stay(Model.cases.stuck.make({ flow: s.flow, position: s.position, history, reason }));
      },
    },
  });
};
