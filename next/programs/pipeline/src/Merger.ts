import type { Settled } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { Ci, CodeHost, Program, Send, StartChild } from "@kampus/libfabrika";
import { Array as Arr, Schema } from "effect";
import * as Change from "./Change.ts";
import { Abandon, Land, Reply } from "./Mail.ts";
import type { Values } from "./Settings.ts";

const Faults = ["unavailable", "rate_limited", "refused", "handler_failed", "bad_cmd"] as const;

const Attempt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Inputs = {
  change: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId }),
  update: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId, head: CodeHost.Commit }),
  checks: Schema.Struct({ attempt: Attempt, head: CodeHost.Commit, start: Schema.Boolean }),
  merge: Schema.Struct({ attempt: Attempt, change: CodeHost.ChangeId, head: CodeHost.Commit }),
};

const change = Cmd.make("change", {
  input: Schema.toType(Inputs.change),
  ok: Schema.toType(CodeHost.Change),
  err: Faults,
});

const update = Cmd.make("update", {
  input: Schema.toType(Inputs.update),
  ok: Schema.toType(CodeHost.Updated),
  err: Faults,
});

const checks = Cmd.make("checks", { input: Schema.toType(Inputs.checks), ok: Schema.toType(Ci.Checks), err: Faults });

const merge = Cmd.make("merge", {
  input: Schema.toType(Inputs.merge),
  ok: Schema.toType(CodeHost.Merged),
  err: Faults,
});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Step = Schema.TaggedUnion({
  asking: { tries: Count, at: Schema.Number },
  waiting: {
    tries: Count,
    at: Schema.Number,
    reason: Schema.Literals([...Faults, "ci_silent", "ci_lost", "no_answer", "pending"]),
  },
});

const First = Schema.TaggedStruct("asking", { tries: Schema.Literal(0), at: Schema.Null });

const Job = Schema.Struct({
  ref: Land.fields.ref,
  change: CodeHost.ChangeId,
  head: CodeHost.Commit,
  reply: Land.fields.reply,
});

const counts = { attempt: Count, late: Count };
const working = { ...counts, job: Job, step: Step };
const prepared = { ...working, kind: Change.Kind, checks: Schema.NonEmptyArray(Change.Check) };

const Previous = Schema.TaggedUnion({
  idle: counts,
  reading: { ...working, step: Schema.Union([Step, First]) },
  updating: prepared,
  checking: { ...prepared, head: CodeHost.Commit, tree: CodeHost.Tree, until: Schema.Number },
  merging: { ...working, head: CodeHost.Commit, tree: CodeHost.Tree },
});

const Model = Schema.TaggedUnion({
  idle: counts,
  reading: { ...working, step: Schema.Union([Step, First]) },
  updating: { ...prepared, head: CodeHost.Commit, round: Count, checked: Schema.NullOr(CodeHost.Tree) },
  checking: { ...prepared, head: CodeHost.Commit, tree: CodeHost.Tree, until: Schema.Number, round: Count },
  merging: { ...working, head: CodeHost.Commit, tree: CodeHost.Tree },
});

const rounds = {
  name: "rounds",
  from: 1,
  run: (raw: unknown) => {
    const s = Schema.decodeUnknownSync(Previous)(raw);
    return s._tag === "updating"
      ? { ...s, head: s.job.head, round: 0, checked: null }
      : s._tag === "checking"
        ? { ...s, round: 0 }
        : s;
  },
};

type Model = typeof Model.Type;
type Working = Exclude<Model, typeof Model.cases.idle.Type>;

type Command = ReturnType<
  typeof change | typeof update | typeof checks | typeof merge | typeof Send.send | typeof StartChild.exit
>;

type Cell = readonly [Model, ReadonlyArray<Command>];

// The runner accepts settled letters itself; declaring them here also lets pure clients decode them.
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
  Land,
  Abandon,
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number }),
  answers(change.cmdType, Inputs.change, CodeHost.Change, Faults),
  answers(update.cmdType, Inputs.update, CodeHost.Updated, Faults),
  answers(checks.cmdType, Inputs.checks, Ci.Checks, Faults),
  answers(merge.cmdType, Inputs.merge, CodeHost.Merged, Faults),
  answers(Send.send.cmdType, Send.SendInput, Send.Queued, Send.send.errTags),
]);

const clamp = (at: number) => Math.min(at, 8.64e15);

const commandFor = (s: Working) =>
  s._tag === "reading" ? "change" : s._tag === "updating" ? "update" : s._tag === "checking" ? "checks" : "merge";

const progress = (s: Working) => ({ attempt: s.attempt, late: s.late, job: s.job });

const identity = (s: Working) => ({ ref: s.job.ref, change: s.job.change });

const finish = (s: Working, reply: typeof Reply.Type): Cell => [
  Model.cases.idle.make({ attempt: s.attempt, late: s.late }),
  [Send.send({ to: s.job.reply, m: reply }), StartChild.exit({})],
];

export const merger = (settings: Values) => {
  const wait = settings.wait * 60_000;
  const poll = settings.poll * 1000;
  const backoff = settings.backoff * 1000;
  const asking = (at: number, tries = 0) => Step.cases.asking.make({ tries, at: clamp(at + wait) });
  const waiting = (s: Working, at: number, reason: (typeof Step.cases.waiting.Type)["reason"]): typeof Step.Type => {
    const tries = s.step.tries + 1;
    return Step.cases.waiting.make({ tries, reason, at: clamp(at + Math.min(poll * 2 ** (tries - 1), backoff)) });
  };
  const ask = (s: Working, at: number, tries: number, start: boolean): Cell => {
    const attempt = s.attempt + 1;
    const next = { ...s, attempt, step: asking(at, tries) };
    const cmd =
      s._tag === "reading"
        ? change({ attempt, change: s.job.change })
        : s._tag === "updating"
          ? update({ attempt, change: s.job.change, head: s.head })
          : s._tag === "checking"
            ? checks({ attempt, head: s.head, start })
            : merge({ attempt, change: s.job.change, head: s.head });
    return [next, [cmd]];
  };
  type Message =
    | typeof Msg.Type
    | Settled<typeof change | typeof update | typeof checks | typeof merge | typeof Send.send>;
  const reduce = (s: Model, m: Message): Cell => {
    if (m.type === "send_ok" || m.type === "send_err") {
      return [s, []];
    }

    if ("cmd" in m) {
      if (
        s._tag === "idle" ||
        s.step._tag !== "asking" ||
        m.cmd.type !== commandFor(s) ||
        m.cmd.attempt !== s.attempt
      ) {
        return [{ ...s, late: s.late + 1 }, []];
      }

      if ("error" in m) {
        return [{ ...s, step: waiting(s, m.at, m.error._tag === "malformed_result" ? "bad_cmd" : m.error._tag) }, []];
      }
    }

    if (m.type === "land") {
      if (s._tag !== "idle") {
        return [s, []];
      }

      const attempt = s.attempt + 1;
      return [
        Model.cases.reading.make({ late: s.late, job: Job.make(m), attempt, step: First.make({ tries: 0, at: null }) }),
        [change({ attempt, change: m.change })],
      ];
    }

    if (s._tag === "idle") {
      return [s, []];
    }

    if (m.type === "timer") {
      if (s.step.at === null || m.at < s.step.at) {
        return [s, []];
      }

      return ask(
        s,
        m.at,
        s.step.tries + (s.step._tag === "asking" ? 1 : 0),
        !(s.step._tag === "waiting" && s.step.reason === "pending"),
      );
    }

    if (m.type === "abandon") {
      return s._tag === "merging" || s.job.ref !== m.ref ? [s, []] : finish(s, Reply.cases.abandoned.make(identity(s)));
    }

    if (s._tag === "reading" && m.type === "change_ok") {
      const v = m.value;

      if (v._tag === "missing") {
        return finish(s, Reply.cases.closed.make({ ...identity(s), state: "missing" }));
      }

      if (v.state !== "open") {
        return finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state }));
      }

      if (v.head !== s.job.head) {
        return finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head }));
      }

      const kind = Change.kind(settings.kinds, v.paths);
      const wanted = Change.checksFor(settings.checks, kind);

      if (!Arr.isReadonlyArrayNonEmpty(wanted)) {
        return finish(s, Reply.cases.unset.make({ ...identity(s), kind }));
      }

      return ask(
        Model.cases.updating.make({
          ...progress(s),
          kind,
          checks: wanted,
          head: s.job.head,
          round: 0,
          checked: null,
          step: asking(m.at),
        }),
        m.at,
        0,
        false,
      );
    }

    if (s._tag === "updating" && m.type === "update_ok") {
      const v = m.value;

      if (v._tag === "current" || v._tag === "updated") {
        if (v._tag === "current" && s.checked !== null) {
          return ask(
            Model.cases.merging.make({ ...progress(s), head: s.head, tree: s.checked, step: asking(m.at) }),
            m.at,
            0,
            false,
          );
        }

        if (v._tag === "updated" && s.round === settings.rounds) {
          return finish(s, Reply.cases.behind.make({ ...identity(s), head: v.head, main: v.main, rounds: s.round }));
        }

        return ask(
          Model.cases.checking.make({
            ...progress(s),
            kind: s.kind,
            checks: s.checks,
            head: v.head,
            tree: v.tree,
            round: s.round + (v._tag === "updated" ? 1 : 0),
            until: clamp(m.at + wait),
            step: asking(m.at),
          }),
          m.at,
          0,
          v._tag === "updated",
        );
      }

      if (v._tag === "conflict") {
        return finish(s, Reply.cases.conflict.make({ ...identity(s), main: v.main, paths: v.paths }));
      }

      if (v._tag === "moved") {
        return finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head }));
      }

      return finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state }));
    }

    if (s._tag === "checking" && m.type === "checks_ok") {
      const verdict = Change.verdict(s.checks, m.value);

      if (verdict._tag === "red") {
        return finish(s, Reply.cases.red.make({ ...identity(s), head: s.head, runs: verdict.runs }));
      }

      if (verdict._tag === "green") {
        return ask(
          Model.cases.updating.make({
            ...progress(s),
            kind: s.kind,
            checks: s.checks,
            head: s.head,
            round: s.round,
            checked: s.tree,
            step: asking(m.at),
          }),
          m.at,
          0,
          false,
        );
      }

      if (verdict._tag === "lost" || m.at >= s.until) {
        return [
          {
            ...s,
            until: clamp(m.at + wait),
            step: waiting(s, m.at, verdict._tag === "lost" ? "ci_lost" : "ci_silent"),
          },
          [],
        ];
      }

      return [
        { ...s, step: Step.cases.waiting.make({ tries: s.step.tries, at: clamp(m.at + poll), reason: "pending" }) },
        [],
      ];
    }

    if (s._tag === "merging" && m.type === "merge_ok") {
      const v = m.value;

      if (v._tag === "merged") {
        return finish(
          s,
          Reply.cases.merged.make({ ...identity(s), head: s.head, commit: v.commit, tree: v.tree, checked: s.tree }),
        );
      }

      if (v._tag === "moved") {
        return finish(s, Reply.cases.moved.make({ ...identity(s), head: v.head }));
      }

      if (v._tag === "conflict") {
        return finish(s, Reply.cases.conflict.make({ ...identity(s), main: v.main, paths: v.paths }));
      }

      return finish(s, Reply.cases.closed.make({ ...identity(s), state: v.state }));
    }

    return [s, []];
  };
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [change, update, checks, merge, Send.send, StartChild.exit],
    init: (loaded) => [loaded ?? Model.cases.idle.make({ attempt: 0, late: 0 }), []],
    update: {
      land: reduce,
      abandon: reduce,
      timer: reduce,
      change_ok: reduce,
      change_err: reduce,
      update_ok: reduce,
      update_err: reduce,
      checks_ok: reduce,
      checks_err: reduce,
      merge_ok: reduce,
      merge_err: reduce,
      send_ok: reduce,
      send_err: reduce,
    },
  });
  return Program.make({
    name: "pipeline/merger",
    machine,
    state: { v: 2, upgrades: [rounds] },
    view: (s) => ({
      state: s._tag,
      ref: s._tag === "idle" ? null : s.job.ref,
      change: s._tag === "idle" ? null : s.job.change,
      head: s._tag === "idle" ? null : s._tag === "reading" ? s.job.head : s.head,
      round: s._tag === "updating" || s._tag === "checking" ? s.round : null,
      attempt: s.attempt,
      tries: s._tag === "idle" ? null : s.step.tries,
      late: s.late,
    }),
    refuse: (s, m) =>
      m.type === "land"
        ? s._tag === "idle"
          ? null
          : { reason: "busy" }
        : m.type !== "abandon"
          ? null
          : s._tag === "idle"
            ? { reason: "idle" }
            : s._tag === "merging"
              ? { reason: "merging" }
              : m.ref !== s.job.ref
                ? { reason: "other_job" }
                : null,
    inputs: { land: "Land this change at its pinned head", abandon: "Abandon this job before merging" },
    outputs: {},
    writes: {},
    wake: (s) => (s._tag === "idle" ? null : s.step.at),
  });
};
