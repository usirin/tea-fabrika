// One job's control state, one Msg at a time (0037, 0046). `JobsLedger.ts` folds a job's committed
// events through it, steps the call it was given, and appends that call only when the answer is
// `accepted`. A repeat answers `repeated`; a refusal names its reason. Neither changes the state.
import { Machine } from "@demlik/tea/effect";
import { Equal, Schema } from "effect";
import { Executor, Request, Result, State } from "../Job.ts";

const Execution = Schema.NonEmptyString;

/** @internal */
export const Reason = Schema.Literals([
  "not_found",
  "conflict",
  "not_target",
  "lacks_capability",
  "wrong_execution",
  "wrong_state",
]);

/** What the last Msg did. `none` only before the first. */
const Answer = Schema.TaggedUnion({
  none: {},
  accepted: {},
  repeated: {},
  refused: { reason: Reason },
});
type Answer = typeof Answer.Type;

const Model = Schema.Struct({ state: State, answer: Answer });
type Model = typeof Model.Type;

/** @internal */
export const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("request"), request: Request }),
  Schema.Struct({ type: Schema.Literal("take"), executor: Executor, execution: Execution }),
  Schema.Struct({ type: Schema.Literal("start"), execution: Execution }),
  Schema.Struct({ type: Schema.Literal("finish"), execution: Execution, result: Result }),
]);
/** @internal */
export type Msg = typeof Msg.Type;

const ACCEPTED = Answer.cases.accepted.make({});
const REPEATED = Answer.cases.repeated.make({});

const answered = (model: Model, answer: Answer): [Model, []] => [{ state: model.state, answer }, []];
const refused = (model: Model, reason: typeof Reason.Type) => answered(model, Answer.cases.refused.make({ reason }));
const moved = (state: State): [Model, []] => [{ state, answer: ACCEPTED }, []];

/** @internal */
export const job = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { state: State.cases.absent.make({}), answer: Answer.cases.none.make({}) }, []],
  update: {
    request: (model, { request }) => {
      const s = model.state;

      if (s._tag === "absent") {
        return moved(State.cases.requested.make({ request }));
      }

      return Equal.equals(s.request, request) ? answered(model, REPEATED) : refused(model, "conflict");
    },
    take: (model, { executor, execution }) => {
      const s = model.state;

      if (s._tag === "absent") {
        return refused(model, "not_found");
      }

      if (executor.key !== s.request.target) {
        return refused(model, "not_target");
      }

      if (!s.request.needs.every((need) => executor.has.includes(need))) {
        return refused(model, "lacks_capability");
      }

      if (s._tag === "requested") {
        return moved(State.cases.assigned.make({ request: s.request, assignment: { execution, executor } }));
      }

      // The take reply was lost: the first assignment stands, whatever identity this one proposed.
      return answered(model, REPEATED);
    },
    start: (model, { execution }) => {
      const s = model.state;

      if (s._tag === "absent") {
        return refused(model, "not_found");
      }

      if (s._tag === "requested") {
        return refused(model, "wrong_state");
      }

      if (execution !== s.assignment.execution) {
        return refused(model, "wrong_execution");
      }

      if (s._tag === "assigned") {
        return moved(State.cases.started.make({ request: s.request, assignment: s.assignment }));
      }

      return answered(model, REPEATED);
    },
    finish: (model, { execution, result }) => {
      const s = model.state;

      if (s._tag === "absent") {
        return refused(model, "not_found");
      }

      if (s._tag === "requested") {
        return refused(model, "wrong_state");
      }

      if (execution !== s.assignment.execution) {
        return refused(model, "wrong_execution");
      }

      if (s._tag === "assigned") {
        return refused(model, "wrong_state");
      }

      if (s._tag === "started") {
        return moved(State.cases.finished.make({ request: s.request, assignment: s.assignment, result }));
      }

      return Equal.equals(s.result, result) ? answered(model, REPEATED) : refused(model, "conflict");
    },
  },
});
