// T730, P38 slice 2, next/: L2, L3 and L4 of the approved plan, for `settings/JsonSchema.ts` over
// `Files.schema`. Written before the module.
//
// The shape these tests hold the module to:
// - `JsonSchema.make(schema)` turns a file's Struct (`Files.schema(group, file)`) into the editor's
//   JSON Schema, by Effect's `Schema.toJsonSchemaDocument` with `onExcessProperty: "error"`: a plain
//   JSON object with `$schema` (the 2020-12 dialect), the root schema's fields, and Effect's
//   definitions as `$defs`, their identifiers and escaping as Effect writes them. A leaf Effect
//   cannot represent makes `make` throw, never ship a looser schema: a leaf Effect writes as `{}`,
//   and a string pattern Effect leaves out (in 4.1.2, one whose RegExp lacks the `u` flag). The
//   shipped schemas must generate, so `fabrika-version`'s pattern must be one Effect writes.
// - A file whose scope holds no declaration is closed too: Effect's empty `Schema.Struct({})`
//   accepts any object, so `Files.schema` must refuse every key there.
// - Each leaf carries its declaration's `doc` as `description` and its encoded default as
//   `default`, even when declarations share one schema; the declaration's own schema keeps its
//   annotations, which S5's messages read.
// - The oracle for L2 and L4 is Effect's own reader, `SchemaRepresentation.fromJsonSchemaDocument`
//   with trusted patterns, never a validator of ours.
import { describe, expect, it } from "@effect/vitest";
import { JsonSchema as EffectJsonSchema, Exit, Predicate, Schema, SchemaAST, SchemaRepresentation } from "effect";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as JsonSchema from "./JsonSchema.ts";
import * as Setting from "./Setting.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const DIALECT = "https://json-schema.org/draft/2020-12/schema";

// The kinds of value a setting holds here, each with its own words, as Declarations.ts writes them.
const KINDS = {
  port: {
    make: () => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
    valid: fc.integer({ min: 1, max: 65535 }),
    invalid: fc.constantFrom<unknown>(0, 65536, "18800", true, 1.5),
  },
  word: {
    // The u flag: Effect writes a pattern into JSON Schema only for a Unicode RegExp.
    make: () => Schema.String.check(Schema.isPattern(/^[a-z]+$/u)),
    valid: fc.stringMatching(/^[a-z]{1,6}$/),
    invalid: fc.constantFrom<unknown>("A1", "", 3, false),
  },
  flag: {
    make: () => Schema.Boolean,
    valid: fc.boolean(),
    invalid: fc.constantFrom<unknown>("yes", 1, null),
  },
} as const;

type Kind = keyof typeof KINDS;

// An identifier with the characters JSON Pointer and URI fragments escape.
const identifier = fc.stringMatching(/^[A-Za-z][A-Za-z0-9/~ %"#._-]{0,8}$/);

/** A pool of schemas, some named; declarations below share them by index. */
const pool = fc.array(
  fc.record({
    kind: fc.constantFrom<Kind>("port", "word", "flag"),
    identifier: fc.option(identifier, { nil: undefined }),
    title: fc.stringMatching(/^a [a-z]{1,6}$/),
    description: fc.stringMatching(/^[A-Z][a-z ]{4,20}\.$/),
  }),
  { minLength: 1, maxLength: 3 },
);

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const scopes = fc.constantFrom<Setting.Scope>(["person"], ["repo"], ["person", "repo"]);

// Words with Markdown punctuation and line breaks, which the schema must keep as written.
const doc = fc
  .array(
    fc.oneof(fc.stringMatching(/^[a-z]{1,8}$/), fc.constantFrom("|", "*", "_", "`", "#", "<b>", "[x](y)", "\\", "\n")),
    {
      minLength: 1,
      maxLength: 8,
    },
  )
  .map((words) => words.join(" "));

const declared = pool.chain((schemas) =>
  fc.tuple(
    fc.constant(schemas),
    fc.uniqueArray(
      fc.record({ table: segment, key: segment, schema: fc.nat(schemas.length - 1), scope: scopes, doc }),
      { minLength: 1, maxLength: 4, selector: (d) => `${d.table}.${d.key}` },
    ),
  ),
);

type Declared = typeof declared extends fc.Arbitrary<infer D> ? D : never;

/** The declarations, each schema made once and shared by every declaration that picks it. */
const build = ([schemas, ds]: Declared) => {
  const made = schemas.map((s) =>
    KINDS[s.kind].make().annotate({
      ...(s.identifier === undefined ? {} : { identifier: s.identifier }),
      title: s.title,
      description: s.description,
    }),
  );
  return { made, values: (n: number) => KINDS[schemas[ds[n]!.schema]!.kind] };
};

/** A generated group, with each declaration's default drawn from its kind. */
const groupWith = (input: Declared, defaults: ReadonlyArray<unknown>) => {
  const [, ds] = input;
  const { made } = build(input);
  return Setting.group(
    Object.fromEntries(
      ds.map((d, n) => [
        `s${n}`,
        Setting.make(`${d.table}.${d.key}`, {
          schema: made[d.schema] as Schema.Codec<unknown, unknown>,
          default: defaults[n],
          doc: d.doc,
          scope: d.scope,
          reload: n % 2 === 0 ? "restart" : "live",
          since: "0.0.0",
        }),
      ]),
    ),
  );
};

const withDefaults = declared.chain((input) =>
  fc.tuple(
    fc.constant(input),
    fc.tuple(...input[1].map((_, n) => build(input).values(n).valid as fc.Arbitrary<unknown>)),
  ),
);

type Json = Record<string, unknown>;

/** The definition a local reference names, by Effect's escaping: URI-encoded JSON Pointer. */
const target = (document: Json, ref: string) => {
  const prefix = "#/$defs/";
  expect(ref.startsWith(prefix), ref).toBe(true);
  const name = decodeURIComponent(ref.slice(prefix.length)).replaceAll("~1", "/").replaceAll("~0", "~");
  const defs = document.$defs;
  expect(Predicate.isObject(defs) && Object.hasOwn(defs, name), `${ref} names no definition`).toBe(true);
  return (defs as Json)[name] as Json;
};

/** A node with its references followed: the referenced fields, with the node's own over them. */
const resolve = (document: Json, node: Json): Json => {
  const { $ref, allOf, ...own } = node;
  const below = typeof $ref === "string" ? resolve(document, target(document, $ref)) : {};
  const parts = Array.isArray(allOf) ? allOf.map((part: Json) => resolve(document, part)) : [];
  return Object.assign({}, below, ...parts, own);
};

/** The leaf a dotted path names in a generated document, followed through its references. */
const leaf = (document: Json, segments: ReadonlyArray<string>) =>
  segments.reduce<Json | undefined>((node, key) => {
    const properties = node === undefined ? undefined : resolve(document, node).properties;
    return Predicate.isObject(properties) && Object.hasOwn(properties, key)
      ? resolve(document, (properties as Json)[key] as Json)
      : undefined;
  }, document);

/** Every `$ref` anywhere in a JSON value. */
const refs = (value: unknown): Array<string> =>
  Array.isArray(value)
    ? value.flatMap(refs)
    : Predicate.isObject(value)
      ? Object.entries(value).flatMap(([key, v]) => (key === "$ref" && typeof v === "string" ? [v] : refs(v)))
      : [];

/** The generated document read back by Effect's own JSON Schema reader. */
const imported = (document: Json) =>
  SchemaRepresentation.fromJsonSchemaDocument(
    EffectJsonSchema.fromSchemaDraft2020_12(document as EffectJsonSchema.JsonSchema),
    { patterns: "apply" },
  ) as Schema.Codec<unknown, unknown>;

/** One file's document: per declaration nothing, a valid value or an invalid one, and maybe one stray key. */
const contents = (input: Declared) =>
  fc.record({
    file: fc.constantFrom<Setting.File>("person", "repo"),
    values: fc.tuple(
      ...input[1].map((_, n) =>
        fc.oneof(
          fc.constant({ _tag: "absent" as const }),
          (build(input).values(n).valid as fc.Arbitrary<unknown>).map((value) => ({ _tag: "valid" as const, value })),
          build(input)
            .values(n)
            .invalid.map((value) => ({ _tag: "invalid" as const, value })),
        ),
      ),
    ),
    empty: fc.boolean(),
    stray: fc.option(
      fc.record({
        table: fc.option(fc.constantFrom(...input[1].map((d) => d.table)), { nil: undefined }),
        key: segment,
      }),
      { nil: undefined },
    ),
  });

type Contents = typeof contents extends (i: Declared) => fc.Arbitrary<infer C> ? C : never;

const tree = ([, ds]: Declared, c: Contents) => {
  const out: Record<string, Record<string, unknown>> = {};
  ds.forEach((d, n) => {
    const v = c.values[n]!;

    if (v._tag !== "absent") {
      out[d.table] = { ...out[d.table], [d.key]: v.value };
    }
  });

  if (c.empty) {
    for (const d of ds.filter((d) => d.scope.includes(c.file))) {
      out[d.table] ??= {};
    }
  }

  const stray = c.stray;

  if (stray !== undefined) {
    if (stray.table === undefined && ds.every((d) => d.table !== stray.key)) {
      (out as Json)[stray.key] = 1;
    }

    if (stray.table !== undefined && ds.every((d) => d.table !== stray.table || d.key !== stray.key)) {
      out[stray.table] = { ...out[stray.table], [stray.key]: 1 };
    }
  }

  return out;
};

describe("L2, the editor schema accepts and refuses exactly what the file's own schema does", () => {
  it("generated documents, valid, omitted, empty, stray or of the other file, decode alike under both", () => {
    fc.assert(
      fc.property(
        withDefaults.chain(([input, defaults]) => fc.tuple(fc.constant(input), fc.constant(defaults), contents(input))),
        ([input, defaults, c]) => {
          const group = groupWith(input, defaults);
          const own = Files.schema(group, c.file);
          const editor = imported(JsonSchema.make(own) as Json);
          const document = tree(input, c);
          const expected = Schema.decodeUnknownExit(own)(document, { onExcessProperty: "error" });
          const got = Schema.decodeUnknownExit(editor)(document, { onExcessProperty: "error" });
          expect(Exit.isSuccess(got), JSON.stringify({ file: c.file, document })).toBe(Exit.isSuccess(expected));
          // An empty file and a file of empty tables are valid for the editor too.
          expect(Exit.isSuccess(Schema.decodeUnknownExit(editor)({}, { onExcessProperty: "error" }))).toBe(true);
        },
      ),
      check,
    );
  });
});

describe("L3, every allowed declaration keeps its own words and encoded default in the editor schema", () => {
  it("each property names its declaration's doc and default, also when declarations share one schema", () => {
    fc.assert(
      fc.property(withDefaults, ([input, defaults]) => {
        const group = groupWith(input, defaults);
        const [schemas, ds] = input;

        for (const file of ["person", "repo"] as const) {
          const document = JsonSchema.make(Files.schema(group, file)) as Json;
          group.declarations.forEach((d, n) => {
            const node = leaf(document, d.segments);
            // Scope: a key is offered in exactly the files that may set it.
            expect(node !== undefined, `${file}: ${d.path}`).toBe(d.scope.includes(file));

            if (node !== undefined) {
              expect(node.description).toBe(d.doc);
              expect(node.default).toEqual(Schema.encodeSync(Schema.toCodecJson(d.schema))(defaults[n]));
            }

            // The declaration's own schema keeps the words a refused value is explained with.
            const own = schemas[ds[n]!.schema]!;
            expect(SchemaAST.resolveTitle(d.schema.ast)).toBe(own.title);
            expect(SchemaAST.resolveDescription(d.schema.ast)).toBe(own.description);
          });
        }
      }),
      check,
    );
  });

  it("vector: the shipped declarations, each file offering its own keys with their docs and defaults", () => {
    // vector: the two files fabrika ships schemas for, read back key by key; the law above generates the rest.
    for (const file of ["person", "repo"] as const) {
      const document = JsonSchema.make(Files.schema(Declarations.all, file)) as Json;

      for (const d of Declarations.all.declarations) {
        const node = leaf(document, d.segments);
        expect(node !== undefined).toBe(d.scope.includes(file));

        if (node !== undefined) {
          expect(node.description).toBe(d.doc);
          expect(node.default).toEqual(Schema.encodeSync(Schema.toCodecJson(d.schema))(d.default));
        }
      }

      // The editor refuses what the file refuses: a version that is not three numbers, a port out of range.
      const editor = imported(document);
      const own = Files.schema(Declarations.all, file);

      for (const value of [
        { "fabrika-version": "nope" },
        { "fabrika-version": "1.2.3" },
        { instance: { port: 70000 } },
        { instance: { port: 18800 } },
        { instance: {} },
      ]) {
        const want = Exit.isSuccess(Schema.decodeUnknownExit(own)(value, { onExcessProperty: "error" }));
        expect(
          Exit.isSuccess(Schema.decodeUnknownExit(editor)(value, { onExcessProperty: "error" })),
          `${file}: ${JSON.stringify(value)}`,
        ).toBe(want);
      }
    }
  });
});

describe("L4, generated local references resolve, with every definition present", () => {
  it("named, shared and punctuated schemas: each $ref has its definition, and Effect reads the document back", () => {
    fc.assert(
      fc.property(
        withDefaults.chain(([input, defaults]) => fc.tuple(fc.constant(input), fc.constant(defaults), contents(input))),
        ([input, defaults, c]) => {
          const group = groupWith(input, defaults);
          const document = JsonSchema.make(Files.schema(group, c.file)) as Json;
          expect(document.$schema).toBe(DIALECT);
          // Effect names a definition only for a named schema, so a named one in scope gives a $ref.
          const named = input[1].some((d) => d.scope.includes(c.file) && input[0][d.schema]!.identifier !== undefined);
          expect(refs(document).length > 0).toBe(named);

          for (const ref of refs(document)) {
            target(document, ref);
          }

          // Generated valid values of the file's own keys decode, and one invalid value among them does not.
          const editor = imported(document);
          const valid: Record<string, Record<string, unknown>> = {};
          let broken: Record<string, Record<string, unknown>> | undefined;
          input[1].forEach((d, n) => {
            const v = c.values[n]!;

            if (!d.scope.includes(c.file)) {
              return;
            }

            if (v._tag === "valid") {
              valid[d.table] = { ...valid[d.table], [d.key]: v.value };
            } else if (c.empty) {
              valid[d.table] ??= {};
            }

            if (v._tag === "invalid" && broken === undefined) {
              broken = { [d.table]: { [d.key]: v.value } };
            }
          });
          const decoded = Schema.decodeUnknownExit(editor)(valid, { onExcessProperty: "error" });
          expect(Exit.isSuccess(decoded), JSON.stringify(valid)).toBe(true);

          if (broken !== undefined) {
            const [[table, keys]] = Object.entries(broken) as [[string, Record<string, unknown>]];
            const document = { ...valid, [table]: { ...valid[table], ...keys } };
            expect(Exit.isFailure(Schema.decodeUnknownExit(editor)(document, { onExcessProperty: "error" }))).toBe(
              true,
            );
          }
        },
      ),
      check,
    );
  });

  it("a leaf Effect cannot represent fails generation, never a looser schema", () => {
    class Thing {}
    fc.assert(
      fc.property(
        withDefaults,
        fc.constantFrom<Setting.File>("person", "repo"),
        fc.constantFrom("pattern", "map", "thing"),
        segment,
        ([input, defaults], file, kind, key) => {
          const group = groupWith(input, defaults);
          // The file's own schema alone is representable.
          expect(() => JsonSchema.make(Files.schema(group, file))).not.toThrow();

          if (kind === "pattern") {
            // A RegExp without the u flag: Effect leaves its pattern out, so the editor would take
            // any string. A real declaration can hold one, as `fabrika-version` did.
            const loose = Setting.make(`nojsonx.${key}`, {
              schema: Schema.String.check(Schema.isPattern(/^[a-z]+$/)),
              default: "a",
              doc: "A word.",
              scope: [file],
              reload: "restart",
              since: "0.0.0",
            });
            const both = Setting.group({ ...group.settings, loose });
            expect(() => JsonSchema.make(Files.schema(both, file))).toThrow();
          } else {
            // `Setting.make` refuses a schema with no text codec, so this leaf sits beside the
            // file's schema: Effect writes it as `{}`, which accepts anything.
            const opaque = Schema.toCodecJson(kind === "map" ? Schema.instanceOf(Map) : Schema.instanceOf(Thing));
            const schema = Schema.Struct({
              file: Schema.optionalKey(Files.schema(group, file)),
              nojsonx: Schema.optionalKey(Schema.Struct({ value: Schema.optionalKey(opaque) })),
            });
            expect(() => JsonSchema.make(schema)).toThrow();
          }
        },
      ),
      check,
    );
  });
});
