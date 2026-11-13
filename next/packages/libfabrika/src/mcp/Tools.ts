/**
 * MCP tools derived from a program's declared ports, without a transport.
 *
 * @stability unstable
 */
import type * as JsonSchema from "effect/JsonSchema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Program from "../runtime/Program.ts";

/**
 * Schema for the tool description shown to an agent.
 *
 * @stability unstable
 * @category models
 */
export const Tool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Json,
  annotations: Schema.optionalKey(Schema.Struct({ readOnlyHint: Schema.Literal(true) })),
});

/**
 * A tool description shown to an agent.
 *
 * @stability unstable
 * @category models
 */
export type Tool = typeof Tool.Type;

/**
 * Schema for a decoded tool call or a refusal before anything is sent.
 *
 * @stability unstable
 * @category models
 */
export const Call = Schema.TaggedUnion({
  ps: {},
  write: { program: Program.Program.schema.fields.name, m: Schema.Json },
  query: { program: Program.Program.schema.fields.name, name: Schema.String, query: Schema.Json },
  refused: { reason: Schema.Literals(["unknown_tool", "bad_input"]) },
});

/**
 * A decoded tool call or a refusal before anything is sent.
 *
 * @stability unstable
 * @category models
 */
export type Call = typeof Call.Type;

/**
 * A declaration cannot be offered as an unambiguous tool list.
 *
 * @stability unstable
 * @category errors
 */
export class ToolsError extends Schema.TaggedError<ToolsError>()("ToolsError", {
  reason: Schema.Literals(["name_clash", "name_too_long", "no_port_schema", "not_tagged", "unsupported_schema"]),
  tool: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

type AnyProgram = typeof Program.Program.schema.Type;
const closed = { onExcessProperty: "error" } as const;
const PsArguments = Schema.Record(Schema.String, Schema.Never);
const decodeJson = Schema.decodeUnknownResult(Schema.Json);
type Reason = ToolsError["reason"];

type Member = JsonSchema.JsonSchema & {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
};

const MemberShape = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.Record(Schema.String, Schema.Unknown),
  required: Schema.Array(Schema.String),
});

const Tag = Schema.Struct({ type: Schema.Literal("string"), enum: Schema.NonEmptyArray(Schema.String) });
const MEMBER = new Set(["type", "properties", "required", "additionalProperties", "title", "description"]);
const JOIN = new Set(["anyOf", "oneOf", "title", "description"]);
const REF = new Set(["$ref", "title", "description"]);
const prefix = "#/$defs/";
const refName = (ref: string) => ref.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");

const alternatives = <A>(
  node: unknown,
  defs: JsonSchema.Definitions,
  leaf: (node: JsonSchema.JsonSchema) => Result.Result<ReadonlyArray<A>, Reason>,
  seen: ReadonlySet<string> = new Set(),
): Result.Result<ReadonlyArray<A>, Reason> => {
  if (!Predicate.isObject(node)) {
    return Result.fail("not_tagged");
  }

  if (Predicate.isString(node.$ref)) {
    if (!Object.keys(node).every((key) => REF.has(key))) {
      return Result.fail("unsupported_schema");
    }

    const name = refName(node.$ref);
    return !node.$ref.startsWith(prefix) || !Object.hasOwn(defs, name) || seen.has(name)
      ? Result.fail("not_tagged")
      : alternatives(defs[name], defs, leaf, new Set([...seen, name]));
  }

  const joined = node.anyOf ?? node.oneOf;

  if (Array.isArray(joined)) {
    if (!Object.keys(node).every((key) => JOIN.has(key)) || (node.anyOf !== undefined && node.oneOf !== undefined)) {
      return Result.fail("unsupported_schema");
    }

    return joined.length === 0
      ? Result.fail("not_tagged")
      : Result.map(Result.all(joined.map((child) => alternatives(child, defs, leaf, seen))), (all) => all.flat());
  }

  return leaf(node);
};

const members = (node: unknown, defs: JsonSchema.Definitions) =>
  alternatives<Member>(node, defs, (node) => {
    const shape = Schema.decodeUnknownResult(MemberShape)(node);

    if (Result.isFailure(shape) || !shape.success.required.includes("type")) {
      return Result.fail("not_tagged");
    }

    const tag = alternatives<string>(shape.success.properties.type, defs, (node) => {
      const decoded = Schema.decodeUnknownResult(Tag)(node);
      return Result.isFailure(decoded) ? Result.fail("not_tagged") : Result.succeed(decoded.success.enum);
    });

    if (Result.isFailure(tag)) {
      return Result.fail("not_tagged");
    }

    if (
      !Object.keys(node).every((key) => MEMBER.has(key)) ||
      (node.additionalProperties !== undefined && node.additionalProperties !== false)
    ) {
      return Result.fail("unsupported_schema");
    }

    return Result.succeed([{ ...node, ...shape.success, tags: tag.success }]);
  });

const value = (all: ReadonlyArray<Member>, key: string): Result.Result<JsonSchema.JsonSchema, Reason> => {
  const mine = all
    .filter((member) => member.tags.includes(key))
    .map((member) => {
      const {
        properties: { type: _, ...properties },
        required,
        tags: __,
        ...rest
      } = member;
      return { ...rest, properties, required: required.filter((name) => name !== "type") };
    });
  const [first, ...rest] = mine;

  if (first === undefined) {
    return Result.fail("no_port_schema");
  }

  // oxlint-disable-next-line fabrika/no-of -- anyOf is JSON Schema's keyword for alternatives.
  return Result.succeed(rest.length === 0 ? first : { anyOf: mine });
};

const references = (node: unknown): ReadonlyArray<string> => {
  if (Array.isArray(node)) {
    return node.flatMap(references);
  }

  if (!Predicate.isObject(node)) {
    return [];
  }

  return [...(Predicate.isString(node.$ref) ? [node.$ref] : []), ...Object.values(node).flatMap(references)];
};

const definitions = (schema: JsonSchema.JsonSchema, defs: JsonSchema.Definitions) => {
  const reached: JsonSchema.Definitions = {};
  const pending = [...references(schema)];

  while (pending.length > 0) {
    const ref = pending.pop();

    if (ref === undefined) {
      break;
    }

    const name = refName(ref);
    const definition = Object.hasOwn(defs, name) ? defs[name] : undefined;

    if (!ref.startsWith(prefix) || definition === undefined) {
      return Result.fail<Reason>("unsupported_schema");
    }

    if (!Object.hasOwn(reached, name)) {
      Object.defineProperty(reached, name, { value: definition, enumerable: true });
      pending.push(...references(definition));
    }
  }

  return Result.succeed(Object.keys(reached).length === 0 ? schema : { ...schema, $defs: reached });
};

const inputSchema = (program: AnyProgram, key: string, input: Program.Input, name: string) => {
  const document = Result.try({
    try: () =>
      Schema.toJsonSchemaDocument(input._tag === "read" ? Schema.Struct({ value: input.schema }) : program.msg, closed),
    catch: (cause) => new ToolsError({ reason: "unsupported_schema", tool: name, cause }),
  });

  if (Result.isFailure(document)) {
    return Result.fail(document.failure);
  }

  const { schema, definitions: defs } = document.success;
  const root =
    input._tag === "read"
      ? Result.succeed(schema)
      : Result.map(
          Result.flatMap(members(schema, defs), (all) => value(all, key)),
          (value) => ({
            type: "object",
            properties: { value },
            required: ["value"],
            additionalProperties: false,
          }),
        );
  return Result.mapError(
    Result.flatMap(root, (schema) => definitions(schema, defs)),
    (reason) => new ToolsError({ reason, tool: name }),
  );
};

const ports = (programs: ReadonlyArray<AnyProgram>) =>
  programs.flatMap((program) =>
    Object.entries(program.inputs).flatMap(([key, input]) =>
      input._tag === "write" && input.personOnly
        ? []
        : [{ program, key, input, name: `${program.name.slice(program.name.lastIndexOf("/") + 1)}_${key}` }],
    ),
  );

const ps = Tool.make({
  name: "ps",
  description: "List the running processes.",
  inputSchema: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(PsArguments, closed).schema),
  annotations: { readOnlyHint: true },
});

/**
 * Lists `ps` first, then visible ports in program and declaration order.
 * Invalid names, collisions and missing message schemas fail the whole list.
 *
 * @stability unstable
 * @category getters
 */
export const list = (programs: ReadonlyArray<AnyProgram>): Result.Result<ReadonlyArray<Tool>, ToolsError> => {
  const tools = [ps];
  const names = new Set([ps.name]);

  for (const { program, key, input, name } of ports(programs)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(`mcp__fabrika__${name}`)) {
      return Result.fail(new ToolsError({ reason: "name_too_long", tool: name }));
    }

    if (names.has(name)) {
      return Result.fail(new ToolsError({ reason: "name_clash", tool: name }));
    }

    const listed = inputSchema(program, key, input, name);

    if (Result.isFailure(listed)) {
      return Result.fail(listed.failure);
    }

    const tool = Result.try({
      try: () => {
        return Tool.make({
          name,
          description: input.description,
          inputSchema: Schema.decodeUnknownSync(Schema.Json)(listed.success),
          ...(input._tag === "read" ? { annotations: { readOnlyHint: true as const } } : {}),
        });
      },
      catch: (cause) => new ToolsError({ reason: "unsupported_schema", tool: name, cause }),
    });

    if (Result.isFailure(tool)) {
      return Result.fail(tool.failure);
    }

    tools.push(tool.success);
    names.add(name);
  }

  return Result.succeed(tools);
};

const refused = Call.cases.refused.make;
const decodeWire = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Json));

/**
 * Decodes outside arguments with the named port's schema, refusing hidden or unknown tools.
 *
 * @stability unstable
 * @category decoding
 */
export const read = (programs: ReadonlyArray<AnyProgram>, name: string, args: unknown): Call => {
  const decoded = Result.try((): Call => {
    const tools = list(programs);

    if (Result.isFailure(tools) || !tools.success.some((tool) => tool.name === name)) {
      return refused({ reason: "unknown_tool" });
    }

    if (name === "ps") {
      return Result.isSuccess(Schema.decodeUnknownResult(PsArguments, closed)(args))
        ? Call.cases.ps.make({})
        : refused({ reason: "bad_input" });
    }

    const found = ports(programs).find((p) => p.name === name);

    if (found === undefined) {
      return refused({ reason: "unknown_tool" });
    }

    const { program, key, input } = found;
    const schema = Program.port(program, key);

    if (Option.isNone(schema)) {
      return refused({ reason: "bad_input" });
    }

    const value = Schema.decodeUnknownResult(
      input._tag === "read"
        ? Schema.toCodecJson(Schema.Struct({ value: schema.value }))
        : Schema.Struct({ value: schema.value }),
      closed,
    )(args);

    if (Result.isFailure(value)) {
      return refused({ reason: "bad_input" });
    }

    if (input._tag === "read") {
      const query = decodeJson(value.success.value);
      return Result.isFailure(query)
        ? refused({ reason: "bad_input" })
        : Call.cases.query.make({ program: program.name, name: key, query: query.success });
    }

    if (!Predicate.isObject(value.success.value)) {
      return refused({ reason: "bad_input" });
    }

    const message = Result.flatMap(
      Schema.encodeUnknownResult(program.msg)({ ...value.success.value, type: key }),
      (wire) => decodeWire(JSON.stringify(wire)),
    );
    return Result.isFailure(message)
      ? refused({ reason: "bad_input" })
      : Call.cases.write.make({ program: program.name, m: message.success });
  });

  return Result.isFailure(decoded) ? refused({ reason: "bad_input" }) : decoded.success;
};
