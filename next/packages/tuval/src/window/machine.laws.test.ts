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
// - The three brain calls, `send` (process.send), `open` (view.open) and `knock` (door.knock), are
//   writes (A13; tea's run loop folds nothing while a Cmd is unanswered, ADR 0018, so no Cmd waits
//   for the brain). The window asks no Cmd of those three types. A call is the Cmd
//   `write {call, id, dial}`: `call` is `{_tag: "send", pid, letter, n, m, sentAt, seen}` (and its
//   `traceId` when it has one), `{_tag: "open", pid}` or `{_tag: "knock", ...}`; `id` is its
//   JSON-RPC id, never two alike on one dial; `dial` the dial it is written on. A write settles at
//   once, as tea mints its settle Msgs: `write_ok {cmd, value}` once the frame is handed to the
//   socket, or `write_err {cmd, error}` when it cannot be (unreachable), never waiting for the brain.
// - The answers come on the socket Sub, by id and dial: `send_ok {id, dial, value, ms}` (`value` a
//   `Sent`, `ms` the runner's, from the write to the frame), `send_err {id, dial, error}`, and
//   likewise `open_ok`/`open_err` (`open`'s value is `{rev, view}`) and `knock_ok`/`knock_err`. The
//   runner answers each handed-over write once; a dial change ends the socket Sub, so a write whose
//   dial ended is never answered, and a write that failed is never answered. A call is in flight
//   from its write until its answer, its `write_err` or the end of its dial. An answer whose dial
//   or id is not in flight is stale and does nothing: the window and its Cmds stay as they were.
//   The laws below draw the answers that way, and draw stale ones too.
// - A window that was just granted (`granted` while it waited, on its dial) asks the Cmd `persist {}`
//   once, when it next goes online; `persist_ok` carries a boolean, `persist_err` a failure. A window
//   that was never in a grant wait, and a reconnect, ask it never. Either answer leaves the link as it was.
// - Going online (`admitted` on the current dial) writes `open` once per distinct pid of the layout
//   and `send` for every letter that is ready, in slot order, each once, all in that one step: no
//   cap. Not online writes no `send`. Leaving online forgets what was opened and sent, so the next
//   dial starts over; its letters stay in the Model and go out again by its own rules.
// - `client` moves only by the machine `clientMachineFor(checks)` makes (app/client.ts, plan A5 and
//   A7), with the window's own `checks`, stepped by hand as the link is: `press` steps it with
//   `press {pid, m}`, `now_ok` with `dated {n, ...value}`, a `send_ok` in flight with
//   `reply {letter, answer}` (the letter its write carried), `seen {rev}` with `read {rev}`,
//   `view {pid, note}` with `notice {pid, note}`, and an `open_ok` in flight on the current dial with
//   `notice {pid, note: {type: "whole", ...value}}`; a stale answer moves nothing. The client law
//   below compares letters, `written`, `seen` and views.
// - Records (A8), each a `{type: "record", record}` Cmd holding a `ClientRecord` with no field its
//   schema lacks. The window reads no clock: a link outcome Msg (`admitted`, `not_granted`,
//   `closed`, `stalled`) carries `ms`, put there by the handler that dialed, and `send_ok` carries
//   the socket runner's `ms` beside its `Sent` value (A13). A link outcome keeps one `connect` row; a
//   settled letter one `reply` row; a whole view installed a `view {result: "whole"}` row, an ask
//   a `view {result: "asked"}` row, and a run of patches one `view {result: "patch", patches}` row
//   when it ends.
import { createHash, generateKeyPairSync } from "node:crypto";
import { acceptedTypes, applyCell } from "@demlik/tea";
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

interface Machine {
  readonly init: (loaded: unknown, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  readonly model: unknown;
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
  /** Also draw a failed key settings read, `settings_failed {dial, reason}`, on any dial, the
   *  settings Msgs `keys` and `keys_failed` (A15), and the resend timer's tick on any dial (A16). */
  readonly settings?: boolean;
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

/** A15: the settings read's own Msgs. A failed read names its dial and the call's own reason; a
 *  good table or a problem has no dial, as the runner sends them today. A16: the resend timer's
 *  tick, on any dial, is what asks a failed read again, so these lists draw it too. */
const settingsCells = {
  resend: fc.record({ type: fc.constant("resend"), dial }),
  settings_failed: fc.record({
    type: fc.constant("settings_failed"),
    dial,
    reason: fc.constantFrom("unreachable", "refused", "not_found"),
  }),
  keys: fc.record({ type: fc.constant("keys"), rows: fc.constantFrom({}, { "counter.inc": ["+"] }) }),
  keys_failed: fc.record({
    type: fc.constant("keys_failed"),
    error: fc.record({ line: fc.integer({ min: 1, max: 5 }), reason: fc.constantFrom("syntax", "read", "watch") }),
  }),
};

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
    ...(tuning.settings ? settingsCells : {}),
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
    persist: {
      draw: fc.constantFrom("true", "false", "error"),
      make: (cmd: Cmd, v: string): Msg =>
        v === "error"
          ? { type: "persist_err", cmd, error: { _tag: "unsupported" } }
          : { type: "persist_ok", cmd, value: v === "true" },
    },
  };
  // The socket Sub's answers to a write, by its call's `_tag` (A13); the list adds the write's `id`
  // and `dial`. Review 1, D: an answer the client cannot read (`send_err {_tag: "unknown"}`) is
  // drawn too, so a window that settles a letter on it breaks p1.
  const brain = {
    send: {
      draw: fc.tuple(fc.constantFrom("accepted", "refused", "unreachable", "unknown"), ms),
      make: ([kind, took]: readonly [string, number]): Msg =>
        kind === "accepted"
          ? { type: "send_ok", value: { _tag: "accepted", rev: 1, pos: 1 }, ms: took }
          : kind === "refused"
            ? { type: "send_ok", value: { _tag: "refused", reason: "bad_msg" }, ms: took }
            : kind === "unknown"
              ? { type: "send_err", error: { _tag: "unknown" } }
              : { type: "send_err", error: { _tag: "unreachable" } },
    },
    open: {
      draw: fc.record({
        ok: fc.boolean(),
        rev: tuning.runs ? fc.nat(3) : fc.nat(5),
        count: fc.integer({ min: -3, max: 3 }),
        took: ms,
      }),
      make: (v: { ok: boolean; rev: number; count: number; took: number }): Msg =>
        v.ok
          ? { type: "open_ok", value: { rev: v.rev, view: { count: v.count } }, ms: v.took }
          : { type: "open_err", error: { _tag: "unreachable" } },
    },
    knock: {
      draw: fc.tuple(fc.boolean(), ms),
      make: ([ok, took]: readonly [boolean, number]): Msg =>
        ok ? { type: "knock_ok", value: null, ms: took } : { type: "knock_err", error: { _tag: "closed" } },
    },
  };
  return { outside, answers, brain };
};

/** The window's brain calls (A13): each is a `write` of a call with one of these `_tag`s, never a
 *  Cmd of that type. */
const CALLS: ReadonlySet<string> = new Set(["send", "open", "knock"]);

/** The Msg types the socket Sub answers a write with. */
const ANSWERS: ReadonlySet<string> = new Set([...CALLS].flatMap((t) => [`${t}_ok`, `${t}_err`]));

/** A write a step emits, read as a Cmd of its call's type would be: `{type: call._tag, ...call,
 *  id, dial}`, so a law counts and orders the calls as it did the Cmds. */
type Call = Cmd & { readonly id: unknown; readonly dial: unknown };

const writesIn = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<Call> =>
  cmds.flatMap((c) => {
    const call = c["call"] as { readonly _tag?: unknown } | undefined;
    return c.type === "write" && typeof call?._tag === "string"
      ? [{ ...(call as object), type: call._tag, id: c["id"], dial: c["dial"] }]
      : [];
  });

/** The key an answer and its write share: the dial and the JSON-RPC id. */
const wire = (dial: unknown, id: unknown): string => JSON.stringify([dial, id]);

/** The dial whose socket is open in `s`, as `transport/link.ts`'s `socketDial` reads a link. */
const openDial = (s: Model): unknown =>
  ["dialing", "waiting_grant", "online"].includes(s.link._tag) ? s.link["dial"] : null;

/** A write folds its settle at once (A13): `write_ok` unless the list's bits fail it. */
const fails = (bits: number, k: number): boolean => ((bits >>> (k % 28)) & 7) === 7;

/** A guided list, as tea's `arbGuidedSequence` draws one (an outside Msg, or an answer picked among
 *  those waiting, with an outside Msg in its place when none waits, so a list keeps its length),
 *  with the writes of A13: every `write` a step emits settles in the very next Msgs, `write_ok` (the
 *  frame is handed over) or now and then `write_err` (unreachable), drawn in no slot of its own. A
 *  handed-over write then waits for its one answer from the socket Sub, `brain[call._tag]` with the
 *  write's id and dial; a write whose dial's socket ended first is dropped and never answered, and
 *  a failed write is never answered. Other Cmds (`now`, `persist`) wait as tea's do. A brain call
 *  asked as a Cmd waits for nothing: no runner answers it. A third kind of event is a stale answer:
 *  one more answer to a write already answered, failed or dropped, or to an id never written. */
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
  const replies = Object.entries(cellsFor.brain) as ReadonlyArray<
    readonly [string, { readonly draw: fc.Arbitrary<unknown>; readonly make: (v: never) => Msg }]
  >;
  const at = new Map(answers.map(([type], n) => [type, n]));
  const said = new Map(replies.map(([type], n) => [type, n]));
  type Waiting =
    | { readonly kind: "cmd"; readonly type: string; readonly cmd: Cmd }
    | { readonly kind: "write"; readonly type: string; readonly id: unknown; readonly dial: unknown };
  const values = fc.tuple(...answers.map(([, a]) => a.draw));
  const heard = fc.tuple(...replies.map(([, a]) => a.draw));
  const events = fc.array(
    fc.oneof(
      {
        weight: 2,
        arbitrary: fc.tuple(fc.oneof(...outside), fc.nat()).map(([msg, bits]) => ({ outside: msg, bits }) as const),
      },
      {
        weight: 4,
        arbitrary: fc
          .tuple(fc.nat(1_000), values, heard, fc.oneof(...outside), fc.nat())
          .map(([pick, v, r, otherwise, bits]) => ({ pick, values: v, replies: r, otherwise, bits }) as const),
      },
      {
        weight: 1,
        arbitrary: fc
          .tuple(fc.nat(1_000), fc.boolean(), heard, fc.oneof(...outside), fc.nat())
          .map(([pick, never, r, otherwise, bits]) => ({ late: pick, never, replies: r, otherwise, bits }) as const),
      },
    ),
    { maxLength: opts.maxLength, size: "max" },
  );
  return events.map((drawn) => {
    const ctx = { layout };
    const msgs: Array<Msg> = [];
    let [state, cmds] = m.init(opts.loaded ?? null, ctx);
    let waiting: Array<Waiting> = [];
    /** Every write the run emitted, for the stale answers. */
    const written: Array<Call> = [];
    /** Folds one Msg if the window takes it: its Cmds, null when the window does not take it, or
     *  "end" when the fold threw and the list ends there. */
    const fold = (msg: Msg): ReadonlyArray<Cmd> | null | "end" => {
      if (!acceptedTypes(m as never, state as never).includes(msg.type)) {
        return null;
      }

      msgs.push(msg);

      try {
        const out: readonly [Model, ReadonlyArray<Cmd>] = applyCell(m as never, state as never, msg as never) as never;
        [state, cmds] = out;
      } catch {
        return "end";
      }

      return cmds;
    };
    /** What a step leaves waiting, its writes settled at once (their own Cmds in turn). */
    const settle = (bits: number): boolean => {
      let k = 0;
      let asked = cmds;

      while (asked.length > 0) {
        const after: Array<Cmd> = [];

        for (const c of asked) {
          const call = writesIn([c])[0];

          if (call !== undefined) {
            written.push(call);
            const ok = !fails(bits, k++);

            if (ok && said.has(call.type)) {
              waiting.push({ kind: "write", type: call.type, id: call.id, dial: call.dial });
            }

            const settled: Msg = ok
              ? { type: "write_ok", cmd: c, value: null }
              : { type: "write_err", cmd: c, error: { _tag: "unreachable" } };

            const more = fold(settled);

            if (more === "end") {
              return false;
            }

            after.push(...(more ?? []));
          } else if (!CALLS.has(c.type) && at.has(c.type)) {
            waiting.push({ kind: "cmd", type: c.type, cmd: c });
          }
        }

        asked = after;
      }

      const open = openDial(state);
      waiting = waiting.filter((w) => w.kind === "cmd" || w.dial === open);
      return true;
    };

    if (!settle(0)) {
      return msgs;
    }

    for (const event of drawn) {
      let msg: Msg;

      if ("outside" in event) {
        msg = event.outside;
      } else if ("late" in event) {
        const past = written[event.late % Math.max(1, written.length)];

        if (past === undefined) {
          msg = event.otherwise;
        } else {
          const n = said.get(past.type) as number;
          const reply = (replies[n] as (typeof replies)[number])[1].make(event.replies[n] as never);
          msg = event.never
            ? { ...reply, id: 1_000_000 + event.late, dial: past.dial }
            : { ...reply, id: past.id, dial: past.dial };
        }
      } else if (waiting.length === 0) {
        msg = event.otherwise;
      } else {
        const w = waiting[event.pick % waiting.length] as Waiting;
        waiting = waiting.filter((x) => x !== w);

        if (w.kind === "cmd") {
          const n = at.get(w.type) as number;
          msg = (answers[n] as (typeof answers)[number])[1].make(w.cmd, event.values[n] as never);
        } else {
          const n = said.get(w.type) as number;
          msg = {
            ...(replies[n] as (typeof replies)[number])[1].make(event.replies[n] as never),
            id: w.id,
            dial: w.dial,
          };
        }
      }

      const folded = fold(msg);

      if (folded === "end") {
        return msgs;
      }

      if (folded === null) {
        continue;
      }

      if (!settle(event.bits)) {
        return msgs;
      }
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
const linkLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>, loaded?: Model) =>
  guided(m, layout, cells(pids, { removal: true }), { maxLength: 70, ...(loaded === undefined ? {} : { loaded }) });

/** Lists for the view laws: longer, with notes that continue the shown revision, so patch runs
 *  of one, two and more form and end by a whole view, an ask and the link leaving online. */
const viewLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>, loaded?: Model) =>
  guided(m, layout, cells(pids, { runs: true }), { maxLength: 120, ...(loaded === undefined ? {} : { loaded }) });

/** Lists for the settings law (A15, A16): a failed key settings read on any dial, good tables and
 *  problems, and resend ticks, among every other Msg. */
const settingsLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) =>
  guided(m, layout, cells(pids, { settings: true }), { maxLength: 70 });

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

/** The lead's run-5 loss (A14), as a list: online on dial 1, every write handed over, then the
 *  open's own whole for `process_a` at 5, a patch to 6, and only then the open's answer at 5. */
const runFiveLoss = (m: Machine, layout: Tree): { readonly list: ReadonlyArray<Msg>; readonly answered: boolean } => {
  const list: Array<Msg> = [{ type: "admitted", dial: 1, ping: 0, ms: 0 }];
  const writes = after(m, layout, list).cmds.filter((c) => c.type === "write");
  list.push(...writes.map((c): Msg => ({ type: "write_ok", cmd: c, value: null })));
  const open = writes.find((c) => {
    const call = c["call"] as { readonly _tag?: unknown; readonly pid?: unknown } | undefined;
    return call?._tag === "open" && call.pid === A;
  });
  list.push(
    { type: "view", pid: A, note: { type: "whole", rev: 5, view: { count: 5 } } },
    {
      type: "view",
      pid: A,
      note: { type: "patch", base: 5, rev: 6, patch: [{ op: "replace", path: "/count", value: 6 }] },
    },
  );

  if (open !== undefined) {
    list.push({ type: "open_ok", id: open["id"], dial: 1, value: { rev: 5, view: { count: 5 } }, ms: 0 });
  }

  return { list, answered: open !== undefined };
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

/** Lists where every run ends a dial with letters and opens written on it and unanswered, then
 *  goes on with a guided tail drawn from the state the real fold reached. The prefix comes online
 *  on dial 1, settles the opens' writes, dates and writes two presses, then ends the dial by a close
 *  or a stall, and in half the variants hears a late `send_ok` for the first letter from the ended
 *  dial. Blind lists never reached an unanswered send whose dial ended and came online again (0 in
 *  1,500 runs at seed 119120), so the resend law met no owed letter. */
const owedLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) => {
  const prefix: Array<Msg> = [];
  const push = (msg: Msg): ReadonlyArray<Cmd> => {
    prefix.push(msg);
    return after(m, layout, prefix).cmds;
  };
  const handOver = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<Cmd> => {
    const writes = cmds.filter((c) => c.type === "write");

    for (const c of writes) {
      push({ type: "write_ok", cmd: c, value: null });
    }

    return writes;
  };
  handOver(push({ type: "admitted", dial: 1, ping: 0, ms: 0 }));
  const sent: Array<Cmd> = [];

  for (const [k, pid] of [pids[0], pids.at(-1)].entries()) {
    const asked = push({ type: "press", pid, m: { type: "inc" } }).find((c) => c.type === "now");

    if (asked !== undefined) {
      sent.push(...handOver(push({ type: "now_ok", cmd: asked, value: { letter: `letter_owed_${k}`, sentAt } })));
    }
  }

  const ends: ReadonlyArray<Msg> = [
    { type: "closed", dial: 1, code: 1006, fingerprint: "a", ms: 0 },
    { type: "stalled", dial: 1, ms: 0 },
  ];
  const first = sent[0];
  const variants = ends.flatMap((end) => {
    const late: ReadonlyArray<Msg> =
      first === undefined
        ? []
        : [{ type: "send_ok", id: first["id"], dial: 1, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: 0 }];
    return [
      [...prefix, end],
      [...prefix, end, ...late],
    ].map((list) => ({ list, state: after(m, layout, list).state }));
  });

  return fc
    .constantFrom(...variants)
    .chain(({ list, state }) =>
      linkLists(m, layout, pids, state).map((tail) => [...list, ...(tail as ReadonlyArray<Msg>)]),
    );
};

type Step = {
  readonly prev: Model;
  readonly msg: Msg;
  readonly next: Model;
  readonly cmds: ReadonlyArray<Cmd>;
  /** The brain calls the step wrote (A13), each read as `{type: call._tag, ...call, id, dial}`. */
  readonly calls: ReadonlyArray<Call>;
  /** For an answer from the socket Sub, or a write's settle, the write it is about while that is
   *  in flight; else null. */
  readonly call: Call | null;
  /** An answer from the socket Sub whose dial or id is not in flight. */
  readonly stale: boolean;
  /** The writes in flight after the step. */
  readonly flight: ReadonlyArray<Call>;
};

/** What the real runner hands a law: a step before its calls are read. */
type Folded = Pick<Step, "prev" | "msg" | "next" | "cmds">;

/** A run's steps as the real runner folded them, each with the writes it emitted and the write its
 *  answer is about. A write is in flight from its step until its answer, its `write_err`, or a step
 *  after which its dial's socket is no longer open. */
const traced = (steps: ReadonlyArray<Folded>): ReadonlyArray<Step> => {
  const flight = new Map<string, Call>();
  return steps.map((step) => {
    const { msg, next, cmds } = step;
    const settle = msg.type === "write_ok" || msg.type === "write_err";
    const about = settle
      ? wire((msg["cmd"] as Cmd | undefined)?.["dial"], (msg["cmd"] as Cmd | undefined)?.["id"])
      : ANSWERS.has(msg.type)
        ? wire(msg["dial"], msg["id"])
        : null;
    const found = about === null ? undefined : flight.get(about);
    const call =
      found !== undefined && (settle || `${found.type}_ok` === msg.type || `${found.type}_err` === msg.type)
        ? found
        : null;
    const stale = ANSWERS.has(msg.type) && call === null;

    if (call !== null && about !== null && msg.type !== "write_ok") {
      flight.delete(about);
    }

    const calls = writesIn(cmds);

    for (const c of calls) {
      flight.set(wire(c.dial, c.id), c);
    }

    const open = openDial(next);

    for (const [key, c] of flight) {
      if (c.dial !== open) {
        flight.delete(key);
      }
    }

    return { ...step, calls, call, stale, flight: [...flight.values()] };
  });
};

/** A brain call the step asked as a Cmd: tea's loop folds nothing until it settles, so a call is
 *  a write (A13). */
const askedCall = ({ msg, cmds }: Step): string | null => {
  const c = cmds.find((x) => CALLS.has(x.type));
  return c === undefined
    ? null
    : `${msg.type} asked a ${c.type} Cmd, which waits for the brain; a brain call is a write (A13)`;
};

/** A stale answer does nothing (A13, p5): the window and its Cmds stay as they were. Two writes on
 *  one dial never share an id, so an answer names one call. */
const staleOrTwice = (step: Step, ids: Set<string>): string | null => {
  const { prev, msg, next, cmds, calls } = step;

  if (step.stale && (JSON.stringify(next) !== JSON.stringify(prev) || cmds.length > 0)) {
    return `a stale ${msg.type} (id ${String(msg["id"])}, dial ${String(msg["dial"])}, link ${prev.link._tag} on ${String(prev.link["dial"])}) moved the window or asked ${JSON.stringify(cmds.map((c) => c.type))}`;
  }

  for (const c of calls) {
    const key = wire(c.dial, c.id);

    if (ids.has(key)) {
      return `${msg.type} wrote id ${String(c.id)} a second time on dial ${String(c.dial)}`;
    }

    ids.add(key);
  }

  return null;
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

const RESEND =
  "A13 resend: a send or open in flight when its dial ends stays in the Model, is written once on the next dial that goes online, and a late answer from the ended dial does nothing";

/** The laws whose lists must each reach a new grant going online, so a persistence answer is met. */
const GRANTED_LAWS: ReadonlySet<string> = new Set([PERSIST, PERSIST_RECORD]);

/** The laws that also run on lists where a key is removed and asked again, whose handlers' ms
 *  are drawn. */
const LINK_LAWS: ReadonlySet<string> = new Set([CONNECT_RECORD, REPLY_RECORD, RESEND]);

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

    for (const { prev, msg, next, call } of steps) {
      if (msg.type === "press") {
        model.set(next.client.written - 1, null);
        presses++;
      } else if (msg.type === "now_ok") {
        const n = (msg["cmd"] as { n: number }).n;

        if (model.has(n) && model.get(n) === null) {
          model.set(n, (msg["value"] as { letter: string }).letter);
        }
      } else if (msg.type === "send_ok" && call !== null) {
        // Only the answer to a write in flight is the letter's: a stale one settles nothing (A13).
        const letter = call["letter"];
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
  // A13: a send is a write the step emits; going online writes every ready letter in that one step,
  // with no cap, and a stale answer does nothing.
  "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing": (steps) => {
    let sentThisDial = new Set<string>();
    const ids = new Set<string>();

    for (const step of steps) {
      const { prev, msg, next, calls, call } = step;
      const sends = kinds(calls, "send");
      const asked = askedCall(step) ?? staleOrTwice(step, ids);

      if (asked !== null) {
        return asked;
      }

      if (!online(next)) {
        if (sends.length > 0) {
          return `${msg.type} sent ${sends.length} letter(s) while ${next.link._tag}`;
        }

        sentThisDial = new Set();
        continue;
      }

      if (!online(prev)) {
        sentThisDial = new Set();
      }

      // A letter whose send failed, by the brain or as its write, may go again on this dial.
      if ((msg.type === "send_err" || msg.type === "write_err") && call?.type === "send") {
        sentThisDial.delete(String(call["letter"]));
      }

      const letters = sends.map((s) => String(s["letter"]));

      if (new Set(letters).size !== letters.length) {
        return `${msg.type} sent a letter twice in one step`;
      }

      for (const l of letters) {
        if (sentThisDial.has(l)) {
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
    }

    return null;
  },
  // p4: every distinct pid in the layout is opened once per dial; a new dial opens again.
  // A13: an open is a write the step emits, on the dial that is online. Going online writes one per
  // distinct pid, the dial opens again only for a view the client could not use, and a stale
  // answer does nothing.
  "p4: every distinct pid of the layout opens once per dial, and a new dial opens again": (steps, tiles) => {
    const distinct = [...new Set(tiles)].sort();
    const ids = new Set<string>();

    for (const step of steps) {
      const { prev, msg, next, calls } = step;
      const opens = kinds(calls, "open");
      const asked = askedCall(step) ?? staleOrTwice(step, ids);

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

      if (msg.type === "press" && opens.length > 0) {
        return "a press opened a view";
      }

      if (online(prev) && online(next) && msg.type !== "view" && opens.length > 0) {
        return `${msg.type} opened again on the same dial`;
      }
    }

    return null;
  },
  // A13: a call whose dial ends stays in the Model and is written again on the next dial by the
  // Model's own rules. Each send or open in flight when its dial's socket ends (written there and
  // not answered) is owed: its letter stays pending, the step the link next goes online writes it
  // once on that new dial, and any answer that names the ended dial leaves the window as it was.
  [RESEND]: (steps) => {
    /** The owed letters and open pids, with the dial each was written on. */
    const owed = { letters: new Map<string, unknown>(), pids: new Map<string, unknown>() };
    const ended = new Set<unknown>();
    let flight: ReadonlyArray<Call> = [];

    for (const step of steps) {
      const { prev, msg, next, cmds, calls, call } = step;
      const was = openDial(prev);
      const is = openDial(next);

      if (ANSWERS.has(msg.type) && ended.has(msg["dial"]) && msg["dial"] !== was) {
        if (JSON.stringify(next) !== JSON.stringify(prev) || cmds.length > 0) {
          return `a late ${msg.type} from ended dial ${String(msg["dial"])} (id ${String(msg["id"])}) moved the window or asked ${JSON.stringify(cmds.map((c) => c.type))}`;
        }
      }

      if (was !== null && was !== is) {
        // This step ended dial `was`: what was in flight on it, less what this step answered.
        const answered = call !== null && msg.type !== "write_ok" ? wire(call.dial, call.id) : null;
        const left = [...flight, ...calls].filter((c) => c.dial === was && wire(c.dial, c.id) !== answered);

        for (const c of left) {
          if (c.type === "send") {
            const letter = String(c["letter"]);

            if (!next.client.pending.some((p) => p.letter === letter)) {
              return `${letter}, in flight on dial ${String(was)} when it ended, left the Model`;
            }

            owed.letters.set(letter, was);
          } else if (c.type === "open") {
            owed.pids.set(String(c["pid"]), was);
          }
        }

        ended.add(was);
      }

      if (is !== null) {
        ended.delete(is);
      }

      if (online(next) && (!online(prev) || prev.link["dial"] !== next.link["dial"])) {
        const dial = next.link["dial"];

        for (const [letter, from] of owed.letters) {
          const again = kinds(calls, "send").filter((c) => c["letter"] === letter);

          if (again.length !== 1 || again[0]?.dial !== dial) {
            return `${letter}, unanswered when dial ${String(from)} ended, was written ${again.length} time(s) as dial ${String(dial)} went online (on ${JSON.stringify(again.map((c) => c.dial))})`;
          }
        }

        for (const [pid, from] of owed.pids) {
          const again = kinds(calls, "open").filter((c) => c["pid"] === pid);

          if (again.length !== 1 || again[0]?.dial !== dial) {
            return `the open of ${pid}, unanswered when dial ${String(from)} ended, was written ${again.length} time(s) as dial ${String(dial)} went online`;
          }
        }

        owed.letters.clear();
        owed.pids.clear();
      }

      flight = step.flight;
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

    for (const { prev, msg, next, cmds, calls, call } of steps) {
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const replies = records.filter((r): r is Extract<ClientRecord, { _tag: "reply" }> => r._tag === "reply");
      const letter = call?.type === "send" ? String(call["letter"]) : undefined;
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

      // The ms of a reply kept on a send's answer is the one the socket runner put on it (A8, A13).
      if (msg.type === "send_ok") {
        const took = msg["ms"];

        for (const r of replies) {
          if (r.ms !== took) {
            return `the answer for ${String(letter)} carried ms ${String(took)}, its reply says ${String(r.ms)}`;
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
const readLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>, loaded?: Model) => {
  const { outside, answers, brain } = cells(pids);
  return guided(
    m,
    layout,
    {
      outside: { ...outside, seen: fc.record({ type: fc.constant("seen"), rev: fc.nat(20) }) },
      answers,
      brain,
    } as never,
    { maxLength: 70, ...(loaded === undefined ? {} : { loaded }) },
  );
};

type Lists = (
  m: Machine,
  layout: Tree,
  pids: ReadonlyArray<string>,
  loaded?: Model,
) => fc.Arbitrary<ReadonlyArray<Msg>>;

/** A14: lists where a dial goes online and hands over its opens, then, for each pid, its view
 *  notices and its open's answer come in a drawn order: the notices first (an open's late answer),
 *  the answer first, or no answer. Then a guided tail of `tail`'s kind from the state the real fold
 *  reached. The blind lists met a notice installing a pid's view before its open's answer about
 *  once in 1,000 runs (tests round 14), and never with a decoder that refuses a negative count. */
const lateLists =
  (tail: Lists): Lists =>
  (m, layout, pids) => {
    const start: ReadonlyArray<Msg> = [{ type: "admitted", dial: 1, ping: 0, ms: 0 }];
    const writes = after(m, layout, start).cmds.filter((c) => c.type === "write");
    const online: ReadonlyArray<Msg> = [
      ...start,
      ...writes.map((c): Msg => ({ type: "write_ok", cmd: c, value: null })),
    ];
    const opens = writes.flatMap((c) => {
      const call = c["call"] as { readonly _tag?: unknown; readonly pid?: unknown } | undefined;
      return call?._tag === "open" ? [{ pid: String(call.pid), id: c["id"] }] : [];
    });
    const note = fc.oneof(
      fc.record({
        type: fc.constant("whole"),
        rev: fc.nat(6),
        view: fc.record({ count: fc.integer({ min: -3, max: 5 }) }),
      }),
      fc.nat(6).map((base) => ({
        type: "patch",
        base,
        rev: base + 1,
        patch: [{ op: "replace", path: "/count", value: base + 1 }],
      })),
    );
    const each = fc.record({
      order: fc.constantFrom("notices first", "answer first", "no answer"),
      notes: fc.array(note, { minLength: 1, maxLength: 3 }),
      rev: fc.nat(6),
      count: fc.integer({ min: -3, max: 3 }),
    });
    return fc.tuple(...opens.map(() => each)).chain((drawn) => {
      const prefix: Array<Msg> = [...online];

      for (const [k, open] of opens.entries()) {
        const d = drawn[k] as (typeof drawn)[number];
        const answer: Msg = {
          type: "open_ok",
          id: open.id,
          dial: 1,
          value: { rev: d.rev, view: { count: d.count } },
          ms: 0,
        };
        const notices = d.notes.map((n): Msg => ({ type: "view", pid: open.pid, note: n }));
        prefix.push(
          ...(d.order === "notices first"
            ? [...notices, answer]
            : d.order === "answer first"
              ? [answer, ...notices]
              : notices),
        );
      }

      return tail(m, layout, pids, after(m, layout, prefix).state).map((t) => [...prefix, ...t]);
    });
  };

/** A14: the `open_ok` steps of a run that come after a view notice installed their pid's view while
 *  that open was in flight, so on its dial. The brain publishes the open's own whole before it
 *  answers, so such an answer is never newer than that notice: it is stale. Whether a notice
 *  installed is the client machine's own step from the window's client before it (the client law
 *  holds the two equal); the client installs by replacing the pid's shown view. */
const lateOpens = (cm: ClientMachine, steps: ReadonlyArray<Step>): ReadonlySet<Step> => {
  const late = new Set<Step>();
  const beaten = new Set<string>();
  let flight: ReadonlyArray<Call> = [];

  for (const step of steps) {
    const { prev, msg, call } = step;

    if (msg.type === "open_ok" && call !== null && beaten.has(wire(call.dial, call.id))) {
      late.add(step);
    }

    if (msg.type === "view") {
      const pid = String(msg["pid"]);
      const [client]: readonly [Model["client"], ReadonlyArray<Cmd>] = applyCell(
        cm as never,
        prev.client as never,
        {
          type: "notice",
          pid,
          note: msg["note"],
        } as never,
      ) as never;
      const now = client.views[pid];

      if (now !== undefined && now !== prev.client.views[pid]) {
        for (const c of flight.filter((x) => x.type === "open" && x["pid"] === pid)) {
          beaten.add(wire(c.dial, c.id));
        }
      }
    }

    flight = step.flight;
  }

  return late;
};

/** The client's Msg for one window step, or null when the window does not move its client. An
 *  answer counts only for the write it is in flight for (A13): an `open_ok` only on the dial that is
 *  online now and only when no notice installed its pid's view first (`late`, A14), a `send_ok` with
 *  the letter its write carried. */
const clientMsg = ({ prev, msg, call }: Pick<Step, "prev" | "msg" | "call">, late: boolean): Msg | null => {
  const cmd = msg["cmd"] as { readonly n?: number } | undefined;

  if (msg.type === "open_ok") {
    const current = call !== null && !late && online(prev) && prev.link["dial"] === call.dial;
    return current ? { type: "notice", pid: call["pid"], note: { type: "whole", ...(msg["value"] as object) } } : null;
  }

  if (msg.type === "send_ok") {
    return call === null ? null : { type: "reply", letter: call["letter"], answer: msg["value"] };
  }

  return msg.type === "press"
    ? { type: "press", pid: msg["pid"], m: msg["m"] }
    : msg.type === "now_ok"
      ? { type: "dated", n: cmd?.n, ...(msg["value"] as object) }
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
    const run = traced(steps);
    const late = lateOpens(cm, run);

    for (const step of run) {
      const { msg, next } = step;
      const own = clientMsg(step, late.has(step));

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

// A14: an open's late answer never rolls the view back. On one dial, once a view notice installs a
// view for a pid, that pid's open leaves flight, so its later `open_ok` is stale: the brain published
// the open's own whole before it answered, so the answer is never newer than that notice. Build round
// 6 found it as the lead's run-5 loss: a patch to N+1 came before the open's answer at N, the answer
// installed N, and the count stayed one short.
const LATE_OPEN =
  "A14 late open: on one dial, an open_ok that comes after a notice installed its pid's view changes no shown view and keeps no view row";

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
  (step: Pick<Step, "prev" | "msg" | "call">, late: boolean): Viewed => {
    const { prev } = step;
    const own = clientMsg(step, late);

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
    const run = traced(steps);
    const late = lateOpens(cm, run);

    for (const step of run) {
      const { prev, msg, cmds } = step;
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const v = seen(step, late.has(step));
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
    const run = traced(steps);
    const late = lateOpens(cm, run);

    for (const step of run) {
      const { prev, msg, next, cmds } = step;
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      const v = seen(step, late.has(step));
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
  // Each `open_ok` that comes after a notice installed its pid's view, on the dial the open is in
  // flight on, leaves every shown view as it was and keeps no view row.
  [LATE_OPEN]: (cm) => (steps) => {
    const run = traced(steps);

    for (const step of lateOpens(cm, run)) {
      const { prev, msg, next, cmds } = step;
      const records = recordsIn(cmds);

      if (typeof records === "string") {
        return records;
      }

      if (JSON.stringify(next.client.views) !== JSON.stringify(prev.client.views)) {
        return `a late open_ok ${JSON.stringify(msg["value"])} for ${String(step.call?.["pid"])} moved the shown views from ${JSON.stringify(prev.client.views)} to ${JSON.stringify(next.client.views)}`;
      }

      const rows = viewRows(records);

      if (rows.length > 0) {
        return `a late open_ok ${JSON.stringify(msg["value"])} kept ${JSON.stringify(rows)}`;
      }
    }

    return null;
  },
};

/** The laws that also run on the settings lists (A15, A16): a failed read and the resend ticks that
 *  ask it again lose no letter, and every dial sends and opens as any other. */
const SETTINGS_RUNS: ReadonlySet<string> = new Set([
  "p1: a letter is never lost, written counts presses, ids never repeat",
  "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
  "p4: every distinct pid of the layout opens once per dial, and a new dial opens again",
]);

const fold = async (
  m: Machine,
  layout: Tree,
  tiles: ReadonlyArray<string>,
  name: string,
  over?: (m: Machine) => Machine,
): Promise<void> => {
  const used = over === undefined ? m : over(m);
  const law = ((steps: ReadonlyArray<Folded>) => laws[name]?.(traced(steps), tiles) ?? null) as never;
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

  // A15, A16: p1, p2 and p4 also run on lists where a settings read fails and is asked again.
  if (SETTINGS_RUNS.has(name)) {
    propertyTrace(used as never, { layout } as never, settingsLists(m, layout, tiles) as never, law, opts);
  }

  // The resend law also runs on lists that each end a dial with letters and opens unanswered.
  if (name === RESEND) {
    propertyTrace(used as never, { layout } as never, owedLists(m, layout, tiles) as never, law, opts);
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

  it("good thing: the runs press, date, go online, send, settle, reconnect and open again, and persist; writes fail and stale answers come (A13)", async () => {
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
      manyAtOnce: 0,
      failedWrite: 0,
      stale: 0,
      staleOfEndedDial: 0,
    };

    for (const [, layout, tiles] of LAYOUTS) {
      propertyTrace(
        m as never,
        { layout } as never,
        lists(m, layout, tiles) as never,
        ((folded: ReadonlyArray<Folded>) => {
          let dials = 0;

          for (const { prev, msg, next, cmds, calls, stale } of traced(folded)) {
            seen.failedWrite += msg.type === "write_err" ? 1 : 0;
            seen.stale += stale ? 1 : 0;
            seen.staleOfEndedDial += stale && msg["dial"] !== openDial(prev) ? 1 : 0;

            if (online(next) && !online(prev) && kinds(calls, "send").length > 1) {
              seen.manyAtOnce++;
            }

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

  it("good thing: the resend law's runs end a dial with a send and an open in flight, go online again, and hear late answers to them (A13)", async () => {
    const m = await machine();
    const seen = { owedSend: 0, owedOpen: 0, resent: 0, reopened: 0, lateToOwed: 0 };

    for (const [, layout, tiles] of LAYOUTS) {
      for (const made of [lists, linkLists, owedLists]) {
        propertyTrace(
          m as never,
          { layout } as never,
          made(m, layout, tiles) as never,
          ((folded: ReadonlyArray<Folded>) => {
            const owed = new Set<string>();
            const owedBy = { send: 0, open: 0 };
            let flight: ReadonlyArray<Call> = [];

            for (const { prev, msg, next, calls, flight: after } of traced(folded)) {
              const was = openDial(prev);

              if (ANSWERS.has(msg.type) && owed.has(wire(msg["dial"], msg["id"]))) {
                seen.lateToOwed++;
              }

              if (was !== null && was !== openDial(next)) {
                for (const c of flight.filter((x) => x.dial === was)) {
                  owed.add(wire(c.dial, c.id));
                  owedBy.send += c.type === "send" ? 1 : 0;
                  owedBy.open += c.type === "open" ? 1 : 0;
                }
              }

              if (online(next) && !online(prev) && owedBy.send + owedBy.open > 0) {
                seen.owedSend += owedBy.send;
                seen.owedOpen += owedBy.open;
                seen.resent += owedBy.send > 0 && calls.some((c) => c.type === "send") ? 1 : 0;
                seen.reopened += owedBy.open > 0 && calls.some((c) => c.type === "open") ? 1 : 0;
                owedBy.send = 0;
                owedBy.open = 0;
              }

              flight = after;
            }

            return null;
          }) as never,
          { ...opts, numRuns: 150 } as never,
        );
      }
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

            for (const { prev, msg, next, calls, call } of traced(folded)) {
              const letter = call?.type === "send" ? String(call["letter"]) : undefined;

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
        // A14: also on lists where a notice installs a pid's view before its open's answer, and after.
        propertyTrace(
          m as never,
          { layout } as never,
          lateLists(readLists)(m, layout, tiles) as never,
          clientFold(cm) as never,
          opts as never,
        );
      }
    });
  }
});

// Review 1, A (p17 and p5): a brain call in flight never holds the window. The brain hangs: no
// answer comes to any call the window wrote (its `send`, `open` and `knock` writes, A13) or to the
// link's `ping`, and the only Msgs that still arrive are the window's own timer Sub's (tea's
// built-in `timer`, deps read from the machine as its runtime reads them) and each write's own
// settle, `write_ok`, at once: a write never waits for the brain. tea's run loop runs a step's Cmds
// one at a time and folds nothing until each settles (tea's ADR 0018), so a brain call asked as a
// Cmd that waits for its answer holds every Msg behind it, the timers' included: the window sits
// still. From any state the generated runs reach, an online link leaves `online` within the
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
 *  the calls unanswered at the start: a write by its call's type, a call asked as a Cmd by `asCmd`.
 *  Each write the hang's steps emit settles at once with `write_ok`, as its handler hands the frame
 *  over and returns; nothing else answers. */
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

  // A write settles at once: the window takes the settle of every write it may emit.
  if (!acceptedTypes(m as never, start as never).includes("write_ok")) {
    return `the window in ${was} takes no write_ok, so a write it emits cannot settle at once (A13)`;
  }

  let s = start;
  let waited = 0;
  let knocks = 0;
  const flight = new Set(inFlight);
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
    let [after, cmds] = step(s, next.msg, { layout });

    // The step's Cmds, and those of each write's settle in turn, a bounded number deep.
    for (let depth = 0; cmds.length > 0 && depth < 8; depth++) {
      const more: Array<Cmd> = [];

      for (const c of cmds) {
        if (CALLS.has(c.type)) {
          flight.add(asCmd(c.type));
        }

        const call = writesIn([c])[0];

        if (call === undefined) {
          continue;
        }

        flight.add(call.type);
        knocks += call.type === "knock" ? 1 : 0;
        const settled = step(after, { type: "write_ok", cmd: c, value: null }, { layout });
        after = settled[0];
        more.push(...settled[1]);
      }

      cmds = more;
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

  // A knock is a write; a grant wait that knocked again and again wrote more than one, unanswered.
  if (knocks > 1) {
    seen["a grant wait kept knocking with a knock in flight"] = 1;
  }

  return null;
};

/** The hang law over a run: from each state it reaches, a hang with what is in flight there. The
 *  calls in flight are each write in flight (A13), and each brain call asked as a Cmd that no
 *  `<type>_ok` or `<type>_err` carrying it has answered yet. */
const hangLaw =
  (layout: Tree, m: Machine, seen: Record<string, number>) =>
  (steps: ReadonlyArray<Folded>): string | null => {
    const asked = new Map<string, string>();

    for (const { msg, cmds, next, flight } of traced(steps)) {
      const answered = (msg["cmd"] as object | undefined) && JSON.stringify(msg["cmd"]);

      if (answered !== undefined) {
        asked.delete(answered);
      }

      for (const c of cmds) {
        if (CALLS.has(c.type)) {
          asked.set(JSON.stringify(c), asCmd(c.type));
        }
      }

      const why = hang(m, layout, next, new Set([...asked.values(), ...flight.map((c) => c.type)]), seen);

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
        hangLaw(layout, m, seen) as never,
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

  it("format: a write settles at once: its ok is the frame handed over, never the brain's answer (A13)", async () => {
    // reason: format, the `write` Cmd's settle is what tea folds right after its handler returns; a
    // write whose ok were a `Sent` or a view would be a Cmd that waits for the brain.
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const { write } = (await import("./machine.ts")) as unknown as {
      write?: { readonly schema: { readonly ok: Schema.Codec<unknown, unknown> } };
    };
    expect(write, "window/machine.ts exports its write Cmd").toBeDefined();
    const ok = (value: unknown) => Result.isSuccess(Schema.decodeUnknownResult(write!.schema.ok)(value));
    expect(ok(null) || ok(undefined), "a handed-over frame settles with nothing").toBe(true);
    expect(ok({ _tag: "accepted", rev: 1, pos: 1 })).toBe(false);
    expect(ok({ rev: 1, view: { count: 0 } })).toBe(false);
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
  type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  /** The real machine with each step's output changed, or with some Msgs no longer taken. */
  const wrapped = (
    real: Machine,
    change: (out: readonly [Model, ReadonlyArray<Cmd>], state: Model) => readonly [Model, ReadonlyArray<Cmd>],
    drop: ReadonlySet<string> = new Set(),
  ): Machine => {
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const update = (real as unknown as { update: Record<string, Update> }).update;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the plant keeps the real machine and wraps its update; the cast names it a Machine again
    return {
      ...real,
      update: Object.fromEntries(
        Object.entries(update)
          .filter(([type]) => !drop.has(type))
          .map(([type, f]) => [type, (state: Model, msg: Msg, ctx: object) => change(f(state, msg, ctx), state)]),
      ),
    } as unknown as Machine;
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
  it("a send asked as a Cmd, which tea's loop waits on, is caught (hang, A13)", async () => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // The window also asks a send as a Cmd each time it comes online, as it did before A13.
    const planted = wrapped(real, ([m, c], state) =>
      !online(state) && online(m)
        ? [m, [...c, { type: "send", pid: A, letter: "x", n: 0, dial: m.link["dial"] }]]
        : [m, c],
    );
    expect(() =>
      propertyTrace(
        planted as never,
        { layout } as never,
        pingLists(real, layout, tiles) as never,
        hangLaw(layout, planted, {}) as never,
        opts as never,
      ),
    ).toThrow(/tea folds nothing while .*send Cmd/);
  });
  it("a write whose settle the window does not take is caught (hang, A13)", async () => {
    const real = await machine();
    const [, layout] = LAYOUTS[0] as (typeof LAYOUTS)[number];
    const waiting = after(real, layout, [GRANT[0] as Msg]).state;
    const planted = wrapped(real, (out) => out, new Set(["write_ok"]));
    expect(hang(planted, layout, waiting, new Set(), {})).toMatch(/takes no write_ok/);
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
          // A14: also on lists where a notice installs a pid's view before its open's answer, and after.
          propertyTrace(
            m as never,
            { layout } as never,
            lateLists(viewLists)(m, layout, tiles) as never,
            law as never,
            opts,
          );

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
    const cm = await clientMachineFor(checks);
    const seen = viewed(cm);
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

            const run = traced(steps);
            const late = lateOpens(cm, run);

            for (const step of run) {
              const { prev, msg, next } = step;
              const outcome = linkOutcome(prev, msg, next);

              if (outcome !== null) {
                met[outcome]++;
              }

              if (msg.type === "send_ok" && step.call !== null && typeof msg["ms"] === "number") {
                met.measuredReply++;
              }

              const v = seen(step, late.has(step));

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

  // A decoder that throws installs no view, so with it no notice can beat an open: the case is not
  // there to meet.
  it("good thing: the client and view laws' runs meet, on one dial, a notice installing a pid's view before its open's answer, and an open answered first, with each set of checks that installs (A14)", async () => {
    for (const [named, checks] of CHECKS.filter(([n]) => n !== "a decoder that throws")) {
      const m = await machine(checks);
      const cm = await clientMachineFor(checks);
      const seen = viewed(cm);

      for (const [label, made] of [
        ["client law", [readLists, lateLists(readLists)]],
        ["view laws", [viewLists, lateLists(viewLists)]],
      ] as const) {
        const met = { noticeFirst: 0, answerFirst: 0 };

        for (const [, layout, tiles] of LAYOUTS) {
          for (const list of made) {
            propertyTrace(
              m as never,
              { layout } as never,
              list(m, layout, tiles) as never,
              ((steps: ReadonlyArray<Folded>) => {
                const run = traced(steps);
                const late = lateOpens(cm, run);
                met.noticeFirst += late.size;

                for (const step of run) {
                  met.answerFirst +=
                    step.msg.type === "open_ok" && !late.has(step) && seen(step, false).whole !== null ? 1 : 0;
                }

                return null;
              }) as never,
              opts as never,
            );
          }
        }

        for (const [name, n] of Object.entries(met)) {
          expect(n, `${name} (${label}, ${named})`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("pinned: the lead's run-5 loss (A14): a patch at N+1 then the open's late answer at N shows N+1, and every view law holds", async () => {
    const m = await machine();
    const cm = await clientMachineFor(NO_CHECKS);
    const [, layout] = LAYOUTS[0] as (typeof LAYOUTS)[number];
    const { list, answered } = runFiveLoss(m, layout);
    expect(answered, "going online writes the open of process_a").toBe(true);
    expect(after(m, layout, list).state.client.views[A]?.rev).toBe(6);

    for (const law of [clientFold(cm), ...Object.values(viewLaws).map((l) => l(cm))]) {
      propertyTrace(m as never, { layout } as never, fc.constant(list) as never, law as never, { numRuns: 1 });
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
  /** A write a plant adds, with an id no real write has on its dial. */
  const write = (call: Readonly<Record<string, unknown>>, dial: unknown, id: number): Cmd => ({
    type: "write",
    call,
    id: 2_000_000 + id,
    dial,
  });
  const expectCaught = async (name: string, change: Parameters<typeof broken>[1], layoutAt = 2): Promise<void> => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[layoutAt] as (typeof LAYOUTS)[number];
    const planted = broken(real, change);
    expect(() => {
      propertyTrace(
        planted as never,
        { layout } as never,
        // A persist plant breaks the answer, so its lists always reach a new grant (folded by the planted machine).
        (GRANTED_LAWS.has(name)
          ? grantedLists(planted, layout, tiles)
          : name === RESEND
            ? owedLists(real, layout, tiles)
            : LINK_LAWS.has(name)
              ? linkLists(real, layout, tiles)
              : lists(real, layout, tiles)) as never,
        ((steps: ReadonlyArray<Folded>) => laws[name]?.(traced(steps), tiles) ?? null) as never,
        opts as never,
      );
    }).toThrow();
  };
  /** The letter the write a Msg answers carried, read from the window before the Msg: the letter
   *  whose send is the oldest out (a plant has no trace). */
  const oldestOut = (s: Model, msg: Msg): string | undefined =>
    msg.type === "send_ok" || msg.type === "send_err"
      ? s.client.pending.find((p) => p._tag === "ready")?.letter
      : undefined;
  it("clearing the queue on any answer is caught (p1)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], _s, msg) =>
      msg.type === "send_err" ? [{ ...m, client: { ...m.client, pending: [] } }, c] : [m, c],
    ));
  it("settling a letter on an answer the client cannot read is caught (p1)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], s, msg) =>
      msg.type === "send_err" && (msg["error"] as { _tag: string })._tag === "unknown"
        ? [
            {
              ...m,
              client: {
                ...m.client,
                pending: m.client.pending.filter((p) => p.letter !== oldestOut(s, msg)),
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
  it("settling a letter on its write's settle, the frame handed over, is caught (p1, A13)", () =>
    expectCaught("p1: a letter is never lost, written counts presses, ids never repeat", ([m, c], _s, msg) => {
      const call = (msg["cmd"] as { call?: { _tag?: string; letter?: string } } | undefined)?.call;
      return msg.type === "write_ok" && call?._tag === "send"
        ? [{ ...m, client: { ...m.client, pending: m.client.pending.filter((p) => p.letter !== call.letter) } }, c]
        : [m, c];
    }));
  // A13: the p2 and p4 plants change the writes a step emits, as the build's update would.
  const P2 = "p2: what waited goes out: online sends every ready letter once in order, offline sends nothing";
  const P4 = "p4: every distinct pid of the layout opens once per dial, and a new dial opens again";
  /** The step's Cmds with its writes of `tag` changed by `edit`. */
  const writes = (c: ReadonlyArray<Cmd>, tag: string, edit: (w: ReadonlyArray<Cmd>) => ReadonlyArray<Cmd>) => {
    const isTag = (x: Cmd) => x.type === "write" && (x["call"] as { _tag?: string } | undefined)?._tag === tag;
    return [...c.filter((x) => !isTag(x)), ...edit(c.filter(isTag))];
  };
  it("sending while offline is caught (p2)", () =>
    expectCaught(P2, ([m, c], _s, msg) => {
      const ready = m.client.pending.find((p) => p.letter !== undefined);
      return msg.type === "press" && !online(m) && ready !== undefined
        ? [
            m,
            [
              ...c,
              write(
                { _tag: "send", pid: ready.pid, letter: ready.letter, n: ready.n },
                m.link["dial"],
                m.client.written,
              ),
            ],
          ]
        : [m, c];
    }));
  it("skipping the resend on coming online is caught (p2)", () =>
    expectCaught(P2, ([m, c], s) => (!online(s) && online(m) ? [m, writes(c, "send", () => [])] : [m, c])));
  it("capping the letters written as the link comes online is caught (p2, A13)", () =>
    expectCaught(P2, ([m, c], s) => (!online(s) && online(m) ? [m, writes(c, "send", (w) => w.slice(0, 1))] : [m, c])));
  it("reversing two letters is caught (p2 and now)", () =>
    expectCaught(P2, ([m, c]) => [m, writes(c, "send", (w) => [...w].reverse())]));
  it("asking a send as a Cmd beside its write is caught (p2, A13)", () =>
    expectCaught(P2, ([m, c], s) =>
      !online(s) && online(m) ? [m, [...c, { type: "send", pid: A, letter: "x", n: 0, dial: m.link["dial"] }]] : [m, c],
    ));
  it("an answer of an ended dial, or to an id never written, that still settles a letter is caught (p2, A13)", () =>
    expectCaught(P2, ([m, c], s, msg) => {
      // Where the real window does nothing with a send's answer, the plant settles the oldest ready letter.
      const letter = oldestOut(s, msg);
      return msg.type === "send_ok" && JSON.stringify(m) === JSON.stringify(s) && letter !== undefined
        ? [{ ...m, client: { ...m.client, pending: m.client.pending.filter((p) => p.letter !== letter) } }, c]
        : [m, c];
    }));
  it("writing two calls with one id on one dial is caught (p2, A13)", () =>
    expectCaught(P2, ([m, c], s) =>
      !online(s) && online(m) ? [m, writes(c, "send", (w) => w.map((x) => ({ ...x, id: w[0]?.["id"] })))] : [m, c],
    ));
  it("keeping opened after a reconnect is caught (p4)", () =>
    expectCaught(
      P4,
      // The first dial that came online is kept on the model; a later dial opens nothing again.
      ([m, c], s) =>
        !online(s) && online(m)
          ? (s as { readonly first?: unknown }).first === undefined
            ? [{ ...m, first: m.link["dial"] } as Model, c]
            : [m, writes(c, "open", () => [])]
          : [m, c],
    ));
  it("opening a view when a press is made is caught (p4)", () =>
    expectCaught(P4, ([m, c], _s, msg) =>
      msg.type === "press" && online(m)
        ? [m, [...c, write({ _tag: "open", pid: A }, m.link["dial"], m.client.written)]]
        : [m, c],
    ));
  it("asking an open as a Cmd beside its write is caught (p4, A13)", () =>
    expectCaught(P4, ([m, c], s) =>
      !online(s) && online(m) ? [m, [...c, { type: "open", pid: A, dial: m.link["dial"] }]] : [m, c],
    ));
  it("a stale open answer that still moves the window is caught (p4, A13)", () =>
    expectCaught(P4, ([m, c], s, msg) =>
      (msg.type === "open_ok" || msg.type === "open_err") && JSON.stringify(m) === JSON.stringify(s)
        ? [{ ...m, client: { ...m.client, views: { ...m.client.views, [A]: { rev: 99 } } } }, c]
        : [m, c],
    ));
  // A13 resend: each plant breaks one part of "stays in the Model, written once on the next dial,
  // a late answer does nothing". A plant has no trace, so it keeps on the Model, as `first` above
  // does, the letters it saw written and whether a dial went online before.
  type Marked = Model & { readonly wrote?: ReadonlyArray<string>; readonly wasOnline?: boolean };
  const sentLetter = (x: Cmd): string => String((x["call"] as { letter?: unknown } | undefined)?.letter);
  /** A plant that sees the letters written before this step (`before`), and marks the Model with
   *  every letter its own Cmds write and whether it is online. */
  const remembering =
    (
      change: (
        out: readonly [Model, ReadonlyArray<Cmd>],
        s: Marked,
        before: ReadonlySet<string>,
      ) => readonly [Model, ReadonlyArray<Cmd>],
    ): Parameters<typeof broken>[1] =>
    (out, state) => {
      const s = state as Marked;
      const before = new Set(s.wrote ?? []);
      const [m, c] = change(out, s, before);
      const wrote = [...before, ...writesIn(c).flatMap((x) => (x.type === "send" ? [String(x["letter"])] : []))];
      return [{ ...m, wrote: [...new Set(wrote)], wasOnline: (s.wasOnline ?? false) || online(m) } as Model, c];
    };
  const goingOnline = (s: Model, m: Model): boolean => !online(s) && online(m);
  it("not writing again, on the next dial, a letter written on an earlier one is caught (A13 resend)", () =>
    expectCaught(
      RESEND,
      remembering(([m, c], s, before) =>
        goingOnline(s, m) ? [m, writes(c, "send", (w) => w.filter((x) => !before.has(sentLetter(x))))] : [m, c],
      ),
    ));
  it("writing an owed letter twice as the next dial goes online is caught (A13 resend)", () =>
    expectCaught(
      RESEND,
      remembering(([m, c], s, before) =>
        goingOnline(s, m)
          ? [
              m,
              writes(c, "send", (w) => [
                ...w,
                ...w.filter((x) => before.has(sentLetter(x))).map((x, k) => ({ ...x, id: 3_000_000 + k })),
              ]),
            ]
          : [m, c],
      ),
    ));
  it("writing an owed letter on the ended dial, not the new one, is caught (A13 resend)", () =>
    expectCaught(
      RESEND,
      remembering(([m, c], s, before) =>
        goingOnline(s, m)
          ? [
              m,
              writes(c, "send", (w) =>
                w.map((x) => (before.has(sentLetter(x)) ? { ...x, dial: Number(x["dial"]) - 1 } : x)),
              ),
            ]
          : [m, c],
      ),
    ));
  it("not opening again, on the next dial, a view whose open had no answer is caught (A13 resend)", () =>
    expectCaught(
      RESEND,
      remembering(([m, c], s) =>
        goingOnline(s, m) && s.wasOnline === true ? [m, writes(c, "open", () => [])] : [m, c],
      ),
    ));
  it("dropping a letter from the Model when its dial ends is caught (A13 resend)", () =>
    expectCaught(
      RESEND,
      remembering(([m, c], s, before) =>
        online(s) && !online(m)
          ? [
              { ...m, client: { ...m.client, pending: m.client.pending.filter((p) => !before.has(String(p.letter))) } },
              c,
            ]
          : [m, c],
      ),
    ));
  it("keeping an ended dial's calls in flight, so its late answer settles a letter, is caught (A13 resend)", () =>
    // The one plant that names the build's own field: the window's `flight`, which A13 names.
    expectCaught(RESEND, ([m, c], s) => {
      type Flown = Model & { readonly flight: ReadonlyArray<{ readonly dial: unknown }> };
      const was = openDial(s);
      return was !== null && was !== openDial(m)
        ? [
            {
              ...m,
              flight: [...(m as Flown).flight, ...(s as Flown).flight.filter((f) => f.dial === was)],
            } as Model,
            c,
          ]
        : [m, c];
    }));
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
    // A13: a duplicate or stale answer the real window ignores still keeps a sample.
    expectCaught(REPLY_RECORD, ([m, c], s, msg) =>
      msg.type === "send_ok" &&
      (msg["value"] as { _tag: string })._tag === "accepted" &&
      !c.some((x) => x.type === "record" && (x["record"] as ClientRecord)._tag === "reply")
        ? [
            m,
            [
              ...c,
              {
                type: "record",
                record: {
                  _tag: "reply",
                  letter: oldestOut(s, msg) ?? "letter_x",
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
  /** The real machine with each step post-processed by `change`. */
  const plantedFrom = (real: Machine, change: Change): Machine => {
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
  const expectCaught = async (name: string, change: Change): Promise<void> => {
    const [, checks] = CHECKS[2] as (typeof CHECKS)[number];
    const real = await machine(checks);
    const law = (viewLaws[name] as ViewLaw)(await clientMachineFor(checks));
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    const planted = plantedFrom(real, change);
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
  it("installing every open_ok, so a patch at N+1 then a late answer at N shows N, is caught (A14 late open, client law)", async () => {
    // The plant installs every answer to an open written on the dial that is online now, by its
    // write's pid, and keeps its whole row, as the window did before A14.
    const pids = new Map<string, string>();
    const plant: Change = ([m, c], s, msg) => {
      const cmd = msg["cmd"] as { readonly call?: { _tag?: unknown; pid?: unknown }; id?: unknown; dial?: unknown };

      if (msg.type === "write_ok" && cmd.call?._tag === "open") {
        pids.set(wire(cmd.dial, cmd.id), String(cmd.call.pid));
      }

      const pid = pids.get(wire(msg["dial"], msg["id"]));
      const value = msg["value"] as { readonly rev: number; readonly view: unknown };
      return msg.type === "open_ok" && pid !== undefined && online(s) && s.link["dial"] === msg["dial"]
        ? [
            {
              ...m,
              client: { ...m.client, views: { ...m.client.views, [pid]: { rev: value.rev, view: value.view } } },
            },
            [...c, row({ _tag: "view", pid, result: "whole", rev: Math.max(0, value.rev) } as ViewRow)],
          ]
        : [m, c];
    };
    const real = await machine(NO_CHECKS);
    const cm = await clientMachineFor(NO_CHECKS);
    const planted = plantedFrom(real, plant);
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];

    for (const law of [(viewLaws[LATE_OPEN] as ViewLaw)(cm), clientFold(cm)]) {
      expect(() =>
        propertyTrace(
          planted as never,
          { layout } as never,
          lateLists(viewLists)(real, layout, tiles) as never,
          law as never,
          opts as never,
        ),
      ).toThrow();
    }

    const [, one] = LAYOUTS[0] as (typeof LAYOUTS)[number];
    const { list } = runFiveLoss(real, one);
    expect(after(plantedFrom(real, plant), one, list).state.client.views[A]?.rev, "the planted window shows N").toBe(5);
  });
  it("keeping the run's row after its pid's whole row is caught (patch record)", () =>
    expectCaught(PATCH_RECORD, ([m, c]) => {
      const rows = c.filter((x) => x.type === "record" && (x["record"] as ClientRecord)._tag === "view");
      return [m, [...c.filter((x) => !rows.includes(x)), ...rows.reverse()]];
    }));
});

// A15, as A16 changes it: a failed key settings read is a Msg, and it restarts the read, not the
// dial. The runner (main.tsx) reports a failed `ledger.read` or `ledger.wait` on
// `person/<id>/settings` as `settings_failed {dial, reason}` and stops reading on that dial; the
// Model decides what follows. Its `settings` is the read's state per dial, `{_tag: "reading", dial}`
// or `{_tag: "failed", dial, reason}`. On the online dial a failure sets `failed` with its reason
// and leaves the rest of the window as it was: the link stays online on that dial and no Cmd ends
// it, so the socket's own close still reaches the link with its code. The door refuses a removed
// key's calls and then closes 4003 (`door/door.ts:989`), so a 4003 on that dial after the failure
// leaves the link `removed`. The resend timer runs while that read is `failed`; its `resend` for
// that dial asks the Cmd `read_settings {dial}` once and sets `reading`. No other step asks it,
// save the step that goes online, at most once and for its own dial: a resend for another dial,
// or once the dial closed, asks nothing. A dial that goes online reads again, and a later `keys` or
// `keys_failed` while a newer dial's socket is open clears a failure. A `settings_failed` for any
// other dial, or while the link is not online, changes nothing.
const SETTINGS =
  "A16 settings: a failed settings read on the online dial keeps its reason and leaves the link as it was, so a 4003 after it still removes; that dial's next resend asks read_settings once and reads; nothing else asks it; the next dial online reads again; a later keys or keys_failed on a new dial clears it; any other changes nothing";

type Settings = { readonly _tag?: unknown; readonly dial?: unknown; readonly reason?: unknown } | undefined;

/** The Model's settings read state (A15), as the plan's sketch names it. */
const readState = (s: Model): Settings => (s as Model & { readonly settings?: Settings }).settings;

/** The settings read state as text, for the law's message. */
const told = (s: Settings): string => JSON.stringify(s) ?? "undefined";

/** The window with its settings read state left out. */
const besides = (s: Model): string => JSON.stringify({ ...s, settings: null });

/** The `read_settings` Cmds a step asked (A16). */
const readsAsked = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<Cmd> => cmds.filter((c) => c.type === "read_settings");

/** A step's Cmds that may come with a failed read: none but a record that is no link outcome. */
const besidesRecords = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<Cmd> =>
  cmds.filter((c) => !(c.type === "record" && (c["record"] as { _tag?: unknown })?._tag !== "connect"));

/** One more Msg folded by the machine under test, from `s`, as its runner would fold it next. */
const foldNext = (used: Machine, s: Model, msg: Msg): readonly [Model, ReadonlyArray<Cmd>] =>
  applyCell(used as never, s as never, msg as never) as never;

/** Whether a resend on `msg`'s dial is the one that asks the failed read of `s` again. */
const retries = (s: Model, msg: Msg): boolean => {
  const was = readState(s);
  return (
    msg.type === "resend" &&
    online(s) &&
    s.link["dial"] === msg["dial"] &&
    was?._tag === "failed" &&
    was.dial === msg["dial"]
  );
};

/** A resend asked the read once on its dial and set it reading, or why not. */
const askedOnce = (msg: Msg, next: Model, cmds: ReadonlyArray<Cmd>): string | null => {
  const asked = readsAsked(cmds);
  const is = readState(next);

  if (asked.length !== 1 || asked[0]?.["dial"] !== msg["dial"]) {
    return `a resend on dial ${String(msg["dial"])}, whose read failed, asked ${JSON.stringify(asked)}, not one read_settings for it`;
  }

  if (is?._tag !== "reading" || is.dial !== msg["dial"]) {
    return `a resend on dial ${String(msg["dial"])}, whose read failed, left settings ${told(is)}, not reading on it`;
  }

  return null;
};

const settingsLaw =
  (used: Machine) =>
  (steps: ReadonlyArray<Folded>): string | null => {
    const { timers } = parts(used);

    for (const { prev, msg, next, cmds } of steps) {
      const was = readState(prev);
      const is = readState(next);
      const fresh = online(next) && !online(prev);

      // The resend timer runs while the online dial's read is failed (A16).
      if (online(next) && is?._tag === "failed" && is.dial === next.link["dial"]) {
        const ticks = timers(next);

        if (!ticks.some((t) => t?.msg.type === "resend" && t.msg["dial"] === is.dial)) {
          return `the read of the online dial ${String(is.dial)} failed and no resend timer runs for it: ${JSON.stringify(ticks)}`;
        }
      }

      if (retries(prev, msg)) {
        const why = askedOnce(msg, next, cmds);

        if (why !== null) {
          return why;
        }

        continue;
      }

      // No tight loop: nothing else asks the read, save the step that goes online, once, for its dial.
      const asked = readsAsked(cmds);

      if (fresh ? asked.length > 1 || asked.some((c) => c["dial"] !== next.link["dial"]) : asked.length > 0) {
        return `${JSON.stringify(msg)}, while ${prev.link._tag} on ${String(prev.link["dial"])} with settings ${told(was)}, asked ${JSON.stringify(asked)}`;
      }

      if (msg.type === "settings_failed") {
        if (!online(prev) || prev.link["dial"] !== msg["dial"]) {
          if (JSON.stringify(next) !== JSON.stringify(prev) || cmds.length > 0) {
            return `a settings_failed for dial ${String(msg["dial"])}, while ${prev.link._tag} on ${String(prev.link["dial"])}, moved the window or asked ${JSON.stringify(cmds.map((c) => c.type))}`;
          }

          continue;
        }

        if (JSON.stringify(next.link) !== JSON.stringify(prev.link)) {
          return `a settings_failed on the online dial ${String(msg["dial"])} moved the link from ${JSON.stringify(prev.link)} to ${JSON.stringify(next.link)}`;
        }

        if (besides(next) !== besides(prev)) {
          return `a settings_failed on dial ${String(msg["dial"])} changed the window besides its settings read: ${besides(prev)} to ${besides(next)}`;
        }

        if (besidesRecords(cmds).length > 0) {
          return `a settings_failed on dial ${String(msg["dial"])} asked ${JSON.stringify(besidesRecords(cmds))}`;
        }

        if (is?._tag !== "failed" || is.dial !== msg["dial"] || is.reason !== msg["reason"]) {
          return `a settings_failed ${JSON.stringify(msg)} left settings ${told(is)}, not failed with its dial and reason`;
        }

        // The removal order: the door refuses a removed key's read, then closes 4003 on that dial.
        const [removed] = foldNext(used, next, {
          type: "closed",
          dial: msg["dial"],
          code: 4003,
          fingerprint: "SHA256:x",
          ms: 0,
        });

        if (removed.link._tag !== "removed") {
          return `a 4003 close on dial ${String(msg["dial"])} after its settings read failed left the link ${JSON.stringify(removed.link)}, not removed`;
        }

        // The next resend on that dial asks the read once.
        const tick: Msg = { type: "resend", dial: msg["dial"] };
        const [again, againCmds] = foldNext(used, next, tick);
        const why = askedOnce(tick, again, againCmds);

        if (why !== null) {
          return `the next tick after ${JSON.stringify(msg)}: ${why}`;
        }

        // The next dial that goes online reads again: the socket is lost, the link retries and the
        // brain admits its next dial.
        const [lost] = foldNext(used, next, {
          type: "closed",
          dial: msg["dial"],
          code: 1006,
          fingerprint: "SHA256:x",
          ms: 0,
        });
        const [redial] = foldNext(used, lost, {
          type: "retry",
          dial: lost.link["dial"],
          tries: lost.link["tries"] ?? 1,
        });
        const [back] = foldNext(used, redial, { type: "admitted", dial: redial.link["dial"], ping: 0, ms: 0 });
        const read = readState(back);

        if (!online(back) || read?._tag !== "reading" || read.dial !== back.link["dial"]) {
          return `after ${JSON.stringify(msg)}, the socket lost and the next dial admitted left ${JSON.stringify(back.link)} with settings ${told(read)}, not reading on it`;
        }

        continue;
      }

      if (fresh) {
        if (is?._tag !== "reading" || is.dial !== next.link["dial"]) {
          return `going online on dial ${String(next.link["dial"])} left settings ${told(is)}, not reading on that dial`;
        }

        continue;
      }

      if (was?._tag !== "failed") {
        continue;
      }

      const open = openDial(prev);

      if ((msg.type === "keys" || msg.type === "keys_failed") && open !== null && open !== was.dial) {
        if (is?._tag === "failed") {
          return `${msg.type} on dial ${String(open)} kept the failed read of dial ${String(was.dial)}: ${told(is)}`;
        }

        continue;
      }

      if (JSON.stringify(is) !== JSON.stringify(was)) {
        return `${msg.type} moved the failed read ${told(was)} to ${told(is)} before a new dial went online or its resend`;
      }
    }

    return null;
  };

describe("window machine: a failed key settings read is a Msg that restarts the read, not the dial (A15, A16)", () => {
  for (const [label, layout, tiles] of LAYOUTS) {
    it(`${SETTINGS} (${label})`, async () => {
      const m = await machine();
      propertyTrace(
        m as never,
        { layout } as never,
        settingsLists(m, layout, tiles) as never,
        settingsLaw(m) as never,
        opts,
      );
    });
  }

  it("good thing: the settings runs fail a read on the online dial and on a stale one, tick it again on its dial, on another and after its close, and clear one by keys on a new dial", async () => {
    const m = await machine();
    const seen = {
      current: 0,
      staleOnline: 0,
      staleOffline: 0,
      retried: 0,
      tickElsewhere: 0,
      tickAfterClose: 0,
      cleared: 0,
    };

    for (const [, layout, tiles] of LAYOUTS) {
      propertyTrace(
        m as never,
        { layout } as never,
        settingsLists(m, layout, tiles) as never,
        ((folded: ReadonlyArray<Folded>) => {
          for (const { prev, msg } of folded) {
            const was = readState(prev);

            if (msg.type === "settings_failed") {
              const current = online(prev) && prev.link["dial"] === msg["dial"];
              seen.current += current ? 1 : 0;
              seen.staleOnline += online(prev) && !current ? 1 : 0;
              seen.staleOffline += online(prev) ? 0 : 1;
            }

            if (msg.type === "resend" && was?._tag === "failed") {
              const mine = was.dial === msg["dial"];
              seen.retried += retries(prev, msg) ? 1 : 0;
              seen.tickElsewhere += !mine ? 1 : 0;
              seen.tickAfterClose += mine && openDial(prev) !== was.dial ? 1 : 0;
            }

            if (
              (msg.type === "keys" || msg.type === "keys_failed") &&
              was?._tag === "failed" &&
              openDial(prev) !== null &&
              openDial(prev) !== was.dial
            ) {
              seen.cleared++;
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

  // Plants. A15's two: the window ignores the Msg (nothing shows the failure, and nothing asks the
  // read again), and it acts on a stale dial's Msg as if it were the online one's. A16's four: it
  // ends the dial on a failed read, as A15 built it (the removed-key loss: the 4003 that follows
  // is stale and the link is not removed); it never asks the read again; it asks it on every Msg
  // rather than once per tick; it asks it on a tick after the dial closed. Each wraps the real
  // update; the law must hold on the real machine first, so a plant is caught for its break, not
  // for a missing handler.
  type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
  type Updates = Readonly<Record<string, Update>>;
  const planted = (real: Machine, change: (update: Updates) => Updates): Machine => {
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const update = (real as unknown as { update: Updates }).update;
    // oxlint-disable-next-line fabrika/no-type-assertions -- the plant keeps the real machine and swaps handlers; the cast names it a Machine again
    return { ...real, update: { ...update, ...change(update) } } as unknown as Machine;
  };
  const expectCaught = async (change: (update: Updates) => Updates): Promise<void> => {
    const real = await machine();
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    const run = (used: Machine) => () =>
      propertyTrace(
        used as never,
        { layout } as never,
        settingsLists(real, layout, tiles) as never,
        settingsLaw(used) as never,
        opts,
      );
    expect(run(real), "the law holds on the real window").not.toThrow();
    expect(run(planted(real, change))).toThrow();
  };
  const none: Update = (x) => [x, []];

  it("ignoring a failed settings read, so nothing shows it and nothing asks it again, is caught (A15)", () =>
    expectCaught(() => ({ settings_failed: (s) => [s, []] })));
  it("acting on a stale dial's failed settings read is caught (A15)", () =>
    expectCaught((update) => ({
      settings_failed: (s, msg, ctx) => {
        const own = update["settings_failed"] ?? none;
        return online(s) && s.link["dial"] !== msg["dial"]
          ? own(s, { ...msg, dial: s.link["dial"] }, ctx)
          : own(s, msg, ctx);
      },
    })));
  it("ending the dial on a failed read, as A15 built it, so the 4003 after it is stale and the link is not removed, is caught (A16)", () =>
    expectCaught((update) => ({
      settings_failed: (s, msg, ctx) => {
        if (!online(s) || s.link["dial"] !== msg["dial"]) {
          return [s, []];
        }

        const lost: Msg = { type: "closed", dial: msg["dial"], code: 1006, fingerprint: "", ms: 0 };
        const [next, cmds] = (update["closed"] ?? none)(s, lost, ctx);
        return [
          Object.assign({}, next, { settings: { _tag: "failed", dial: msg["dial"], reason: msg["reason"] } }),
          cmds,
        ];
      },
    })));
  it("never asking a failed settings read again is caught (A16)", () =>
    expectCaught((update) => ({
      resend: (s, msg, ctx) => {
        const [next, cmds] = (update["resend"] ?? none)(s, msg, ctx);
        return [Object.assign({}, next, { settings: readState(s) }), cmds.filter((c) => c.type !== "read_settings")];
      },
    })));
  it("asking the settings read on every Msg rather than once per tick is caught (A16)", () =>
    expectCaught((update) =>
      Object.fromEntries(
        Object.entries(update).map(([type, own]) => [
          type,
          ((s, msg, ctx) => {
            const [next, cmds] = own(s, msg, ctx);
            return online(next) && readsAsked(cmds).length === 0
              ? [next, [...cmds, { type: "read_settings", dial: next.link["dial"] }]]
              : [next, cmds];
          }) satisfies Update,
        ]),
      ),
    ));
  it("asking the settings read on a tick after its dial closed is caught (A16)", () =>
    expectCaught((update) => ({
      resend: (s, msg, ctx) => {
        const [next, cmds] = (update["resend"] ?? none)(s, msg, ctx);
        const was = readState(s);
        return !online(s) && was?._tag === "failed" && was.dial === msg["dial"]
          ? [
              Object.assign({}, next, { settings: { _tag: "reading", dial: msg["dial"] } }),
              [...cmds, { type: "read_settings", dial: msg["dial"] }],
            ]
          : [next, cmds];
      },
    })));
});

describe("window machine: saved state", () => {
  it("stopping at every message and booting from the saved model gives the same run", async () => {
    const m = await machine();
    const { syncTest } = await import("@kampus/libfabrika/testing");
    const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
    // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
    const model = (m as unknown as { model: Schema.Codec<unknown, unknown> }).model;

    // A15, A16: also on runs where a settings read fails and is asked again, so its state saves too.
    for (const made of [lists, settingsLists]) {
      fc.assert(
        fc.property(made(m, layout, tiles), (list) => {
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
    }
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

  it("format: the socket Sub's answers to a send, send_ok and send_err, carry the write's id and dial; send_ok a Sent and the runner's ms", async () => {
    // reason: the reply row's ms is read from it (A8), and an answer finds its call by id and dial
    // (A13); decoded through the machine's own `msg` schema.
    const ok = (value: unknown, ms: unknown = 3) => accepts({ type: "send_ok", id: 7, dial: 3, value, ms });
    expect(await ok({ _tag: "accepted", rev: 4, pos: 2 })).toBe(true);
    expect(await ok({ _tag: "refused", reason: "bad_msg" })).toBe(true);
    expect(await ok({ _tag: "accepted", rev: 4, pos: 2 }, 12.5)).toBe(true);
    expect(await accepts({ type: "send_ok", id: 7, dial: 3, value: { _tag: "accepted", rev: 4, pos: 2 } })).toBe(false);
    expect(await ok({ _tag: "accepted", rev: 4, pos: 2 }, -1)).toBe(false);
    expect(await ok({ _tag: "accepted", ms: 3 })).toBe(false);
    expect(await accepts({ type: "send_ok", dial: 3, value: { _tag: "accepted", rev: 4, pos: 2 }, ms: 3 })).toBe(false);
    expect(await accepts({ type: "send_ok", id: 7, value: { _tag: "accepted", rev: 4, pos: 2 }, ms: 3 })).toBe(false);
    expect(await accepts({ type: "send_err", id: 7, dial: 3, error: { _tag: "unknown" } })).toBe(true);
    expect(await accepts({ type: "send_err", id: 7, dial: 3, error: { _tag: "unreachable" } })).toBe(true);
    expect(await accepts({ type: "send_err", dial: 3, error: { _tag: "unknown" } })).toBe(false);
  });

  it("format: a failed key settings read is `settings_failed` with its dial and the call's reason (A15)", async () => {
    // reason: the runner (main.tsx) dispatches it when a settings `ledger.read` or `ledger.wait`
    // fails, and the Model shows its reason; decoded through the machine's own `msg` schema.
    expect(await accepts({ type: "settings_failed", dial: 3, reason: "unreachable" })).toBe(true);
    expect(await accepts({ type: "settings_failed", dial: 1, reason: "refused" })).toBe(true);
    expect(await accepts({ type: "settings_failed", reason: "unreachable" })).toBe(false);
    expect(await accepts({ type: "settings_failed", dial: 3 })).toBe(false);
    expect(await accepts({ type: "settings_failed", dial: "3", reason: "unreachable" })).toBe(false);
    expect(await accepts({ type: "settings_failed", dial: 3, reason: 7 })).toBe(false);
  });

  it("format: the settings read's restart is the Cmd `read_settings` with the dial it reads on (A16)", async () => {
    // reason: the runner (main.tsx) starts the settings read again on that dial's socket only on this
    // Cmd; decoded through the input schema of the machine's own `read_settings` Cmd.
    type Issues = { readonly issues?: unknown };
    type Def = {
      readonly cmdType: string;
      readonly schema: {
        readonly input: {
          readonly "~standard": {
            readonly validate: (v: unknown) => Issues | Promise<Issues>;
          };
        };
      };
    };
    // oxlint-disable-next-line fabrika/no-type-assertions -- the machine's `cmds` are the Cmds it may ask; the cast names their tea shape
    const defs = ((await machine()) as unknown as { cmds: ReadonlyArray<Def> }).cmds;
    const def = defs.find((d) => d.cmdType === "read_settings");
    expect(def, "the window declares the Cmd read_settings").toBeDefined();
    const takes = async (input: unknown): Promise<boolean> => {
      const out = await def?.schema.input["~standard"].validate(input);
      return out !== undefined && out.issues === undefined;
    };
    expect(await takes({ dial: 3 })).toBe(true);
    expect(await takes({ dial: 1 })).toBe(true);
    expect(await takes({})).toBe(false);
    expect(await takes({ dial: "3" })).toBe(false);
    expect(await takes({ dial: 1.5 })).toBe(false);
  });

  it("format: the socket Sub's answer to an open, open_ok, carries the write's id and dial and a {rev, view}", async () => {
    // reason: the view an open installs is read from it, found by id and dial (A13).
    expect(await accepts({ type: "open_ok", id: 8, dial: 3, value: { rev: 0, view: { count: 0 } }, ms: 1 })).toBe(true);
    expect(await accepts({ type: "open_ok", id: 8, dial: 3, value: { view: { count: 0 } }, ms: 1 })).toBe(false);
    expect(await accepts({ type: "open_ok", id: 8, value: { rev: 0, view: { count: 0 } }, ms: 1 })).toBe(false);
    expect(await accepts({ type: "open_err", id: 8, dial: 3, error: { _tag: "unreachable" } })).toBe(true);
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
