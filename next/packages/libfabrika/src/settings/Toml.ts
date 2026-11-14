/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * The settings module's TOML service. It owns key positions; a Layer such as `TomlParser.layer` owns the grammar.
 *
 * @stability unstable
 */
import type { Effect } from "effect";
import { Context, Schema } from "effect";

/**
 * A parsed TOML document: its values, and where each key and table header starts.
 *
 * @stability unstable
 * @category models
 */
export interface TomlDocument {
  /** The document's values, as plain tables. */
  readonly value: Readonly<Record<string, unknown>>;
  /**
   * One entry per key/value and per table header: the key's segments and the line it starts on,
   * from 1. `"a.b" = 1` is `["a.b"]`; `a.b = 1` is `["a", "b"]`.
   */
  readonly spans: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly line: number }>;
}

/**
 * The text is not valid TOML.
 *
 * @stability unstable
 * @category errors
 */
export class Syntax extends Schema.TaggedError<Syntax>()("Syntax", {
  cause: Schema.Defect(),
}) {}

/**
 * A value cannot be written as TOML.
 *
 * @stability unstable
 * @category errors
 */
export class Value extends Schema.TaggedError<Value>()("Value", {
  cause: Schema.Defect(),
}) {}

/**
 * The path of a `set` or `remove` does not name an editable setting, such as a path through a value that is not a table.
 *
 * @stability unstable
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  path: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

/**
 * Error for a failed TOML operation, with the line it concerns.
 *
 * **Details**
 *
 * `reason` is `Syntax` when the text does not parse, `Value` when a value to write is not TOML, and `Conflict` when the path does not name an editable setting. A syntax error carries the parser's line, and a value error always says line 1.
 *
 * @stability unstable
 * @category errors
 */
export class TomlError extends Schema.TaggedError<TomlError>()("TomlError", {
  reason: Schema.Union([Syntax, Value, Conflict]),
  message: Schema.String,
  line: Schema.Int,
  cause: Schema.Defect(),
}) {}

/**
 * Service for reading and editing TOML text.
 *
 * **Details**
 *
 * `parse` returns the document. `set` and `remove` return the edited text, and the result is parsed again before it is returned.
 *
 * @stability unstable
 * @category services
 */
export class Toml extends Context.Service<
  Toml,
  {
    readonly parse: (text: string) => Effect.Effect<TomlDocument, TomlError>;
    readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Effect.Effect<string, TomlError>;
    readonly remove: (text: string, path: ReadonlyArray<string>) => Effect.Effect<string, TomlError>;
  }
>()("@kampus/libfabrika/settings/Toml") {}
