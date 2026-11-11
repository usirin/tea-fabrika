// The Toml service on toml-eslint-parser 1.0.3, the one file that imports the parser (L15). The
// parser gives values and node locations; this file turns them into segment paths and lines.
import { Effect, Layer } from "effect";
import { type AST, getStaticTOMLValue, ParseError, parseTOML } from "toml-eslint-parser";
import { Toml, type TomlDocument, TomlError } from "./Toml.ts";

type Span = TomlDocument["spans"][number];

/** A key/value's span, and those of an inline table's keys under it. */
const pair = (table: ReadonlyArray<string>, node: AST.TOMLKeyValue): Array<Span> => {
  const path = [...table, ...getStaticTOMLValue(node.key)];
  const inner = node.value.type === "TOMLInlineTable" ? node.value.body.flatMap((kv) => pair(path, kv)) : [];
  return [{ path, line: node.loc.start.line }, ...inner];
};

const spans = (program: AST.TOMLProgram): Array<Span> =>
  program.body[0].body.flatMap((node) => {
    if (node.type === "TOMLKeyValue") {
      return pair([], node);
    }

    const path = node.resolvedKey.map(String);
    return [{ path, line: node.loc.start.line }, ...node.body.flatMap((kv) => pair(path, kv))];
  });

export const layer = Layer.succeed(
  Toml,
  Toml.of({
    parse: (text) =>
      Effect.try({
        try: () => parseTOML(text),
        catch: (cause) =>
          new TomlError({
            message: cause instanceof Error ? cause.message : "The TOML could not be read.",
            line: cause instanceof ParseError ? cause.lineNumber : 1,
            cause,
          }),
      }).pipe(Effect.map((program) => ({ value: getStaticTOMLValue(program), spans: spans(program) }))),
  }),
);
