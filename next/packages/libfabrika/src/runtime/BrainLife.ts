/**
 * Where a local brain stands, and the machine that moves it.
 *
 * @stability unstable
 */
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

/**
 * Schema for where a local brain stands: `starting`, `online`, `waiting` for a restart, `braked`,
 * `stopping` or `stopped`.
 *
 * @stability unstable
 * @category schemas
 */
export const BrainState = Schema.TaggedUnion({
  starting: {},
  online: { start: Schema.String, build: Schema.String },
  waiting: { after: Schema.String, until: Schema.Number, reason: Schema.String },
  braked: { after: Schema.String, reason: Schema.String },
  stopping: {},
  stopped: {},
});
type BrainState = typeof BrainState.Type;

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("started"),
    start: Schema.String,
    after: Schema.NullOr(Schema.String),
    build: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("waiting"),
    after: Schema.String,
    until: Schema.Number,
    reason: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("braked"), after: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
]);

const terminal = (s: BrainState) => s._tag === "braked" || s._tag === "stopped";

/**
 * Machine for a local brain's life.
 *
 * **Details**
 *
 * `started`, `waiting` and `braked` move it to the state they name. `stop` moves it to `stopping`,
 * and `stopped` ends it. `braked` and `stopped` are final: no Msg leaves them. While `stopping`,
 * only `stopped` is taken, so a late `started` cannot bring a brain back that was told to stop. It
 * asks for no Cmds, and it starts from a saved state when it is given one.
 *
 * @stability unstable
 * @category machines
 */
export const brainLife = Machine.make({
  model: BrainState,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? BrainState.cases.starting.make({}), []],
  update: {
    started: (s, m) => [
      terminal(s) || s._tag === "stopping" ? s : BrainState.cases.online.make({ start: m.start, build: m.build }),
      [],
    ],
    waiting: (s, m) => [
      terminal(s) || s._tag === "stopping"
        ? s
        : BrainState.cases.waiting.make({ after: m.after, until: m.until, reason: m.reason }),
      [],
    ],
    braked: (s, m) => [
      terminal(s) || s._tag === "stopping" ? s : BrainState.cases.braked.make({ after: m.after, reason: m.reason }),
      [],
    ],
    stop: (s) => [terminal(s) ? s : BrainState.cases.stopping.make({}), []],
    stopped: (s) => [terminal(s) ? s : BrainState.cases.stopped.make({}), []],
  },
});
