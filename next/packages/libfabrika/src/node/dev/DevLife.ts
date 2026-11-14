/**
 * The local runtime's life as one tea machine. The driver in `dev.ts` sends it what the runtime
 * reports and reads the state back; nothing here does input or output.
 *
 * @stability unstable
 */
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

// Zero is how the local runtime says it has no control socket, so a known port is never zero.
const Port = Schema.Int.check(Schema.makeFilter((port: number) => port !== 0));

const Listener = Schema.TaggedUnion({
  absent: {},
  known: { port: Port },
});
type Listener = typeof Listener.Type;

// An exit leaves a replacement waiting for its listener; the token names the driver's handle.
const Replacement = Schema.TaggedUnion({
  none: {},
  pending: { id: Schema.String },
});
type Replacement = typeof Replacement.Type;

const Session = Schema.Struct({
  start: Schema.String,
  after: Schema.NullOr(Schema.String),
  build: Schema.String,
});

/**
 * Schema for where the local runtime stands: `starting` and `listening` before its first start,
 * `spawned` and `online` while a process runs, `exited` and `waiting` between an exit and its
 * replacement, `braked` when restarting gave up, and `stopping` then `stopped` on the way out.
 *
 * **Details**
 *
 * A state holds a pid only while a process runs, and it keeps the control socket's port across an
 * exit. `replacement` is `pending` from an exit until a listener is heard again.
 *
 * @stability unstable
 * @category schemas
 */
export const DevState = Schema.TaggedUnion({
  starting: { last: Schema.NullOr(Schema.String) },
  listening: { last: Schema.NullOr(Schema.String), port: Port },
  spawned: { session: Session, pid: Schema.Number, replacement: Replacement },
  online: { session: Session, pid: Schema.Number, port: Port, replacement: Replacement },
  exited: { session: Session, listener: Listener, replacement: Replacement },
  waiting: {
    session: Session,
    listener: Listener,
    replacement: Replacement,
    until: Schema.Number,
    reason: Schema.String,
  },
  braked: { start: Schema.NullOr(Schema.String), listener: Listener, reason: Schema.String },
  stopping: { start: Schema.NullOr(Schema.String), listener: Listener, replacement: Replacement },
  stopped: { listener: Listener },
});
type DevState = typeof DevState.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("listened"), port: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("started"),
    start: Schema.String,
    pid: Schema.Number,
    build: Schema.String,
    at: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("exited"), replacement: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("waiting"),
    until: Schema.Number,
    reason: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("braked"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
]);

type Ctx = { readonly last: string | null };

const none = Replacement.cases.none.make({});

const heard = (port: number | null): Listener => {
  if (port === null || port === 0) {
    return Listener.cases.absent.make({});
  }

  return Listener.cases.known.make({ port });
};

/**
 * Returns the control socket's port, or null when none is known. The port is kept after an exit.
 *
 * @stability unstable
 * @category getters
 */
export const address = (s: DevState): number | null => {
  if (s._tag === "listening" || s._tag === "online") {
    return s.port;
  }

  if (s._tag === "starting" || s._tag === "spawned") {
    return null;
  }

  return s.listener._tag === "known" ? s.listener.port : null;
};

/**
 * Returns the pid of the live process the memory sampler may read, or null when none runs.
 *
 * @stability unstable
 * @category getters
 */
export const target = (s: DevState): number | null => {
  if (s._tag === "spawned" || s._tag === "online") {
    return s.pid;
  }

  return null;
};

const replacement = (s: DevState): Replacement => {
  if (s._tag === "starting" || s._tag === "listening") {
    return none;
  }

  if (s._tag === "braked" || s._tag === "stopped") {
    return none;
  }

  return s.replacement;
};

/**
 * Returns the id of the replacement still waiting for its listener, or null when none waits.
 *
 * @stability unstable
 * @category getters
 */
export const pending = (s: DevState): string | null => {
  const r = replacement(s);
  return r._tag === "pending" ? r.id : null;
};

/**
 * Returns the latest start of this runtime, the one its exit, restart, brake and stop events name.
 * Null before the first start and after the stop.
 *
 * @stability unstable
 * @category getters
 */
export const latest = (s: DevState): string | null => {
  if (s._tag === "starting" || s._tag === "listening" || s._tag === "stopped") {
    return null;
  }

  if (s._tag === "braked" || s._tag === "stopping") {
    return s.start;
  }

  return s.session.start;
};

const active = (s: DevState) => {
  const tag = s._tag;
  return tag !== "braked" && tag !== "stopping" && tag !== "stopped";
};

/**
 * The local runtime's life as a tea machine with no Cmds: the driver does the work and sends what
 * happened.
 *
 * **Details**
 *
 * It starts in `starting` with the last start an earlier run saved, so this run's first start can
 * name the one it follows. A start is ignored once the machine is `braked`, `stopping` or
 * `stopped`. A replacement counts as up when its listener is heard, not when its process starts.
 *
 * @stability unstable
 * @category machines
 */
export const devLife = Machine.make({
  model: DevState,
  msg: Msg,
  cmds: [],
  types: { ctx: {} as Ctx },
  init: (_saved, ctx) => [DevState.cases.starting.make({ last: ctx.last }), []],
  update: {
    listened: (s, m) => {
      const listener = heard(m.port);

      if (s._tag === "starting" || s._tag === "listening") {
        return [
          listener._tag === "known"
            ? DevState.cases.listening.make({ last: s.last, port: listener.port })
            : DevState.cases.starting.make({ last: s.last }),
          [],
        ];
      }

      // The listener, not the start, completes a replacement.
      if (s._tag === "spawned" || s._tag === "online") {
        const { session, pid } = s;
        return [
          listener._tag === "known"
            ? DevState.cases.online.make({ session, pid, port: listener.port, replacement: none })
            : DevState.cases.spawned.make({ session, pid, replacement: none }),
          [],
        ];
      }

      if (s._tag === "exited" || s._tag === "waiting" || s._tag === "stopping") {
        return [{ ...s, listener, replacement: none }, []];
      }

      if (s._tag === "braked") {
        return [{ ...s, listener }, []];
      }

      return [s, []];
    },
    started: (s, m) => {
      if (!active(s)) {
        return [s, []];
      }

      const after = s._tag === "starting" || s._tag === "listening" ? s.last : latest(s);
      const session = { start: m.start, after, build: m.build };
      const port = address(s);
      const kept = replacement(s);
      return [
        port === null
          ? DevState.cases.spawned.make({ session, pid: m.pid, replacement: kept })
          : DevState.cases.online.make({ session, pid: m.pid, port, replacement: kept }),
        [],
      ];
    },
    exited: (s, m) => {
      if (s._tag !== "spawned" && s._tag !== "online") {
        return [s, []];
      }

      return [
        DevState.cases.exited.make({
          session: s.session,
          listener: heard(address(s)),
          replacement: Replacement.cases.pending.make({ id: m.replacement }),
        }),
        [],
      ];
    },
    waiting: (s, m) => {
      if (s._tag !== "exited") {
        return [s, []];
      }

      const { session, listener } = s;
      return [
        DevState.cases.waiting.make({
          session,
          listener,
          replacement: s.replacement,
          until: m.until,
          reason: m.reason,
        }),
        [],
      ];
    },
    braked: (s, m) => {
      if (!active(s)) {
        return [s, []];
      }

      return [
        DevState.cases.braked.make({
          start: latest(s),
          listener: heard(address(s)),
          reason: m.reason,
        }),
        [],
      ];
    },
    stop: (s) => {
      if (s._tag === "stopping" || s._tag === "stopped") {
        return [s, []];
      }

      return [
        DevState.cases.stopping.make({
          start: latest(s),
          listener: heard(address(s)),
          replacement: replacement(s),
        }),
        [],
      ];
    },
    stopped: (s) => {
      if (s._tag !== "stopping") {
        return [s, []];
      }

      return [DevState.cases.stopped.make({ listener: s.listener }), []];
    },
  },
});
