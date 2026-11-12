import { StartGrant } from "@kampus/libfabrika/processes/Children";
import { Schema } from "effect";

export const Settings = Schema.Struct({
  name: Schema.NonEmptyString,
  person: Schema.NonEmptyString,
  founder: Schema.NonEmptyString,
  window: Schema.NullOr(Schema.String),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  build: Schema.NonEmptyString,
  mail: Schema.optionalKey(Schema.Struct({ grants: Schema.Record(Schema.String, Schema.Array(Schema.String)) })),
  limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Int.check(Schema.isGreaterThan(0)) })),
  /** Which program may start which (P42): a right the host hands in, never a declared setting. */
  starts: Schema.optionalKey(Schema.Array(StartGrant)),
});
export type Settings = typeof Settings.Type;
