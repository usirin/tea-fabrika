// Experiment: 0093's second check, next/. Laws for the gateway's waiting machine, written from its
// plan alone, before reading the file's own tests. Each law walks the real machine from its real
// `init` (0093): every move is picked from the Model folded so far, so a key that is waiting, a
// client that is in a row and a time at a row's deadline are all reached without a hand-built list.
// The expected answer for each step is read from the step before, never from the machine's code.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Result, Schema } from "effect";
import { machine, rows, Stored } from "./waiting.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

type Model = typeof machine.model.Type;
type Msg = typeof machine.msg.Type;
type Waiting = Extract<Model, { readonly _tag: "waiting" }>;
type Pending = Waiting["rows"][number];
type Knock = Extract<Msg, { readonly type: "knock" }>;

/** Compiled, never meant to hold at run time: each `@ts-expect-error` is a Model tsc must refuse. */
const contracts = (row: Pending) => {
  expectTypeOf<Model["_tag"]>().toEqualTypeOf<"empty" | "waiting">();
  const waiting: Model = { _tag: "waiting", rows: [row], most: 1, ttl: 1 };
  const empty: Model = { _tag: "empty", rows: [], most: 1, ttl: 1 };
  // @ts-expect-error a pending row waits for at least one client
  const lonely: Pending = { ...row, clients: [] };
  // @ts-expect-error waiting holds at least one row
  const hollow: Model = { _tag: "waiting", rows: [], most: 1, ttl: 1 };
  // @ts-expect-error empty holds no row
  const full: Model = { _tag: "empty", rows: [row], most: 1, ttl: 1 };
  return [waiting, empty, lonely, hollow, full];
};

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

/** One raw draw. What it means is read against the Model the walk has reached. */
const Draw = Schema.Struct({
  move: Nat,
  pick: Nat,
  other: Nat,
  time: Nat,
  word: Nat,
  agent: Schema.Boolean,
  pass: Schema.Boolean,
});
type Draw = typeof Draw.Type;

const Config = Schema.Struct({
  most: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  ttl: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 })),
});
type Config = typeof Config.Type;

const Walk = Arbitrary.all({
  config: Arbitrary.schema(Config),
  draws: Arbitrary.array(Arbitrary.schema(Draw), { minLength: 10, maxLength: 60 }),
});

/** Few keys and clients, so repeats, leaves of a real client and overflow all come up often. */
const KEYS = ["ka", "kb", "kc", "kd", "ke", "kf", "kg"];
const CLIENTS = ["c1", "c2", "c3", "c4"];
const at = <A>(list: ReadonlyArray<A>, n: number): A => list[n % list.length]!;

const rowsIn = (s: Model): ReadonlyArray<Pending> => (s._tag === "waiting" ? s.rows : []);

/** A time near what the Model holds: the walk's clock, or one before, at or after a row's deadline. */
const timeFrom = (s: Model, clock: number, d: Draw): number => {
  const held = rowsIn(s);

  if (held.length === 0 || d.time % 4 === 0) {
    return clock;
  }

  const until = at(held, d.pick).until;
  return until + ((d.time % 3) - 1);
};

/** A knock from a client for a key; the key is a waiting one or a fresh one, and its fields are new. */
const knock = (s: Model, clock: number, d: Draw): Knock => {
  const held = rowsIn(s);
  const key = held.length > 0 && d.move % 2 === 0 ? at(held, d.pick).key : at(KEYS, d.other);
  return {
    type: "knock",
    key,
    label: `label ${d.word}`,
    location: `place ${d.word % 7}`,
    code: String(100000 + ((d.word * 7919 + d.pick) % 900000)),
    pass: d.pass ? `pass ${d.word}` : null,
    has: d.word % 3 === 0 ? [] : [`cap ${d.word % 5}`],
    as: d.agent ? "agent" : "window",
    client: at(CLIENTS, d.other + d.word),
    at: timeFrom(s, clock, d),
  };
};

/** The next Msg, from the folded Model: a leave names a real client or a stranger, an acceptance
 *  names a subset of the waiting keys and sometimes one that is not waiting. */
const choose = (s: Model, clock: number, d: Draw): Msg => {
  const held = rowsIn(s);
  const move = d.move % 10;

  if (move < 4) {
    return knock(s, clock, d);
  }

  if (move < 6) {
    const row = held.length > 0 ? at(held, d.pick) : undefined;
    const real = row !== undefined && d.other % 3 !== 0;
    return {
      type: "leave",
      key: row !== undefined && d.time % 5 !== 0 ? row.key : at(KEYS, d.other),
      client: real ? at(row.clients, d.other) : at(CLIENTS, d.other),
    };
  }

  if (move < 8) {
    return { type: "expire", at: timeFrom(s, clock, d) };
  }

  const keys = held.filter((_, n) => ((d.pick >> n) & 1) === 1).map((r) => r.key);
  return { type: "accepted", keys: d.other % 4 === 0 ? [...keys, at(KEYS, d.other)] : keys };
};

type Visit = { readonly before: Model; readonly msg: Msg; readonly after: Model };

/** Folds the draws through the real machine, each Msg picked from the Model reached so far. */
const walkFrom = (start: Model, draws: ReadonlyArray<Draw>, clock = 0): ReadonlyArray<Visit> => {
  let model = start;
  let now = clock;
  const visits: Array<Visit> = [];

  for (const draw of draws) {
    now += draw.time % 40;
    const msg = choose(model, now, draw);
    const [after, cmds] = applyCell(machine, model, msg);
    expect(cmds, "the waiting machine starts no Cmd").toEqual([]);
    visits.push({ before: model, msg, after });
    model = after;
  }

  return visits;
};

const start = (config: Config): Model => {
  const [model, cmds] = machine.init(null, config);
  expect(cmds, "init starts no Cmd").toEqual([]);
  expect(model).toEqual({ _tag: "empty", rows: [], ...config });
  return model;
};

const walk = (config: Config, draws: ReadonlyArray<Draw>) => walkFrom(start(config), draws);

/** What the moves sent, without the Model: replayed from any cut, it must give the same steps. */
const replay = (s: Model, msgs: ReadonlyArray<Msg>): ReadonlyArray<Model> => {
  const out: Array<Model> = [];
  let model = s;

  for (const msg of msgs) {
    model = applyCell(machine, model, msg)[0];
    out.push(model);
  }

  return out;
};

const live = (s: Model, time: number) => rowsIn(s).filter((r) => r.until > time);
const keyList = (list: ReadonlyArray<Pending>) => list.map((r) => r.key);
const strict = { onExcessProperty: "error" } as const;
// tea types a machine's schemas as `Schema.Schema`, which leaves their decoding services open; these
// two need none, so they are read as the codecs they are.
const MsgCodec = machine.msg as Schema.Codec<Msg, unknown>;
const ModelCodec = machine.model as Schema.Codec<Model, unknown>;
const props = { arbitrary: { seed: SEED, runs: 200, size: 60 } };

describe("the gateway's waiting machine, second check", () => {
  it.prop(
    "every reached Model is one row per key, a row per waiting client set, and its case follows its rows",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      for (const { msg, after } of walk(config, draws)) {
        const held = rowsIn(after);
        expect(after._tag === "empty", `case after ${msg.type}`).toBe(held.length === 0);
        expect(after.rows.length, `rows after ${msg.type}`).toBe(held.length);
        expect(new Set(keyList(held)).size, `one row per key after ${msg.type}`).toBe(held.length);
        expect(held.length).toBeLessThanOrEqual(config.most);
        expect({ most: after.most, ttl: after.ttl }, "settings never change").toEqual(config);

        for (const row of held) {
          expect(row.clients.length, `${row.key} keeps a client`).toBeGreaterThan(0);
          expect(new Set(row.clients).size, `${row.key} counts each client once`).toBe(row.clients.length);
        }

        expect(contracts(held[0] ?? ({} as Pending))).toHaveLength(5);
      }
    },
    props,
  );

  it.prop(
    "a knock first expires rows at or past their deadline; a repeat keeps its row whole and adds the " +
      "client once; a fresh key appends its row and the newest `most` rows stay",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      for (const { before, msg, after } of walk(config, draws)) {
        if (msg.type !== "knock") {
          continue;
        }

        const kept = live(before, msg.at);
        const old = kept.find((r) => r.key === msg.key);

        if (old !== undefined) {
          expect(keyList(rowsIn(after)), "a repeat knock moves no row").toEqual(keyList(kept));
          const clients = old.clients.includes(msg.client) ? old.clients : [...old.clients, msg.client];
          const others = kept.filter((r) => r !== old);
          expect(rowsIn(after).find((r) => r.key === msg.key)).toEqual({ ...old, clients });
          expect(rowsIn(after).filter((r) => r.key !== msg.key)).toEqual(others);
          continue;
        }

        const fresh: Pending = {
          key: msg.key,
          label: msg.label,
          location: msg.location,
          code: msg.code,
          until: msg.at + config.ttl,
          clients: [msg.client],
          pass: msg.pass,
          has: msg.has,
          as: msg.as,
        };
        const newest = [...kept, fresh].slice(Math.max(0, kept.length + 1 - config.most));
        expect(rowsIn(after), "a fresh knock waits last, and the oldest rows leave first").toEqual(newest);
      }
    },
    props,
  );

  it.prop(
    "expiry keeps exactly the rows whose deadline is after its time, in order",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      const expiries = walk(config, draws).flatMap((v) => (v.msg.type === "expire" ? [{ ...v, at: v.msg.at }] : []));

      for (const { before, at: time, after } of expiries) {
        expect(rowsIn(after)).toEqual(live(before, time));
      }
    },
    props,
  );

  it.prop(
    "a leave removes only its client from its row, and the row only with its last client",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      for (const { before, msg, after } of walk(config, draws)) {
        if (msg.type !== "leave") {
          continue;
        }

        const row = rowsIn(before).find((r) => r.key === msg.key);

        if (row === undefined || !row.clients.includes(msg.client)) {
          expect(after, "a leave by a stranger changes nothing").toEqual(before);
          continue;
        }

        const clients = row.clients.filter((c) => c !== msg.client);
        const expected = rowsIn(before).flatMap((r): ReadonlyArray<Pending> =>
          r !== row ? [r] : Arr.isReadonlyArrayNonEmpty(clients) ? [{ ...row, clients }] : [],
        );
        expect(rowsIn(after)).toEqual(expected);
      }
    },
    props,
  );

  it.prop(
    "an acceptance removes exactly its keys, keeps the rest in order, and a second one changes nothing",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      for (const { before, msg, after } of walk(config, draws)) {
        if (msg.type !== "accepted") {
          continue;
        }

        expect(rowsIn(after)).toEqual(rowsIn(before).filter((r) => !msg.keys.includes(r.key)));
        expect(applyCell(machine, after, msg)[0], "acceptance is idempotent").toEqual(after);
      }
    },
    props,
  );

  it.prop(
    "every reached Model saves and reloads to itself, the same bytes, the same reply rows and the same " + "future",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      const visits = walk(config, draws);
      const msgs = visits.map((v) => v.msg);

      visits.forEach(({ after }, n) => {
        const saved = Schema.encodeSync(Stored)(after);
        const bytes = JSON.stringify(saved);
        const reloaded = Schema.decodeUnknownSync(Stored, strict)(JSON.parse(bytes));
        expect(reloaded, "reload gives the Model back").toEqual(after);
        expect(JSON.stringify(Schema.encodeSync(Stored)(reloaded)), "and the same bytes").toBe(bytes);
        expect(rows(after), "reply rows are the saved rows").toEqual(saved.rows);
        expect(saved.most).toBe(config.most);
        expect(saved.ttl).toBe(config.ttl);

        rowsIn(after).forEach((row, i) => {
          const out = saved.rows[i]!;
          expect(out.tabs, "tabs count the clients").toBe(row.clients.length);
          expect(out.where, "the saved row keeps the legacy key").toBe(row.location);
          expect(out.until, "a deadline is never renewed by saving").toBe(row.until);
          expect(out.code).toBe(row.code);
        });

        const rest = msgs.slice(n + 1);
        expect(replay(reloaded, rest), "a reload cut changes no later step").toEqual(replay(after, rest));
      });
    },
    props,
  );

  it.prop(
    "a saved value reopens through `init` unchanged, so loading renews no deadline",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      const visits = walk(config, draws);
      const last = visits.at(-1)!.after;
      const reloaded = Schema.decodeUnknownSync(Stored)(JSON.parse(JSON.stringify(Schema.encodeSync(Stored)(last))));
      const [opened, cmds] = machine.init(reloaded, config);
      expect(cmds).toEqual([]);
      expect(opened).toEqual(last);
    },
    props,
  );

  it.prop(
    "every Msg the walk sends and every Model it reaches decodes strictly through the machine's schemas",
    { walk: Walk },
    ({ walk: { config, draws } }) => {
      for (const { msg, after } of walk(config, draws)) {
        expect(Schema.decodeUnknownSync(MsgCodec, strict)(msg)).toEqual(msg);
        expect(Schema.decodeUnknownSync(ModelCodec, strict)(after)).toEqual(after);
        const saved = Schema.encodeSync(Stored)(after);
        expect(Schema.decodeUnknownSync(Schema.toEncoded(Stored), strict)(saved)).toEqual(saved);
      }
    },
    props,
  );

  it.prop(
    "the schemas refuse a Msg or a saved row with a field of the wrong kind",
    { walk: Walk, field: Schema.Literals(["key", "code", "until", "clients", "as", "has", "pass", "tabs"]) },
    ({ walk: { config, draws }, field }) => {
      const visits = walk(config, draws);
      const knocks = visits.map((v) => v.msg).filter((m): m is Knock => m.type === "knock");

      // The knock's own name for each saved field: it has `at` for a deadline and one `client`.
      const inKnock = { until: "at", tabs: "label", clients: "client" } as Record<string, string>;
      const wrong = { until: "soon", tabs: 1.5, clients: [] } as Record<string, unknown>;

      for (const m of knocks) {
        const bad = { ...m, [inKnock[field] ?? field]: field === "until" ? "soon" : 42 };
        expect(() => Schema.decodeUnknownSync(MsgCodec)(bad), `a knock with a bad ${field}`).toThrow();
      }

      for (const { after } of visits) {
        for (const row of Schema.encodeSync(Stored)(after).rows) {
          const bad = { ...row, [field]: field in wrong ? wrong[field] : 42 };
          const value = { rows: [bad], most: config.most, ttl: config.ttl };
          expect(() => Schema.decodeUnknownSync(Stored)(value), `a saved row with a bad ${field}`).toThrow();
        }
      }
    },
    props,
  );

  it.prop(
    "init takes only a positive whole cap and a numeric ttl",
    {
      // Caps near the edge of 1 come up often; any number, NaN and the infinities included, comes too.
      most: Schema.Union([Schema.Int.check(Schema.isBetween({ minimum: -2, maximum: 3 })), Schema.Number]),
      ttl: Schema.Union([Schema.Number, Schema.String]),
    },
    ({ most, ttl }) => {
      const good = Number.isSafeInteger(most) && most >= 1 && typeof ttl === "number";
      const opened = Result.try(() => machine.init(null, { most, ttl } as Config)[0]);
      expect(Result.getOrElse(opened, () => "refused")).toEqual(
        good ? { _tag: "empty", rows: [], most, ttl } : "refused",
      );
    },
    props,
  );
});
