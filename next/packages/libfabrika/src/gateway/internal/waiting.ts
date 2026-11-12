import { Machine } from "@demlik/tea/effect";
import { Array as Arr, Schema, SchemaTransformation } from "effect";

const Config = Schema.Struct({
  most: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  ttl: Schema.Number,
});

const Pending = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  location: Schema.String,
  code: Schema.String,
  until: Schema.Number,
  clients: Schema.NonEmptyArray(Schema.String),
  pass: Schema.NullOr(Schema.String),
  has: Schema.Array(Schema.String),
  as: Schema.Literals(["window", "agent"]),
});
type Pending = typeof Pending.Type;

const Model = Schema.TaggedUnion({
  // An empty tuple type crashes TypeScript 7.0.2's API in lint:promise-types; an array of never
  // holds no row just the same.
  empty: { rows: Schema.Array(Schema.Never), ...Config.fields },
  waiting: { rows: Schema.NonEmptyArray(Pending), ...Config.fields },
});
type Model = typeof Model.Type;

// The state follows from the rows: `empty` holds none, `waiting` at least one.
const settle = (c: typeof Config.Type, pending: ReadonlyArray<Pending>): Model =>
  Arr.isReadonlyArrayNonEmpty(pending)
    ? Model.cases.waiting.make({ rows: pending, most: c.most, ttl: c.ttl })
    : Model.cases.empty.make({ rows: [], most: c.most, ttl: c.ttl });

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("knock"),
    key: Pending.fields.key,
    label: Pending.fields.label,
    location: Pending.fields.location,
    code: Pending.fields.code,
    pass: Pending.fields.pass,
    has: Pending.fields.has,
    as: Pending.fields.as,
    client: Schema.String,
    at: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("leave"), key: Schema.String, client: Schema.String }),
  Schema.Struct({ type: Schema.Literal("expire"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("accepted"), keys: Schema.Array(Schema.String) }),
]);

/** The saved row: the legacy `where` key, and `tabs` derived from its clients. @internal */
export const Row = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  where: Schema.String,
  code: Schema.String,
  until: Schema.Number,
  tabs: Schema.Int,
  clients: Schema.NonEmptyArray(Schema.String),
  pass: Schema.NullOr(Schema.String),
  has: Schema.Array(Schema.String),
  as: Schema.Literals(["window", "agent"]),
});
type Row = typeof Row.Type;

const Saved = Schema.Struct({ rows: Schema.Array(Row), ...Config.fields });

const toPending = (r: Row): Pending => ({
  key: r.key,
  label: r.label,
  location: r.where,
  code: r.code,
  until: r.until,
  clients: r.clients,
  pass: r.pass,
  has: r.has,
  as: r.as,
});

const toRow = (p: Pending): Row => ({
  key: p.key,
  label: p.label,
  where: p.location,
  code: p.code,
  until: p.until,
  tabs: p.clients.length,
  clients: p.clients,
  pass: p.pass,
  has: p.has,
  as: p.as,
});

/** The saved value under `gateway_state`'s `waiting` key, read into the Model. @internal */
export const Stored = Saved.pipe(
  Schema.decodeTo(
    Model,
    SchemaTransformation.transform<typeof Model.Encoded, typeof Saved.Type>({
      decode: (saved) => settle(saved, saved.rows.map(toPending)),
      encode: (s) => {
        const pending: ReadonlyArray<Pending> = s.rows;
        return { rows: pending.map(toRow), most: s.most, ttl: s.ttl };
      },
    }),
  ),
);

/** The saved value's rows, as watch replies show them. @internal */
export const rows = (s: Model): ReadonlyArray<Row> => Schema.encodeSync(Stored)(s).rows;

const expire = (s: Model, at: number): Model => {
  if (s._tag === "empty") {
    return s;
  }

  const kept = s.rows.filter((r) => r.until > at);
  return settle(s, kept);
};

/** @internal */
export const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  types: { ctx: {} as typeof Config.Type },
  init: (loaded, ctx) => {
    const config = Schema.decodeUnknownSync(Config)(ctx);
    return [loaded ?? Model.cases.empty.make({ rows: [], ...config }), []];
  },
  update: {
    expire: (s, m) => [expire(s, m.at), []],
    knock: (s, m) => {
      const live = expire(s, m.at);
      const old = live._tag === "empty" ? undefined : live.rows.find((r) => r.key === m.key);

      if (live._tag === "waiting" && old !== undefined) {
        const known = old.clients.includes(m.client);
        const clients: Pending["clients"] = known ? old.clients : [...old.clients, m.client];
        const kept = live.rows.map((r) => (r === old ? { ...old, clients } : r));
        return [settle(live, kept), []];
      }

      const row: Pending = {
        key: m.key,
        label: m.label,
        location: m.location,
        code: m.code,
        until: m.at + live.ttl,
        clients: [m.client],
        pass: m.pass,
        has: m.has,
        as: m.as,
      };
      const kept: ReadonlyArray<Pending> = live.rows;
      return [settle(live, [...kept, row].slice(-live.most)), []];
    },
    leave: (s, m) => {
      if (s._tag === "empty") {
        return [s, []];
      }

      const row = s.rows.find((r) => r.key === m.key && r.clients.includes(m.client));

      if (row === undefined) {
        return [s, []];
      }

      const clients = row.clients.filter((c) => c !== m.client);
      const kept = Arr.isReadonlyArrayNonEmpty(clients)
        ? s.rows.map((r) => (r === row ? { ...row, clients } : r))
        : s.rows.filter((r) => r !== row);
      return [settle(s, kept), []];
    },
    accepted: (s, m) => {
      if (s._tag === "empty") {
        return [s, []];
      }

      const kept = s.rows.filter((r) => !m.keys.includes(r.key));
      return [settle(s, kept), []];
    },
  },
});
