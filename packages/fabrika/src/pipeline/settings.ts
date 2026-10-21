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
//   [agents.build]                    # one agent step: plan, build or review
//   model = "haiku"
//   effort = "low"
//   usd = 0.5                         # the most one run may cost, in dollars
//
//   [build]
//   go = "plan"                       # what lets a ticket be built: its plan approved (plan), or a label (label)
//   label = "ready-for:agent"         # only with go = "label"
//   install = ["npm", "ci"]           # run once in a fresh copy; [] runs nothing
//   checks = [["npm", "test"]]        # the commands the builder is told to run
//
//   [review]
//   rubrics = "docs/rubrics"          # code.md, doc.md, skill.md, in the repository at its main
//   governed = [".github/"]           # read only when the repository has no .fabrika.jsonc
//   ui = []
//
//   [checks]
//   github = "every"                  # every: each check on GitHub counts. required: only required ones. none: GitHub's do not count
//   [[checks.run]]                    # a command fabrika runs itself at each head, in a copy of it
//   name = "test"
//   run = ["npm", "test"]
//
//   [ship]
//   approval = "codeowners"           # codeowners: CODEOWNERS says whose approval a change needs. none: none needed
//
//   [ledger]
//   at = "local"                      # local: the Durable Object on this machine. sqlite: a node:sqlite file
//
// Three load rules:
// - an empty or missing file changes nothing: every key has a default;
// - an unknown key or table fails, and so does a `[pack."<name>"]` table for a
//   pack `packs` does not list, so a typo is never quietly ignored;
// - a value that does not fit fails, and the message names its key.
//
// Two more, so a pick never says something the run will not do:
// - `build.label` with `build.go = "plan"` fails: the label would be read by nobody;
// - `checks.github = "none"` with no `[[checks.run]]` fails: a change would pass on no check.
//
// The keys of the new tables are left out of `Settings` when the file leaves
// them out: what a left-out key means is picked at the edge, beside what the
// repository holds and what tsh.toml says (./setup.ts), so the run can print
// each named default it chose and why.
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

/** The steps that run an agent, each with its own `[agents.<step>]` table. */
export const AGENT_STEPS = ["plan", "build", "review"] as const;
export type AgentStep = (typeof AGENT_STEPS)[number];

/** How hard an agent thinks. The same three words every agent step takes. */
export const EFFORTS = ["low", "medium", "high"] as const;

const Word = Schema.String.check(Schema.isNonEmpty({message: "an empty word"}));

/** One agent step's table. A key left out is picked at the edge (./setup.ts). */
const Agent = Schema.Struct({
	model: Schema.optionalKey(Word),
	effort: Schema.optionalKey(Schema.Literals(EFFORTS)),
	usd: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
});

/** A command as its words, the program first: run as it is, never by a shell. */
const Command = Schema.NonEmptyArray(Word);

const Build = Schema.Struct({
	go: Schema.optionalKey(Schema.Literals(["plan", "label"])),
	label: Schema.optionalKey(Word),
	/** `[]`: install nothing. */
	install: Schema.optionalKey(Schema.Array(Word)),
	checks: Schema.optionalKey(Schema.Array(Command)),
});

/** A path inside the repository: never out of it, never from the root of the machine. */
const InRepo = Schema.String.check(
	Schema.isPattern(/^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$)).+$/, {
		message: "a path inside the repository, without a leading / or ..",
	}),
);

const Review = Schema.Struct({
	rubrics: Schema.optionalKey(InRepo),
	governed: Schema.optionalKey(Schema.Array(Word)),
	ui: Schema.optionalKey(Schema.Array(Word)),
});

const Check = Schema.Struct({name: Word, run: Command});

const Checks = Schema.Struct({
	github: Schema.optionalKey(Schema.Literals(["every", "required", "none"])),
	run: Schema.optionalKey(Schema.Array(Check)),
});

const Ship = Schema.Struct({approval: Schema.optionalKey(Schema.Literals(["codeowners", "none"]))});

const LedgerAt = Schema.Struct({at: Schema.optionalKey(Schema.Literals(["local", "sqlite"]))});

/** The file as written: `packs` and `pack` filled with their defaults when left out, every other table as written. */
const File = Schema.Struct({
	/** The add-on packs to wire in, by package name. The core names none. */
	packs: Schema.Array(Name).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** Each pack's own settings, by package name. The core reads none of it. */
	pack: Schema.Record(Schema.String, PackTable).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({})),
	),
	agents: Schema.optionalKey(
		Schema.Struct({
			plan: Schema.optionalKey(Agent),
			build: Schema.optionalKey(Agent),
			review: Schema.optionalKey(Agent),
		}),
	),
	build: Schema.optionalKey(Build),
	review: Schema.optionalKey(Review),
	checks: Schema.optionalKey(Checks),
	ship: Schema.optionalKey(Ship),
	ledger: Schema.optionalKey(LedgerAt),
});

/** What fabrika runs by in one repository, as the file says it. */
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

/** Picks the run would not do as written, each said with its key. Pure. */
export function picksThatSayNothing(settings: Settings): readonly string[] {
	const label =
		settings.build?.label !== undefined && (settings.build.go ?? "plan") !== "label"
			? [
					'build.label: read only when build.go = "label"; with go = "plan" the approved plan lets a ticket be built',
				]
			: [];
	const none =
		settings.checks?.github === "none" && (settings.checks.run ?? []).length === 0
			? [
					'checks.github: "none" with no [[checks.run]] would pass a change on no check: add a [[checks.run]], or count GitHub\'s',
				]
			: [];
	return [...label, ...none];
}

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
		const unsaid = [
			...unlisted.map((name) => `${keyOf(["pack", name])}: packs does not list it`),
			...picksThatSayNothing(settings),
		];
		if (unsaid.length > 0) return yield* Effect.fail(invalid(unsaid.join("\n")));
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
