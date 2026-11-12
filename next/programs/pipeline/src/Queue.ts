import type { Settled } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { CodeHost, Program, Send, StartChild, Started, type Refusal } from "@kampus/libfabrika";
import { Schema } from "effect";
import { Abandon, Drop, Enqueue, Reply, Resume } from "./Mail.ts";
import type { Values } from "./Settings.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Entry = Schema.Struct({
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Schema.NullOr(Schema.requiredKey(Enqueue.fields.reply)),
});

const Current = Schema.Struct({ ...Entry.fields, name: Schema.NonEmptyString });

const Stop = Schema.TaggedUnion({
  tree_drift: { change: CodeHost.ChangeId, commit: CodeHost.Commit, tree: CodeHost.Tree, checked: CodeHost.Tree },
  start_refused: { change: CodeHost.ChangeId, name: Schema.NonEmptyString, refusal: Schema.String },
});

const counts = { attempt: Count, late: Count };
const line = { ...counts, line: Schema.Array(Entry) };

const Model = Schema.TaggedUnion({
  idle: counts,
  starting: { ...line, current: Current },
  landing: { ...line, current: Current, since: Schema.Number },
  stopped: { ...line, reason: Stop },
});
type Model = typeof Model.Type;
type Entry = typeof Entry.Type;
type Command = ReturnType<typeof StartChild.startChild | typeof Send.send>;
type Cell = readonly [Model, ReadonlyArray<Command>];

const answers = <const N extends string, F extends Schema.Struct.Fields, O extends Schema.Top, const T extends string>(
  name: N,
  input: Schema.Struct<F>,
  ok: O,
  tags: ReadonlyArray<T>,
) => {
  const cmd = input.mapFields((fields) => ({ ...fields, type: Schema.Literal(name) }));
  return Schema.Union([
    Schema.Struct({ type: Schema.Literal(`${name}_ok`), cmd, value: ok, at: Schema.Number }),
    Schema.Struct({
      type: Schema.Literal(`${name}_err`),
      cmd,
      error: Schema.Union(tags.map((tag) => Schema.TaggedStruct(tag, {}))),
      at: Schema.Number,
    }),
  ]);
};

const Msg = Schema.Union([
  Enqueue,
  Drop,
  Resume,
  Reply,
  answers("start_child", StartChild.StartChildInput, Started, StartChild.startChild.errTags),
  // A refused built-in start echoes only its type; the queue has exactly one start out.
  Schema.Struct({
    type: Schema.Literal("start_child_err"),
    cmd: Schema.Struct({ type: Schema.Literal("start_child") }),
    reason: Schema.Literals([...StartChild.StartRefusal.literals, "bad_cmd"]),
    at: Schema.Number,
  }),
  answers("send", Send.SendInput, Send.Queued, Send.send.errTags),
]);

type Message = typeof Msg.Type | Settled<typeof StartChild.startChild | typeof Send.send>;

const forward = (entry: Entry, reply: typeof Reply.Type): ReadonlyArray<Command> =>
  entry.reply === null ? [] : [Send.send({ to: entry.reply.to, m: { ...reply, ref: entry.reply.ref } })];

/** One queue, registered under the same name its host supplies here. */
export const queue = ({ name, settings }: { readonly name: string; readonly settings: Values }) => {
  const unset = Object.values(settings.checks).every((checks) => checks.length === 0);
  const next = (s: Pick<Model, "attempt" | "late">, line: ReadonlyArray<Entry>): Cell => {
    const [entry, ...rest] = line;

    if (entry === undefined) {
      return [Model.cases.idle.make({ attempt: s.attempt, late: s.late }), []];
    }

    const attempt = s.attempt + 1;
    const current = { ...entry, name: `merger:${entry.change}.${attempt}` };
    return [
      Model.cases.starting.make({ attempt, late: s.late, current, line: rest }),
      [
        StartChild.startChild({
          program: "pipeline/merger",
          name: current.name,
          input: { type: "land", ref: String(attempt), change: entry.change, head: entry.head, reply: name },
        }),
      ],
    ];
  };
  const refuse = (s: Model, m: Message): Refusal | null => {
    const line = s._tag === "idle" ? [] : s.line;
    const current = s._tag === "starting" || s._tag === "landing" ? s.current : null;

    if (m.type === "enqueue") {
      if (unset) {
        return { reason: "unset" };
      }

      if (current?.change === m.change || line.some((entry) => entry.change === m.change)) {
        return { reason: "queued" };
      }

      if (line.length >= settings.most) {
        return { reason: "full", now: line.length, most: settings.most };
      }
    }

    if (m.type === "drop") {
      if (current?.change !== m.change && !line.some((entry) => entry.change === m.change)) {
        return { reason: "missing" };
      }

      if (s._tag === "starting" && current?.change === m.change) {
        return { reason: "starting" };
      }
    }

    return m.type === "resume" && s._tag !== "stopped" ? { reason: "running" } : null;
  };
  const reduce = (s: Model, m: Message): Cell => {
    if (m.type === "send_ok" || m.type === "send_err") {
      return [s, []];
    }

    if (refuse(s, m) !== null) {
      return [s, []];
    }

    if (m.type === "enqueue") {
      const entry = Entry.make({ change: m.change, head: m.head, reply: m.reply ?? null });
      return s._tag === "idle" ? next(s, [entry]) : [{ ...s, line: [...s.line, entry] }, []];
    }

    if (m.type === "start_child_ok" || m.type === "start_child_err") {
      if (s._tag !== "starting" || ("name" in m.cmd && m.cmd.name !== s.current.name)) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      if (m.type === "start_child_ok" && m.value._tag === "started") {
        return [
          Model.cases.landing.make({ attempt: s.attempt, late: s.late, line: s.line, current: s.current, since: m.at }),
          [],
        ];
      }

      return [
        Model.cases.stopped.make({
          attempt: s.attempt,
          late: s.late,
          line: [Entry.make(s.current), ...s.line],
          reason: Stop.cases.start_refused.make({
            change: s.current.change,
            name: s.current.name,
            refusal: m.type === "start_child_err" ? ("reason" in m ? m.reason : m.error._tag) : m.value._tag,
          }),
        }),
        [],
      ];
    }

    if (m.type === "reply") {
      if (s._tag !== "landing" || m.ref !== String(s.attempt)) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      const sent = forward(s.current, m);

      if (m._tag === "merged" && m.tree !== m.checked) {
        return [
          Model.cases.stopped.make({
            attempt: s.attempt,
            late: s.late,
            line: s.line,
            reason: Stop.cases.tree_drift.make({
              change: m.change,
              commit: m.commit,
              tree: m.tree,
              checked: m.checked,
            }),
          }),
          sent,
        ];
      }

      const [model, commands] = next(s, s.line);
      return [model, [...sent, ...commands]];
    }

    if (m.type === "drop" && s._tag !== "idle") {
      if (s._tag === "landing" && s.current.change === m.change) {
        return [s, [Send.send({ to: s.current.name, m: Abandon.make({ type: "abandon", ref: String(s.attempt) }) })]];
      }

      const sent = s.line
        .filter((entry) => entry.change === m.change)
        .flatMap((entry) => forward(entry, Reply.cases.abandoned.make({ ref: "dropped", change: entry.change })));
      return [{ ...s, line: s.line.filter((entry) => entry.change !== m.change) }, sent];
    }

    return m.type === "resume" && s._tag === "stopped" ? next(s, s.line) : [s, []];
  };
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [StartChild.startChild, Send.send],
    init: (loaded) => [loaded ?? Model.cases.idle.make({ attempt: 0, late: 0 }), []],
    update: {
      enqueue: reduce,
      drop: reduce,
      resume: reduce,
      reply: reduce,
      start_child_ok: reduce,
      start_child_err: reduce,
      send_ok: reduce,
      send_err: reduce,
    },
  });
  return Program.make({
    name: "pipeline/queue",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => ({
      state: s._tag,
      current:
        s._tag === "starting" || s._tag === "landing"
          ? { change: s.current.change, head: s.current.head, name: s.current.name }
          : null,
      since: s._tag === "landing" ? s.since : null,
      line: s._tag === "idle" ? [] : s.line.map(({ change, head }) => ({ change, head })),
      attempt: s.attempt,
      late: s.late,
      reason: s._tag === "stopped" ? s.reason : null,
      unset: unset ? "queue.checks" : null,
    }),
    refuse,
    inputs: {
      enqueue: "Add a change at its pinned head to the line",
      drop: "Abandon a waiting change or ask its merger to abandon it",
      resume: { description: "Continue landing after a stop", personOnly: true },
      reply: "Receive the current merger's reply",
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};
