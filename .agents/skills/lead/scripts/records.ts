// records.ts: lists one folder of records as it is on origin/main, one line per record, and for the
// numbered folders gives the next free number (decision 0522). Today's lead tooling, run on our own
// laptop; it is not product. No folder keeps an index table, so this is the list a table was.
//
//   node records.ts list <folder>   one line per record, then `next NNNN` for a numbered folder
//   node records.ts next <folder>   only the next free number
//
// <folder> is `.decisions`, `experiments`, `.patterns` or `docs/direction`, with or without a
// trailing slash. It runs in the checkout it is started in.
//
// It fetches origin's main first, then reads `origin/main` through git (`ls-tree`, `cat-file`),
// never the working tree, so a file that is only local or only on an unmerged branch never takes a
// number or a line. The next number is the highest on main plus one, never a gap below it: a gap
// is a number some pull request held and never merged, as phoenix's `fabrika adr next` says. An
// open pull request can still hold the same number; the adr skill's check of open pull requests
// covers that.
//
// Each record says what it is at its own top. A decision's frontmatter gives `title` and `status`.
// The other three folders keep a small frontmatter block of their own, read with the file's `# `
// heading as the title:
//
//   experiments/NN-title.md    date, scripts (only when the write-up does not name them), summary
//   .patterns/name.md          where, when
//   docs/direction/name.md     state (when it has one), summary; a subfolder's README.md is a record
//
// A value is one line: plain, or a JSON string in double quotes. A record whose block lacks a key
// prints `(no <key>)`, so a missing top shows instead of hiding.
//
// Exit 0 with an answer. Exit 1 when origin/main cannot be fetched or read: it prints that the list
// is unknown, never "0 records" and never a next number. Exit 2 when the command line is wrong.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, Option, Predicate, Schema, Stream } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess } from "effect/process";

/** The ref every answer is read from. */
const BASE = "origin/main";

/** The four folders of records. */
export type Folder = ".decisions" | "experiments" | ".patterns" | "docs/direction";

/** How one folder's records say what they are. */
type Spec = {
  /** The digits a number pads to, for a numbered folder; `undefined` for a folder with no numbers. */
  readonly width: number | undefined;
  /** Where the title comes from: the frontmatter's `title`, or the file's `# ` heading. */
  readonly title: "frontmatter" | "heading";
  /** Frontmatter keys printed bare, before the title. */
  readonly before: ReadonlyArray<string>;
  /** Frontmatter keys printed as `key: value`, after the title. */
  readonly after: ReadonlyArray<string>;
  /** Keys of `after` left out when a record has none, as a note with no state. */
  readonly optional: ReadonlyArray<string>;
  /** Whether a subfolder's own README.md is a record too. */
  readonly nested: boolean;
};

const specs: Record<Folder, Spec> = {
  ".decisions": { width: 4, title: "frontmatter", before: ["status"], after: [], optional: [], nested: false },
  experiments: { width: 2, title: "heading", before: ["date"], after: ["summary"], optional: [], nested: false },
  ".patterns": { width: undefined, title: "heading", before: ["where"], after: ["when"], optional: [], nested: false },
  "docs/direction": {
    width: undefined,
    title: "heading",
    before: [],
    after: ["state", "summary"],
    optional: ["state"],
    nested: true,
  },
};

const recordNumber = (name: string): number | undefined => {
  const digits = /^(\d+)[a-z]?-/.exec(name)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/**
 * Whether a path from the top of the repo is one of the folder's records: a Markdown file in it
 * that is not its README, or, in a nested folder, a subfolder's README.
 */
export const isRecord = (folder: Folder, path: string): boolean => {
  if (!path.startsWith(`${folder}/`) || !path.endsWith(".md")) {
    return false;
  }

  const parts = path.slice(folder.length + 1).split("/");

  if (parts.length === 1) {
    return parts[0] !== "README.md" && (folder !== ".decisions" || recordNumber(parts[0] ?? "") !== undefined);
  }

  return specs[folder].nested && parts.length === 2 && parts[1] === "README.md";
};

/** What a record's top says: its frontmatter keys, and its first `# ` heading. */
type Top = { readonly fields: ReadonlyMap<string, string>; readonly heading: string | undefined };

const JsonString = Schema.fromJsonString(Schema.String);

const unquoted = (raw: string): string =>
  raw.startsWith('"') ? Option.getOrElse(Schema.decodeUnknownOption(JsonString)(raw), () => raw) : raw;

/** Reads a record's top: a frontmatter block when the text opens with one, then the first heading. */
export const readTop = (text: string): Top => {
  const lines = text.split("\n");
  const fields = new Map<string, string>();
  let rest = lines;

  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);

    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const pair = /^([a-z]+):\s*(.*)$/.exec(line);

        if (pair?.[1] !== undefined && pair[2] !== undefined) {
          fields.set(pair[1], unquoted(pair[2].trim()));
        }
      }

      rest = lines.slice(end + 1);
    }
  }

  const heading = rest
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  return { fields, heading };
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

// A heading often repeats the record's number: "# 286. Can ...", "# 153: Codex ...", "# Experiment 176: ...".
const withoutNumber = (heading: string) => heading.replace(/^(experiment\s+)?\d+[a-z]?[.:]\s+/i, "");

/** The line a record prints: its id, the bare keys, its title, then the `key: value` keys. */
export const recordLine = (folder: Folder, path: string, text: string): string => {
  const spec = specs[folder];
  const top = readTop(text);
  const name = path.slice(folder.length + 1).replace(/\.md$/, "");
  const id = spec.width === undefined ? name : (/^\d+[a-z]?(?=-)/.exec(name)?.[0] ?? name);
  const field = (key: string) => {
    const value = top.fields.get(key);
    return value === undefined ? `(no ${key})` : oneLine(value);
  };
  const title =
    spec.title === "frontmatter"
      ? top.fields.get("title")
      : top.heading === undefined
        ? undefined
        : withoutNumber(top.heading);
  return [
    id,
    ...spec.before.map(field),
    title === undefined ? "(no title)" : oneLine(title),
    ...spec.after
      .filter((key) => top.fields.has(key) || !spec.optional.includes(key))
      .map((key) => `${key}: ${field(key)}`),
  ].join("  ");
};

/**
 * The next free number in a numbered folder, padded: the highest number among these paths plus one.
 * `undefined` for a folder with no numbers. The paths are a read that succeeded, so none means 1.
 */
export const nextNumber = (folder: Folder, paths: ReadonlyArray<string>): string | undefined => {
  const width = specs[folder].width;

  if (width === undefined) {
    return undefined;
  }

  const numbers = paths
    .filter((path) => isRecord(folder, path))
    .map((path) => recordNumber(path.slice(folder.length + 1)))
    .filter((n) => n !== undefined);
  return String(Math.max(0, ...numbers) + 1).padStart(width, "0");
};

/**
 * The folder's records among these paths, in the order a reader expects: by number in a numbered
 * folder, so 65 comes before 203 and a record with no number after them, then by name.
 */
export const inOrder = (folder: Folder, paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths
    .filter((path) => isRecord(folder, path))
    .map((path) => ({ path, number: recordNumber(path.slice(folder.length + 1)) ?? Infinity }))
    .sort((a, b) => a.number - b.number || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((r) => r.path);

// ---------------------------------------------------------------- the world

/** origin/main could not be fetched or read, so the list and the next number are unknown. */
class Unknown extends Schema.TaggedError<Unknown>()("Unknown", { reason: Schema.String }) {}

/** `next` was asked of a folder whose records have no numbers. */
class NoNumbers extends Schema.TaggedError<NoNumbers>()("NoNumbers", { folder: Schema.String }) {}

const collected = (chunks: ReadonlyArray<Uint8Array>) => {
  const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }

  return bytes;
};

const git = Effect.fnUntraced(
  function* (repo: string, args: ReadonlyArray<string>, stdin?: string) {
    const handle = yield* ChildProcess.make("git", ["-C", repo, ...args], {
      stdin: stdin === undefined ? "ignore" : Stream.make(new TextEncoder().encode(stdin)),
    });
    const [out, err, code] = yield* Effect.all(
      [Stream.runCollect(handle.stdout), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
      { concurrency: 3 },
    );
    return { out: collected(out), err: err.trim(), code: Number(code) };
  },
  Effect.scoped,
  (effect) => Effect.mapError(effect, (e) => new Unknown({ reason: `git could not run: ${e.message}` })),
);

/** Splits `git cat-file --batch` output into each object's text, in the order asked. */
export const batchTexts = (bytes: Uint8Array): ReadonlyArray<string | undefined> => {
  const decoder = new TextDecoder();
  const texts: Array<string | undefined> = [];
  let at = 0;

  while (at < bytes.length) {
    const newline = bytes.indexOf(10, at);
    const header = decoder.decode(bytes.subarray(at, newline));
    const size = /^\S+ blob (\d+)$/.exec(header)?.[1];

    if (size === undefined) {
      texts.push(undefined);
      at = newline + 1;
      continue;
    }

    texts.push(decoder.decode(bytes.subarray(newline + 1, newline + 1 + Number(size))));
    at = newline + 1 + Number(size) + 1;
  }

  return texts;
};

/** The folder's records on origin/main, after a fetch: each path with its text. */
const recordsAt = Effect.fn("records.recordsAt")(function* (repo: string, folder: Folder) {
  const fetched = yield* git(repo, ["fetch", "-q", "origin", "main"]);

  if (fetched.code !== 0) {
    return yield* new Unknown({ reason: `cannot fetch origin main: ${fetched.err}` });
  }

  const listed = yield* git(repo, ["ls-tree", "-r", "-z", "--name-only", BASE, "--", `${folder}/`]);

  if (listed.code !== 0) {
    return yield* new Unknown({ reason: `cannot read ${folder} at ${BASE}: ${listed.err}` });
  }

  const paths = inOrder(folder, new TextDecoder().decode(listed.out).split("\0"));
  const read = yield* git(repo, ["cat-file", "--batch"], paths.map((path) => `${BASE}:${path}\n`).join(""));
  const texts = batchTexts(read.out);

  if (read.code !== 0 || texts.length !== paths.length || texts.includes(undefined)) {
    return yield* new Unknown({ reason: `cannot read the records of ${folder} at ${BASE}: ${read.err}` });
  }

  return paths.map((path, i) => ({ path, text: texts[i] ?? "" }));
});

const FolderArgument = Argument.ChoiceWithValue("folder", [
  [".decisions", ".decisions"],
  [".decisions/", ".decisions"],
  ["experiments", "experiments"],
  ["experiments/", "experiments"],
  [".patterns", ".patterns"],
  [".patterns/", ".patterns"],
  ["docs/direction", "docs/direction"],
  ["docs/direction/", "docs/direction"],
] as const);

const list = Command.make(
  "list",
  { folder: FolderArgument },
  Effect.fn("records.list")(function* ({ folder }) {
    const records = yield* recordsAt(process.cwd(), folder);
    yield* Console.log(records.map((r) => recordLine(folder, r.path, r.text)).join("\n"));
    const next = nextNumber(
      folder,
      records.map((r) => r.path),
    );

    if (next !== undefined) {
      yield* Console.log(`next ${next}`);
    }
  }),
);

const next = Command.make(
  "next",
  { folder: FolderArgument },
  Effect.fn("records.next")(function* ({ folder }) {
    const records = yield* recordsAt(process.cwd(), folder);
    const number = nextNumber(
      folder,
      records.map((r) => r.path),
    );

    if (number === undefined) {
      return yield* new NoNumbers({ folder });
    }

    yield* Console.log(number);
  }),
);

const records = Command.make("records").pipe(Command.withSubcommands([list, next]));

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run({ version: "0.0.0" })(records).pipe(
      Effect.as(0),
      Effect.catchTag("Unknown", (e) =>
        Console.error(`records: unknown, never 0 records: ${e.reason}`).pipe(Effect.as(1)),
      ),
      Effect.catchTag("NoNumbers", (e) =>
        Console.error(`records: ${e.folder} has no numbers; use list`).pipe(Effect.as(2)),
      ),
      // `--help` alone is a clean exit; a command line effect/cli could not read is printed by it.
      Effect.catchTag("ShowHelp", (help) => Effect.succeed(help.errors.length === 0 ? 0 : 2)),
      Effect.catch(() => Effect.succeed(2)),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 2),
    },
  );
}
