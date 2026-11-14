/**
 * The tables one built brain file carries: each program's compiled source with its hash, and each
 * window script, chunk, stylesheet and tab page with its route. The Node build assembles them and
 * the Worker adapters serve them; both read these shapes from here, so nothing here needs a
 * platform.
 *
 * @stability unstable
 */
import { Effect, Schema, SchemaGetter } from "effect";
import { Digest } from "effect/crypto";
import { ProgramName } from "../packs/ProgramName.ts";

/**
 * Why a build stopped: its `reason` names the phase (`table`, `read`, `compiler`, `bundle`,
 * `publish`).
 *
 * @stability unstable
 * @category errors
 */
export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
  reason: Schema.String,
  message: Schema.optionalKey(Schema.String),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Computes the SHA-256 of a text's UTF-8 bytes, as lowercase hex.
 *
 * @stability unstable
 * @category combinators
 */
export const hash = Effect.fn("build.hash")((text: string) =>
  Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(text))).pipe(
    Effect.provide(Digest.layerWebCrypto),
  ),
);

/**
 * Schema for a code hash: 64 lowercase hex characters, the form `hash` returns.
 *
 * @stability unstable
 * @category schemas
 */
export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

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

/**
 * Schema for one program as the build leaves it: its compiled `source` and the SHA-256 `hash` of
 * that source. Decoding fails when the hash is not the source's own, so one program's hash never
 * sits beside another's source.
 *
 * @stability unstable
 * @category schemas
 */
export const BuiltProgram = hashed(Schema.Struct({ hash: Hash, source: Schema.String }), (p) => p.source);
/**
 * One built program, as `BuiltProgram` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type BuiltProgram = typeof BuiltProgram.Type;

/**
 * Schema for the content types an asset may have: JavaScript, CSS or HTML, each as UTF-8. A tab's
 * page is the HTML one, served at `/` from `/index.html`.
 *
 * @stability unstable
 * @category schemas
 */
export const AssetType = Schema.Literals([
  "text/javascript; charset=utf-8",
  "text/css; charset=utf-8",
  "text/html; charset=utf-8",
]);
/**
 * An asset's content type, as `AssetType` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type AssetType = typeof AssetType.Type;

/**
 * Schema for one file the brain serves to a window: its `body`, its content `type` and the SHA-256
 * `hash` of the body. Decoding fails when the hash is not the body's own.
 *
 * @stability unstable
 * @category schemas
 */
export const Asset = hashed(Schema.Struct({ hash: Hash, type: AssetType, body: Schema.String }), (a) => a.body);
/**
 * One served file, as `Asset` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Asset = typeof Asset.Type;

/** An HTTP route under the brain's origin: slash-led names, no empty, `.` or `..` segment. */
const ROUTE = /^(?:\/(?!\.\.?(?:\/|$))[\w.-]+)+$/;
const isProgramName = Schema.is(ProgramName);

/**
 * Schema for the tables one built brain file carries: `programs` by program name, and `assets` by
 * route.
 *
 * **Details**
 *
 * A program's key must be a `pack/program` name. An asset's key must be a path that starts with a
 * slash and has no empty, `.` or `..` segment. A bad key fails the decode; it is never dropped
 * quietly.
 *
 * @stability unstable
 * @category schemas
 */
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
/**
 * The built tables, as `Built` decodes them.
 *
 * @stability unstable
 * @category models
 */
export type Built = typeof Built.Type;

/**
 * Decodes built tables from outside (disk, a generated module). A bad value fails with a
 * `BuildError` whose reason is `table`.
 *
 * @stability unstable
 * @category combinators
 */
export const decodeBuilt = Effect.fn("build.decode")(function* (raw: unknown) {
  return yield* Schema.decodeUnknownEffect(Built)(raw).pipe(
    Effect.mapError((cause) => new BuildError({ reason: "table", cause })),
  );
});
