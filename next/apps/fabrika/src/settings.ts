import { gatewayLimit, gatewayWindow } from "@kampus/libfabrika/settings/Declarations";
import { Schema } from "effect";

export const Settings = Schema.Struct({
  name: Schema.NonEmptyString,
  person: Schema.NonEmptyString,
  founder: Schema.NonEmptyString,
  window: Schema.NullOr(Schema.String),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  build: Schema.NonEmptyString,
  rateLimit: Schema.Struct({ limit: gatewayLimit.schema, window: gatewayWindow.schema }),
  mail: Schema.optionalKey(Schema.Struct({ grants: Schema.Record(Schema.String, Schema.Array(Schema.String)) })),
  limits: Schema.optionalKey(Schema.Struct({ recordBytes: Schema.Int.check(Schema.isGreaterThan(0)) })),
});
export type Settings = typeof Settings.Type;
