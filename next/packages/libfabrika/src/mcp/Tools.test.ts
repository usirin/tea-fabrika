// P25 slice 1, next/: the real program declarations decide which tools exist.
import { Machine } from "@demlik/tea/effect";
import { expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Input, Program } from "../runtime/Program.ts";
import * as Programs from "../runtime/Program.ts";
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

const fields = (shape: Port["shape"]): Schema.Struct.Fields => {
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
  "T1: closed schemas keep all message alternatives and resolve shared definitions",
  { fallback: text, reverse: Schema.Boolean },
  ({ fallback, reverse }) => {
    const rich = richDeclaration(fallback, reverse);
    const richTools = Tools.list([rich.program]);
    expect(Result.isSuccess(richTools)).toBe(true);

    if (Result.isSuccess(richTools)) {
      expect(richTools.success.map((tool) => tool.name)).toEqual([
        "ps",
        ...Object.keys(rich.schemas).map((key) => `rich_${key}`),
      ]);

      for (const [i, [key, schema]] of Object.entries(rich.schemas).entries()) {
        expect(richTools.success[i + 1]?.inputSchema).toEqual(inputSchema(schema));
        expect(richTools.success[i + 1]?.annotations?.readOnlyHint === true).toBe(key === "read" || key === "shared");
      }
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

for (const key of ["bounds", "choose", "defaulted", "read", "shared"] as const) {
  it.prop(
    `T2: ${key} keeps message checks, alternatives and JSON decoding`,
    {
      text,
      n: Schema.Int.check(Schema.isBetween({ minimum: -4096, maximum: 4096 })),
      reverse: Schema.Boolean,
      input: Schema.Json,
    },
    ({ text: s, n, reverse, input }) => {
      const rich = richDeclaration(s, reverse);
      const cases = {
        bounds: [
          { low: n, high: n },
          { low: n, high: n + 1 },
          { low: n + 1, high: n },
        ],
        choose: [
          { side: "left", n: Math.abs(n) },
          { side: "left", n: -Math.abs(n) - 1 },
          { side: "right", text: s },
          { side: "other", text: s },
        ],
        defaulted: [{ note: null }, {}, { note: s }, { note: n }],
        read: [{ note: null }, {}, { note: s }, { note: n }],
        shared: [{ first: { label: s }, second: { label: s } }],
      };

      const schema = rich.schemas[key];
      const port = Programs.port(rich.program, key);
      expect(Option.isSome(port)).toBe(true);

      for (const value of [...cases[key], input]) {
        const decoded = Schema.decodeUnknownResult(Schema.toCodecJson(schema), closed)(value);

        if (Option.isSome(port)) {
          const actual = Schema.decodeUnknownResult(Schema.toCodecJson(port.value), closed)(value);
          expect(Result.isSuccess(actual)).toBe(Result.isSuccess(decoded));

          if (Result.isSuccess(actual) && Result.isSuccess(decoded)) {
            expect(actual.success).toEqual(decoded.success);
          }
        }

        expect(Tools.read([rich.program], `rich_${key}`, { value })).toEqual(
          Result.isFailure(decoded)
            ? { _tag: "refused", reason: "bad_input" }
            : key === "read" || key === "shared"
              ? { _tag: "query", program: rich.program.name, name: key, query: decoded.success }
              : { _tag: "write", program: rich.program.name, m: { ...decoded.success, type: key } },
        );
      }
    },
    options(300),
  );
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
      expect(Programs.port(missing, "absent")).toEqual(Option.none());
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
