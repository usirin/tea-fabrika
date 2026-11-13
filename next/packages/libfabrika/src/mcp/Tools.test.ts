// P25 slice 1, next/: the real program declarations decide which tools exist.
import { Machine } from "@demlik/tea/effect";
import { expect, it } from "@effect/vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { nodeExecution } from "../runtime/Execution.ts";
import { Input, Program } from "../runtime/Program.ts";
import * as Programs from "../runtime/Program.ts";
import * as Wire from "../runtime/WireTest.ts";
import * as Tools from "./Tools.ts";

const options = (runs: number) => ({ arbitrary: { seed: 119120, runs, size: 4096 } });
const text = Schema.String.check(Schema.isMaxLength(80));
const closed = { onExcessProperty: "error" } as const;

const inputSchema = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(Schema.Struct({ value: schema }), closed);
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
};

const Port = Schema.Struct({
  read: Schema.Boolean,
  hidden: Schema.Boolean,
  shape: Schema.Literals(["text", "union", "shared"]),
  description: text,
});
type Port = typeof Port.Type;
const Declarations = Arbitrary.array(Arbitrary.array(Arbitrary.schema(Port), { maxLength: 16 }), { maxLength: 4 });

const fields = (shape: Port["shape"]): Readonly<Record<string, Schema.Top & Schema.Codec<unknown, unknown>>> => {
  const shared = Schema.Struct({ label: text, count: Schema.Int });
  return shape === "text"
    ? { name: Schema.String, note: Schema.optionalKey(Schema.String) }
    : shape === "union"
      ? { value: Schema.Union([Schema.String, Schema.Struct({ n: Schema.Int })]) }
      : { first: shared, second: shared };
};

const declaration = (name: string, ports: ReadonlyArray<Port>, keys?: ReadonlyArray<string>) => {
  let write = 0;
  const entries = ports.map((p, i) => {
    const key = keys?.[i] ?? (p.read ? `r${i}` : `w${write++}`);
    const schema = p.read && p.shape === "text" ? Schema.Null : Schema.Struct(fields(p.shape));
    const input = p.read
      ? Input.cases.read.make({ schema, description: p.description, answer: () => null })
      : p.hidden
        ? { description: p.description, personOnly: true as const }
        : p.description;
    return { key, schema, input, port: p };
  });
  const writes = entries.filter((e) => !e.port.read);
  // An internal message must never appear in a tool's value schema.
  const msg = Schema.Union([
    ...writes.map((e) => Schema.Struct({ type: Schema.Literal(e.key), ...fields(e.port.shape) })),
    Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int }),
  ]);
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: Object.fromEntries([...writes.map((e) => [e.key, (m: null) => [m, []]]), ["timer", (m: null) => [m, []]]]),
  });
  const program = Program.make({
    name,
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs: Object.fromEntries(entries.map((e) => [e.key, e.input])),
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return { program, entries };
};

const valueFor = (shape: Port["shape"], s: string, n: number) =>
  shape === "text"
    ? { name: s, note: s }
    : shape === "union"
      ? { value: { n } }
      : { first: { label: s, count: n }, second: { label: s, count: n } };

const richDeclaration = (fallback: string, reverse: boolean) => {
  const bounds = { low: Schema.Int, high: Schema.Int };
  const ordered = Schema.makeFilter(
    (value: { readonly low: number; readonly high: number }) => value.low <= value.high,
  );
  const left = { side: Schema.Literal("left"), n: Schema.Int };
  const right = { side: Schema.Literal("right"), text: Schema.String };
  const defaulted = { note: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(fallback))) };
  const alternatives = [
    Schema.Struct({ type: Schema.Literal("choose"), ...left }),
    Schema.Struct({ type: Schema.Literal("choose"), ...right }),
  ];
  const shared = Schema.Struct({ label: Schema.String }).annotate({ identifier: "ToolShared" });
  const sharedPair = Schema.Struct({ first: shared, second: shared });
  const msg = Schema.Union([
    Schema.Struct({ type: Schema.Literal("bounds"), ...bounds }).check(ordered),
    ...(reverse ? alternatives.toReversed() : alternatives),
    Schema.Struct({ type: Schema.Literal("defaulted"), ...defaulted }),
  ]).check(Schema.makeFilter((value) => value.type !== "choose" || value.side !== "left" || value.n >= 0));
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: { bounds: (m) => [m, []], choose: (m) => [m, []], defaulted: (m) => [m, []] },
  });
  const program = Program.make({
    name: "pack/rich",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs: {
      bounds: "Ordered bounds",
      choose: "Either alternative",
      defaulted: "Decode JSON",
      read: Input.cases.read.make({ schema: Schema.Struct(defaulted), description: "Read JSON", answer: () => null }),
      shared: Input.cases.read.make({ schema: sharedPair, description: "Shared parts", answer: () => null }),
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return {
    program,
    schemas: {
      bounds: Schema.Struct(bounds).check(ordered),
      choose: Schema.Union(
        reverse ? [Schema.Struct(right), Schema.Struct(left)] : [Schema.Struct(left), Schema.Struct(right)],
      ).check(Schema.makeFilter((value) => value.side !== "left" || value.n >= 0)),
      defaulted: Schema.Struct(defaulted),
      read: Schema.Struct(defaulted),
      shared: sharedPair,
    },
  };
};

const schemaForms = [
  "suspended message",
  "suspended member",
  "suspended alternatives",
  "multiple tags",
  "encoded keys",
] as const;

type SchemaForm = (typeof schemaForms)[number];

const schemaDeclaration = (form: SchemaForm, reverse: boolean, encodedKey: string) => {
  const left = Schema.Struct({ side: Schema.Literal("left"), n: Schema.Int });
  const right = Schema.Struct({ side: Schema.Literal("right"), text: Schema.String });
  const leftMessage = Schema.Struct({ type: Schema.Literal("choose"), ...left.fields });
  const rightMessage = Schema.Struct({ type: Schema.Literal("choose"), ...right.fields });
  const timer = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int });
  const alternatives = Schema.Union(reverse ? [rightMessage, leftMessage] : [leftMessage, rightMessage]);
  const plain = Schema.Union([alternatives, timer]);
  const encodedLeft = left.pipe(Schema.encodeKeys({ n: encodedKey }));
  const encodedRight = right.pipe(Schema.encodeKeys({ text: encodedKey }));
  const msg =
    form === "suspended message"
      ? Schema.suspend(() => plain)
      : form === "suspended member"
        ? Schema.Union(
            reverse
              ? [rightMessage, Schema.suspend(() => leftMessage), timer]
              : [Schema.suspend(() => leftMessage), rightMessage, timer],
          )
        : form === "suspended alternatives"
          ? Schema.Union([Schema.suspend(() => alternatives), timer])
          : form === "multiple tags"
            ? Schema.Union([
                Schema.Struct({ type: Schema.Literals(["choose", "other"]), ...left.fields }),
                rightMessage,
                timer,
              ])
            : Schema.Union([
                leftMessage.pipe(Schema.encodeKeys({ n: encodedKey })),
                rightMessage.pipe(Schema.encodeKeys({ text: encodedKey })),
                timer,
              ]);
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: { choose: (m) => [m, []], other: (m) => [m, []], timer: (m) => [m, []] },
  });
  const choose =
    form === "encoded keys"
      ? Schema.Union([encodedLeft, encodedRight])
      : Schema.Union(reverse && form !== "multiple tags" ? [right, left] : [left, right]);
  const inputs = form === "multiple tags" ? { choose: "Choose", other: "Other" } : { choose: "Choose" };
  const program = Program.make({
    name: "pack/forms",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs,
    outputs: {},
    writes: {},
    wake: () => null,
  });
  const schemas: Readonly<Record<string, Schema.Codec<object, unknown>>> =
    form === "multiple tags" ? { choose, other: left } : { choose };
  return { program, schemas };
};

it.prop(
  "T1: ps first, then visible ports in program and declaration order, with their own schemas and read hints",
  { declarations: Declarations },
  ({ declarations }) => {
    const declared = declarations.map((ports, i) => declaration(`pack/p${i}`, ports));
    const result = Tools.list(declared.map((p) => p.program));
    expect(Result.isSuccess(result)).toBe(true);

    if (Result.isFailure(result)) {
      return;
    }

    const expected = declared.flatMap(({ entries }, i) =>
      entries
        .filter((e) => e.port.read || !e.port.hidden)
        .map((e) => ({ ...e, program: declared[i]!.program, name: `p${i}_${e.key}` })),
    );
    expect(result.success.map((t) => t.name)).toEqual(["ps", ...expected.map((e) => e.name)]);
    expect(result.success[0]?.annotations?.readOnlyHint).toBe(true);
    expect(result.success[0]?.inputSchema).toEqual({ type: "object", additionalProperties: false });

    for (const [i, entry] of expected.entries()) {
      const tool = result.success[i + 1]!;
      expect(tool.description).toBe(entry.port.description);
      expect(tool.inputSchema).toEqual(inputSchema(entry.schema));
      expect(tool.annotations?.readOnlyHint === true).toBe(entry.port.read);
      const port = Programs.port(entry.program, entry.key);
      expect(Option.isSome(port)).toBe(true);
    }
  },
  options(300),
);

it.prop(
  "T2: any name and JSON return a Call; hidden and unknown tools refuse, invalid values refuse, good values keep the port type",
  {
    ports: Arbitrary.array(Arbitrary.schema(Port), { maxLength: 16 }),
    input: Schema.Json,
    name: Schema.String,
    text,
    n: Schema.Int,
  },
  ({ ports, input, name, text: s, n }) => {
    const { program, entries } = declaration("pack/sample", ports);
    const listed = Tools.list([program]);
    expect(Result.isSuccess(listed)).toBe(true);
    expect(Schema.is(Tools.Call)(Tools.read([program], name, input))).toBe(true);
    expect(Tools.read([program], `missing/${name}`, input)).toEqual({ _tag: "refused", reason: "unknown_tool" });
    expect(Tools.read([program], "ps", {})).toEqual({ _tag: "ps" });

    for (const { key, schema, port } of entries) {
      const tool = `sample_${key}`;
      const call = Tools.read([program], tool, input);

      if (!port.read && port.hidden) {
        expect(call).toEqual({ _tag: "refused", reason: "unknown_tool" });
        expect(Tools.read([program], tool, { value: valueFor(port.shape, s, n) })).toEqual({
          _tag: "refused",
          reason: "unknown_tool",
        });
        continue;
      }

      const decoded = Schema.decodeUnknownResult(Schema.toCodecJson(Schema.Struct({ value: schema })), closed)(input);
      expect(call).toEqual(
        Result.isFailure(decoded)
          ? { _tag: "refused", reason: "bad_input" }
          : port.read
            ? { _tag: "query", program: program.name, name: key, query: decoded.success.value }
            : { _tag: "write", program: program.name, m: { ...decoded.success.value, type: key } },
      );
      const invalid = port.read && port.shape === "text" ? false : null;
      expect(Tools.read([program], tool, { value: invalid })).toEqual({ _tag: "refused", reason: "bad_input" });
      const value = port.read && port.shape === "text" ? null : valueFor(port.shape, s, n);
      expect(Tools.read([program], tool, { value })).toEqual(
        port.read
          ? { _tag: "query", program: program.name, name: key, query: value }
          : { _tag: "write", program: program.name, m: { ...value, type: key } },
      );
      const alternate =
        port.shape === "text" ? (port.read ? null : { name: s }) : port.shape === "union" ? { value: s } : value;
      expect(Tools.read([program], tool, { value: alternate })).toEqual(
        port.read
          ? { _tag: "query", program: program.name, name: key, query: alternate }
          : { _tag: "write", program: program.name, m: { ...alternate, type: key } },
      );
      expect(Tools.read([program], tool, { value, unexpected: input })).toEqual({
        _tag: "refused",
        reason: "bad_input",
      });

      if (!(port.read && port.shape === "text")) {
        expect(Tools.read([program], tool, { value: { ...valueFor(port.shape, s, n), unexpected: input } })).toEqual({
          _tag: "refused",
          reason: "bad_input",
        });
      }
    }
  },
  options(300),
);

it.prop(
  "T2: ps accepts an empty object and refuses every other JSON argument",
  { input: Schema.Json },
  ({ input }) => {
    const emptyObject = Schema.Record(Schema.String, Schema.Json).check(Schema.isMaxProperties(0));
    expect(Tools.read([], "ps", {})).toEqual({ _tag: "ps" });
    expect(Tools.read([], "ps", input)).toEqual(
      Schema.is(emptyObject)(input) ? { _tag: "ps" } : { _tag: "refused", reason: "bad_input" },
    );

    for (const args of [null, [input], { unexpected: input }]) {
      expect(Tools.read([], "ps", args)).toEqual({ _tag: "refused", reason: "bad_input" });
    }
  },
  options(300),
);

// vector: review 1's plain structs must still match Effect's own closed schema.
it("vector: T1 plain text, union and shared schemas", () => {
  for (const shape of ["text", "union", "shared"] as const) {
    const { program, entries } = declaration("pack/plain", [{ read: false, hidden: false, shape, description: shape }]);
    const result = Tools.list([program]);
    expect(Result.isSuccess(result)).toBe(true);

    if (Result.isSuccess(result)) {
      expect(result.success[1]?.inputSchema).toEqual(inputSchema(entries[0]!.schema));
    }
  }
});

const Field = Schema.Literals([
  "text",
  "int",
  "optionalKey",
  "optionalNull",
  "default",
  "fromString",
  "array",
  "union",
  "shared",
  "recursive",
]);

const Wrap = Schema.Literals(["plain", "suspend", "encodeKeys", "suspend_encodeKeys", "filter"]);
const Key = Schema.Literals(["a", "b", "c", "d"]);

const Member = Schema.Struct({
  tags: Schema.NonEmptyArray(Key).check(Schema.isMaxLength(2)),
  fields: Schema.Array(Field).check(Schema.isMaxLength(4)),
  wrap: Wrap,
});

const OutsideForm = Schema.Literals([
  "tag_renamed",
  "tag_renamed_beside_plain",
  "not_an_object",
  "min_properties",
  "index_signature",
]);

const Supported = Schema.Struct({
  members: Schema.NonEmptyArray(Member).check(Schema.isMaxLength(6)),
  personOnly: Schema.Array(Key).check(Schema.isMaxLength(4)),
  nest: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(6)),
  whole: Schema.Literals(["plain", "suspend", "filter"]),
});

const Declaration = Schema.Struct({ ...Supported.fields, outside: Schema.optionalKey(OutsideForm) });
type Declaration = typeof Declaration.Type;
type Message = { readonly type: string; readonly [key: string]: unknown };
type Tree = { readonly label: string; readonly children: ReadonlyArray<Tree> };

const fieldSchema = (field: typeof Field.Type, name: string) => {
  const shared = Schema.Struct({ label: Schema.String }).annotate({ identifier: `${name}_shared` });
  const tree: Schema.Codec<Tree> = Schema.suspend(() =>
    Schema.Struct({
      label: Schema.String,
      children: Schema.Array(tree).check(Schema.isMaxLength(2)),
    }),
  ).annotate({ identifier: `${name}_tree` });

  switch (field) {
    case "text":
      return Schema.String;
    case "int":
      return Schema.Int;
    case "optionalKey":
      return Schema.optionalKey(Schema.String);
    case "optionalNull":
      return Schema.optional(Schema.NullOr(Schema.String));
    case "default":
      return Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("default")));
    case "fromString":
      return Schema.FiniteFromString;
    case "array":
      return Schema.Array(Schema.String).check(Schema.isMaxLength(3));
    case "union":
      return Schema.Union([Schema.String, Schema.Int]);
    case "shared":
      return Schema.Struct({ left: shared, right: shared });
    case "recursive":
      return tree;
  }
};

// A-Wire's odd member: one more port, `odd`, whose single field has no JSON form.
const OddField = Schema.Literals(["map", "set", "declared"]);
const Odd = Schema.Struct({ field: OddField, personOnly: Schema.Boolean });

const oddSchema = (field: typeof OddField.Type) =>
  field === "map"
    ? Schema.instanceOf(Map)
    : field === "set"
      ? Schema.instanceOf(Set)
      : Schema.declare((u): u is () => unknown => Predicate.isFunction(u), { expected: "a function" });

const makeForm = (form: Declaration & { readonly odd?: typeof Odd.Type }) => {
  const members = form.members.map((member, i) => {
    const fields = Object.fromEntries(
      member.fields.map((field, n) => {
        const name = `f${i}_${n}`;
        return [name, fieldSchema(field, name)];
      }),
    );
    const plain = Schema.Struct({ type: Schema.Literals(member.tags), ...fields });
    const first = Object.keys(fields)[0];
    const encoded = first === undefined ? plain : plain.pipe(Schema.encodeKeys({ [first]: `wire_${first}` }));
    const schema =
      member.wrap === "suspend"
        ? Schema.suspend(() => plain)
        : member.wrap === "encodeKeys"
          ? encoded
          : member.wrap === "suspend_encodeKeys"
            ? Schema.suspend(() => encoded)
            : member.wrap === "filter"
              ? plain.check(Schema.makeFilter((value) => !Object.values<unknown>(value).some((v) => v === "blocked")))
              : plain;
    return { tags: member.tags, fields: Object.keys(fields), schema };
  });
  let parts: Array<Schema.Codec<unknown, unknown>> = members.map((member) => member.schema);
  const outside = form.outside;

  if (outside === "tag_renamed" || outside === "tag_renamed_beside_plain") {
    const renamed = Schema.Struct({ type: Schema.Literal("a"), renamed: Schema.String }).pipe(
      Schema.encodeKeys({ type: "kind" }),
    );
    parts = outside === "tag_renamed" ? [renamed] : [...parts, renamed];
  } else if (outside === "not_an_object") {
    parts.push(Schema.String);
  } else if (outside === "min_properties") {
    parts.push(
      Schema.Struct({ type: Schema.Literal("a"), limited: Schema.optionalKey(Schema.String) }).check(
        Schema.isMinProperties(2),
      ),
    );
  } else if (outside === "index_signature") {
    parts.push(
      Schema.StructWithRest(Schema.Struct({ type: Schema.Literal("a") }), [Schema.Record(Schema.String, Schema.Json)]),
    );
  }

  if (form.odd !== undefined) {
    parts.push(Schema.Struct({ type: Schema.Literal("odd"), held: oddSchema(form.odd.field) }));
  }

  parts.push(Schema.Struct({ type: Schema.Literal("timer"), internal_timer: Schema.Int }));

  for (const nested of form.nest) {
    if (nested && parts.length > 1) {
      parts = [Schema.Union(parts.slice(0, 2)), ...parts.slice(2)];
    }
  }

  const plain = Schema.Union(parts);
  const schema =
    form.whole === "suspend"
      ? Schema.suspend(() => plain)
      : form.whole === "filter"
        ? plain.check(
            Schema.makeFilter((m) => !Predicate.isObject(m) || !Object.values(m).some((v) => v === "blocked_whole")),
          )
        : plain;
  // The negative forms deliberately contain wire values outside tea's Msg type.
  const msg = schema as Schema.Codec<Message, unknown>;
  const hidden: ReadonlyArray<string> = [...form.personOnly, ...(form.odd?.personOnly === true ? ["odd"] : [])];
  const keys = [
    ...new Set([...form.members.flatMap((m) => m.tags), ...(outside === undefined ? [] : ["a"])]),
    ...(form.odd === undefined ? [] : ["odd"]),
  ];
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: Object.fromEntries([...keys, "timer"].map((key) => [key, (m: null) => [m, []]])),
  });
  const program = Program.make({
    name: "pack/drawn",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs: Object.fromEntries(
      keys.map((key) => [key, hidden.includes(key) ? { description: key, personOnly: true as const } : key]),
    ),
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return {
    program,
    msg,
    members,
    keys,
    visible: keys.filter((key) => !hidden.includes(key)),
    exact: form.whole !== "filter" && form.members.every((m) => m.wrap !== "filter"),
  };
};

type Form = ReturnType<typeof makeForm>;

const jsonTrip = (value: unknown): unknown =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(JSON.stringify(value));

const withoutType = (value: unknown) => {
  expect(Predicate.isObject(value)).toBe(true);

  if (!Predicate.isObject(value)) {
    throw new Error("The Msg must encode as an object");
  }

  const { type: _, ...fields } = value;
  return fields;
};

const encoded = (form: Form, msg: Message) => jsonTrip(Schema.encodeUnknownSync(form.msg)(msg));

const expectedMessage = (form: Form, wire: unknown) =>
  Schema.decodeUnknownResult(Schema.toCodecJson(form.msg), closed)(wire);

const visibleForm = Arbitrary.schema(Supported).pipe(
  Arbitrary.filter((description) => makeForm(description).visible.length > 0),
);

const sent = (description: typeof Supported.Type) => {
  const form = makeForm(description);
  return Arbitrary.schema(form.msg).pipe(
    Arbitrary.filter((msg) => form.visible.includes(msg.type)),
    Arbitrary.map((msg) => ({ description, msg, value: withoutType(encoded(form, msg)) })),
  );
};

const Forms = {
  Declaration: Arbitrary.schema(Declaration),
  // A supported declaration and the odd port to add to it, with a name no tool has.
  Odd: Arbitrary.all({
    description: Arbitrary.schema(Supported),
    odd: Arbitrary.schema(Odd),
    stranger: Arbitrary.schema(Schema.String),
  }),
  Sent: visibleForm.pipe(Arbitrary.flatMap(sent)),
  Outside: visibleForm.pipe(
    Arbitrary.flatMap((description) =>
      sent(description).pipe(
        Arbitrary.flatMap((sample) => {
          const form = makeForm(description);
          const other =
            form.visible.length === 1
              ? Arbitrary.Constant(sample)
              : sent(description).pipe(Arbitrary.filter((next) => next.msg.type !== sample.msg.type));
          return Arbitrary.all({
            other,
            json: Arbitrary.schema(Schema.Json),
            mode: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))),
          }).pipe(
            Arbitrary.map(({ other, json, mode }) => {
              const key = sample.msg.type;
              const { [Object.keys(sample.value)[0] ?? "absent"]: _, ...dropped } = sample.value;
              const values: ReadonlyArray<unknown> = [
                json,
                dropped,
                { ...sample.value, type: key },
                { ...sample.value, unexpected: json },
                other.value,
                sample.value,
              ];
              return { description, key, value: values[mode] };
            }),
          );
        }),
      ),
    ),
  ),
};

const validator = (schema: (typeof Tools.Tool.Type)["inputSchema"]) =>
  new Ajv2020({ strict: false, validateFormats: false }).compile(
    Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(schema),
  );

const toolFor = (form: Form, key: string) => {
  const result = Tools.list([form.program]);
  expect(Result.isSuccess(result)).toBe(true);

  if (Result.isFailure(result)) {
    throw new Error(`Listing failed: ${result.failure.reason}`);
  }

  const tool = result.success.find((tool) => tool.name === `drawn_${key}`);
  expect(tool).toBeDefined();
  return tool!;
};

it.prop(
  "P1: listing is total, supported forms list and outside forms fail by name",
  { description: Forms.Declaration },
  ({ description }) => {
    expect.hasAssertions();
    const form = makeForm(description);
    const result = Tools.list([form.program]);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(Tools.ToolsError);
      expect(form.visible.map((key) => `drawn_${key}`)).toContain(result.failure.tool);
      expect(["name_clash", "name_too_long", "no_port_schema", "not_tagged", "unsupported_schema"]).toContain(
        result.failure.reason,
      );
    }

    if (description.outside === undefined || form.visible.length === 0) {
      expect(Result.isSuccess(result)).toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success.map((t) => t.name)).toEqual(["ps", ...form.visible.map((key) => `drawn_${key}`)]);
      }
    } else {
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe(
          description.outside === "min_properties" || description.outside === "index_signature"
            ? "unsupported_schema"
            : "not_tagged",
        );
      }
    }
  },
  options(300),
);

it.prop(
  "P2: a tool's wire message decodes to the same Msg update receives",
  { sample: Forms.Sent },
  ({ sample: { description, msg, value } }) => {
    const form = makeForm(description);
    expect(validator(toolFor(form, msg.type).inputSchema)({ value })).toBe(true);
    const port = Programs.port(form.program, msg.type);
    expect(Option.isSome(port)).toBe(true);

    if (Option.isSome(port)) {
      const fields = Schema.decodeUnknownResult(port.value, closed)(value);
      const expected = expectedMessage(form, encoded(form, msg));
      expect(Result.isSuccess(fields)).toBe(true);
      expect(Result.isSuccess(expected)).toBe(true);

      if (Result.isSuccess(fields) && Result.isSuccess(expected)) {
        expect(fields.success).toEqual(withoutType(expected.success));
      }
    }

    const call = Tools.read([form.program], `drawn_${msg.type}`, { value });
    expect(call._tag).toBe("write");

    if (call._tag === "write") {
      expect(call.program).toBe(form.program.name);
      const actual = expectedMessage(form, jsonTrip(call.m));
      const expected = expectedMessage(form, encoded(form, msg));
      expect(Result.isSuccess(actual)).toBe(true);
      expect(Result.isSuccess(expected)).toBe(true);

      if (Result.isSuccess(actual) && Result.isSuccess(expected)) {
        expect(actual.success).toEqual(expected.success);
      }
    }
  },
  options(300),
);

const oracle = (form: Form, key: string, value: unknown) => {
  if (!Predicate.isObject(value) || Array.isArray(value) || Object.hasOwn(value, "type")) {
    return false;
  }

  const result = expectedMessage(form, { ...value, type: key });
  return Result.isSuccess(result) && result.success.type === key;
};

it.prop(
  "P3: only the Msg's own closed JSON codec decides a write",
  { sample: Forms.Outside },
  ({ sample: { description, key, value } }) => {
    const form = makeForm(description);
    const port = Programs.port(form.program, key);
    expect(Option.isSome(port)).toBe(true);

    if (Option.isSome(port)) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(port.value, closed)(value))).toBe(oracle(form, key, value));
    }

    const call = Tools.read([form.program], `drawn_${key}`, { value });
    expect(call._tag === "write").toBe(oracle(form, key, value));

    if (call._tag !== "write") {
      expect(call).toEqual({ _tag: "refused", reason: "bad_input" });
    }
  },
  options(300),
);

it.prop(
  "P4: the listed schema agrees with the decoder within JSON Schema's checks",
  { sample: Forms.Outside },
  ({ sample: { description, key, value } }) => {
    const form = makeForm(description);
    const listed = validator(toolFor(form, key).inputSchema)({ value });
    const accepted = Tools.read([form.program], `drawn_${key}`, { value })._tag === "write";
    expect(!accepted || listed).toBe(true);

    if (form.exact) {
      expect(listed).toBe(accepted);
    }
  },
  options(300),
);

const references = (value: unknown): ReadonlyArray<string> => {
  if (Array.isArray(value)) {
    return value.flatMap(references);
  }

  if (!Predicate.isObject(value)) {
    return [];
  }

  return [
    ...(Predicate.hasProperty(value, "$ref") && Predicate.isString(value.$ref) ? [value.$ref] : []),
    ...Object.values(value).flatMap(references),
  ];
};

it.prop(
  "P5: a tool exposes only its port and every definition is reached",
  { description: Supported },
  ({ description }) => {
    const form = makeForm(description);
    const result = Tools.list([form.program]);
    expect(Result.isSuccess(result)).toBe(true);

    if (Result.isFailure(result)) {
      return;
    }

    for (const key of form.visible) {
      const tool = result.success.find((t) => t.name === `drawn_${key}`)!;
      const json = JSON.stringify(tool.inputSchema);

      for (const member of form.members.filter((m) => !m.tags.includes(key as typeof Key.Type))) {
        for (const field of member.fields) {
          expect(json).not.toContain(field);
        }
      }

      expect(json).not.toContain("internal_timer");
      expect(json).not.toContain('"timer"');

      for (const other of form.keys.filter((other) => other !== key)) {
        expect(json).not.toContain(`"${other}"`);
      }

      const root = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(tool.inputSchema);
      const { $defs, ...body } = root;
      const defs =
        $defs === undefined ? {} : Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))($defs);
      const reached = new Set<string>();
      const pending = [...references(body)];

      while (pending.length > 0) {
        const ref = pending.pop()!;
        expect(ref.startsWith("#/$defs/")).toBe(true);
        const name = ref.slice("#/$defs/".length).replaceAll("~1", "/").replaceAll("~0", "~");
        expect(Object.hasOwn(defs, name)).toBe(true);

        if (!reached.has(name)) {
          reached.add(name);
          pending.push(...references(defs[name]));
        }
      }

      expect([...reached].sort()).toEqual(Object.keys(defs).sort());
    }
  },
  options(300),
);

// vector: the probes reported in reviews 1 to 3 keep their public behavior.
it("vector: V1 ordered bounds, alternatives in both orders, default and shared definitions", () => {
  for (const reverse of [false, true]) {
    const { program, schemas } = richDeclaration("fallback", reverse);
    const result = Tools.list([program]);
    expect(Result.isSuccess(result)).toBe(true);

    if (Result.isFailure(result)) {
      continue;
    }

    for (const [key, values] of Object.entries({
      bounds: [
        { low: 1, high: 2 },
        { low: 2, high: 1 },
      ],
      choose: [
        { side: "left", n: 1 },
        { side: "left", n: -1 },
        { side: "right", text: "ok" },
      ],
      defaulted: [{}, { note: null }, { note: "ok" }],
      read: [{}, { note: null }, { note: "ok" }],
      shared: [{ first: { label: "one" }, second: { label: "two" } }],
    })) {
      const validate = validator(result.success.find((t) => t.name === `rich_${key}`)!.inputSchema);

      for (const value of values) {
        const decoded = Schema.decodeUnknownResult(
          Schema.toCodecJson(schemas[key as keyof typeof schemas]),
          closed,
        )(value);
        const call = Tools.read([program], `rich_${key}`, { value });

        if (Result.isFailure(decoded)) {
          expect(call).toEqual({ _tag: "refused", reason: "bad_input" });
        } else {
          expect(validate({ value })).toBe(true);

          if (key === "read" || key === "shared") {
            expect(call).toEqual({ _tag: "query", program: program.name, name: key, query: decoded.success });
          } else {
            expect(call._tag).toBe("write");

            if (call._tag === "write") {
              expect(Schema.decodeUnknownSync(Schema.toCodecJson(program.msg), closed)(jsonTrip(call.m))).toEqual({
                ...decoded.success,
                type: key,
              });
            }
          }
        }
      }
    }
  }
});

for (const form of schemaForms) {
  // vector: reviews 2 and 3 found these five schema forms, including both union orders.
  it(`vector: V1 ${form}`, () => {
    for (const reverse of [false, true]) {
      const { program, schemas } = schemaDeclaration(form, reverse, "wire_value");
      const result = Tools.list([program]);
      expect(Result.isSuccess(result)).toBe(true);

      if (Result.isFailure(result)) {
        continue;
      }

      for (const [key, schema] of Object.entries(schemas)) {
        const validate = validator(result.success.find((t) => t.name === `forms_${key}`)!.inputSchema);

        for (const value of [
          { side: "left", [form === "encoded keys" ? "wire_value" : "n"]: 7 },
          { side: "right", [form === "encoded keys" ? "wire_value" : "text"]: "ok" },
          { side: "other", n: 7 },
          { side: "left", n: "wrong" },
        ]) {
          const decoded = Schema.decodeUnknownResult(Schema.toCodecJson(schema), closed)(value);
          const call = Tools.read([program], `forms_${key}`, { value });
          expect(call).toEqual(
            Result.isFailure(decoded)
              ? { _tag: "refused", reason: "bad_input" }
              : { _tag: "write", program: program.name, m: { ...value, type: key } },
          );

          if (Result.isSuccess(decoded)) {
            expect(validate({ value })).toBe(true);
          }
        }
      }
    }
  });
}

// vector: review 4's suspended codec must leave the encoded fields in the letter.
it("vector: V1 suspended wire_name codec", () => {
  const msg = Schema.suspend(() =>
    Schema.Struct({ type: Schema.Literal("check"), name: Schema.String }).pipe(
      Schema.encodeKeys({ name: "wire_name" }),
    ),
  );
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: { check: (m) => [m, []] },
  });
  const program = Program.make({
    name: "pack/probe",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs: { check: "Check" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  const value = { wire_name: "ok" };
  const listed = Tools.list([program]);
  expect(Result.isSuccess(listed)).toBe(true);

  if (Result.isSuccess(listed)) {
    expect(validator(listed.success[1]!.inputSchema)({ value })).toBe(true);
  }

  expect(Tools.read([program], "probe_check", { value })).toEqual({
    _tag: "write",
    program: program.name,
    m: { type: "check", ...value },
  });
  expect(Tools.read([program], "probe_check", { value: { name: "ok" } })).toEqual({
    _tag: "refused",
    reason: "bad_input",
  });
  expect(Tools.read([program], "probe_check", { value: { ...value, type: "check" } })).toEqual({
    _tag: "refused",
    reason: "bad_input",
  });
  const call = Tools.read([program], "probe_check", { value });

  if (call._tag === "write") {
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(msg), closed)(jsonTrip(call.m))).toEqual({
      type: "check",
      name: "ok",
    });
  }
});

for (const outside of ["tag_renamed", "tag_renamed_beside_plain", "min_properties"] as const) {
  // vector: reviews 2 and 4 found these unsupported wire forms. Each must fail the whole listing.
  it(`vector: V1 ${outside} has its named reason`, () => {
    const base: Declaration = {
      members: [{ tags: ["a"], fields: ["text"], wrap: "plain" }],
      personOnly: [],
      nest: [],
      whole: "plain",
    };
    failure(
      Tools.list([makeForm({ ...base, outside }).program]),
      outside === "min_properties" ? "unsupported_schema" : "not_tagged",
      "drawn_a",
    );
  });
}

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256), Schema.isPattern(/^[a-zA-Z0-9_-]+$/));
const publicWrite: Port = { read: false, hidden: false, shape: "text", description: "Write" };

const failure = (result: ReturnType<typeof Tools.list>, reason: string, tool: string) => {
  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(Tools.ToolsError);
    expect(result.failure).toMatchObject({ _tag: "ToolsError", reason, tool });
  }
};

it.prop(
  "T3: full harness names fit; clashes, long names and missing Msg members fail the whole list and name the tool",
  { names: Arbitrary.array(Arbitrary.schema(Name), { minLength: 1, maxLength: 5 }) },
  ({ names }) => {
    for (const name of names) {
      const { program } = declaration(`pack/${name}`, [publicWrite]);
      const tool = `${name}_w0`;
      const result = Tools.list([program]);

      if (`mcp__fabrika__${tool}`.length > 64) {
        failure(result, "name_too_long", tool);
      } else {
        expect(Result.isSuccess(result)).toBe(true);

        if (Result.isSuccess(result)) {
          expect(result.success.map((t) => t.name)).toEqual(["ps", tool]);

          for (const t of result.success) {
            expect(`mcp__fabrika__${t.name}`).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
          }
        }

        failure(Tools.list([program, { ...program, name: `other/${name}` }]), "name_clash", tool);
      }

      const missing = { ...program, name: "pack/short", inputs: { absent: program.inputs.w0! } };
      failure(Tools.list([missing]), "no_port_schema", "short_absent");
      expect(Programs.port(program, "unknown")).toEqual(Option.none());
    }

    // Guaranteed boundary neighbors even when generated names all happen to be short.
    for (const length of [47, 48, 256]) {
      const name = "a".repeat(length);
      const result = Tools.list([declaration(`pack/${name}`, [publicWrite]).program]);

      if (length === 47) {
        expect(Result.isSuccess(result)).toBe(true);
      } else {
        failure(result, "name_too_long", `${name}_w0`);
      }
    }

    const a = declaration("pack/a_b", [publicWrite], ["c"]).program;
    const b = declaration("pack/a", [publicWrite], ["b_c"]).program;
    failure(Tools.list([a, b]), "name_clash", "a_b_c");
  },
  options(200),
);

// Ticket 888, Amendment A-Wire, next/: one JSON codec at every boundary. These are the agent's half.
const wireTool = (program: Parameters<typeof Tools.list>[0][number], key: string) => {
  const result = Tools.list([program]);
  expect(Result.isSuccess(result), "the Wire program lists").toBe(true);

  if (Result.isFailure(result)) {
    throw new Error(`Listing failed: ${result.failure.reason} on ${result.failure.tool}`);
  }

  const tool = result.success.find((tool) => tool.name === `wire_${key}`);
  expect(tool, `wire_${key} is listed`).toBeDefined();
  return tool!;
};

/** Sends `value` to the Wire program's `key` tool and returns the one Msg `update` was handed. */
const throughTool = Effect.fn("throughTool")(function* (key: string, value: unknown) {
  const { program, taken } = Wire.make();
  expect(validator(wireTool(program, key).inputSchema)({ value }), "the listed schema accepts the value").toBe(true);
  const call = Tools.read([program], `wire_${key}`, { value });
  expect(call, "the call is a write").toMatchObject({ _tag: "write", program: program.name });

  if (call._tag !== "write") {
    return { m: undefined, taken };
  }

  expect(Schema.is(Schema.Json)(call.m), "m is JSON").toBe(true);
  const execution = nodeExecution(program);
  expect(yield* execution.admit(jsonTrip(call.m)), "admit").toBe(true);
  const start = yield* execution.init(null);
  expect(start._tag).toBe("stepped");

  if (start._tag === "stepped") {
    expect((yield* execution.step(start.model, jsonTrip(call.m)))._tag, "step").toBe("stepped");
  }

  expect(taken, "update is handed one Msg").toHaveLength(1);
  return { m: call.m, taken };
});

it.effect.prop(
  "W2: a tool call's m is the Msg's JSON form, the same letter a person sends, and update is handed an equal Msg",
  { sample: Wire.Sent, q: Wire.Asked },
  ({ sample, q }) =>
    Effect.gen(function* () {
      const same = Schema.toEquivalence(Wire.Msg);

      for (const x of [sample.drawn, sample.edge]) {
        const letter = Wire.letter(x);
        const { m, taken } = yield* throughTool(x.type, withoutType(letter));
        expect(m, "m equals the letter a person's window sends for the same Msg").toStrictEqual(letter);

        for (const got of taken) {
          expect(same(got, x), "update takes a Msg equal to the one sent").toBe(true);
        }
      }

      const { program } = Wire.make();
      const value = Wire.asked(q);
      expect(validator(wireTool(program, "find").inputSchema)({ value }), "the read port accepts the value").toBe(true);
      const call = Tools.read([program], "wire_find", { value });
      expect(call, "the call is a query").toMatchObject({ _tag: "query", program: program.name, name: "find" });

      if (call._tag === "query") {
        const back = Schema.decodeUnknownResult(Schema.toCodecJson(Wire.Query), closed)(jsonTrip(call.query));
        expect(
          Result.isSuccess(back) && Schema.toEquivalence(Wire.Query)(back.success, q),
          "the query decodes with the port's JSON codec to an equal value",
        ).toBe(true);
      }
    }),
  options(300),
);

it.prop(
  "W4: a visible port with a field that has no JSON form fails the list by name, and no call is read",
  { sample: Forms.Odd },
  ({ sample: { description, odd, stranger } }) => {
    const form = makeForm({ ...description, odd });
    const result = Tools.list([form.program]);

    if (odd.personOnly) {
      expect(Result.isSuccess(result), "the same field on a person-only port lists").toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success.map((t) => t.name)).toEqual(["ps", ...form.visible.map((key) => `drawn_${key}`)]);
        expect(form.visible).not.toContain("odd");
      }

      return;
    }

    failure(result, "unsupported_schema", "drawn_odd");

    for (const name of ["ps", ...form.keys.map((key) => `drawn_${key}`), stranger]) {
      for (const args of [{}, { value: {} }, { value: { held: {} } }]) {
        expect(Tools.read([form.program], name, args)).toEqual({ _tag: "refused", reason: "unknown_tool" });
      }
    }
  },
  options(200),
);

const probes: ReadonlyArray<readonly [name: string, value: Readonly<Record<string, string>>, expected: Wire.Msg]> = [
  ["Schema.BigInt", { n: "123" }, { type: "big", n: 123n }],
  ["Schema.Uint8Array", { body: "AQID" }, { type: "bytes", body: new Uint8Array([1, 2, 3]) }],
  ["Schema.Date", { at: "2026-11-12T16:47:00.000Z" }, { type: "date", at: new Date("2026-11-12T16:47:00.000Z") }],
  ["Schema.Number NaN", { x: "NaN" }, { type: "number", x: Number.NaN }],
  ["Schema.Number Infinity", { x: "Infinity" }, { type: "number", x: Infinity }],
  ["Schema.Number -Infinity", { x: "-Infinity" }, { type: "number", x: -Infinity }],
];

for (const [name, value, expected] of probes) {
  // vector: each is one of review 5's four probes, kept by name so a regression points at its review.
  it.effect(`vector: W5 review 5's ${name} probe lists, is accepted and reaches update`, () =>
    Effect.gen(function* () {
      const { taken } = yield* throughTool(expected.type, value);

      for (const got of taken) {
        expect(Schema.toEquivalence(Wire.Msg)(got, expected), `update takes ${name}'s own value`).toBe(true);
      }
    }),
  );
}
