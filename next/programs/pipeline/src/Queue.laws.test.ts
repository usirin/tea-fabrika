import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { expect, it } from "@effect/vitest";
import { Status } from "@kampus/libfabrika/ci/Ci";
import { Commit, Tree } from "@kampus/libfabrika/codehost/CodeHost";
import { Started } from "@kampus/libfabrika/processes/Children";
import { Queued } from "@kampus/libfabrika/runtime/Send";
import { StartRefusal } from "@kampus/libfabrika/runtime/StartChild";
import { ConfigProvider, Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as Mail from "./Mail.ts";
import { queue } from "./Queue.ts";
import * as Settings from "./Settings.ts";

type Program = ReturnType<typeof queue>;
type Model = Program["machine"]["model"]["Type"];
type Msg = Program["msg"]["Type"];
type Command = ReturnType<Program["machine"]["init"]>[1][number];
type Entry = { change: number; head: string; reply: { to: string; ref: string } | null };
type Active = Entry & { name: string; ref: string };

type Oracle = {
  state: "idle" | "starting" | "landing" | "stopped";
  current: Active | null;
  line: Array<Entry>;
  attempt: number;
  late: number;
  since: number | null;
  reason: unknown;
};

const ctx = stubCtxThrowingProxy<never>();
const head = Schema.decodeUnknownSync(Commit)("a".repeat(40));
const tree = Schema.decodeUnknownSync(Tree)("b".repeat(40));
const other = Schema.decodeUnknownSync(Tree)("c".repeat(40));
const pid = "process_0000000000e008000000000001";

const draw = fc.record({
  pick: fc.nat(),
  move: fc.nat(),
  at: fc.maxSafeNat(),
  reply: fc.boolean(),
  drift: fc.boolean(),
  which: fc.integer({ min: 0, max: 7 }),
});

type Cell = typeof draw extends fc.Arbitrary<infer A> ? A : never;
const world = fc.record({ most: fc.integer({ min: 1, max: 6 }), enabled: fc.boolean() });
type World = typeof world extends fc.Arbitrary<infer A> ? A : never;

const program = (w: World) =>
  queue({
    name: "queue:law",
    settings: Effect.runSync(
      Settings.all.parse(
        ConfigProvider.fromUnknown({
          queue: { most: w.most, checks: { rows: [], docs: [], code: w.enabled ? [{ name: "check" }] : [] } },
        }),
      ),
    ),
  });

const initial = (): Oracle => ({
  state: "idle",
  current: null,
  line: [],
  attempt: 0,
  late: 0,
  since: null,
  reason: null,
});

const enqueue = (cell: Cell, change: number) =>
  Mail.Enqueue.make({
    type: "enqueue",
    change,
    head,
    ...(cell.reply ? { reply: { to: `lane:${change}`, ref: `own:${cell.pick}` } } : {}),
  });

const reply = (cell: Cell, active: Pick<Active, "ref" | "change">): typeof Mail.Reply.Type => {
  const fields = { type: "reply" as const, ref: active.ref, change: active.change };

  switch (cell.which) {
    case 0:
      return Mail.Reply.cases.merged.make({
        ...fields,
        head,
        commit: head,
        tree: cell.drift ? other : tree,
        checked: tree,
      });
    case 1:
      return Mail.Reply.cases.red.make({
        ...fields,
        head,
        runs: [
          {
            name: "check",
            source: "push",
            id: "red",
            status: Status.cases.done.make({ conclusion: "failure" }),
            startedAt: null,
            completedAt: null,
            url: null,
          },
        ],
      });
    case 2:
      return Mail.Reply.cases.conflict.make({ ...fields, main: head, paths: ["src/a.ts"] });
    case 3:
      return Mail.Reply.cases.moved.make({ ...fields, head });
    case 4:
      return Mail.Reply.cases.closed.make({ ...fields, state: "closed" });
    case 5:
      return Mail.Reply.cases.unset.make({ ...fields, kind: "rows" });
    case 6:
      return Mail.Reply.cases.abandoned.make(fields);
    default:
      return Mail.Reply.cases.behind.make({ ...fields, head, main: head, rounds: 2 });
  }
};

const startAnswer = (p: Program, cmd: Extract<Command, { type: "start_child" }>, cell: Cell): Msg => {
  const which = cell.pick % (StartRefusal.literals.length + 3);
  return Schema.decodeUnknownSync(p.msg)(
    which < 3
      ? {
          type: "start_child_ok",
          cmd,
          at: cell.at,
          value:
            which === 0
              ? Started.cases.started.make({ process: pid, name: cmd.name, rev: 1 })
              : which === 1
                ? Started.cases.already_started.make({ process: pid, name: cmd.name })
                : Started.cases.already_present.make({ process: pid, name: cmd.name }),
        }
      : {
          type: "start_child_err",
          cmd,
          at: cell.at,
          error: Schema.TaggedStruct(StartRefusal.literals[which - 3]!, {}).make({}),
        },
  );
};

const refusal = (m: Oracle, w: World, msg: Msg) => {
  if (msg.type === "enqueue") {
    if (!w.enabled) {
      return { reason: "unset" };
    }

    if (m.current?.change === msg.change || m.line.some((e) => e.change === msg.change)) {
      return { reason: "queued" };
    }

    if (m.line.length >= w.most) {
      return { reason: "full", now: m.line.length, most: w.most };
    }
  }

  if (msg.type === "drop") {
    if (m.current?.change !== msg.change && !m.line.some((e) => e.change === msg.change)) {
      return { reason: "missing" };
    }

    if (m.current?.change === msg.change && m.state === "starting") {
      return { reason: "starting" };
    }
  }

  if (msg.type === "resume" && m.state !== "stopped") {
    return { reason: "running" };
  }

  return null;
};

type Walk = { oracle: Oracle; model: Model; history: Array<Command>; p: Program; w: World; seen: Set<string> };

// The expected line comes only from accepted inputs and replies, never from the queue's line.
const step = (walk: Walk, input: Msg) => {
  const { p, w, oracle: m, model: before } = walk;
  const refused = refusal(m, w, input);
  const original = structuredClone(before);
  const originalView = p.view.select(before);
  expect(p.refuse(before, input)).toEqual(refused);
  expect(before).toEqual(original);

  if (refused !== null) {
    walk.seen.add(refused.reason);
    expect(p.view.select(walk.model)).toEqual(originalView);
    return;
  }

  const expected: Array<unknown> = [];
  const forward = (entry: Entry, answer: typeof Mail.Reply.Type) => {
    if (entry.reply !== null) {
      expected.push({ type: "send", to: entry.reply.to, m: { ...answer, ref: entry.reply.ref } });
    }
  };
  const next = () => {
    const entry = m.line.shift();
    m.reason = null;
    m.since = null;

    if (entry === undefined) {
      m.state = "idle";
      m.current = null;
    } else {
      m.attempt++;
      m.state = "starting";
      m.current = { ...entry, name: `merger:${entry.change}.${m.attempt}`, ref: String(m.attempt) };
      expected.push({
        type: "start_child",
        program: "pipeline/merger",
        name: m.current.name,
        input: { type: "land", ref: m.current.ref, change: entry.change, head: entry.head, reply: "queue:law" },
      });
      walk.seen.add("started");
    }
  };

  if (input.type === "enqueue") {
    m.line.push({ change: input.change, head: input.head, reply: input.reply ?? null });

    if (m.state === "idle") {
      next();
    } else if (m.state === "stopped") {
      walk.seen.add("enqueue_stopped");
    }
  } else if (input.type === "start_child_ok" || input.type === "start_child_err") {
    if (m.state !== "starting" || input.cmd.name !== m.current?.name) {
      m.late++;
    } else if (input.type === "start_child_ok" && input.value._tag === "started") {
      m.state = "landing";
      m.since = input.at;
    } else {
      const current = m.current!;
      const tag = input.type === "start_child_ok" ? input.value._tag : input.error._tag;
      m.reason = Schema.TaggedStruct("start_refused", {
        change: Schema.Number,
        name: Schema.String,
        refusal: Schema.String,
      }).make({ change: current.change, name: current.name, refusal: tag });
      m.line.unshift({ change: current.change, head: current.head, reply: current.reply });
      m.current = null;
      m.state = "stopped";
      m.since = null;
      walk.seen.add(tag);
    }
  } else if (input.type === "reply") {
    if (m.state !== "landing" || input.ref !== m.current?.ref) {
      m.late++;
    } else {
      forward(m.current, input);
      walk.seen.add(input._tag);
      walk.seen.add(`reply:${input._tag}`);

      if (input._tag === "merged" && input.tree !== input.checked) {
        m.state = "stopped";
        m.reason = Schema.TaggedStruct("tree_drift", {
          change: Schema.Number,
          commit: Commit,
          tree: Tree,
          checked: Tree,
        }).make({ change: input.change, commit: input.commit, tree: input.tree, checked: input.checked });
        m.current = null;
        m.since = null;
        walk.seen.add("drift");
      } else {
        next();
      }
    }
  } else if (input.type === "drop") {
    if (m.current?.change === input.change) {
      expected.push({
        type: "send",
        to: m.current.name,
        m: Mail.Abandon.make({ type: "abandon", ref: m.current.ref }),
      });
      walk.seen.add("abandon_current");
    } else {
      for (const entry of m.line.filter((e) => e.change === input.change)) {
        forward(entry, Mail.Reply.cases.abandoned.make({ type: "reply", ref: "dropped", change: entry.change }));
      }

      m.line = m.line.filter((e) => e.change !== input.change);
      walk.seen.add("drop_waiting");
    }
  } else if (input.type === "resume") {
    next();
  }

  const [model, commands] = applyCell<Model, Msg, Command>(p.machine, before, input);
  expect(commands).toEqual(expected);
  expect(model._tag).toBe(m.state);
  expect(model.attempt).toBe(m.attempt);
  expect(model.late).toBe(m.late);
  expect(p.wake(model)).toBeNull();
  expect(p.view.select(model)).toEqual({
    state: m.state,
    current: m.current === null ? null : { change: m.current.change, head: m.current.head, name: m.current.name },
    since: m.since,
    line: m.line.map(({ change, head }) => ({ change, head })),
    attempt: m.attempt,
    late: m.late,
    reason: m.reason,
    unset: w.enabled ? null : "queue.checks",
  });

  if (model._tag === "starting" || model._tag === "landing") {
    expect(model.current).toBeDefined();
  }

  if (model._tag === "idle") {
    expect("current" in model).toBe(false);
    expect("line" in model).toBe(false);
  }

  walk.model = model;
  walk.history.push(...commands);
};

const open = (w: World, seen: Set<string>): Walk => {
  const p = program(w);
  const [model, commands] = p.machine.init(null, ctx);
  expect(commands).toEqual([]);
  expect(p.inputs.resume).toMatchObject({ personOnly: true });
  return { p, w, model, oracle: initial(), history: [], seen };
};

const choose = (walk: Walk, cell: Cell): Msg => {
  const { p, oracle: m } = walk;
  const starts = walk.history.filter((c) => c.type === "start_child");
  const sends = walk.history.filter((c) => c.type === "send");
  const queued = [...(m.current === null ? [] : [m.current]), ...m.line];
  const moves: Array<() => unknown> = [
    () => enqueue(cell, (cell.pick % 10) + 1),
    () =>
      Mail.Drop.make({
        type: "drop",
        change: cell.pick % 2 === 0 && queued.length > 0 ? queued[cell.pick % queued.length]!.change : 99,
      }),
    () => Mail.Resume.make({ type: "resume" }),
    () => reply(cell, cell.pick % 3 !== 0 && m.current !== null ? m.current : { ref: `late:${cell.pick}`, change: 99 }),
  ];

  if (starts.length > 0) {
    moves.push(() => startAnswer(p, starts[cell.pick % starts.length]!, cell));
  }

  if (m.state === "starting") {
    const current = starts.findLast((cmd) => cmd.name === m.current?.name)!;
    moves.push(() => startAnswer(p, current, cell));
  }

  if (sends.length > 0) {
    moves.push(() =>
      cell.pick % 2 === 0
        ? { type: "send_ok", cmd: sends[cell.pick % sends.length], at: cell.at, value: Queued.make({ id: "sent" }) }
        : {
            type: "send_err",
            cmd: sends[cell.pick % sends.length],
            at: cell.at,
            error: Schema.TaggedStruct("forbidden", {}).make({}),
          },
    );
  }

  return Schema.decodeUnknownSync(p.msg)(moves[cell.move % moves.length]!());
};

for (const law of [
  "Q1: one landing at a time",
  "Q2: arrival order survives drops and refused starts",
  "Q3: one reply with the enqueuer's ref, and no retry",
  "Q6: refusals are ordered and stale answers change only late",
]) {
  it(law, () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        world,
        fc.commands(
          [
            draw.map((cell): fc.Command<Walk, object> => ({
              check: () => true,
              run: (walk) => step(walk, choose(walk, cell)),
              toString: () => JSON.stringify(cell),
            })),
          ],
          { maxCommands: 100, size: "max" },
        ),
        (w, commands) => {
          fc.modelRun(() => ({ model: open(w, seen), real: {} }), commands);
        },
      ),
      { seed: 119120, numRuns: 200 },
    );

    if (law.startsWith("Q3")) {
      for (const tag of ["merged", "red", "conflict", "moved", "closed", "unset", "abandoned", "behind"]) {
        expect(seen.has(`reply:${tag}`), tag).toBe(true);
      }
    }

    for (const reached of [
      "started",
      "queued",
      "unset",
      "full",
      "starting",
      "missing",
      "running",
      "drop_waiting",
      "abandon_current",
    ]) {
      expect(seen.has(reached), reached).toBe(true);
    }
  });
}

for (const [law, reached] of [
  ["Q4: tree drift stops until resume and keeps new entries", "drift"],
  ["Q5: every refused start goes back first under a fresh name", "start_refused"],
  ["Q7: drop mails abandon and waits for the merger's reply", "abandon_current"],
] as const) {
  it(law, () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        world.chain((drawn) => {
          const w = { ...drawn, enabled: true };
          const p = program(w);
          const first = draw.map((cell) => enqueue(cell, (cell.pick % 10) + 1));
          const guided = arbGuidedSequence(
            p.machine,
            ctx,
            {
              outside: {
                enqueue: first,
                resume: fc.constant(Mail.Resume.make({ type: "resume" })),
                drop: fc.integer({ min: 1, max: 10 }).map((change) => Mail.Drop.make({ type: "drop", change })),
              },
              answers: { start_child: { draw, make: (cmd, cell) => startAnswer(p, cmd, cell) } },
            },
            { maxLength: 100, size: "max" },
          );
          return fc
            .tuple(guided, fc.array(draw, { minLength: 80, maxLength: 100 }))
            .map(([msgs, cells]) => ({ w, msgs, cells }));
        }),
        ({ w, msgs, cells }) => {
          const walk = open(w, seen);

          // The guided fold supplies real start answers. Other moves are chosen from the state reached.
          for (let i = 0; i < cells.length; i++) {
            const raw = msgs[i];
            const askedName = raw !== undefined && "cmd" in raw && raw.cmd.type === "start_child" ? raw.cmd.name : null;
            const emitted =
              askedName === null || walk.history.some((cmd) => cmd.type === "start_child" && askedName === cmd.name);
            step(walk, raw !== undefined && emitted && i % 2 === 0 ? raw : choose(walk, cells[i]!));

            if (walk.oracle.state === "stopped" && walk.oracle.reason !== null) {
              seen.add("start_refused");
            }
          }
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
    expect(seen.has(reached), reached).toBe(true);

    if (law.startsWith("Q4")) {
      expect(seen.has("enqueue_stopped")).toBe(true);
    }

    if (law.startsWith("Q5")) {
      for (const tag of [...StartRefusal.literals, "already_started", "already_present"]) {
        expect(seen.has(tag), tag).toBe(true);
      }
    }
  });
}

// pinned: Q8 is a compile-time contract. CI checks the deliberately invalid assignments.
const invalidModels = (idle: Extract<Model, { _tag: "idle" }>, entry: Entry) => {
  // @ts-expect-error idle cannot hold a waiting line
  const line: Extract<Model, { _tag: "idle" }> = { ...idle, line: [entry] };
  // @ts-expect-error idle cannot hold a current landing
  const current: Extract<Model, { _tag: "idle" }> = { ...idle, current: entry };
  // @ts-expect-error a reply address requires its ref
  const partial: typeof Mail.Enqueue.Type = { type: "enqueue", change: 1, head, reply: { to: "lane" } };
  return [line, current, partial];
};

void invalidModels;
