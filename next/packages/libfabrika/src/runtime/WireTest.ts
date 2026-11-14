// Ticket 888, Amendment A-Wire, next/. The fixture `Wire`: programs whose Msgs hold values with no
// JSON form of their own (a bigint, bytes, a Date, a non-finite number), and one whose two sides
// are equal. Each program's `update` hands every Msg it is given to a recorder, so a law reads what
// `update` received. Read through its module, as `Wire.Sent` and `Wire.make()`.
import { Machine } from "@demlik/tea/effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Schema from "effect/Schema";
import { Input, Program } from "./Program.ts";

const One = Schema.Union([
  Schema.Struct({ k: Schema.Literal("a"), at: Schema.Date }),
  Schema.Struct({ k: Schema.Literal("b"), n: Schema.BigInt }),
]);

/** Every Msg of the fixture. `timer` is internal: no port names it. */
export const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("big"), n: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal("bytes"), body: Schema.Uint8Array }),
  Schema.Struct({ type: Schema.Literal("date"), at: Schema.Date }),
  Schema.Struct({ type: Schema.Literal("number"), x: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("mixed"),
    n: Schema.optionalKey(Schema.BigInt),
    at: Schema.optional(Schema.Date),
    body: Schema.NullOr(Schema.Uint8Array),
    xs: Schema.Array(Schema.Number),
    one: One,
  }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int }),
]);
export type Msg = typeof Msg.Type;

/** The read port's input: a union whose members each hold a value JSON has no form for. */
export const Query = One;
export type Query = typeof Query.Type;

/** A Msg whose Type and Encoded sides are equal: what every shipped write port has today. */
export const PlainMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), s: Schema.String, n: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("pick"),
    side: Schema.Literals(["left", "right"]),
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("list"), xs: Schema.Array(Schema.Union([Schema.String, Schema.Int])) }),
]);
export type PlainMsg = typeof PlainMsg.Type;

const jsonTrip = (value: unknown): unknown =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(JSON.stringify(value));

/** The letter for `x`: its JSON codec's Encoded side, after one trip through JSON text. */
export const letter = (x: Msg): unknown => jsonTrip(Schema.encodeUnknownSync(Schema.toCodecJson(Msg))(x));

/** A read port's `query` for `q`, the same way. */
export const asked = (q: Query): unknown => jsonTrip(Schema.encodeUnknownSync(Schema.toCodecJson(Query))(q));

/** A Plain Msg as main stores it today: the raw Msg's Encoded side, after one trip through JSON text. */
export const old = (x: PlainMsg): unknown => jsonTrip(Schema.encodeUnknownSync(PlainMsg)(x));

/** The program over `Msg`, with a fresh recorder. Its model is a count of the Msgs `update` took. */
export const make = () => {
  const taken: Array<Msg> = [];
  const take = (count: number, m: Msg): [number, []] => {
    taken.push(m);
    return [count + 1, []];
  };
  const machine = Machine.make({
    model: Schema.Int,
    msg: Msg,
    cmds: [],
    init: (loaded) => [loaded ?? 0, []],
    update: { big: take, bytes: take, date: take, number: take, mixed: take, timer: take },
  });
  const program = Program.make({
    name: "pack/wire",
    machine,
    state: { v: 1, upgrades: [] },
    view: (count) => count,
    refuse: () => null,
    inputs: {
      big: "A bigint",
      bytes: "Bytes",
      date: "A date",
      number: "A number",
      mixed: "All of them, optional and nested",
      find: Input.cases.read.make({ schema: Query, description: "Find one", answer: () => null }),
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return { program, taken };
};

/** The program over `PlainMsg`, with a fresh recorder. */
export const plain = () => {
  const taken: Array<PlainMsg> = [];
  const take = (count: number, m: PlainMsg): [number, []] => {
    taken.push(m);
    return [count + 1, []];
  };
  const machine = Machine.make({
    model: Schema.Int,
    msg: PlainMsg,
    cmds: [],
    init: (loaded) => [loaded ?? 0, []],
    update: { text: take, pick: take, list: take },
  });
  const program = Program.make({
    name: "pack/plain",
    machine,
    state: { v: 1, upgrades: [] },
    view: (count) => count,
    refuse: () => null,
    inputs: { text: "Text and a count", pick: "A side", list: "A list" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return { program, taken };
};

// The amendment's edges, each in its member, and the mixed member at both ends of its optional fields.
const first: Msg = { type: "big", n: 2n ** 64n };

const edges: ReadonlyArray<Msg> = [
  first,
  { type: "big", n: -1n },
  { type: "bytes", body: new Uint8Array(0) },
  { type: "bytes", body: new Uint8Array([0, 255]) },
  { type: "date", at: new Date(0) },
  { type: "number", x: Number.NaN },
  { type: "number", x: Infinity },
  { type: "number", x: -Infinity },
  { type: "number", x: -0 },
  { type: "mixed", body: null, xs: [], one: { k: "b", n: -1n } },
  {
    type: "mixed",
    n: 2n ** 64n,
    at: new Date(0),
    body: new Uint8Array([0, 255]),
    xs: [Number.NaN, Infinity, -Infinity, -0],
    one: { k: "a", at: new Date(0) },
  },
];

const Edge = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: edges.length - 1 }));

/** One drawn Msg a port names and one edge; a run checks both. */
export const Sent = Arbitrary.all({
  drawn: Arbitrary.schema(Msg).pipe(Arbitrary.filter((m) => m.type !== "timer")),
  edge: Arbitrary.schema(Edge).pipe(Arbitrary.map((i) => edges[i] ?? first)),
});

/** A drawn input for the read port. */
export const Asked = Arbitrary.schema(Query);

/** A drawn Msg whose two sides are equal. */
export const Plain = Arbitrary.schema(PlainMsg);
