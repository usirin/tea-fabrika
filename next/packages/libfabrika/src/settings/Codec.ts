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
