import { Effect, FileSystem, Option, Path, Schema, SchemaIssue } from "effect";
import { parse, TomlError } from "smol-toml";

// .fabrika/fabrika.toml: one per repository fabrika works on
// (docs/direction/one-fabrika-toml-per-repo.md). It holds what differs from
// one repository to the next. The order of the steps stays in code.
//
//   packs = ["@acme/owner-desk"]      # add-on packs, by package name, found where fabrika is installed
//
//   [pack."@acme/owner-desk"]         # one pack's own settings; the pack checks them
//   view = "markdown"
//
//   [agents.build]                    # one agent step: triage, plan, exam, test_writer, build or review
//   harness = "codex"                 # the `pipeline` lane reads this one: codex or claude
//   model = "haiku"
//   effort = "low"
//   usd = 0.5                         # the most one run may cost, in dollars
//
//   [build]
//   install = ["npm", "ci"]           # run once in a fresh copy; [] runs nothing
//   checks = [["npm", "test"]]        # code runs these at the head after every build; the builder is
//                                     # told them too. With {out}, vitest's report names each test that fails
//   checks_within = 2400              # whole seconds each check may run; past it, the checks did not run
//   send_back = true                  # a red head goes back to the builder; false asks a person at once
//
//   [test_writer]
//   includes = ["**/*.test.ts"]       # the patterns a new test file must match
//   run = ["npx", "vitest", "run", "--reporter=json", "--outputFile={out}"]
//   reads = []                        # folders outside the copy its box may read
//
//   [mutation]
//   # the repository's own tests, at a head; with {out}, vitest's report names each test that fails
//   tests = ["npx", "vitest", "run", "--reporter=json", "--outputFile={out}"]
//   typecheck = ["npx", "tsc", "--noEmit"]
//
//   [format]
//   run = ["npx", "prettier", "--write", "{files}"]  # formats files in place; {files}: the paths
//
//   [review]
//   rubrics = "docs/rubrics"        # code.md, doc.md, skill.md, in the repository at its main
//   governed = [".github/"]           # a change under one needs the governance review; read at its base and head
//   ui = []                           # a change under one needs the rendered review; read the same way
//
//   [checks]
//   github = "every"                  # every, or required: ship waits on every check on GitHub, and a failed one sends the work back. none: GitHub's do not count
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
// Four load rules:
// - an empty or missing file changes nothing: every key has a default;
// - an unknown key or table fails, and so does a `[pack."<name>"]` table for a
//   pack `packs` does not list, so a typo is never quietly ignored;
// - `build.go` or `build.label`, keys fabrika no longer reads, fails with one
//   line that says why (`BUILD_GO_GONE`): a ticket is built only once its plan
//   is approved on the ledger, and a label never lets it;
// - a value that does not fit fails, and the message names its key.
//
// One more, so a pick never says something the run will not do:
// - `checks.github = "none"` with no `[[checks.run]]` fails: a change would pass on no check.
//
// The old files never read as "no file, every default". Whatever reads a
// repository (./settings-source.ts, ./stages/pipeline/work.ts) asks
// `settingsRefusal` first:
//
//   .fabrika/fabrika.toml alone      read it
//   beside a .fabrika.jsonc          read it; the jsonc may be today's fabrika
//                                    plugin's (./setup.ts says it is not read)
//   only a .fabrika.jsonc            refused: `JSONC_MOVED`. Its governed folders
//                                    would read as none, with no review owed
//   a fabrika.toml at the root       refused, with the new file there or not:
//                                    `SETTINGS_MOVED`
//   none of them                     every default
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

/** The file, from the root of the repository. It has one spelling. */
export const SETTINGS_FILE = ".fabrika/fabrika.toml";

/** Where the file used to be, from the root of the repository. */
export const OLD_SETTINGS_FILE = "fabrika.toml";

/** What a repository that still holds `OLD_SETTINGS_FILE` fails with, with the new file there or not. */
export const SETTINGS_MOVED = `${OLD_SETTINGS_FILE} moved to ${SETTINGS_FILE}: move it there`;

/** Where the review's two lists used to be, from the root of the repository. */
const JSONC_FILE = ".fabrika.jsonc";

/** What a repository that holds `JSONC_FILE` and no `SETTINGS_FILE` fails with. */
export const JSONC_MOVED = `${JSONC_FILE} moved to [review] in ${SETTINGS_FILE}: move it there`;

/** The paths `settingsRefusal` needs to know about, each at the one place read. */
export const SETTINGS_PATHS = [SETTINGS_FILE, OLD_SETTINGS_FILE, JSONC_FILE] as const;

/**
 * Why a repository that holds `there`, of `SETTINGS_PATHS`, must not be read.
 * `null`: it may. The one rule every reader goes by. Pure.
 */
export const settingsRefusal = (there: ReadonlySet<string>): string | null => {
  if (there.has(OLD_SETTINGS_FILE)) {
    return SETTINGS_MOVED;
  }

  return there.has(JSONC_FILE) && !there.has(SETTINGS_FILE) ? JSONC_MOVED : null;
};

const Name = Schema.String.check(Schema.isNonEmpty({ message: "a pack is named by its package" }));

/** One pack's own table: any keys, which the pack checks itself. */
const PackTable = Schema.Record(Schema.String, Schema.Unknown);

/** The steps that run an agent, each with its own `[agents.<step>]` table. */
export const AGENT_STEPS = ["triage", "plan", "exam", "test_writer", "build", "review"] as const;
export type AgentStep = (typeof AGENT_STEPS)[number];

/** How hard an agent thinks. The same three words every agent step takes. */
export const EFFORTS = ["low", "medium", "high"] as const;

const Word = Schema.String.check(Schema.isNonEmpty({ message: "an empty word" }));

/** One agent step's table. A key left out is picked at the edge (./setup.ts). */
const Agent = Schema.Struct({
  /** Which agent runs the step: `codex` or `claude`. The steps' logic never reads it. */
  harness: Schema.optionalKey(Schema.Literals(["codex", "claude"])),
  model: Schema.optionalKey(Word),
  effort: Schema.optionalKey(Schema.Literals(EFFORTS)),
  usd: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
});

/**
 * How long one of `[build] checks` may run when `checks_within` is left out, in seconds: twice the
 * slowest full test run measured on this repository, about 20 minutes (CI shard "test (3)",
 * 2026-11-02).
 */
export const CHECKS_WITHIN = 2400;

/** A command as its words, the program first: run as it is, never by a shell. */
const Command = Schema.NonEmptyArray(Word);

const Build = Schema.Struct({
  /** `[]`: install nothing. */
  install: Schema.optionalKey(Schema.Array(Word)),
  /**
   * Code runs each at the head after every build, in a copy of it: a build is done only on green.
   * `{out}`: where vitest writes its JSON report, which names each test that fails. The builder is
   * told them without it.
   */
  checks: Schema.optionalKey(Schema.Array(Command)),
  /**
   * How long each of `checks` may run, in whole seconds. One that runs past it is stopped, with all it
   * started, and the checks are not run. Left out: `CHECKS_WITHIN`.
   */
  checks_within: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  /** A head whose own tests fail goes back to the builder, a round at a time. `false`: a person is asked at once. */
  send_back: Schema.optionalKey(Schema.Boolean),
});

const TestWriterTable = Schema.Struct({
  /** The patterns a new test file must match. */
  includes: Schema.optionalKey(Schema.Array(Word)),
  /** Runs the tests on the base, in a box with no login. `{out}`: where it writes vitest's JSON report. */
  run: Schema.optionalKey(Command),
  /** Folders outside the copy the box may read, such as where a linked install stands. */
  reads: Schema.optionalKey(Schema.Array(Word)),
});

const MutationTable = Schema.Struct({
  /** The repository's own tests. `{out}`: where vitest writes its JSON report, which names each test that fails. */
  tests: Schema.optionalKey(Command),
  /** The repository's own typecheck: a mutant it rejects is not counted. */
  typecheck: Schema.optionalKey(Command),
  /** The vitest config, from the repository's root. */
  vitest: Schema.optionalKey(Word),
});

/** The word in a formatter's command that stands for the files it formats. */
export const FILES = "{files}";

/** A formatter's command: the program first, and `{files}` once, as a word of its own after it. */
const FormatCommand = Command.check(
  Schema.makeFilter(
    (words) =>
      (words[0] !== FILES && words.filter((word) => word === FILES).length === 1) ||
      `a command with ${FILES} once, as a word of its own after the program`,
  ),
);
export type FormatCommand = typeof FormatCommand.Type;

/** The repository's formatter. A table with no `run` names none, so `run` is not optional. */
const FormatTable = Schema.Struct({
  /** Formats the files it is given in place, run from the repository's root. */
  run: FormatCommand,
});

/**
 * The formatter's command for `files`, each a path from the repository's root, in place of `{files}`.
 * Each path is led by `./`, so it is a path and nothing else: oxfmt reads a word that starts with `-`
 * as an option, and one that starts with `!` as "every file but this". It takes one file at least: a
 * formatter given no path formats the whole repository. Pure.
 *
 *   formatCommand(["node", "fmt.mjs", "{files}"], ["a.ts", "!b.ts"])   // ["node", "fmt.mjs", "./a.ts", "./!b.ts"]
 */
export const formatCommand = (
  run: FormatCommand,
  files: readonly [string, ...string[]],
): readonly [string, ...string[]] => {
  const [program, ...args] = run;
  const paths = files.map((file) => (file.startsWith("./") ? file : `./${file}`));
  return [program, ...args.flatMap((word) => (word === FILES ? paths : [word]))];
};

/** A path inside the repository: never out of it, never from the root of the machine. */
const InRepo = Schema.String.check(
  Schema.isPattern(/^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$)).+$/, {
    message: "a path inside the repository, without a leading / or ..",
  }),
);

/** Folders and files of the repository, as `[review]` lists them. */
const Paths = Schema.Array(Word);

const Review = Schema.Struct({
  rubrics: Schema.optionalKey(InRepo),
  governed: Schema.optionalKey(Paths),
  ui: Schema.optionalKey(Paths),
});

const Check = Schema.Struct({ name: Word, run: Command });

const Checks = Schema.Struct({
  github: Schema.optionalKey(Schema.Literals(["every", "required", "none"])),
  run: Schema.optionalKey(Schema.Array(Check)),
});

const Ship = Schema.Struct({ approval: Schema.optionalKey(Schema.Literals(["codeowners", "none"])) });

const LedgerAt = Schema.Struct({ at: Schema.optionalKey(Schema.Literals(["local", "sqlite"])) });

/** The file as written: `packs` and `pack` filled with their defaults when left out, every other table as written. */
const File = Schema.Struct({
  /** The add-on packs to wire in, by package name. The core names none. */
  packs: Schema.Array(Name).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** Each pack's own settings, by package name. The core reads none of it. */
  pack: Schema.Record(Schema.String, PackTable).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  agents: Schema.optionalKey(
    Schema.Struct({
      triage: Schema.optionalKey(Agent),
      plan: Schema.optionalKey(Agent),
      exam: Schema.optionalKey(Agent),
      test_writer: Schema.optionalKey(Agent),
      build: Schema.optionalKey(Agent),
      review: Schema.optionalKey(Agent),
    }),
  ),
  build: Schema.optionalKey(Build),
  test_writer: Schema.optionalKey(TestWriterTable),
  mutation: Schema.optionalKey(MutationTable),
  format: Schema.optionalKey(FormatTable),
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

const invalid = (why: string): SettingsInvalid => ({ _tag: "settings_invalid", why });

const BARE = /^[A-Za-z0-9_-]+$/;

/** A key as TOML writes it: `failure.floor`, `pack."@acme/desk"`, `packs[0]`. */
const keyOf = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>) =>
  path
    .map((segment) => (typeof segment === "object" ? segment.key : segment))
    .map((key, i) =>
      typeof key === "number"
        ? `[${key}]`
        : `${i === 0 ? "" : "."}${BARE.test(String(key)) ? String(key) : JSON.stringify(String(key))}`,
    )
    .join("");

const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => (issue._tag === "UnexpectedKey" ? "no such key or table" : SchemaIssue.defaultLeafHook(issue)),
});

/** Each problem on a line of its own, led by the key it is at. */
const whyOf = (issue: SchemaIssue.Issue) =>
  formatter(issue)
    .issues.map(({ message, path }) =>
      path === undefined || path.length === 0 ? message : `${keyOf(path)}: ${message}`,
    )
    .join("\n");

/** What a file that still sets `build.go` or `build.label` fails with: fabrika reads neither any more. */
export const BUILD_GO_GONE =
  "build.go and build.label are gone: a ticket is built once its plan is approved on the ledger";

/**
 * The parsed file still sets `build.go` or `build.label`. Checked before the
 * schema, so the file is told why, not "no such key". Pure.
 */
const setsBuildGo = (raw: Readonly<Record<string, unknown>>): boolean => {
  const build = raw.build;
  return typeof build === "object" && build !== null && ("go" in build || "label" in build);
};

/** Picks the run would not do as written, each said with its key. Pure. */
export function picksThatSayNothing(settings: Settings): readonly string[] {
  return settings.checks?.github === "none" && (settings.checks.run ?? []).length === 0
    ? [
        'checks.github: "none" with no [[checks.run]] would pass a change on no check: add a [[checks.run]], or count GitHub\'s',
      ]
    : [];
}

/** A file's text as settings: parsed, then every key and value held to the schema. */
export const settingsFrom = (text: string): Effect.Effect<Settings, SettingsInvalid> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => parse(text),
      catch: (error) => invalid(error instanceof TomlError ? `not TOML: ${error.message}` : String(error)),
    });

    if (setsBuildGo(raw)) {
      return yield* Effect.fail(invalid(BUILD_GO_GONE));
    }

    const settings = yield* Schema.decodeUnknownEffect(File)(raw, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError((error) => invalid(whyOf(error.issue))));
    const unlisted = Object.keys(settings.pack).filter((name) => !settings.packs.includes(name));
    const unsaid = [
      ...unlisted.map((name) => `${keyOf(["pack", name])}: packs does not list it`),
      ...picksThatSayNothing(settings),
    ];

    if (unsaid.length > 0) {
      return yield* Effect.fail(invalid(unsaid.join("\n")));
    }

    return settings;
  });

/**
 * All the code hosts read of one side of a change: `[review]`'s two lists. Any
 * other key is left alone, so a key this version does not know, at a base
 * written by an older one, does not make the rules unknown. The strict rules
 * are `settingsFrom`'s.
 */
const ReviewRules = Schema.Struct({
  review: Schema.Struct({
    /** A change under one of these needs the governance review. */
    governed: Paths.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
    /** A change under one of these needs the rendered review. */
    ui: Paths.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
});

/** Which reviews a repository's files need, by the two lists of `[review]`. */
export type Rules = (typeof ReviewRules.Type)["review"];

const parseToml = Option.liftThrowable((text: string) => parse(text));
const decodeReviewRules = Schema.decodeUnknownOption(ReviewRules);

/**
 * The rules one side of a change holds, from the text of its file. `null` for
 * the text: no file there, the same as an empty one, so it names none. `null`
 * for the answer: not TOML, or a list that does not fit, so the rules are not
 * known. Pure.
 */
export const reviewRules = (text: string | null): Rules | null =>
  parseToml(text ?? "").pipe(
    Option.flatMap(decodeReviewRules),
    Option.map((file) => file.review),
    Option.getOrNull,
  );

/**
 * Is `file` there? Not there and cannot say are two answers, never one, as in
 * ./git-read.ts. A file where a folder on the way would be: it is not there, as
 * at a commit. Any other error stops the read, naming the path.
 */
export const thereAt = (file: string): Effect.Effect<boolean, SettingsInvalid, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    return yield* (yield* FileSystem.FileSystem).exists(file);
  }).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "BadResource",
      () => Effect.succeed(false),
    ),
    Effect.mapError((error) => invalid(`cannot read ${file}: ${error.message}`)),
  );

/** Read the settings at `file`. No file there: every default. */
export const readSettings = (file: string): Effect.Effect<Settings, SettingsInvalid, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* thereAt(file))) {
      return DEFAULT_SETTINGS;
    }

    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((error) => invalid(`cannot read ${file}: ${error.message}`)));
    return yield* settingsFrom(text).pipe(Effect.mapError((error) => invalid(`${file}: ${error.why}`)));
  });

/**
 * The root of the repository `folder` is in: the nearest folder, from it up,
 * that holds `.git` (a folder in a clone, a file in a working copy). Outside
 * any repository: `folder` itself.
 */
export const repoOf = (folder: string): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    let at = path.resolve(folder);

    for (;;) {
      if (yield* fs.exists(path.join(at, ".git")).pipe(Effect.orElseSucceed(() => false))) {
        return at;
      }

      const up = path.dirname(at);

      if (up === at) {
        return path.resolve(folder);
      }

      at = up;
    }
  });
