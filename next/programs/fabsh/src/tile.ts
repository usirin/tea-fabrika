// fabsh's tile, next/: the window side of the line (0275, 0167). It keeps the server's newest echo
// and the person's own line apart and derives the line it draws, so a letter is drawn in the update
// that takes it and an echo only clears a pending edit (LiveView's rule for a focused input). At
// most one draft frame flies at a time; an edit that comes meanwhile waits as `queued`, and the
// newest line goes when the frame in flight is answered (mosh: the newest state, never a stream).
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Draft, fabshMachine, LINE_MOST } from "./program.ts";
import { builtins, complete, recall } from "./read.ts";

type Line = typeof Draft.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

const Model = Schema.Struct({
  /** The newest echo: the server state. */
  echoed: Draft,
  /** What the person's input holds now. */
  mine: Draft,
  /** The `n` of the one frame in flight. */
  flight: Schema.NullOr(Schema.Int),
  /** An edit came while a frame was in flight. */
  queued: Schema.Boolean,
  /** The line has the person's focus. */
  focused: Schema.Boolean,
  /** Since the last Enter: frames sent, echoes back, and the slowest echo in ms. */
  frames: Count,
  echoes: Count,
  slowest: Ms,
});
type Model = typeof Model.Type;

const EMPTY: Line = { text: "", cursor: 0, n: 0 };

const draft = Cmd.make("draft", { input: Schema.Struct({ m: Draft }), ok: Schema.Null, err: [] });

const press = Cmd.make("press", {
  input: Schema.Struct({ m: Schema.toType(fabshMachine.msg) }),
  ok: Schema.Null,
  err: [],
});

type Out = ReadonlyArray<ReturnType<typeof draft> | ReturnType<typeof press>>;
type Step = readonly [Model, Out];

const pending = (m: Model) => m.flight !== null || m.queued || m.mine.n !== m.echoed.n;

/** The line the tile draws, derived and never stored: its own while focused or pending, else the echo. */
export const drawn = (m: Model): Line => (m.focused || pending(m) ? m.mine : m.echoed);

/** Sends the newest line now, or marks it to go when the frame in flight is answered. */
const send = (m: Model): Step =>
  m.flight === null
    ? [{ ...m, flight: m.mine.n, queued: false, frames: m.frames + 1 }, [draft({ m: m.mine })]]
    : [{ ...m, queued: true }, []];

/** A new line, drawn at once and sent as one frame. */
const change = (m: Model, line: { readonly text: string; readonly cursor: number }): Step =>
  line.text === m.mine.text && line.cursor === m.mine.cursor
    ? [{ ...m, focused: true }, []]
    : send({ ...m, focused: true, mine: { text: line.text, cursor: line.cursor, n: m.mine.n + 1 } });

/** The frame in flight has its answer: the next one goes if an edit waited. */
const answered = (m: Model): Step => {
  const free = { ...m, flight: null };
  return m.queued ? send(free) : [free, []];
};

export const tile = Machine.make({
  model: Model,
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("edited"), text: Schema.String, cursor: Schema.Int }),
    Schema.Struct({ type: Schema.Literal("tab"), programs: Schema.Array(Schema.String) }),
    Schema.Struct({
      type: Schema.Literal("recall"),
      to: Schema.Literals(["back", "forward"]),
      history: Schema.Array(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("enter") }),
    Schema.Struct({ type: Schema.Literal("echoed"), value: Draft, ms: Ms }),
    Schema.Struct({ type: Schema.Literal("echo_refused"), reason: Schema.String }),
    Schema.Struct({ type: Schema.Literal("blurred") }),
  ]),
  cmds: [draft, press],
  init: () => [
    { echoed: EMPTY, mine: EMPTY, flight: null, queued: false, focused: false, frames: 0, echoes: 0, slowest: 0 },
    [],
  ],
  update: {
    edited: (m, msg) => {
      const text = msg.text.slice(0, LINE_MOST);
      return change(m, { text, cursor: Math.max(0, Math.min(msg.cursor, text.length)) });
    },
    tab: (m, msg) => {
      const done = complete(m.mine, { builtins, programs: msg.programs });
      return done === null ? [m, []] : change(m, done);
    },
    recall: (m, msg) => change(m, recall(m.mine, msg.history, msg.to)),
    enter: (m) => {
      const line = drawn(m).text;

      if (line.trim() === "") {
        return [m, []];
      }

      // The row's counts start again with the next line; the empty line's frame is its first.
      const next: Model = {
        ...m,
        focused: true,
        mine: { text: "", cursor: 0, n: m.mine.n + 1 },
        frames: 0,
        echoes: 0,
        slowest: 0,
      };
      const [sent, cmds] = send(next);
      return [sent, [press({ m: { type: "submitted", line } }), ...cmds]];
    },
    echoed: (m, msg) =>
      answered({
        ...m,
        echoed: msg.value.n >= m.echoed.n ? msg.value : m.echoed,
        echoes: m.echoes + 1,
        slowest: Math.max(m.slowest, msg.ms),
      }),
    echo_refused: (m) => answered(m),
    blurred: (m) => [{ ...m, focused: false }, []],
    draft_ok: (m) => [m, []],
    draft_err: (m) => [m, []],
    press_ok: (m) => [m, []],
    press_err: (m) => [m, []],
  },
});
