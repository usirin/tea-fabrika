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
// libfabrika may not import a program (boundary B12, `boundary-rules.json`), so L5 gives each of 1 to 3
// pids a generated view shape (a list of items, a bare array, or a record holding an array), changes
// each value by generated edits that grow, shrink and edit its arrays, and turns each change into its
// notice with the real `diff`. The real checklist goes through this client in its own L23.
//
// Each law walks the real machine from its real init. Each step reads the folded state (the pending
// list, the letters this walk dated, each pid's values and the notices already delivered) and picks a
// move that state allows; stale and malformed input is built from what the walk delivered.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import type { Client, ClientMsg, Pending } from "./Client.ts";
import { clientMachineFor, sendable } from "./Client.ts";
import { apply, diff } from "./Patch.ts";

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

expectTypeOf<Dating>().toEqualTypeOf<Extract<Pending, { readonly _tag: "dating" }>>();
expectTypeOf<Ready>().toEqualTypeOf<Extract<Pending, { readonly _tag: "ready" }>>();

type Model = {
  readonly written: number;
  readonly seen: number;
  readonly pending: ReadonlyArray<Dating | Ready>;
  readonly views: { readonly [pid: string]: { readonly rev: number; readonly view: Schema.Json } };
};

expectTypeOf<Model>().toEqualTypeOf<typeof Client.Type>();

type Msg = ClientMsg;
type Answer = Extract<Msg, { readonly type: "reply" }>["answer"];

type Out = ReadonlyArray<{ readonly type: string; readonly pid?: string }>;

// --- The view shapes L5 gives its pids ------------------------------------------------------------

const Item = Schema.Struct({ name: Schema.String, done: Schema.Boolean });

const SHAPES = {
  list: Schema.Struct({ items: Schema.Array(Item), left: Schema.Int }),
  tags: Schema.Array(Schema.String),
  record: Schema.Struct({ title: Schema.String, n: Schema.Int, rows: Schema.Array(Schema.Int) }),
} as const;

type Kind = keyof typeof SHAPES;
const KINDS = Object.keys(SHAPES) as ReadonlyArray<Kind>;
type ListView = typeof SHAPES.list.Type;
type TagsView = typeof SHAPES.tags.Type;
type RecordView = typeof SHAPES.record.Type;

const START: { readonly [K in Kind]: (typeof SHAPES)[K]["Type"] } = {
  list: { items: [], left: 0 },
  tags: [],
  record: { title: "", n: 0, rows: [] },
};

/** One generated edit of a value of `kind`, chosen from what the value holds now. */
const edit = (kind: Kind, value: unknown, e: number, at: number, word: string): unknown => {
  if (kind === "list") {
    const v = value as ListView;
    const i = v.items.length === 0 ? 0 : at % v.items.length;
    const items =
      v.items.length === 0 || e % 4 === 0
        ? [...v.items, { name: word, done: false }]
        : e % 4 === 1
          ? v.items.filter((_, j) => j !== i)
          : e % 4 === 2
            ? v.items.map((it, j) => (j === i ? { ...it, done: !it.done } : it))
            : [{ name: word, done: false }, ...v.items];
    return { items, left: items.filter((it) => !it.done).length };
  }

  if (kind === "tags") {
    const v = value as TagsView;
    const i = v.length === 0 ? 0 : at % v.length;
    return v.length === 0 || e % 4 === 0
      ? [...v, word]
      : e % 4 === 1
        ? v.filter((_, j) => j !== i)
        : e % 4 === 2
          ? v.map((t, j) => (j === i ? word : t))
          : [word, ...v];
  }

  const v = value as RecordView;
  const i = v.rows.length === 0 ? 0 : at % v.rows.length;
  return e % 4 === 0
    ? { ...v, title: word }
    : e % 4 === 1
      ? { ...v, n: v.n + 1 }
      : e % 4 === 2 || v.rows.length === 0
        ? { ...v, rows: [...v.rows, at] }
        : { ...v, rows: v.rows.filter((_, j) => j !== i) };
};

/** Each pid's own decoder, counting which pid's decoder checked which notice. */
const checksWith = (kinds: ReadonlyMap<string, Kind>, log: Array<string>) => ({
  decode: (pid: string) => (view: unknown) => {
    log.push(pid);
    return Schema.decodeUnknownSync(SHAPES[kinds.get(pid) ?? "list"])(view);
  },
});

const machineWith = (kinds: ReadonlyMap<string, Kind>, log: Array<string>) => clientMachineFor(checksWith(kinds, log));
type Machine = ReturnType<typeof machineWith>;
const step = (machine: Machine, c: Model, m: Msg): readonly [Model, Out] => applyCell(machine, c, m);

// --- L4: letters ----------------------------------------------------------------------------------

/** L4's pids: each shows a bare list of words, so a press can capture the rev it shows. */
const LETTER_PIDS = ["pid_a", "pid_b"] as const;
const LETTER_KINDS: ReadonlyMap<string, Kind> = new Map(LETTER_PIDS.map((pid) => [pid, "tags"]));

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
  const pid = LETTER_PIDS[c.pick % LETTER_PIDS.length]!;
  const out: Array<Msg> = [
    {
      type: "press",
      pid,
      m: [
        { type: "add", name: c.word },
        { type: "check", name: c.word },
        { type: "remove", name: c.word },
      ][c.answer % 3],
    },
    { type: "read", rev: w.c.seen + (c.rev % 5) - 2 },
    // A whole view shown for the press to capture, through the real notice path.
    { type: "notice", pid, note: { type: "whole", rev: c.rev, view: [`v${c.rev}`] } },
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
  const machine = machineWith(LETTER_KINDS, []);
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
  edit: fc.nat(),
  at: fc.nat({ max: 40 }),
  bad: fc.nat(),
  word: fc.stringMatching(/^[a-z~/]{1,6}$/),
});

type ViewChoice = typeof viewChoice extends fc.Arbitrary<infer C> ? C : never;

/** The brain's side of one pid: its value at each revision, and every notice it made. */
type Brain = { readonly kind: Kind; rev: number; views: Array<unknown>; made: Array<unknown> };

const brainStep = (b: Brain, c: ViewChoice): unknown => {
  const before = b.views[b.rev]!;
  const after = edit(b.kind, before, c.edit, c.at, c.word);
  b.views.push(after);
  b.rev += 1;
  return { type: "patch", base: b.rev - 1, rev: b.rev, patch: diff(before, after) };
};

/** The next notice the brain would send, broken one way: an op that is not RFC 6902, a path that is
 *  not there, an array index past the end, a value of the wrong type, the whole of another shape, or no
 *  list of ops at all. */
const corrupt = (b: Brain, c: ViewChoice): unknown => {
  const rev = b.rev;
  const next = (patch: unknown) => ({ type: "patch", base: rev, rev: rev + 1, patch });
  const wrongType =
    b.kind === "list"
      ? [{ op: "replace", path: "/left", value: "three" }]
      : b.kind === "tags"
        ? [{ op: "add", path: "/-", value: 3 }]
        : [{ op: "replace", path: "/n", value: "x" }];
  const pastEnd = b.kind === "list" ? "/items/99" : b.kind === "tags" ? "/99" : "/rows/99";
  const other = KINDS.find((k) => k !== b.kind && !Schema.is(SHAPES[b.kind])(START[k]))!;
  return [
    next([{ op: "move", from: "/x", path: "/y" }]),
    next([{ op: "replace", path: "/missing/deep", value: 1 }]),
    next([{ op: "remove", path: pastEnd }]),
    next(wrongType),
    { type: "whole", rev, view: START[other] },
    next("not a list"),
  ][c.bad % 6];
};

type Notice = {
  readonly pid: string;
  readonly note: unknown;
  readonly foreign?: "whole" | "malformed";
};

type ViewWalk = {
  c: Model;
  accepted: Model["views"];
  brains: Map<string, Brain>;
  log: Array<string>;
  delivered: Array<Notice>;
};

/** The moves the walk's state allows, each made only when it is picked, since a step moves a brain. */
const viewMoves = (w: ViewWalk, c: ViewChoice): ReadonlyArray<() => Notice> => {
  const pids = [...w.brains.keys()];
  const pid = pids[c.pick % pids.length]!;
  const b = w.brains.get(pid)!;
  const out: Array<() => Notice> = [
    // The pid's value changes and its patch arrives in order.
    () => ({ pid, note: brainStep(b, c) }),
    // A whole view of now, as an open's answer or a fresh watch gives it.
    () => ({ pid, note: { type: "whole", rev: b.rev, view: b.views[b.rev] } }),
    () => ({ pid, note: corrupt(b, c) }),
    // A gap: the value changes twice and only the second patch arrives.
    () => {
      brainStep(b, c);
      return { pid, note: brainStep(b, c) };
    },
  ];

  const others = pids.filter((p) => p !== pid);

  if (others.length > 0) {
    const other = w.brains.get(others[c.at % others.length]!)!;
    const view = other.views.at(-1);
    // Equal schemas can accept a foreign value. A malformed foreign value must still be refused.
    out.push(() => ({ pid, note: { type: "whole", rev: b.rev, view }, foreign: "whole" }));
    out.push(() => ({
      pid,
      note: { type: "whole", rev: b.rev, view: b.kind === "tags" ? { foreign: view } : [view] },
      foreign: "malformed",
    }));
  }

  if (w.delivered.length > 0) {
    // A repeat or a reordering of a notice already delivered, to the pid it was for.
    out.push(() => w.delivered[c.pick % w.delivered.length]!);
  }

  return out;
};

const viewWalk = (
  kinds: ReadonlyArray<Kind>,
  list: ReadonlyArray<ViewChoice>,
  each: (prev: ViewWalk, notice: Notice, next: Model, out: Out, w: ViewWalk) => void,
): void => {
  const log: Array<string> = [];
  const pids = new Map(kinds.map((kind, i) => [`pid_${i}_${kind}`, kind] as const));
  const machine = machineWith(pids, log);
  const w: ViewWalk = {
    c: machine.init(null, {})[0],
    accepted: {},
    brains: new Map([...pids].map(([pid, kind]) => [pid, { kind, rev: 0, views: [START[kind]], made: [] }])),
    log,
    delivered: [],
  };

  for (const c of list) {
    const options = viewMoves(w, c);
    const notice = options[c.move % options.length]!();
    const snapshot = structuredClone(notice.note);
    const before = structuredClone(w.c);
    const prev: ViewWalk = { ...w, c: w.c, log: [...log] };
    log.length = 0;
    w.accepted = acceptNotice(w.accepted, notice);
    const [next, out] = step(machine, w.c, { type: "notice", pid: notice.pid, note: notice.note });
    expect(notice.note, "a notice was changed").toEqual(snapshot);
    expect(w.c, "the old Model was changed").toEqual(before);
    each(prev, notice, next, out, w);
    w.delivered.push(notice);
    w.c = next;
  }
};

const viewWalks = fc.tuple(
  fc.array(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 3 }),
  fc.array(viewChoice, { minLength: 1, maxLength: 50 }),
);

const pidKind = (pid: string): Kind => pid.slice(pid.lastIndexOf("_") + 1) as Kind;
const decodes = (pid: string, view: unknown): boolean => Schema.is(SHAPES[pidKind(pid)])(view);

const noteType = (note: unknown): unknown =>
  typeof note === "object" && note !== null ? Reflect.get(note, "type") : null;

const noteRev = (note: unknown): unknown =>
  typeof note === "object" && note !== null ? Reflect.get(note, "rev") : null;

// L6 checks apply independently. Here the oracle owns revision and decoder checks, starting from
// notices it accepted, since a valid foreign whole can replace the brain's historical value.
const acceptNotice = (views: Model["views"], { pid, note }: Notice): Model["views"] => {
  const body = Object(note);
  const shown = views[pid];
  let view: unknown;

  if (noteType(note) === "whole") {
    view = body.view;
  } else if (noteType(note) === "patch" && shown && body.base === shown.rev && body.rev === shown.rev + 1) {
    const result = apply(shown.view, body.patch);

    if (Result.isFailure(result)) {
      return views;
    }

    view = result.success;
  } else {
    return views;
  }

  return decodes(pid, view) ? { ...views, [pid]: { rev: body.rev, view: view as Schema.Json } } : views;
};

describe("L5: client views (p3)", () => {
  it("every view shown decodes by its own pid's decoder and follows the notices accepted for that pid", () => {
    let arrays = 0;
    const foreign = { accepted: 0, refused: 0, different: 0 };
    fc.assert(
      fc.property(viewWalks, ([kinds, list]) => {
        viewWalk(kinds, list, (prev, notice, next, out, w) => {
          expect(next.views).toEqual(w.accepted);

          if (notice.foreign === "whole" && decodes(notice.pid, Object(notice.note).view)) {
            foreign.accepted++;
            foreign.different +=
              JSON.stringify(Object(notice.note).view) !==
              JSON.stringify(w.brains.get(notice.pid)!.views[noteRev(notice.note) as number])
                ? 1
                : 0;
          }

          if (notice.foreign === "malformed") {
            foreign.refused++;
            expect(decodes(notice.pid, Object(notice.note).view)).toBe(false);
            expect(next.views).toEqual(prev.c.views);
            expect(out).toEqual([{ type: "ask", pid: notice.pid }]);
          }

          for (const [pid, shown] of Object.entries(next.views)) {
            expect(decodes(pid, shown.view), `${pid} shows ${JSON.stringify(shown.view)}`).toBe(true);
            arrays += JSON.stringify(shown.view).includes("[") && shown.rev > 0 ? 1 : 0;
          }
        });
      }),
      opts,
    );
    expect(arrays, "the walks installed views holding arrays").toBeGreaterThan(0);
    expect(foreign.accepted, "equal schemas accepted a foreign whole").toBeGreaterThan(0);
    expect(foreign.different, "a foreign whole differed from the target brain's history").toBeGreaterThan(0);
    expect(foreign.refused, "malformed foreign wholes were refused").toBeGreaterThan(0);
  });

  it("a whole installs exactly when its pid's decoder passes, else keeps the last view and asks once", () => {
    const seen = { installed: 0, refused: 0 };
    fc.assert(
      fc.property(viewWalks, ([kinds, list]) => {
        viewWalk(kinds, list, (prev, notice, next, out) => {
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
    const seen = { installed: 0, removed: 0, gap: 0, bad: 0 };
    fc.assert(
      fc.property(viewWalks, ([kinds, list]) => {
        viewWalk(kinds, list, (prev, notice, next, out, w) => {
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
            seen.removed +=
              Array.isArray(note.patch) && note.patch.some((op: { op?: unknown }) => op.op === "remove") ? 1 : 0;
            expect(shown).toBeDefined();
            expect(note.base).toBe(shown!.rev);
            expect(note.rev).toBe(shown!.rev + 1);
            expect(next.views[notice.pid]).toEqual(w.accepted[notice.pid]);
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
    expect(seen.removed, "array removals installed").toBeGreaterThan(0);
    expect(seen.gap).toBeGreaterThan(0);
    expect(seen.bad).toBeGreaterThan(0);
  });

  it("a notice for one pid is checked by that pid's decoder only, and changes no other pid's view", () => {
    let checked = 0;
    fc.assert(
      fc.property(viewWalks, ([kinds, list]) => {
        viewWalk(kinds, list, (prev, notice, next, _out, w) => {
          checked += w.log.length;
          expect(
            w.log.every((pid) => pid === notice.pid),
            `${notice.pid}'s notice checked by ${w.log.join(",")}`,
          ).toBe(true);

          for (const pid of Object.keys(next.views).filter((p) => p !== notice.pid)) {
            expect(next.views[pid]).toBe(prev.c.views[pid]);
          }
        });
      }),
      opts,
    );
    expect(checked).toBeGreaterThan(0);
  });
});
