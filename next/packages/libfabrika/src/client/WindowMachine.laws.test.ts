import { applyCell } from "@demlik/tea";
// P18 slice 1, next/ (ticket 290): the window parent, moved from Tuval into the library with its
// laws. P14 slice 2's laws (ticket 828: L8 connection, L9 records) keep every assertion (P18 L1); P18
// adds L3 (each frame reaches one owner), L6 (a cut Model continues the same), L10 (the wire's
// frame families) and L11 (a closed dial's connect row keeps its code), at the end of this file.
//
// The shape the P14 laws hold `client/WindowMachine.ts` to, from P14's plan (the build may add more):
// - `windowMachineFor({ decode, tile })`: one tea machine factory, whose ctx is `{ tiles: [{id, name}] }`.
//   `decode(pid)` is that pid's own view decoder (it returns the checked view or throws), passed to
//   libfabrika's client machine, which captures it. `tile(name)` is the tile machine of the window
//   registered for that tile, or undefined when it has none: a tea machine whose one Cmd is
//   `press {m}`, which the parent never runs but sends on as a letter. Init is the link's `dialing` on
//   dial 1, every tile `unresolved` with `own` its tile machine's init Model (`{}` without one) and
//   `refusal` null, and one `key {rejected: null}` Cmd.
// - Model `WindowModel`: {tiles: [{id, name, reach, own, refusal}], link, dials, client, serial,
//   flight: [{id, dial, call}], sent, attempts, patches, persist: not_due | due | asked, rejected,
//   trouble}. `reach` is unresolved{} | resolving{id} | opening{pid, id} | open{pid} | missing{}.
//   `refusal` is null or {m, reason}: the tile's last refused letter, until its next press.
// - A brain call is `write {call, id, dial}`, settling when its frame is handed over (A13). `call` is
//   read{stream, after} (ledger.read of `processes/<name>`), open{pid} (view.open), send{pid, letter,
//   n, m, sentAt, seen, traceId?} (process.send) or knock{}. The link's knock may also go out as the
//   link's own `knock` Cmd.
// - Msgs by `type`: the link's own (admitted, not_granted, granted, closed, retry, beat, pong,
//   stalled, renew, blocked, ask_again), each passed to the link machine; press{tile, m, via?}; a tile's
//   own Msg tile{id, msg}, stepped through that tile's machine, whose `press` Cmd becomes a press; a view
//   notice view{pid, note}; seen{rev}; resend{dial}; the socket's answers to writes, each naming its
//   write's {id, dial}: read_ok{value: entries, ms}, read_err{error}, open_ok{value: {rev, view}, ms},
//   open_err{error}, send_ok{value: accepted{rev, pos} | refused{reason}, ms}, send_err{error}; and
//   tea's answers to its Cmds, `<cmd>_ok {cmd, value}` and `<cmd>_err {cmd, error}`, for key (value
//   {found: created | reused | replaced}), now (value {letter, sentAt, traceId?}), write, persist
//   (value boolean), record and ping.
// - Cmds: write, now{n}, record{record}, persist{}, key{rejected}, ping, knock. A `record` carries
//   one libfabrika `ClientRecord`; its handler adds the row's id, tab, build and `sentAt` (L10). A
//   refused `reply` row carries `reason`: the answer's reason when it is a word (/^[a-z_]{1,40}$/),
//   else `other`. No input text reaches a row.
//
// The walk starts at the real init and folds the real update. Each step reads the folded model and the
// walk's ledger of what is really waiting (the writes in flight, the Cmds not answered yet, the old
// dials' flights) and picks one move possible there: a socket event legal for the link's state, an
// answer to a current flight, a stale answer to an old one, a timer, a press, a tile's own Msg legal for
// its Model, a view notice built from a list program's real edits and the real `diff`, or a Cmd's
// answer. The tiles are the checklist's tile shape (a draft and a submit that presses `add`), a second
// generated tile machine, and a tile with none. Tuval may not import a program, so the checklist's own
// tile is stepped through its registration in the checklist's laws (L22, L24).
import { Cmd as TeaCmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Option, Schema } from "effect";
import * as fc from "fast-check";
import { diff } from "../runtime/Patch.ts";
import { ClientRecord } from "../transport/ClientRows.ts";
import { linkTimer } from "../transport/Link.ts";
import { type WindowModel, type WindowMsg, windowMachineFor } from "./WindowMachine.ts";

const SEED = 119120;
const opts = { seed: SEED, numRuns: 300 };
const NAMES = ["checklist:1", "tally:1", "plain:1"] as const;
const TILES = NAMES.map((name, i) => ({ id: `tile_${i + 1}`, name }));

/** A list view, the checklist's own shape cut to what a parent law reads. */
const ListView = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.Literals(["open", "checked"]) })),
  left: Schema.Int,
});
type ListView = typeof ListView.Type;
const EMPTY: ListView = { items: [], left: 0 };

const press = TeaCmd.make("press", { input: Schema.Struct({ m: Schema.Json }), ok: Schema.Null, err: [] });

/** The checklist tile's shape: a draft, and a submit that presses `add` with it. */
const draftTile = Machine.make({
  model: Schema.Struct({ draft: Schema.String }),
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("typed"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("submit") }),
  ]),
  cmds: [press],
  init: () => [{ draft: "" }, []],
  update: {
    typed: (_s, m) => [{ draft: m.text }, []],
    submit: (s) => (s.draft === "" ? [s, []] : [{ draft: "" }, [press({ m: { type: "add", name: s.draft } })]]),
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
  },
});

/** A second tile machine: it counts bumps and presses `check` on the item it counted to. */
const tallyTile = Machine.make({
  model: Schema.Struct({ n: Schema.Int }),
  msg: Schema.Union([Schema.Struct({ type: Schema.Literal("bump") }), Schema.Struct({ type: Schema.Literal("go") })]),
  cmds: [press],
  init: () => [{ n: 0 }, []],
  update: {
    bump: (s) => [{ n: s.n + 1 }, []],
    go: (s) => [{ n: 0 }, [press({ m: { type: "check", name: `item ${s.n}` } })]],
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
  },
});

const TILE_MACHINES: Readonly<Record<string, typeof draftTile | typeof tallyTile>> = {
  "checklist:1": draftTile,
  "tally:1": tallyTile,
};

const tileFor = (name: string) => TILE_MACHINES[name];
const machine = windowMachineFor({ decode: () => Schema.decodeUnknownSync(ListView), tile: tileFor });
const ctx = { tiles: TILES };

/** Refusal reasons: the program's words, other words, and free text a reply row must not copy. */
const REASONS = ["taken", "missing", "bad_msg", "too_many", "Not A Word!", "has space", "x".repeat(41)] as const;
const isWord = (reason: string) => /^[a-z_]{1,40}$/.test(reason);
/** What the walk's presses name: items, so a pressed letter's body is the program's Msg. */
const POOL = ["milk", "bread", "eggs"] as const;
/** A typed draft is marked, so a row or an unsent write that copies it shows. */
const DRAFT = "draft~";

type Cmd = { readonly type: string; readonly [key: string]: unknown };
type Call = { readonly _tag: string; readonly [key: string]: unknown };
type Write = { readonly type: "write"; readonly call: Call; readonly id: number; readonly dial: number };
type Row = { readonly _tag: string; readonly [key: string]: unknown };

const step = (s: WindowModel, m: WindowMsg): readonly [WindowModel, ReadonlyArray<Cmd>] => applyCell(machine, s, m);
const isWrite = (c: Cmd): c is Write => c.type === "write";
const recordIn = (c: Cmd): Row | null => (c.type === "record" ? (c["record"] as Row) : null);

const socketDial = (s: WindowModel): number | null =>
  s.link._tag === "dialing" || s.link._tag === "waiting_grant" || s.link._tag === "online" ? s.link.dial : null;

const linkDial = (s: WindowModel): number | null => ("dial" in s.link ? s.link.dial : null);

/** A list program per pid, so a notice is a real edit's whole or patch, array ops included. */
type Brain = { rev: number; views: Array<ListView> };

const listEdit = (v: ListView, aux: number, word: string): ListView => {
  const i = v.items.length === 0 ? 0 : aux % v.items.length;
  const items =
    v.items.length === 0 || aux % 3 === 0
      ? [...v.items, { name: word, state: "open" as const }]
      : aux % 3 === 1
        ? v.items.filter((_, j) => j !== i)
        : v.items.map((it, j) => (j === i ? { ...it, state: "checked" as const } : it));
  return { items, left: items.filter((it) => it.state === "open").length };
};

const choice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  aux: fc.nat(),
  ms: fc.integer({ min: 0, max: 20_000 }),
  word: fc.stringMatching(/^[a-z0-9]{6}$/),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;
const walks = fc.array(choice, { minLength: 1, maxLength: 240, size: "max" });

/** What the walk knows beside the model: what is really waiting, and what it already delivered. */
type World = {
  s: WindowModel;
  waiting: Array<Cmd>; // tea Cmds handed out and not answered yet
  flights: Array<Write>; // writes the brain has, by id and dial, not answered yet
  old: Array<Write>; // writes of ended dials or already answered: their answers are stale
  brains: Map<string, Brain>; // by pid
  pids: Map<string, string>; // by tile name: the live process the brain has for it
  dials: number;
  from: Map<number, string>; // by Client slot: the tile whose press made that letter
  typed: Set<string>; // every draft text typed into a tile
  submitted: Set<string>; // the drafts a submit pressed as a letter
};

type Event = {
  readonly prev: WindowModel;
  readonly m: WindowMsg;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly world: World;
};

const brainFor = (w: World, pid: string): Brain => {
  const b = w.brains.get(pid) ?? { rev: 0, views: [EMPTY] };
  w.brains.set(pid, b);
  return b;
};

const OUTCOMES = ["accepted", "refused"] as const;

/** Every move the world allows now, made only when picked. */
const moves = (w: World, c: Choice): ReadonlyArray<() => WindowMsg> => {
  const s = w.s;
  const out: Array<() => WindowMsg> = [];
  const dial = socketDial(s);
  const timer = linkTimer(s.link);
  const fingerprint = `SHA256:${c.word}`;

  if (timer !== null) {
    out.push(() => timer.msg);
  }

  if (s.link._tag === "dialing") {
    const d = s.link.dial;
    out.push(
      () => ({ type: "admitted", dial: d, ping: 30_000, ms: c.ms }),
      () => ({ type: "not_granted", dial: d, fingerprint, code: c.word.slice(0, 4), until: c.ms, ms: c.ms }),
    );

    // Favor admission enough to finish several letters before a generated drop.
    for (let n = 0; n < 8; n++) {
      out.push(() => ({ type: "admitted", dial: d, ping: 30_000, ms: c.ms }));
    }
  }

  if (s.link._tag === "waiting_grant") {
    const d = s.link.dial;
    out.push(() => ({ type: "granted", dial: d }));
  }

  if (s.link._tag === "online") {
    const d = s.link.dial;
    out.push(() => ({ type: "pong", dial: d }));
  }

  if (dial !== null) {
    out.push(() => ({ type: "closed", dial, code: c.aux % 3 === 0 ? 4003 : 1006, fingerprint, ms: c.ms }));
  }

  if (s.link._tag === "removed") {
    out.push(() => ({ type: "ask_again", dial: w.dials + 1 }));
  }

  // A press on a tile, open or not: only an open tile's press may become a letter.
  const tile = s.tiles[c.pick % s.tiles.length]!;
  out.push(() => ({
    type: "press",
    tile: tile.id,
    m: { type: ["check", "uncheck", "remove"][c.aux % 3]!, name: POOL[c.ms % POOL.length]! },
  }));
  const openedTiles = s.tiles.filter((t) => t.reach._tag === "open");

  if (openedTiles.length > 0) {
    const opened = openedTiles[c.pick % openedTiles.length]!;
    out.push(() => ({ type: "press", tile: opened.id, m: { type: "add", name: c.word } }));
  }

  const refusedTiles = openedTiles.filter((t) => t.refusal !== null);

  if (refusedTiles.length > 0) {
    const refused = refusedTiles[c.pick % refusedTiles.length]!;
    out.push(() => ({ type: "press", tile: refused.id, m: { type: "add", name: c.word } }));
  }

  // A tile's own Msg, legal for its machine's Model now.
  const own = s.tiles.filter((t) => tileFor(t.name) !== undefined);

  if (own.length > 0) {
    const t = own[c.aux % own.length]!;

    if (t.name === "checklist:1") {
      const draft = c.ms % 5 === 0 ? "" : `${DRAFT}${c.word}`;
      out.push(
        () => {
          w.typed.add(draft);
          return { type: "tile", id: t.id, msg: { type: "typed", text: draft } };
        },
        () => ({ type: "tile", id: t.id, msg: { type: "submit" } }),
      );
    } else {
      out.push(
        () => ({ type: "tile", id: t.id, msg: { type: "bump" } }),
        () => ({ type: "tile", id: t.id, msg: { type: "go" } }),
      );
    }
  }

  out.push(() => ({ type: "seen", rev: c.ms % 50 }));

  if (dial !== null) {
    out.push(() => ({ type: "resend", dial }));
  }

  // A view notice for an open tile's pid: its program steps (a patch) or is shown whole; or an old one.
  const open = s.tiles.flatMap((t) => (t.reach._tag === "open" || t.reach._tag === "opening" ? [t.reach.pid] : []));

  if (open.length > 0) {
    const pid = open[c.pick % open.length]!;
    out.push(() => {
      const b = brainFor(w, pid);
      const before = b.views[b.rev]!;
      const after = listEdit(before, c.aux, POOL[c.ms % POOL.length]!);
      b.views.push(after);
      b.rev += 1;
      return { type: "view", pid, note: { type: "patch", base: b.rev - 1, rev: b.rev, patch: diff(before, after) } };
    });
    out.push(() => {
      const b = brainFor(w, pid);
      return { type: "view", pid, note: { type: "whole", rev: b.rev, view: b.views[b.rev] } };
    });
    out.push(() => ({ type: "view", pid, note: { type: "whole", rev: 1, view: { items: "bad", left: 0 } } }));
  }

  // Answers to the writes the brain has, on their own id and dial.
  if (w.flights.length > 0) {
    const unsettled = w.flights.filter((f) => s.flight.some((live) => live.id === f.id && live.dial === f.dial));
    const letters = unsettled.filter((f) => f.call._tag === "send");
    const available = c.aux % 4 !== 0 && letters.length > 0 ? letters : w.flights;
    const f = available[c.pick % available.length]!;
    const on = { id: f.id, dial: f.dial };

    if (f.call._tag === "read") {
      const name = String(f.call["stream"]).replace(/^processes\//, "");
      out.push(() => {
        const live = c.aux % 4 === 0 ? null : (w.pids.get(name) ?? `process_${name}_${c.word}`);
        const entries =
          live === null
            ? []
            : [{ _tag: "started", by: "brain", body: { process: live, name }, rev: 1, arrivedAt: "t" }];

        if (live !== null) {
          w.pids.set(name, live);
        }

        return { type: "read_ok", ...on, value: entries, ms: c.ms };
      });
      out.push(() => ({ type: "read_err", ...on, error: { _tag: "unreachable" } }));
    } else if (f.call._tag === "open") {
      const pid = String(f.call["pid"]);
      out.push(() => {
        const b = brainFor(w, pid);
        return { type: "open_ok", ...on, value: { rev: b.rev, view: b.views[b.rev]! }, ms: c.ms };
      });
      out.push(() => ({ type: "open_err", ...on, error: { _tag: "unknown" } }));
    } else if (f.call._tag === "send") {
      out.push(() => ({
        type: "send_ok",
        ...on,
        value:
          OUTCOMES[c.aux % 2] === "accepted"
            ? { _tag: "accepted", rev: c.ms, pos: c.aux }
            : { _tag: "refused", reason: REASONS[c.ms % REASONS.length]! },
        ms: c.ms,
      }));
      out.push(() => ({ type: "send_err", ...on, error: { _tag: c.aux % 2 === 0 ? "unreachable" : "unknown" } }));
    }
  }

  // A stale answer: to a write of an ended dial, or one already answered.
  if (w.old.length > 0) {
    const f = w.old[c.pick % w.old.length]!;
    const on = { id: f.id, dial: f.dial };
    out.push(() =>
      f.call._tag === "open"
        ? { type: "open_ok", ...on, value: { rev: 0, view: EMPTY }, ms: c.ms }
        : f.call._tag === "send"
          ? { type: "send_ok", ...on, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: c.ms }
          : { type: "read_ok", ...on, value: [], ms: c.ms },
    );
    const current = w.flights[c.aux % Math.max(1, w.flights.length)];
    const oldDial = w.old.find((old) => old.dial !== current?.dial)?.dial;

    if (current !== undefined && oldDial !== undefined) {
      // A current id on an ended dial must not match. Ids alone are insufficient.
      out.push(() =>
        current.call._tag === "open"
          ? { type: "open_ok", id: current.id, dial: oldDial, value: { rev: 0, view: EMPTY }, ms: c.ms }
          : current.call._tag === "send"
            ? { type: "send_ok", id: current.id, dial: oldDial, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: c.ms }
            : { type: "read_ok", id: current.id, dial: oldDial, value: [], ms: c.ms },
      );
    }
  }

  // tea's answers to the Cmds handed out and not answered yet.
  if (w.waiting.length > 0) {
    const due = w.waiting.filter((cmd) => ["key", "now", "persist"].includes(cmd.type));
    const available = c.aux % 4 !== 0 && due.length > 0 ? due : w.waiting;
    const cmd = available[c.pick % available.length]!;
    const ok = c.aux % 5 !== 0;
    const answer = (value: unknown, error: unknown) => (): WindowMsg =>
      (ok ? { type: `${cmd.type}_ok`, cmd, value } : { type: `${cmd.type}_err`, cmd, error }) as WindowMsg;

    if (cmd.type === "key") {
      out.push(
        answer(
          {
            found: cmd["rejected"] === null ? (c.aux % 2 === 0 ? "created" : "reused") : "replaced",
            fingerprint: `SHA256:${c.word}`,
          },
          { _tag: "ClientKeyError", op: "open", error: "QuotaExceededError" },
        ),
      );
    } else if (cmd.type === "now") {
      out.push(
        answer(
          {
            letter: `letter_${c.word}_${c.ms}`,
            sentAt: `2026-11-11T00:00:00.${String(c.ms % 1000).padStart(3, "0")}Z`,
          },
          { _tag: "clock" },
        ),
      );
    } else if (cmd.type === "write") {
      out.push(answer(null, { _tag: "unreachable" }));
    } else if (cmd.type === "persist") {
      out.push(answer(c.aux % 2 === 0, { _tag: "unsupported" }));
    } else {
      out.push(answer(null, { _tag: "failed" }));
    }
  }

  return out;
};

/** Folds a walk, keeping the world beside the model, and hands each step to `each`. */
const fold = (list: ReadonlyArray<Choice>, each: (e: Event) => void): World => {
  const [s0, cmds0] = machine.init(null, ctx);
  const w: World = {
    s: s0,
    waiting: [],
    flights: [],
    old: [],
    brains: new Map(),
    pids: new Map(),
    dials: 1,
    from: new Map(),
    typed: new Set(),
    submitted: new Set(),
  };
  const handOut = (cmds: ReadonlyArray<Cmd>) => {
    for (const cmd of cmds) {
      if (["key", "now", "write", "persist", "record"].includes(cmd.type)) {
        w.waiting.push(cmd);
      }

      if (isWrite(cmd)) {
        w.flights.push(cmd);
      }
    }
  };
  handOut(cmds0);
  each({ prev: s0, m: { type: "seen", rev: 0 }, next: s0, cmds: cmds0, world: w });

  for (const c of list) {
    const options = moves(w, c);
    const m = options[c.move % options.length]!();
    const prev = w.s;
    const [next, cmds] = step(prev, m);
    // The world after the step: an answered Cmd waits no more; a socket answer ends its flight.
    w.waiting = w.waiting.filter((cmd) => !("cmd" in m) || m.cmd !== cmd);

    if (m.type === "write_err") {
      // A frame that could not be handed over never reached the brain.
      const lost = w.flights.find((f) => f.id === m.cmd.id && f.dial === m.cmd.dial);
      w.flights = w.flights.filter((f) => f !== lost);
      w.old.push(...(lost === undefined ? [] : [lost]));
    }

    if ("id" in m && typeof m.id === "number" && "dial" in m) {
      const answer = m;
      const answered = w.flights.find((f) => f.id === answer.id && f.dial === answer.dial);

      if (answered !== undefined) {
        w.flights = w.flights.filter((f) => f !== answered);
        w.old.push(answered);
      }
    }

    // A dial whose socket ended takes its flights with it: their answers can only be stale now.
    const open = socketDial(next);
    w.old.push(...w.flights.filter((f) => f.dial !== open));
    w.flights = w.flights.filter((f) => f.dial === open);
    handOut(cmds);
    w.dials = Math.max(w.dials, linkDial(next) ?? 0, next.dials);

    // A new letter is from the tile that pressed it, by a button or through its own machine's press.
    for (const p of next.client.pending.filter((p) => p.n >= prev.client.written)) {
      w.from.set(p.n, m.type === "press" ? m.tile : m.type === "tile" ? m.id : "?");

      if (m.type === "tile") {
        const sent: unknown = Reflect.get(Object(p.m), "name");
        w.submitted.add(typeof sent === "string" ? sent : "");
      }
    }

    w.s = next;
    each({ prev, m, next, cmds, world: w });
  }

  return w;
};

const writes = (cmds: ReadonlyArray<Cmd>, tag: string) => cmds.filter(isWrite).filter((c) => c.call._tag === tag);

describe("L8: the window parent's connection", () => {
  it("L8 scenario: going online reads each tile's processes/<name> once on that dial, and opens each resolved pid once per dial", () => {
    const seen = { online: 0, opened: 0, missing: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        const reads = new Map<string, number>(); // `${dial} ${stream}`
        const opens = new Map<string, number>(); // `${dial} ${pid}`
        const asks = new Map<string, number>();
        fold(list, ({ prev, m, next, cmds }) => {
          if (prev.link._tag !== "online" && next.link._tag === "online") {
            seen.online++;
            const d = next.link.dial;
            expect(
              writes(cmds, "read")
                .map((c) => [c.dial, c.call["stream"]])
                .sort(),
            ).toEqual(NAMES.map((n) => [d, `processes/${n}`]).sort());
            expect(next.tiles.every((t) => t.reach._tag === "resolving")).toBe(true);
          }

          for (const c of writes(cmds, "read")) {
            const key = `${c.dial} ${String(c.call["stream"])}`;
            reads.set(key, (reads.get(key) ?? 0) + 1);
            expect(reads.get(key), `${key} read twice on one dial`).toBe(1);
          }

          for (const r of cmds.map(recordIn)) {
            if (r?._tag === "view" && r["result"] === "asked") {
              const key = `${linkDial(next)} ${String(r["pid"])}`;
              asks.set(key, (asks.get(key) ?? 0) + 1);
            }
          }

          for (const c of writes(cmds, "open")) {
            seen.opened++;
            const key = `${c.dial} ${String(c.call["pid"])}`;
            opens.set(key, (opens.get(key) ?? 0) + 1);
            expect(opens.get(key)!, `${key} opened past once and its asks`).toBeLessThanOrEqual(
              1 + (asks.get(key) ?? 0),
            );
            expect(c.dial).toBe(socketDial(next));
          }

          if (m.type === "read_ok" && Array.isArray(m.value) && m.value.length === 0) {
            const tile = prev.tiles.find((t) => t.reach._tag === "resolving" && t.reach.id === m.id);

            if (tile !== undefined && prev.link._tag === "online" && prev.link.dial === m.dial) {
              seen.missing++;
              expect(next.tiles.find((t) => t.id === tile.id)?.reach._tag, "no live pid is missing").toBe("missing");
            }
          }
        });
      }),
      opts,
    );
    expect(seen.online).toBeGreaterThan(0);
    expect(seen.opened).toBeGreaterThan(0);
    expect(seen.missing).toBeGreaterThan(0);
  });

  it("L8 scenario: leaving a dial drops its flights and every tile's reach, and keeps every letter", () => {
    let left = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, next }) => {
          const open = socketDial(next);
          expect(
            next.flight.every((f) => f.dial === open),
            "a flight outlived its dial",
          ).toBe(true);

          if (socketDial(prev) !== null && socketDial(prev) !== open) {
            left++;
            expect(next.flight).toEqual([]);
            expect(next.sent).toEqual([]);
            expect(next.tiles.every((t) => t.reach._tag === "unresolved")).toBe(true);
            expect(next.client.pending, "a dial's end dropped a letter").toEqual(prev.client.pending);
          }
        });
      }),
      opts,
    );
    expect(left).toBeGreaterThan(0);
  });

  it("L8 scenario: Ask again dials past every old dial and asks the key store to replace only the removed key", () => {
    let asked = 0;
    fc.assert(
      fc.property(walks, (list) => {
        let highest = 1;
        fold(list, ({ prev, m, next, cmds }) => {
          const asking = prev.link._tag === "removed" && m.type === "ask_again" ? prev.link : null;
          asked += asking === null ? 0 : 1;
          expect(
            asking === null
              ? null
              : [next.link._tag, (linkDial(next) ?? 0) > highest, cmds.filter((c) => c.type === "key")],
          ).toEqual(asking === null ? null : ["dialing", true, [{ type: "key", rejected: asking.fingerprint }]]);

          highest = Math.max(highest, linkDial(next) ?? 0);
        });
      }),
      opts,
    );
    expect(asked).toBeGreaterThan(0);
  });

  it("L8 scenario: persistence is asked once, at the first online after a fresh grant", () => {
    let grants = 0;
    fc.assert(
      fc.property(walks, (list) => {
        let due = false;
        fold(list, ({ prev, m, next, cmds }) => {
          const persists = cmds.filter((c) => c.type === "persist").length;

          const granted = m.type === "granted" && prev.link._tag === "waiting_grant" && prev.link.dial === m.dial;
          grants += granted ? 1 : 0;
          due = due || granted;
          const first = prev.link._tag !== "online" && next.link._tag === "online" && due;
          expect(persists, `${m.type} asked persistence`).toBe(first ? 1 : 0);
          expect(granted || first ? next.persist : null).toBe(granted ? "due" : first ? "asked" : null);
          due = due && !first;
        });
      }),
      opts,
    );
    expect(grants).toBeGreaterThan(0);
  });

  it("L8 scenario: a write settles at hand-off: write_ok changes nothing, write_err frees its flight, and no step waits on an answer", () => {
    const seen = { ok: 0, err: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next }) => {
          seen.ok += m.type === "write_ok" ? 1 : 0;
          seen.err += m.type === "write_err" ? 1 : 0;
          expect(m.type === "write_ok" ? next : null, "a handed-over write moved the window").toEqual(
            m.type === "write_ok" ? prev : null,
          );
          const lost = m.type === "write_err" ? m.cmd : null;
          expect(lost !== null && next.flight.some((f) => f.id === lost.id && f.dial === lost.dial)).toBe(false);
        });
      }),
      opts,
    );
    expect(seen.ok).toBeGreaterThan(0);
    expect(seen.err).toBeGreaterThan(0);
  });

  it("L8 scenario: an answer that matches no flight's id and dial does nothing", () => {
    let stale = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (!["read_ok", "read_err", "open_ok", "open_err", "send_ok", "send_err"].includes(m.type)) {
            return;
          }

          const on = m as { readonly id: number; readonly dial: number };

          if (prev.flight.some((f) => f.id === on.id && f.dial === on.dial)) {
            return;
          }

          stale++;
          expect(next, `${m.type} ${on.id}@${on.dial} moved the window`).toEqual(prev);
          expect(cmds).toEqual([]);
        });
      }),
      opts,
    );
    expect(stale).toBeGreaterThan(0);
  });

  it("L8 scenario: invalid recovery-open answers keep the last checked view and ask once until a valid whole arrives", () => {
    let recovered = 0;
    fc.assert(
      fc.property(walks, fc.array(choice, { minLength: 2, maxLength: 8 }), (list, failures) => {
        let checked = false;
        fold(list, ({ next }) => {
          const tile = next.tiles.find((t) => t.reach._tag === "open");

          if (checked || next.link._tag !== "online" || tile?.reach._tag !== "open") {
            return;
          }

          checked = true;
          recovered++;
          const pid = tile.reach.pid;
          const dial = next.link.dial;
          let state = next;
          let shown = state.client.views[pid]!;

          // A checked whole ends an episode. The next bad view may ask once again.
          for (let episode = 0; episode < 2; episode++) {
            let opens = 0;

            for (const c of failures) {
              const flight = state.flight.find((f) => f.call._tag === "open" && f.call.pid === pid);
              const index = c.aux % 3;
              const view = (
                [
                  { items: null, left: 0 },
                  { ...(shown.view as ListView), left: c.word },
                  { items: [{ name: c.word, state: "invalid" }], left: 1 },
                ] satisfies readonly [Schema.Json, Schema.Json, Schema.Json]
              )[index === 0 ? 0 : index === 1 ? 1 : 2];
              const value = { rev: shown.rev + 1, view };
              const m: WindowMsg =
                flight === undefined
                  ? { type: "view", pid, note: { type: "whole", ...value } }
                  : { type: "open_ok", id: flight.id, dial: flight.dial, value, ms: c.ms };
              const [after, cmds] = step(state, m);
              opens += writes(cmds, "open").filter((c) => c.call["pid"] === pid).length;
              expect(after.client.views[pid], "an invalid recovery changed the checked view").toEqual(shown);
              expect(opens, "bad recovery answers must not start replacement opens").toBe(1);
              state = after;
            }

            const value = { rev: shown.rev + 1, view: listEdit(shown.view as ListView, episode, "recovered") };
            const [after] = step(state, { type: "view", pid, note: { type: "whole", ...value } });
            expect(after.client.views[pid]).toEqual(value);
            expect(after.link).toEqual(next.link);
            expect(after.flight.filter((f) => f.dial === dial && f.call._tag === "open" && f.call.pid === pid)).toEqual(
              [],
            );
            state = after;
            shown = state.client.views[pid]!;
          }
        });
      }),
      opts,
    );
    expect(recovered, "the walks reached checked views before the recovery failures").toBeGreaterThan(0);
  });

  it("L8 scenario: A14: a notice that installs a pid's view ends that pid's open, so its late answer is stale", () => {
    let raced = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next }) => {
          if (m.type !== "view" || next.client.views[m.pid] === prev.client.views[m.pid]) {
            return;
          }

          const opening = prev.flight.filter((f) => f.call._tag === "open" && f.call.pid === m.pid);
          raced += opening.length;
          expect(next.flight.filter((f) => f.call._tag === "open" && f.call.pid === m.pid)).toEqual([]);

          for (const f of opening) {
            const late = step(next, {
              type: "open_ok",
              id: f.id,
              dial: f.dial,
              value: { rev: 0, view: EMPTY },
              ms: 1,
            });
            expect(late[0], "a late open rolled the view back").toEqual(next);
          }
        });
      }),
      opts,
    );
    expect(raced).toBeGreaterThan(0);
  });

  it("L8 scenario: a press on a tile that is not open makes no letter; an open tile's press keeps its pid", () => {
    const seen = { open: 0, closed: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "press") {
            return;
          }

          const reach = prev.tiles.find((t) => t.id === m.tile)?.reach;

          const open = reach?._tag === "open" ? reach : null;
          seen[open === null ? "closed" : "open"]++;
          expect(open === null ? {} : next.client.pending.at(-1)).toMatchObject(
            open === null ? {} : { _tag: "dating", pid: open.pid, n: prev.client.written },
          );
          expect(cmds.filter((c) => c.type === "now")).toEqual(
            open === null ? [] : [{ type: "now", n: prev.client.written }],
          );
          expect(open === null ? next.client : null, "a closed tile's press made a letter").toEqual(
            open === null ? prev.client : null,
          );
        });
      }),
      opts,
    );
    expect(seen.open).toBeGreaterThan(0);
    expect(seen.closed).toBeGreaterThan(0);
  });

  it("L8 scenario: a tile's own Msg steps only that tile's machine, and its press Cmd becomes exactly one Client press for that tile's pid", () => {
    const seen = { stepped: 0, pressed: 0, closed: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "tile") {
            return;
          }

          const before = prev.tiles.find((t) => t.id === m.id)!;
          const tileMachine = tileFor(before.name)!;
          const [own, out] = applyCell(tileMachine, before.own as never, m.msg as never) as readonly [
            unknown,
            ReadonlyArray<Cmd>,
          ];
          seen.stepped++;
          const blockedPress = before.reach._tag !== "open" && out.some((c) => c.type === "press");
          expect(
            next.tiles.find((t) => t.id === m.id)!.own,
            "a blocked submit keeps the draft until it can send",
          ).toEqual(blockedPress ? before.own : own);
          expect(
            next.tiles.filter((t) => t.id !== m.id).map((t) => t.own),
            "another tile's Model moved",
          ).toEqual(prev.tiles.filter((t) => t.id !== m.id).map((t) => t.own));
          expect(
            cmds.filter((c) => c.type === "press"),
            "a tile machine's press left the parent as a Cmd",
          ).toEqual([]);

          const pressed = out.filter((c) => c.type === "press");
          const open = before.reach._tag === "open" ? before.reach : null;
          const letters = next.client.pending.filter((p) => p.n >= prev.client.written);

          if (pressed.length === 0 || open === null) {
            seen.closed += pressed.length > 0 ? 1 : 0;
            expect(next.client, "no press, or a tile that is not open, made a letter").toEqual(prev.client);
            return;
          }

          seen.pressed++;
          expect(letters).toEqual([
            {
              _tag: "dating",
              n: prev.client.written,
              pid: open.pid,
              m: pressed[0]!["m"],
              seen: prev.client.seen,
              viewRev: prev.client.views[open.pid]?.rev ?? 0,
            },
          ]);
          expect(cmds.filter((c) => c.type === "now")).toEqual([{ type: "now", n: prev.client.written }]);
        });
      }),
      opts,
    );
    expect(seen.stepped).toBeGreaterThan(0);
    expect(seen.pressed).toBeGreaterThan(0);
    expect(seen.closed, "some tile presses came while the tile was not open").toBeGreaterThan(0);
  });

  it("L8 scenario: a tile's refusal is set only by a refused reply to its own letter, and cleared by its next press", () => {
    const seen = { set: 0, cleared: 0, others: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, world }) => {
          const answer = m;
          const flight =
            "id" in answer && typeof answer.id === "number" && "dial" in answer
              ? prev.flight.find((f) => f.id === answer.id && f.dial === answer.dial)
              : undefined;
          const call = flight?.call;
          const refusedLetter =
            m.type === "send_ok" && call?._tag === "send" && m.value._tag === "refused"
              ? prev.client.pending.find((p) => p._tag === "ready" && p.letter === call["letter"])
              : undefined;
          const owner = refusedLetter === undefined ? undefined : world.from.get(refusedLetter.n);
          const made = next.client.pending.filter((p) => p.n >= prev.client.written);
          const aimed = m.type === "press" ? m.tile : m.type === "tile" ? m.id : null;

          for (const t of next.tiles) {
            const was = prev.tiles.find((x) => x.id === t.id)!.refusal;
            const pressedHere = made.some((p) => world.from.get(p.n) === t.id);

            const own = refusedLetter !== undefined && owner === t.id;
            seen.set += own ? 1 : 0;
            seen.others += !own && refusedLetter !== undefined ? 1 : 0;
            seen.cleared += !own && pressedHere && was !== null ? 1 : 0;

            const [allowed, label]: readonly [ReadonlyArray<unknown>, string] = own
              ? [
                  [
                    {
                      m: refusedLetter.m,
                      reason: (m as { readonly value: { readonly reason: string } }).value.reason,
                    },
                  ],
                  `${t.id}'s own refused letter`,
                ]
              : pressedHere
                ? [[null], `${t.id}'s next press clears its refusal`]
                : aimed === t.id && made.length === 0
                  ? // A press that made no letter (the tile is not open) may clear the words or keep them.
                    [[was, null], `${t.id} after a press that sent nothing`]
                  : [[was], `${t.id} after ${m.type}`];
            expect(allowed, label).toContainEqual(t.refusal);
          }
        });
      }),
      opts,
    );
    expect(seen.set).toBeGreaterThan(0);
    expect(seen.cleared, "a refusal was cleared by its tile's next press").toBeGreaterThan(0);
    expect(seen.others, "a refusal for one tile left the other tiles alone").toBeGreaterThan(0);
  });

  it("L8 scenario: the tile's own Model never leaves the tab: no record holds a draft, and no write holds one never submitted", () => {
    let typed = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ cmds, world }) => {
          typed = Math.max(typed, world.typed.size);

          for (const c of cmds) {
            const text = JSON.stringify(c);
            const drafts = [...world.typed].filter((d) => d !== "" && text.includes(d));

            const recorded = c.type === "record" ? drafts : [];
            const unsent = isWrite(c) ? drafts.filter((d) => !world.submitted.has(d)) : [];
            expect(recorded, "a record copied typed text").toEqual([]);
            expect(unsent, "a write carried a draft nobody submitted").toEqual([]);
          }
        });
      }),
      opts,
    );
    expect(typed).toBeGreaterThan(0);
  });
});

describe("L9: the records the window emits", () => {
  it("L9 scenario: a failed record attempts one failure row and keeps the window working without retrying a failed failure row", () => {
    let failed = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "record_err") {
            return;
          }

          failed++;
          expect(next, "a store failure changed the window").toEqual(prev);
          expect(cmds).toEqual(
            m.cmd.record._tag === "failure"
              ? []
              : [{ type: "record", record: { _tag: "failure", op: "record", error: "other" } }],
          );
        });
      }),
      opts,
    );
    expect(failed, "the walks failed record writes").toBeGreaterThan(0);
  });

  it("L9 scenario: each record Cmd carries one checked ClientRecord and nothing else", () => {
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ cmds }) => {
          for (const c of cmds.filter((c) => c.type === "record")) {
            expect(Object.keys(c).sort()).toEqual(["record", "type"]);
            expect(Schema.is(ClientRecord)(c["record"]), JSON.stringify(c)).toBe(true);
          }
        });
      }),
      opts,
    );
  });

  it("L9 scenario: one key row per key read, one connect row per link outcome with its ms, one persist row per answer", () => {
    const seen = { key: 0, connect: 0, persist: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          const rows = cmds.map(recordIn).filter((r): r is Row => r !== null);
          const keys = rows.filter((r) => r._tag === "key");
          const connects = rows.filter((r) => r._tag === "connect");
          const persists = rows.filter((r) => r._tag === "persist" || (r._tag === "failure" && r["op"] === "persist"));

          seen.key += m.type === "key_ok" ? 1 : 0;
          expect(keys).toEqual(m.type === "key_ok" ? [{ _tag: "key", result: m.value.found }] : []);

          const outcome =
            prev.link._tag !== "online" && next.link._tag === "online"
              ? "online"
              : prev.link._tag !== "waiting_grant" && next.link._tag === "waiting_grant"
                ? "waiting"
                : prev.link._tag !== "removed" && next.link._tag === "removed"
                  ? "removed"
                  : prev.link._tag !== "retrying" && next.link._tag === "retrying"
                    ? m.type === "closed"
                      ? "closed"
                      : "stalled"
                    : null;

          const connected = outcome !== null && "ms" in m && "dial" in m ? { dial: m.dial, ms: m.ms } : null;
          seen.connect += connected === null ? 0 : 1;
          expect(connects, `${m.type}'s connect rows`).toEqual(
            connected === null
              ? []
              : [
                  {
                    _tag: "connect",
                    dial: connected.dial,
                    result: outcome,
                    ms: connected.ms,
                    // P18 L11: a closed dial's row also keeps the close code it saw.
                    ...(m.type === "closed" ? { code: m.code } : {}),
                  },
                ],
          );
          const answered = m.type === "persist_ok" || m.type === "persist_err";
          seen.persist += answered ? 1 : 0;
          expect(persists).toHaveLength(answered ? 1 : 0);
        });
      }),
      opts,
    );
    expect(seen.key).toBeGreaterThan(0);
    expect(seen.connect).toBeGreaterThan(0);
    expect(seen.persist).toBeGreaterThan(0);
  });

  it("L9 scenario: a press row comes before its letter's first write, and one reply row at settlement counts every send", () => {
    const seen = { press: 0, reply: 0, resent: 0, free: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        const pressed = new Set<string>();
        const sends = new Map<string, number>();
        fold(list, ({ prev, m, cmds }) => {
          // A press row comes before any send of its letter, in this step's Cmds or an earlier step's.
          const pressRows = cmds.flatMap((c) => {
            const r = recordIn(c);
            return r?._tag === "press" ? [String(r["letter"])] : [];
          });
          seen.press += pressRows.length;
          expect(
            pressRows.filter((l) => sends.has(l)),
            "a press row came after its letter's send",
          ).toEqual([]);
          const sent = cmds.flatMap((c, i) =>
            isWrite(c) && c.call._tag === "send" ? [{ letter: String(c.call["letter"]), at: i }] : [],
          );
          expect(
            sent.filter(
              (s) => !pressed.has(s.letter) && !cmds.slice(0, s.at).some((p) => recordIn(p)?.["letter"] === s.letter),
            ),
            "a letter went before its press row",
          ).toEqual([]);

          for (const l of pressRows) {
            pressed.add(l);
          }

          for (const s of sent) {
            sends.set(s.letter, (sends.get(s.letter) ?? 0) + 1);
          }

          const replies = cmds.map(recordIn).filter((r) => r?._tag === "reply");

          if (m.type === "send_ok") {
            const f = prev.flight.find((x) => x.id === m.id && x.dial === m.dial);

            if (f !== undefined && f.call._tag === "send") {
              seen.reply++;
              const letter = String(f.call.letter);
              seen.resent += (sends.get(letter) ?? 0) > 1 ? 1 : 0;
              const reason =
                m.value._tag === "refused" ? { reason: isWord(m.value.reason) ? m.value.reason : "other" } : {};
              seen.free += m.value._tag === "refused" && !isWord(m.value.reason) ? 1 : 0;
              expect(replies).toEqual([
                {
                  _tag: "reply",
                  letter,
                  result: m.value._tag,
                  attempts: sends.get(letter) ?? 0,
                  ms: m.ms,
                  ...reason,
                },
              ]);
              return;
            }
          }

          expect(replies, `${m.type} wrote a reply row`).toEqual([]);
        });
      }),
      opts,
    );
    expect(seen.press).toBeGreaterThan(0);
    expect(seen.reply).toBeGreaterThan(0);
    expect(seen.resent, "some letters went more than once").toBeGreaterThan(0);
    expect(seen.free, "some refusals had free-text reasons").toBeGreaterThan(0);
  });

  it("L9 scenario: a whole row per whole installed, an asked row per ask, and one patch row per ended run with its count", () => {
    const seen = { whole: 0, asked: 0, run: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        const run = new Map<string, number>(); // installed patches per pid since the last view row
        fold(list, ({ prev, m, next, cmds }) => {
          const rows = cmds.map(recordIn).filter((r): r is Row => r?._tag === "view");
          const ended = new Map(
            rows.filter((r) => r["result"] === "patch").map((r) => [String(r["pid"]), r["patches"]]),
          );

          for (const [pid, count] of ended) {
            seen.run++;
            expect(count, `${pid}'s run`).toBe(run.get(pid));
            run.delete(pid);
          }

          for (const r of rows.filter((r) => r["result"] !== "patch")) {
            seen[r["result"] === "whole" ? "whole" : "asked"]++;
            expect(run.get(String(r["pid"])) ?? 0, "a run did not end before its pid's next view row").toBe(0);
          }

          const changed = Object.keys(next.client.views).filter(
            (pid) => next.client.views[pid] !== prev.client.views[pid],
          );

          for (const pid of changed) {
            const whole =
              m.type === "open_ok" || (m.type === "view" && (m.note as { type?: unknown }).type === "whole");
            expect(rows.filter((r) => r["pid"] === pid && r["result"] === "whole")).toHaveLength(whole ? 1 : 0);

            if (!whole) {
              run.set(pid, (run.get(pid) ?? 0) + 1);
            }
          }

          if (prev.link._tag === "online" && next.link._tag !== "online") {
            expect(
              [...run.entries()].filter(([, n]) => n > 0),
              "leaving online ends every run",
            ).toEqual([]);
          }
        });
      }),
      opts,
    );
    expect(seen.whole).toBeGreaterThan(0);
    expect(seen.asked).toBeGreaterThan(0);
    expect(seen.run).toBeGreaterThan(0);
  });
});

// --- P18 slice 1: frames, cuts and close codes -----------------------------------------------------
//
// What these laws hold `client/WindowMachine.ts` to, from P18's approved plan (the build may add more):
// - Two new Msgs carry what the socket saw, raw: `frame {dial, text, at, ms?}` and
//   `socket_closed {dial, code, at}`. `update` decodes every frame; the start decodes nothing.
// - A frame of a dial that is not the link's socket dial does nothing. Text `pong` is the link's
//   `pong`. A JSON-RPC answer with a number id goes to the flight with that id and dial and becomes
//   the `*_ok` or `*_err` Msg its call already had, with the frame's `ms`. A string id goes to the
//   handshake. `challenge`, `client.granted` and `gateway.waiting` go to the handshake, and
//   `view.whole` and `view.patch` become the `view` Msg. Anything else does nothing.
// - The model gains `handshake` (the `Handshake` of `transport/Handshake.ts`, whose live request id
//   is its `id`) and `fingerprint` (from `key_ok`, whose ok gains `fingerprint`). The handshake's
//   `hello` Cmd carries `{dial, id, nonce}`.
// - `socket_closed` is the link's `closed`, and a `connect` row of a closed or removed dial keeps
//   the close `code`.
//
// The walk starts at the real init and reaches the door's states only through frames: a challenge
// makes a hello, the door answers the handshake's live id, and the window goes online. Each step
// picks one move possible in the state it folded, stale ones on purpose.

/** The door's frame for one JSON-RPC answer or notice, as text. */
const rpc = (body: object) => JSON.stringify({ jsonrpc: "2.0", ...body });
const ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: "person_x", as: "window" } };
const NOT_GRANTED = { code: -32000, message: "no", data: { reason: "not_granted" } };
/** Error reasons the door sends; the first four are the ones a client may try again after. */
const ERROR_REASONS = ["unreachable", "not_granted", "no_hello", "storage", "nope", "rate_limited"] as const;
const AGAIN = new Set<string>(["unreachable", "not_granted", "no_hello", "storage"]);
/** Texts that are no frame the window reads. `ping` is the client's own word, never the door's. */
const JUNK = ["{ not json", "[1,2]", rpc({ id: true, result: 1 }), "ping", "", "PONG", rpc({ method: "nope" })];

/** A blind draw the fold reads in the state it reached: which move, which target, and its values. */
const Pick = Schema.Struct({
  move: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  aux: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ms: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })),
  word: Schema.Literals(["milk", "bread", "eggs", "n0nce1", "k7q2"]),
  // Close codes as a door or a network sends them: the common ones, the removal, and any private one.
  code: Schema.Union([
    Schema.Literals([1000, 1001, 1006, 1011, 4003]),
    Schema.Int.check(Schema.isBetween({ minimum: 3000, maximum: 4999 })),
  ]),
});
type Pick = typeof Pick.Type;
const Picks = Schema.Array(Pick).check(Schema.isMinLength(40), Schema.isMaxLength(200));

/** What the step's frame should do, known when the move was made. */
type Expect =
  | { readonly _tag: "owner"; readonly owner: WindowMsg } // the same as the Msg its owner already had
  | { readonly _tag: "nothing" } // changes nothing and asks for nothing
  | { readonly _tag: "handshake" } // a string id or a handshake notice: no flight moves
  | { readonly _tag: "settles"; readonly id: number; readonly dial: number } // only that flight leaves
  | { readonly _tag: "none" }; // not a frame

type Flight = WindowModel["flight"][number];

type FrameWorld = {
  s: WindowModel;
  waiting: Array<Cmd>;
  at: number;
  ids: Set<string>; // every handshake id the walk has seen
  old: Array<Flight>; // flights that left the model
  dials: Set<number>; // every socket dial the walk has seen
};

type FrameEvent = {
  readonly prev: WindowModel;
  readonly m: WindowMsg;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly expect: Expect;
};

/** The model's handshake: its state, its dial and its live request id. */
const handshakeIn = (s: WindowModel): { readonly _tag: string; readonly dial?: number; readonly id?: string } =>
  Reflect.get(s, "handshake") ?? { _tag: "none" };

const frame = (w: FrameWorld, dial: number, text: string, ms?: number): WindowMsg =>
  ({ type: "frame", dial, text, at: w.at, ...(ms === undefined ? {} : { ms }) }) as WindowMsg;

/**
 * A good answer for a flight's call, and the Msg the call's own handler takes for it. A renewed
 * knock's code is the Link's only while the handshake still waits on that dial; at any other time
 * the answer is stale, and only the knock's own handler takes it.
 */
const goodAnswer = (
  f: Flight,
  c: Pick,
  hs: ReturnType<typeof handshakeIn>,
): { readonly result: unknown; readonly owner: WindowMsg | null } => {
  const on = { id: f.id, dial: f.dial };

  if (f.call._tag === "read") {
    const name = f.call.stream.replace(/^processes\//, "");
    const entries = [{ _tag: "started", by: "brain", body: { process: `process_${name}_${c.word}`, name }, rev: 1 }];
    return { result: { entries }, owner: { type: "read_ok", ...on, value: entries, ms: c.ms } };
  }

  if (f.call._tag === "open") {
    const value = { rev: c.aux % 5, view: listEdit(EMPTY, c.aux, c.word) };
    return { result: value, owner: { type: "open_ok", ...on, value, ms: c.ms } };
  }

  if (f.call._tag === "send") {
    const value =
      c.aux % 2 === 0
        ? { _tag: "accepted" as const, rev: c.ms, pos: c.aux }
        : { _tag: "refused" as const, reason: REASONS[c.ms % REASONS.length]! };
    return { result: value, owner: { type: "send_ok", ...on, value, ms: c.ms } };
  }

  const result = { code: c.word, until: c.ms };
  return hs._tag === "waiting" && hs.dial === f.dial
    ? { result, owner: null }
    : { result, owner: { type: "knock_ok", ...on, value: null, ms: c.ms } };
};

/** Every move the world allows now, each with what its frame should do. */
const frameMoves = (w: FrameWorld, c: Pick): ReadonlyArray<() => readonly [WindowMsg, Expect]> => {
  const s = w.s;
  const out: Array<() => readonly [WindowMsg, Expect]> = [];
  const none: Expect = { _tag: "none" };
  const nothing: Expect = { _tag: "nothing" };
  const dial = socketDial(s);
  const past = [...w.dials].filter((d) => d !== dial);
  const timer = linkTimer(s.link);
  const hs = handshakeIn(s);

  // tea's answers to the Cmds handed out and not answered yet.
  if (w.waiting.length > 0) {
    const due = w.waiting.filter((cmd) => ["key", "now"].includes(cmd.type));
    const from = c.aux % 3 !== 0 && due.length > 0 ? due : w.waiting;
    const cmd = from[c.pick % from.length]!;
    const ok = (value: unknown) => (): readonly [WindowMsg, Expect] => [
      { type: `${cmd.type}_ok`, cmd, value } as WindowMsg,
      none,
    ];
    out.push(
      cmd.type === "key"
        ? ok({ found: cmd["rejected"] === null ? "created" : "replaced", fingerprint: `SHA256:${c.word}` })
        : cmd.type === "now"
          ? ok({ letter: `letter_${c.word}_${c.ms}`, sentAt: "2026-11-13T00:00:00.000Z" })
          : cmd.type === "persist"
            ? ok(c.aux % 2 === 0)
            : ok(null),
    );
  }

  // A live link's timer is offered now and then, so dials live long enough to go online. A retrying
  // link waits on nothing but its retry, so the retry is always offered, and favored, like the
  // door's next move below: no walk sits in `retrying` for good.
  if (timer !== null && s.link._tag === "retrying") {
    const retry = (): readonly [WindowMsg, Expect] => [timer.msg, none];
    out.push(retry, retry, retry);
  } else if (timer !== null && s.link._tag === "waiting_grant" && !s.flight.some((f) => f.call._tag === "knock")) {
    // A grant wait renews before its grant now and then, so a renewed knock is out when the grant
    // comes and its answer can land after it.
    const renew = (): readonly [WindowMsg, Expect] => [timer.msg, none];
    out.push(renew, renew, renew, renew);
  } else if (timer !== null && c.aux % 4 === 0) {
    out.push(() => [timer.msg, none]);
  }

  if (s.link._tag === "removed") {
    out.push(() => [{ type: "ask_again", dial: Math.max(...w.dials, 0) + 1 }, none]);
  }

  const open = s.tiles.filter((t) => t.reach._tag === "open");

  if (open.length > 0) {
    const t = open[c.pick % open.length]!;
    out.push(() => [{ type: "press", tile: t.id, m: { type: "add", name: c.word } }, none]);
  }

  if (dial !== null) {
    const d = dial;
    const nonce = `nonce_${c.word}_${c.ms}`;
    out.push(
      () => [frame(w, d, rpc({ method: "challenge", params: { nonce } })), { _tag: "handshake" }],
      () => [frame(w, d, rpc({ method: "client.granted", params: { nonce } })), { _tag: "handshake" }],
      () => [
        frame(w, d, rpc({ method: "gateway.waiting", params: { code: c.word, until: c.ms } })),
        { _tag: "handshake" },
      ],
      () => [frame(w, d, "pong"), { _tag: "owner", owner: { type: "pong", dial: d } }],
      () => [frame(w, d, JUNK[c.aux % JUNK.length]!), nothing],
    );

    // The live socket closes now and then, like its timer, so a dial lives long enough to go online.
    if (c.aux % 4 === 0) {
      out.push(() => [{ type: "socket_closed", dial: d, code: c.code, at: w.at } as WindowMsg, none]);
    }

    // Favor the door's next move for the handshake's own state, so walks go online: a challenge to
    // a dial not challenged yet, an admission of the live hello (or now and then `not_granted`, so
    // walks also wait for a grant), a code for the live knock, and a grant to a waiting dial.
    if (hs.dial === d) {
      const next =
        hs._tag === "opened"
          ? rpc({ method: "challenge", params: { nonce } })
          : hs._tag === "initializing"
            ? rpc(c.aux % 3 === 0 ? { id: hs.id, error: NOT_GRANTED } : { id: hs.id, result: ADMITTED })
            : hs._tag === "knocking"
              ? rpc({ id: hs.id, result: { code: c.word, until: c.ms } })
              : hs._tag === "waiting"
                ? rpc({ method: "client.granted", params: { nonce } })
                : null;

      if (next !== null) {
        const move = (): readonly [WindowMsg, Expect] => [frame(w, d, next), { _tag: "handshake" }];
        out.push(move, move, move);
      }
    }

    if (hs.id !== undefined && hs.dial === d) {
      const id = hs.id;
      const answers = [
        rpc({ id, result: ADMITTED }),
        rpc({ id, result: ADMITTED }),
        rpc({ id, result: ADMITTED }),
        rpc({ id, error: NOT_GRANTED }),
        rpc({ id, result: { code: c.word, until: c.ms } }),
      ];

      for (const text of answers) {
        out.push(() => [frame(w, d, text), { _tag: "handshake" }]);
      }
    }

    const stale = [...w.ids].filter((id) => id !== hs.id);

    if (stale.length > 0) {
      const id = stale[c.pick % stale.length]!;
      out.push(() => [frame(w, d, rpc({ id, result: ADMITTED })), nothing]);
    }

    // Answers to the flights the window has, on their own id and dial.
    if (s.flight.length > 0) {
      const f = s.flight[c.pick % s.flight.length]!;
      const good = goodAnswer(f, c, hs);
      const reason = ERROR_REASONS[c.aux % ERROR_REASONS.length]!;
      const error: WindowMsg = {
        type: `${f.call._tag}_err`,
        id: f.id,
        dial: f.dial,
        error: { _tag: AGAIN.has(reason) ? "unreachable" : "unknown" },
      } as WindowMsg;
      out.push(
        () => [
          frame(w, f.dial, rpc({ id: f.id, result: good.result }), c.ms),
          good.owner === null ? { _tag: "settles", id: f.id, dial: f.dial } : { _tag: "owner", owner: good.owner },
        ],
        () => [
          frame(w, f.dial, rpc({ id: f.id, result: good.result }), c.ms),
          good.owner === null ? { _tag: "settles", id: f.id, dial: f.dial } : { _tag: "owner", owner: good.owner },
        ],
        () => [
          frame(w, f.dial, rpc({ id: f.id, error: { code: -32000, message: "no", data: { reason } } }), c.ms),
          { _tag: "owner", owner: error },
        ],
        () => [frame(w, f.dial, rpc({ id: f.id, result: { rev: "bad", entries: 7, _tag: 1 } }), c.ms), nothing],
        // The flight's id as a string is the handshake's kind of id: it never settles the flight.
        () => [frame(w, f.dial, rpc({ id: String(f.id), result: good.result }), c.ms), { _tag: "handshake" }],
      );
    }

    // A renewed knock still out once the handshake has moved past waiting, as after a grant: its
    // late answer is favored, so walks reach it.
    const late = s.flight.find((f) => f.call._tag === "knock" && !(hs._tag === "waiting" && hs.dial === f.dial));

    if (late !== undefined) {
      const good = goodAnswer(late, c, hs);
      const move = (): readonly [WindowMsg, Expect] => [
        frame(w, late.dial, rpc({ id: late.id, result: good.result }), c.ms),
        good.owner === null ? { _tag: "settles", id: late.id, dial: late.dial } : { _tag: "owner", owner: good.owner },
      ];
      out.push(move, move, move, move);
    }

    out.push(() => [
      frame(w, d, rpc({ id: Math.max(0, ...s.flight.map((f) => f.id), s.serial) + 1 + c.aux, result: {} }), c.ms),
      nothing,
    ]);

    const pids = s.tiles.flatMap((t) => ("pid" in t.reach ? [t.reach.pid] : []));

    if (pids.length > 0) {
      const pid = pids[c.pick % pids.length]!;
      const params = { pid, type: "whole", rev: c.aux % 7, view: listEdit(EMPTY, c.aux, c.word) };
      out.push(
        () => [
          frame(w, d, rpc({ method: "view.whole", params })),
          { _tag: "owner", owner: { type: "view", pid, note: params } },
        ],
        () => [frame(w, d, rpc({ method: "view.whole", params: { ...params, pid: undefined } })), nothing],
      );
    }
  }

  // A frame, a close or a late answer of a dial that is not the socket's any more.
  if (past.length > 0) {
    const d = past[c.pick % past.length]!;
    const late = w.old.filter((f) => f.dial === d);
    out.push(
      () => [frame(w, d, "pong"), nothing],
      () => [frame(w, d, rpc({ method: "challenge", params: { nonce: `old_${c.word}` } })), nothing],
      () => [{ type: "socket_closed", dial: d, code: c.code, at: w.at } as WindowMsg, none],
    );

    if (late.length > 0) {
      const f = late[c.aux % late.length]!;
      out.push(() => [frame(w, f.dial, rpc({ id: f.id, result: goodAnswer(f, c, hs).result }), c.ms), nothing]);
    }

    // A live flight's own id and a good answer, on a past dial: the id alone never settles it.
    if (s.flight.length > 0) {
      const f = s.flight[c.aux % s.flight.length]!;
      out.push(() => [frame(w, d, rpc({ id: f.id, result: goodAnswer(f, c, hs).result }), c.ms), nothing]);
    }
  }

  return out;
};

/** Folds a frame walk from the real init, handing each step to `each`, and returns every step. */
const foldFrames = (list: ReadonlyArray<Pick>, each: (e: FrameEvent) => void = () => {}): Array<FrameEvent> => {
  const [s0, cmds0] = machine.init(null, ctx);
  const w: FrameWorld = { s: s0, waiting: [...cmds0], at: 0, ids: new Set(), old: [], dials: new Set([1]) };
  const events: Array<FrameEvent> = [];

  for (const c of list) {
    const options = frameMoves(w, c);
    const [m, expect] = options[c.move % options.length]!();
    const prev = w.s;
    const [next, cmds] = step(prev, m);
    w.waiting = [
      ...w.waiting.filter((cmd) => !("cmd" in m) || m.cmd !== cmd),
      ...cmds.filter((c) => c.type !== "record"),
    ];
    w.old.push(...prev.flight.filter((f) => !next.flight.some((n) => n.id === f.id && n.dial === f.dial)));
    const id = handshakeIn(next).id;

    if (id !== undefined) {
      w.ids.add(id);
    }

    const open = socketDial(next);

    if (open !== null) {
      w.dials.add(open);
    }

    w.at += c.ms % 700;
    w.s = next;
    const event = { prev, m, next, cmds, expect };
    events.push(event);
    each(event);
  }

  return events;
};

const frameRuns = { arbitrary: { seed: SEED, runs: 300, size: 200 } };

/** The id of a JSON-RPC answer, read as the door wrote it. */
const answerId = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]) })),
);

/** What a frame on `prev` did, beside what its owner says it must do, with a label for a failure. */
const verdict = (
  prev: WindowModel,
  m: Extract<WindowMsg, { readonly type: "frame" }>,
  after: readonly [WindowModel, ReadonlyArray<Cmd>],
  e: Expect,
): readonly [string, unknown, unknown] => {
  const unmoved = [prev, []];

  if (m.dial !== socketDial(prev)) {
    return [`a frame of old dial ${m.dial} moved the window`, after, unmoved];
  }

  if (e._tag === "owner") {
    return [`${m.text} did not reach its owner ${e.owner.type}`, after, step(prev, e.owner)];
  }

  if (e._tag === "settles") {
    return [
      "an answer settled another flight",
      after[0].flight,
      prev.flight.filter((x) => x.id !== e.id || x.dial !== e.dial),
    ];
  }

  const named = Option.getOrUndefined(answerId(m.text))?.id;

  if (e._tag === "handshake" && !(typeof named === "string" && named !== handshakeIn(prev).id)) {
    return [
      `${m.text}: a handshake frame settled a flight`,
      after[0].flight.filter((x) => prev.flight.includes(x)),
      prev.flight,
    ];
  }

  // Malformed text, an unknown id, or a string id that is not the handshake's own.
  return [`${m.text} moved the window`, after, unmoved];
};

describe("P18 L3: each frame reaches exactly one owner", () => {
  it.prop(
    "a number id settles only its own flight on its dial, a string id only the handshake, pong only the link, a view notice its pid, and an old dial's frame or a malformed text nothing",
    { list: Arbitrary.schema(Picks) },
    ({ list }) => {
      const seen = { online: 0 };
      foldFrames(list, ({ prev, m, next, cmds, expect: e }) => {
        seen.online += prev.link._tag !== "online" && next.link._tag === "online" ? 1 : 0;

        if (m.type !== "frame") {
          return;
        }

        const [label, got, wanted] = verdict(prev, m, [next, cmds], e);
        expect(got, label).toEqual(wanted);
      });
      expect(seen.online, "walks went online through frames alone").toBeGreaterThan(0);
      return true;
    },
    frameRuns,
  );

  it.prop(
    "over all walks every route is taken",
    { list: Arbitrary.array(Arbitrary.schema(Picks), { minLength: 40, maxLength: 40 }) },
    ({ list }) => {
      // A knock's answer settles only once a grant wait renews, which few walks reach: not counted.
      // `stolen` is a live flight's id on a past dial, the frame only the dial check stops. `late`
      // is a renewed knock's answer that lands after the handshake left waiting, as after a grant.
      const seen: Record<Expect["_tag"] | "old" | "online" | "stolen" | "late", number> = {
        owner: 0,
        nothing: 0,
        handshake: 0,
        settles: 0,
        none: 0,
        online: 0,
        old: 0,
        stolen: 0,
        late: 0,
      };

      for (const walk of list) {
        foldFrames(walk, ({ prev, m, next, expect: e }) => {
          if (m.type === "frame") {
            const dial = m.dial;
            const route = dial === socketDial(prev) ? e._tag : "old";
            seen[route] += 1;
            const named = Option.getOrUndefined(answerId(m.text))?.id;
            seen.stolen += route === "old" && prev.flight.some((f) => f.id === named) ? 1 : 0;
            const hs = handshakeIn(prev);
            seen.late +=
              route !== "old" &&
              hs._tag !== "waiting" &&
              prev.flight.some((f) => f.id === named && f.dial === dial && f.call._tag === "knock")
                ? 1
                : 0;
          }

          seen.online += prev.link._tag !== "online" && next.link._tag === "online" ? 1 : 0;
        });
      }

      expect(
        (["owner", "nothing", "handshake", "online", "old", "stolen", "late"] as const).every((k) => seen[k] > 0),
        JSON.stringify(seen),
      ).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 200 } },
  );
});

describe("P18 L6: a cut Model continues as the uncut run", () => {
  it.prop(
    "a WindowModel saved at a reached state and loaded again takes the same Msgs to the same Models and Cmds, the handshake's live id included",
    { list: Arbitrary.schema(Picks), cut: Arbitrary.schema(Pick.fields.pick) },
    ({ list, cut }) => {
      const events = foldFrames(list);
      const live = events.flatMap((e, i) => (handshakeIn(e.next).id === undefined ? [] : [i]));
      const pool = live.length > 0 && cut % 2 === 0 ? live : events.map((_, i) => i);
      const k = pool[cut % pool.length]!;
      const saved = Schema.encodeSync(Schema.fromJsonString(machine.model))(events[k]!.next);
      const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(machine.model))(saved);
      let [s] = machine.init(loaded, ctx);
      expect(s, "the saved Model did not load back as it was").toEqual(events[k]!.next);

      for (const e of events.slice(k + 1)) {
        const [next, cmds] = step(s, e.m);
        expect([next, cmds], `${e.m.type} after the cut`).toEqual([e.next, e.cmds]);
        s = next;
      }

      return true;
    },
    { arbitrary: { seed: SEED, runs: 100, size: 200 } },
  );

  it.prop(
    "some walks reach a state whose handshake has a live id, so a cut can fall there",
    { list: Arbitrary.array(Arbitrary.schema(Picks), { minLength: 20, maxLength: 20 }) },
    ({ list }) => {
      expect(list.some((walk) => foldFrames(walk).some((e) => handshakeIn(e.next).id !== undefined))).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 200 } },
  );
});

describe("P18 L11: the connect row of a closed dial keeps its close code", () => {
  it.prop(
    "a socket_closed on the link's dial writes one closed or removed connect row with the code it saw, removed only for 4003, and no other connect row carries a code",
    { list: Arbitrary.schema(Picks) },
    ({ list }) => {
      foldFrames(list, ({ prev, m, next, cmds }) => {
        const rows = cmds.map(recordIn).filter((r): r is Row => r?._tag === "connect");
        const closed = m.type === "socket_closed" && m.dial === socketDial(prev) ? m : null;
        const label =
          closed === null ? `connect rows after ${m.type}` : `a close ${closed.code} on dial ${closed.dial}`;
        expect(
          rows.map((r) => [r["result"], r["code"]]),
          label,
        ).toEqual(
          closed === null
            ? rows.map((r) => [r["result"], undefined])
            : [[closed.code === 4003 ? "removed" : "closed", closed.code]],
        );
        expect(closed === null || (next.link._tag === "removed") === (closed.code === 4003), "only 4003 removes").toBe(
          true,
        );
      });
      return true;
    },
    { arbitrary: { seed: SEED, runs: 100, size: 200 } },
  );
});

// --- L10: the wire's frame families ----------------------------------------------------------------

/** The door's wire vocabulary, as the door writes it (P12 as built): what the window must read. */
const Finite = Schema.Number.check(Schema.isFinite());

const Wire = {
  nonce: Schema.Struct({ nonce: Schema.String }),
  code: Schema.Struct({ code: Schema.String, until: Finite }),
  admitted: Schema.Struct({
    version: Schema.Int,
    ping: Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    identity: Schema.Struct({ key: Schema.String, person: Schema.String, as: Schema.Literals(["window"]) }),
  }),
  entries: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        _tag: Schema.Literal("started"),
        by: Schema.Literal("brain"),
        body: Schema.Struct({ process: Schema.String, name: Schema.Literal("checklist:1") }),
        rev: Schema.Int,
      }),
    ),
  }),
  opened: Schema.Struct({ rev: Schema.Int, view: ListView }),
  sent: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("accepted"), rev: Schema.Int, pos: Schema.Int }),
    Schema.Struct({ _tag: Schema.Literal("refused"), reason: Schema.String }),
  ]),
  whole: Schema.Struct({ rev: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), view: ListView }),
  patch: Schema.Struct({ base: Schema.Int, rev: Schema.Int }),
  // An error answer's data: one of the door's words, or any text a door could send.
  refusal: Schema.Struct({
    reason: Schema.Union([Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/)), Schema.String]),
  }),
};

/** The window a few frames into a dial, each state reached through the door's frames alone. */
const door = {
  /** Booted, with its key: the link is dialing on dial 1. */
  boot: (): WindowModel => {
    const [s, cmds] = machine.init(null, ctx);
    const key = cmds.find((c) => c.type === "key");
    return step(s, { type: "key_ok", cmd: key, value: { found: "created", fingerprint: "SHA256:fp" } } as WindowMsg)[0];
  },
  frame: (s: WindowModel, text: string, ms?: number) =>
    step(s, { type: "frame", dial: 1, text, at: 1_000, ...(ms === undefined ? {} : { ms }) } as WindowMsg),
  /** After a challenge: `initialize` is out with the handshake's live id. */
  initializing: (): WindowModel => door.frame(door.boot(), rpc({ method: "challenge", params: { nonce: "n1" } }))[0],
  /** After `not_granted`: the handshake's knock is out. */
  knocking: (): WindowModel => {
    const s = door.initializing();
    return door.frame(s, rpc({ id: handshakeIn(s).id, error: NOT_GRANTED }))[0];
  },
  /** Showing a code: the link waits for a grant. */
  waiting: (): WindowModel => {
    const s = door.knocking();
    return door.frame(s, rpc({ id: handshakeIn(s).id, result: { code: "K7Q2", until: 9_000 } }))[0];
  },
  online: (): WindowModel => {
    const s = door.initializing();
    return door.frame(s, rpc({ id: handshakeIn(s).id, result: ADMITTED }))[0];
  },
  /** Online with its tile's view open in flight. */
  opening: (): WindowModel => {
    const s = door.online();
    const read = s.flight.find((f) => f.call._tag === "read")!;
    const entries = [{ _tag: "started", by: "brain", body: { process: PID_A, name: "checklist:1" }, rev: 1 }];
    return door.frame(s, rpc({ id: read.id, result: { entries } }), 1)[0];
  },
  /** Online with one letter in flight. */
  sending: (): WindowModel => {
    const s = door.opening();
    const open = s.flight.find((f) => f.call._tag === "open")!;
    const [shown] = door.frame(s, rpc({ id: open.id, result: { rev: 1, view: EMPTY } }), 1);
    const [pressed, cmds] = step(shown, { type: "press", tile: "tile_1", m: { type: "add", name: "milk" } });
    const now = cmds.find((c) => c.type === "now");
    return step(pressed, {
      type: "now_ok",
      cmd: now,
      value: { letter: "letter_a", sentAt: "2026-11-13T00:00:00.000Z" },
    } as WindowMsg)[0];
  },
};

const PID_A = "process_01m6v5270hf3c8x2q7w9z4k5mn";

type Family = {
  readonly schema: Schema.Top;
  readonly from: () => WindowModel;
  /** The frame for a result or params object, and the frame's `ms` for an answer to a flight. */
  readonly text: (s: WindowModel, sent: Record<string, unknown>) => readonly [string, number?];
  /** The object the frame carries for a generated value: the value itself, unless a notice adds its pid. */
  readonly sent?: (value: Record<string, unknown>) => Record<string, unknown>;
  readonly good: (prev: WindowModel, after: readonly [WindowModel, ReadonlyArray<Cmd>], value: any) => void;
  readonly drop: ReadonlyArray<string>;
  readonly wrong: Readonly<Record<string, unknown>>;
};

const flightFor = (s: WindowModel, tag: string) => s.flight.find((f) => f.call._tag === tag)!;

const sameAs = (prev: WindowModel, after: readonly [WindowModel, ReadonlyArray<Cmd>], owner: WindowMsg) =>
  expect(after, `not the same as ${owner.type}`).toEqual(step(prev, owner));

const helloWith = (after: readonly [WindowModel, ReadonlyArray<Cmd>], nonce: string) =>
  expect(
    after[1].filter((c) => c.type === "hello").map((c) => c["nonce"]),
    "the hello carries its nonce",
  ).toEqual([nonce]);

const FAMILIES: Readonly<Record<string, Family>> = {
  challenge: {
    schema: Wire.nonce,
    from: door.boot,
    text: (_s, params) => [rpc({ method: "challenge", params })],
    good: (_p, after, v) => helloWith(after, v.nonce),
    drop: ["nonce"],
    wrong: { nonce: 7 },
  },
  "client.granted": {
    schema: Wire.nonce,
    from: door.waiting,
    text: (_s, params) => [rpc({ method: "client.granted", params })],
    good: (_p, after, v) => helloWith(after, v.nonce),
    drop: ["nonce"],
    wrong: { nonce: 7 },
  },
  "gateway.waiting": {
    schema: Wire.code,
    from: door.knocking,
    text: (_s, params) => [rpc({ method: "gateway.waiting", params })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "waiting_grant", code: v.code, until: v.until }),
    drop: ["code", "until"],
    wrong: { code: 7, until: "soon" },
  },
  Admitted: {
    schema: Wire.admitted,
    from: door.initializing,
    text: (s, result) => [rpc({ id: handshakeIn(s).id, result })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "online", dial: 1, ping: v.ping }),
    drop: ["version", "ping", "identity"],
    wrong: { version: "one", ping: "5s", identity: "me" },
  },
  // The door's error answer to the live `initialize`: `not_granted` knocks, any other reason ends the
  // hello as refused, with one connect row that keeps the reason when it is a word. The Link keeps
  // its own stall and backoff path.
  refusal: {
    schema: Wire.refusal,
    from: door.initializing,
    text: (s, data) => [rpc({ id: handshakeIn(s).id, error: { code: -32000, message: "no", data } })],
    good: (p, [next, cmds], v) => {
      const word = /^[a-z_]{1,40}$/.test(v.reason) ? v.reason : "other";
      const knocks = v.reason === "not_granted";
      expect(handshakeIn(next), `the hello's outcome for ${v.reason}`).toMatchObject(
        knocks ? { _tag: "knocking", dial: 1 } : { _tag: "refused", dial: 1, reason: word },
      );
      expect(
        cmds.map(recordIn).filter((r) => r?._tag === "connect"),
        `the connect rows for ${v.reason}`,
      ).toEqual(knocks ? [] : [{ _tag: "connect", dial: 1, result: "refused", reason: word, ms: 0 }]);
      expect(next.link, "the link keeps its own path").toEqual(p.link);
    },
    drop: ["reason"],
    wrong: { reason: 7 },
  },
  WaitingCode: {
    schema: Wire.code,
    from: door.knocking,
    text: (s, result) => [rpc({ id: handshakeIn(s).id, result })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "waiting_grant", code: v.code, until: v.until }),
    drop: ["code", "until"],
    wrong: { code: 7, until: "soon" },
  },
  Entries: {
    schema: Wire.entries,
    from: door.online,
    text: (s, result) => [rpc({ id: flightFor(s, "read").id, result }), 3],
    good: (p, after, v) =>
      sameAs(p, after, { type: "read_ok", id: flightFor(p, "read").id, dial: 1, value: v.entries, ms: 3 }),
    drop: ["entries"],
    wrong: { entries: "all" },
  },
  Opened: {
    schema: Wire.opened,
    from: door.opening,
    text: (s, result) => [rpc({ id: flightFor(s, "open").id, result }), 3],
    good: (p, after, v) => sameAs(p, after, { type: "open_ok", id: flightFor(p, "open").id, dial: 1, value: v, ms: 3 }),
    drop: ["rev", "view"],
    wrong: { rev: "one" },
  },
  Sent: {
    schema: Wire.sent,
    from: door.sending,
    text: (s, result) => [rpc({ id: flightFor(s, "send").id, result }), 3],
    good: (p, after, v) => sameAs(p, after, { type: "send_ok", id: flightFor(p, "send").id, dial: 1, value: v, ms: 3 }),
    drop: ["_tag"],
    wrong: { _tag: 7 },
  },
  "view.whole": {
    schema: Wire.whole,
    from: door.opening,
    sent: (v) => ({ pid: PID_A, type: "whole", ...v }),
    text: (_s, params) => [rpc({ method: "view.whole", params })],
    good: (p, after, v) => sameAs(p, after, { type: "view", pid: PID_A, note: { pid: PID_A, type: "whole", ...v } }),
    drop: ["pid", "type"],
    wrong: { pid: 7, type: "other" },
  },
  "view.patch": {
    schema: Wire.patch,
    from: door.opening,
    sent: (v) => ({ pid: PID_A, type: "patch", patch: [], ...v }),
    text: (_s, params) => [rpc({ method: "view.patch", params })],
    good: (p, after, v) =>
      sameAs(p, after, { type: "view", pid: PID_A, note: { pid: PID_A, type: "patch", patch: [], ...v } }),
    drop: ["pid", "type"],
    wrong: { pid: 7, type: "other" },
  },
};

/** The params of a notice, or the result of an answer, with one field dropped or of the wrong type. */
const mutations = (family: Family, sent: Record<string, unknown>) => [
  ...family.drop.map((k) => Object.fromEntries(Object.entries(sent).filter(([key]) => key !== k))),
  ...Object.entries(family.wrong).map(([k, v]) => ({ ...sent, [k]: v })),
];

/** JSON text, the only form a frame's value takes on the wire. */
const Json = Schema.fromJsonString(Schema.Unknown);

describe("P18 L10: every frame family the parent reads decodes or reaches its typed failure", () => {
  for (const [name, family] of Object.entries(FAMILIES)) {
    it.prop(
      `format: ${name}, from its schema, reaches its handler, and with one field dropped or mistyped changes nothing`,
      { generated: Arbitrary.schema(family.schema) },
      ({ generated }) => {
        // The value as the window reads it after the wire: JSON cannot carry what a schema's
        // Arbitrary may make, such as `-0`, so the owner's Msg is built from the value JSON carries.
        const value = Schema.decodeSync(Json)(Schema.encodeSync(Json)(generated));
        const prev = family.from();
        const sent = (family.sent ?? ((v) => v))(value as Record<string, unknown>);
        const [text, ms] = family.text(prev, sent);
        family.good(prev, door.frame(prev, text, ms), value);

        for (const bad of mutations(family, sent)) {
          const [badText, badMs] = family.text(prev, bad);
          expect(door.frame(prev, badText, badMs), `${name} took ${badText}`).toEqual([prev, []]);
        }

        return true;
      },
      { arbitrary: { seed: SEED, runs: 50 } },
    );
  }
});
