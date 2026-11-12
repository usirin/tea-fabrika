/**
 * File and recorded encodings derived from settings declarations.
 *
 * @stability experimental
 */
import { Schema, Struct } from "effect";
import type * as Setting from "./Setting.ts";

/** The file encoding, with each declaration's own words and encoded default. */
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

/** A complete named record of JSON values. Missing settings never receive defaults here. */
export const values = <A, R extends Record<string, Setting.Setting<any>>>(group: Setting.Group<A, R>) =>
  Schema.Struct(Struct.map(group.settings, json));
