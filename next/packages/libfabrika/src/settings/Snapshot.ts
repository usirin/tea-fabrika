// What one process start used: each declared value as its schema encodes it, keyed by path, where
// each came from, and a hash of the values alone. Paths are sorted before hashing, and origins stay
// out of it, so equal settings have one hash whatever source gave them.
import { Effect, Predicate, Schema } from "effect";
import { Digest } from "effect/crypto";
import type * as Setting from "./Setting.ts";
import { Origin, type Resolved } from "./Sources.ts";

export const Snapshot = Schema.Struct({
  values: Schema.Record(Schema.String, Schema.Json),
  origins: Schema.Record(Schema.String, Origin),
  hash: Schema.String,
});
export type Snapshot = typeof Snapshot.Type;

export const make = Effect.fnUntraced(function* <A>(group: Setting.Group<A>, resolved: Resolved<A>) {
  const record: unknown = resolved.values;
  const values: Record<string, Schema.Json> = {};

  for (const [name, d] of Object.entries(group.settings)) {
    const value = Predicate.isObject(record) ? record[name] : undefined;
    values[d.path] = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(d.schema))(value).pipe(Effect.orDie);
  }

  const sorted = Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1));
  const digest = yield* Digest.Digest;
  const hash = yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(JSON.stringify(sorted)));
  const snapshot: Snapshot = { values, origins: resolved.origins, hash };
  return snapshot;
});
