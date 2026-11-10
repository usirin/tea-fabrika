// P14, next/ (Tier 1, ticket 286): the window parent's laws p1, p2, p4 and "now", and the parent
// composing the link and the client by hand (docs/plan/ticket-115.md p1 to p5 with Tier 1's
// fixed-layout and grant-wait amendments; the plan's "Shared client data and the window parent").
// Written before `window/machine.ts`; the modules load by `import()` inside each test.
//
// The shape these laws hold the module to, from the plan's sketch (the build may add more):
// - `windowMachineFor(checks)` (A7): the file's one export of a machine, a factory. `checks` is
//   libfabrika's `ClientChecks`, `{decode?: (pid) => (view) => unknown}`, passed through to the
//   client. The machine it returns is a tea machine; its ctx is `{layout}`, a `Layout` (desktop/layout.ts). Its model
//   holds `link` (a `Link`, transport/link.ts) and `client` (an app/client.ts `Client`: `pending`,
//   `written`, `seen`, `views`).
// - Msgs, by `type`: every `linkMachine` Msg, unchanged, steps the link; `press {pid, m}` reserves a
//   numbered slot and asks the Cmd `now {n}`; `view {pid, note}` is a view notification; the settle
//   Msgs tea mints for the Cmd `now {n}`, `now_ok {cmd, value}` and `now_err {cmd, error}`, with
//   `{letter, sentAt}` as its value; and the answers to the three brain calls, below.
// - The three brain calls are Subs, not Cmds (A12; tea's run loop folds nothing while a Cmd is
//   unanswered, ADR 0018): `send` (process.send), `open` (view.open) and `knock` (door.knock). The
//   window asks no Cmd of those types. Each is declared in the machine's `subs` as tea 0.25.0 takes
//   them, `{type, deps(state)}`, and each live Sub is one call, named by its id, `subIdOf(type,
//   deps)`: a `send` Sub's deps are one letter's call, `{pid, letter, n, m, sentAt, seen, dial}` and
//   its `traceId` when it has one; an `open` Sub's are `{pid, dial}`; a `knock` Sub's hold its
//   `dial`. A call starts when its Sub's id goes live, in the order of the `subs` entries, and ends
//   when it goes off. The Sub runner answers each call it started once, with the Msg
//   `<type>_ok {cmd, value}` or `<type>_err {cmd, error}` whose `cmd` is the Sub's deps (`send`'s
//   value is a `Sent` plus the handler's `ms`, `open`'s is `{rev, view}`); a call whose Sub ended is
//   dropped, and its answer never comes. The laws below draw the answers that way.
// - A window that was just granted (`granted` while it waited, on its dial) asks the Cmd `persist {}`
//   once, when it next goes online; `persist_ok` carries a boolean, `persist_err` a failure. A window
//   that was never in a grant wait, and a reconnect, ask it never. Either answer leaves the link as it was.
// - Going online (`admitted` on the current dial) asks `open` once per distinct pid of the layout
//   and `send` for every letter that is ready, in slot order, each once: each a call it starts.
//   Not online starts no `send` and keeps no `send` or `open` live. Leaving online forgets what was
//   opened and sent, so the next dial starts over.
// - `client` moves only by the machine `clientMachineFor(checks)` makes (app/client.ts, plan A5 and
//   A7), with the window's own `checks`, stepped by hand as the link is: `press` steps it with
//   `press {pid, m}`, `now_ok` with `dated {n, ...value}`, `send_ok` with `reply {letter, answer}`,
//   `seen {rev}` with `read {rev}`, `view {pid, note}` with `notice {pid, note}`, and an `open_ok` on
//   the current dial with `notice {pid, note: {type: "whole", ...value}}`; an `open_ok` from an old
//   dial is stale and moves nothing. The client law below compares letters, `written`, `seen` and
//   views.
// - Records (A8), each a `{type: "record", record}` Cmd holding a `ClientRecord` with no field its
//   schema lacks. The window reads no clock: a link outcome Msg (`admitted`, `not_granted`,
//   `closed`, `stalled`) carries `ms`, put there by the handler that dialed, and `send_ok`'s value
//   carries `ms` beside the `Sent` answer's fields. A link outcome keeps one `connect` row; a
//   settled letter one `reply` row; a whole view installed a `view {result: "whole"}` row, an ask
//   a `view {result: "asked"}` row, and a run of patches one `view {result: "patch", patches}` row
//   when it ends.
import { createHash, generateKeyPairSync } from "node:crypto";
import { acceptedTypes, applyCell, subIdOf } from "@demlik/tea";
import { propertyTrace } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { ClientRecord } from "@kampus/libfabrika";
import { Effect, Layer, Queue, Result, Schema, Stream } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const opts = { seed: SEED, numRuns: 250 };

type Pending = {
  readonly _tag: string;
  readonly n: number;
  readonly pid: string;
  readonly letter?: string;
  readonly viewRev: number;
  readonly seen: number;
};

type Model = {
  readonly link: { readonly _tag: string; readonly [key: string]: unknown };
  readonly client: {
    readonly pending: ReadonlyArray<Pending>;
    readonly written: number;
    /** The highest ledger revision the client read: the client's own, not the window's. */
    readonly seen: number;
    readonly views: Readonly<Record<string, { readonly rev: number }>>;
  };
};

type Cmd = { readonly type: string; readonly [key: string]: unknown };
type Msg = { readonly type: string; readonly [key: string]: unknown };
type Tree = unknown;

/** One entry of a machine's `subs`, as tea 0.25.0 reads it. */
type SubEntry = { readonly type: string; readonly deps: (s: Model) => unknown };

interface Machine {
  readonly init: (loaded: unknown, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  readonly model: unknown;
  readonly subs?: ReadonlyArray<SubEntry>;
}

/** What a client checks a view with (A7): each program's own decoder, by pid. */
type Checks = { readonly decode?: (pid: string) => (view: unknown) => unknown };

/** The checks the window laws run with: as round 4 ran them, any JSON view. */
const NO_CHECKS: Checks = {};

/** The checks the client law draws on: none, one that accepts, one that refuses by its schema
 *  (a negative count, which the view Msgs draw), one that throws, and one per pid. */
const CHECKS: ReadonlyArray<readonly [string, Checks]> = [
  ["no decoder", NO_CHECKS],
  ["a decoder that accepts", { decode: () => (view) => view }],
  [
    "a decoder that refuses a negative count",
    {
      decode: () =>
        Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })),
    },
  ],
  [
    "a decoder that throws",
    {
      decode: () => () => {
        throw new Error("not a view");
      },
    },
  ],
  [
    "a decoder for one pid only",
    {
      decode: (pid) =>
        pid === "process_b"
          ? () => {
              throw new Error("not a view");
            }
          : (view) => view,
    },
  ],
];

const machine = async (checks: Checks = NO_CHECKS): Promise<Machine> => {
  const api = (await import("./machine.ts")) as { windowMachineFor?: (checks: Checks) => Machine };
  expect(api.windowMachineFor, "window/machine.ts exports the factory windowMachineFor").toBeTypeOf("function");
  return (api.windowMachineFor as (checks: Checks) => Machine)(checks);
};

const layoutApi = async (): Promise<{
  tilesIn: (t: Tree) => ReadonlyArray<{ id: string; pid: string }>;
}> => (await import("../desktop/layout.ts")) as never;

const A = "process_a";
const B = "process_b";
const C = "process_c";
const tile = (id: string, pid: string) => ({ _tag: "tile", id, pid });
const split = (dir: "row" | "col", a: Tree, b: Tree) => ({ _tag: "split", dir, at: 50, a, b });

/** The fixed layouts the laws run on: one tile, two, a repeated pid, and a 2x2 that repeats two. */
const LAYOUTS: ReadonlyArray<readonly [string, Tree, ReadonlyArray<string>]> = [
  ["one tile", tile("t0", A), [A]],
  ["two tiles", split("row", tile("t0", A), tile("t1", B)), [A, B]],
  ["a repeated pid", split("col", tile("t0", A), split("row", tile("t1", B), tile("t2", A))), [A, B]],
  [
    "a 2x2 grid",
    split("col", split("row", tile("t0", A), tile("t1", B)), split("row", tile("t2", A), tile("t3", C))),
    [A, B, C],
  ],
];

const dial = fc.integer({ min: 1, max: 3 });
const sentAt = "2026-11-09T00:00:00.000Z";
const word = fc.constantFrom("a", "b", "SHA256:x");
/** A handler's measured duration (A8): whole and fractional ms, zero included. */
const measured = fc.oneof(fc.nat(60_000), fc.double({ min: 0, max: 60_000, noNaN: true, noDefaultInfinity: true }));

/** How the cells are drawn: the default for every law, or tuned for the connect and view laws. */
type Tuning = {
  /** Also draw close 4003 (the key was removed) and `ask_again`, which is the only way out of it. */
  readonly removal?: boolean;
  /** Draw view notes that mostly continue the shown revision, so runs of patches form and end. */
  readonly runs?: boolean;
  /** Draw the brain's ping interval on `admitted`, below, at and past the link's beat (the hang law). */
  readonly pings?: boolean;
};

/** The ms a list's handlers measured: drawn on the tuned lists, and a constant 0 on the default
 *  ones, which draws nothing, so the default lists, and the reconnect reach every older law's
 *  good-thing check needs at seed 119120, stay as they were. */
const msFor = (tuning: Tuning): fc.Arbitrary<number> =>
  tuning.removal === true || tuning.runs === true ? measured : fc.constant(0);

/** A view note that continues a small revision (base 0 to 3, mostly ending one past it), a gap, a
 *  whole view that may be refused, or junk: patch runs need a base equal to the shown revision. */
const runNote = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .nat(3)
      .map((base) => ({ type: "patch", base, rev: base + 1, patch: [{ op: "replace", path: "/count", value: base }] })),
  },
  {
    weight: 1,
    arbitrary: fc.nat(3).map((base) => ({ type: "patch", base, rev: base + 2, patch: [] })),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("whole"),
      rev: fc.nat(3),
      view: fc.record({ count: fc.integer({ min: -2, max: 5 }) }),
    }),
  },
  { weight: 1, arbitrary: fc.jsonValue() },
);

/** The Msgs nothing sends a Cmd for, and the answers to the Cmds the window asks. */
// A8: each link outcome Msg (`admitted`, `not_granted`, `closed`, `stalled`) carries `ms`, the
// time the handler that dialed measured, and `send`'s ok value carries `ms` beside the `Sent`
// answer's own fields. The machine reads no clock: it copies these into its records.
const cells = (pids: ReadonlyArray<string>, tuning: Tuning = {}) => {
  const pid = fc.constantFrom(...pids);
  const body = fc.constantFrom({ type: "inc" }, { type: "dec" }, { type: "reset" });
  const ms = msFor(tuning);
  const code = tuning.removal
    ? fc.oneof({ weight: 4, arbitrary: fc.constantFrom(1000, 1006) }, { weight: 1, arbitrary: fc.constant(4003) })
    : fc.constantFrom(1000, 1006);
  const again = tuning.removal
    ? { ask_again: fc.record({ type: fc.constant("ask_again"), dial: fc.integer({ min: 1, max: 4 }) }) }
    : {};
  const outside = {
    admitted: fc.record({
      type: fc.constant("admitted"),
      dial,
      ping: tuning.pings ? fc.constantFrom(0, 1_000, 4_999, 5_000, 30_000, 60_000) : fc.constant(0),
      ms,
    }),
    closed: fc.record({
      type: fc.constant("closed"),
      dial,
      code,
      fingerprint: word,
      ms,
    }),
    retry: fc.record({ type: fc.constant("retry"), dial, tries: fc.constant(1) }),
    not_granted: fc.record({
      type: fc.constant("not_granted"),
      dial,
      fingerprint: word,
      code: word,
      until: fc.nat(1000),
      ms,
    }),
    granted: fc.record({ type: fc.constant("granted"), dial }),
    stalled: fc.record({ type: fc.constant("stalled"), dial, ms }),
    ...again,
    press: fc.record({ type: fc.constant("press"), pid, m: body }),
    view: fc.record({
      type: fc.constant("view"),
      pid,
      note: tuning.runs
        ? runNote
        : fc.oneof(
            fc.record({
              type: fc.constant("whole"),
              rev: fc.nat(6),
              view: fc.record({ count: fc.integer({ min: -5, max: 5 }) }),
            }),
            fc.record({
              type: fc.constant("patch"),
              base: fc.nat(6),
              rev: fc.nat(7),
              patch: fc.constant([{ op: "replace", path: "/count", value: 1 }]),
            }),
            fc.jsonValue(),
          ),
    }),
  };
  const answers = {
    now: {
      draw: fc.record({ ok: fc.boolean(), letter: fc.uuid() }),
      make: (cmd: Cmd, v: { ok: boolean; letter: string }): Msg =>
        v.ok
          ? { type: "now_ok", cmd, value: { letter: `letter_${v.letter}`, sentAt } }
          : { type: "now_err", cmd, error: { _tag: "clock" } },
    },
    // Review 1, D: an answer the client cannot read (`send_err {_tag: "unknown"}`) is drawn too,
    // so a window that settles a letter on it breaks p1.
    send: {
      draw: fc.tuple(fc.constantFrom("accepted", "refused", "unreachable", "unknown"), ms),
      make: (cmd: Cmd, [kind, took]: readonly [string, number]): Msg =>
        kind === "accepted"
          ? { type: "send_ok", cmd, value: { _tag: "accepted", rev: 1, pos: 1, ms: took } }
          : kind === "refused"
            ? { type: "send_ok", cmd, value: { _tag: "refused", reason: "bad_msg", ms: took } }
            : kind === "unknown"
              ? { type: "send_err", cmd, error: { _tag: "unknown" } }
              : { type: "send_err", cmd, error: { _tag: "unreachable" } },
    },
    persist: {
      draw: fc.constantFrom("true", "false", "error"),
      make: (cmd: Cmd, v: string): Msg =>
        v === "error"
          ? { type: "persist_err", cmd, error: { _tag: "unsupported" } }
          : { type: "persist_ok", cmd, value: v === "true" },
    },
    open: {
      draw: fc.record({
        ok: fc.boolean(),
        rev: tuning.runs ? fc.nat(3) : fc.nat(5),
        count: fc.integer({ min: -3, max: 3 }),
      }),
      make: (cmd: Cmd, v: { ok: boolean; rev: number; count: number }): Msg =>
        v.ok
          ? { type: "open_ok", cmd, value: { rev: v.rev, view: { count: v.count } } }
          : { type: "open_err", cmd, error: { _tag: "unreachable" } },
    },
    knock: {
      draw: fc.boolean(),
      make: (cmd: Cmd, ok: boolean): Msg =>
        ok ? { type: "knock_ok", cmd, value: null } : { type: "knock_err", cmd, error: { _tag: "closed" } },
    },
  };
  return { outside, answers };
};

/** The window's brain calls (A12): each is a Sub of one of these types, never a Cmd. */
const CALLS: ReadonlySet<string> = new Set(["send", "open", "knock"]);

/** A brain call in flight: a live Sub of a call type, by its tea id, with its deps. */
type Call = { readonly type: string; readonly id: string; readonly deps: Readonly<Record<string, unknown>> };

/** The calls live in `s`: the machine's call Subs whose deps are on, in the order of its `subs`
 *  entries, which is the order tea starts them in. Two entries with one id are one Sub. */
const callsIn = (m: Machine, s: Model): ReadonlyArray<Call> => {
  const live = new Map<string, Call>();

  for (const entry of m.subs ?? []) {
    if (!CALLS.has(entry.type)) {
      continue;
    }

    const deps = entry.deps(s);

    if (deps !== null && deps !== undefined) {
      const id = String(subIdOf(entry.type, deps));
      live.set(id, { type: entry.type, id, deps: deps as Record<string, unknown> });
    }
  }

  return [...live.values()];
};

/** The calls a step starts: live after it, not before it. Each reads as a Cmd would, `{type,
 *  ...deps}`, so a law counts and orders them as it did the Cmds. */
const startedIn = (m: Machine, prev: Model, next: Model): ReadonlyArray<Cmd> => {
  const was = new Set(callsIn(m, prev).map((c) => c.id));
  return callsIn(m, next)
    .filter((c) => !was.has(c.id))
    .map((c) => ({ ...c.deps, type: c.type }));
};

/** A guided list, as tea's `arbGuidedSequence` draws one (an outside Msg at weight 1, an answer at
 *  weight 2, the answer picked among those waiting, and an outside Msg in its place when none
 *  waits, so a list keeps its length), with one change: a brain call is answered as its Sub runner
 *  answers it. Each call a Sub starts waits for one answer, `make(deps, value)`;
 *  a call whose Sub ended before its answer was drawn is dropped and never answered; a Sub that
 *  stays live after its answer is not answered again. Other Cmds (`now`, `persist`) wait as tea's
 *  do. A brain call asked as a Cmd waits for nothing: no runner answers it. */
const guided = (
  m: Machine,
  layout: Tree,
  cellsFor: ReturnType<typeof cells>,
  opts: { readonly maxLength: number; readonly loaded?: Model },
): fc.Arbitrary<ReadonlyArray<Msg>> => {
  const outside = Object.values(cellsFor.outside) as ReadonlyArray<fc.Arbitrary<Msg>>;
  const answers = Object.entries(cellsFor.answers) as ReadonlyArray<
    readonly [string, { readonly draw: fc.Arbitrary<unknown>; readonly make: (cmd: Cmd, v: never) => Msg }]
  >;
  const at = new Map(answers.map(([type], n) => [type, n]));
  type Waiting = { readonly type: string; readonly cmd: Cmd; readonly sub: string | null };
  const events = fc.array(
    fc.oneof(
      { weight: 1, arbitrary: fc.oneof(...outside).map((msg) => ({ outside: msg }) as const) },
      {
        weight: 2,
        arbitrary: fc
          .tuple(fc.nat(1_000), fc.tuple(...answers.map(([, a]) => a.draw)), fc.oneof(...outside))
          .map(([pick, values, otherwise]) => ({ pick, values, otherwise }) as const),
      },
    ),
    { maxLength: opts.maxLength, size: "max" },
  );
  return events.map((drawn) => {
    const ctx = { layout };
    const msgs: Array<Msg> = [];
    let [state, cmds] = m.init(opts.loaded ?? null, ctx);
    let waiting: Array<Waiting> = [];
    let live = new Map<string, Call>();
    /** The calls and Cmds a step leaves waiting for an answer. */
    const settle = (next: Model, asked: ReadonlyArray<Cmd>): void => {
      const now = new Map(callsIn(m, next).map((c) => [c.id, c]));
      waiting = waiting.filter((w) => w.sub === null || now.has(w.sub));

      for (const [id, c] of now) {
        if (!live.has(id) && at.has(c.type)) {
          waiting.push({ type: c.type, cmd: c.deps as Cmd, sub: id });
        }
      }

      for (const c of asked) {
        if (!CALLS.has(c.type) && at.has(c.type)) {
          waiting.push({ type: c.type, cmd: c, sub: null });
        }
      }

      live = now;
    };
    settle(state, cmds);

    for (const event of drawn) {
      let msg: Msg;

      if ("outside" in event) {
        msg = event.outside;
      } else if (waiting.length === 0) {
        msg = event.otherwise;
      } else {
        const w = waiting[event.pick % waiting.length] as Waiting;
        const n = at.get(w.type) as number;
        msg = (answers[n] as (typeof answers)[number])[1].make(w.cmd, event.values[n] as never);
        waiting = waiting.filter((x) => x !== w);
      }

      if (!acceptedTypes(m as never, state as never).includes(msg.type)) {
        continue;
      }

      msgs.push(msg);

      try {
        const out: readonly [Model, ReadonlyArray<Cmd>] = applyCell(m as never, state as never, msg as never) as never;
        [state, cmds] = out;
      } catch {
        return msgs;
      }

      settle(state, cmds);
    }

    return msgs;
  });
};

const lists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>, loaded?: Model) =>
  guided(m, layout, cells(pids), { maxLength: 70, ...(loaded === undefined ? {} : { loaded }) });

/** Lists for the hang law: the brain's ping interval drawn on each admission. */
const pingLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) =>
  guided(m, layout, cells(pids, { pings: true }), { maxLength: 70 });

/** Lists for the connect law: every outcome, a removed key and Ask again included. */
const linkLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) =>
  guided(m, layout, cells(pids, { removal: true }), { maxLength: 70 });

/** Lists for the view laws: longer, with notes that continue the shown revision, so patch runs
 *  of one, two and more form and end by a whole view, an ask and the link leaving online. */
const viewLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) =>
  guided(m, layout, cells(pids, { runs: true }), { maxLength: 120 });

/** A new grant, as the browser meets it on its first dial: told `not_granted`, granted while it
 *  waits, then admitted. */
const GRANT: ReadonlyArray<Msg> = [
  { type: "not_granted", dial: 1, fingerprint: "SHA256:x", code: "a", until: 1000 },
  { type: "granted", dial: 1 },
  { type: "admitted", dial: 1, ping: 0 },
];

/** The window's state at the end of `list` and the Cmds its last step asked, folded by the real runner. */
const after = (m: Machine, layout: Tree, list: ReadonlyArray<Msg>): { state: Model; cmds: ReadonlyArray<Cmd> } => {
  let out: { state: Model; cmds: ReadonlyArray<Cmd> } | undefined;
  propertyTrace(
    m as never,
    { layout } as never,
    fc.constant(list) as never,
    ((steps: ReadonlyArray<Folded>, final: Model) => {
      out = { state: final, cmds: steps.at(-1)?.cmds ?? [] };
      return null;
    }) as never,
    { numRuns: 1 },
  );

  if (out === undefined) {
    throw new Error("the fold of a fixed list never ran");
  }

  return out;
};

/** Lists where every run reaches a new grant going online, then the persistence answer, then a
 *  guided tail drawn from the state the real fold reached. Blind lists reach a new grant going
 *  online about once in 250 runs (build round 1), so a plant on the answer went uncaught. When the
 *  window asks no persistence, no answer follows and the persist law names that. */
const grantedLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) => {
  const opened = after(m, layout, GRANT);
  const asked = opened.cmds.find((c) => c.type === "persist");
  const persist = cells(pids).answers.persist;
  const variants = (["true", "false", "error"] as const).map((v) => {
    const list = asked === undefined ? GRANT : [...GRANT, persist.make(asked, v)];
    return { list, state: after(m, layout, list).state };
  });

  return fc
    .constantFrom(...variants)
    .chain(({ list, state }) =>
      lists(m, layout, pids, state).map((tail) => [...list, ...(tail as ReadonlyArray<Msg>)]),
    );
};

type Step = {
  readonly prev: Model;
  readonly msg: Msg;
  readonly next: Model;
  readonly cmds: ReadonlyArray<Cmd>;
  /** The brain calls the step started (A12), each read as `{type, ...deps}`. */
  readonly calls: ReadonlyArray<Cmd>;
  /** The brain calls live after the step. */
  readonly live: ReadonlyArray<Call>;
};

/** What the real runner hands a law: a step before its calls are read. */
type Folded = Omit<Step, "calls" | "live">;

/** A run's steps as the real runner folded them, each with the calls it started and left live. */
const traced = (m: Machine, steps: ReadonlyArray<Folded>): ReadonlyArray<Step> =>
  steps.map((s) => ({ ...s, calls: startedIn(m, s.prev, s.next), live: callsIn(m, s.next) }));

/** A brain call the step asked as a Cmd, which A12 moves to a Sub: tea's loop would fold nothing
 *  until it settled. */
const askedCall = ({ msg, cmds }: Step): string | null => {
  const c = cmds.find((x) => CALLS.has(x.type));
  return c === undefined ? null : `${msg.type} asked a ${c.type} Cmd; a brain call is a Sub (A12)`;
};

type Law = (steps: ReadonlyArray<Step>, tiles: ReadonlyArray<string>) => string | null;
const online = (m: Model): boolean => m.link._tag === "online";

const kinds = (cmds: ReadonlyArray<Cmd>, type: string): ReadonlyArray<Cmd> => cmds.filter((c) => c.type === type);

const PERSIST = "persist: asked once per new grant, never on a reconnect, and an answer leaves the window online";

// P14's "What P14 records" and "Browser identity": the persistence attempt's boolean result or
// failure, and a press's send attempts and settlement, are checked client observations the tab
// keeps until `client.record` acknowledges them. The window asks for each with its `record` Cmd,
// `{type: "record", record}`, a `ClientRecord` (app/window.ts), as it does for a press today.
const PERSIST_RECORD = "persist record: each persistence answer is kept once, as granted, refused or failed";

// Round 9 (A8): the reply law also checks `ms`, the duration the send's own answer carries.
const REPLY_RECORD =
  "reply record: each answer that settles a letter is kept once, with its result, every time the letter was sent, and the ms its answer carries";

// A8: one `connect` row per link outcome, with its dial and the `ms` the handler that dialed put
// in the outcome's Msg. The window reads no clock, so the row's ms is that Msg's.
const CONNECT_RECORD =
  "connect record: each link outcome (online, waiting, closed, stalled, removed) is kept once, with its dial and the ms its Msg carries";

/** The laws whose lists must each reach a new grant going online, so a persistence answer is met. */
const GRANTED_LAWS: ReadonlySet<string> = new Set([PERSIST, PERSIST_RECORD]);

/** The laws that also run on lists where a key is removed and asked again, whose handlers' ms
 *  are drawn. */
const LINK_LAWS: ReadonlySet<string> = new Set([CONNECT_RECORD, REPLY_RECORD]);

/** A record is a real `ClientRecord`, with no field the schema does not name: a field the schema
 *  lacks, such as `patches` on a view row before the build adds it (A8), is not kept. */
const isClientRecord = (r: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(ClientRecord)(r, { onExcessProperty: "error" }));

/** The records a step asks the tab to keep, each checked as a real `ClientRecord`. */
const recordsIn = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<ClientRecord> | string => {
  const asked = kinds(cmds, "record").map((c) => c["record"]);
  const bad = asked.find((r) => !isClientRecord(r));
  return bad === undefined
    ? (asked as ReadonlyArray<ClientRecord>)
    : `a record that is not a ClientRecord: ${JSON.stringify(bad)}`;
};

const isPersistRecord = (r: ClientRecord): boolean =>
  r._tag === "persist" || (r._tag === "failure" && r.op === "persist");

type Outcome = "online" | "waiting" | "closed" | "stalled" | "removed";

/** The link outcome a step is, read off the link before and after and the Msg, or null. A told
 *  code while already waiting, a stale Msg and a move into `dialing` are no outcome. */
const linkOutcome = (prev: Model, msg: Msg, next: Model): Outcome | null => {
  const was = prev.link._tag;
  const is = next.link._tag;

  if (was !== "online" && is === "online") {
    return "online";
  }

  if (was !== "waiting_grant" && is === "waiting_grant") {
    return "waiting";
  }

  if (was !== "removed" && is === "removed") {
    return "removed";
  }

  if (was !== "retrying" && is === "retrying") {
    return msg.type === "closed" ? "closed" : msg.type === "stalled" ? "stalled" : null;
  }

  return null;
};

/** The laws, each a check over a run's steps, so a plant can run the same one. */
const laws: Readonly<Record<string, Law>> = {
  // p1: a letter leaves only on its matching terminal answer; written grows per press; ids never repeat.
  "p1: a letter is never lost, written counts presses, ids never repeat": (steps) => {
    const model = new Map<number, string | null>(); // slot -> its first letter
    let presses = 0;

    for (const { prev, msg, next } of steps) {
      if (msg.type === "press") {
        model.set(next.client.written - 1, null);
        presses++;
      } else if (msg.type === "now_ok") {
        const n = (msg["cmd"] as { n: number }).n;

        if (model.has(n) && model.get(n) === null) {
          model.set(n, (msg["value"] as { letter: string }).letter);
        }
      } else if (msg.type === "send_ok") {
        const letter = (msg["cmd"] as { letter: string }).letter;
        const value = msg["value"] as { _tag: string };

        if (value._tag === "accepted" || value._tag === "refused") {
          for (const [n, l] of model) {
            if (l === letter) {
              model.delete(n);
            }
          }
        }
      }

      const slots = next.client.pending.map((p) => p.n).sort((x, y) => x - y);

      if (JSON.stringify(slots) !== JSON.stringify([...model.keys()].sort((x, y) => x - y))) {
        return `slots ${JSON.stringify(slots)} are not the model's ${JSON.stringify([...model.keys()])}`;
      }

      for (const p of next.client.pending) {
        if (model.get(p.n) !== (p.letter ?? null)) {
          return `slot ${p.n} holds ${String(p.letter)}, its first letter was ${String(model.get(p.n))}`;
        }
      }

      if (next.client.written !== presses) {
        return `written ${next.client.written} after ${presses} presses`;
      }

      void prev;
    }

    return null;
  },
  // p2: coming online sends every ready letter once, in order; not online sends nothing; no letter twice on one dial.
  "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing": (steps) => {
    let sentThisDial = new Set<string>();

    for (const step of steps) {
      const { prev, msg, next, calls } = step;
      const sends = kinds(calls, "send");
      const asked = askedCall(step);

      if (asked !== null) {
        return asked;
      }

      if (!online(next)) {
        if (sends.length > 0) {
          return `${msg.type} sent ${sends.length} letter(s) while ${next.link._tag}`;
        }

        if (step.live.some((c) => c.type === "send")) {
          return `a send is still live after ${msg.type} took the link to ${next.link._tag}`;
        }

        sentThisDial = new Set();
        continue;
      }

      if (!online(prev)) {
        sentThisDial = new Set();
      }

      const letters = sends.map((s) => String(s["letter"]));

      if (new Set(letters).size !== letters.length) {
        return `${msg.type} sent a letter twice in one step`;
      }

      for (const l of letters) {
        if (sentThisDial.has(l) && !(msg.type === "send_err")) {
          return `${l} went out twice on one dial`;
        }

        sentThisDial.add(l);
      }

      const slotFor = (l: string) => next.client.pending.find((p) => p.letter === l)?.n ?? Number.NaN;
      const order = letters.map(slotFor);

      if (JSON.stringify(order) !== JSON.stringify([...order].sort((x, y) => x - y))) {
        return `letters went out out of order: ${JSON.stringify(order)}`;
      }

      if (!online(prev)) {
        // Going online: every ready letter ahead of the first slot still waiting for its time goes out.
        const firstDating = next.client.pending.find((p) => p._tag === "dating")?.n ?? Number.POSITIVE_INFINITY;
        const ready = next.client.pending.filter((p) => p._tag === "ready" && p.n < firstDating).map((p) => p.letter);

        if (JSON.stringify(letters) !== JSON.stringify(ready)) {
          return `going online sent ${JSON.stringify(letters)}, the ready letters were ${JSON.stringify(ready)}`;
        }
      }

      if (msg.type === "send_err") {
        sentThisDial.delete(String((msg["cmd"] as { letter: string }).letter));
      }
    }

    return null;
  },
  // p4: every distinct pid in the layout is opened once per dial; a new dial opens again.
  // A12: an open is a call its Sub starts, on the dial that is online; none outlives it. Going
  // online starts one per distinct pid, and the dial opens again only for a view the client could
  // not use.
  "p4: every distinct pid of the layout opens once per dial, and a new dial opens again": (steps, tiles) => {
    const distinct = [...new Set(tiles)].sort();

    for (const step of steps) {
      const { prev, msg, next, calls } = step;
      const opens = kinds(calls, "open");
      const asked = askedCall(step);

      if (asked !== null) {
        return asked;
      }

      for (const o of opens) {
        if (!online(next) || o["dial"] !== next.link["dial"]) {
          return `${msg.type} opened ${String(o["pid"])} on dial ${String(o["dial"])} while ${next.link._tag} on ${String(next.link["dial"])}`;
        }
      }

      if (online(next) && !online(prev)) {
        const pids = opens.map((o) => String(o["pid"])).sort();

        if (JSON.stringify(pids) !== JSON.stringify(distinct)) {
          return `going online opened ${JSON.stringify(pids)}, not each of ${JSON.stringify(distinct)} once`;
        }
      }

      if (!online(next) && step.live.some((c) => c.type === "open")) {
        return `an open is still live after ${msg.type} took the link to ${next.link._tag}`;
      }

      if (msg.type === "press" && opens.length > 0) {
        return "a press opened a view";
      }

      if (online(prev) && online(next) && msg.type !== "view" && opens.length > 0) {
        return `${msg.type} opened again on the same dial`;
      }
    }

    return null;
  },
  // Persistence is asked once after a new grant, never on a reconnect, and its answer never moves the link.
  [PERSIST]: (steps) => {
    let fresh = false;

    for (const { prev, msg, next, cmds } of steps) {
      if (msg.type === "granted" && prev.link._tag === "waiting_grant" && prev.link["dial"] === msg["dial"]) {
        fresh = true;
      }

      const asked = kinds(cmds, "persist").length;

      if (asked > 1) {
        return "persistence asked twice in one step";
      }

      if (asked === 1 && !(fresh && online(next) && !online(prev))) {
        return `persistence asked on ${msg.type} with no new grant just admitted`;
      }

      if (asked === 0 && fresh && online(next) && !online(prev)) {
        return "a new grant went online and never asked for persistence";
      }

      if (asked === 1) {
        fresh = false;
      }

      if (
        (msg.type === "persist_ok" || msg.type === "persist_err") &&
        JSON.stringify(next.link) !== JSON.stringify(prev.link)
      ) {
        return `${msg.type} moved the link`;
      }

      if (
        (msg.type === "persist_ok" || msg.type === "persist_err") &&
        next.client.pending.length !== prev.client.pending.length
      ) {
        return `${msg.type} changed the queue`;
      }
    }

    return null;
  },
  // The persistence answer is recorded: `persist_ok` true as granted, false as refused, and
  // `persist_err` as failed (a `persist {failed}` or a `failure {op: "persist"}` row), exactly once
  // in the step that answers, and no step that is not a persistence answer keeps one.
  [PERSIST_RECORD]: (steps) => {
    for (const { msg, cmds } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const kept = records.filter(isPersistRecord);
      const answer = msg.type === "persist_ok" ? (msg["value"] === true ? "granted" : "refused") : null;

      if (msg.type !== "persist_ok" && msg.type !== "persist_err") {
        if (kept.length > 0) {
          return `${msg.type} kept a persistence record: ${JSON.stringify(kept)}`;
        }

        continue;
      }

      if (kept.length !== 1) {
        return `${msg.type} kept ${kept.length} persistence records, not one`;
      }

      const [r] = kept as [ClientRecord];
      const right =
        answer === null
          ? (r._tag === "persist" && r.result === "failed") || r._tag === "failure"
          : r._tag === "persist" && r.result === answer;

      if (!right) {
        return `${msg.type} ${JSON.stringify(msg["value"] ?? msg["error"])} was kept as ${JSON.stringify(r)}`;
      }
    }

    return null;
  },
  // A letter's settlement is recorded with the answer's result and every `send` of that letter
  // started so far, across dials: once, in the step whose answer settles it. No other step keeps an
  // accepted or refused reply, so a duplicate or stale answer adds no second sample, and every
  // reply row names the letter its step answered.
  [REPLY_RECORD]: (steps) => {
    const sends = new Map<string, number>();

    for (const { prev, msg, next, cmds, calls } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const replies = records.filter((r): r is Extract<ClientRecord, { _tag: "reply" }> => r._tag === "reply");
      const letter = (msg["cmd"] as { letter?: string } | undefined)?.letter;
      const tag = msg.type === "send_ok" ? (msg["value"] as { _tag: string })._tag : null;
      const settled =
        letter !== undefined &&
        (tag === "accepted" || tag === "refused") &&
        prev.client.pending.some((p) => p.letter === letter) &&
        !next.client.pending.some((p) => p.letter === letter);

      for (const r of replies) {
        if (r.letter !== letter) {
          return `${msg.type} kept a reply for ${r.letter}, which it did not answer`;
        }

        if ((r.result === "accepted" || r.result === "refused") && !settled) {
          return `${msg.type} kept a ${r.result} reply for ${r.letter}, which it did not settle`;
        }
      }

      if (settled) {
        const kept = replies.filter((r) => r.result === "accepted" || r.result === "refused");

        if (kept.length !== 1) {
          return `the ${tag} answer settling ${letter} kept ${kept.length} reply records, not one`;
        }

        const [r] = kept as [Extract<ClientRecord, { _tag: "reply" }>];

        if (r.result !== tag) {
          return `the ${tag} answer settling ${letter} was kept as ${r.result}`;
        }

        if (r.attempts !== (sends.get(letter) ?? 0)) {
          return `${letter} was sent ${sends.get(letter) ?? 0} times, its reply says ${r.attempts}`;
        }
      }

      // The ms of a reply kept on a send's answer is the one that answer carries (A8).
      if (msg.type === "send_ok") {
        const took = (msg["value"] as { ms?: number }).ms;

        for (const r of replies) {
          if (r.ms !== took) {
            return `the answer for ${String(letter)} carried ms ${String(took)}, its reply says ${r.ms}`;
          }
        }
      }

      for (const s of kinds(calls, "send")) {
        const l = String(s["letter"]);
        sends.set(l, (sends.get(l) ?? 0) + 1);
      }
    }

    return null;
  },
  // Each link outcome keeps exactly one connect row in its own step, naming the outcome, the dial the
  // Msg was about and the Msg's ms; a step that is no outcome keeps none.
  [CONNECT_RECORD]: (steps) => {
    for (const { prev, msg, next, cmds } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const rows = records.filter((r): r is Extract<ClientRecord, { _tag: "connect" }> => r._tag === "connect");
      const outcome = linkOutcome(prev, msg, next);

      if (outcome === null) {
        if (rows.length > 0) {
          return `${msg.type} moved the link ${prev.link._tag} to ${next.link._tag}, no outcome, and kept ${JSON.stringify(rows)}`;
        }

        continue;
      }

      if (rows.length !== 1) {
        return `the ${outcome} outcome of ${msg.type} kept ${rows.length} connect rows, not one`;
      }

      const [r] = rows as [Extract<ClientRecord, { _tag: "connect" }>];

      if (r.result !== outcome || r.dial !== msg["dial"] || r.ms !== msg["ms"]) {
        return `the ${outcome} outcome of ${JSON.stringify(msg)} was kept as ${JSON.stringify(r)}`;
      }
    }

    return null;
  },
  // now: a press keeps what was shown when it was pressed; answers in any order send in slot order.
  "now: a press captures what it showed, and reversed or failed answers still send in slot order": (steps) => {
    const shown = new Map<number, { viewRev: number }>();

    for (const { prev, msg, next, cmds, calls } of steps) {
      if (msg.type === "press") {
        const pid = String(msg["pid"]);
        const slot = next.client.written - 1;
        shown.set(slot, { viewRev: prev.client.views[pid]?.rev ?? 0 });

        if (kinds(cmds, "now").length !== 1) {
          return "a press asks for its time once";
        }
      }

      for (const p of next.client.pending) {
        const was = shown.get(p.n);

        if (was !== undefined && p.viewRev !== was.viewRev) {
          return `slot ${p.n} re-read the shown revision: ${p.viewRev}, it was pressed at ${was.viewRev}`;
        }
      }

      const slots = kinds(calls, "send").map((s) => next.client.pending.find((p) => p.letter === s["letter"])?.n ?? -1);
      const firstDating = next.client.pending.find((p) => p._tag === "dating")?.n ?? Number.POSITIVE_INFINITY;

      for (const n of slots) {
        if (n > firstDating) {
          return `slot ${n} went out before slot ${firstDating} had its letter`;
        }
      }

      if (msg.type === "now_err" && next.client.written !== prev.client.written) {
        return "a failed now made a second press";
      }

      if (msg.type === "now_err" && !next.client.pending.some((p) => p.n === (msg["cmd"] as { n: number }).n)) {
        return "a failed now lost the press";
      }
    }

    return null;
  },
};

type ClientMachine = {
  readonly init: (loaded: unknown, ctx: object) => readonly [Model["client"], ReadonlyArray<Cmd>];
};

/** The library's client machine, made by its factory with `checks`: the same checks the window
 *  under test was made with. */
const clientMachineFor = async (checks: Checks): Promise<ClientMachine> => {
  const lib = (await import("@kampus/libfabrika")) as {
    readonly ProgramClient?: { readonly clientMachineFor?: (checks: Checks) => ClientMachine };
  };
  const make = lib.ProgramClient?.clientMachineFor;
  expect(make, "the library's ProgramClient exports the factory clientMachineFor").toBeTypeOf("function");
  return (make as (checks: Checks) => ClientMachine)(checks);
};

/** The window's lists with its `seen` Msg drawn too, for the client law only: the other laws keep
 *  their lists, whose good-thing reach a wider draw thins. */
const readLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) => {
  const { outside, answers } = cells(pids);
  return guided(
    m,
    layout,
    { outside: { ...outside, seen: fc.record({ type: fc.constant("seen"), rev: fc.nat(20) }) }, answers } as never,
    { maxLength: 70 },
  );
};

/** The client's Msg for one window Msg, or null when the window does not move its client. `prev` is
 *  the window before the Msg: an `open_ok` counts only on the dial that is online now. */
const clientMsg = (prev: Model, msg: Msg): Msg | null => {
  const cmd = msg["cmd"] as
    | { readonly n?: number; readonly letter?: string; readonly pid?: string; readonly dial?: number }
    | undefined;

  if (msg.type === "open_ok") {
    const current = online(prev) && prev.link["dial"] === cmd?.dial;
    return current ? { type: "notice", pid: cmd?.pid, note: { type: "whole", ...(msg["value"] as object) } } : null;
  }

  return msg.type === "press"
    ? { type: "press", pid: msg["pid"], m: msg["m"] }
    : msg.type === "now_ok"
      ? { type: "dated", n: cmd?.n, ...(msg["value"] as object) }
      : msg.type === "send_ok"
        ? { type: "reply", letter: cmd?.letter, answer: msg["value"] }
        : msg.type === "seen"
          ? { type: "read", rev: msg["rev"] }
          : msg.type === "view"
            ? { type: "notice", pid: msg["pid"], note: msg["note"] }
            : null;
};

/** What of the client these laws compare: its letters, presses, reads and views. */
const held = (c: Model["client"]): string =>
  JSON.stringify({
    written: c.written,
    seen: c.seen,
    pending: c.pending,
    views: c.views,
  });

/** The window's client is the client machine's own fold of what the window was told. */
const clientFold =
  (cm: ClientMachine) =>
  (steps: ReadonlyArray<Folded>): string | null => {
    let client = cm.init(null, {})[0];

    for (const { prev, msg, next } of steps) {
      const own = clientMsg(prev, msg);

      if (own !== null) {
        client = applyCell(cm as never, client as never, own as never)[0] as never;
      }

      if (held(next.client) !== held(client)) {
        return `${msg.type}: the window's client is ${held(next.client)}, the client machine's is ${held(client)}`;
      }
    }

    return null;
  };

// A8: a view's start and end are kept. A whole view installed keeps a `whole` row, each ask for a
// whole view an `asked` row, and a run of installed patches one `patch` row when it ends, never
// one per patch. What was installed or asked is read off the real client machine, stepped from the
// window's client before the step (the client law above holds the two equal), never the window's
// own records.
const VIEW_RECORD =
  "view record: each whole view installed is kept once as whole at its rev, and each ask for a whole view once as asked";

const PATCH_RECORD =
  "patch record: a run of installed patches keeps one patch row when it ends, before its pid's next whole or asked row and when the link leaves online, with its last rev and an independent count; an empty run keeps none";

/** A view row, with the `patches` count A8 adds to the schema (the build adds it; the record check
 *  refuses it until then). */
type ViewRow = Extract<ClientRecord, { _tag: "view" }> & { readonly patches?: number };

/** What one step of the window did to its client's views, by the client machine: the pid a
 *  whole view was installed for and its rev, the pid a patch was installed for and its rev, and
 *  each pid the client asked a whole view of. */
type Viewed = {
  readonly whole: { readonly pid: string; readonly rev: number } | null;
  readonly patch: { readonly pid: string; readonly rev: number } | null;
  readonly asked: ReadonlyArray<string>;
};

const viewed =
  (cm: ClientMachine) =>
  (prev: Model, msg: Msg): Viewed => {
    const own = clientMsg(prev, msg);

    if (own === null || own.type !== "notice") {
      return { whole: null, patch: null, asked: [] };
    }

    const pid = String(own["pid"]);
    const note = own["note"] as { readonly type?: unknown; readonly rev?: unknown } | null;
    const [client, cmds]: readonly [Model["client"], ReadonlyArray<Cmd>] = applyCell(
      cm as never,
      prev.client as never,
      own as never,
    ) as never;
    const asked = kinds(cmds, "ask").map((c) => String(c["pid"]));
    const was = prev.client.views[pid];
    const now = client.views[pid];
    const isNote = typeof note === "object" && note !== null && !Array.isArray(note);
    // The client's rule: a whole that decodes replaces the shown one, else it asks. So a whole
    // note with an integer rev and a view, and no ask, was installed.
    const whole =
      isNote &&
      note.type === "whole" &&
      Number.isInteger(note.rev) &&
      "view" in note &&
      asked.length === 0 &&
      now?.rev === note.rev;
    // A patch installs only one past the shown revision.
    const patch = isNote && note.type === "patch" && was !== undefined && now?.rev === was.rev + 1;
    return {
      whole: whole ? { pid, rev: Number(note.rev) } : null,
      patch: patch ? { pid, rev: now.rev } : null,
      asked,
    };
  };

const viewRows = (records: ReadonlyArray<ClientRecord>): ReadonlyArray<ViewRow> =>
  records.filter((r): r is ViewRow => r._tag === "view");

type ViewLaw = (cm: ClientMachine) => (steps: ReadonlyArray<Folded>) => string | null;

const viewLaws: Readonly<Record<string, ViewLaw>> = {
  // The whole and asked rows of a step are exactly what the client installed and asked, with the
  // whole row at the installed rev; neither carries a patch count.
  [VIEW_RECORD]: (cm) => (steps) => {
    const seen = viewed(cm);

    for (const { prev, msg, cmds } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const v = seen(prev, msg);
      const rows = viewRows(records).filter((r) => r.result !== "patch");
      const want = [
        ...(v.whole === null ? [] : [`whole ${v.whole.pid} ${v.whole.rev}`]),
        ...v.asked.map((pid) => `asked ${pid} ${Math.max(0, prev.client.views[pid]?.rev ?? 0)}`),
      ].sort();
      const got = rows
        .map((r) => (r.result === "whole" ? `whole ${r.pid} ${r.rev}` : `asked ${r.pid} ${r.rev}`))
        .sort();

      if (JSON.stringify(got) !== JSON.stringify(want)) {
        return `${msg.type} ${JSON.stringify(msg["note"] ?? msg["value"] ?? null)} kept ${JSON.stringify(got)}, the client did ${JSON.stringify(want)}`;
      }

      const counted = rows.find((r) => "patches" in r);

      if (counted !== undefined) {
        return `a ${counted.result} row carries a patch count: ${JSON.stringify(counted)}`;
      }
    }

    return null;
  },
  // An independent count of each pid's installed patches since its last whole or asked row, and
  // since the link last left online. A run ends, and keeps one row with that count and the last
  // installed rev, in the step that keeps that pid's next whole or asked row (ahead of it), or in the
  // step the link leaves online (every pid with a run). No other step keeps a patch row.
  [PATCH_RECORD]: (cm) => (steps) => {
    const seen = viewed(cm);
    const runs = new Map<string, { n: number; rev: number }>();

    for (const { prev, msg, next, cmds } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const v = seen(prev, msg);
      const rows = viewRows(records);
      const ending =
        online(prev) && !online(next) ? [...runs.keys()] : [...v.asked, ...(v.whole === null ? [] : [v.whole.pid])];
      const ended = [...new Set(ending)].filter((pid) => runs.has(pid)).sort();
      const patched = rows.filter((r) => r.result === "patch");

      if (JSON.stringify(patched.map((r) => r.pid).sort()) !== JSON.stringify(ended)) {
        return `${msg.type} (link ${prev.link._tag} to ${next.link._tag}) kept patch rows for ${JSON.stringify(patched.map((r) => r.pid))}, the runs that ended were ${JSON.stringify(ended)} of ${JSON.stringify([...runs])}`;
      }

      for (const r of patched) {
        const run = runs.get(r.pid) as { n: number; rev: number };

        if (r.patches !== run.n || r.rev !== run.rev) {
          return `the run of ${r.pid} installed ${run.n} patches ending at rev ${run.rev}, its row says ${JSON.stringify(r)}`;
        }

        const at = rows.indexOf(r);
        const start = rows.findIndex((x) => x.pid === r.pid && x.result !== "patch");

        if (start !== -1 && start < at) {
          return `the run of ${r.pid} was kept after its next ${rows[start]?.result} row`;
        }

        runs.delete(r.pid);
      }

      if (v.patch !== null) {
        const run = runs.get(v.patch.pid);
        runs.set(v.patch.pid, { n: (run?.n ?? 0) + 1, rev: v.patch.rev });
      }
    }

    return null;
  },
};

const fold = async (
  m: Machine,
  layout: Tree,
  tiles: ReadonlyArray<string>,
  name: string,
  over?: (m: Machine) => Machine,
): Promise<void> => {
  const used = over === undefined ? m : over(m);
  const law = ((steps: ReadonlyArray<Folded>) => laws[name]?.(traced(used, steps), tiles) ?? null) as never;
  propertyTrace(used as never, { layout } as never, lists(m, layout, tiles) as never, law, opts);

  // The persist laws also run on lists that each reach a new grant, so its answer is always met.
  if (GRANTED_LAWS.has(name)) {
    propertyTrace(used as never, { layout } as never, grantedLists(m, layout, tiles) as never, law, opts);
  }

  // The connect and reply laws also run on lists where a key is removed and asked again, with
  // drawn ms.
  if (LINK_LAWS.has(name)) {
    propertyTrace(used as never, { layout } as never, linkLists(m, layout, tiles) as never, law, opts);
  }
};

describe("window machine: p1, p2, p4 and now, on every fixed layout", () => {
  for (const name of Object.keys(laws)) {
    for (const [label, layout, tiles] of LAYOUTS) {
      it(`${name} (${label})`, async () => fold(await machine(), layout, tiles, name));
    }
  }

  it("the layout's tiles are what opens: tilesIn names the pids this law expects", async () => {
    const { tilesIn } = await layoutApi();

    for (const [, layout, tiles] of LAYOUTS) {
      expect([...new Set(tilesIn(layout).map((t) => t.pid))].sort()).toEqual([...tiles].sort());
    }
  });

  it("good thing: the runs press, date, go online, send, settle, reconnect and open again, and persist", async () => {
    const m = await machine();
    const seen = {
      pressed: 0,
      dated: 0,
      online: 0,
      sent: 0,
      settled: 0,
      reopened: 0,
      failedNow: 0,
      persisted: 0,
    };

    for (const [, layout, tiles] of LAYOUTS) {
      propertyTrace(
        m as never,
        { layout } as never,
        lists(m, layout, tiles) as never,
        ((folded: ReadonlyArray<Folded>) => {
          let dials = 0;

          for (const { prev, msg, next, cmds, calls } of traced(m, folded)) {
            if (msg.type === "press") {
              seen.pressed++;
            }

            if (msg.type === "now_ok") {
              seen.dated++;
            }

            if (msg.type === "now_err") {
              seen.failedNow++;
            }

            if (online(next) && !online(prev)) {
              seen.online++;
              dials++;

              if (dials > 1) {
                seen.reopened += kinds(calls, "open").length > 0 ? 1 : 0;
              }
            }

            seen.sent += kinds(calls, "send").length;
            seen.persisted += kinds(cmds, "persist").length;

            if (msg.type === "send_ok" && next.client.pending.length < prev.client.pending.length) {
              seen.settled++;
            }
          }

          return null;
        }) as never,
        { ...opts, numRuns: 150 } as never,
      );
    }

    for (const [name, n] of Object.entries(seen)) {
      expect(n, name).toBeGreaterThan(0);
    }
  });

  it("good thing: the record laws' runs settle letters, settle one sent more than once, and meet each persistence answer", async () => {
    const m = await machine();
    const seen = { settled: 0, resentSettled: 0, granted: 0, refused: 0, failed: 0 };

    for (const [, layout, tiles] of LAYOUTS) {
      for (const list of [lists(m, layout, tiles), grantedLists(m, layout, tiles)]) {
        propertyTrace(
          m as never,
          { layout } as never,
          list as never,
          ((folded: ReadonlyArray<Folded>) => {
            const sends = new Map<string, number>();

            for (const { prev, msg, next, calls } of traced(m, folded)) {
              const letter = (msg["cmd"] as { letter?: string } | undefined)?.letter;

              if (
                msg.type === "send_ok" &&
                letter !== undefined &&
                prev.client.pending.some((p) => p.letter === letter) &&
                !next.client.pending.some((p) => p.letter === letter)
              ) {
                seen.settled++;
                seen.resentSettled += (sends.get(letter) ?? 0) > 1 ? 1 : 0;
              }

              if (msg.type === "persist_ok") {
                seen[msg["value"] === true ? "granted" : "refused"]++;
              }

              if (msg.type === "persist_err") {
                seen.failed++;
              }

              for (const s of kinds(calls, "send")) {
                const l = String(s["letter"]);
                sends.set(l, (sends.get(l) ?? 0) + 1);
              }
            }

            return null;
          }) as never,
          opts as never,
        );
      }
    }

    for (const [name, n] of Object.entries(seen)) {
      expect(n, name).toBeGreaterThan(0);
    }
  });

  it("the parent steps the link and the client by hand: its link is the link machine's own fold", async () => {
    const m = await machine();
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const { linkMachine } = (await import("@kampus/libfabrika/transport")) as unknown as {
      linkMachine: {
        readonly init: (loaded: unknown, ctx: object) => readonly [Model["link"], ReadonlyArray<Cmd>];
      };
    };
    expect(linkMachine, "the library's transport exports linkMachine").toBeDefined();
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    propertyTrace(
      m as never,
      { layout } as never,
      lists(m, layout, tiles) as never,
      ((steps: ReadonlyArray<Folded>) => {
        let link = linkMachine.init(null, {})[0];

        for (const { msg, next } of steps) {
          const own = [
            "admitted",
            "closed",
            "retry",
            "not_granted",
            "granted",
            "stalled",
            "beat",
            "pong",
            "renew",
            "blocked",
            "ask_again",
          ].includes(msg.type);

          if (own) {
            link = applyCell(linkMachine as never, link as never, msg as never)[0] as never;
          }

          if (JSON.stringify(next.link) !== JSON.stringify(link)) {
            return `${msg.type}: the window's link is ${JSON.stringify(next.link)}, the link machine's is ${JSON.stringify(link)}`;
          }
        }

        return null;
      }) as never,
      opts as never,
    );
  });

  for (const [named, checks] of CHECKS) {
    it(`the parent steps the client by hand: its letters, written, seen and views are the client machine's own fold, with the same checks (${named})`, async () => {
      const m = await machine(checks);
      const cm = await clientMachineFor(checks);

      for (const [, layout, tiles] of LAYOUTS) {
        propertyTrace(
          m as never,
          { layout } as never,
          readLists(m, layout, tiles) as never,
          clientFold(cm) as never,
          opts as never,
        );
      }
    });
  }
});

// Review 1, A (p17 and p5): a brain call in flight never holds the window. The brain hangs: no
// answer comes to any call the window made (its `send`, `open` and `knock` Subs, A12) or to the
// link's `ping`, and the only Msgs that still arrive are the window's own timer Sub's (tea's
// built-in `timer`, deps read from the machine as its runtime reads them). tea's run loop runs a
// step's Cmds one at a time and folds nothing until each settles (tea's ADR 0018), so a brain call
// asked as a Cmd and left unanswered holds every Msg behind it, the timers' included: the window
// sits still. From any state the generated runs reach, an online link leaves `online` within the
// detection bound, BEAT + BEAT = 10 s (`transport/link.ts`), and a grant wait keeps knocking
// without ever being admitted. No pending letter is lost while it hangs. The browser half is
// `e2e/window-recovery.test.ts`'s "a brain call in flight" cases.
const DETECTION = 10_000;

const HANG =
  "hang: with every call in flight unanswered, the window's own timers take an online link off online within 10 s and keep a grant wait knocking";

type Timer = { readonly ms: number; readonly msg: Msg } | null;

/** The window machine's own timer Subs, as its runtime reads them, and one step of its real update. */
const parts = (m: Machine) => {
  // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
  const real = m as unknown as {
    readonly subs?: ReadonlyArray<{ readonly type: string; readonly deps: (s: Model) => Timer }>;
    readonly update: Record<string, (s: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>]>;
  };
  const timers = (real.subs ?? []).filter((sub) => sub.type === "timer");
  return {
    timers: (s: Model): ReadonlyArray<Timer> => timers.map((sub) => sub.deps(s)),
    step: (s: Model, msg: Msg, ctx: object) => real.update[msg.type]?.(s, msg, ctx) ?? ([s, []] as const),
  };
};

/** tea's timer Sub as its runtime runs it: one per deps value, which fires once after its ms, and
 *  starts again only when the deps change. Answers the next timer Msg and how long it waited. */
const clock = () => {
  const running = new Map<number, { key: string; left: number; fired: boolean }>();
  return (timers: ReadonlyArray<Timer>): { readonly msg: Msg; readonly after: number } | null => {
    for (const [n, t] of timers.entries()) {
      const key = JSON.stringify(t);
      const now = running.get(n);

      if (now === undefined || now.key !== key) {
        running.set(n, { key, left: t?.ms ?? Number.POSITIVE_INFINITY, fired: t === null });
      }
    }

    let next: number | null = null;

    for (const [n, r] of running) {
      if (!r.fired && (next === null || r.left < (running.get(next)?.left ?? Number.POSITIVE_INFINITY))) {
        next = n;
      }
    }

    if (next === null) {
      return null;
    }

    const after = running.get(next)!.left;

    for (const r of running.values()) {
      r.left -= r.fired ? 0 : after;
    }

    running.get(next)!.fired = true;
    return { msg: timers[next]!.msg, after };
  };
};

const letters = (s: Model): string =>
  JSON.stringify(s.client.pending.map((p) => [p.n, p.letter ?? null]).sort((a, b) => Number(a[0]) - Number(b[0])));

/** The label of a brain call asked as a Cmd, which holds tea's loop until it settles. */
const asCmd = (type: string): string => `${type} Cmd`;

/** The brain calls asked as Cmds in `flight`: tea folds nothing while one is unanswered. */
const holding = (flight: ReadonlySet<string>): ReadonlyArray<string> =>
  [...flight].filter((k) => k.endsWith(" Cmd")).sort();

/** What a hang from `start` did: null when the law holds, else why it does not. `inFlight` names
 *  the calls unanswered at the start: a call Sub by its type, a call asked as a Cmd by `asCmd`. */
const hang = (
  m: Machine,
  layout: Tree,
  start: Model,
  inFlight: ReadonlySet<string>,
  seen: Record<string, number>,
): string | null => {
  const { timers, step } = parts(m);
  const was = start.link._tag;

  if (was !== "online" && was !== "waiting_grant") {
    return null;
  }

  let s = start;
  let waited = 0;
  const flight = new Set(inFlight);
  const knocks = new Set(
    callsIn(m, start)
      .filter((c) => c.type === "knock")
      .map((c) => c.id),
  );
  const tick = clock();

  for (let n = 0; n < 12; n++) {
    const held = holding(flight);

    if (held.length > 0) {
      return `tea folds nothing while ${held.join(", ")} is unanswered (ADR 0018): the window sits still in ${s.link._tag}`;
    }

    const next = tick(timers(s));

    if (next === null) {
      return `the window sits still in ${s.link._tag} while ${[...flight].join(", ") || "nothing"} is in flight`;
    }

    waited += next.after;
    const [after, cmds] = step(s, next.msg, { layout });

    for (const c of cmds) {
      if (CALLS.has(c.type)) {
        flight.add(asCmd(c.type));
      }
    }

    for (const c of callsIn(m, after)) {
      flight.add(c.type);

      if (c.type === "knock") {
        knocks.add(c.id);
      }
    }

    if (letters(after) !== letters(s)) {
      return `${next.msg.type} during a hang changed the pending letters: ${letters(s)} to ${letters(after)}`;
    }

    s = after;

    if (was === "online" && !online(s)) {
      seen[`left online with ${[...inFlight].sort().join("+") || "nothing"} in flight`] = 1;
      return waited <= DETECTION
        ? null
        : `the link left online only after ${waited} ms of hang, past the ${DETECTION} ms bound`;
    }

    if (was === "waiting_grant" && s.link._tag !== "waiting_grant") {
      return `a grant wait moved to ${s.link._tag} on its own timer while the brain hung`;
    }
  }

  if (was === "online") {
    return `the link is still online after ${waited} ms of hang with ${[...flight].join(", ")} in flight`;
  }

  // A knock is a call its Sub starts; a grant wait that knocked again started a second one.
  if (knocks.size > 1) {
    seen["a grant wait kept knocking with a knock in flight"] = 1;
  }

  return null;
};

/** The hang law over a run: from each state it reaches, a hang with what is in flight there. The
 *  calls in flight are each live call Sub (its answer may have come, and its runner still holds
 *  nothing), and each brain call asked as a Cmd that no `<type>_ok` or `<type>_err` has answered
 *  yet, by the Cmd it carries. */
const hangLaw =
  (m: Machine, layout: Tree, seen: Record<string, number>) =>
  (steps: ReadonlyArray<Folded>): string | null => {
    const asked = new Map<string, string>();

    for (const { msg, next, cmds } of steps) {
      const answered = (msg["cmd"] as object | undefined) && JSON.stringify(msg["cmd"]);

      if (answered !== undefined) {
        asked.delete(answered);
      }

      for (const c of cmds) {
        if (CALLS.has(c.type)) {
          asked.set(JSON.stringify(c), asCmd(c.type));
        }
      }

      const flight = new Set([...asked.values(), ...callsIn(m, next).map((c) => c.type)]);
      const why = hang(m, layout, next, flight, seen);

      if (why !== null) {
        return why;
      }
    }

    return null;
  };

describe("window machine: a brain call in flight holds no timer (review 1, A)", () => {
  for (const [label, layout, tiles] of LAYOUTS) {
    it(`${HANG} (${label})`, async () => {
      const m = await machine();
      const seen: Record<string, number> = {};
      propertyTrace(
        m as never,
        { layout } as never,
        pingLists(m, layout, tiles) as never,
        hangLaw(m, layout, seen) as never,
        opts as never,
      );

      // Good thing: the hangs met a send, an open, and both together in flight, and a grant wait
      // that knocked while its knock was unanswered.
      const met = Object.keys(seen);
      expect(
        met.some((k) => /with \S*send\S* in flight/.test(k)),
        `a send in flight: ${met.join("; ")}`,
      ).toBe(true);
      expect(
        met.some((k) => /with \S*open\S* in flight/.test(k)),
        `an open in flight: ${met.join("; ")}`,
      ).toBe(true);
    });
  }

  it("good thing: a grant wait knocks again and again with its knock unanswered, and is never admitted", async () => {
    const m = await machine();
    const [, layout] = LAYOUTS[0] as (typeof LAYOUTS)[number];
    const waiting = after(m, layout, [GRANT[0] as Msg]).state;
    expect(waiting.link._tag).toBe("waiting_grant");
    const seen: Record<string, number> = {};
    expect(hang(m, layout, waiting, new Set(), seen)).toBeNull();
    expect(seen).toHaveProperty(["a grant wait kept knocking with a knock in flight"]);
  });

  // Plants: a window that holds its beat while a call is in flight, and one whose grant wait goes
  // quiet once it knocked, are each caught by the hang law.
  const plant = async (change: (m: Machine) => Machine, layoutAt = 2): Promise<void> => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[layoutAt] as (typeof LAYOUTS)[number];
    const planted = change(real);
    expect(() =>
      propertyTrace(
        planted as never,
        { layout } as never,
        pingLists(real, layout, tiles) as never,
        ((steps: ReadonlyArray<Folded>) => {
          for (const { next } of steps) {
            const why = hang(planted, layout, next, new Set(["send"]), {});

            if (why !== null) {
              return why;
            }
          }

          return null;
        }) as never,
        opts as never,
      ),
    ).toThrow();
  };
  const withSubs = (m: Machine, deps: (real: (s: Model) => Timer) => (s: Model) => Timer): Machine => {
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const subs = (m as unknown as { subs: ReadonlyArray<{ type: string; deps: (s: Model) => Timer }> }).subs;
    // The link's timer is the window's first; the plant changes it and keeps every other Sub.
    const [link, ...rest] = subs;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the plant keeps the real machine and swaps one Sub; the cast names it a Machine again
    return { ...m, subs: [{ type: "timer", deps: deps(link!.deps) }, ...rest] } as unknown as Machine;
  };
  it("a beat held while a letter is pending is caught (hang)", () =>
    plant((m) => withSubs(m, (real) => (s) => (online(s) && s.client.pending.length > 0 ? null : real(s)))));
  it("a stall that waits twice the beat is caught (hang)", () =>
    plant((m) =>
      withSubs(m, (real) => (s) => {
        const t = real(s);
        return t !== null && online(s) ? { ...t, ms: t.ms * 3 } : t;
      }),
    ));
  it("a send asked as a Cmd, which tea's loop waits on, is caught (hang, A12)", async () => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const update = (real as unknown as { update: Record<string, Update> }).update;
    // The window also asks a send as a Cmd each time it comes online, as it did before A12.
    // oxlint-disable-next-line fabrika/no-type-assertions -- the plant keeps the real machine and wraps its update; the cast names it a Machine again
    const planted = {
      ...real,
      update: Object.fromEntries(
        Object.entries(update).map(([type, f]) => [
          type,
          (state: Model, msg: Msg, ctx: object) => {
            const [m, c] = f(state, msg, ctx);
            return !online(state) && online(m)
              ? [m, [...c, { type: "send", pid: A, letter: "x", n: 0, dial: m.link["dial"] }]]
              : [m, c];
          },
        ]),
      ),
    } as unknown as Machine;
    expect(() =>
      propertyTrace(
        planted as never,
        { layout } as never,
        pingLists(real, layout, tiles) as never,
        hangLaw(planted, layout, {}) as never,
        opts as never,
      ),
    ).toThrow(/tea folds nothing while .*send Cmd/);
  });
  it("a grant wait that goes quiet once it knocked is caught (hang)", async () => {
    const m = await machine();
    const [, layout] = LAYOUTS[0] as (typeof LAYOUTS)[number];
    const waiting = after(m, layout, [GRANT[0] as Msg]).state;
    const quiet = withSubs(
      m,
      (real) => (s) => (s.link._tag === "waiting_grant" && Number(s.link["knocks"] ?? 0) > 0 ? null : real(s)),
    );
    expect(hang(quiet, layout, waiting, new Set(), {})).not.toBeNull();
  });
});

describe("window machine: the view records, with each set of checks, on every fixed layout", () => {
  for (const name of Object.keys(viewLaws)) {
    for (const [named, checks] of CHECKS) {
      it(`${name} (${named})`, async () => {
        const m = await machine(checks);
        const law = (viewLaws[name] as ViewLaw)(await clientMachineFor(checks));

        for (const [, layout, tiles] of LAYOUTS) {
          propertyTrace(m as never, { layout } as never, viewLists(m, layout, tiles) as never, law as never, opts);

          if (checks === NO_CHECKS) {
            propertyTrace(m as never, { layout } as never, lists(m, layout, tiles) as never, law as never, opts);
          }
        }
      });
    }
  }

  it("good thing: the runs meet every link outcome, a measured reply, wholes, asks and patch runs of one and more, ended each way", async () => {
    const [, checks] = CHECKS[2] as (typeof CHECKS)[number];
    const m = await machine(checks);
    const seen = viewed(await clientMachineFor(checks));
    const met = {
      online: 0,
      waiting: 0,
      closed: 0,
      stalled: 0,
      removed: 0,
      measuredReply: 0,
      whole: 0,
      asked: 0,
      wholeOnOpen: 0,
      runOfOne: 0,
      runOfMore: 0,
      endedByWhole: 0,
      endedByAsk: 0,
      endedOffline: 0,
    };

    for (const [, layout, tiles] of LAYOUTS) {
      for (const list of [linkLists(m, layout, tiles), viewLists(m, layout, tiles)]) {
        propertyTrace(
          m as never,
          { layout } as never,
          list as never,
          ((steps: ReadonlyArray<Folded>) => {
            const runs = new Map<string, number>();
            const end = (pid: string, how: "endedByWhole" | "endedByAsk" | "endedOffline"): void => {
              const n = runs.get(pid) ?? 0;

              if (n > 0) {
                met[n === 1 ? "runOfOne" : "runOfMore"]++;
                met[how]++;
              }

              runs.delete(pid);
            };

            for (const { prev, msg, next } of steps) {
              const outcome = linkOutcome(prev, msg, next);

              if (outcome !== null) {
                met[outcome]++;
              }

              if (msg.type === "send_ok" && (msg["value"] as { ms?: number }).ms !== undefined) {
                met.measuredReply++;
              }

              const v = seen(prev, msg);

              if (online(prev) && !online(next)) {
                for (const pid of [...runs.keys()]) {
                  end(pid, "endedOffline");
                }
              }

              for (const pid of v.asked) {
                met.asked++;
                end(pid, "endedByAsk");
              }

              if (v.whole !== null) {
                met.whole++;
                met.wholeOnOpen += msg.type === "open_ok" ? 1 : 0;
                end(v.whole.pid, "endedByWhole");
              }

              if (v.patch !== null) {
                runs.set(v.patch.pid, (runs.get(v.patch.pid) ?? 0) + 1);
              }
            }

            return null;
          }) as never,
          opts as never,
        );
      }
    }

    for (const [name, n] of Object.entries(met)) {
      expect(n, name).toBeGreaterThan(0);
    }
  });
});

// Plants: reverse two letters; send offline; skip the resend; keep opened after a reconnect; re-read
// the displayed revision after the Cmd. Each wraps the real machine's reducer with one break, and the
// law that names it must throw.
describe("window machine plants: each break is caught by the law that names it", () => {
  type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  /** The real machine with its steps post-processed, `layout` in the ctx as the laws give it. */
  const broken = (
    real: Machine,
    change: (out: readonly [Model, ReadonlyArray<Cmd>], state: Model, msg: Msg) => readonly [Model, ReadonlyArray<Cmd>],
  ): Machine => {
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const update = (real as unknown as { update: Record<string, Update> }).update;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    return {
      ...real,
      update: Object.fromEntries(
        Object.entries(update).map(([type, f]) => [
          type,
          (state: Model, msg: Msg, ctx: object) => change(f(state, msg, ctx), state, msg),
        ]),
      ),
    } as unknown as Machine;
  };
  /** How many Subs of each call type a plant can hold: past what a generated list reaches. */
  const SLOTS = 32;
  /** The machine with its brain call Subs replaced by `over` of the real ones, in the order `over`
   *  gives (tea keys a Sub by its type and deps, so the slot a call sits in does not matter). */
  const rewired = (real: Machine, over: (calls: ReadonlyArray<Call>, s: Model) => ReadonlyArray<Call>): Machine =>
    // oxlint-disable-next-line fabrika/no-type-assertions -- the plant keeps the real machine and swaps its call Subs; the cast names it a Machine again
    ({
      ...real,
      subs: [
        ...(real.subs ?? []).filter((e) => !CALLS.has(e.type)),
        ...[...CALLS].flatMap((type) =>
          Array.from({ length: SLOTS }, (_, i) => ({
            type,
            deps: (s: Model) => over(callsIn(real, s), s).filter((c) => c.type === type)[i]?.deps ?? null,
          })),
        ),
      ],
    }) as unknown as Machine;
  /** A call a plant adds, as `rewired` takes it. */
  const call = (type: string, deps: Readonly<Record<string, unknown>>): Call => ({ type, id: "", deps });
  const keep = ([m, c]: readonly [Model, ReadonlyArray<Cmd>]): readonly [Model, ReadonlyArray<Cmd>] => [m, c];
  const expectCaught = async (
    name: string,
    change: Parameters<typeof broken>[1],
    layoutAt = 2,
    over?: Parameters<typeof rewired>[1],
  ): Promise<void> => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[layoutAt] as (typeof LAYOUTS)[number];
    const planted = over === undefined ? broken(real, change) : rewired(broken(real, change), over);
    expect(() => {
      propertyTrace(
        planted as never,
        { layout } as never,
        // A persist plant breaks the answer, so its lists always reach a new grant (folded by the planted machine).
        (GRANTED_LAWS.has(name)
          ? grantedLists(planted, layout, tiles)
          : LINK_LAWS.has(name)
            ? linkLists(real, layout, tiles)
            : lists(real, layout, tiles)) as never,
        ((steps: ReadonlyArray<Folded>) => laws[name]?.(traced(planted, steps), tiles) ?? null) as never,
        opts as never,
      );
    }).toThrow();
  };
  it("clearing the queue on any answer is caught (p1)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], _s, msg) =>
      msg.type === "send_err" ? [{ ...m, client: { ...m.client, pending: [] } }, c] : [m, c],
    ));
  it("settling a letter on an answer the client cannot read is caught (p1)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], _s, msg) =>
      msg.type === "send_err" && (msg["error"] as { _tag: string })._tag === "unknown"
        ? [
            {
              ...m,
              client: {
                ...m.client,
                pending: m.client.pending.filter((p) => p.letter !== (msg["cmd"] as { letter: string }).letter),
              },
            },
            c,
          ]
        : [m, c],
    ));
  it("a new letter on a resend is caught (p1)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], _s, msg) =>
      msg.type === "now_ok"
        ? [
            {
              ...m,
              client: {
                ...m.client,
                pending: m.client.pending.map((p) => (p.letter === undefined ? p : { ...p, letter: `${p.letter}!` })),
              },
            },
            c,
          ]
        : [m, c],
    ));
  it("a view installed by hand, past the client machine and its decoder, is caught (A7)", async () => {
    const [, checks] = CHECKS[2] as (typeof CHECKS)[number];
    const cm = await clientMachineFor(checks);
    const real = await machine(checks);
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // The window puts a whole view straight into its client, where the client machine would
    // first run the program's decoder on it.
    const planted = broken(real, ([m, c], _s, msg) => {
      const note = msg["note"] as { type?: unknown; rev?: unknown; view?: unknown } | undefined;
      return msg.type === "view" && note?.type === "whole"
        ? [
            {
              ...m,
              client: {
                ...m.client,
                views: {
                  ...m.client.views,
                  [String(msg["pid"])]: { rev: Number(note.rev), view: note.view } as never,
                },
              },
            },
            c,
          ]
        : [m, c];
    });
    expect(() =>
      propertyTrace(
        planted as never,
        { layout } as never,
        readLists(real, layout, tiles) as never,
        clientFold(cm) as never,
        opts as never,
      ),
    ).toThrow();
  });
  it("a client edited by hand, not stepped as the client machine, is caught (A5)", async () => {
    const cm = await clientMachineFor(NO_CHECKS);
    const real = await machine(NO_CHECKS);
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // The window drops the oldest letter on an unreachable answer, by hand, where the client
    // machine has no Msg that does.
    const planted = broken(real, ([m, c], _s, msg) =>
      msg.type === "send_err" ? [{ ...m, client: { ...m.client, pending: m.client.pending.slice(1) } }, c] : [m, c],
    );
    expect(() =>
      propertyTrace(
        planted as never,
        { layout } as never,
        readLists(real, layout, tiles) as never,
        clientFold(cm) as never,
        opts as never,
      ),
    ).toThrow();
  });
  // A12: the p2 and p4 plants change which call Subs are live, as the build's Subs would.
  it("sending while offline is caught (p2)", () =>
    expectCaught(
      "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
      keep,
      2,
      (calls, s) => {
        const ready = s.client.pending.find((p) => p.letter !== undefined);
        return online(s) || ready === undefined
          ? calls
          : [...calls, call("send", { pid: ready.pid, letter: ready.letter, n: ready.n, dial: 0 })];
      },
    ));
  it("skipping the resend on coming online is caught (p2)", () =>
    expectCaught(
      "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
      // The letters ready when the link came online are kept on the model, and never go out.
      ([m, c], s) =>
        !online(s) && online(m)
          ? [{ ...m, waited: s.client.pending.flatMap((p) => (p.letter === undefined ? [] : [p.letter])) } as Model, c]
          : [m, c],
      2,
      (calls, s) => {
        const waited = (s as { readonly waited?: ReadonlyArray<string> }).waited ?? [];
        return calls.filter((x) => !(x.type === "send" && waited.includes(String(x.deps["letter"]))));
      },
    ));
  it("reversing two letters is caught (p2 and now)", () =>
    expectCaught(
      "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
      keep,
      2,
      (calls) => [...calls.filter((x) => x.type !== "send"), ...calls.filter((x) => x.type === "send").reverse()],
    ));
  it("asking a send as a Cmd beside its Sub is caught (p2, A12)", () =>
    expectCaught(
      "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
      ([m, c], s) =>
        !online(s) && online(m)
          ? [m, [...c, { type: "send", pid: A, letter: "x", n: 0, dial: m.link["dial"] }]]
          : [m, c],
    ));
  it("keeping opened after a reconnect is caught (p4)", () =>
    expectCaught(
      "p4: every distinct pid of the layout opens once per dial, and a new dial opens again",
      // The first dial that came online is kept on the model; a later dial opens nothing again.
      ([m, c], s) =>
        !online(s) && online(m) && (s as { readonly first?: unknown }).first === undefined
          ? [{ ...m, first: m.link["dial"] } as Model, c]
          : [m, c],
      2,
      (calls, s) => {
        const first = (s as { readonly first?: unknown }).first;
        return calls.filter((x) => !(x.type === "open" && first !== undefined && x.deps["dial"] !== first));
      },
    ));
  it("opening a view when a press is made is caught (p4)", () =>
    expectCaught(
      "p4: every distinct pid of the layout opens once per dial, and a new dial opens again",
      keep,
      2,
      (calls, s) =>
        online(s) && s.client.written > 0
          ? [...calls, call("open", { pid: A, dial: s.link["dial"], press: s.client.written })]
          : calls,
    ));
  it("asking an open as a Cmd beside its Sub is caught (p4, A12)", () =>
    expectCaught("p4: every distinct pid of the layout opens once per dial, and a new dial opens again", ([m, c], s) =>
      !online(s) && online(m) ? [m, [...c, { type: "open", pid: A, dial: m.link["dial"] }]] : [m, c],
    ));
  it("re-reading the displayed revision after the Cmd is caught (now)", () =>
    expectCaught(
      "now: a press captures what it showed, and reversed or failed answers still send in slot order",
      ([m, c], _s, msg) =>
        msg.type === "now_ok"
          ? [
              {
                ...m,
                client: {
                  ...m.client,
                  pending: m.client.pending.map((p) => ({ ...p, viewRev: p.viewRev + 1 })),
                },
              },
              c,
            ]
          : [m, c],
    ));
  it("asking for persistence on every reconnect is caught (persist)", () =>
    expectCaught(PERSIST, ([m, c], _s, msg) =>
      msg.type === "admitted" && m.link._tag === "online" ? [m, [...c, { type: "persist" }]] : [m, c],
    ));
  it("taking the granted window offline when persistence is refused is caught (persist)", () =>
    expectCaught(PERSIST, ([m, c], _s, msg) =>
      msg.type === "persist_ok" ? [{ ...m, link: { _tag: "retrying", dial: 1, tries: 1 } }, c] : [m, c],
    ));
  /** The step's Cmds with each record Cmd's record changed by `edit`, or dropped when it gives null. */
  const records = (c: ReadonlyArray<Cmd>, edit: (r: ClientRecord) => ClientRecord | null): ReadonlyArray<Cmd> =>
    c.flatMap((x) => {
      if (x.type !== "record") {
        return [x];
      }

      const r = edit(x["record"] as ClientRecord);
      return r === null ? [] : [{ ...x, record: r }];
    });
  it("keeping a refused persistence as granted is caught (persist record)", () =>
    expectCaught(PERSIST_RECORD, ([m, c], _s, msg) =>
      msg.type === "persist_ok"
        ? [m, records(c, (r) => (r._tag === "persist" ? { ...r, result: "granted" } : r))]
        : [m, c],
    ));
  it("losing the record of a failed persistence is caught (persist record)", () =>
    expectCaught(PERSIST_RECORD, ([m, c], _s, msg) =>
      msg.type === "persist_err" ? [m, records(c, (r) => (isPersistRecord(r) ? null : r))] : [m, c],
    ));
  it("losing the record of a settled letter is caught (reply record)", () =>
    expectCaught(REPLY_RECORD, ([m, c], _s, msg) =>
      msg.type === "send_ok" ? [m, records(c, (r) => (r._tag === "reply" ? null : r))] : [m, c],
    ));
  it("counting only this dial's send as the attempts is caught (reply record)", () =>
    expectCaught(REPLY_RECORD, ([m, c]) => [m, records(c, (r) => (r._tag === "reply" ? { ...r, attempts: 1 } : r))]));
  it("keeping a second sample for a duplicate answer is caught (reply record)", () =>
    expectCaught(REPLY_RECORD, ([m, c], _s, msg) =>
      msg.type === "send_ok" && (msg["value"] as { _tag: string })._tag === "accepted"
        ? [
            m,
            [
              ...c,
              {
                type: "record",
                record: {
                  _tag: "reply",
                  letter: String((msg["cmd"] as { letter: string }).letter),
                  result: "accepted",
                  attempts: 1,
                  ms: 0,
                },
              },
            ],
          ]
        : [m, c],
    ));
  it("keeping a reply's ms other than its answer's is caught (reply record)", () =>
    expectCaught(REPLY_RECORD, ([m, c], _s, msg) =>
      msg.type === "send_ok" ? [m, records(c, (r) => (r._tag === "reply" ? { ...r, ms: r.ms + 1 } : r))] : [m, c],
    ));
  it("losing the row of a stalled link is caught (connect record)", () =>
    expectCaught(CONNECT_RECORD, ([m, c], _s, msg) =>
      msg.type === "stalled" ? [m, records(c, (r) => (r._tag === "connect" ? null : r))] : [m, c],
    ));
  it("keeping a connect ms the window made up is caught (connect record)", () =>
    expectCaught(CONNECT_RECORD, ([m, c]) => [m, records(c, (r) => (r._tag === "connect" ? { ...r, ms: 0 } : r))]));
  it("keeping a connect row for a stale Msg is caught (connect record)", () =>
    expectCaught(CONNECT_RECORD, ([m, c], s, msg) =>
      msg.type === "admitted" && JSON.stringify(m.link) === JSON.stringify(s.link)
        ? [
            m,
            [...c, { type: "record", record: { _tag: "connect", dial: Number(msg["dial"]), result: "online", ms: 0 } }],
          ]
        : [m, c],
    ));
  it("keeping a removed key as closed is caught (connect record)", () =>
    expectCaught(CONNECT_RECORD, ([m, c]) => [
      m,
      records(c, (r) => (r._tag === "connect" && r.result === "removed" ? { ...r, result: "closed" } : r)),
    ]));
  it("keeping a connect row on the link machine's dial, not the Msg's, is caught (connect record)", () =>
    expectCaught(CONNECT_RECORD, ([m, c]) => [
      m,
      records(c, (r) => (r._tag === "connect" ? { ...r, dial: r.dial + 1 } : r)),
    ]));
  it("a failed now that drops the press is caught (now)", () =>
    expectCaught(
      "now: a press captures what it showed, and reversed or failed answers still send in slot order",
      ([m, c], _s, msg) => (msg.type === "now_err" ? [{ ...m, client: { ...m.client, pending: [] } }, c] : [m, c]),
    ));
});

describe("window machine plants: each break of a view record is caught by its law", () => {
  type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  type Change = (
    out: readonly [Model, ReadonlyArray<Cmd>],
    state: Model,
    msg: Msg,
  ) => readonly [Model, ReadonlyArray<Cmd>];
  const expectCaught = async (name: string, change: Change): Promise<void> => {
    const [, checks] = CHECKS[2] as (typeof CHECKS)[number];
    const real = await machine(checks);
    const law = (viewLaws[name] as ViewLaw)(await clientMachineFor(checks));
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const update = (real as unknown as { update: Record<string, Update> }).update;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const planted = {
      ...real,
      update: Object.fromEntries(
        Object.entries(update).map(([type, f]) => [
          type,
          (state: Model, msg: Msg, ctx: object) => change(f(state, msg, ctx), state, msg),
        ]),
      ),
    } as unknown as Machine;
    expect(() =>
      propertyTrace(planted as never, { layout } as never, viewLists(real, layout, tiles) as never, law as never, opts),
    ).toThrow();
  };
  const views = (c: ReadonlyArray<Cmd>, edit: (r: ViewRow) => ReadonlyArray<ViewRow>): ReadonlyArray<Cmd> =>
    c.flatMap((x) =>
      x.type === "record" && (x["record"] as ClientRecord)._tag === "view"
        ? edit(x["record"] as ViewRow).map((record) => ({ ...x, record }))
        : [x],
    );
  const row = (record: ViewRow): Cmd => ({ type: "record", record });
  it("losing the asked row is caught (view record)", () =>
    expectCaught(VIEW_RECORD, ([m, c]) => [m, views(c, (r) => (r.result === "asked" ? [] : [r]))]));
  it("keeping a refused whole view as whole is caught (view record)", () =>
    expectCaught(VIEW_RECORD, ([m, c]) => [
      m,
      views(c, (r) => (r.result === "asked" ? [{ ...r, result: "whole" }] : [r])),
    ]));
  it("keeping a whole row at the shown rev, not the installed one, is caught (view record)", () =>
    expectCaught(VIEW_RECORD, ([m, c], s) => [
      m,
      views(c, (r) => (r.result === "whole" ? [{ ...r, rev: s.client.views[r.pid]?.rev ?? r.rev + 1 }] : [r])),
    ]));
  it("one row per patch is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c], s, msg) => {
      const pid = String(msg["pid"]);
      const was = s.client.views[pid]?.rev;
      const now = m.client.views[pid]?.rev;
      return msg.type === "view" && was !== undefined && now === was + 1
        ? [m, [...c, row({ _tag: "view", pid, result: "patch", rev: now, patches: 1 } as ViewRow)]]
        : [m, c];
    }));
  it("a count off by one is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c]) => [
      m,
      views(c, (r) => (r.result === "patch" ? [{ ...r, patches: (r.patches ?? 0) + 1 }] : [r])),
    ]));
  it("losing the run's row when the link leaves online is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c], s) =>
      online(s) && !online(m) ? [m, views(c, (r) => (r.result === "patch" ? [] : [r]))] : [m, c],
    ));
  it("a row for an empty run is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c]) => [
      m,
      views(c, (r) =>
        r.result === "whole"
          ? [{ _tag: "view", pid: r.pid, result: "patch", rev: r.rev, patches: 0 } as ViewRow, r]
          : [r],
      ),
    ]));
  it("keeping the run's row after its pid's whole row is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c]) => {
      const rows = c.filter((x) => x.type === "record" && (x["record"] as ClientRecord)._tag === "view");
      return [m, [...c.filter((x) => !rows.includes(x)), ...rows.reverse()]];
    }));
});

describe("window machine: saved state", () => {
  it("stopping at every message and booting from the saved model gives the same run", async () => {
    const m = await machine();
    const { syncTest } = await import("@kampus/libfabrika/testing");
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const model = (m as unknown as { model: Schema.Codec<unknown, unknown> }).model;
    fc.assert(
      fc.property(lists(m, layout, tiles), (list) => {
        syncTest(m as never, { layout } as never, {
          msgs: list as never,
          encode: Schema.encodeSync(model),
          decode: Schema.decodeUnknownSync(model),
          equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
          seed: SEED,
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});

// Mutation round (ticket 286, seed 119120): the window's wire schemas were never decoded by any
// law, so a schema line could change unseen. These vectors decode the Msgs the browser file feeds
// the machine, through the machine's own `msg` schema.
describe("window machine: format of the Msgs", () => {
  const msgSchema = async (): Promise<Schema.Codec<unknown, unknown>> =>
    // oxlint-disable-next-line fabrika/no-type-assertions -- the machine's `msg` is the schema of every Msg it reads; the cast names that
    ((await machine()) as unknown as { msg: Schema.Codec<unknown, unknown> }).msg;
  const accepts = async (msg: unknown): Promise<boolean> =>
    Result.isSuccess(Schema.decodeUnknownResult(await msgSchema())(msg));

  it("format: a key's identity Msg is `identity` with found created, reused or replaced, and nothing else", async () => {
    // reason: the browser's key read emits it (main.tsx), and the key row's result comes from found.
    for (const found of ["created", "reused", "replaced"]) {
      expect(await accepts({ type: "identity", found }), found).toBe(true);
    }

    expect(await accepts({ type: "identity", found: "other" })).toBe(false);
    expect(await accepts({ type: "", found: "created" })).toBe(false);
  });

  it("format: the link outcome Msgs `admitted` and `stalled` carry the dial and the measured ms", async () => {
    // reason: the connect rows copy ms from these (A8); a Msg without it is not one the machine reads.
    expect(await accepts({ type: "admitted", dial: 1, ping: 0, ms: 12.5 })).toBe(true);
    expect(await accepts({ type: "stalled", dial: 1, ms: 0 })).toBe(true);
    expect(await accepts({ type: "admitted", dial: 1, ping: 0 })).toBe(false);
    expect(await accepts({ type: "stalled", dial: 1 })).toBe(false);
    expect(await accepts({ type: "stalled", dial: 1, ms: -1 })).toBe(false);
  });

  it("format: a send Sub's answer, send_ok, carries a Sent answer plus the handler's ms, and needs the ms", async () => {
    // reason: the reply row's ms is read from it (A8). A12: `send` is a Sub, and its runner hands
    // the window `send_ok {cmd, value}` with the Sub's deps as `cmd`, so the value is decoded as
    // part of that Msg, through the machine's own `msg` schema.
    const cmd = { pid: A, letter: "letter_a", n: 0, m: { type: "inc" }, sentAt, seen: 0, dial: 1 };
    const ok = (value: unknown) => accepts({ type: "send_ok", cmd, value });
    expect(await ok({ _tag: "accepted", rev: 1, pos: 1, ms: 3 })).toBe(true);
    expect(await ok({ _tag: "refused", reason: "bad_msg", ms: 3 })).toBe(true);
    expect(await ok({ _tag: "accepted", rev: 1, pos: 1 })).toBe(false);
    expect(await ok({ _tag: "refused", reason: "bad_msg" })).toBe(false);
    expect(await ok({ _tag: "accepted", ms: 3 })).toBe(false);
  });
});

// Review 1, B (the settings read/wait/pages/restart half), on the window as it boots: Tuval's public
// `startWindow` with the platform's contracts (`ClientKey`, `ClientSocket`, `ClientRows`) given by
// Node doubles, and a made-up brain on the far side of the socket that speaks P12's wire. Each dial
// reads the person's `person/<person>/settings` stream through every page of `ledger.read` (a page of
// 100 is not the end), then waits past its cursor with `ledger.wait`, and reads again. The window's
// key table is the last `keys` entry whose body decodes; it shows a `keys_failed` problem only when
// that is the last entry read; `seen` is the last revision read. A new dial, after a restart, reads
// the stream again and reaches everything saved while it was down.
describe("window boot: the person's key settings, through every page, a wait and a restart (review 1, B)", () => {
  const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
  const STREAM = `person/${PERSON}/settings`;
  type Entry = { readonly rev: number; readonly id: string; readonly _tag: string; readonly body: unknown };
  type Live = { readonly getState: () => Model & { readonly keys: unknown; readonly keyError: unknown } };

  /** A made-up brain: every dial is one socket; `entries` is the settings stream as saved. */
  const brain = () => {
    const entries: Array<Entry> = [];
    const sockets: Array<{ readonly close: (code: number) => void }> = [];
    const waits: Array<() => void> = [];
    const reads: Array<{ readonly socket: number; readonly after: number; readonly got: number }> = [];
    const closed = new Set<number>();
    const dial = (_url: string) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<{ event: string; data?: unknown; code?: number }>();
        const socket = sockets.length;
        const say = (frame: object) => Queue.offerUnsafe(queue, { event: "message", data: JSON.stringify(frame) });
        const answer = (id: unknown, result: unknown) => say({ jsonrpc: "2.0", id, result });
        Queue.offerUnsafe(queue, { event: "open" });
        say({ jsonrpc: "2.0", method: "challenge", params: { nonce: "nonce-p14" } });
        sockets.push({
          close: (code) => {
            closed.add(socket);
            Queue.offerUnsafe(queue, { event: "close", code });
          },
        });
        return {
          events: Stream.fromQueue(queue),
          close: () => undefined,
          send: (text: string) => {
            if (text === "ping") {
              Queue.offerUnsafe(queue, { event: "message", data: "pong" });
              return true;
            }

            const call = JSON.parse(text) as { id: unknown; method: string; params: Record<string, unknown> };

            if (call.method === "initialize") {
              answer(call.id, { who: { person: PERSON }, version: 1, ping: 5_000 });
            } else if (call.method === "ledger.read") {
              const after = Number(call.params["after"]);
              const page = call.params["stream"] === STREAM ? entries.filter((e) => e.rev > after).slice(0, 100) : [];
              reads.push({ socket, after, got: page.length });
              answer(call.id, { entries: page });
            } else if (call.method === "ledger.wait") {
              const after = Number(call.params["after"]);
              const wake = () => answer(call.id, null);

              if (entries.some((e) => e.rev > after)) {
                wake();
              } else {
                waits.push(wake);
              }
            } else if (call.method === "client.record") {
              const rows = (call.params["rows"] as ReadonlyArray<{ id: string }>) ?? [];
              answer(call.id, { acknowledged: rows.map((r) => r.id) });
            } else if (call.method === "view.open") {
              answer(call.id, { rev: 0, view: { count: 0 } });
            }

            return true;
          },
        };
      });
    const save = (more: ReadonlyArray<Omit<Entry, "rev">>) => {
      for (const e of more) {
        entries.push({ ...e, rev: entries.length + 1 });
      }

      for (const wake of waits.splice(0)) {
        wake();
      }
    };
    return { entries, sockets, reads, closed, dial, save };
  };

  const identity = () => {
    const pair = generateKeyPairSync("ed25519");
    const raw = Buffer.from(pair.publicKey.export({ format: "jwk" }).x!, "base64url");
    const field = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
    const blob = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]);
    return {
      fingerprint: `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`,
      raw: raw.toString("base64url"),
      line: `ssh-ed25519 ${blob.toString("base64")}`,
    };
  };

  /** Boots the real window on the doubles and hands the live run to `use`. */
  const boot = <A>(b: ReturnType<typeof brain>, use: (live: Live) => Effect.Effect<A, unknown>) =>
    Effect.gen(function* () {
      // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
      const tuval = (yield* Effect.promise(() => import("../index.ts"))) as unknown as {
        startWindow?: (o: object) => Effect.Effect<{ readonly ready: Effect.Effect<Live, unknown> }, unknown>;
      };
      expect(tuval.startWindow, "@kampus/tuval exports startWindow").toBeTypeOf("function");
      const { ClientKey, ClientRows, ClientSocket, KeyLine } = yield* Effect.promise(
        () => import("@kampus/libfabrika/transport"),
      );
      const { Id } = yield* Effect.promise(() => import("@kampus/libfabrika"));
      const me = identity();
      const line = Schema.decodeUnknownSync(KeyLine)(me.line);
      const kept = new Map<string, unknown>();
      const services = Layer.mergeAll(
        Layer.succeed(ClientKey, {
          current: () =>
            Effect.succeed({ ...me, line, found: "reused" as const, sign: () => Effect.succeed(new Uint8Array(64)) }),
          claimPersist: Effect.succeed(false),
          persist: Effect.succeed(true),
        }),
        Layer.succeed(ClientSocket, { dial: b.dial as never }),
        Layer.succeed(ClientRows, {
          put: (row: { id: string }) => Effect.sync(() => void kept.set(row.id, row)),
          all: Effect.sync(() => [...kept.values()]),
          remove: (ids: ReadonlyArray<string>) =>
            Effect.sync(() => {
              for (const id of ids) {
                kept.delete(id);
              }
            }),
        }),
        Id.Generator.layer,
      );
      return yield* Effect.gen(function* () {
        const booting = yield* tuval.startWindow!({
          layout: { _tag: "tile", id: "t0", pid: "process_a" },
          ctx: {},
          checks: {},
          label: "Browser",
          build: "build-test",
          origin: "http://127.0.0.1:18787",
        });
        return yield* use(yield* booting.ready);
      }).pipe(Effect.provide(services), Effect.scoped);
    });

  /** Waits, on the real clock, until `ok` holds of the window's state, or says what it last was. */
  const until = (live: Live, what: string, ok: (s: ReturnType<Live["getState"]>) => boolean) =>
    Effect.gen(function* () {
      for (let n = 0; n < 200; n++) {
        if (ok(live.getState())) {
          return;
        }

        yield* Effect.sleep("20 millis");
      }

      const s = live.getState();
      expect.fail(
        `${what}: the window has link ${s.link._tag}, seen ${s.client.seen}, keys ${JSON.stringify(s.keys)}, keyError ${JSON.stringify(s.keyError)}`,
      );
    });

  const chord = fc.constantFrom("a", "b", "+", "ctrl+k", "shift+enter");
  const entry = fc.oneof(
    {
      weight: 5,
      arbitrary: chord.map((c) => ({
        _tag: "keys",
        body: { rows: { "counter.inc": [c] }, source: "file", reader: "stage:p14" },
      })),
    },
    {
      weight: 2,
      arbitrary: fc
        .record({ line: fc.nat(40), reason: fc.constantFrom("syntax", "unknown_command", "clash") })
        .map((p) => ({
          _tag: "keys_failed",
          body: { ...p, source: "file", reader: "stage:p14" },
        })),
    },
    // A `keys` entry whose body does not decode gives no table; another case is not a settings entry.
    { weight: 1, arbitrary: fc.constant({ _tag: "keys", body: { rows: "not rows" } }) },
    { weight: 1, arbitrary: fc.constant({ _tag: "note", body: {} }) },
  );
  /** Stream lengths around a page: none, one, 99 to 101, 199 to 201, and any up to 230. */
  const count = fc.oneof(fc.constantFrom(0, 1, 99, 100, 101, 199, 200, 201), fc.nat(230));
  const stream = count.chain((n) => fc.array(entry, { minLength: n, maxLength: n }));
  const ids = (list: ReadonlyArray<object>, from: number) => list.map((e, n) => ({ ...e, id: `keys-${from + n}` }));

  /** The model: what the window holds after it read `saved`. */
  const expected = async (saved: ReadonlyArray<Entry>) => {
    const { Keys } = await import("@kampus/libfabrika");
    const good = saved
      .filter((e) => e._tag === "keys" && typeof (e.body as { rows?: unknown }).rows === "object")
      .at(-1);
    const last = saved.at(-1);
    return {
      keys: Keys.buildTable({}, (good?.body as { rows?: Rows } | undefined)?.rows ?? {}),
      keyError:
        last?._tag === "keys_failed"
          ? { line: (last.body as { line: number }).line, reason: (last.body as { reason: string }).reason }
          : null,
      seen: last?.rev ?? 0,
    };
  };
  type Rows = Readonly<Record<string, ReadonlyArray<string>>>;

  const holds = (want: Awaited<ReturnType<typeof expected>>) => (s: ReturnType<Live["getState"]>) =>
    s.client.seen === want.seen &&
    JSON.stringify(s.keys) === JSON.stringify(want.keys) &&
    JSON.stringify(s.keyError ?? null) === JSON.stringify(want.keyError);

  it(
    "every page, then each wait, then a new dial after a restart: the table is the last good entry, the problem only the last entry's, seen the last revision",
    { timeout: 120_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(stream, stream, stream, async (first, later, down) => {
          const b = brain();
          b.save(ids(first, 0) as never);
          await Effect.runPromise(
            boot(b, (live) =>
              Effect.gen(function* () {
                /** Waits for a read of the settings stream on the socket of dial `n` (0-based). */
                const read = (n: number) =>
                  Effect.gen(function* () {
                    for (let t = 0; t < 200 && !b.reads.some((r) => r.socket === n); t++) {
                      yield* Effect.sleep("20 millis");
                    }

                    expect(
                      b.reads.some((r) => r.socket === n),
                      `dial ${n + 1} read the settings stream`,
                    ).toBe(true);
                  });
                yield* read(0);
                yield* until(live, "after the first read", holds(yield* Effect.promise(() => expected(b.entries))));
                b.save(ids(later, first.length) as never);
                yield* until(live, "after a wait", holds(yield* Effect.promise(() => expected(b.entries))));
                // The brain restarts: the socket closes, and edits are saved before the next dial.
                b.sockets.at(-1)?.close(1006);
                b.save(ids(down, first.length + later.length) as never);
                yield* read(1);
                yield* until(live, "after a restart", holds(yield* Effect.promise(() => expected(b.entries))));
              }),
            ),
          );

          // A page of 100 is not the end: on a socket still open, every full page was followed by
          // another read past it.
          expect(b.reads.length, "the settings stream was read").toBeGreaterThan(0);

          for (const [n, r] of b.reads.entries()) {
            const next = b.reads.slice(n + 1).find((x) => x.socket === r.socket);

            if (r.got === 100 && !b.closed.has(r.socket)) {
              expect(next?.after, "a full page is read past").toBeGreaterThan(r.after);
            }
          }
        }),
        { seed: SEED, numRuns: 12, endOnFailure: true, examples: [[[], [], []]] },
      );
    },
  );

  // Plants on the model: a client that stops at the first page, takes the last entry's table even
  // when it does not decode, or shows a problem an earlier entry had, is told apart from the right
  // answer on these streams.
  it("plants: stopping at the first page, using a bad last entry, or keeping an old problem are each caught", async () => {
    const at = (list: ReadonlyArray<object>) => ids(list, 0).map((e, n) => ({ ...e, rev: n + 1 })) as Array<Entry>;
    const good = (c: string) => ({ _tag: "keys", body: { rows: { "counter.inc": [c] }, source: "file", reader: "r" } });
    const bad = { _tag: "keys", body: { rows: "not rows" } };
    const failed = { _tag: "keys_failed", body: { line: 3, reason: "syntax", source: "file", reader: "r" } };
    const long = at([...Array.from({ length: 100 }, () => good("a")), good("b")]);
    const right = await expected(long);
    const firstPage = await expected(long.slice(0, 100));
    expect(
      holds(right)({ ...firstPage, client: { seen: firstPage.seen } } as never),
      "stopping at the first page",
    ).toBe(false);
    const tail = at([good("a"), bad]);
    const wrongTable = { ...(await expected(tail)), keys: { rows: "not rows" } };
    expect(holds(await expected(tail))({ ...wrongTable, client: { seen: 2 } } as never), "a bad last entry").toBe(
      false,
    );
    const healed = at([failed, good("b")]);
    const kept = { ...(await expected(healed)), keyError: { line: 3, reason: "syntax" } };
    expect(holds(await expected(healed))({ ...kept, client: { seen: 2 } } as never), "an old problem").toBe(false);
  });
});
