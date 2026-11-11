// Experiment 256, next/ (Tier 1, P14): the window machine's laws as a few model-based properties.
// One generator draws Msg runs the way the window meets them (outside Msgs on the dial it is on,
// the answers to the Cmds and writes it asked, its own timers firing, stale answers), folds them
// through the real `init` and `update`, and six properties read every step of every run.
//
// No law here computes the window's next Model. Each one checks a step against something the
// window does not own: the link and client machines' own folds (libfabrika), `routeKey`,
// `Keys.buildTable`, `sendable`, `socketDial` and `timerDeps`, or a count the trace keeps on its
// own (which letters are out on this dial, how often each letter was written, how many patches a
// run installed). Where a law names a field's value, it is a value the step's Msg carried in.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { ClientRecord, Keys, ProgramClient } from "@kampus/libfabrika";
import { syncTest } from "@kampus/libfabrika/testing";
import { linkMachine, socketDial, timerDeps } from "@kampus/libfabrika/transport/Link";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { routeKey } from "../desktop/keys.ts";
import { type Layout, split, tile, tilesIn } from "../desktop/layout.ts";
import { windowMachineFor, type WindowModel } from "./machine.ts";

const SEED = 119120;
const RUNS = 800;

type S = WindowModel;
type Msg = { readonly type: string; readonly [key: string]: unknown };
type Cmd = { readonly type: string; readonly [key: string]: unknown };
type Call = { readonly _tag: string; readonly [key: string]: unknown };
type Write = { readonly call: Call; readonly id: number; readonly dial: number };

const A = "process_a";
const B = "process_b";
const C = "process_c";

const LAYOUTS: ReadonlyArray<Layout> = [
  tile("t0", A),
  split("row", 50, tile("t0", A), tile("t1", B)),
  split("col", 50, tile("t0", A), split("row", 50, tile("t1", B), tile("t2", A))),
  split("col", 50, split("row", 50, tile("t0", A), tile("t1", B)), split("row", 50, tile("t2", A), tile("t3", C))),
];

/** Key rows and commands, so key presses route; `process_c` takes only `inc`. */
const DEFAULTS = { "counter.inc": ["+"], "counter.dec": ["-"], "counter.reset": ["g r"] };

const commands = (pid: string): ReadonlyArray<string> =>
  pid === C ? ["counter.inc"] : ["counter.inc", "counter.dec", "counter.reset"];

const ctxFor = (layout: Layout) => ({ layout, keys: { defaults: DEFAULTS, commands } });

/** No decoder, and one that refuses a negative count, so whole views are refused and asked again. */
const CHECKS: ReadonlyArray<ProgramClient.ClientChecks> = [
  {},
  {
    decode: () =>
      Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })),
  },
];

const MACHINES = CHECKS.map((checks) => windowMachineFor(checks));
const CLIENTS = CHECKS.map((checks) => ProgramClient.clientMachineFor(checks));

const fold = <M>(machine: unknown, s: M, msg: unknown): readonly [M, ReadonlyArray<Cmd>] =>
  // oxlint-disable-next-line fabrika/no-type-assertions -- one fold for the window, link and client machines, whose Msg types the laws read as plain records
  applyCell(machine as never, s as never, msg as never) as unknown as readonly [M, ReadonlyArray<Cmd>];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const online = (s: S): boolean => s.link._tag === "online";
const dialIn = (s: S): number | null => ("dial" in s.link ? s.link.dial : null);

const writesIn = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<Write> =>
  cmds.flatMap((c) =>
    c.type === "write" ? [{ call: c["call"] as Call, id: Number(c["id"]), dial: Number(c["dial"]) }] : [],
  );

const key = (dial: unknown, id: unknown): string => `${String(dial)}/${String(id)}`;

// --- The runs ----------------------------------------------------------------------------------

const off = fc.constantFrom(0, 0, 0, 0, -1, 1);
const ms = fc.oneof(fc.constant(0), fc.nat(60_000), fc.double({ min: 0, max: 60_000, noNaN: true }));
const word = fc.constantFrom("a", "b", "SHA256:x");

/** One event, read against the state the fold has reached when it comes. */
const event = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      k: fc.constant("answer" as const),
      pick: fc.nat(999),
      v: fc.nat(11),
      ms,
      rev: fc.nat(4),
      count: fc.integer({ min: -2, max: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("timer" as const), which: fc.nat(1) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      k: fc.constant("stale" as const),
      pick: fc.nat(999),
      never: fc.boolean(),
      v: fc.nat(11),
      ms,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      k: fc.constant("link" as const),
      type: fc.constantFrom(
        "admitted",
        "admitted",
        "not_granted",
        "granted",
        "closed",
        "closed",
        "retry",
        "stalled",
        "pong",
        "beat",
        "ask_again",
        "blocked",
      ),
      off,
      code: fc.constantFrom(1000, 1006, 1006, 4003),
      ping: fc.constantFrom(0, 5_000, 30_000),
      fp: word,
      ms,
    }),
  },
  {
    weight: 6,
    arbitrary: fc.oneof(
      fc.record({
        k: fc.constant("press" as const),
        pid: fc.nat(3),
        m: fc.constantFrom("inc", "dec", "reset", "other"),
        via: fc.constantFrom(undefined, "button", "key"),
      }),
      fc.record({
        k: fc.constant("view" as const),
        pid: fc.nat(3),
        note: fc.constantFrom("next", "next", "next", "gap", "behind", "whole", "junk"),
        d: fc.nat(3),
        count: fc.integer({ min: -2, max: 4 }),
      }),
      fc.record({ k: fc.constant("focus" as const), at: fc.nat(5) }),
      fc.record({
        k: fc.constant("key" as const),
        key: fc.constantFrom("+", "-", "g", "r", "x", "Escape"),
        ctrl: fc.boolean(),
        quiet: fc.nat(9),
      }),
      fc.record({
        k: fc.constant("keys" as const),
        rows: fc.constantFrom({}, { "counter.inc": ["x"] }, { "counter.dec": [] }),
      }),
      fc.record({
        k: fc.constant("keys_failed" as const),
        line: fc.integer({ min: 1, max: 9 }),
        reason: fc.constantFrom("syntax", "clash"),
      }),
      fc.record({ k: fc.constant("settings_failed" as const), off, reason: fc.constantFrom("unreachable", "refused") }),
      fc.record({ k: fc.constant("resend" as const), off }),
      fc.record({ k: fc.constant("resized" as const), w: fc.constantFrom(800, 1024), h: fc.constantFrom(600, 700) }),
      fc.record({ k: fc.constant("seen" as const), rev: fc.nat(20) }),
      fc.record({ k: fc.constant("identity" as const), found: fc.constantFrom("created", "reused", "replaced") }),
    ),
  },
);

type Event = typeof event extends fc.Arbitrary<infer E> ? E : never;

const Run = fc.record({
  layout: fc.nat(LAYOUTS.length - 1),
  checks: fc.nat(CHECKS.length - 1),
  events: fc.array(fc.tuple(event, fc.nat()), { minLength: 10, maxLength: 150, size: "max" }),
});

type Step = { readonly prev: S; readonly msg: Msg; readonly next: S; readonly cmds: ReadonlyArray<Cmd> };
type Folded = { readonly layout: Layout; readonly checks: number; readonly steps: ReadonlyArray<Step> };

/** A dial near the one the link is on, so Msgs are often for it and sometimes stale. */
const near = (s: S, by: number): number => Math.max(1, (dialIn(s) ?? s.dials) + by);

/** The Msg an outside event is, from state `s`, or null when it names nothing there. */
const outside = (s: S, e: Event, tiles: ReadonlyArray<{ id: string; pid: string }>): Msg | null => {
  const pids = [...new Set(tiles.map((t) => t.pid))];

  switch (e.k) {
    case "link": {
      const dial = near(s, e.off);
      return e.type === "admitted"
        ? { type: "admitted", dial, ping: e.ping, ms: e.ms }
        : e.type === "not_granted"
          ? { type: "not_granted", dial, fingerprint: e.fp, code: "c", until: 1000, ms: e.ms }
          : e.type === "closed"
            ? { type: "closed", dial, code: e.code, fingerprint: e.fp, ms: e.ms }
            : e.type === "retry"
              ? { type: "retry", dial, tries: "tries" in s.link ? s.link.tries : 1 }
              : e.type === "stalled"
                ? { type: "stalled", dial, ms: e.ms }
                : e.type === "ask_again"
                  ? { type: "ask_again", dial: s.dials + 1 + Math.max(0, e.off) }
                  : e.type === "blocked"
                    ? e.off === -1
                      ? { type: "blocked", reason: "x" }
                      : null
                    : { type: e.type, dial };
    }
    case "press": {
      const pid = pids[e.pid % pids.length] as string;
      return { type: "press", pid, m: { type: e.m }, ...(e.via === undefined ? {} : { via: e.via }) };
    }
    case "view": {
      const pid = pids[e.pid % pids.length] as string;
      const rev = s.client.views[pid]?.rev ?? 0;
      const patch = (base: number, to: number) => ({
        type: "patch",
        base,
        rev: to,
        patch: [{ op: "replace", path: "/count", value: e.count }],
      });
      const note =
        e.note === "next"
          ? patch(rev, rev + 1)
          : e.note === "gap"
            ? patch(rev, rev + 2)
            : e.note === "behind"
              ? patch(Math.max(0, rev - 1), rev)
              : e.note === "whole"
                ? { type: "whole", rev: rev + e.d, view: { count: e.count } }
                : e.d === 0
                  ? null
                  : { type: "other", n: e.d };
      return { type: "view", pid, note };
    }
    case "focus":
      return {
        type: "focus",
        tile: e.at === 5 ? null : e.at === 4 ? "nowhere" : (tiles[e.at % tiles.length]?.id ?? null),
      };
    case "key":
      return {
        type: "key",
        event: {
          key: e.key,
          shift: false,
          ctrl: e.ctrl && e.quiet === 0,
          alt: false,
          meta: false,
          composing: e.quiet === 1,
          editable: e.quiet === 2,
        },
      };
    case "keys":
      return { type: "keys", rows: e.rows };
    case "keys_failed":
      return { type: "keys_failed", error: { line: e.line, reason: e.reason } };
    case "settings_failed":
      return { type: "settings_failed", dial: near(s, e.off), reason: e.reason };
    case "resend":
      return { type: "resend", dial: near(s, e.off) };
    case "resized":
      return { type: "resized", w: e.w, h: e.h };
    case "seen":
      return { type: "seen", rev: e.rev };
    case "identity":
      return { type: "identity", found: e.found };
    default:
      return null;
  }
};

/** The answer the socket gives a write of `call`, by `v`. */
const reply = (call: Call, v: number, took: number, rev: number, count: number): Msg =>
  call._tag === "send"
    ? v % 4 === 0
      ? { type: "send_err", error: v % 8 === 0 ? { _tag: "unknown" } : { _tag: "unreachable" } }
      : v % 4 === 1
        ? { type: "send_ok", value: { _tag: "refused", reason: "bad_msg" }, ms: took }
        : { type: "send_ok", value: { _tag: "accepted", rev: 1, pos: 1 }, ms: took }
    : call._tag === "open"
      ? v % 5 === 0
        ? { type: "open_err", error: { _tag: "unreachable" } }
        : { type: "open_ok", value: { rev, view: { count } }, ms: took }
      : v % 3 === 0
        ? { type: "knock_err", error: { _tag: "closed" } }
        : { type: "knock_ok", value: null, ms: took };

/** tea's settle of a Cmd the window asked, by `v`. */
const settle = (cmd: Cmd, v: number, letter: string): Msg => {
  const ok = v % 4 !== 0;

  switch (cmd.type) {
    case "now":
      return ok
        ? {
            type: "now_ok",
            cmd,
            value: { letter, sentAt: "2026-11-10T00:00:00.000Z", ...(v % 3 === 0 ? { traceId: "t" } : {}) },
          }
        : { type: "now_err", cmd, error: { _tag: "clock" } };
    case "persist":
      return v % 3 === 0
        ? { type: "persist_err", cmd, error: { _tag: v % 2 === 0 ? "unsupported" : "failed" } }
        : { type: "persist_ok", cmd, value: v % 3 === 1 };
    default:
      return ok
        ? { type: `${cmd.type}_ok`, cmd, value: null }
        : { type: `${cmd.type}_err`, cmd, error: { _tag: "failed" } };
  }
};

/** Folds a drawn run through the real machine. Every write settles at once, `write_ok` or now and
 *  then `write_err`, folded as its own step; a handed-over write then waits for its socket answer
 *  while its dial's socket is open. Other Cmds wait for tea's settle. */
const play = (r: { layout: number; checks: number; events: ReadonlyArray<readonly [Event, number]> }): Folded => {
  const layout = LAYOUTS[r.layout] as Layout;
  const tiles = tilesIn(layout);
  const machine = MACHINES[r.checks];
  const ctx = ctxFor(layout);
  // oxlint-disable-next-line fabrika/no-type-assertions -- the laws read the Model and Cmds as plain records
  let [s] = machine.init(null, ctx) as unknown as readonly [S, ReadonlyArray<Cmd>];
  const steps: Array<Step> = [];
  let cmdsWaiting: Array<Cmd> = [];
  let writesWaiting: Array<Write> = [];
  const written: Array<Write> = [];
  let letters = 0;

  const one = (msg: Msg, bits: number): void => {
    const [next, cmds] = fold<S>(machine, s, msg);
    steps.push({ prev: s, msg, next, cmds });
    s = next;
    let k = 0;

    for (const c of cmds) {
      if (c.type !== "write") {
        cmdsWaiting.push(c);
        continue;
      }

      const w = writesIn([c])[0] as Write;
      written.push(w);
      const failed = ((bits >>> (k++ % 28)) & 7) === 7;
      const settled: Msg = failed
        ? { type: "write_err", cmd: c, error: { _tag: "unreachable" } }
        : { type: "write_ok", cmd: c, value: null };
      const [after, more] = fold<S>(machine, s, settled);
      steps.push({ prev: s, msg: settled, next: after, cmds: more });
      s = after;
      cmdsWaiting.push(...more);

      if (!failed) {
        writesWaiting.push(w);
      }
    }

    writesWaiting = writesWaiting.filter((w) => w.dial === socketDial(s.link));
  };

  for (const [e, bits] of r.events) {
    if (e.k === "answer") {
      const all = [...cmdsWaiting.map((c) => ({ c })), ...writesWaiting.map((w) => ({ w }))];
      const got = all[e.pick % Math.max(1, all.length)];

      if (got === undefined) {
        continue;
      }

      if ("c" in got) {
        cmdsWaiting = cmdsWaiting.filter((c) => c !== got.c);
        one(settle(got.c, e.v, `letter_${letters++}`), bits);
      } else {
        writesWaiting = writesWaiting.filter((w) => w !== got.w);
        one({ ...reply(got.w.call, e.v, e.ms, e.rev, e.count), id: got.w.id, dial: got.w.dial }, bits);
      }
    } else if (e.k === "stale") {
      const past = written[e.pick % Math.max(1, written.length)];

      if (past !== undefined) {
        one(
          { ...reply(past.call, e.v, e.ms, 0, 0), id: e.never ? 1_000_000 + e.pick : past.id, dial: past.dial },
          bits,
        );
      }
    } else if (e.k === "timer") {
      const timers = (machine.subs as ReadonlyArray<{ type: string; deps: (s: S) => unknown }>).filter(
        (t) => t.type === "timer",
      );
      const due = timers[e.which]?.deps(s) as { msg: Msg } | null | undefined;

      if (due) {
        one(due.msg, bits);
      }
    } else {
      const msg = outside(s, e, tiles);

      if (msg !== null) {
        one(msg, bits);
      }
    }
  }

  return { layout, checks: r.checks, steps };
};

// --- What the trace keeps on its own -------------------------------------------------------------

const LINK = new Set([
  "admitted",
  "not_granted",
  "granted",
  "closed",
  "retry",
  "beat",
  "pong",
  "stalled",
  "renew",
  "blocked",
  "ask_again",
]);

const ANSWER = new Set(["send_ok", "send_err", "open_ok", "open_err", "knock_ok", "knock_err"]);

/** A step with what the window does not own: the call an answer is for (null when it is stale),
 *  the reference link and client before and after, the client's asks, and what it installed. */
type Seen = Step & {
  readonly writes: ReadonlyArray<Write>;
  readonly call: Write | null;
  readonly stale: boolean;
  readonly link: { readonly before: S["link"]; readonly after: S["link"]; readonly cmds: ReadonlyArray<Cmd> };
  readonly client: { readonly before: S["client"]; readonly after: S["client"]; readonly asks: ReadonlyArray<string> };
  readonly installed: { readonly pid: string; readonly patch: boolean; readonly rev: number } | null;
  readonly tiles: ReadonlyArray<{ id: string; pid: string }>;
};

/** Reads a folded run: keeps its own flight of writes, and steps a link machine and a client
 *  machine of its own on what the window was told. */
const observe = ({ layout, checks, steps }: Folded): ReadonlyArray<Seen> => {
  const tiles = tilesIn(layout);
  const cm = CLIENTS[checks];
  let link = linkMachine.init(null, {})[0] as S["link"];
  let client = cm.init(null, {})[0] as S["client"];
  const flight = new Map<string, Write>();

  return steps.map((step) => {
    const { prev, msg, next, cmds } = step;
    const settling = msg.type === "write_ok" || msg.type === "write_err" ? (msg["cmd"] as Cmd) : null;
    const k =
      settling !== null
        ? key(settling["dial"], settling["id"])
        : ANSWER.has(msg.type)
          ? key(msg["dial"], msg["id"])
          : null;
    const found = k === null ? undefined : flight.get(k);
    const call =
      found !== undefined && (settling !== null || msg.type.startsWith(`${found.call._tag}_`)) ? found : null;
    const stale = ANSWER.has(msg.type) && call === null;

    if (call !== null && msg.type !== "write_ok") {
      flight.delete(k as string);
    }

    // The link's own fold.
    const linkBefore = link;
    let linkCmds: ReadonlyArray<Cmd> = [];

    if (LINK.has(msg.type)) {
      [link, linkCmds] = fold<S["link"]>(linkMachine, link, msg);
    }

    // The client's own fold, on the Msg the window owes it.
    const clientBefore = client;
    const routed =
      msg.type === "key"
        ? routeKey({
            table: prev.keys,
            armed: prev.armed,
            event: msg["event"] as never,
            tile: tiles.find((t) => t.id === prev.focus) ?? null,
            commands: commands(tiles.find((t) => t.id === prev.focus)?.pid ?? ""),
          })
        : null;
    const own: Msg | null =
      msg.type === "press"
        ? { type: "press", pid: msg["pid"], m: msg["m"] }
        : routed?.press
          ? { type: "press", pid: routed.press.pid, m: routed.press.m }
          : msg.type === "now_ok"
            ? { type: "dated", n: (msg["cmd"] as { n: number }).n, ...(msg["value"] as object) }
            : msg.type === "send_ok" && call !== null
              ? { type: "reply", letter: call.call["letter"], answer: msg["value"] }
              : msg.type === "seen"
                ? { type: "read", rev: msg["rev"] }
                : msg.type === "view"
                  ? { type: "notice", pid: msg["pid"], note: msg["note"] }
                  : msg.type === "open_ok" && call !== null && online(prev) && dialIn(prev) === call.dial
                    ? { type: "notice", pid: call.call["pid"], note: { type: "whole", ...(msg["value"] as object) } }
                    : null;
    let asks: ReadonlyArray<string> = [];

    if (own !== null) {
      const [after, out] = fold<S["client"]>(cm, client, own);
      client = after;
      asks = out.map((c) => String(c["pid"]));
    }

    const pid = own?.type === "notice" ? String(own["pid"]) : null;
    const was = pid === null ? undefined : clientBefore.views[pid];
    const now = pid === null ? undefined : client.views[pid];
    const installed =
      pid !== null && now !== undefined && now !== was
        ? { pid, patch: (own?.["note"] as { type?: unknown } | null)?.type === "patch", rev: now.rev }
        : null;

    // A14: a notice that installs a pid's view ends that pid's open in flight.
    if (msg.type === "view" && installed !== null) {
      for (const [f, w] of flight) {
        if (w.call._tag === "open" && w.call["pid"] === installed.pid) {
          flight.delete(f);
        }
      }
    }

    const writes = writesIn(cmds);

    for (const w of writes) {
      flight.set(key(w.dial, w.id), w);
    }

    for (const [f, w] of flight) {
      if (w.dial !== socketDial(next.link)) {
        flight.delete(f);
      }
    }

    return {
      ...step,
      writes,
      call,
      stale,
      link: { before: linkBefore, after: link, cmds: linkCmds },
      client: { before: clientBefore, after: client, asks },
      installed,
      tiles,
    };
  });
};

/** Runs `law` over every drawn run; `met` counts what the runs reached, checked afterwards. */
const holds = (
  law: (run: ReadonlyArray<Seen>, met: Record<string, number>) => string | null,
  reach: ReadonlyArray<string>,
) => {
  const met: Record<string, number> = {};
  fc.assert(
    fc.property(Run, (r) => {
      const why = law(observe(play(r)), met);

      if (why !== null) {
        throw new Error(why);
      }
    }),
    { seed: SEED, numRuns: RUNS },
  );

  for (const name of reach) {
    expect(met[name] ?? 0, `the runs reached ${name}`).toBeGreaterThan(0);
  }
};

const bump = (met: Record<string, number>, name: string, by = true): void => {
  if (by) {
    met[name] = (met[name] ?? 0) + 1;
  }
};

const isRecord = (r: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(ClientRecord)(r, { onExcessProperty: "error" }));

const recordsIn = (cmds: ReadonlyArray<Cmd>): ReadonlyArray<ClientRecord> =>
  cmds.filter((c) => c.type === "record").map((c) => c["record"] as ClientRecord);

/** Decodes `value` with `schema`, refusing a key the schema does not name: Effect 4's Struct keeps
 *  unknown keys by default, so a schema that lost a field would still pass a plain decode. */
const strict = (schema: unknown, value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema as never)(value, { onExcessProperty: "error" }));

/** The Cmds the window declares, by type, each with its input schema. */
const DEFS = new Map(
  // oxlint-disable-next-line fabrika/no-type-assertions -- tea's Cmd definitions, read for their type and input schema only
  (MACHINES[0].cmds as unknown as ReadonlyArray<{ cmdType: string; schema: { input: unknown } }>).map((d) => [
    d.cmdType,
    d.schema.input,
  ]),
);

const goesOnline = (x: Seen): boolean => !online(x.prev) && online(x.next);
const leavesOnline = (x: Seen): boolean => online(x.prev) && !online(x.next);

// --- The laws ------------------------------------------------------------------------------------

describe("window machine, as a few model-based properties (experiment 256)", () => {
  it("children: the window's link and client are the link and client machines' own folds of what it was told, and its pings and knocks are the link's", () =>
    holds(
      (run, met) => {
        for (const x of run) {
          if (!same(x.next.link, x.link.after)) {
            return `${x.msg.type}: link ${JSON.stringify(x.next.link)}, the link machine's ${JSON.stringify(x.link.after)}`;
          }

          if (!same(x.next.client, x.client.after)) {
            return `${x.msg.type}: client ${JSON.stringify(x.next.client)}, the client machine's ${JSON.stringify(x.client.after)}`;
          }

          const pings = x.cmds.filter((c) => c.type === "ping");
          const knocks = x.writes.filter((w) => w.call._tag === "knock");

          if (
            !same(
              pings,
              x.link.cmds.filter((c) => c.type === "ping"),
            )
          ) {
            return `${x.msg.type} asked pings ${JSON.stringify(pings)}, the link ${JSON.stringify(x.link.cmds)}`;
          }

          if (
            knocks.length !== x.link.cmds.filter((c) => c.type === "knock").length ||
            knocks.some((w) => w.dial !== socketDial(x.next.link))
          ) {
            return `${x.msg.type} wrote knocks ${JSON.stringify(knocks)}, the link asked ${JSON.stringify(x.link.cmds)}`;
          }

          bump(met, "a late open beaten by a notice", x.msg.type === "open_ok" && x.stale);
          bump(met, "a key that pressed", x.msg.type === "key" && x.next.client.written > x.prev.client.written);
          bump(met, "a refused whole view", x.client.asks.length > 0);
          bump(met, "a patch installed", x.installed?.patch === true);
          bump(met, "a knock", knocks.length > 0);
        }

        return null;
      },
      ["a late open beaten by a notice", "a key that pressed", "a refused whole view", "a patch installed", "a knock"],
    ));

  it("wire: every brain call is a write with a new id on the open dial; online alone sends; going online opens each pid once and sends what may go in slot order; a letter goes once per dial until freed; a stale answer does nothing", () =>
    holds(
      (run, met) => {
        const ids = new Set<number>();
        let out = new Set<string>();

        for (const x of run) {
          const { prev, msg, next, cmds, writes } = x;

          // What crosses the edge decodes: a Msg the runner sends (tea's own settles carry `cmd`),
          // and each Cmd's input through the schema the window declares for it.
          if (!("cmd" in msg) && !strict(MACHINES[0].msg, msg)) {
            return `${JSON.stringify(msg)} does not decode as a window Msg`;
          }

          for (const c of cmds) {
            const { type, ...input } = c;

            if (!DEFS.has(type) || !strict(DEFS.get(type), input)) {
              return `${msg.type} asked ${JSON.stringify(c)}, which is no Cmd the window declares`;
            }
          }

          if (cmds.some((c) => c.type === "send" || c.type === "open" || c.type === "knock")) {
            return `${msg.type} asked a brain call as a Cmd: ${JSON.stringify(cmds)}`;
          }

          if (x.stale && (!same(next, prev) || cmds.length > 0)) {
            return `a stale ${msg.type} (${key(msg["dial"], msg["id"])}) moved the window or asked ${JSON.stringify(cmds)}`;
          }

          if (
            [
              "write_ok",
              "record_ok",
              "record_err",
              "ping_ok",
              "ping_err",
              "read_settings_ok",
              "read_settings_err",
              "persist_ok",
              "persist_err",
            ].includes(msg.type) &&
            !same(next, prev)
          ) {
            return `${msg.type} moved the window`;
          }

          for (const w of writes) {
            if (ids.has(w.id)) {
              return `${msg.type} wrote id ${w.id} twice`;
            }

            ids.add(w.id);

            if (w.dial !== socketDial(next.link) || (w.call._tag !== "knock" && !online(next))) {
              return `${msg.type} wrote a ${w.call._tag} on dial ${w.dial} while ${next.link._tag} on ${String(dialIn(next))}`;
            }
          }

          if (!online(next) || goesOnline(x)) {
            out = new Set();
          }

          // What frees a letter on this dial: its write failed, or its answer came, save one the
          // client cannot read.
          const letter = x.call?.call._tag === "send" ? String(x.call.call["letter"]) : null;

          if (
            letter !== null &&
            (msg.type === "write_err" ||
              msg.type === "send_ok" ||
              (msg.type === "send_err" && (msg["error"] as Call)._tag === "unreachable"))
          ) {
            out.delete(letter);
          }

          const sends = writes.filter((w) => w.call._tag === "send");
          const opens = writes.filter((w) => w.call._tag === "open");
          const may = ProgramClient.sendable(next.client);

          for (const w of sends) {
            const l = String(w.call["letter"]);
            const slot = may.find((p) => p.letter === l);

            if (out.has(l)) {
              return `${msg.type} wrote ${l} again on dial ${w.dial} before anything freed it`;
            }

            if (
              slot === undefined ||
              !same(w.call, {
                _tag: "send",
                pid: slot.pid,
                letter: slot.letter,
                n: slot.n,
                m: slot.m,
                sentAt: slot.sentAt,
                seen: slot.seen,
                ...(slot.traceId === undefined ? {} : { traceId: slot.traceId }),
              })
            ) {
              return `${msg.type} wrote ${JSON.stringify(w.call)}, which is no slot that may go: ${JSON.stringify(may)}`;
            }

            out.add(l);
          }

          const order = sends.map((w) => Number(w.call["n"]));

          if (
            !same(
              order,
              [...order].sort((a, b) => a - b),
            )
          ) {
            return `${msg.type} wrote slots ${JSON.stringify(order)} out of order`;
          }

          if (sends.length > 0 && !(goesOnline(x) || msg.type === "now_ok" || msg.type === "resend")) {
            return `${msg.type} wrote a send`;
          }

          // What may go, goes: going online, a dated slot and a tick on the online dial leave every
          // letter that may go out on this dial.
          if (
            online(next) &&
            (goesOnline(x) || msg.type === "now_ok" || (msg.type === "resend" && msg["dial"] === dialIn(next)))
          ) {
            const left = may.filter((p) => !out.has(p.letter));

            if (left.length > 0) {
              return `after ${msg.type}, ${JSON.stringify(left.map((p) => p.letter))} may go and are not out`;
            }
          }

          const pids = opens.map((w) => String(w.call["pid"])).sort();

          if (goesOnline(x)) {
            if (!same(pids, [...new Set(x.tiles.map((t) => t.pid))].sort())) {
              return `going online opened ${JSON.stringify(pids)}`;
            }

            bump(met, "a redial that went online again", (dialIn(next) ?? 0) > 1);
            bump(met, "several letters at once", sends.length > 1);
          } else if (msg.type === "view" && online(prev)) {
            if (!same(pids, [...x.client.asks].sort())) {
              return `a view on dial ${String(dialIn(prev))} opened ${JSON.stringify(pids)}, the client asked ${JSON.stringify(x.client.asks)}`;
            }
          } else if (opens.length > 0) {
            return `${msg.type} opened ${JSON.stringify(pids)}`;
          }

          bump(met, "a stale answer", x.stale);
          bump(met, "a failed write", msg.type === "write_err");
          bump(met, "a letter freed and written again", sends.length > 0 && !goesOnline(x) && msg.type === "resend");
          bump(met, "a reopen on an ask", msg.type === "view" && opens.length > 0);
        }

        return null;
      },
      [
        "a redial that went online again",
        "several letters at once",
        "a stale answer",
        "a failed write",
        "a letter freed and written again",
        "a reopen on an ask",
      ],
    ));

  it("records: each is a ClientRecord; a connect, press, reply, persist, key, whole, asked and patch row comes exactly when its event does, with the numbers the event carried", () =>
    holds(
      (run, met) => {
        const attempts = new Map<string, number>();
        const via = new Map<number, string>();
        const runs = new Map<string, { n: number; rev: number }>();

        for (const x of run) {
          const { prev, msg, next, cmds } = x;
          const records = recordsIn(cmds);
          const bad = records.find((r) => !isRecord(r));

          if (bad !== undefined) {
            return `${msg.type} kept ${JSON.stringify(bad)}, no ClientRecord`;
          }

          const rows = (tag: string) => records.filter((r) => r._tag === tag);
          const want = (tag: string, expected: ReadonlyArray<unknown>, also = ""): string | null =>
            same(rows(tag), expected)
              ? null
              : `${msg.type} ${also}kept ${tag} rows ${JSON.stringify(rows(tag))}, not ${JSON.stringify(expected)}`;

          // connect: one row per link outcome, on the Msg's dial with its ms.
          const was = x.link.before._tag;
          const is = x.link.after._tag;
          const outcome =
            was !== "online" && is === "online"
              ? "online"
              : was !== "waiting_grant" && is === "waiting_grant"
                ? "waiting"
                : was !== "removed" && is === "removed"
                  ? "removed"
                  : was !== "retrying" && is === "retrying" && (msg.type === "closed" || msg.type === "stalled")
                    ? msg.type
                    : null;
          const why =
            want(
              "connect",
              outcome === null ? [] : [{ _tag: "connect", dial: msg["dial"], result: outcome, ms: msg["ms"] }],
            ) ??
            // key: one row per identity Msg.
            want("key", msg.type === "identity" ? [{ _tag: "key", result: msg["found"] }] : []) ??
            // persist: one row per persistence answer.
            want(
              "persist",
              msg.type === "persist_ok"
                ? [{ _tag: "persist", result: msg["value"] === true ? "granted" : "refused" }]
                : msg.type === "persist_err" && (msg["error"] as Call)._tag === "failed"
                  ? [{ _tag: "persist", result: "failed" }]
                  : [],
            ) ??
            want(
              "failure",
              msg.type === "persist_err" && (msg["error"] as Call)._tag === "unsupported"
                ? [{ _tag: "failure", op: "persist", error: "NotSupportedError" }]
                : [],
            );

          if (why !== null) {
            return why;
          }

          // press: the step a pressed slot gets its letter keeps one row, ahead of any send.
          if (next.client.written > prev.client.written) {
            via.set(prev.client.written, msg.type === "key" ? "key" : String(msg["via"] ?? "button"));
          }

          const n = msg.type === "now_ok" ? (msg["cmd"] as { n: number }).n : null;
          const before = x.client.before.pending.find((p) => p.n === n);
          const dated = x.client.after.pending.find((p) => p.n === n);
          const pressed = before?._tag === "dating" && dated?._tag === "ready" ? dated : null;
          const type = (pressed?.m as { type?: string } | undefined)?.type ?? "";
          const pressRow =
            pressed === null
              ? []
              : [
                  {
                    _tag: "press",
                    command: commands(pressed.pid).find((c) => c.endsWith(`.${type}`)) ?? type,
                    via: via.get(pressed.n),
                    pid: pressed.pid,
                    viewRev: Math.max(0, pressed.viewRev),
                    seen: Math.max(0, pressed.seen),
                    letter: pressed.letter,
                    depth: x.client.after.pending.length,
                  },
                ];
          const pressWhy = want("press", pressRow, `slot ${String(n)} `);

          if (pressWhy !== null) {
            return pressWhy;
          }

          const firstWrite = cmds.findIndex((c) => c.type === "write");
          const pressAt = cmds.findIndex((c) => c.type === "record" && (c["record"] as ClientRecord)._tag === "press");

          if (pressAt !== -1 && firstWrite !== -1 && firstWrite < pressAt) {
            return `${msg.type} wrote its letter before keeping its press row`;
          }

          // reply: the answer that settles a letter keeps one row, with every write of it so far.
          const letter = x.call?.call._tag === "send" && msg.type === "send_ok" ? String(x.call.call["letter"]) : null;
          const settled =
            letter !== null &&
            x.client.before.pending.some((p) => p.letter === letter) &&
            !x.client.after.pending.some((p) => p.letter === letter);
          const replyWhy = want(
            "reply",
            settled
              ? [
                  {
                    _tag: "reply",
                    letter,
                    result: (msg["value"] as Call)._tag,
                    attempts: attempts.get(letter as string) ?? 0,
                    ms: msg["ms"],
                  },
                ]
              : [],
          );

          if (replyWhy !== null) {
            return replyWhy;
          }

          for (const w of x.writes.filter((w) => w.call._tag === "send")) {
            attempts.set(String(w.call["letter"]), (attempts.get(String(w.call["letter"])) ?? 0) + 1);
          }

          // view rows: a whole installed and each ask keep one row; a run of patches keeps one row
          // when it ends, by its pid's next whole or asked row, or by the link leaving online.
          const ending = leavesOnline(x)
            ? [...runs.keys()]
            : [...x.client.asks, ...(x.installed !== null && !x.installed.patch ? [x.installed.pid] : [])].filter((p) =>
                runs.has(p),
              );
          const expected = [
            ...[...new Set(ending)].map((p) => ({
              _tag: "view",
              pid: p,
              result: "patch",
              rev: Math.max(0, runs.get(p)?.rev ?? 0),
              patches: runs.get(p)?.n,
            })),
            ...(x.installed !== null && !x.installed.patch
              ? [{ _tag: "view", pid: x.installed.pid, result: "whole", rev: Math.max(0, x.installed.rev) }]
              : []),
            ...x.client.asks.map((p) => ({
              _tag: "view",
              pid: p,
              result: "asked",
              rev: Math.max(0, x.client.before.views[p]?.rev ?? 0),
            })),
          ];
          const viewWhy = want("view", expected);

          if (viewWhy !== null) {
            return viewWhy;
          }

          for (const p of new Set(ending)) {
            bump(met, leavesOnline(x) ? "a run ended offline" : "a run ended by a view row");
            bump(met, "a run of more than one", (runs.get(p)?.n ?? 0) > 1);
            runs.delete(p);
          }

          if (x.installed?.patch === true) {
            runs.set(x.installed.pid, { n: (runs.get(x.installed.pid)?.n ?? 0) + 1, rev: x.installed.rev });
          }

          bump(met, "a press row", pressRow.length > 0);
          bump(met, "a key press row", pressRow[0]?.via === "key");
          bump(met, "a reply sent twice", settled && (attempts.get(letter as string) ?? 0) > 1);
          bump(met, `a ${String(outcome)} row`, outcome !== null);
          bump(met, "a persist answer", msg.type === "persist_ok" || msg.type === "persist_err");
        }

        return null;
      },
      [
        "a press row",
        "a key press row",
        "a reply sent twice",
        "a online row",
        "a waiting row",
        "a closed row",
        "a stalled row",
        "a removed row",
        "a persist answer",
        "a run ended offline",
        "a run ended by a view row",
        "a run of more than one",
      ],
    ));

  it("timers, settings and persistence: the timers are the link's own and a resend that makes progress, armed exactly while something waits; a failed settings read is kept, asked again once on its tick and cleared by a new dial; persistence is asked once per new grant; the socket names the removed key", () =>
    holds(
      (run, met) => {
        // The timers and the resend read no checks, so the first machine's Subs and fold stand for both.
        const m = MACHINES[0];
        let redate = new Set<number>();
        let out = new Set<string>();
        let fresh = false;
        let rejected: string | null = null;
        let dials = 1;

        for (const x of run) {
          const { prev, msg, next, cmds } = x;
          const subs = m.subs as ReadonlyArray<{ type: string; deps: (s: S) => { ms: number; msg: Msg } | null }>;
          const [linkTimer, resend] = subs.filter((t) => t.type === "timer").map((t) => t.deps(next));
          const socket = subs.find((t) => t.type === "socket")?.deps(next);

          // Kept on their own: letters out on this dial, slots whose time failed, the removed key.
          if (!online(next) || goesOnline(x)) {
            out = new Set();
          }

          const letter = x.call?.call._tag === "send" ? String(x.call.call["letter"]) : null;

          if (
            letter !== null &&
            (msg.type === "write_err" ||
              msg.type === "send_ok" ||
              (msg.type === "send_err" && (msg["error"] as Call)._tag === "unreachable"))
          ) {
            out.delete(letter);
          }

          for (const w of x.writes.filter((w) => w.call._tag === "send")) {
            out.add(String(w.call["letter"]));
          }

          if (msg.type === "resend") {
            const asked = cmds
              .filter((c) => c.type === "now")
              .map((c) => Number(c["n"]))
              .sort();
            const owed = [...redate]
              .filter((n) => x.client.before.pending.some((p) => p.n === n && p._tag === "dating"))
              .sort();

            if (!same(asked, owed)) {
              return `a resend asked the time of ${JSON.stringify(asked)}, the failed ones were ${JSON.stringify(owed)}`;
            }

            redate = new Set();
          }

          if (
            msg.type === "now_err" &&
            x.client.before.pending.some((p) => p.n === (msg["cmd"] as { n: number }).n && p._tag === "dating")
          ) {
            redate.add((msg["cmd"] as { n: number }).n);
          }

          if (msg.type === "now_ok") {
            redate.delete((msg["cmd"] as { n: number }).n);
          }

          if (x.link.after._tag === "removed" && x.link.before._tag !== "removed") {
            rejected = x.link.after.fingerprint;
          }

          dials = Math.max(dials, socketDial(next.link) ?? 0);

          if (next.dials !== dials) {
            return `dials is ${next.dials}, the highest dial was ${dials}`;
          }

          if (!same(linkTimer, timerDeps(next.link))) {
            return `the link timer is ${JSON.stringify(linkTimer)}, the link's own ${JSON.stringify(timerDeps(next.link))}`;
          }

          const open = socketDial(next.link);

          if (!same(socket, open === null ? null : { dial: open, rejected })) {
            return `the socket is ${JSON.stringify(socket)} on ${String(open)}, the removed key ${String(rejected)}`;
          }

          // The resend timer runs exactly while something waits, and its tick makes progress.
          const failed = next.settings._tag === "failed" && online(next) && next.settings.dial === dialIn(next);
          const waits =
            redate.size > 0 ||
            (online(next) && ProgramClient.sendable(next.client).some((p) => !out.has(p.letter))) ||
            failed;

          if ((resend !== null) !== waits) {
            return `after ${msg.type}, the resend timer is ${JSON.stringify(resend)} with ${JSON.stringify({ redate: [...redate], failed, out: [...out] })}`;
          }

          if (resend !== null) {
            if (!(resend.ms > 0) || fold<S>(m, next, resend.msg)[1].length === 0) {
              return `the resend timer ${JSON.stringify(resend)} would tick and do nothing`;
            }
          }

          // Settings (A15, A16).
          const asked = cmds.filter((c) => c.type === "read_settings");
          const retry =
            msg.type === "resend" &&
            online(prev) &&
            prev.settings._tag === "failed" &&
            prev.settings.dial === msg["dial"] &&
            dialIn(prev) === msg["dial"];

          if (retry) {
            if (
              !same(
                asked.map((c) => c["dial"]),
                [msg["dial"]],
              ) ||
              !same(next.settings, { _tag: "reading", dial: msg["dial"] })
            ) {
              return `a tick on the failed dial asked ${JSON.stringify(asked)} and left ${JSON.stringify(next.settings)}`;
            }

            bump(met, "a failed read asked again");
          } else if (asked.length > 0) {
            return `${msg.type} asked ${JSON.stringify(asked)}`;
          } else if (msg.type === "settings_failed") {
            const mine = online(prev) && dialIn(prev) === msg["dial"];
            const expected = mine
              ? { ...prev, settings: { _tag: "failed", dial: msg["dial"], reason: msg["reason"] } }
              : prev;

            if (!same(next, expected) || cmds.length > 0) {
              return `settings_failed on ${String(msg["dial"])} while ${prev.link._tag} on ${String(dialIn(prev))} left ${JSON.stringify(next.settings)} or asked ${JSON.stringify(cmds)}`;
            }

            bump(met, mine ? "a failed read on the online dial" : "a stale failed read");
          } else if (goesOnline(x)) {
            if (!same(next.settings, { _tag: "reading", dial: dialIn(next) })) {
              return `going online left ${JSON.stringify(next.settings)}`;
            }
          } else {
            const open = socketDial(prev.link);
            const clears =
              (msg.type === "keys" || msg.type === "keys_failed") &&
              prev.settings._tag === "failed" &&
              open !== null &&
              open !== prev.settings.dial;
            const expected = clears ? { _tag: "reading", dial: open } : prev.settings;

            if (!same(next.settings, expected)) {
              return `${msg.type} moved settings ${JSON.stringify(prev.settings)} to ${JSON.stringify(next.settings)}`;
            }

            bump(met, "a failure cleared by a new dial", clears);
          }

          // Persistence: once, as a new grant goes online.
          if (msg.type === "granted" && prev.link._tag === "waiting_grant" && prev.link.dial === msg["dial"]) {
            fresh = true;
          }

          const persists = cmds.filter((c) => c.type === "persist").length;
          const due = fresh && goesOnline(x);

          if (persists !== (due ? 1 : 0)) {
            return `${msg.type} asked persistence ${persists} times, ${due ? "a new grant went online" : "with no new grant going online"}`;
          }

          fresh = fresh && !due;

          // trouble: a word for the last answer the window could not use, cleared going online.
          const trouble =
            (msg.type === "send_ok" && x.call !== null && (msg["value"] as Call)._tag === "refused") ||
            (msg.type === "send_err" && x.call !== null && (msg["error"] as Call)._tag !== "unreachable") ||
            (msg.type === "open_err" && x.call !== null) ||
            (msg.type === "write_err" && x.call?.call._tag === "open") ||
            (msg.type === "open_ok" &&
              x.call !== null &&
              x.client.asks.length > 0 &&
              online(prev) &&
              dialIn(prev) === msg["dial"]);

          if (
            goesOnline(x)
              ? next.trouble !== null
              : trouble
                ? typeof next.trouble !== "string"
                : next.trouble !== prev.trouble
          ) {
            return `${msg.type} left trouble ${String(next.trouble)} (was ${String(prev.trouble)})`;
          }

          if (msg.type === "send_ok" && trouble && next.trouble !== (msg["value"] as { reason?: unknown }).reason) {
            return `a refusal showed ${String(next.trouble)}, not its reason`;
          }

          bump(met, "a persistence asked", persists > 0);
          bump(met, "a slot dated again", msg.type === "resend" && cmds.some((c) => c.type === "now"));
          bump(met, "a removed key named to the socket", rejected !== null && open !== null);
          bump(met, "a trouble shown", trouble);
        }

        return null;
      },
      [
        "a failed read asked again",
        "a failed read on the online dial",
        "a stale failed read",
        "a failure cleared by a new dial",
        "a persistence asked",
        "a slot dated again",
        "a removed key named to the socket",
        "a trouble shown",
      ],
    ));

  it("local Msgs: a press and a routed key each ask one time, focus names a tile or none, key settings rebuild the table, a resize keeps the size, and none of them moves anything else", () =>
    holds(
      (run, met) => {
        for (const x of run) {
          const { prev, msg, next, cmds } = x;
          const rest = (s: S) => ({
            ...s,
            client: null,
            focus: null,
            armed: null,
            keys: null,
            keyError: null,
            size: null,
            via: null,
            settings: null,
          });

          if (msg.type === "press" || (msg.type === "key" && next.client.written > prev.client.written)) {
            if (cmds.length !== 1 || cmds[0]?.type !== "now" || cmds[0]["n"] !== prev.client.written) {
              return `${msg.type} asked ${JSON.stringify(cmds)}, not the time of slot ${prev.client.written}`;
            }
          }

          if (msg.type === "focus") {
            const known = x.tiles.some((t) => t.id === msg["tile"]);

            if (
              next.focus !== (known ? msg["tile"] : null) ||
              next.armed !== null ||
              !same(rest(next), rest(prev)) ||
              cmds.length > 0
            ) {
              return `focus ${String(msg["tile"])} left focus ${String(next.focus)} armed ${JSON.stringify(next.armed)}`;
            }
          }

          if (msg.type === "key") {
            const focused = x.tiles.find((t) => t.id === prev.focus) ?? null;
            const r = routeKey({
              table: prev.keys,
              armed: prev.armed,
              event: msg["event"] as never,
              tile: focused,
              commands: commands(focused?.pid ?? ""),
            });

            if (
              !same(next.armed, r.armed) ||
              (r.press === null && (cmds.length > 0 || !same(next.client, prev.client)))
            ) {
              return `key ${JSON.stringify(msg["event"])} left armed ${JSON.stringify(next.armed)}, routeKey ${JSON.stringify(r)}`;
            }

            bump(met, "a prefix armed", next.armed !== null);
          }

          if (msg.type === "keys") {
            if (
              !same(next.keys, Keys.buildTable(DEFAULTS, msg["rows"] as never)) ||
              next.armed !== null ||
              next.keyError !== null ||
              !same(rest(next), rest(prev)) ||
              cmds.length > 0
            ) {
              return `keys ${JSON.stringify(msg["rows"])} left ${JSON.stringify([next.keys, next.armed, next.keyError])}`;
            }
          }

          if (msg.type === "keys_failed") {
            if (
              !same(next.keyError, msg["error"]) ||
              !same(next.keys, prev.keys) ||
              next.armed !== null ||
              !same(rest(next), rest(prev)) ||
              cmds.length > 0
            ) {
              return `keys_failed left ${JSON.stringify([next.keyError, next.armed])}`;
            }
          }

          if (msg.type === "resized") {
            if (
              !same(next.size, { w: msg["w"], h: msg["h"] }) ||
              !same({ ...next, size: null }, { ...prev, size: null }) ||
              cmds.length > 0
            ) {
              return `resized left ${JSON.stringify(next.size)}`;
            }

            bump(met, "a resize to the same size", same(prev.size, next.size));
          }

          if (
            (msg.type === "seen" || msg.type === "identity") &&
            !same({ ...next, client: null }, { ...prev, client: null })
          ) {
            return `${msg.type} moved the window beside its client`;
          }

          bump(met, "a focused tile", next.focus !== null);
        }

        return null;
      },
      ["a prefix armed", "a resize to the same size", "a focused tile"],
    ));

  it("saved state: stopping at every message and booting from the saved Model gives the same run", () => {
    fc.assert(
      fc.property(Run, (r) => {
        const { layout, steps } = play(r);
        const machine = MACHINES[r.checks];
        syncTest(machine as never, ctxFor(layout) as never, {
          msgs: steps.map((s) => s.msg) as never,
          encode: Schema.encodeSync(machine.model as never),
          decode: (raw) => Schema.decodeUnknownSync(machine.model as never)(raw, { onExcessProperty: "error" }),
          equals: same,
          seed: SEED,
        });
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it("format: the Msgs the runner sends decode through the machine's own schema, and ones missing a field it reads do not", () => {
    // reason: format, these Msgs come from the runner in main.tsx; the generated runs only send
    // good ones, so the refusals are vectors.
    const decodes = (m: unknown) => Result.isSuccess(Schema.decodeUnknownResult(MACHINES[0].msg as never)(m));
    expect(decodes({ type: "admitted", dial: 1, ping: 0, ms: 1.5 })).toBe(true);
    expect(decodes({ type: "admitted", dial: 1, ping: 0 })).toBe(false);
    expect(decodes({ type: "stalled", dial: 1, ms: -1 })).toBe(false);
    expect(decodes({ type: "send_ok", dial: 1, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: 1 })).toBe(false);
    expect(decodes({ type: "settings_failed", reason: "x" })).toBe(false);
    expect(decodes({ type: "identity", found: "other" })).toBe(false);
  });
});
