// P8, next/. Port source: apps/fabrika/src/host/agents.test.ts at 13e0c2305beb.
// Mapping: toolsOf/callOf -> schema tools and malformed calls; SDK client -> approval/retry/writer.
// Tracker, quit, desk control, top-bar counts and the old host/stdio handshake are not ported.
import { Machine } from "@demlik/tea/effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { checklist } from "@kampus/checklist";
import { Id } from "@kampus/libfabrika";
import * as Programs from "@kampus/libfabrika/runtime/Program";
import { senderTest } from "@kampus/libfabrika/testing";
import { Arbitrary, Effect, FileSystem, type Option, Result, Schema } from "effect";

const SEED = 119120;
const options = { arbitrary: { seed: SEED, runs: 300, size: 4096, concurrency: 1 }, timeout: 60_000 };
const text = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));
const int = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }));

const json = (depth: number): Schema.Codec<Schema.Json> =>
  depth === 0
    ? Schema.Union([Schema.Null, Schema.Boolean, int(-4096, 4096), text(0, 128)])
    : Schema.Union([
        Schema.Null,
        Schema.Boolean,
        int(-4096, 4096),
        text(0, 128),
        Schema.Array(json(depth - 1)).check(Schema.isMinLength(0), Schema.isMaxLength(8)),
        Schema.Record(text(1, 96), json(depth - 1)).check(Schema.isMinProperties(0), Schema.isMaxProperties(8)),
      ]);

const AgentCalls = Arbitrary.schema(
  Schema.Struct({
    name: text(1, 80),
    other: text(1, 80),
    note: text(1, 256),
    input: json(4),
  }),
);

type Call = typeof AgentCalls extends Arbitrary.Arbitrary<infer C> ? C : never;

type Tool = {
  readonly name: string;
  readonly inputSchema: unknown;
  readonly annotations?: { readonly readOnlyHint?: boolean };
};

type InputDeclaration = {
  readonly name: string;
  readonly schema: Schema.Struct<Readonly<Record<string, Schema.Top & Schema.Codec<unknown, unknown>>>> | Schema.Null;
  readonly readOnly: boolean;
  readonly personOnly: boolean;
};

const standard: ReadonlyArray<InputDeclaration> = [
  {
    name: "check",
    schema: Schema.Struct({
      name: text(1, 80),
      note: Schema.optionalKey(text(1, 256)),
    }),
    readOnly: false,
    personOnly: false,
  },
  { name: "uncheck", schema: Schema.Struct({ name: text(1, 80) }), readOnly: false, personOnly: false },
  { name: "left", schema: Schema.Null, readOnly: true, personOnly: false },
  { name: "items", schema: Schema.Null, readOnly: true, personOnly: false },
  { name: "add", schema: Schema.Struct({ name: text(1, 80) }), readOnly: false, personOnly: true },
  {
    name: "rename",
    schema: Schema.Struct({ name: text(1, 80), to: text(1, 80) }),
    readOnly: false,
    personOnly: true,
  },
  { name: "remove", schema: Schema.Struct({ name: text(1, 80) }), readOnly: false, personOnly: true },
];

const personInputs = standard.filter((d) => d.personOnly);

const DeclarationCases = Arbitrary.array(
  Arbitrary.schema(
    Schema.Struct({
      field: text(1, 96),
      type: Schema.Literals(["string", "number", "boolean"]),
      readOnly: Schema.Boolean,
      personOnly: Schema.Boolean,
    }),
  ),
  { minLength: 0, maxLength: 16 },
).pipe(
  Arbitrary.map((inputs) =>
    inputs.map((input, i) => ({
      name: `extra${i}`,
      schema: Schema.Struct({
        [input.field]:
          input.type === "string" ? Schema.String : input.type === "number" ? Schema.Number : Schema.Boolean,
      }),
      readOnly: input.readOnly,
      personOnly: input.personOnly,
    })),
  ),
);

// All four sets run on every case, including zero inputs and a nonempty hidden-only set.
// Generated extras keep their original reach. Standard checklist inputs still run with generated extras.
const declarationSets = (inputs: ReadonlyArray<InputDeclaration>) => [
  [],
  inputs,
  [...personInputs, ...inputs.slice(0, 15).map((d) => ({ ...d, personOnly: true }))],
  [...standard, ...inputs.slice(0, 12)],
];

const inputSchema = (input: InputDeclaration) =>
  Schema.toJsonSchemaDocument(Schema.Struct({ value: input.schema }), { onExcessProperty: "error" }).schema;

const tools = (actual: ReadonlyArray<Tool>, declarations: ReadonlyArray<InputDeclaration> = standard) => {
  const publicInputs = declarations.filter((d) => !d.personOnly);
  expect(actual.map((t) => t.name)).toEqual(["ps", ...publicInputs.map((d) => `checklist_${d.name}`)]);
  expect(actual[0]?.inputSchema).toEqual({ type: "object", additionalProperties: false });
  expect(actual[0]?.annotations?.readOnlyHint).toBe(true);

  for (const [i, d] of publicInputs.entries()) {
    const tool = actual[i + 1]!;
    expect(tool.inputSchema).toEqual(inputSchema(d));

    if (d.readOnly) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    } else {
      expect(tool.annotations?.readOnlyHint).not.toBe(true);
    }
  }
};

const unknownTool = (actual: { words: string; letters: ReadonlyArray<string> }, name: string) => {
  expect(actual.words).toMatch(/unknown tool|no tool|there is no tool/i);
  expect(actual.words).toContain(name);
  expect(actual.letters).toEqual([]);
};

const personRefusalControls = () => {
  for (const d of personInputs) {
    const name = `checklist_${d.name}`;
    unknownTool({ words: `unknown tool ${name}`, letters: [] }, name);
    expect(() => unknownTool({ words: `accepted ${name}`, letters: [] }, name)).toThrow();
    expect(() => unknownTool({ words: `unknown tool ${name}`, letters: ["planted"] }, name)).toThrow();
  }
};

const letters = (actual: ReadonlyArray<string>) => {
  for (const letter of actual) {
    Schema.decodeUnknownSync(Id.Letter)(letter);
  }

  expect(new Set(actual).size).toBeLessThanOrEqual(1);
};

const visible = (
  a: { readonly saved: string; readonly shown: string; readonly by: string; readonly for: string },
  note: string,
  agent: { readonly key: string; readonly for: string },
) => {
  expect(a).toEqual({ saved: note, shown: note, by: agent.key, for: agent.for });
};

const waitingTools = ["ps", "checklist_check", "checklist_uncheck", "checklist_left", "checklist_items"] as const;

type Waiting = {
  readonly code: string;
  readonly replies: Readonly<
    Record<(typeof waitingTools)[number], { readonly words: string; readonly letters: ReadonlyArray<string> }>
  >;
  readonly tools: ReadonlyArray<Tool>;
};

const waiting = (actual: Waiting) => {
  tools(actual.tools);
  expect(actual.code.length).toBeGreaterThan(0);

  for (const tool of waitingTools) {
    expect(actual.replies[tool].words).toContain(actual.code);
    expect(actual.replies[tool].letters).toEqual([]);
  }
};

type Bridge = {
  readonly tools: (inputs: ReadonlyArray<InputDeclaration>) => Effect.Effect<ReadonlyArray<Tool>>;
  readonly hidden: (
    name: string,
    input: Schema.Json,
    declarations: ReadonlyArray<InputDeclaration>,
  ) => Effect.Effect<{ readonly words: string; readonly letters: ReadonlyArray<string> }>;
  // The binding reads code from the real waiting handshake, then calls all five tools.
  readonly waiting: (call: Call) => Effect.Effect<Waiting>;
  readonly approved: (call: Call) => Effect.Effect<{
    readonly afterRestart: boolean;
    readonly otherName: boolean;
    readonly drives: number;
  }>;
  readonly check: (call: Call) => Effect.Effect<{
    readonly letters: ReadonlyArray<string>;
    readonly result: Parameters<typeof visible>[0];
    readonly agent: { readonly key: string; readonly for: string };
  }>;
  readonly malformed: (
    call: Call,
  ) => Effect.Effect<{ readonly refused: boolean; readonly letters: ReadonlyArray<string> }>;
  readonly missing: (call: Call) => Effect.Effect<{
    readonly reason: string;
    readonly letters: ReadonlyArray<string>;
  }>;
};

const refusePersonInputs = Effect.fnUntraced(function* (b: Pick<Bridge, "hidden">, c: Call) {
  for (const d of personInputs) {
    const name = `checklist_${d.name}`;
    const value = d.name === "rename" ? { name: c.name, to: c.other } : { name: c.name };
    unknownTool(yield* b.hidden(name, { value }, standard), name);
  }
});

type Law = "tools" | "waiting" | "approved" | "check" | "malformed";

const paths = {
  tools: "../../../../packages/libfabrika/src/mcp/Tools.ts",
  waiting: "../../../../packages/libfabrika/src/mcp/Server.ts",
  approved: "../../../../packages/libfabrika/src/node/transport/ClientKeyFile.ts",
  check: "../mcp-demo.laws.test.ts",
  malformed: "../../../../packages/libfabrika/src/mcp/Bridge.ts",
} as const;

const declared = (inputs: ReadonlyArray<InputDeclaration>) => {
  const writes = inputs.filter((d) => !d.readOnly || d.personOnly);
  const msg = Schema.Union([
    ...writes.map((d) =>
      Schema.Struct({ type: Schema.Literal(d.name), ...("fields" in d.schema ? d.schema.fields : {}) }),
    ),
    Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int }),
  ]);
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: Object.fromEntries([...writes.map((d) => [d.name, (m: null) => [m, []]]), ["timer", (m: null) => [m, []]]]),
  });
  return Programs.Program.make({
    name: "fabrika/checklist",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    outputs: {},
    writes: {},
    wake: () => null,
    inputs: Object.fromEntries(
      inputs.map((d) => [
        d.name,
        d.readOnly && !d.personOnly
          ? Programs.Input.cases.read.make({ schema: d.schema, description: d.name, answer: () => null })
          : d.personOnly
            ? { description: d.name, personOnly: true as const }
            : d.name,
      ]),
    ),
  });
};

const bindTools = Effect.fnUntraced(function* () {
  const moduleName = "@kampus/libfabrika/mcp/Tools";
  // edge: JavaScript dynamic import loads only the law whose product file exists.
  const toolsModule: typeof import("@kampus/libfabrika/mcp/Tools") = yield* Effect.tryPromise({
    try: () => import(/* @vite-ignore */ moduleName),
    catch: (cause) => new Error("Tools import failed", { cause }),
  });
  const binding: Pick<Bridge, "tools" | "hidden"> = {
    tools: (inputs) =>
      Effect.gen(function* () {
        const result = toolsModule.list([declared(inputs)]);
        return yield* Effect.fromResult(result);
      }).pipe(Effect.orDie),
    hidden: (name, input, declarations) =>
      Effect.sync(() => {
        const call = toolsModule.read([declared(declarations)], name, { value: input });
        expect(call).toEqual({ _tag: "refused", reason: "unknown_tool" });
        return { words: `unknown tool ${name}`, letters: [] };
      }),
  };
  // The app owns the checklist dependency; lower library modules cannot import it.
  const listed = toolsModule.list([checklist]);
  expect(Result.isSuccess(listed)).toBe(true);

  if (Result.isSuccess(listed)) {
    expect(listed.success.map((tool) => tool.name)).toEqual([
      "ps",
      "checklist_check",
      "checklist_uncheck",
      "checklist_left",
      "checklist_items",
    ]);
  }

  return binding;
});

const bind = (): Bridge => {
  throw new Error("P25 started: bind the real bridge and SDK client for this law");
};

const presence = <A extends Partial<Bridge>>(files: ReadonlySet<string>, law: Law, load: () => A): A | null => {
  if (!files.has(paths[law])) {
    return null;
  }

  const binding = load();
  const methods: ReadonlyArray<keyof Bridge> =
    law === "tools" ? ["tools", "hidden"] : law === "malformed" ? ["malformed", "missing"] : [law];

  for (const name of methods) {
    if (typeof binding[name] !== "function") {
      throw new Error(`missing bridge export: ${name}`);
    }
  }

  return binding;
};

const target = Effect.fnUntraced(function* (ctx: { skip: (reason?: string) => never }, law: Exclude<Law, "tools">) {
  const fs = yield* FileSystem.FileSystem;
  const found = new Set<string>();

  if (yield* fs.exists(new URL(paths[law], import.meta.url).pathname)) {
    found.add(paths[law]);
  }

  const b = presence(found, law, bind);

  if (b === null) {
    ctx.skip(`not built: P25 ${law}`);
  }

  return b;
});

const targetTools = Effect.fnUntraced(function* (ctx: { skip: (reason?: string) => never }) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(new URL(paths.tools, import.meta.url).pathname))) {
    ctx.skip("not built: P25 tools");
  }

  return yield* bindTools();
});

const platform = NodeFileSystem.layer;

it.effect.prop(
  "not built: P25 / schema-made tools, read-only ps first, no person-only input",
  { declarations: DeclarationCases, input: Arbitrary.schema(json(4)) },
  ({ declarations, input }, ctx) =>
    Effect.gen(function* () {
      const b = yield* targetTools(ctx);

      yield* refusePersonInputs(b, { name: "item", other: "renamed", note: "checked", input });

      for (const inputs of declarationSets(declarations)) {
        tools(yield* b.tools(inputs), inputs);

        for (const d of inputs.filter((d) => d.personOnly)) {
          const name = `checklist_${d.name}`;
          unknownTool(yield* b.hidden(name, input, inputs), name);
        }
      }
    }).pipe(Effect.provide(platform)),
  options,
);

it.effect.prop(
  "not built: P25 / before approval tools list; each call answers with the code and no letters",
  { c: AgentCalls },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const b = yield* target(ctx, "waiting"),
        a = yield* b.waiting(c);
      waiting(a);
      yield* refusePersonInputs(b, c);
    }).pipe(Effect.provide(platform)),
  options,
);

it.effect.prop(
  "not built: P25 / approval persists per name across restart, second name needs own grant, ps drives nothing",
  { c: AgentCalls },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const b = yield* target(ctx, "approved"),
        a = yield* b.approved(c);
      expect(a).toEqual({ afterRestart: true, otherName: false, drives: 0 });
      yield* refusePersonInputs(b, c);
    }).pipe(Effect.provide(platform)),
  options,
);

it.effect.prop(
  "not built: P25 / SDK check with a note is visible with the real checked writer; repeated checks reuse one TypeID",
  { c: AgentCalls },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const b = yield* target(ctx, "check"),
        a = yield* b.check(c);
      expect(a.letters.length).toBeGreaterThan(0);
      letters(a.letters);
      visible(a.result, c.note, a.agent);
      yield* refusePersonInputs(b, c);
    }).pipe(Effect.provide(platform)),
  options,
);

it.effect.prop(
  "not built: P25 / malformed calls and checks of missing items write no letters and preserve refusal fields",
  { c: AgentCalls },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const b = yield* target(ctx, "malformed"),
        malformed = yield* b.malformed(c),
        missing = yield* b.missing(c);
      expect(malformed).toEqual({ refused: true, letters: [] });
      expect(missing).toEqual({ reason: "missing", letters: [] });
      yield* refusePersonInputs(b, c);
    }).pipe(Effect.provide(platform)),
  options,
);

const cleanTools = (declarations: ReadonlyArray<InputDeclaration> = standard): ReadonlyArray<Tool> => [
  { name: "ps", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true } },
  ...declarations
    .filter((d) => !d.personOnly)
    .map((d) => ({
      name: `checklist_${d.name}`,
      inputSchema: inputSchema(d),
      annotations: { readOnlyHint: d.readOnly },
    })),
];

const checkDeclarations = (
  build: (inputs: ReadonlyArray<InputDeclaration>) => ReadonlyArray<Tool>,
  inputs: ReadonlyArray<InputDeclaration>,
) => {
  for (const declarations of declarationSets(inputs)) {
    tools(build(declarations), declarations);
  }
};

it.prop(
  "checker clean control: tool contract and checked-writer senderTest",
  {
    c: Arbitrary.schema(Schema.Struct({ name: text(1, 96), note: text(1, 256) })),
    declarations: DeclarationCases,
  },
  ({ c, declarations }) => {
    personRefusalControls();

    for (const inputs of declarationSets(declarations)) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(Programs.Program.schema)(declared(inputs)))).toBe(true);
    }

    checkDeclarations(cleanTools, declarations);
    unknownTool({ words: "unknown tool checklist_add", letters: [] }, "checklist_add");
    const id = "letter_0000000000e008000000000001",
      parent = "input_0000000000e008000000000001";
    const agent = { key: `SHA256:agent-${c.name}`, for: "person_0000000000e008000000000001" };
    letters([id, id]);
    visible({ saved: c.note, shown: c.note, by: agent.key, for: agent.for }, c.note, agent);
    senderTest({
      inputs: [{ parent, by: agent }],
      expected: [{ id, by: agent }],
      writes: [{ id, parent, by: agent }],
      owner: { key: "SHA256:owner", for: agent.for },
      seed: SEED,
    });
  },
  options,
);

it.prop(
  "checker plants: hidden tools, trusted params, new retry ID and forged writer fail",
  { c: Arbitrary.schema(Schema.Struct({ note: text(1, 256) })) },
  ({ c }) => {
    personRefusalControls();

    for (const name of ["checklist_approve", "checklist_remove", "grant", "chaos_fire", "checklist_hidden"]) {
      expect(() => tools([...cleanTools(), { name, inputSchema: {} }])).toThrow();
    }

    expect(() => tools(cleanTools().map((t) => ({ ...t, annotations: { readOnlyHint: false } })))).toThrow();
    expect(() => letters(["letter_0000000000e008000000000001", "letter_0000000000e008000000000002"])).toThrow();
    expect(() => letters(["p8-01"])).toThrow();
    const agent = { key: "SHA256:checked-agent", for: "person_0000000000e008000000000001" };
    expect(() =>
      visible({ saved: c.note, shown: `${c.note}!`, by: agent.key, for: agent.for }, c.note, agent),
    ).toThrow();
    expect(() =>
      visible({ saved: c.note, shown: c.note, by: "params.person", for: agent.for }, c.note, agent),
    ).toThrow();
    expect(() =>
      senderTest({
        inputs: [{ parent: "input", by: agent }],
        expected: [{ id: "letter", by: agent }],
        writes: [{ id: "letter", parent: "input", by: { key: "SHA256:owner", for: agent.for } }],
        owner: agent,
        seed: SEED,
      }),
    ).toThrow();
  },
  options,
);

it.prop(
  "checker plants: empty schemas, missing fields, changed types and callable hidden inputs fail",
  { declarations: DeclarationCases },
  ({ declarations: inputs }) => {
    personRefusalControls();

    for (const declarations of declarationSets(inputs)) {
      const clean = cleanTools(declarations);
      tools(clean, declarations);

      for (const [i, tool] of clean.entries()) {
        expect(() =>
          tools(
            clean.map((t, n) => (n === i ? { ...t, inputSchema: {} } : t)),
            declarations,
          ),
        ).toThrow();

        if (i === 0) {
          continue;
        }

        const d = declarations.filter((d) => !d.personOnly)[i - 1]!;
        const shape = Schema.decodeUnknownSync(
          Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
        )(inputSchema(d));
        const bad = { ...shape.properties, value: { type: "object", properties: {} } };
        expect(() =>
          tools(
            clean.map((t) => (t === tool ? { ...t, inputSchema: { ...inputSchema(d), properties: bad } } : t)),
            declarations,
          ),
        ).toThrow();
        expect(() =>
          tools(
            clean.map((t) =>
              t === tool ? { ...t, inputSchema: { ...inputSchema(d), properties: { value: { type: "number" } } } } : t,
            ),
            declarations,
          ),
        ).toThrow();
      }
    }

    const withoutNote = standard.map((d) =>
      d.name === "check" ? { ...d, schema: Schema.Struct({ name: text(1, 80) }) } : d,
    );
    expect(() => tools(cleanTools(withoutNote))).toThrow();

    expect(() => unknownTool({ words: "saved checklist_add", letters: [] }, "checklist_add")).toThrow();
  },
  options,
);

it.prop(
  "checker plants: extra argument, value and field constraints fail for every public tool",
  { declarations: DeclarationCases },
  ({ declarations }) => {
    personRefusalControls();
    const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

    for (const inputs of declarationSets(declarations)) {
      const clean = cleanTools(inputs),
        publicInputs = inputs.filter((d) => !d.personOnly);
      tools(clean, inputs);

      for (const [i, tool] of clean.entries()) {
        const schema = object(tool.inputSchema);
        const mutations: unknown[] = [{ ...schema, enum: [null] }];

        if (i > 0) {
          const properties = object(schema.properties),
            value = object(properties.value);
          mutations.push({ ...schema, properties: { ...properties, value: { ...value, enum: [null] } } });

          for (const [field, fieldSchema] of Object.entries(object(value.properties ?? {}))) {
            mutations.push({
              ...schema,
              properties: {
                ...properties,
                value: {
                  ...value,
                  properties: {
                    ...object(value.properties),
                    [field]: { ...object(fieldSchema), enum: [null] },
                  },
                },
              },
            });
          }

          // Confirm the field-level plant reaches checklist_check.note as well as generated fields.
          expect(tool.name).toBe(`checklist_${publicInputs[i - 1]!.name}`);
        }

        for (const inputSchema of mutations) {
          expect(() =>
            tools(
              clean.map((t, n) => (n === i ? { ...t, inputSchema } : t)),
              inputs,
            ),
          ).toThrow();
        }
      }
    }

    for (const kind of ["zero", "person-only"] as const) {
      expect(() =>
        checkDeclarations((inputs) => {
          if (kind === "zero" ? inputs.length === 0 : inputs.length > 0 && inputs.every((d) => d.personOnly)) {
            throw new Error(`${kind} inputs rejected`);
          }

          return cleanTools(inputs);
        }, declarations),
      ).toThrow(`${kind} inputs rejected`);
    }
  },
  options,
);

it.prop(
  "checker plants: each waiting tool must include its approval code and write no letter",
  { code: Arbitrary.schema(text(1, 96)) },
  ({ code }) => {
    personRefusalControls();
    const approval = `approval-${code}`,
      reply = { words: `Waiting for approval. Code: ${approval}`, letters: [] };
    const clean: Waiting = {
      code: approval,
      tools: cleanTools(),
      replies: {
        ps: reply,
        checklist_check: reply,
        checklist_uncheck: reply,
        checklist_left: reply,
        checklist_items: reply,
      },
    };
    waiting(clean);

    for (const tool of waitingTools) {
      expect(() =>
        waiting({ ...clean, replies: { ...clean.replies, [tool]: { ...reply, words: "Waiting." } } }),
      ).toThrow();
      expect(() =>
        waiting({
          ...clean,
          replies: { ...clean.replies, [tool]: { ...reply, letters: ["planted letter"] } },
        }),
      ).toThrow();
    }
  },
  options,
);

it.prop(
  "presence checker controls: no source is pending; partial/failed imports fail",
  { message: Arbitrary.schema(text(0, 128)) },
  ({ message }) => {
    personRefusalControls();
    const failed = (): Bridge => {
      throw new Error(`failed import: ${message}`);
    };

    for (const law of Object.keys(paths) as ReadonlyArray<Law>) {
      expect(presence(new Set(), law, failed)).toBeNull();

      for (const other of Object.keys(paths) as ReadonlyArray<Law>) {
        if (other !== law) {
          expect(presence(new Set([paths[other]]), law, failed)).toBeNull();
        }
      }
    }

    for (const law of Object.keys(paths) as ReadonlyArray<Law>) {
      expect(() => presence(new Set([paths[law]]), law, failed)).toThrow("failed import");
    }

    const clean: Bridge = {
      tools: () => Effect.succeed(cleanTools()),
      hidden: () => Effect.succeed({ words: "unknown tool", letters: [] }),
      waiting: () => Effect.die("control only"),
      approved: () => Effect.die("control only"),
      check: () => Effect.die("control only"),
      malformed: () => Effect.die("control only"),
      missing: () => Effect.die("control only"),
    };

    for (const law of Object.keys(paths) as ReadonlyArray<Law>) {
      expect(presence(new Set([paths[law]]), law, () => clean)).toBe(clean);
    }

    expect(() => presence(new Set([paths.tools]), "tools", () => ({ ...clean, hidden: undefined! }))).toThrow(
      "missing bridge export",
    );
  },
  options,
);

// T4 uses the actual checklist here, where its package is already a dependency.
const checklistPortType = () => {
  const port = Programs.port(checklist, "check");
  expectTypeOf<Option.Option.Value<typeof port>["Type"]>().toEqualTypeOf<{
    readonly name: string;
    readonly note?: string;
  }>();
};

void checklistPortType;
