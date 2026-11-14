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
 * File and recorded encodings derived from settings declarations.
 *
 * @stability experimental
 */
import { Schema, Struct } from "effect";
import type * as Setting from "./Setting.ts";

/**
 * Builds the codec a settings file uses to read and write one declaration.
 *
 * **Details**
 *
 * A `text` declaration decodes through Effect's string-tree codec, so a file holds its text spelling. Any other declaration decodes through the JSON codec. The result carries the declaration's `doc` as the encoded description and its default, encoded, as the encoded default, so the editor's JSON Schema can show both.
 *
 * @stability unstable
 * @category constructors
 */
export const file = <A>(declaration: Setting.Setting<A>) => {
  const codec =
    declaration.format === "text"
      ? Schema.toCodecStringTree(declaration.schema)
      : Schema.toCodecJson(declaration.schema);
  return codec.pipe(
    Schema.annotateEncoded({
      description: declaration.doc,
      default: Schema.encodeSync(codec)(declaration.default),
    }),
  );
};

interface Json extends Struct.Lambda {
  <D extends Setting.Setting<unknown>>(declaration: D): Schema.toCodecJson<D["schema"]>;
  readonly "~lambda.out": this["~lambda.in"] extends Setting.Setting<unknown>
    ? Schema.toCodecJson<this["~lambda.in"]["schema"]>
    : never;
}

const json = Struct.lambda<Json>((declaration) => Schema.toCodecJson(declaration.schema));

/**
 * Builds the schema of a recorded group: a struct with one JSON-encoded field per setting, named as in the group's record.
 *
 * **Gotchas**
 *
 * Every setting is required. A missing one is a decode failure, and this schema never fills in a default.
 *
 * @stability unstable
 * @category constructors
 */
export const values = <A, R extends Record<string, Setting.Setting<any>>>(group: Setting.Group<A, R>) =>
  Schema.Struct(Struct.map(group.settings, json));
