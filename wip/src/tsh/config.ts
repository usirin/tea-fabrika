import {Effect, FileSystem, Path, Schema} from "effect";
import {parse, TomlError} from "smol-toml";
import {cloneIn} from "../stages/build/github.ts";
import {DEFAULT_BUDGET, DEFAULT_EFFORT, DEFAULT_MODEL, EFFORTS} from "../stages/review/reviewer.ts";

// The settings fabrika's tsh reads for one repository, from one file:
// `tsh.toml` in the folder tsh is started in. Every key may be left out, and a
// missing file is every default. An unknown key, or a value that does not
// fit, is refused when the file is read, so a typo is never quietly ignored.
//
//   repo      = "acme/widgets"        # the repository this file is for
//   work      = "~/fabrika/work"      # where clones and working copies go
//   rubrics   = "rubrics"             # code.md, doc.md, skill.md for review
//   own       = ["a-bot", "a-person"] # accounts whose pull requests ship may merge
//   reviewers = ["a-person"]          # accounts whose review verdicts count (own when left out)
//   model     = "opus"
//   effort    = "medium"
//   budget    = 2                     # dollars, one builder or one reviewer run
//   rounds    = 3                     # build rounds per ticket, 1 to 5
//   ship      = "read"                # read: say what ship would do. write: ship for real
//   packs     = ["@acme/owner-desk"]  # add-on packs, by package name (../asks/packs.ts)
//
//   [pack."@acme/owner-desk"]         # one pack's own settings; the pack checks them
//   view = "markdown"
//
// A path is taken from the file's own folder, and `~/` is the user's home.
// The values become the defaults of the programs' flags (./fabrika.ts): a flag
// on a line still wins.

/** The file's name, in the folder tsh is started in. */
export const CONFIG_FILE = "tsh.toml";

const Mode = Schema.Literals(["read", "write"]);

/** The file as written: every key may be left out, and no other key may be there. */
const File = Schema.Struct({
	repo: Schema.optionalKey(
		Schema.String.check(
			Schema.isPattern(/^[\w.-]+\/[\w.-]+$/, {message: "repo is <owner>/<name>"}),
		),
	),
	work: Schema.optionalKey(Schema.String),
	clone: Schema.optionalKey(Schema.String),
	rubrics: Schema.optionalKey(Schema.String),
	own: Schema.optionalKey(Schema.Array(Schema.String)),
	reviewers: Schema.optionalKey(Schema.Array(Schema.String)),
	model: Schema.optionalKey(Schema.String),
	effort: Schema.optionalKey(Schema.Literals(EFFORTS)),
	budget: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
	rounds: Schema.optionalKey(Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 5}))),
	ship: Schema.optionalKey(Mode),
	packs: Schema.optionalKey(Schema.Array(Schema.String)),
	pack: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/** What tsh runs by, every key filled. */
export interface Config {
	/** The repository the file is for. `null`: none named. */
	readonly repo: {readonly owner: string; readonly name: string} | null;
	/** Where build and operate keep their clones and working copies, one folder per repository. */
	readonly work: string;
	/** A clone the live `review` reads code from: the file's, else the clone build makes of `repo`. `null`: no live review. */
	readonly clone: string | null;
	readonly rubrics: string;
	readonly own: readonly string[];
	readonly reviewers: readonly string[];
	readonly model: string;
	readonly effort: (typeof EFFORTS)[number];
	readonly budget: number;
	readonly rounds: number;
	readonly ship: typeof Mode.Type;
	/** The add-on packs to wire in, by package name, found from the file's folder (../asks/packs.ts). The core names none. */
	readonly packs: readonly string[];
	/** Each pack's own settings, by package name. Each pack checks its own; the core reads none of it. */
	readonly pack: Readonly<Record<string, unknown>>;
}

/** Where paths are taken from: tsh's home, and the user's. */
export interface Places {
	/** tsh's home (`TSH_HOME`, or `~/.tsh`). */
	readonly home: string;
	/** The user's home, for `~/`. */
	readonly user: string;
}

/** Every key at its default: what a missing file means. */
export const defaultConfig = (home: string): Config => ({
	repo: null,
	work: `${home}/work`,
	clone: null,
	rubrics: `${home}/rubrics`,
	own: [],
	reviewers: [],
	model: DEFAULT_MODEL,
	effort: DEFAULT_EFFORT,
	budget: DEFAULT_BUDGET,
	rounds: 3,
	ship: "read",
	packs: [],
	pack: {},
});

/** A `tsh.toml` that could not be read, is not TOML, or holds a key or value that does not fit. */
export interface ConfigInvalid {
	readonly _tag: "config_invalid";
	readonly why: string;
}
const invalid = (why: string): ConfigInvalid => ({_tag: "config_invalid", why});

/** A file's text as a config: parsed, held to the schema, its paths taken from `folder`. */
export const configFrom = (
	text: string,
	folder: string,
	places: Places,
): Effect.Effect<Config, ConfigInvalid, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const raw = yield* Effect.try({
			try: () => parse(text),
			catch: (error) =>
				invalid(error instanceof TomlError ? `not TOML: ${error.message}` : String(error)),
		});
		const file = yield* Schema.decodeUnknownEffect(File)(raw, {onExcessProperty: "error"}).pipe(
			Effect.mapError((error) => invalid(error.message)),
		);
		const at = (written: string) =>
			written.startsWith("~/")
				? path.join(places.user, written.slice(2))
				: path.resolve(folder, written);
		const base = defaultConfig(places.home);
		const [owner, name] = file.repo?.split("/") ?? [];
		const repo = owner !== undefined && name !== undefined ? {owner, name} : null;
		const work = file.work === undefined ? base.work : at(file.work);
		const own = file.own ?? base.own;
		return {
			repo,
			work,
			clone: file.clone !== undefined ? at(file.clone) : repo === null ? null : cloneIn(work, repo),
			rubrics: file.rubrics === undefined ? base.rubrics : at(file.rubrics),
			own,
			reviewers: file.reviewers ?? own,
			model: file.model ?? base.model,
			effort: file.effort ?? base.effort,
			budget: file.budget ?? base.budget,
			rounds: file.rounds ?? base.rounds,
			ship: file.ship ?? base.ship,
			packs: file.packs ?? base.packs,
			pack: file.pack ?? base.pack,
		} satisfies Config;
	});

/** Read the config at `file`. No file there: every default. */
export const readConfig = (
	file: string,
	places: Places,
): Effect.Effect<Config, ConfigInvalid, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const there = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
		if (!there) return defaultConfig(places.home);
		const text = yield* fs
			.readFileString(file)
			.pipe(Effect.mapError((error) => invalid(`cannot read ${file}: ${error.message}`)));
		return yield* configFrom(text, path.dirname(file), places).pipe(
			Effect.mapError((error) => invalid(`${file}: ${error.why}`)),
		);
	});
