// The window's parent machine, next/ (Tier 1, P14; laws p1, p2, p4 and `now`). Elm first: it holds
// the link (libfabrika's link machine) and the program client (libfabrika's client machine) and
// steps both by hand, by sending them Msgs; it never edits either's Model itself. It owns what is
// this window's own: which pids it opened on this dial, which letters are out, the focused tile and
// the key prefix. It reads no clock: a press reserves its slot in the client, and its time and
// letter id come back from the `now` Cmd. The file exports one machine factory,
// `windowMachineFor(checks)`, and no machine (decision 0046, plan A7).
//
// Going online opens every distinct pid of the fixed layout once and sends every ready letter ahead
// of the first one still waiting for its time, in slot order. Leaving online forgets both, so the
// next dial starts over and a letter keeps its id across dials.
//
// A brain call (`process.send`, `view.open`, `gateway.knock`) is a `write` Cmd (plan A13): it settles
// once its frame is handed to the socket, never waiting for the brain, since tea's loop folds
// nothing while a Cmd is unanswered. Its answer is the socket Sub's Msg, matched by the write's
// JSON-RPC id and dial against the calls in flight; an answer that matches none does nothing. A
// dial's end drops its calls; their letters stay in the client and go again by the rules above. A
// view notice that installs a pid's view drops that pid's open, so its late answer is stale (A14).
//
// The person's key settings read is explicit per dial (A15): going online reads them, `reading`. A
// failed read on the online dial is `failed` with the call's own reason, shown in the frame, and
// leaves the link as it is, so the socket's own close still reaches it with its code (A16). The
// resend timer runs while it is failed, and its tick for that dial asks the read again once, the
// `read_settings` Cmd, and sets `reading`. A dial that goes online reads again too; a `keys` or
// `keys_failed` while a newer dial's socket is open clears a failure. A failed read on any other
// dial, or while the link is not online, does nothing.
//
// What it records (plan A8), each through the `record` Cmd: the key a dial found, one `connect` row
// per link outcome with the `ms` its Msg carries, a press before its letter goes, a `reply` row when
// a letter settles (with every `send` of it and the answer's `ms`), the persistence answer, and a
// view's start and end: a `whole` row per whole view installed, an `asked` row per ask, and one
// `patch` row per ended run of installed patches, with its count, never one per patch. A run ends
// before its pid's next whole or asked row, and when the link leaves online.
import { applyCell, type Sub } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { ClientRecord, Keys, ProgramClient, type Rows, Sent } from "@kampus/libfabrika";
import type { knock } from "@kampus/libfabrika/transport/Link";
import { Link, linkMachine, LinkMsg, ping, socketDial, timerDeps } from "@kampus/libfabrika/transport/Link";
import { Schema } from "effect";
import { routeKey } from "../desktop/keys.ts";
import { type Layout, tilesIn } from "../desktop/layout.ts";

const C = ProgramClient;
/** How long a letter the brain did not take, or a time that failed, waits to be tried again. */
const RETRY = 2_000;

/** What the window is told from outside the model: the fixed layout and its programs' keys. */
export type WindowCtx = {
  readonly layout: Layout;
  /** The default key rows of the layout's programs, and the commands a tile's pid takes. */
  readonly keys?: {
    readonly defaults: Rows;
    readonly commands: (pid: string) => ReadonlyArray<string>;
  };
};

/** How the window checks what it installs: a tile's view decoder, the registration's own schema
 *  for the program behind `pid`. It is libfabrika's `ClientChecks`, passed through to the client
 *  machine, which captures it: a step reads no ctx. */
export type WindowChecks = ProgramClient.ClientChecks;

const Via = Schema.Literals(["button", "key"]);

const Table = Schema.Struct({
  rows: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  file: Schema.Array(Schema.String),
});

const Rows = Schema.Record(Schema.String, Schema.Array(Schema.String));

/** The person's key settings read on one dial: reading, or ended by a failed `ledger.read` or
 *  `ledger.wait` with the call's own reason. */
const Settings = Schema.TaggedUnion({
  reading: { dial: Schema.Int },
  failed: { dial: Schema.Int, reason: Schema.String },
});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

/** One brain call as a write carries it: `process.send` for one ready letter, with the same id
 *  and body every time; `view.open` for one pid; `gateway.knock` on the dial's socket. */
const Call = Schema.TaggedUnion({
  send: {
    pid: Schema.String,
    letter: Schema.String,
    n: Schema.Int,
    m: Schema.Json,
    sentAt: Schema.String,
    seen: Schema.Int,
    traceId: Schema.optionalKey(Schema.String),
  },
  open: { pid: Schema.String },
  knock: {},
});
type Call = typeof Call.Type;

/** Why a call's answer is not its value: `unreachable`, the socket or the brain is gone for now, so
 *  a later write retries; `unknown`, an answer this client cannot use, with the door's reason;
 *  `closed`, a knock that could not go. */
const CallError = Schema.TaggedUnion({
  unreachable: {},
  unknown: { reason: Schema.optionalKey(Schema.String) },
  closed: {},
});

/** The dial and JSON-RPC id an answer names: the write it answers. */
const OnWrite = { id: Schema.Int, dial: Schema.Int };

export const WindowModel = Schema.Struct({
  /** The fixed layout's tiles, `{id, pid}` in reading order, read from the ctx at init. */
  tiles: Schema.Array(Schema.Struct({ id: Schema.String, pid: Schema.String })),
  /** The programs' default key rows, and the commands each pid's program takes. */
  defaults: Rows,
  commands: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  link: Link,
  /** The highest dial this window has made, so Ask again dials past every old socket. */
  dials: Schema.Int,
  /** This tab's own measured tile area, which only its fold reads. */
  size: Schema.NullOr(Schema.Struct({ w: Schema.Number, h: Schema.Number })),
  client: C.Client,
  /** The pids opened on this dial. */
  opened: Schema.Array(Schema.String),
  /** The letters out on this dial with no answer yet. */
  sent: Schema.Array(Schema.String),
  /** The next write's JSON-RPC id: never two alike, on any dial. */
  serial: Schema.Int,
  /** Each write handed to the socket and not answered yet, on the dial whose socket is open. */
  flight: Schema.Array(Schema.Struct({ id: Schema.Int, dial: Schema.Int, call: Call })),
  /** How many times each unsettled letter was sent, across dials, for its reply record. */
  attempts: Schema.Record(Schema.String, Count),
  /** How many patches each pid installed since its last view row: the run its next row ends. */
  patches: Schema.Record(Schema.String, Count),
  /** A grant was just given: persistence is asked once, when the link next goes online. */
  fresh: Schema.Boolean,
  /** Slots whose time could not be read, asked again by the retry timer. */
  redate: Schema.Array(Schema.Int),
  /** How each slot still waiting for its time was pressed, by slot number, for its press record. */
  via: Schema.Record(Schema.String, Via),
  /** The key fingerprint the door removed, which the next dial replaces. */
  rejected: Schema.NullOr(Schema.String),
  focus: Schema.NullOr(Schema.String),
  keys: Table,
  armed: Schema.NullOr(Schema.Struct({ chords: Schema.Array(Schema.String) })),
  keyError: Schema.NullOr(Keys.KeyProblem),
  /** The key settings read of the last dial that went online, or the one that failed (A15). */
  settings: Settings,
  /** A plain word for the last answer the window could not use, shown once in the frame. */
  trouble: Schema.NullOr(Schema.String),
});
export type WindowModel = typeof WindowModel.Type;

const KeyInput = Schema.Struct({
  key: Schema.String,
  shift: Schema.Boolean,
  ctrl: Schema.Boolean,
  alt: Schema.Boolean,
  meta: Schema.Boolean,
  composing: Schema.Boolean,
  editable: Schema.Boolean,
});

const Own = Schema.Union([
  /** A person pressed an action on a tile: `m` is one of its program's Msgs. */
  Schema.Struct({
    type: Schema.Literal("press"),
    pid: Schema.String,
    m: Schema.Json,
    via: Schema.optionalKey(Via),
  }),
  /** A view notification for `pid`, as the socket received it. */
  Schema.Struct({ type: Schema.Literal("view"), pid: Schema.String, note: Schema.Unknown }),
  /** The retry timer: ask failed times again, and send what the brain did not take. */
  Schema.Struct({ type: Schema.Literal("resend"), dial: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("focus"), tile: Schema.NullOr(Schema.String) }),
  /** The tab's tile area was measured again. */
  Schema.Struct({ type: Schema.Literal("resized"), w: Schema.Number, h: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("key"), event: KeyInput }),
  /** A good key table from the person's settings, or the reason the last edit was not used. */
  Schema.Struct({
    type: Schema.Literal("keys"),
    rows: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
  Schema.Struct({ type: Schema.Literal("keys_failed"), error: Keys.KeyProblem }),
  /** The settings read on `dial` failed, and the runner stopped reading on it (A15). */
  Schema.Struct({ type: Schema.Literal("settings_failed"), dial: Schema.Int, reason: Schema.String }),
  /** The highest ledger revision the client has read. */
  Schema.Struct({ type: Schema.Literal("seen"), rev: Schema.Int }),
  // The socket Sub's answers to the writes, by id and dial. `ms` is the runner's, from the write it
  // saw to the frame it read.
  Schema.Struct({ type: Schema.Literal("send_ok"), ...OnWrite, value: Sent, ms: Ms }),
  Schema.Struct({ type: Schema.Literal("send_err"), ...OnWrite, error: CallError }),
  Schema.Struct({
    type: Schema.Literal("open_ok"),
    ...OnWrite,
    value: Schema.Struct({ rev: Schema.Int, view: Schema.Json }),
    ms: Ms,
  }),
  Schema.Struct({ type: Schema.Literal("open_err"), ...OnWrite, error: CallError }),
  Schema.Struct({ type: Schema.Literal("knock_ok"), ...OnWrite, value: Schema.Null, ms: Ms }),
  Schema.Struct({ type: Schema.Literal("knock_err"), ...OnWrite, error: CallError }),
  /** How a dial found the profile's key: made now, reused, or made to replace a removed one. */
  Schema.Struct({ type: Schema.Literal("identity"), found: Schema.Literals(["created", "reused", "replaced"]) }),
]);

/** A press's time and letter id, from Effect's Clock and the library's id generator. */
export const now = Cmd.make("now", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Struct({
    letter: Schema.String,
    sentAt: Schema.String,
    traceId: Schema.optionalKey(Schema.String),
  }),
  err: ["clock", "entropy"],
});

/** Hand one call's frame to the dial's socket, as JSON-RPC id `id`. It settles once the frame is
 *  handed over, or at once as unreachable when it cannot be; the brain's answer is the socket Sub's. */
export const write = Cmd.make("write", {
  input: Schema.Struct({ call: Call, id: Schema.Int, dial: Schema.Int }),
  ok: Schema.Null,
  err: ["unreachable"],
});

/** Ask the browser to keep this origin's storage, once per new grant. */
export const persist = Cmd.make("persist", {
  input: Schema.Struct({}),
  ok: Schema.Boolean,
  err: ["unsupported", "failed"],
});

/** Start the person's key settings read again on the dial's socket. It settles once the socket loop
 *  has it; a dial that is gone does nothing. */
export const read_settings = Cmd.make("read_settings", {
  input: Schema.Struct({ dial: Schema.Int }),
  ok: Schema.Null,
  err: [],
});

/** Keep one checked observation until the door acknowledges it (`client.record`). The handler gives
 *  it its row id, tab, build and time. */
export const record = Cmd.make("record", {
  input: Schema.Struct({ record: ClientRecord }),
  ok: Schema.Null,
  err: ["failed"],
});

type Out = ReadonlyArray<
  | ReturnType<typeof now>
  | ReturnType<typeof write>
  | ReturnType<typeof persist>
  | ReturnType<typeof read_settings>
  | ReturnType<typeof record>
  | ReturnType<typeof ping>
>;

type Step = readonly [WindowModel, Out];

/** The client machine, as the window steps it: its next Model, and the pids it asks a whole view
 *  of. */
type ClientStep = (
  client: ProgramClient.Client,
  m: ProgramClient.ClientMsg,
) => readonly [ProgramClient.Client, ReadonlyArray<string>];

/** The command a press of `m` on `pid` names, from the commands that pid's program takes. */
const commandFor = (s: WindowModel, pid: string, m: unknown): string => {
  const type = typeof m === "object" && m !== null && "type" in m && typeof m.type === "string" ? m.type : "";
  return (s.commands[pid] ?? []).find((c) => c.endsWith(`.${type}`)) ?? type;
};

type SendCall = typeof Call.cases.send.Type;

/** The letters that may go now and are not out yet, as `send` calls. */
const sends = (s: WindowModel): ReadonlyArray<SendCall> =>
  C.sendable(s.client)
    .filter((p) => !s.sent.includes(p.letter))
    .map((p) =>
      Call.cases.send.make({
        pid: p.pid,
        letter: p.letter,
        n: p.n,
        m: p.m,
        sentAt: p.sentAt,
        seen: p.seen,
        ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
      }),
    );

/** One write per call on `dial`, in order, each with the next id and kept in flight. */
const wrote = (
  s: WindowModel,
  dial: number,
  calls: ReadonlyArray<Call>,
): readonly [WindowModel, ReadonlyArray<ReturnType<typeof write>>] => {
  const out = calls.map((call, k) => write({ call, id: s.serial + k, dial }));
  return [
    {
      ...s,
      serial: s.serial + out.length,
      flight: [...s.flight, ...out.map((c) => ({ id: c.id, dial: c.dial, call: c.call }))],
    },
    out,
  ];
};

/** Each letter's send count, with one more for every send in `out`. */
const counted = (attempts: WindowModel["attempts"], out: ReadonlyArray<SendCall>): WindowModel["attempts"] => {
  const next: Record<string, number> = { ...attempts };

  for (const c of out) {
    next[c.letter] = (next[c.letter] ?? 0) + 1;
  }

  return next;
};

/** Writes what may go now when online, marking it out. */
const flush = (s: WindowModel): Step => {
  if (s.link._tag !== "online") {
    return [s, []];
  }

  const out = sends(s);
  return out.length === 0
    ? [s, []]
    : wrote(
        { ...s, sent: [...s.sent, ...out.map((c) => c.letter)], attempts: counted(s.attempts, out) },
        s.link.dial,
        out,
      );
};

/** The call in flight that an answer names by its id and dial, with the flight without it, or null
 *  when the answer is stale: its dial or id is not in flight, or the call is not of its kind. */
const answered = (
  s: WindowModel,
  m: { readonly id: number; readonly dial: number },
  tag: Call["_tag"],
): { readonly call: Call; readonly rest: WindowModel["flight"] } | null => {
  const found = s.flight.find((f) => f.id === m.id && f.dial === m.dial);
  return found === undefined || found.call._tag !== tag
    ? null
    : { call: found.call, rest: s.flight.filter((f) => f !== found) };
};

/** The row that ends `pid`'s run of patches, at the rev the last one installed, or none for an empty
 *  run. */
const runEnd = (s: WindowModel, pid: string): ReadonlyArray<ReturnType<typeof record>> => {
  const patches = s.patches[pid] ?? 0;
  return patches === 0
    ? []
    : [
        record({
          record: ClientRecord.cases.view.make({
            pid,
            result: "patch",
            rev: Math.max(0, s.client.views[pid]?.rev ?? 0),
            patches,
          }),
        }),
      ];
};

const noteType = (note: unknown): unknown =>
  typeof note === "object" && note !== null && "type" in note ? note.type : null;

/** One view notification for `pid`, stepped through the client, and its view rows: a whole view
 *  installed or an ask ends the pid's run of patches first, then keeps its own row; a patch
 *  installed adds one to the run. The client installs by replacing the pid's shown view, so a
 *  shown view that changed is one it installed. */
const noticed = (
  s: WindowModel,
  step: ClientStep,
  pid: string,
  note: unknown,
): readonly [WindowModel, ReadonlyArray<ReturnType<typeof record>>, ReadonlyArray<string>] => {
  const [client, asks] = step(s.client, { type: "notice", pid, note });
  const was = s.client.views[pid];
  const now = client.views[pid];
  const installed = now !== undefined && now !== was ? (noteType(note) === "patch" ? "patch" : "whole") : null;

  if (installed === "patch") {
    return [{ ...s, client, patches: { ...s.patches, [pid]: (s.patches[pid] ?? 0) + 1 } }, [], asks];
  }

  if (installed === null && asks.length === 0) {
    return [{ ...s, client }, [], asks];
  }

  const patches = Object.fromEntries(Object.entries(s.patches).filter(([p]) => p !== pid));
  const whole =
    installed === "whole" && now !== undefined
      ? [record({ record: ClientRecord.cases.view.make({ pid, result: "whole", rev: Math.max(0, now.rev) }) })]
      : [];
  const asked = asks.map((p) =>
    record({ record: ClientRecord.cases.view.make({ pid: p, result: "asked", rev: Math.max(0, was?.rev ?? 0) }) }),
  );
  return [{ ...s, client, patches }, [...runEnd(s, pid), ...whole, ...asked], asks];
};

type Outcome = (typeof ClientRecord.cases.connect.Type)["result"];

/** The link outcome a step is, from the link before and after: going online, told to wait, the key
 *  removed, or a close or stall that sent it to retry. Anything else, a stale Msg or a move into
 *  `dialing` included, is no outcome. */
const outcome = (was: Link, is: Link, m: LinkMsg): Outcome | null => {
  if (was._tag !== "online" && is._tag === "online") {
    return "online";
  }

  if (was._tag !== "waiting_grant" && is._tag === "waiting_grant") {
    return "waiting";
  }

  if (was._tag !== "removed" && is._tag === "removed") {
    return "removed";
  }

  if (was._tag !== "retrying" && is._tag === "retrying") {
    return m.type === "closed" ? "closed" : m.type === "stalled" ? "stalled" : null;
  }

  return null;
};

/** The one connect row of a link outcome, with the dial its Msg was about and the ms it carries. */
const connectRow = (was: Link, is: Link, m: LinkMsg): ReadonlyArray<ReturnType<typeof record>> => {
  const result = outcome(was, is, m);
  return result === null || !("ms" in m)
    ? []
    : [record({ record: ClientRecord.cases.connect.make({ dial: m.dial, result, ms: m.ms }) })];
};

/** A press: the client reserves its slot with what was shown, and the window asks its time. */
const pressed = (
  s: WindowModel,
  step: ClientStep,
  press: { readonly pid: string; readonly m: unknown; readonly via: "button" | "key" },
): Step => {
  const n = s.client.written;
  const [client] = step(s.client, { type: "press", pid: press.pid, m: press.m });
  return [{ ...s, client, via: { ...s.via, [n]: press.via } }, [now({ n })]];
};

/** Slot `n` got its time: the client dates it, and the window keeps its press record before the
 *  letter is sent, then sends what may go. tea runs one step's Cmds one after another in list
 *  order, so the `record` ahead of the `send`s is stored before any of them goes. */
const datedSlot = (
  s: WindowModel,
  step: ClientStep,
  n: number,
  stamp: { readonly letter: string; readonly sentAt: string; readonly traceId?: string },
): Step => {
  const [client] = step(s.client, { type: "dated", n, ...stamp });
  const { [n]: via, ...rest } = s.via;
  const slot = client.pending.find((p) => p.n === n);
  const kept =
    via !== undefined && slot?._tag === "ready" && slot.letter === stamp.letter
      ? [
          record({
            record: ClientRecord.cases.press.make({
              command: commandFor(s, slot.pid, slot.m),
              via,
              pid: slot.pid,
              viewRev: Math.max(0, slot.viewRev),
              seen: Math.max(0, slot.seen),
              letter: slot.letter,
              depth: client.pending.length,
            }),
          }),
        ]
      : [];
  const [after, out] = flush({ ...s, client, via: rest, redate: s.redate.filter((r) => r !== n) });
  return [after, [...kept, ...out]];
};

/** Steps the link by hand, then does what its move means for this window. */
const linked = (s: WindowModel, m: LinkMsg): Step => {
  const [link, cmds] = applyCell<Link, LinkMsg, ReturnType<typeof ping> | ReturnType<typeof knock>>(
    linkMachine,
    s.link,
    m,
  );
  const granted = m.type === "granted" && s.link._tag === "waiting_grant" && s.link.dial === m.dial;
  const open = socketDial(link);
  // The link's knock is a write on its dial; a dial whose socket ended drops its calls in flight.
  const [next, knocks] = wrote(
    {
      ...s,
      link,
      dials: Math.max(s.dials, open ?? 0),
      fresh: s.fresh || granted,
      rejected: link._tag === "removed" ? link.fingerprint : s.rejected,
      flight: s.flight.filter((f) => f.dial === open),
    },
    open ?? 0,
    cmds.filter((c) => c.type === "knock").map(() => Call.cases.knock.make({})),
  );
  const linkCmds = [...cmds.flatMap((c) => (c.type === "ping" ? [c] : [])), ...knocks];
  const connected = connectRow(s.link, link, m);

  if (link._tag !== "online") {
    // Leaving online ends every pid's run of patches.
    const ended = s.link._tag === "online" ? Object.keys(s.patches).flatMap((pid) => runEnd(s, pid)) : [];
    return [
      { ...next, opened: [], sent: [], patches: s.link._tag === "online" ? {} : s.patches },
      [...linkCmds, ...connected, ...ended],
    ];
  }

  if (s.link._tag === "online") {
    return [next, [...linkCmds, ...connected]];
  }

  // Going online: open each distinct pid once, send what waited in order, ask persistence once.
  const pids = [...new Set(s.tiles.map((t) => t.pid))];
  const out = sends({ ...next, sent: [] });
  const asked = next.fresh ? [persist({})] : [];
  const [written, writes] = wrote(
    {
      ...next,
      opened: pids,
      sent: out.map((c) => c.letter),
      attempts: counted(next.attempts, out),
      fresh: false,
      trouble: null,
      settings: Settings.cases.reading.make({ dial: link.dial }),
    },
    link.dial,
    [...pids.map((pid) => Call.cases.open.make({ pid })), ...out],
  );
  return [written, [...linkCmds, ...connected, ...writes, ...asked]];
};

/** The settings read once a `keys` or `keys_failed` arrives: a failure of an older dial clears to
 *  reading on the dial whose socket is open now; anything else stays. */
const read = (s: WindowModel): WindowModel["settings"] => {
  const open = socketDial(s.link);
  return s.settings._tag === "failed" && open !== null && open !== s.settings.dial
    ? Settings.cases.reading.make({ dial: open })
    : s.settings;
};

const findTile = (s: WindowModel, id: string | null) =>
  id === null ? null : (s.tiles.find((t) => t.id === id) ?? null);

const linkUpdate = Object.fromEntries(
  [
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
  ].map((type) => [type, (s: WindowModel, m: LinkMsg) => linked(s, m)]),
) as {
  readonly [K in LinkMsg["type"]]: (s: WindowModel, m: Extract<LinkMsg, { readonly type: K }>) => Step;
};

const fresh = (ctx: WindowCtx | undefined, client: ProgramClient.Client): WindowModel => {
  const tiles = ctx === undefined ? [] : tilesIn(ctx.layout);
  const defaults = ctx?.keys?.defaults ?? {};
  return WindowModel.make({
    tiles: tiles.map((t) => ({ id: t.id, pid: t.pid })),
    defaults,
    commands: Object.fromEntries(tiles.map((t) => [t.pid, [...(ctx?.keys?.commands(t.pid) ?? [])]])),
    link: linkMachine.init(null, {})[0],
    dials: 1,
    size: null,
    client,
    opened: [],
    sent: [],
    serial: 1,
    flight: [],
    attempts: {},
    patches: {},
    fresh: false,
    redate: [],
    via: {},
    rejected: null,
    focus: null,
    keys: Keys.buildTable(defaults, {}),
    armed: null,
    keyError: null,
    settings: Settings.cases.reading.make({ dial: 1 }),
    trouble: null,
  });
};

/** The socket for one dial; a replaced key is named so the next dial makes its successor. */
type SocketSub = Sub<"socket", { readonly dial: number; readonly rejected: string | null }>;

/** The window machine, checking each view with `checks` through the client machine it steps. */
export const windowMachineFor = (checks: WindowChecks) => {
  const clientMachine = C.clientMachineFor(checks);
  /** One step of the client machine, by hand, as the link is stepped: its Model and its asks. */
  const step: ClientStep = (client, m) => {
    const [next, cmds] = applyCell<
      ProgramClient.Client,
      ProgramClient.ClientMsg,
      { readonly type: "ask"; readonly pid: string }
    >(clientMachine, client, m);
    return [next, cmds.map((c) => c.pid)];
  };
  return Machine.make({
    model: WindowModel,
    msg: Schema.Union([LinkMsg, Own]),
    cmds: [now, write, persist, read_settings, record, ping],
    types: { sub: {} as SocketSub, ctx: {} as WindowCtx },
    init: (loaded, ctx) => [loaded ?? fresh(ctx, clientMachine.init(null, {})[0]), []],
    update: {
      ...linkUpdate,
      press: (s, m) => pressed(s, step, { pid: m.pid, m: m.m, via: m.via ?? "button" }),
      now_ok: (s, m) => datedSlot(s, step, m.cmd.n, m.value),
      now_err: (s, m) =>
        s.client.pending.some((p) => p.n === m.cmd.n && p._tag === "dating") && !s.redate.includes(m.cmd.n)
          ? [{ ...s, redate: [...s.redate, m.cmd.n] }, []]
          : [s, []],
      // A write handed over waits for its answer on the socket. One that could not be handed over is
      // no longer in flight: its letter may go again, and an open that did not go says so.
      write_ok: (s) => [s, []],
      write_err: (s, m) => {
        const found = answered(s, m.cmd, m.cmd.call._tag);

        if (found === null) {
          return [s, []];
        }

        const next = { ...s, flight: found.rest };
        const call = found.call;
        return call._tag === "send"
          ? [{ ...next, sent: s.sent.filter((l) => l !== call.letter) }, []]
          : call._tag === "open"
            ? [{ ...next, trouble: "no_view" }, []]
            : [next, []];
      },
      // A letter its own answer settles keeps one reply row, with every send of it and the ms its
      // answer carries. A duplicate or stale answer settles nothing and keeps none.
      send_ok: (s, m) => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;
        const [client] = step(s.client, { type: "reply", letter, answer: m.value });
        const settled =
          s.client.pending.some((p) => p._tag === "ready" && p.letter === letter) &&
          !client.pending.some((p) => p._tag === "ready" && p.letter === letter);
        const replied = settled
          ? [
              record({
                record: ClientRecord.cases.reply.make({
                  letter,
                  result: m.value._tag,
                  attempts: s.attempts[letter] ?? 0,
                  ms: m.ms,
                }),
              }),
            ]
          : [];
        return [
          {
            ...s,
            client,
            flight: found.rest,
            sent: s.sent.filter((l) => l !== letter),
            attempts: settled
              ? Object.fromEntries(Object.entries(s.attempts).filter(([l]) => l !== letter))
              : s.attempts,
            trouble: m.value._tag === "refused" ? m.value.reason : s.trouble,
          },
          replied,
        ];
      },
      // A transport failure frees the letter for the retry timer. An answer the client cannot read
      // keeps it out on this dial, so it is not sent again until the next one, and says so.
      send_err: (s, m) => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;
        return m.error._tag === "unreachable"
          ? [{ ...s, flight: found.rest, sent: s.sent.filter((l) => l !== letter) }, []]
          : [{ ...s, flight: found.rest, trouble: "unknown_reply" }, []];
      },
      // A whole view on the current dial. The client's ask for another becomes the window's
      // trouble: this open just answered, so a second one would ask the same.
      open_ok: (s, m) => {
        const found = answered(s, m, "open");

        if (found === null || found.call._tag !== "open") {
          return [s, []];
        }

        if (s.link._tag !== "online" || s.link.dial !== m.dial) {
          return [{ ...s, flight: found.rest }, []];
        }

        const [next, rows, asks] = noticed({ ...s, flight: found.rest }, step, found.call.pid, {
          type: "whole",
          rev: m.value.rev,
          view: m.value.view,
        });
        return [{ ...next, trouble: asks.length > 0 ? "bad_view" : s.trouble }, rows];
      },
      open_err: (s, m) => {
        const found = answered(s, m, "open");
        return found === null ? [s, []] : [{ ...s, flight: found.rest, trouble: "no_view" }, []];
      },
      // A knock's answer only ends it: the link's renew timer knocks again, and `gateway.waiting`
      // brings its code.
      knock_ok: (s, m) => {
        const found = answered(s, m, "knock");
        return found === null ? [s, []] : [{ ...s, flight: found.rest }, []];
      },
      knock_err: (s, m) => {
        const found = answered(s, m, "knock");
        return found === null ? [s, []] : [{ ...s, flight: found.rest }, []];
      },
      // The persistence answer is kept once: the browser's yes or no, or that it could not ask.
      persist_ok: (s, m) => [
        s,
        [record({ record: ClientRecord.cases.persist.make({ result: m.value ? "granted" : "refused" }) })],
      ],
      persist_err: (s, m) => [
        s,
        [
          record({
            record:
              m.error._tag === "unsupported"
                ? ClientRecord.cases.failure.make({ op: "persist", error: "NotSupportedError" })
                : ClientRecord.cases.persist.make({ result: "failed" }),
          }),
        ],
      ],
      identity: (s, m) => [s, [record({ record: ClientRecord.cases.key.make({ result: m.found }) })]],
      // A record the tab could not keep is lost to the door, never to the window's own state.
      record_ok: (s) => [s, []],
      record_err: (s) => [s, []],
      // A ping that could not go is the link's to notice: its timers move it on.
      ping_ok: (s) => [s, []],
      ping_err: (s) => [s, []],
      // A view notification. The client's ask for a whole view becomes a fresh open when the
      // pid is open on this dial; otherwise the next dial's open brings one. A notice that installs
      // a view ends its pid's open in flight: the brain publishes the open's whole before it
      // answers, so that answer is never newer and would only roll the view back (A14).
      view: (s, m) => {
        const [noticedModel, rows, asks] = noticed(s, step, m.pid, m.note);
        const next =
          noticedModel.client.views[m.pid] === s.client.views[m.pid]
            ? noticedModel
            : {
                ...noticedModel,
                flight: noticedModel.flight.filter((f) => f.call._tag !== "open" || f.call.pid !== m.pid),
              };

        if (asks.length === 0 || s.link._tag !== "online" || !s.opened.includes(m.pid)) {
          return [next, rows];
        }

        const [written, writes] = wrote(next, s.link.dial, [Call.cases.open.make({ pid: m.pid })]);
        return [written, [...rows, ...writes]];
      },
      resend: (s, m) => {
        const redated = s.redate.flatMap((n) =>
          s.client.pending.some((p) => p.n === n && p._tag === "dating") ? [now({ n })] : [],
        );
        const cleared = { ...s, redate: [] };

        if (s.link._tag !== "online" || s.link.dial !== m.dial) {
          return [cleared, redated];
        }

        // The online dial's failed settings read goes again on its tick, once (A16).
        const again = s.settings._tag === "failed" && s.settings.dial === m.dial;
        const [after, out] = flush(
          again ? { ...cleared, settings: Settings.cases.reading.make({ dial: m.dial }) } : cleared,
        );
        return [after, [...redated, ...out, ...(again ? [read_settings({ dial: m.dial })] : [])]];
      },
      resized: (s, m) => (s.size?.w === m.w && s.size.h === m.h ? [s, []] : [{ ...s, size: { w: m.w, h: m.h } }, []]),
      focus: (s, m) => [{ ...s, focus: findTile(s, m.tile) === null ? null : m.tile, armed: null }, []],
      key: (s, m) => {
        const tile = findTile(s, s.focus);
        const routed = routeKey({
          table: s.keys,
          armed: s.armed,
          event: m.event,
          tile,
          commands: tile === null ? [] : (s.commands[tile.pid] ?? []),
        });
        const next = { ...s, armed: routed.armed };
        return routed.press === null
          ? [next, []]
          : pressed(next, step, { pid: routed.press.pid, m: routed.press.m, via: "key" });
      },
      keys: (s, m) => [
        {
          ...s,
          keys: Keys.buildTable(s.defaults, m.rows),
          armed: null,
          keyError: null,
          settings: read(s),
        },
        [],
      ],
      keys_failed: (s, m) => [{ ...s, keyError: m.error, armed: null, settings: read(s) }, []],
      // A failed read on the online dial keeps its reason and leaves the link as it is: the read
      // restarts on its resend tick, never the dial, so the socket's own close keeps its code (A16).
      settings_failed: (s, m) =>
        s.link._tag !== "online" || s.link.dial !== m.dial
          ? [s, []]
          : [{ ...s, settings: Settings.cases.failed.make({ dial: m.dial, reason: m.reason }) }, []],
      // The runner has the read again, or its dial is gone: either way nothing more to do.
      read_settings_ok: (s) => [s, []],
      read_settings_err: (s) => [s, []],
      seen: (s, m) => {
        const [client] = step(s.client, { type: "read", rev: m.rev });
        return [{ ...s, client }, []];
      },
    },
    subs: [
      { type: "timer", deps: (s) => timerDeps(s.link) },
      {
        type: "timer",
        deps: (s) => {
          const dial = socketDial(s.link) ?? 0;
          const failed = s.settings._tag === "failed" && s.settings.dial === dial;
          const waiting = s.redate.length > 0 || (s.link._tag === "online" && (sends(s).length > 0 || failed));
          return waiting ? { ms: RETRY, msg: { type: "resend" as const, dial } } : null;
        },
      },
      {
        type: "socket",
        deps: (s) => {
          const dial = socketDial(s.link);
          return dial === null ? null : { dial, rejected: s.rejected };
        },
      },
    ],
  });
};

/** Every Msg the window folds: its own and the link's, and the answers tea mints for its Cmds. */
export type WindowMsg =
  ReturnType<typeof windowMachineFor> extends Machine<WindowModel, infer M, infer _C, infer _U, infer _X> ? M : never;
