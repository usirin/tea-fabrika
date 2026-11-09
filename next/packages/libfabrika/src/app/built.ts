// The tables one built brain file carries (P16): each program's compiled source with its hash, and
// each window script, chunk and stylesheet with its route. The Node build assembles them and the
// Worker adapters serve them; both read these shapes from here.
import {createHash} from "node:crypto";
import {Effect, Schema} from "effect";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Why a build stopped: its table, the Compiler check, a bundle, or its output. */
export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
	why: Schema.Literals(["table", "compiler", "bundle", "output"]),
	file: Schema.optionalKey(Schema.String),
}) {}

const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

export const BuiltProgram = Schema.Struct({hash: Hash, source: Schema.String}).check(
	Schema.makeFilter((p) => p.hash === sha256(p.source) || "hash does not match source"),
);
export type BuiltProgram = typeof BuiltProgram.Type;

export const AssetType = Schema.Literals([
	"text/javascript; charset=utf-8",
	"text/css; charset=utf-8",
]);
export type AssetType = typeof AssetType.Type;

export const Asset = Schema.Struct({hash: Hash, type: AssetType, body: Schema.String}).check(
	Schema.makeFilter((a) => a.hash === sha256(a.body) || "hash does not match body"),
);
export type Asset = typeof Asset.Type;

/** An HTTP route under the brain's origin: slash-led names, no `.` or `..` segment. */
const ROUTE = /^(?:\/(?!\.\.?(?:\/|$))[\w.-]+)+$/;

export const Built = Schema.Struct({
	// A refined key would drop a bad name or route quietly, so each record checks its keys instead.
	programs: Schema.Record(Schema.String, BuiltProgram).check(
		Schema.makeFilter((programs) => !Object.hasOwn(programs, "") || "a program has no name"),
	),
	assets: Schema.Record(Schema.String, Asset).check(
		Schema.makeFilter(
			(assets) =>
				Object.keys(assets).every((route) => ROUTE.test(route)) || "an asset route is not a path",
		),
	),
});
export type Built = typeof Built.Type;

export const decodeBuilt = Effect.fn("build.decode")(function* (raw: unknown) {
	return yield* Schema.decodeUnknownEffect(Built)(raw).pipe(
		Effect.mapError(() => new BuildError({why: "output"})),
	);
});
