// Only this adapter knows the parser and serializer. Edit receives source positions and text.
import { stringify } from "@decimalturn/toml-patch";
import { Effect, Layer, Predicate, Result, Schema } from "effect";
import { type AST, getStaticTOMLValue, ParseError, parseTOML } from "toml-eslint-parser";
import * as Edit from "./internal/Edit.ts";
import { Conflict, Syntax, Toml, type TomlDocument, TomlError, Value } from "./Toml.ts";

const range = (node: AST.HasLocs): Edit.Range => ({ start: node.range[0], end: node.range[1] });
const key = (node: AST.TOMLKey): Array<string> => getStaticTOMLValue(node);

// A terminator keeps 1.0.3's EOF-zero token range complete, without changing source offsets.
const syntax = (text: string): AST.TOMLProgram => parseTOML(`${text} `);

// Own properties matter here: TOML keys may spell __proto__, constructor or toString.
const put = (table: object, path: Edit.Path, value: unknown): void => {
  let parent = table;

  for (const [i, segment] of path.entries()) {
    if (i === path.length - 1) {
      Object.defineProperty(parent, segment, { value, enumerable: true, writable: true, configurable: true });
    } else {
      if (!Object.hasOwn(parent, segment)) {
        Object.defineProperty(parent, segment, {
          value: typeof path[i + 1] === "number" ? [] : {},
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }

      parent = Reflect.get(parent, segment);
    }
  }
};

const content = (node: AST.TOMLContentNode): unknown => {
  if (node.type === "TOMLValue") {
    return node.value;
  }

  if (node.type === "TOMLArray") {
    return node.elements.map(content);
  }

  const value = {};

  for (const assignment of node.body) {
    put(value, key(assignment.key), content(assignment.value));
  }

  return value;
};

const sectionStart = (text: string, node: AST.TOMLTable): number => {
  let start = text.lastIndexOf("\n", node.range[0] - 1) + 1;

  while (start > 0) {
    const previous = start < 2 ? 0 : text.lastIndexOf("\n", start - 2) + 1;

    if (!/^\s*(?:#[^\r\n]*)?\s*$/.test(text.slice(previous, start))) {
      break;
    }

    start = previous;
  }

  return start;
};

const index = (text: string, program: AST.TOMLProgram): Edit.Index => {
  const nodes = program.body[0].body;
  const tables = nodes.filter((node) => node.type === "TOMLTable");
  const value: Record<string, unknown> = {};
  const assignments: Array<Edit.Assignment> = [];
  const inlines: Array<Edit.Inline> = [];
  const sections: [Edit.Section, ...Array<Edit.Section>] = [
    { path: [], line: 1, end: tables[0] ? sectionStart(text, tables[0]) : text.length },
  ];
  const visit = (parent: Edit.Path, node: AST.TOMLKeyValue, inline?: Edit.Range): Edit.Assignment => {
    const path = [...parent, ...key(node.key)];
    const assignment = { ...range(node), path, line: node.loc.start.line, value: range(node.value), inline };
    assignments.push(assignment);

    if (node.value.type === "TOMLInlineTable") {
      const container = range(node.value);
      const members = node.value.body.map((child) => visit(path, child, container));
      const commas = program.tokens
        .filter(
          (token) =>
            token.value === "," &&
            token.range[0] > container.start &&
            token.range[1] < container.end &&
            !members.some((member) => token.range[0] >= member.start && token.range[1] <= member.end),
        )
        .map(range);
      inlines.push({ ...container, path, members, commas });
    }

    return assignment;
  };

  for (const [i, table] of tables.entries()) {
    const next = tables[i + 1];
    sections.push({
      path: table.resolvedKey,
      line: table.loc.start.line,
      end: next ? sectionStart(text, next) : text.length,
    });

    if (Edit.read(value, table.resolvedKey) === undefined) {
      put(value, table.resolvedKey, {});
    }
  }

  for (const node of nodes) {
    if (node.type === "TOMLKeyValue") {
      const assignment = visit([], node);
      put(value, assignment.path, content(node.value));
    } else {
      for (const child of node.body) {
        const assignment = visit(node.resolvedKey, child);
        put(value, assignment.path, content(child.value));
      }
    }
  }

  return { value, assignments, inlines, sections, comments: program.comments.map(range) };
};

const failure = (reason: Syntax | Value | Conflict, line: number): TomlError =>
  new TomlError({
    reason,
    message: reason.cause instanceof Error ? reason.cause.message : "The TOML operation failed.",
    line,
    cause: reason.cause,
  });

const parseSource = Effect.fnUntraced(function* (text: string) {
  return yield* Effect.try({
    try: () => index(text, syntax(text)),
    catch: (cause: unknown) => failure(new Syntax({ cause }), cause instanceof ParseError ? cause.lineNumber : 1),
  });
});

const Scalar = Schema.Union([Schema.String, Schema.Boolean, Schema.Number.check(Schema.isFinite())]);
const scalar = Schema.decodeUnknownSync(Scalar);

// Validate before encoding: serializers can otherwise omit unsupported members or coerce values.
const encoded = (value: unknown, ancestors: ReadonlySet<object> = new Set()): unknown => {
  if (Predicate.isObjectOrArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("A TOML value cannot contain a cycle.");
    }

    const next = new Set([...ancestors, value]);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) {
          throw new TypeError("A TOML array cannot contain a missing element.");
        }
      }

      return value.map((child) => encoded(child, next));
    }

    if (
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new TypeError("A TOML table must be a plain record with string keys.");
    }

    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, encoded(child, next)]));
  }

  const result = scalar(value);

  if (typeof result === "number" && Number.isInteger(result) && !Number.isSafeInteger(result)) {
    throw new TypeError("A TOML integer must be a safe JavaScript integer.");
  }

  return result;
};

const format = { inlineTableStart: 0, multilineTable: false, multilineArray: false, trailingNewline: 0 } as const;

const render = Effect.fnUntraced(function* (path: ReadonlyArray<string>, value: unknown) {
  return yield* Effect.try({
    try: () => {
      const checked = encoded(value);
      const source = stringify({ value: checked }, format);
      const assignment = syntax(source).body[0].body[0];

      if (assignment?.type !== "TOMLKeyValue") {
        throw new TypeError("The encoder did not produce an assigned TOML value.");
      }

      const keys = path.map((segment) => {
        const text = stringify(Object.fromEntries([[segment, 0]]), format);
        const node = syntax(text).body[0].body[0];

        if (node?.type !== "TOMLKeyValue") {
          throw new TypeError("The encoder did not produce a TOML key.");
        }

        return text.slice(...node.key.range);
      });
      return { value: checked, text: source.slice(...assignment.value.range), keys };
    },
    catch: (cause: unknown) => failure(new Value({ cause }), 1),
  });
});

const planned = <A>(result: Result.Result<A, Edit.Refusal>, path: ReadonlyArray<string>): Effect.Effect<A, TomlError> =>
  Result.isFailure(result)
    ? Effect.fail(failure(new Conflict({ path, cause: result.failure.cause }), result.failure.line))
    : Effect.succeed(result.success);

const parse = Effect.fnUntraced(function* (text: string): Effect.fn.Return<TomlDocument, TomlError> {
  const source = yield* parseSource(text);
  return {
    value: source.value,
    spans: [
      ...source.assignments.map((assignment) => ({ path: assignment.path.map(String), line: assignment.line })),
      ...source.sections
        .filter((section) => section.path.length > 0)
        .map((section) => ({ path: section.path.map(String), line: section.line })),
    ].sort((left, right) => left.line - right.line),
  };
});

const set = Effect.fnUntraced(function* (text: string, path: ReadonlyArray<string>, value: unknown) {
  const source = yield* parseSource(text);
  yield* planned(Edit.check(source, path), path);
  const rendered = yield* render(path, value);
  const candidate = yield* planned(Edit.set(text, source, path, rendered.value, rendered.text, rendered.keys), path);
  yield* parseSource(candidate);
  return candidate;
});

const remove = Effect.fnUntraced(function* (text: string, path: ReadonlyArray<string>) {
  const source = yield* parseSource(text);
  const candidate = yield* planned(Edit.remove(text, source, path), path);
  yield* parseSource(candidate);
  return candidate;
});

export const layer = Layer.succeed(Toml, Toml.of({ parse, set, remove }));
