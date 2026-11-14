/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
