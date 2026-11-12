// P25 slice 1, next/: the real program declarations decide which tools exist.
import { Machine } from "@demlik/tea/effect";
import { expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Input, Program } from "../runtime/Program.ts";
import * as Programs from "../runtime/Program.ts";
import * as Tools from "./Tools.ts";

const options = (runs: number) => ({ arbitrary: { seed: 119120, runs, size: 4096 } });
const text = Schema.String.check(Schema.isMaxLength(80));

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
    expect(result.success[0]?.inputSchema).toEqual({ type: "object" });

    for (const [i, entry] of expected.entries()) {
      const tool = result.success[i + 1]!;
      expect(tool.description).toBe(entry.port.description);
      expect(tool.inputSchema).toEqual(Schema.toJsonSchemaDocument(Schema.Struct({ value: entry.schema })).schema);
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

      const decoded = Schema.decodeUnknownResult(Schema.Struct({ value: schema }))(input);
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
    }
  },
  options(300),
);

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
