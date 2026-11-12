// next/: the window parent steps Link, Client and the tiles by sending each its own Msgs.
import { applyCell, type Sub } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { type AnyTile, clientMachineFor, ClientRecord, ProgramClient as C, Sent } from "@kampus/libfabrika";
import { ClientKeyError } from "@kampus/libfabrika/transport/ClientKey";
import { Link, linkMachine, LinkMsg, ping, socketDial, timerDeps } from "@kampus/libfabrika/transport/Link";
import { Predicate, Result, Schema } from "effect";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

const Reach = Schema.TaggedUnion({
  unresolved: {},
  resolving: { id: Schema.Int },
  opening: { pid: Schema.String, id: Schema.Int },
  open: { pid: Schema.String },
  missing: {},
});

const Call = Schema.TaggedUnion({
  read: { stream: Schema.String, after: Schema.Int },
  open: { pid: Schema.String },
  send: {
    pid: Schema.String,
    letter: Schema.String,
    n: Schema.Int,
    m: Schema.Json,
    sentAt: Schema.String,
    seen: Schema.Int,
    traceId: Schema.optionalKey(Schema.String),
  },
  knock: {},
});
type Call = typeof Call.Type;

const CallError = Schema.TaggedUnion({
  unreachable: {},
  unknown: { reason: Schema.optionalKey(Schema.String) },
  closed: {},
});

const OnWrite = { id: Schema.Int, dial: Schema.Int };
const Via = Schema.Literals(["button", "key"]);

export const WindowModel = Schema.Struct({
  tiles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      last: Schema.NullOr(Schema.String),
      reach: Reach,
      own: Schema.Json,
      refusal: Schema.NullOr(Schema.Struct({ m: Schema.Json, reason: Schema.String })),
    }),
  ),
  link: Link,
  dials: Schema.Int,
  tries: Count,
  client: C.Client,
  serial: Schema.Int,
  flight: Schema.Array(Schema.Struct({ ...OnWrite, call: Call })),
  sent: Schema.Array(Schema.String),
  attempts: Schema.Record(Schema.String, Count),
  patches: Schema.Record(Schema.String, Count),
  persist: Schema.Literals(["not_due", "due", "asked"]),
  rejected: Schema.NullOr(Schema.String),
  trouble: Schema.NullOr(Schema.String),
  // Slot ownership survives reconnects and identifies the tile whose answer is refused.
  from: Schema.Record(Schema.String, Schema.Struct({ tile: Schema.String, via: Via })),
  redate: Schema.Array(Schema.Int),
});
export type WindowModel = typeof WindowModel.Type;

const Own = Schema.Union([
  Schema.Struct({ type: Schema.Literal("press"), tile: Schema.String, m: Schema.Json, via: Schema.optionalKey(Via) }),
  Schema.Struct({ type: Schema.Literal("tile"), id: Schema.String, msg: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("view"), pid: Schema.String, note: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("seen"), rev: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("resend"), dial: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("read_ok"), ...OnWrite, value: Schema.Array(Schema.Unknown), ms: Ms }),
  Schema.Struct({ type: Schema.Literal("read_err"), ...OnWrite, error: CallError }),
  Schema.Struct({
    type: Schema.Literal("open_ok"),
    ...OnWrite,
    value: Schema.Struct({ rev: Schema.Int, view: Schema.Json }),
    ms: Ms,
  }),
  Schema.Struct({ type: Schema.Literal("open_err"), ...OnWrite, error: CallError }),
  Schema.Struct({ type: Schema.Literal("send_ok"), ...OnWrite, value: Sent, ms: Ms }),
  Schema.Struct({ type: Schema.Literal("send_err"), ...OnWrite, error: CallError }),
  Schema.Struct({ type: Schema.Literal("knock_ok"), ...OnWrite, value: Schema.Null, ms: Ms }),
  Schema.Struct({ type: Schema.Literal("knock_err"), ...OnWrite, error: CallError }),
]);

const key = Cmd.make("key", {
  input: Schema.Struct({ rejected: Schema.NullOr(Schema.String) }),
  ok: Schema.Struct({ found: Schema.Literals(["created", "reused", "replaced"]) }),
  err: ["ClientKeyError"],
});

const keyFailure = (error: unknown) => {
  const decoded = Schema.decodeUnknownResult(ClientKeyError)(error);
  return Result.isSuccess(decoded) ? decoded.success.error : ("other" as const);
};

const now = Cmd.make("now", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Struct({ letter: Schema.String, sentAt: Schema.String, traceId: Schema.optionalKey(Schema.String) }),
  err: ["clock", "entropy"],
});

export const write = Cmd.make("write", {
  input: Schema.Struct({ call: Call, ...OnWrite }),
  ok: Schema.Null,
  err: ["unreachable"],
});

const persist = Cmd.make("persist", { input: Schema.Struct({}), ok: Schema.Boolean, err: ["unsupported", "failed"] });
const record = Cmd.make("record", { input: Schema.Struct({ record: ClientRecord }), ok: Schema.Null, err: ["failed"] });

type Out = ReadonlyArray<
  | ReturnType<typeof key>
  | ReturnType<typeof now>
  | ReturnType<typeof write>
  | ReturnType<typeof persist>
  | ReturnType<typeof record>
  | ReturnType<typeof ping>
>;

type Step = readonly [WindowModel, Out];
type ClientStep = (client: C.Client, msg: C.ClientMsg) => readonly [C.Client, ReadonlyArray<string>];

type WindowChecks = C.ClientChecks & { readonly tile?: (name: string) => AnyTile | undefined };
type WindowCtx = { readonly tiles: ReadonlyArray<{ readonly id: string; readonly name: string }> };
type SocketSub = Sub<"socket", { readonly dial: number; readonly rejected: string | null; readonly tries: number }>;

const wrote = (s: WindowModel, dial: number, calls: ReadonlyArray<Call>): Step => {
  const out = calls.map((call, i) => write({ call, id: s.serial + i, dial }));
  return [
    {
      ...s,
      serial: s.serial + out.length,
      flight: [...s.flight, ...out.map((c) => ({ id: c.id, dial, call: c.call }))],
    },
    out,
  ];
};

const flush = (s: WindowModel): Step => {
  if (s.link._tag !== "online") {
    return [s, []];
  }

  const calls = C.sendable(s.client)
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
  const attempts = { ...s.attempts };

  for (const call of calls) {
    attempts[call.letter] = (attempts[call.letter] ?? 0) + 1;
  }

  return wrote({ ...s, sent: [...s.sent, ...calls.map((c) => c.letter)], attempts }, s.link.dial, calls);
};

const answered = (s: WindowModel, m: { readonly id: number; readonly dial: number }, tag: Call["_tag"]) => {
  const found = s.flight.find((f) => f.id === m.id && f.dial === m.dial && f.call._tag === tag);
  return found === undefined ? null : { call: found.call, rest: s.flight.filter((f) => f !== found) };
};

const runEnd = (s: WindowModel, pid: string): ReadonlyArray<ReturnType<typeof record>> =>
  (s.patches[pid] ?? 0) === 0
    ? []
    : [
        record({
          record: ClientRecord.cases.view.make({
            pid,
            result: "patch",
            rev: Math.max(0, s.client.views[pid]?.rev ?? 0),
            patches: s.patches[pid] ?? 0,
          }),
        }),
      ];

const noticed = (
  s: WindowModel,
  step: ClientStep,
  pid: string,
  note: unknown,
): readonly [WindowModel, Out, ReadonlyArray<string>] => {
  const [client, asks] = step(s.client, { type: "notice", pid, note });
  const shown = client.views[pid];
  const changed = shown !== undefined && shown !== s.client.views[pid];
  const patch = Predicate.isObject(note) && Predicate.hasProperty(note, "type") && note.type === "patch";

  if (changed && patch) {
    return [{ ...s, client, patches: { ...s.patches, [pid]: (s.patches[pid] ?? 0) + 1 } }, [], asks];
  }

  if (!changed && asks.length === 0) {
    return [{ ...s, client }, [], asks];
  }

  const rows = [
    ...runEnd(s, pid),
    ...(changed
      ? [record({ record: ClientRecord.cases.view.make({ pid, result: "whole", rev: Math.max(0, shown?.rev ?? 0) }) })]
      : []),
    ...asks.map((p) =>
      record({
        record: ClientRecord.cases.view.make({
          pid: p,
          result: "asked",
          rev: Math.max(0, s.client.views[p]?.rev ?? 0),
        }),
      }),
    ),
  ];
  return [
    { ...s, client, patches: Object.fromEntries(Object.entries(s.patches).filter(([p]) => p !== pid)) },
    rows,
    asks,
  ];
};

const opened = (s: WindowModel, pid: string): WindowModel => ({
  ...s,
  trouble: null,
  tiles: s.tiles.map((t) =>
    "pid" in t.reach && t.reach.pid === pid ? { ...t, last: pid, reach: Reach.cases.open.make({ pid }) } : t,
  ),
  flight: s.flight.filter((f) => f.call._tag !== "open" || f.call.pid !== pid),
});

const pressed = (s: WindowModel, step: ClientStep, tile: string, m: Schema.Json, via: "button" | "key"): Step => {
  const found = s.tiles.find((t) => t.id === tile);

  if (found?.reach._tag !== "open") {
    return [s, []];
  }

  const n = s.client.written;
  const [client] = step(s.client, { type: "press", pid: found.reach.pid, m });
  return [
    {
      ...s,
      client,
      from: { ...s.from, [n]: { tile, via } },
      tiles: s.tiles.map((t) => (t.id === tile ? { ...t, refusal: null } : t)),
    },
    [now({ n })],
  ];
};

const dated = (
  s: WindowModel,
  step: ClientStep,
  n: number,
  stamp: { readonly letter: string; readonly sentAt: string; readonly traceId?: string },
): Step => {
  const before = s.client.pending.find((p) => p.n === n);
  const [client] = step(s.client, { type: "dated", n, ...stamp });
  const slot = client.pending.find((p) => p.n === n);
  const owner = s.from[n];
  const tile = s.tiles.find((t) => t.id === owner?.tile);
  const type =
    slot &&
    Predicate.isObject(slot.m) &&
    Predicate.hasProperty(slot.m, "type") &&
    Predicate.isString(slot.m.type) &&
    /^[a-z_]{1,40}$/.test(slot.m.type)
      ? slot.m.type
      : "other";
  const command = `${tile?.name.split(":")[0] ?? "program"}.${type}`;
  const rows =
    before?._tag === "dating" && slot?._tag === "ready" && owner !== undefined
      ? [
          record({
            record: ClientRecord.cases.press.make({
              command,
              via: owner.via,
              pid: slot.pid,
              viewRev: Math.max(0, slot.viewRev),
              seen: Math.max(0, slot.seen),
              letter: slot.letter,
              depth: client.pending.length,
            }),
          }),
        ]
      : [];
  const [next, cmds] = flush({ ...s, client, redate: s.redate.filter((r) => r !== n) });
  return [next, [...rows, ...cmds]];
};

const linked = (s: WindowModel, m: LinkMsg): Step => {
  const input = m.type === "ask_again" ? { ...m, dial: Math.max(s.dials + 1, m.dial) } : m;
  const [link, cmds] = applyCell(linkMachine, s.link, input);
  const open = socketDial(link);
  const granted = m.type === "granted" && s.link._tag === "waiting_grant" && s.link.dial === m.dial;
  let next: WindowModel = {
    ...s,
    link,
    dials: Math.max(s.dials, open ?? 0),
    tries: link._tag === "dialing" && open !== socketDial(s.link) ? (link.tries ?? 0) : s.tries,
    persist: granted ? "due" : s.persist,
    rejected: link._tag === "removed" ? link.fingerprint : s.rejected,
    flight: s.flight.filter((f) => f.dial === open),
  };
  const out: Array<Out[number]> = cmds.filter((c): c is ReturnType<typeof ping> => c.type === "ping");
  const knocks = cmds.filter((c) => c.type === "knock").map(() => Call.cases.knock.make({}));
  const [knocked, writes] = wrote(next, open ?? 0, knocks);
  next = knocked;
  out.push(...writes);
  const result =
    s.link._tag !== "online" && link._tag === "online"
      ? "online"
      : s.link._tag !== "waiting_grant" && link._tag === "waiting_grant"
        ? "waiting"
        : s.link._tag !== "removed" && link._tag === "removed"
          ? "removed"
          : s.link._tag !== "retrying" && link._tag === "retrying"
            ? m.type === "closed"
              ? "closed"
              : "stalled"
            : null;

  if (result !== null && "ms" in m) {
    out.push(record({ record: ClientRecord.cases.connect.make({ dial: m.dial, result, ms: m.ms }) }));
  }

  if (s.link._tag === "removed" && m.type === "ask_again" && link._tag === "dialing") {
    out.push(key({ rejected: s.link.fingerprint }));
  }

  if (link._tag !== "online") {
    if (s.link._tag === "online") {
      out.push(...Object.keys(s.patches).flatMap((pid) => runEnd(s, pid)));
    }

    return [
      {
        ...next,
        tiles: next.tiles.map((t) => ({ ...t, reach: Reach.cases.unresolved.make({}) })),
        sent: [],
        patches: s.link._tag === "online" ? {} : s.patches,
      },
      out,
    ];
  }

  if (s.link._tag === "online") {
    return [next, out];
  }

  const [reading, reads] = wrote(
    next,
    link.dial,
    s.tiles.map((t) => Call.cases.read.make({ stream: `processes/${t.name}`, after: 0 })),
  );
  next = {
    ...reading,
    trouble: null,
    tiles: reading.tiles.map((t, i) => ({ ...t, reach: Reach.cases.resolving.make({ id: next.serial + i }) })),
  };
  const askPersist = next.persist === "due";

  if (askPersist) {
    next = { ...next, persist: "asked" };
  }

  const [flushed, sends] = flush(next);
  return [flushed, [...out, ...reads, ...sends, ...(askPersist ? [persist({})] : [])]];
};

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
  ].map((type) => [type, linked]),
) as { readonly [K in LinkMsg["type"]]: (s: WindowModel, m: Extract<LinkMsg, { readonly type: K }>) => Step };

/** One parent per run. Decoder functions and child machines stay outside saved data. */
export const windowMachineFor = (checks: WindowChecks) => {
  const client = clientMachineFor(checks);
  const step: ClientStep = (s, m) => {
    const [next, cmds] = applyCell(client, s, m);
    return [next, cmds.map((c) => c.pid)];
  };
  return Machine.make({
    model: WindowModel,
    msg: Schema.Union([LinkMsg, Own]),
    cmds: [key, now, write, persist, record, ping],
    types: { ctx: {} as WindowCtx, sub: {} as SocketSub },
    init: (loaded, ctx) => [
      loaded ??
        WindowModel.make({
          tiles: ctx.tiles.map((t) => ({
            ...t,
            reach: Reach.cases.unresolved.make({}),
            own: checks.tile?.(t.name)?.init(null, {})[0] ?? {},
            refusal: null,
            last: null,
          })),
          link: linkMachine.init(null, {})[0],
          dials: 1,
          tries: 0,
          client: client.init(null, {})[0],
          serial: 1,
          flight: [],
          sent: [],
          attempts: {},
          patches: {},
          persist: "not_due",
          rejected: null,
          trouble: null,
          from: {},
          redate: [],
        }),
      [key({ rejected: null })],
    ],
    update: {
      ...linkUpdate,
      press: (s, m): Step => pressed(s, step, m.tile, m.m, m.via ?? "button"),
      tile: (s, m): Step => {
        const t = s.tiles.find((t) => t.id === m.id);
        const child = t && checks.tile?.(t.name);

        if (t === undefined || child === undefined) {
          return [s, []];
        }

        const msg = Schema.decodeUnknownResult(child.msg)(m.msg);

        if (Result.isFailure(msg)) {
          return [s, []];
        }

        const [own, cmds] = applyCell(child, t.own, msg.success);

        if (!Schema.is(child.model)(own) || !Schema.is(Schema.Json)(own)) {
          return [s, []];
        }

        // Keep the draft until the parent can take the child's press as a letter.
        if (t.reach._tag !== "open" && cmds.some((cmd) => cmd.type === "press")) {
          return [s, []];
        }

        let next = { ...s, tiles: s.tiles.map((row) => (row.id === t.id ? { ...row, own } : row)) };
        const out: Array<Out[number]> = [];

        for (const cmd of cmds) {
          if (cmd.type === "press" && Schema.is(Schema.Struct({ m: Schema.Json }))(cmd)) {
            const [after, sent] = pressed(next, step, t.id, cmd.m, "button");
            next = after;
            out.push(...sent);
          }
        }

        return [next, out];
      },
      key_ok: (s, m): Step => [s, [record({ record: ClientRecord.cases.key.make({ result: m.value.found }) })]],
      key_err: (s, m): Step => {
        const error = keyFailure(m.error);
        const [next, cmds] = linked(s, { type: "blocked", reason: error });
        return [next, [...cmds, record({ record: ClientRecord.cases.failure.make({ op: "key", error }) })]];
      },
      now_ok: (s, m): Step => dated(s, step, m.cmd.n, m.value),
      now_err: (s, m): Step => [{ ...s, redate: [...new Set([...s.redate, m.cmd.n])] }, []],
      write_ok: (s): Step => [s, []],
      write_err: (s, m): Step => {
        const found = answered(s, m.cmd, m.cmd.call._tag);

        if (found === null) {
          return [s, []];
        }

        const call = found.call;
        return [
          {
            ...s,
            flight: found.rest,
            sent: call._tag === "send" ? s.sent.filter((l) => l !== call.letter) : s.sent,
            tiles:
              call._tag === "read"
                ? s.tiles.map((t) =>
                    t.reach._tag === "resolving" && t.reach.id === m.cmd.id
                      ? { ...t, reach: Reach.cases.missing.make({}) }
                      : t,
                  )
                : s.tiles,
          },
          [],
        ];
      },
      read_ok: (s, m): Step => {
        const found = answered(s, m, "read");

        if (found === null) {
          return [s, []];
        }

        const tile = s.tiles.find((t) => t.reach._tag === "resolving" && t.reach.id === m.id);

        if (tile === undefined) {
          return [{ ...s, flight: found.rest }, []];
        }

        const pid = C.resolveName(m.value, tile.name, (by) => by === "brain" || by.startsWith("brain:"));
        const [seen] = step(s.client, {
          type: "read",
          rev: Math.max(
            s.client.seen,
            ...m.value.flatMap((e) =>
              Predicate.isObject(e) && Predicate.hasProperty(e, "rev") && Predicate.isNumber(e.rev) ? [e.rev] : [],
            ),
          ),
        });
        const next = { ...s, client: seen, flight: found.rest };

        if (pid === null) {
          return [
            {
              ...next,
              tiles: s.tiles.map((t) => (t.id === tile.id ? { ...t, reach: Reach.cases.missing.make({}) } : t)),
            },
            [],
          ];
        }

        const [written, cmds] = wrote(next, m.dial, [Call.cases.open.make({ pid })]);
        return [
          {
            ...written,
            tiles: written.tiles.map((t) =>
              t.id === tile.id ? { ...t, reach: Reach.cases.opening.make({ pid, id: written.serial - 1 }) } : t,
            ),
          },
          cmds,
        ];
      },
      read_err: (s, m): Step => {
        const found = answered(s, m, "read");
        return found === null
          ? [s, []]
          : [
              {
                ...s,
                flight: found.rest,
                trouble: "No process",
                tiles: s.tiles.map((t) =>
                  t.reach._tag === "resolving" && t.reach.id === m.id
                    ? { ...t, reach: Reach.cases.missing.make({}) }
                    : t,
                ),
              },
              [],
            ];
      },
      open_ok: (s, m): Step => {
        const found = answered(s, m, "open");

        if (found === null || found.call._tag !== "open") {
          return [s, []];
        }

        const pid = found.call.pid;
        const [next, rows, asks] = noticed({ ...s, flight: found.rest }, step, pid, { type: "whole", ...m.value });

        if (asks.length > 0 && s.link._tag === "online") {
          const calls = asks
            .filter((p) => !next.flight.some((f) => f.call._tag === "open" && f.call.pid === p))
            .map((p) => Call.cases.open.make({ pid: p }));
          const [written, writes] = wrote({ ...next, trouble: "Bad view" }, s.link.dial, calls);
          return [written, [...rows, ...writes]];
        }

        return [
          next.client.views[pid] !== s.client.views[pid] ? opened(next, pid) : { ...next, trouble: "Bad view" },
          rows,
        ];
      },
      open_err: (s, m): Step => {
        const found = answered(s, m, "open");
        return found === null ? [s, []] : [{ ...s, flight: found.rest, trouble: "No view" }, []];
      },
      send_ok: (s, m): Step => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;
        const slot = s.client.pending.find((p) => p._tag === "ready" && p.letter === letter);
        const [client] = step(s.client, { type: "reply", letter, answer: m.value });
        const owner = slot && s.from[slot.n]?.tile;
        return [
          {
            ...s,
            client,
            flight: found.rest,
            sent: s.sent.filter((l) => l !== letter),
            attempts: Object.fromEntries(Object.entries(s.attempts).filter(([l]) => l !== letter)),
            from: Object.fromEntries(Object.entries(s.from).filter(([n]) => Number(n) !== slot?.n)),
            tiles:
              m.value._tag !== "refused" || slot === undefined
                ? s.tiles
                : s.tiles.map((t) =>
                    t.id === owner
                      ? { ...t, refusal: { m: slot.m, reason: m.value._tag === "refused" ? m.value.reason : "" } }
                      : t,
                  ),
          },
          [
            record({
              record: ClientRecord.cases.reply.make({
                letter,
                result: m.value._tag,
                attempts: s.attempts[letter] ?? 0,
                ms: m.ms,
                ...(m.value._tag === "refused"
                  ? { reason: /^[a-z_]{1,40}$/.test(m.value.reason) ? m.value.reason : "other" }
                  : {}),
              }),
            }),
          ],
        ];
      },
      send_err: (s, m): Step => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;
        return [
          {
            ...s,
            flight: found.rest,
            sent: m.error._tag === "unreachable" ? s.sent.filter((l) => l !== letter) : s.sent,
          },
          [],
        ];
      },
      knock_ok: (s, m): Step => {
        const f = answered(s, m, "knock");
        return f === null ? [s, []] : [{ ...s, flight: f.rest }, []];
      },
      knock_err: (s, m): Step => {
        const f = answered(s, m, "knock");
        return f === null ? [s, []] : [{ ...s, flight: f.rest }, []];
      },
      view: (s, m): Step => {
        const [next, rows, asks] = noticed(s, step, m.pid, m.note);
        const after = next.client.views[m.pid] !== s.client.views[m.pid] ? opened(next, m.pid) : next;

        if (
          asks.length === 0 ||
          s.link._tag !== "online" ||
          !s.tiles.some((t) => "pid" in t.reach && t.reach.pid === m.pid)
        ) {
          return [after, rows];
        }

        if (after.flight.some((f) => f.call._tag === "open" && f.call.pid === m.pid)) {
          return [after, rows];
        }

        const [written, writes] = wrote(after, s.link.dial, [Call.cases.open.make({ pid: m.pid })]);
        return [written, [...rows, ...writes]];
      },
      seen: (s, m): Step => [{ ...s, client: step(s.client, { type: "read", rev: m.rev })[0] }, []],
      resend: (s, m): Step => {
        if (socketDial(s.link) !== m.dial) {
          return [s, []];
        }

        const [next, out] = flush({ ...s, redate: [] });
        return [next, [...s.redate.map((n) => now({ n })), ...out]];
      },
      persist_ok: (s, m): Step => [
        s,
        [record({ record: ClientRecord.cases.persist.make({ result: m.value ? "granted" : "refused" }) })],
      ],
      persist_err: (s, m): Step => [
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
      record_ok: (s): Step => [s, []],
      // A failure row is attempted once; a failing failure row cannot recurse.
      record_err: (s, m): Step => [
        s,
        m.cmd.record._tag === "failure"
          ? []
          : [record({ record: ClientRecord.cases.failure.make({ op: "record", error: "other" }) })],
      ],
      ping_ok: (s): Step => [s, []],
      ping_err: (s): Step => [s, []],
    },
    subs: [
      { type: "timer", deps: (s) => timerDeps(s.link) },
      {
        type: "timer",
        deps: (s) =>
          s.redate.length > 0 ||
          (s.link._tag === "online" && C.sendable(s.client).some((p) => !s.sent.includes(p.letter)))
            ? { ms: 2000, msg: { type: "resend" as const, dial: socketDial(s.link) ?? 0 } }
            : null,
      },
      {
        type: "socket",
        deps: (s) => {
          const dial = socketDial(s.link);
          return dial === null ? null : { dial, rejected: s.rejected, tries: s.tries };
        },
      },
    ],
  });
};

export type WindowMsg =
  ReturnType<typeof windowMachineFor> extends Machine<WindowModel, infer M, infer _C, infer _U, infer _X> ? M : never;
