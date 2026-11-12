// P14 slice 2, next/ (ticket 828): the program client, laws L4 (p1, letters) and L5 (p3, views) of the
// approved plan. Written before `runtime/Client.ts`.
//
// The shape these laws hold `Client.ts` to, from the plan (the build may add more):
// - `clientMachineFor(checks)`: one tea machine factory. `checks.decode(pid)` is that pid's own view
//   decoder, a function that returns the checked view or throws; the factory captures it, so it is in
//   no Model, Msg or Cmd input (A7).
// - Model `Client`: {written, seen, pending, views}. `pending` is a list of `Pending`: dating{n, pid, m,
//   seen, viewRev} or ready{the same, letter, sentAt, traceId?}. `views` is a record by pid of
//   `Shown` {rev, view}.
// - Msgs by `type`: press{pid, m}, dated{n, letter, sentAt, traceId?}, reply{letter, answer} where
//   answer is accepted{rev, pos}, refused{reason, now?, most?}, unreachable{} or unknown{}, read{rev},
//   notice{pid, note}. A note is what the brain's runner publishes, as it arrived: whole{rev, view} or
//   patch{base, rev, patch}, by `type`. Cmd: ask{pid}.
// - `sendable(client)`: the ready letters ahead of the first slot still dating, in slot order.
//
// libfabrika may not import a program (boundary B12, `boundary-rules.json`), so L5 steps a tea machine of
// the counter's own shape, defined here, and turns each step into its notice with the real `diff`. The
// real counter is pressed through the real page in L15.
//
// Each law walks the real machine from its real init. Each step reads the folded state (the pending
// list, the letters this walk dated, the counter's real model and the notices already delivered) and
// picks a move that state allows; stale and malformed input is built from what the walk delivered.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import type { Client } from "./Client.ts";
import { clientMachineFor, sendable } from "./Client.ts";
import { diff } from "./Patch.ts";

const SEED = 119120;
const opts = { seed: SEED, numRuns: 300 };

// The exam's own statement of the shapes it walks, each pinned to the schema's type (0135).
type Dating = {
  readonly _tag: "dating";
  readonly n: number;
  readonly pid: string;
  readonly m: Schema.Json;
  readonly seen: number;
  readonly viewRev: number;
};

type Ready = Omit<Dating, "_tag"> & {
  readonly _tag: "ready";
  readonly letter: string;
  readonly sentAt: string;
  readonly traceId?: string;
};

type Model = {
  readonly written: number;
  readonly seen: number;
  readonly pending: ReadonlyArray<Dating | Ready>;
  readonly views: { readonly [pid: string]: { readonly rev: number; readonly view: Schema.Json } };
};

expectTypeOf<Model>().toEqualTypeOf<typeof Client.Type>();

/** A program of the counter's shape: its model is its view. */
const counterModel = Schema.Struct({ count: Schema.Int });
type CounterView = typeof counterModel.Type;
type CounterMsg = { readonly type: "inc" } | { readonly type: "dec" } | { readonly type: "reset" };

const counterMachine = Machine.make({
  model: counterModel,
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("inc") }),
    Schema.Struct({ type: Schema.Literal("dec") }),
    Schema.Struct({ type: Schema.Literal("reset") }),
  ]),
  cmds: [],
  init: (loaded: CounterView | null) => [loaded ?? { count: 0 }, []],
  update: {
    inc: (s) => [{ count: s.count + 1 }, []],
    dec: (s) => [{ count: s.count - 1 }, []],
    reset: () => [{ count: 0 }, []],
  },
});

type Answer =
  | { readonly _tag: "accepted"; readonly rev: number; readonly pos: number }
  | { readonly _tag: "refused"; readonly reason: string }
  | { readonly _tag: "unreachable" }
  | { readonly _tag: "unknown" };

type Msg =
  | { readonly type: "press"; readonly pid: string; readonly m: unknown }
  | { readonly type: "dated"; readonly n: number; readonly letter: string; readonly sentAt: string }
  | { readonly type: "reply"; readonly letter: string; readonly answer: Answer }
  | { readonly type: "read"; readonly rev: number }
  | { readonly type: "notice"; readonly pid: string; readonly note: unknown };

type Out = ReadonlyArray<{ readonly type: string; readonly pid?: string }>;

const COUNTER = "pid_counter";
const OTHER = "pid_other";
/** Another program's view, so a counter view on its pid, or its view on the counter's, is refused. */
const otherModel = Schema.Struct({ title: Schema.String });

/** Each pid's own decoder, counting which pid's decoder checked which notice. */
const checksWith = (log: Array<string>) => ({
  decode: (pid: string) => (view: unknown) => {
    log.push(pid);
    return pid === COUNTER ? Schema.decodeUnknownSync(counterModel)(view) : Schema.decodeUnknownSync(otherModel)(view);
  },
});

const machineWith = (log: Array<string>) => clientMachineFor(checksWith(log));
type Machine = ReturnType<typeof machineWith>;
const step = (machine: Machine, c: Model, m: Msg): readonly [Model, Out] => applyCell(machine, c, m);

// --- L4: letters ----------------------------------------------------------------------------------

const letterChoice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  answer: fc.nat(),
  rev: fc.integer({ min: 0, max: 40 }),
  word: fc.stringMatching(/^[a-z0-9]{6}$/),
});

type LetterChoice = typeof letterChoice extends fc.Arbitrary<infer C> ? C : never;

const answerFor = (c: LetterChoice): Answer =>
  [
    { _tag: "accepted", rev: c.rev, pos: c.rev } as const,
    { _tag: "refused", reason: "too_many" } as const,
    { _tag: "unreachable" } as const,
    { _tag: "unknown" } as const,
  ][c.answer % 4]!;

/** The walk's own memory: every letter it dated, by slot, and the views it showed. */
type LetterWalk = { c: Model; letters: Map<number, Ready>; settled: Array<string> };

const letterMoves = (w: LetterWalk, c: LetterChoice): ReadonlyArray<Msg> => {
  const dating = w.c.pending.filter((p) => p._tag === "dating");
  const ready = w.c.pending.filter((p): p is Ready => p._tag === "ready");
  const pid = c.pick % 2 === 0 ? COUNTER : OTHER;
  const out: Array<Msg> = [
    { type: "press", pid, m: [{ type: "inc" }, { type: "dec" }, { type: "reset" }][c.answer % 3] },
    { type: "read", rev: w.c.seen + (c.rev % 5) - 2 },
    // A whole view shown for the press to capture, through the real notice path.
    { type: "notice", pid: COUNTER, note: { type: "whole", rev: c.rev, view: { count: c.rev } } },
  ];

  if (dating.length > 0) {
    const slot = dating[c.pick % dating.length]!;
    out.push({
      type: "dated",
      n: slot.n,
      letter: `letter_${c.word}`,
      sentAt: `2026-11-11T00:00:${String(c.rev % 60).padStart(2, "0")}Z`,
    });
  }

  if (ready.length > 0) {
    const r = ready[c.pick % ready.length]!;
    // A second date for a slot already ready, and the reply for one of the walk's own letters.
    out.push({ type: "dated", n: r.n, letter: `letter_again_${c.word}`, sentAt: "2026-11-11T01:00:00Z" });
    out.push({ type: "reply", letter: r.letter, answer: answerFor(c) });
  }

  if (w.settled.length > 0) {
    out.push({ type: "reply", letter: w.settled[c.pick % w.settled.length]!, answer: answerFor(c) });
  }

  out.push({ type: "reply", letter: `letter_never_${c.word}`, answer: answerFor(c) });
  return out;
};

const letterWalk = (
  list: ReadonlyArray<LetterChoice>,
  each: (prev: LetterWalk, m: Msg, next: Model, out: Out) => void,
): LetterWalk => {
  const machine = machineWith([]);
  const w: LetterWalk = { c: machine.init(null, {})[0], letters: new Map(), settled: [] };

  for (const c of list) {
    const options = letterMoves(w, c);
    const m = options[c.move % options.length]!;
    const [next, out] = step(machine, w.c, m);
    each({ c: w.c, letters: new Map(w.letters), settled: [...w.settled] }, m, next, out);

    for (const p of next.pending) {
      if (p._tag === "ready" && !w.letters.has(p.n)) {
        w.letters.set(p.n, p);
      }
    }

    for (const r of w.c.pending) {
      if (r._tag === "ready" && !next.pending.some((p) => p._tag === "ready" && p.letter === r.letter)) {
        w.settled.push(r.letter);
      }
    }

    w.c = next;
  }

  return w;
};

const letterWalks = fc.array(letterChoice, { minLength: 1, maxLength: 60 });

describe("L4: client letters (p1)", () => {
  it("a letter keeps its id and body from its first date until its own terminal reply", () => {
    let redated = 0;
    fc.assert(
      fc.property(letterWalks, (list) => {
        letterWalk(list, (prev, m, next) => {
          const dated = next.pending.filter((p) => p._tag === "ready" && prev.letters.has(p.n));
          expect(dated, "a slot changed after its first date").toEqual(dated.map((p) => prev.letters.get(p.n)));

          if (m.type === "dated" && prev.letters.has(m.n)) {
            redated++;
          }
        });
      }),
      opts,
    );
    expect(redated, "the walks dated a ready slot again").toBeGreaterThan(0);
  });

  it("ready letters go in slot order, and a dating letter is never sendable", () => {
    let blocked = 0;
    fc.assert(
      fc.property(letterWalks, (list) => {
        letterWalk(list, (_prev, _m, next) => {
          const out = sendable(next);
          const firstDating = next.pending.findIndex((p) => p._tag === "dating");
          const expected = (firstDating < 0 ? next.pending : next.pending.slice(0, firstDating)).filter(
            (p): p is Ready => p._tag === "ready",
          );
          expect(out).toEqual(expected);
          expect(out.map((p) => p.n)).toEqual([...out.map((p) => p.n)].sort((a, b) => a - b));
          expect(next.pending.map((p) => p.n)).toEqual([...next.pending.map((p) => p.n)].sort((a, b) => a - b));

          if (firstDating >= 0 && next.pending.slice(firstDating).some((p) => p._tag === "ready")) {
            blocked++;
          }
        });
      }),
      opts,
    );
    expect(blocked, "the walks held a ready letter behind a dating one").toBeGreaterThan(0);
  });

  it("only its own accepted or refused reply removes a letter; unreachable and unknown keep it", () => {
    const seen = { removed: 0, kept: 0 };
    fc.assert(
      fc.property(letterWalks, (list) => {
        letterWalk(list, (prev, m, next) => {
          const gone = prev.c.pending.filter((p) => !next.pending.some((q) => q.n === p.n));
          const terminal = m.type === "reply" && (m.answer._tag === "accepted" || m.answer._tag === "refused");
          const own = prev.c.pending.filter((p) => p._tag === "ready" && m.type === "reply" && p.letter === m.letter);

          seen.removed += terminal && own.length > 0 ? 1 : 0;
          seen.kept += !terminal && m.type === "reply" && own.length > 0 ? 1 : 0;
          expect(gone, `${m.type} removed the wrong letters`).toEqual(terminal && own.length > 0 ? own : []);
        });
      }),
      opts,
    );
    expect(seen.removed).toBeGreaterThan(0);
    expect(seen.kept).toBeGreaterThan(0);
  });

  it("a press reserves the next slot with the viewRev shown for its pid and the seen read", () => {
    let presses = 0;
    fc.assert(
      fc.property(letterWalks, (list) => {
        letterWalk(list, (prev, m, next) => {
          if (m.type !== "press") {
            return;
          }

          presses++;
          expect(next.written).toBe(prev.c.written + 1);
          expect(next.pending.at(-1)).toEqual({
            _tag: "dating",
            n: prev.c.written,
            pid: m.pid,
            m: m.m,
            seen: prev.c.seen,
            viewRev: prev.c.views[m.pid]?.rev ?? 0,
          });
        });
      }),
      opts,
    );
    expect(presses).toBeGreaterThan(0);
  });

  it("read only raises seen, and never moves a letter", () => {
    fc.assert(
      fc.property(letterWalks, (list) => {
        letterWalk(list, (prev, m, next) => {
          expect(next.seen).toBeGreaterThanOrEqual(prev.c.seen);

          if (m.type === "read") {
            expect(next.seen).toBe(Math.max(prev.c.seen, m.rev));
            expect(next.pending).toEqual(prev.c.pending);
          }
        });
      }),
      opts,
    );
  });
});

// --- L5: views ------------------------------------------------------------------------------------

const viewChoice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  input: fc.constantFrom<CounterMsg>({ type: "inc" }, { type: "dec" }, { type: "reset" }),
  bad: fc.nat(),
});

type ViewChoice = typeof viewChoice extends fc.Arbitrary<infer C> ? C : never;

/** The brain's side of the walk: the real counter's model at each revision, and every notice it made. */
type Brain = { rev: number; views: Array<CounterView>; made: Array<{ readonly note: unknown }> };

const brainStep = (b: Brain, input: CounterMsg): unknown => {
  const before = b.views[b.rev]!;
  const [after] = applyCell(counterMachine, before, input);
  b.views.push(after);
  b.rev += 1;
  return { type: "patch", base: b.rev - 1, rev: b.rev, patch: diff(before, after) };
};

/** A notice this walk already made, broken one way: an op that is not RFC 6902, a path that is not
 *  there, a value of the wrong type, or the whole of another program. */
const corrupt = (b: Brain, c: ViewChoice): unknown => {
  // Each broken patch is the next one the brain would send, from the current rev to the one after.
  const rev = b.rev;
  const view = b.views[rev]!;
  return [
    { type: "patch", base: rev, rev: rev + 1, patch: [{ op: "move", from: "/count", path: "/n" }] },
    { type: "patch", base: rev, rev: rev + 1, patch: [{ op: "replace", path: "/missing/deep", value: 1 }] },
    { type: "patch", base: rev, rev: rev + 1, patch: [{ op: "replace", path: "/count", value: "three" }] },
    { type: "whole", rev, view: { title: `count ${view.count}` } },
    { type: "whole", rev, view: { count: 1.5 } },
    { type: "patch", base: rev, rev: rev + 1, patch: "not a list" },
  ][c.bad % 6];
};

type ViewWalk = { c: Model; brain: Brain; log: Array<string> };

type Notice = { readonly pid: string; readonly note: unknown };

/** The moves the walk's state allows, each made only when it is picked, since a step moves the brain. */
const viewMoves = (w: ViewWalk, c: ViewChoice): ReadonlyArray<() => Notice> => {
  const b = w.brain;
  const delivered = b.made.map((d) => d.note);
  const out: Array<() => Notice> = [
    // The counter steps and its patch arrives in order.
    () => ({ pid: COUNTER, note: brainStep(b, c.input) }),
    // A whole view of now, as an open's answer or a fresh watch gives it.
    () => ({ pid: COUNTER, note: { type: "whole", rev: b.rev, view: b.views[b.rev] } }),
    () => ({ pid: COUNTER, note: corrupt(b, c) }),
    // The counter's view on the other program's pid, and that program's own view.
    () => ({ pid: OTHER, note: { type: "whole", rev: b.rev, view: b.views[b.rev] } }),
    () => ({ pid: OTHER, note: { type: "whole", rev: b.rev, view: { title: `t${b.rev}` } } }),
    // A gap: the counter steps twice and only the second patch arrives.
    () => {
      brainStep(b, c.input);
      return { pid: COUNTER, note: brainStep(b, c.input) };
    },
  ];

  if (delivered.length > 0) {
    // A repeat or a reordering of a notice already delivered.
    out.push(() => ({ pid: COUNTER, note: delivered[c.pick % delivered.length] }));
  }

  return out;
};

const viewWalk = (
  list: ReadonlyArray<ViewChoice>,
  each: (prev: ViewWalk, notice: Notice, next: Model, out: Out, w: ViewWalk) => void,
): void => {
  const log: Array<string> = [];
  const machine = machineWith(log);
  const w: ViewWalk = {
    c: machine.init(null, {})[0],
    brain: { rev: 0, views: [counterMachine.init(null, {})[0]], made: [] },
    log,
  };

  for (const c of list) {
    const options = viewMoves(w, c);
    const notice = options[c.move % options.length]!();
    const snapshot = structuredClone(notice.note);
    const before = structuredClone(w.c);
    const prev: ViewWalk = { ...w, c: w.c, log: [...log] };
    log.length = 0;
    const [next, out] = step(machine, w.c, { type: "notice", ...notice });
    expect(notice.note, "a notice was changed").toEqual(snapshot);
    expect(w.c, "the old Model was changed").toEqual(before);
    each(prev, notice, next, out, w);
    w.brain.made.push({ note: notice.note });
    w.c = next;
  }
};

const viewWalks = fc.array(viewChoice, { minLength: 1, maxLength: 50 });
const decodes = (pid: string, view: unknown): boolean => Schema.is(pid === COUNTER ? counterModel : otherModel)(view);

const noteType = (note: unknown): unknown =>
  typeof note === "object" && note !== null ? Reflect.get(note, "type") : null;

const noteRev = (note: unknown): unknown =>
  typeof note === "object" && note !== null ? Reflect.get(note, "rev") : null;

describe("L5: client views (p3)", () => {
  it("every view shown decodes by its own pid's decoder, and the counter's is the real counter's at its rev", () => {
    fc.assert(
      fc.property(viewWalks, (list) => {
        viewWalk(list, (_prev, _n, next, _out, w) => {
          for (const [pid, shown] of Object.entries(next.views)) {
            expect(decodes(pid, shown.view), `${pid} shows ${JSON.stringify(shown.view)}`).toBe(true);

            if (pid === COUNTER) {
              expect(shown.view).toEqual(w.brain.views[shown.rev]);
            }
          }
        });
      }),
      opts,
    );
  });

  it("a whole installs exactly when its pid's decoder passes, else keeps the last view and asks once", () => {
    const seen = { installed: 0, refused: 0 };
    fc.assert(
      fc.property(viewWalks, (list) => {
        viewWalk(list, (prev, notice, next, out) => {
          if (noteType(notice.note) !== "whole") {
            return;
          }

          const view = Reflect.get(Object(notice.note), "view");
          const ok = decodes(notice.pid, view);
          seen[ok ? "installed" : "refused"]++;
          expect(next.views).toEqual(
            ok ? { ...prev.c.views, [notice.pid]: { rev: noteRev(notice.note), view } } : prev.c.views,
          );
          expect(out).toEqual(ok ? [] : [{ type: "ask", pid: notice.pid }]);
        });
      }),
      opts,
    );
    expect(seen.installed).toBeGreaterThan(0);
    expect(seen.refused).toBeGreaterThan(0);
  });

  it("a patch installs only at rev + 1 from the shown rev and only when its result decodes; else the view stays and it asks at most once", () => {
    const seen = { installed: 0, gap: 0, bad: 0 };
    fc.assert(
      fc.property(viewWalks, (list) => {
        viewWalk(list, (prev, notice, next, out) => {
          if (noteType(notice.note) !== "patch") {
            return;
          }

          const shown = prev.c.views[notice.pid];
          const note = Object(notice.note);
          const changed = next.views[notice.pid] !== shown;
          const asks = out.filter((o) => o.type === "ask");
          expect(asks.length).toBeLessThanOrEqual(1);
          expect(asks.every((o) => o.pid === notice.pid)).toBe(true);
          expect(
            Object.keys(next.views)
              .filter((p) => p !== notice.pid)
              .map((p) => next.views[p]),
          ).toEqual(
            Object.keys(next.views)
              .filter((p) => p !== notice.pid)
              .map((p) => prev.c.views[p]),
          );

          if (changed) {
            seen.installed++;
            expect(shown).toBeDefined();
            expect(note.base).toBe(shown!.rev);
            expect(note.rev).toBe(shown!.rev + 1);
            expect(decodes(notice.pid, next.views[notice.pid]!.view)).toBe(true);
            return;
          }

          if (shown !== undefined && typeof note.rev === "number" && note.rev > shown.rev + 1) {
            seen.gap++;
            expect(asks, "a gap asks once for a whole view").toHaveLength(1);
          }

          if (shown !== undefined && note.rev === shown.rev + 1 && note.base === shown.rev) {
            seen.bad++;
            expect(asks, "a bad patch at the next rev asks once").toHaveLength(1);
          }
        });
      }),
      opts,
    );
    expect(seen.installed).toBeGreaterThan(0);
    expect(seen.gap).toBeGreaterThan(0);
    expect(seen.bad).toBeGreaterThan(0);
  });

  it("a notice for one pid is checked by that pid's decoder only, and changes no other pid's view", () => {
    let checked = 0;
    fc.assert(
      fc.property(viewWalks, (list) => {
        viewWalk(list, (_prev, notice, _next, _out, w) => {
          checked += w.log.length;
          expect(
            w.log.every((pid) => pid === notice.pid),
            `${notice.pid}'s notice checked by ${w.log.join(",")}`,
          ).toBe(true);
        });
      }),
      opts,
    );
    expect(checked).toBeGreaterThan(0);
  });
});
