import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Checks, Status } from "@kampus/libfabrika/ci/Ci";
import * as CiTest from "@kampus/libfabrika/ci/CiTest";
import { Change, Commit, Merged, Tree, Updated } from "@kampus/libfabrika/codehost/CodeHost";
import { Queued } from "@kampus/libfabrika/runtime/Send";
import { ConfigProvider, Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as ChangeKind from "./Change.ts";
import * as Mail from "./Mail.ts";
import { merger } from "./Merger.ts";
import * as Settings from "./Settings.ts";

type Program = ReturnType<typeof merger>;
type Model = Program["machine"]["model"]["Type"];
type Msg = Program["msg"]["Type"];
type Command = ReturnType<Program["machine"]["init"]>[1][number];
const ctx = stubCtxThrowingProxy<never>();
const LAST = 8.64e15;
const clamp = (time: number) => Math.min(time, LAST);
const faults = ["unavailable", "rate_limited", "refused", "handler_failed", "bad_cmd"] as const;

const positive = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 6 }) },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) },
);

const world = fc.record({
  complete: fc.boolean(),
  ending: fc.constantFrom("merged", "checks", "merge"),
  size: fc.constantFrom(40, 64),
  ref: CiTest.word,
  name: CiTest.word,
  source: CiTest.word,
  wait: positive,
  poll: positive,
  backoff: positive,
  empty: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  paths: fc.option(
    fc.array(fc.constantFrom("rows/x.json", "docs/a.md", "src/a.ts", ".dot", "docs/a b.md", "docs/[x].md"), {
      maxLength: 6,
    }),
    { nil: null },
  ),
});

type World = typeof world extends fc.Arbitrary<infer A> ? A : never;

const settingsFor = (w: World) =>
  Effect.runSync(
    Settings.all.parse(
      ConfigProvider.fromUnknown(
        {
          queue: {
            kinds: { rows: ["rows/**"], docs: ["docs/**"] },
            checks: Object.fromEntries(
              ["rows", "docs", "code"].map((kind, i) => [kind, w.empty[i] ? [] : [{ name: w.name, source: w.source }]]),
            ),
          },
          merger: { wait: w.wait, poll: w.poll, backoff: w.backoff },
        },
        { preserveEmptyStrings: true },
      ),
    ),
  );

const id = (w: World, char: string) => Schema.decodeUnknownSync(Commit)(char.repeat(w.size));
const tree = (w: World, char: string) => Schema.decodeUnknownSync(Tree)(char.repeat(w.size));
const land = (w: World) => Mail.Land.make({ type: "land", ref: w.ref, change: 1, head: id(w, "a"), reply: "queue" });
const equal = (a: unknown, b: unknown) => expect(a).toEqual(b);

const runAt = (w: World, choice: number) => ({
  name: w.name,
  source: w.source,
  id: "run",
  startedAt: null,
  completedAt: null,
  url: null,
  status:
    choice % 9 < 2
      ? choice % 2 === 0
        ? Status.cases.queued.make({})
        : Status.cases.running.make({})
      : Status.cases.done.make({
          conclusion: ["success", "failure", "timed_out", "skipped", "neutral", "cancelled", "startup_failure"][
            choice % 7
          ]! as (typeof Status.cases.done.Type)["conclusion"],
        }),
});

const valueFor = (w: World, cmd: Command, pick: number): unknown => {
  if (cmd.type === "change") {
    if (pick % 8 === 0) {
      return Change.cases.missing.make({ change: cmd.change });
    }

    return Change.cases.found.make({
      change: cmd.change,
      head: pick % 7 === 0 ? id(w, "b") : id(w, "a"),
      state: pick % 6 < 3 ? "open" : (["draft", "closed", "merged"] as const)[pick % 3]!,
      paths: w.paths,
    });
  }

  if (cmd.type === "update") {
    if (pick % 7 === 0) {
      return Updated.cases.moved.make({ head: id(w, "c") });
    }

    if (pick % 7 === 1) {
      return Updated.cases.conflict.make({ main: id(w, "d"), paths: pick % 2 === 0 ? [] : ["src/a.ts"] });
    }

    if (pick % 7 === 2) {
      return Updated.cases.closed.make({ state: (["draft", "closed", "merged"] as const)[pick % 3]! });
    }

    return pick % 2 === 0
      ? Updated.cases.current.make({ head: cmd.head, tree: tree(w, "e"), main: id(w, "d") })
      : Updated.cases.updated.make({ head: id(w, "b"), tree: tree(w, "e"), main: id(w, "d") });
  }

  if (cmd.type === "checks") {
    return Schema.decodeUnknownSync(Checks)(pick % 11 === 0 ? [] : [runAt(w, pick)]);
  }

  if (cmd.type === "merge") {
    if (pick % 7 === 0) {
      return Merged.cases.moved.make({ head: id(w, "c") });
    }

    if (pick % 7 === 1) {
      return Merged.cases.conflict.make({ main: id(w, "d"), paths: pick % 2 === 0 ? [] : ["src/a.ts"] });
    }

    if (pick % 7 === 2) {
      return Merged.cases.closed.make({ state: pick % 2 === 0 ? "closed" : "draft" });
    }

    return Merged.cases.merged.make({ commit: id(w, "f"), tree: tree(w, pick % 2 === 0 ? "e" : "9") });
  }

  return Queued.make({ id: "queued" });
};

const answer = (p: Program, w: World, cmd: Command, drawn: number, at: number): Msg => {
  const pick = w.complete
    ? cmd.type === "change"
      ? 2
      : cmd.type === "update"
        ? 4
        : cmd.type === "checks" && w.ending !== "checks"
          ? 7
          : cmd.type === "merge" && w.ending === "merged"
            ? 3
            : drawn
    : drawn;
  return Schema.decodeUnknownSync(p.msg)(
    cmd.type !== "send" && pick % 5 === 0
      ? {
          type: `${cmd.type}_err`,
          cmd,
          error: Schema.TaggedStruct(faults[Math.floor(pick / 5) % faults.length]!, {}).make({}),
          reason: faults[Math.floor(pick / 5) % faults.length],
          at,
        }
      : cmd.type === "send" && pick % 2 === 0
        ? { type: "send_err", cmd, error: Schema.TaggedStruct("forbidden", {}).make({}), reason: "forbidden", at }
        : { type: `${cmd.type}_ok`, cmd, value: valueFor(w, cmd, pick), at },
  );
};

// tea draws answers only to Cmds that were emitted. The second fold moves each clock forward and
// chooses due/stale timers from the actual state, so shrinking keeps a legal walk.
const guided = (p: Program, w: World) => {
  const draw = fc.record({ pick: fc.nat(), at: fc.integer({ min: 0, max: LAST }) });
  const cell = {
    draw,
    make: (cmd: Command, cell: { pick: number; at: number }) => answer(p, w, cmd, cell.pick, cell.at),
  };
  const cells = { change: cell, update: cell, checks: cell, merge: cell, send: cell };
  return arbGuidedSequence(
    p.machine,
    ctx,
    {
      outside: {
        land: fc.constant(land(w)),
        timer: fc.record({ type: fc.constant("timer" as const), at: fc.integer({ min: 0, max: LAST }) }),
        ...(w.complete ? {} : { abandon: fc.constant(Mail.Abandon.make({ type: "abandon", ref: w.ref })) }),
      },
      answers: cells,
    },
    { maxLength: 120, size: "max" },
  ).chain((raw) =>
    fc.array(draw, { minLength: 12, maxLength: 80, size: "max" }).map((tail) => {
      let model = p.machine.init(null, ctx)[0];
      let out: ReadonlyArray<Command> = [];
      let clock = 0;
      let started = false;
      const msgs: Array<Msg> = [];

      for (const event of raw) {
        let msg: Msg = Schema.decodeUnknownSync(p.msg)(event);

        if (event.type === "timer") {
          const due = p.wake(model);

          const at =
            due === null
              ? clamp(clock + (event.at % 10_000))
              : event.at % 3 === 0
                ? Math.max(clock, due - 1)
                : Math.max(clock, due);
          msg = Schema.decodeUnknownSync(p.msg)({ type: "timer", at });
          clock = at;
        } else if ("cmd" in event && event.cmd.type !== "send") {
          const command = out.find((c) => c.type === event.cmd.type && "attempt" in c && c.attempt === model.attempt);

          if (command === undefined || model._tag === "idle" || model.step._tag !== "asking") {
            continue;
          }

          clock = clamp(
            Math.max(
              clock,
              event.at % 7 === 0 && model._tag === "checking" ? model.until : clock + (event.at % 10_000),
            ),
          );
          msg = Schema.decodeUnknownSync(p.msg)({ ...event, cmd: command, at: clock });
        } else if ("cmd" in event && event.cmd.type === "send") {
          clock = Math.max(clock, event.at);
          msg = Schema.decodeUnknownSync(p.msg)({ ...event, at: clock });
        } else if (event.type === "land" || event.type === "abandon") {
          if (p.refuse(model, event) !== null) {
            continue;
          }

          if (event.type === "land" && started) {
            break;
          }

          if (event.type === "land") {
            started = true;
          }
        }

        msgs.push(msg);
        const [next, commands] = applyCell<Model, Msg, Command>(p.machine, model, msg);
        model = next;
        out = [...out, ...commands];
      }

      // Continue from the state the fold reached. Tea's blind picks can leave an old request
      // unanswered after a retry; this tail answers only the current attempt and fires saved waits.
      for (const cell of tail) {
        let msg: Msg;

        if (model._tag === "idle") {
          if (started) {
            break;
          }

          msg = land(w);
          started = true;
        } else if (model.step._tag === "waiting" || (model.step.at !== null && cell.pick % 7 === 0)) {
          clock = Math.max(clock, model.step.at!);
          msg = Schema.decodeUnknownSync(p.msg)({ type: "timer", at: clock });
        } else {
          const cmd = out.findLast((c) => c.type !== "send" && c.attempt === model.attempt);

          if (cmd === undefined) {
            break;
          }

          clock = clamp(
            Math.max(clock, model._tag === "checking" && cell.at % 3 === 0 ? model.until : clock + (cell.at % 10_000)),
          );
          msg = answer(p, w, cmd, cell.pick, clock);
        }

        msgs.push(msg);
        const [next, commands] = applyCell<Model, Msg, Command>(p.machine, model, msg);
        model = next;
        out = [...out, ...commands];
      }

      return msgs;
    }),
  );
};

const service = (cmd: Command) => cmd.type !== "send";

const stateCmd = (model: Model) =>
  model._tag === "reading"
    ? "change"
    : model._tag === "updating"
      ? "update"
      : model._tag === "checking"
        ? "checks"
        : "merge";

// Each invariant reads a complete tea fold. A cut-off job is checked for its prefix, never for a
// reply it has not sent yet.
const inspect = (p: Program, w: World, msgs: ReadonlyArray<Msg>, law: string) => {
  expect.hasAssertions();
  const folded = foldEvents(p.machine, ctx, null, msgs);
  expect(folded.initCmds).toEqual([]);
  expect(p.wake(folded.states[0]!)).toBeNull();
  let reached = false;
  let replies = 0;
  let checkedHead: string | null = null;
  let checkedTree: string | null = null;
  let green = false;
  let asks = 0;

  for (const { prev, msg, next, cmds } of folded.steps) {
    const sent = cmds.filter((c) => c.type === "send");
    const asked = cmds.filter(service);

    if (law === "L9") {
      const own = Mail.Abandon.make({ type: "abandon", ref: prev._tag === "idle" ? w.ref : prev.job.ref });
      expect(p.refuse(prev, own)?.reason ?? null).toBe(
        prev._tag === "idle" ? "idle" : prev._tag === "merging" ? "merging" : null,
      );
    }

    if (prev._tag === "idle" && msg.type === "land") {
      replies = 0;
      checkedHead = null;
      checkedTree = null;
      green = false;
    }

    if (
      msg.type === "update_ok" &&
      prev._tag === "updating" &&
      prev.step._tag === "asking" &&
      msg.cmd.attempt === prev.attempt &&
      (msg.value._tag === "current" || msg.value._tag === "updated")
    ) {
      checkedHead = msg.value.head;
      checkedTree = msg.value.tree;
    }

    if (
      msg.type === "checks_ok" &&
      prev._tag === "checking" &&
      prev.step._tag === "asking" &&
      msg.cmd.attempt === prev.attempt
    ) {
      green = ChangeKind.verdict(prev.checks, msg.value)._tag === "green";
    }

    if (law === "L1") {
      for (const cmd of cmds) {
        if (cmd.type === "merge") {
          reached = true;
          expect(green).toBe(true);
          expect(cmd.head).toBe(checkedHead);
        }
      }
    }

    if (law === "L10") {
      for (const cmd of sent) {
        if (cmd.type === "send" && Schema.is(Mail.Reply)(cmd.m) && cmd.m._tag === "merged") {
          reached = true;
          expect(cmd.m.checked).toBe(checkedTree);
        }
      }
    }

    if (law === "L2") {
      if (sent.length > 0) {
        reached = true;
      }

      replies += sent.length;
      expect(replies).toBeLessThanOrEqual(1);

      if (prev._tag !== "idle" && next._tag === "idle") {
        expect(replies).toBe(1);
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ ref: prev.job.ref, change: prev.job.change });
      } else if (next._tag !== "idle") {
        expect(replies).toBe(0);
      }

      if ("value" in msg) {
        if (msg.type === "change_ok") {
          const value = msg.value;

          if (value._tag === "missing") {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "closed", state: "missing" });
          } else if (value._tag === "found" && value.state !== "open") {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "closed", state: value.state });
          }
        }

        if (msg.type === "update_ok" || msg.type === "merge_ok") {
          if (msg.value._tag === "conflict") {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({
              _tag: "conflict",
              main: msg.value.main,
              paths: msg.value.paths,
            });
          }

          if (msg.value._tag === "closed") {
            expect(next._tag).toBe("idle");
            expect(sent).toHaveLength(1);
            expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "closed", state: msg.value.state });
          }
        }
      }

      if (msg.type === "send_err" || msg.type === "send_ok") {
        equal(next, prev);
        expect(cmds).toEqual([]);
      }
    }

    if (law === "L4") {
      if (next._tag !== "idle" && next.step._tag === "waiting") {
        reached = true;
      }

      expect(p.wake(next)).toBe(next._tag === "idle" ? null : next.step.at);

      if (msg.type === "timer" && (prev._tag === "idle" || prev.step.at === null || msg.at < prev.step.at)) {
        equal(next, prev);
        expect(cmds).toEqual([]);
      }
    }

    if (
      law === "L8" &&
      "value" in msg &&
      (msg.type === "change_ok" || msg.type === "update_ok" || msg.type === "merge_ok")
    ) {
      if (
        msg.value._tag === "moved" ||
        (msg.type === "change_ok" &&
          msg.value._tag === "found" &&
          msg.value.state === "open" &&
          prev._tag !== "idle" &&
          msg.value.head !== prev.job.head)
      ) {
        expect(next._tag).toBe("idle");
        expect(sent).toHaveLength(1);
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "moved", head: msg.value.head });
        reached = true;
        expect(asked).toEqual([]);
      }
    }

    if (law === "L9" && msg.type === "abandon" && prev._tag !== "idle" && prev._tag !== "merging") {
      reached = true;
      expect(next._tag).toBe("idle");
      expect(p.wake(next)).toBeNull();
      expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "abandoned", ref: prev.job.ref });
    }

    if (
      law === "L13" &&
      msg.type === "change_ok" &&
      prev._tag === "reading" &&
      msg.value._tag === "found" &&
      msg.value.state === "open" &&
      msg.value.head === prev.job.head
    ) {
      const kind = ChangeKind.kind(settingsFor(w).kinds, msg.value.paths);

      if (settingsFor(w).checks[kind].length === 0) {
        reached = true;
        expect(asked).toEqual([]);
        expect(next._tag).toBe("idle");
        expect(sent[0]?.type === "send" && sent[0].m).toMatchObject({ _tag: "unset", kind });
      }
    }

    if (law === "L3" && prev._tag !== "idle") {
      const at = "at" in msg ? msg.at : null;
      const taken =
        "cmd" in msg &&
        msg.cmd.type === stateCmd(prev) &&
        "attempt" in msg.cmd &&
        msg.cmd.attempt === prev.attempt &&
        prev.step._tag === "asking";
      const verdict =
        taken && msg.type === "checks_ok" && prev._tag === "checking"
          ? ChangeKind.verdict(prev.checks, msg.value)._tag
          : null;
      const fault =
        (taken && msg.type.endsWith("_err")) ||
        verdict === "lost" ||
        (verdict === "pending" && prev._tag === "checking" && at !== null && at >= prev.until);

      if (fault && at !== null) {
        reached = true;
        expect(sent).toEqual([]);
        expect(asked).toEqual([]);
        expect(next._tag).toBe(prev._tag);

        if (next._tag !== "idle") {
          expect(next.step._tag).toBe("waiting");
          expect(next.step.tries).toBe(prev.step.tries + 1);
          expect(next.step.at).toBe(clamp(at + Math.min(w.poll * 1000 * 2 ** prev.step.tries, w.backoff * 1000)));

          if (taken && "error" in msg) {
            expect(next.step._tag === "waiting" && next.step.reason).toBe(msg.error._tag);
          }

          if (verdict === "lost") {
            expect(next.step._tag === "waiting" && next.step.reason).toBe("ci_lost");
          }

          if (verdict === "pending") {
            expect(next.step._tag === "waiting" && next.step.reason).toBe("ci_silent");
          }
        }
      }

      if (verdict === "pending" && !fault && at !== null && next._tag === "checking") {
        expect(next.step.at).toBe(clamp(at + w.poll * 1000));
        expect(next.step.tries).toBe(prev.step.tries);
      }

      if (prev._tag === "checking" && next._tag === "checking") {
        expect(next.until).toBe(
          (verdict === "lost" || (verdict === "pending" && fault)) && at !== null
            ? clamp(at + w.wait * 60_000)
            : prev.until,
        );
      }

      if (msg.type === "timer" && prev.step.at !== null && msg.at >= prev.step.at) {
        reached = true;
        expect(asked).toHaveLength(1);
        expect(asked[0]?.type).toBe(stateCmd(prev));

        if (next._tag !== "idle") {
          expect(next.step.tries).toBe(prev.step.tries + (prev.step._tag === "asking" ? 1 : 0));
        }

        if (asked[0]?.type === "checks") {
          expect(asked[0].start).toBe(!(prev.step._tag === "waiting" && prev.step.reason === "pending"));
        }
      }

      for (const cmd of asked) {
        if (at !== null && next._tag !== "idle") {
          expect(next.step._tag).toBe("asking");
          expect(next.step.at).toBe(clamp(at + w.wait * 60_000));
        }

        expect(cmd.type).toBe(next._tag === "idle" ? "none" : stateCmd(next));
      }

      if (next._tag !== prev._tag && next._tag !== "idle") {
        expect(next.step.tries).toBe(0);
      }
    }

    for (const cmd of asked) {
      asks++;

      if ("attempt" in cmd) {
        expect(cmd.attempt).toBe(asks);
      }
    }
  }

  return reached;
};

describe("the merger, next/", () => {
  for (const law of ["L1", "L2", "L3", "L4", "L8", "L9", "L10", "L13"]) {
    it(`${law}: generated worlds obey the merger's contract at every prefix`, () => {
      const walks = world.chain((w) => {
        const p = merger(settingsFor(w));
        return guided(p, w).map((msgs) => ({ w, p, msgs }));
      });
      let reached = 0;
      fc.assert(
        fc.property(walks, ({ w, p, msgs }) => {
          if (inspect(p, w, msgs, law)) {
            reached++;
          }
        }),
        { seed: 119120, numRuns: 200 },
      );
      expect(reached, `${law} reached its deciding event`).toBeGreaterThan(0);
    });
  }

  it("L14: refusal, old answers and send receipts preserve the job and its alarm", () => {
    fc.assert(
      fc.property(
        world,
        fc.commands(
          [
            fc.record({ pick: fc.nat(), move: fc.nat() }).map(
              (
                cell,
              ): fc.Command<
                {
                  model: Model;
                  history: Array<Command>;
                  current: ReadonlyArray<Command>;
                  clock: number;
                  asks: number;
                  replies: number;
                },
                { p: Program; w: World }
              > => ({
                check: () => true,
                run: (m, { p, w }) => {
                  const prev = m.model;
                  const active = m.current.find(
                    (c) => c.type !== "send" && "attempt" in c && c.attempt === prev.attempt,
                  );
                  const late = m.history.filter(
                    (c) =>
                      c.type !== "send" &&
                      (prev._tag === "idle" ||
                        prev.step._tag !== "asking" ||
                        !("attempt" in c) ||
                        c.attempt !== prev.attempt ||
                        c.type !== stateCmd(prev)),
                  );
                  const moves: Array<() => Msg> = [
                    () => land(w),
                    () =>
                      Schema.decodeUnknownSync(p.msg)({
                        type: "abandon",
                        ref: cell.pick % 2 === 0 && prev._tag !== "idle" ? prev.job.ref : `${w.ref}other`,
                      }),
                  ];

                  if (active !== undefined && prev._tag !== "idle" && prev.step._tag === "asking") {
                    moves.push(() => answer(p, w, active, cell.pick, m.clock));
                  }

                  if (prev._tag !== "idle" && prev.step.at !== null) {
                    moves.push(() =>
                      Schema.decodeUnknownSync(p.msg)({ type: "timer", at: Math.max(m.clock, prev.step.at!) }),
                    );
                  }

                  if (late.length > 0) {
                    moves.push(() => answer(p, w, late[cell.pick % late.length]!, cell.pick, m.clock));
                  }

                  const send = m.history.find((c) => c.type === "send");

                  if (send !== undefined) {
                    moves.push(() => answer(p, w, send, cell.pick, m.clock));
                  }

                  const msg = moves[cell.move % moves.length]!();
                  const refused =
                    msg.type === "land"
                      ? prev._tag !== "idle"
                        ? "busy"
                        : null
                      : msg.type === "abandon"
                        ? prev._tag === "idle"
                          ? "idle"
                          : prev._tag === "merging"
                            ? "merging"
                            : msg.ref !== prev.job.ref
                              ? "other_job"
                              : null
                        : null;

                  if (msg.type === "land" || msg.type === "abandon") {
                    expect(p.refuse(prev, msg)?.reason ?? null).toBe(refused);

                    if (refused !== null) {
                      equal(m.model, prev);
                      return;
                    }
                  }

                  const [next, cmds] = applyCell<Model, Msg, Command>(p.machine, prev, msg);

                  if (msg.type === "land" && prev._tag === "idle") {
                    m.replies = 0;
                  }

                  m.replies += cmds.filter((c) => c.type === "send").length;
                  expect(m.replies).toBeLessThanOrEqual(1);

                  if (prev._tag !== "idle" && next._tag === "idle") {
                    expect(m.replies).toBe(1);
                  }

                  if (msg.type === "send_ok" || msg.type === "send_err") {
                    equal(next, prev);
                    expect(cmds).toEqual([]);
                  } else if (
                    "cmd" in msg &&
                    (prev._tag === "idle" ||
                      prev.step._tag !== "asking" ||
                      msg.cmd.type !== stateCmd(prev) ||
                      !("attempt" in msg.cmd) ||
                      msg.cmd.attempt !== prev.attempt)
                  ) {
                    equal(next, { ...prev, late: prev.late + 1 });
                    expect(cmds).toEqual([]);
                    expect(p.wake(next)).toBe(p.wake(prev));
                  }

                  for (const cmd of cmds.filter(service)) {
                    expect("attempt" in cmd && cmd.attempt).toBe(++m.asks);
                  }

                  expect(next.attempt).toBe(m.asks);
                  m.model = next;
                  m.history.push(...cmds);
                  m.current = cmds.length > 0 ? cmds : m.current;

                  if ("at" in msg) {
                    m.clock = msg.at;
                  }
                },
                toString: () => JSON.stringify(cell),
              }),
            ),
          ],
          { maxCommands: 100 },
        ),
        (w, commands) => {
          const p = merger(settingsFor(w));
          const [model, initial] = p.machine.init(null, ctx);
          expect(model).toMatchObject({ _tag: "idle", attempt: 0, late: 0 });
          fc.modelRun(
            () => ({
              model: { model, history: [...initial], current: initial, clock: 0, asks: 0, replies: 0 },
              real: { p, w },
            }),
            commands,
          );
        },
      ),
      { seed: 119120, numRuns: 200 },
    );
  });
});
