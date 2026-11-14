// What one process start used: each declared value as its schema encodes it, keyed by path, where
// each came from, and a hash of the values alone. Paths are sorted before hashing, and origins stay
// out of it, so equal settings have one hash whatever source gave them.
import { Effect, Option, Predicate, Record as Rec, Redacted, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Codec from "./Codec.ts";
import type * as Setting from "./Setting.ts";
import { Origin, type Resolved } from "./Sources.ts";

export const Snapshot = Schema.Struct({
  values: Schema.Record(Schema.String, Schema.Json),
  origins: Schema.Record(Schema.String, Origin),
  hash: Schema.String,
});
export type Snapshot = typeof Snapshot.Type;

/** Invalid saved settings, with input-bearing decoder details kept only in a redacted cause. */
export class SnapshotError extends Schema.TaggedError<SnapshotError>()("SnapshotError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const hashValues = Effect.fnUntraced(function* (values: Snapshot["values"]) {
  const sorted = Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1));
  const text = JSON.stringify(sorted, (_key, value: unknown) =>
    Predicate.isObject(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value,
  );
  const digest = yield* Digest.Digest;
  return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(text));
});

const declaredOrigin = (declaration: Setting.Setting<unknown>) =>
  Origin.check(
    Schema.makeFilter((origin: Origin) => {
      if (origin._tag === "flag") {
        return origin.name === `--${declaration.path}`;
      }

      if (origin._tag === "env") {
        return origin.name === declaration.env;
      }

      if (origin._tag === "file") {
        const file = origin.file;
        return (
          file.length > 0 &&
          !/^(?:[\\/]|[A-Za-z]:)/.test(file) &&
          (!file.startsWith("~") || file === "~" || file.startsWith("~/")) &&
          (!file.startsWith("$") || file === "$FABRIKA_HOME" || file.startsWith("$FABRIKA_HOME/"))
        );
      }

      return true;
    }),
  );

export const make = Effect.fnUntraced(function* <A, R extends Record<string, Setting.Setting<any>>>(
  group: Setting.Group<A, R>,
  resolved: Resolved<A>,
) {
  const encoded: Snapshot["values"] = yield* Schema.encodeUnknownEffect(Codec.values(group))(resolved.values).pipe(
    Effect.orDie,
  );
  const values = Object.fromEntries(
    Object.entries(group.settings).map(([name, d]) => [d.path, Option.getOrThrow(Rec.get(encoded, name))]),
  );
  const snapshot: Snapshot = {
    values,
    origins: Schema.decodeUnknownSync(Schema.Record(Schema.String, Origin))(resolved.origins),
    hash: yield* hashValues(values),
  };
  return snapshot;
});

/** Check all declared keys and values, canonicalize their encoding, and verify the values-only hash. */
export const read = Effect.fnUntraced(function* <A, R extends Record<string, Setting.Setting<any>>>(
  group: Setting.Group<A, R>,
  input: unknown,
) {
  const strict = { onExcessProperty: "error" } as const;
  const paths = group.declarations.map((d) => d.path);
  const fields = <S extends Schema.Top>(schema: S) =>
    paths.length === 0
      ? Schema.Record(Schema.String, Schema.Never)
      : Schema.Struct(Object.fromEntries(paths.map((path) => [path, schema])));
  const origins =
    paths.length === 0
      ? fields(Origin)
      : Schema.Struct(Object.fromEntries(group.declarations.map((d) => [d.path, declaredOrigin(d)])));
  const envelope = Schema.Struct({ values: fields(Schema.Json), origins, hash: Schema.String });
  const refused = (cause: unknown) =>
    new SnapshotError({
      message: "The saved settings are invalid.",
      cause: Redacted.make(cause),
    });
  const saved = yield* Schema.decodeUnknownEffect(envelope)(input, strict).pipe(Effect.mapError(refused));
  const codec = Codec.values(group);
  const named = Object.fromEntries(Object.entries(group.settings).map(([name, d]) => [name, saved.values[d.path]]));
  const values = yield* Schema.decodeUnknownEffect(codec)(named, strict).pipe(Effect.mapError(refused));
  const encoded: Snapshot["values"] = yield* Schema.encodeEffect(codec)(values).pipe(Effect.mapError(refused));
  const canonical = Object.fromEntries(
    Object.entries(group.settings).map(([name, d]) => [d.path, Option.getOrThrow(Rec.get(encoded, name))]),
  );
  const hash = yield* hashValues(canonical);

  if (saved.hash !== hash) {
    return yield* new SnapshotError({ message: "The saved settings hash does not match their values." });
  }

  const snapshot: Snapshot = { values: canonical, origins: saved.origins, hash };
  return { values, snapshot };
});
