import { StartGrant } from "@kampus/libfabrika/processes/Children";
import { gatewayLimit, gatewayWindow, recovery, storage, writes } from "@kampus/libfabrika/settings/Declarations";
import { Schema } from "effect";

/** The declared quota settings, checked by their own schemas. */
export const Quotas = Schema.Struct({ writes: writes.schema, storage: storage.schema, recovery: recovery.schema });

export const Settings = Schema.Struct({
  name: Schema.NonEmptyString,
  person: Schema.NonEmptyString,
  founder: Schema.NonEmptyString,
  window: Schema.NullOr(Schema.String),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  build: Schema.NonEmptyString,
  rateLimit: Schema.Struct({ limit: gatewayLimit.schema, window: gatewayWindow.schema }),
  mail: Schema.optionalKey(Schema.Struct({ grants: Schema.Record(Schema.String, Schema.Array(Schema.String)) })),
  // The quota values ride as each declared schema encodes them, so `INSTANCE` is plain JSON. The
  // Worker checks them with those schemas and has no value of its own to fall back on.
  limits: Schema.optionalKey(
    Schema.Struct({
      recordBytes: Schema.Int.check(Schema.isGreaterThan(0)),
      writes: Schema.toEncoded(writes.schema),
      storage: Schema.toEncoded(storage.schema),
      recovery: Schema.toEncoded(recovery.schema),
    }),
  ),
  /** Which program may start which (P42): a right the host hands in, never a declared setting. */
  starts: Schema.optionalKey(Schema.Array(StartGrant)),
});
export type Settings = typeof Settings.Type;
