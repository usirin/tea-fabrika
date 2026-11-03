import {Effect, FileSystem, Path, Schema} from "effect";
import {Digest} from "effect/crypto";
import {parse, TomlError} from "smol-toml";
import type {Where} from "../settings-source.ts";
import {SETTINGS_FILE} from "../settings.ts";
import type {Local} from "../setup.ts";
import {cloneIn, urlOf} from "../stages/build/github.ts";
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
//   ship      = "read"                # read: say what ship would do. write: ship for real
//
// A path is taken from the file's own folder, and `~/` is the user's home.
// The values become the defaults of the programs' flags (./fabrika.ts): a flag
// on a line still wins.
//
// model, effort and budget are this machine's fallbacks: the repository's
// fabrika.toml picks its own per agent step (`[agents.<step>]`), and a key it
// leaves out falls back to this file, then to the code's default
// (../setup.ts). `rubrics` here wins over the repository's: it names a folder
// on this machine. Left out, the repository's are read, else the ones
// fabrika ships.
//
// Add-on packs are not here. They depend on the repository, so they are
// listed in its `fabrika.toml` (../settings.ts). A `packs` line or a
// `[pack."<name>"]` table here is refused with a message that says so. When
// this file names a repository, its fabrika.toml is read from that
// repository's default branch (`settingsWhere`, ../settings-source.ts).
//
// There is no `rounds` key: a ticket has no cap on build rounds, and only the
// stall rule (../asks/rules.ts) stops its loop
// (docs/direction/done-is-per-criterion.md). A `rounds` line is refused with a
// message that says so, not dropped.

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
	ship: Schema.optionalKey(Mode),
});

/** Keys that moved to the repository's fabrika.toml: named, so the refusal can say where they went. */
const MOVED = ["packs", "pack"] as const;

/** Keys that are gone, each with why, so an old file is refused with a reason and not a bare "unknown key". */
const GONE = {
	rounds: "there is no round cap; the stall rule stops a loop: remove the rounds line",
} as const;

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
	readonly ship: typeof Mode.Type;
	/**
	 * model, effort, budget and rubrics as the file wrote them, `null` where it
	 * left one out: the fallbacks of this machine, beside the repository's own
	 * picks in fabrika.toml (../setup.ts). The four keys above are the same
	 * values with the code's defaults filled in.
	 */
	readonly said: Local;
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
	ship: "read",
	said: {model: null, effort: null, budget: null, rubrics: null},
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
		if (MOVED.some((key) => Object.hasOwn(raw, key)))
			return yield* Effect.fail(
				invalid(
					`add-on packs moved to ${SETTINGS_FILE}, in the repository fabrika works on: move the packs line and each [pack."<name>"] table there`,
				),
			);
		for (const [key, why] of Object.entries(GONE))
			if (Object.hasOwn(raw, key)) return yield* Effect.fail(invalid(`${key}: ${why}`));
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
			ship: file.ship ?? base.ship,
			said: {
				model: file.model ?? null,
				effort: file.effort ?? null,
				budget: file.budget ?? null,
				rubrics: file.rubrics === undefined ? null : at(file.rubrics),
			},
		} satisfies Config;
	});

/**
 * Where the repository's .fabrika/fabrika.toml is read from. A config that names a
 * repository to work on (`repo`, or only a `clone`): that repository's, from
 * its clone. None: the one in `start`, the root of the folder tsh starts in.
 */
export const settingsWhere = (config: Pick<Config, "repo" | "clone">, start: string): Where =>
	config.clone === null
		? {from: "folder", folder: start}
		: {
				from: "repo",
				target:
					config.repo === null
						? {name: config.clone, clone: config.clone, url: null}
						: {
								name: `${config.repo.owner}/${config.repo.name}`,
								clone: config.clone,
								url: urlOf(config.repo),
							},
			};

/**
 * The node:sqlite file that keeps the ledger for the repository fabrika works on: the
 * one fabrika.toml is read from (`where`, from `settingsWhere`), so two
 * repositories never share a ledger. Under tsh's home, beside the packs'
 * folders:
 *
 *   a repository tsh.toml names      <home>/ledgers/github/<owner>/<name>.sqlite
 *   a folder, or a clone named alone <home>/ledgers/folders/<its last part>-<sha-256 of its path, 12 hex>.sqlite
 *
 * The path's hash tells two folders with one name apart, and keeps the name
 * short however deep the folder is.
 */
export const ledgerFile = (
	home: string,
	where: Where,
): Effect.Effect<string, never, Digest.Digest | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		if (where.from === "repo" && where.target.url !== null)
			return path.join(home, "ledgers", "github", `${where.target.name}.sqlite`);
		const folder = path.resolve(where.from === "repo" ? where.target.clone : where.folder);
		const digest = yield* Digest.Digest;
		const hex = yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(folder));
		const name = `${path.basename(folder)}-${hex.slice(0, 12)}.sqlite`;
		return path.join(home, "ledgers", "folders", name);
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
