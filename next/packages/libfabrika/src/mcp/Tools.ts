/**
 * MCP tools derived from a program's declared ports, without a transport.
 *
 * @stability unstable
 */
import * as Option from "effect/Option";
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
  reason: Schema.Literals(["name_clash", "name_too_long", "no_port_schema"]),
  tool: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

type AnyProgram = typeof Program.Program.schema.Type;

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
  inputSchema: { type: "object" },
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

    const schema = Program.port(program, key);

    if (Option.isNone(schema)) {
      return Result.fail(new ToolsError({ reason: "no_port_schema", tool: name }));
    }

    const tool = Result.try({
      try: () => {
        const document = Schema.toJsonSchemaDocument(Schema.Struct({ value: schema.value }));
        return Tool.make({
          name,
          description: input.description,
          inputSchema: Schema.decodeUnknownSync(Schema.Json)(
            Object.keys(document.definitions).length === 0
              ? document.schema
              : { ...document.schema, $defs: document.definitions },
          ),
          ...(input._tag === "read" ? { annotations: { readOnlyHint: true as const } } : {}),
        });
      },
      catch: (cause) => new ToolsError({ reason: "no_port_schema", tool: name, cause }),
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
const decodeJson = Schema.decodeUnknownResult(Schema.Json);
const decodeObject = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Json));

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
      return Result.isSuccess(Schema.decodeUnknownResult(Schema.Struct({}))(args))
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

    const value = Schema.decodeUnknownResult(Schema.Struct({ value: schema.value }))(args);

    if (Result.isFailure(value)) {
      return refused({ reason: "bad_input" });
    }

    if (input._tag === "read") {
      const query = decodeJson(value.success.value);
      return Result.isFailure(query)
        ? refused({ reason: "bad_input" })
        : Call.cases.query.make({ program: program.name, name: key, query: query.success });
    }

    const message = decodeObject(value.success.value);
    return Result.isFailure(message)
      ? refused({ reason: "bad_input" })
      : Call.cases.write.make({ program: program.name, m: { ...message.success, type: key } });
  });

  return Result.isFailure(decoded) ? refused({ reason: "bad_input" }) : decoded.success;
};
