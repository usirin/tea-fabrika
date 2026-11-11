// The tables one built brain file carries (P16): each program's compiled source with its hash, and
// each window script, chunk and stylesheet with its route. The Node build assembles them and the
// Worker adapters serve them; both read these shapes from here, so nothing here needs a platform.
import { Effect, Schema, SchemaGetter } from "effect";
import { Digest } from "effect/crypto";
import { ProgramName } from "../packs/ProgramName.ts";

/** Why a build stopped: its `reason` names the phase (`table`, `read`, `compiler`, `bundle`, `publish`). */
export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
  reason: Schema.String,
  message: Schema.optionalKey(Schema.String),
}) {}

/** The SHA-256 of a text's UTF-8 bytes, as lowercase hex. */
export const hash = Effect.fn("build.hash")((text: string) =>
  Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(text))).pipe(
    Effect.provide(Digest.layerWebCrypto),
  ),
);

const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

// A decoded value's hash must be its text's own: one program's hash beside another's source fails.
const hashed = <S extends Schema.Struct<{ readonly hash: typeof Hash }>>(
  schema: S,
  text: (value: S["Type"]) => string,
) =>
  schema.pipe(
    Schema.decode({
      decode: SchemaGetter.checkEffect((value: S["Type"]) =>
        hash(text(value)).pipe(Effect.map((digest) => digest === value.hash || "hash does not match its text")),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );

export const BuiltProgram = hashed(Schema.Struct({ hash: Hash, source: Schema.String }), (p) => p.source);
export type BuiltProgram = typeof BuiltProgram.Type;

export const AssetType = Schema.Literals(["text/javascript; charset=utf-8", "text/css; charset=utf-8"]);
export type AssetType = typeof AssetType.Type;

export const Asset = hashed(Schema.Struct({ hash: Hash, type: AssetType, body: Schema.String }), (a) => a.body);
export type Asset = typeof Asset.Type;

/** An HTTP route under the brain's origin: slash-led names, no empty, `.` or `..` segment. */
const ROUTE = /^(?:\/(?!\.\.?(?:\/|$))[\w.-]+)+$/;
const isProgramName = Schema.is(ProgramName);

export const Built = Schema.Struct({
  // A refined key would drop a bad name or route quietly, so each record checks its keys instead.
  programs: Schema.Record(Schema.String, BuiltProgram).check(
    Schema.makeFilter(
      (programs) => Object.keys(programs).every(isProgramName) || "a program's name is not `pack/program`",
    ),
  ),
  assets: Schema.Record(Schema.String, Asset).check(
    Schema.makeFilter(
      (assets) => Object.keys(assets).every((route) => ROUTE.test(route)) || "an asset route is not a path",
    ),
  ),
});
export type Built = typeof Built.Type;

/** Built tables from outside (disk, a generated module): a bad value is BuildError `table`. */
export const decodeBuilt = Effect.fn("build.decode")(function* (raw: unknown) {
  return yield* Schema.decodeUnknownEffect(Built)(raw).pipe(Effect.mapError(() => new BuildError({ reason: "table" })));
});
