import {Effect, FileSystem, Path, Schema, SchemaIssue} from "effect";
import {parse, TomlError} from "smol-toml";

// fabrika.toml: one per repository fabrika works on, at its root
// (docs/direction/one-fabrika-toml-per-repo.md). It holds what differs from
// one repository to the next. The order of the steps stays in code.
//
//   packs = ["@acme/owner-desk"]      # add-on packs, by package name, found where fabrika is installed
//
//   [pack."@acme/owner-desk"]         # one pack's own settings; the pack checks them
//   view = "markdown"
//
// Three load rules:
// - an empty or missing file changes nothing: every key has a default;
// - an unknown key or table fails, and so does a `[pack."<name>"]` table for a
//   pack `packs` does not list, so a typo is never quietly ignored;
// - a value that does not fit fails, and the message names its key.
//
// No machine reads this file. A host reads it once, at the edge, and hands
// each part its values when it is made: the desk its packs (./tsh/desk.ts).
// Which file it reads, a target repository's committed one or the start
// folder's, is ./settings-source.ts.
//
// The first version of this file (legacy/src/settings.ts) had floors and
// limits for the Jev readers, triage and the lane. No step in this package
// decides with any of them yet, so none is here. A knob comes back with the
// step that uses it, and a knob a machine decides with is copied into the run
// when it is filed.

/** The file's name, at the root of the repository. */
export const SETTINGS_FILE = "fabrika.toml";

const Name = Schema.String.check(Schema.isNonEmpty({message: "a pack is named by its package"}));

/** One pack's own table: any keys, which the pack checks itself. */
const PackTable = Schema.Record(Schema.String, Schema.Unknown);

/** The file as written, every key filled with its default when left out. */
const File = Schema.Struct({
	/** The add-on packs to wire in, by package name. The core names none. */
	packs: Schema.Array(Name).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** Each pack's own settings, by package name. The core reads none of it. */
	pack: Schema.Record(Schema.String, PackTable).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({})),
	),
});

/** What fabrika runs by in one repository, every key filled. */
export type Settings = typeof File.Type;

/** Every key at its default: what an empty or missing file means. */
export const DEFAULT_SETTINGS: Settings = Schema.decodeUnknownSync(File)({});

/** A `fabrika.toml` that could not be read, is not TOML, or holds a key or value that does not fit. */
export interface SettingsInvalid {
	readonly _tag: "settings_invalid";
	readonly why: string;
}
const invalid = (why: string): SettingsInvalid => ({_tag: "settings_invalid", why});

const BARE = /^[A-Za-z0-9_-]+$/;
/** A key as TOML writes it: `failure.floor`, `pack."@acme/desk"`, `packs[0]`. */
const keyOf = (path: ReadonlyArray<PropertyKey | {readonly key: PropertyKey}>) =>
	path
		.map((segment) => (typeof segment === "object" ? segment.key : segment))
		.map((key, i) =>
			typeof key === "number"
				? `[${key}]`
				: `${i === 0 ? "" : "."}${BARE.test(String(key)) ? String(key) : JSON.stringify(String(key))}`,
		)
		.join("");

const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: (issue) =>
		issue._tag === "UnexpectedKey" ? "no such key or table" : SchemaIssue.defaultLeafHook(issue),
});
/** Each problem on a line of its own, led by the key it is at. */
const whyOf = (issue: SchemaIssue.Issue) =>
	formatter(issue)
		.issues.map(({message, path}) =>
			path === undefined || path.length === 0 ? message : `${keyOf(path)}: ${message}`,
		)
		.join("\n");

/** A file's text as settings: parsed, then every key and value held to the schema. */
export const settingsFrom = (text: string): Effect.Effect<Settings, SettingsInvalid> =>
	Effect.gen(function* () {
		const raw = yield* Effect.try({
			try: () => parse(text),
			catch: (error) =>
				invalid(error instanceof TomlError ? `not TOML: ${error.message}` : String(error)),
		});
		const settings = yield* Schema.decodeUnknownEffect(File)(raw, {
			onExcessProperty: "error",
		}).pipe(Effect.mapError((error) => invalid(whyOf(error.issue))));
		const unlisted = Object.keys(settings.pack).filter((name) => !settings.packs.includes(name));
		if (unlisted.length > 0)
			return yield* Effect.fail(
				invalid(
					unlisted.map((name) => `${keyOf(["pack", name])}: packs does not list it`).join("\n"),
				),
			);
		return settings;
	});

/** Read the settings at `file`. No file there: every default. */
export const readSettings = (
	file: string,
): Effect.Effect<Settings, SettingsInvalid, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const there = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
		if (!there) return DEFAULT_SETTINGS;
		const text = yield* fs
			.readFileString(file)
			.pipe(Effect.mapError((error) => invalid(`cannot read ${file}: ${error.message}`)));
		return yield* settingsFrom(text).pipe(
			Effect.mapError((error) => invalid(`${file}: ${error.why}`)),
		);
	});

/**
 * The root of the repository `folder` is in: the nearest folder, from it up,
 * that holds `.git` (a folder in a clone, a file in a working copy). Outside
 * any repository: `folder` itself.
 */
export const repoOf = (
	folder: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		let at = path.resolve(folder);
		for (;;) {
			if (yield* fs.exists(path.join(at, ".git")).pipe(Effect.orElseSucceed(() => false)))
				return at;
			const up = path.dirname(at);
			if (up === at) return path.resolve(folder);
			at = up;
		}
	});
