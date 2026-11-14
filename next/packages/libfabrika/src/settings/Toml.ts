// The settings module's TOML service. It owns key positions; a Layer such as TomlParser.layer owns
// the grammar.
import type { Effect } from "effect";
import { Context, Schema } from "effect";

export interface TomlDocument {
  /** The document's values, as plain tables. */
  readonly value: Readonly<Record<string, unknown>>;
  /**
   * One entry per key/value and per table header: the key's segments and the line it starts on,
   * from 1. `"a.b" = 1` is `["a.b"]`; `a.b = 1` is `["a", "b"]`.
   */
  readonly spans: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly line: number }>;
}

export class Syntax extends Schema.TaggedError<Syntax>()("Syntax", {
  cause: Schema.Defect(),
}) {}

export class Value extends Schema.TaggedError<Value>()("Value", {
  cause: Schema.Defect(),
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  path: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

export class TomlError extends Schema.TaggedError<TomlError>()("TomlError", {
  reason: Schema.Union([Syntax, Value, Conflict]),
  message: Schema.String,
  line: Schema.Int,
  cause: Schema.Defect(),
}) {}

export class Toml extends Context.Service<
  Toml,
  {
    readonly parse: (text: string) => Effect.Effect<TomlDocument, TomlError>;
    readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Effect.Effect<string, TomlError>;
    readonly remove: (text: string, path: ReadonlyArray<string>) => Effect.Effect<string, TomlError>;
  }
>()("@kampus/libfabrika/settings/Toml") {}
