/**
 * The brain lifecycle's saved control state and commands.
 *
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import * as Id from "../Id.ts";
import type * as Snapshot from "../settings/Snapshot.ts";
import { Status } from "./BrainControl.ts";
import { Children, Readiness } from "./BrainProbe.ts";
import { BrainSpec } from "./BrainSpec.ts";

const Input = Schema.Struct({ id: Id.Cmd });
const Errors = ["Operation", "Conflict"] as const;
const inspect = Cmd.make("inspect", { input: Input, ok: Status, err: Errors });
const install = Cmd.make("install", { input: Input, ok: Schema.Null, err: Errors });
const start = Cmd.make("start", { input: Input, ok: Schema.Null, err: Errors });
const stop = Cmd.make("stop", { input: Input, ok: Schema.Null, err: Errors });
const ready = Cmd.make("ready", { input: Input, ok: Readiness, err: Errors });
const cleanup = Cmd.make("cleanup", { input: Input, ok: Children, err: Errors });
const remove = Cmd.make("remove", { input: Input, ok: Schema.Null, err: Errors });
const commands = { inspect, install, start, stop, ready, cleanup, remove };
const Action = Schema.Literals(["up", "stop"]);

const Command = Schema.Struct({
  type: Schema.Literals(["inspect", "install", "start", "stop", "ready", "cleanup", "remove"]),
  id: Id.Cmd,
});
/**
 * Commands emitted by the lifecycle.
 *
 * @stability unstable
 * @category models
 */
export type Command = ReturnType<(typeof commands)[keyof typeof commands]>;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Sequence = { sequence: Count };

const Flow = {
  ...Sequence,
  action: Action,
  deadline: Schema.Finite,
  pending: Schema.NullOr(Command),
  wake: Schema.Finite,
  result: Schema.Literals(["started", "reused"]),
};

const Failure = {
  ...Sequence,
  reason: Schema.Literals(["Operation", "Conflict", "Timeout"]),
  command: Command.fields.type,
};

const Up = { ...Flow, action: Schema.Literal("up") };
const Down = { ...Flow, action: Schema.Literal("stop") };

/**
 * Saved control state, with checked failure classes and command identities.
 *
 * @stability unstable
 * @category schemas
 */
export const Model = Schema.TaggedUnion({
  idle: Sequence,
  inspecting: { ...Flow, purpose: Schema.Literals(["initial", "bootstrap"]) },
  installing: Up,
  starting: Up,
  waiting_ready: Up,
  online: { ...Sequence, result: Flow.result },
  stopping: Down,
  confirming_absence: Down,
  checking_children: Down,
  removing: Down,
  stopped: Sequence,
  failed_up: Failure,
  failed_stop: Failure,
});
type Model = typeof Model.Type;
type Active = Extract<Model, { deadline: number }>;
type Cell = readonly [Model, ReadonlyArray<Command>];
const Error = Schema.TaggedUnion({ Operation: {}, Conflict: {} });
const Observation = { at: Schema.Finite, next: Schema.optionalKey(Id.Cmd) };

const responses = <const T extends Command["type"], S extends Schema.Top>(type: T, value: S) =>
  [
    Schema.Struct({
      type: Schema.Literal(`${type}_ok`),
      cmd: Schema.Struct({ type: Schema.Literal(type), id: Id.Cmd }),
      value,
      ...Observation,
    }),
    Schema.Struct({
      type: Schema.Literal(`${type}_err`),
      cmd: Schema.Struct({ type: Schema.Literal(type), id: Id.Cmd }),
      error: Error,
      ...Observation,
    }),
  ] as const;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("up"), ...Observation }),
  Schema.Struct({ type: Schema.Literal("stop"), ...Observation }),
  Schema.Struct({ type: Schema.Literal("tick"), ...Observation }),
  ...responses("inspect", Status),
  ...responses("install", Schema.Null),
  ...responses("start", Schema.Null),
  ...responses("stop", Schema.Null),
  ...responses("ready", Readiness),
  ...responses("cleanup", Children),
  ...responses("remove", Schema.Null),
]);
/**
 * Requests and settled replies accepted by the lifecycle.
 *
 * @stability unstable
 * @category models
 */
export type Msg = typeof Msg.Type;

const active = (m: Model): m is Active => "pending" in m;

const flow = (m: Active) => ({
  sequence: m.sequence,
  action: m.action,
  deadline: m.deadline,
  pending: m.pending,
  wake: m.wake,
  result: m.result,
});

const up = (m: Active) => ({ ...flow(m), action: "up" as const });
const down = (m: Active) => ({ ...flow(m), action: "stop" as const });

const matches = (m: Model, cmd: Command): m is Active =>
  active(m) && m.pending?.id === cmd.id && m.pending.type === cmd.type;

const fail = (m: Active, reason: (typeof Error.Type)["_tag"] | "Timeout", command?: Command["type"]): Cell => [
  Model.cases[m.action === "up" ? "failed_up" : "failed_stop"].make({
    sequence: m.sequence,
    reason,
    command:
      command ??
      m.pending?.type ??
      (m._tag === "waiting_ready" ? "ready" : m._tag === "checking_children" ? "cleanup" : "inspect"),
  }),
  [],
];

// Pure walks omit the host's allocation and reproduce command identities across saved cuts.
const issue = (m: Active, type: Command["type"], allocated?: typeof Id.Cmd.Type): Cell => {
  const sequence = m.sequence + 1;
  const id = allocated ?? Id.Cmd.make(`cmd_0000000000e008${sequence.toString(16).padStart(12, "0")}`);
  const pending = commands[type]({ id });
  return [{ ...m, sequence, pending: { type: pending.type, id: pending.id } }, [pending]];
};

type Reply = Extract<Msg, { cmd: unknown }>;

const reply =
  <T extends Reply["type"]>(type: T, handle: (m: Active, msg: Extract<Reply, { type: T }>) => Cell) =>
  (m: Model, msg: Extract<Reply, { type: T }>): Cell => {
    if (msg.type !== type || !matches(m, msg.cmd)) {
      return [m, []];
    }

    return msg.at >= m.deadline ? fail(m, "Timeout") : handle(m, msg);
  };

const error = (m: Active, msg: Extract<Msg, { error: unknown }>): Cell => fail(m, msg.error._tag);

/**
 * Creates the machine for startup, ownership, deadlines and confirmed shutdown.
 *
 * @stability unstable
 * @category machines
 */
export const machine = ({ spec, settings }: { readonly spec: BrainSpec; readonly settings: Snapshot.Snapshot }) => {
  const poll = Number(settings.values["desktop.brain-poll"]);
  const begin = (m: Model, action: typeof Action.Type, at: number, next?: typeof Id.Cmd.Type): Cell =>
    active(m)
      ? [m, []]
      : issue(
          Model.cases.inspecting.make({
            sequence: m.sequence,
            action,
            deadline:
              at +
              Number(settings.values[action === "up" ? "desktop.brain-start-timeout" : "desktop.brain-stop-timeout"]),
            pending: null,
            wake: at,
            purpose: "initial",
            result: "reused",
          }),
          "inspect",
          next,
        );
  const again = (m: Active, at: number): Cell => [{ ...m, pending: null, wake: at + poll }, []];

  return Machine.make({
    model: Model,
    msg: Msg,
    cmds: [inspect, install, start, stop, ready, cleanup, remove],
    init: (saved) => [saved ?? Model.cases.idle.make({ sequence: 0 }), []],
    update: {
      up: (m, msg) => begin(m, "up", msg.at, msg.next),
      stop: (m, msg) => begin(m, "stop", msg.at, msg.next),
      tick: (m, msg) => {
        if (!active(m)) {
          return [m, []];
        }

        if (msg.at >= m.deadline) {
          return fail(m, "Timeout");
        }

        if (m.pending !== null || msg.at < m.wake) {
          return [m, []];
        }

        return issue(
          m,
          m._tag === "waiting_ready" ? "ready" : m._tag === "checking_children" ? "cleanup" : "inspect",
          msg.next,
        );
      },
      inspect_ok: reply("inspect_ok", (m, msg) => {
        if (msg.value._tag === "loaded" && !BrainSpec.matches(spec, msg.value)) {
          return fail(m, "Conflict");
        }

        if (m._tag === "confirming_absence") {
          return msg.value._tag === "absent"
            ? issue(Model.cases.checking_children.make(down(m)), "cleanup", msg.next)
            : again(m, msg.at);
        }

        if (m._tag !== "inspecting") {
          return [m, []];
        }

        if (m.action === "stop") {
          return msg.value._tag === "absent"
            ? issue(Model.cases.checking_children.make(down(m)), "cleanup", msg.next)
            : issue(Model.cases.stopping.make(down(m)), "stop", msg.next);
        }

        if (msg.value._tag === "loaded") {
          return issue(Model.cases.waiting_ready.make({ ...up(m), result: "reused" }), "ready", msg.next);
        }

        return m.purpose === "bootstrap"
          ? fail(m, "Operation", "start")
          : issue(Model.cases.installing.make(up(m)), "install", msg.next);
      }),
      install_ok: reply("install_ok", (m, msg) =>
        m._tag === "installing"
          ? issue(Model.cases.starting.make({ ...up(m), result: "started" }), "start", msg.next)
          : [m, []],
      ),
      start_ok: reply("start_ok", (m, msg) =>
        m._tag === "starting" ? issue(Model.cases.waiting_ready.make(up(m)), "ready", msg.next) : [m, []],
      ),
      start_err: reply("start_err", (m, msg) =>
        m._tag === "starting"
          ? issue(Model.cases.inspecting.make({ ...flow(m), purpose: "bootstrap" }), "inspect", msg.next)
          : [m, []],
      ),
      ready_ok: reply("ready_ok", (m, msg) =>
        m._tag !== "waiting_ready"
          ? [m, []]
          : msg.value._tag === "ready"
            ? [Model.cases.online.make({ sequence: m.sequence, result: m.result }), []]
            : again(m, msg.at),
      ),
      stop_ok: reply("stop_ok", (m, msg) =>
        m._tag === "stopping" ? issue(Model.cases.confirming_absence.make(down(m)), "inspect", msg.next) : [m, []],
      ),
      cleanup_ok: reply("cleanup_ok", (m, msg) =>
        m._tag !== "checking_children"
          ? [m, []]
          : msg.value._tag === "gone"
            ? issue(Model.cases.removing.make(down(m)), "remove", msg.next)
            : again(m, msg.at),
      ),
      remove_ok: reply("remove_ok", (m) =>
        m._tag === "removing" ? [Model.cases.stopped.make({ sequence: m.sequence }), []] : [m, []],
      ),
      inspect_err: reply("inspect_err", error),
      install_err: reply("install_err", error),
      stop_err: reply("stop_err", error),
      ready_err: reply("ready_err", error),
      cleanup_err: reply("cleanup_err", error),
      remove_err: reply("remove_err", error),
    },
  });
};
