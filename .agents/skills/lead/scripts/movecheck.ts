// movecheck.ts: says where a pull request did more than move. Lead tooling for ticket 477, run on our
// own laptop; it is not product. libfabrika's files move into rooms over 16 pull requests (decision
// 0043), and a move must change no line of logic.
//
//   movecheck <base> <head> --moves <table>      a move PR: only the table's renames, files that only
//                                                follow them and the named files change, and each
//                                                moved file keeps its row of the rule file
//   movecheck <base> <head> --split <old file>   a split PR: every old line lands once, in order, and
//                                                new lines only wire the parts
//   movecheck <base> <head> --renamed <table>    a rename PR: only the listed names change
//
//   --named <path>      a file that may change in any way (a config or doc the plan names); repeat it
//   --except <path>     a moved file's old path that may change its row (--moves only); repeat it
//   --rules <path>      the rule file, `layer-rules.json` when left out (--moves only)
//
// A moves table is `{"moves": [{"from": "old/path.ts", "to": "new/Path.ts"}]}`, the hand plan
// `@demlik/structure-sweep`'s `move apply --plan` takes, so one file feeds both. A names table is
// `{"names": [{"from": "health", "to": "measurements"}]}`. Paths are from the top of the repo.
//
// It reads the diff from the merge base of <base> and <head> to <head>, with git's rename detection,
// in the folder it is run from. One line per fault on stdout, a total on stderr. Exit 0 when clean, 1
// on any fault, 2 when it could not run.
//
// Existing tools looked at first (decision 0040):
//   - git's own rename detection (https://git-scm.com/docs/git-diff, `-M`). Used here to read the
//     diff. It gives a likeness in percent, so it cannot say that only specifiers changed.
//   - TypeScript's parser, to find the specifiers. The installed `typescript@7.0.2` gives a program
//     no parser: `import("typescript")` holds only `version` and `versionMajorMinor` (run on
//     2026-11-10). So the specifiers are found by the pattern below.
//   - `@demlik/structure-sweep`, which makes the moves. It is the tool under check, and the plan
//     says it is not trusted.
//
// Edge cases, each read on the safe side: a doubt is a fault a person reads, never a pass.
//   - A statement's names are not its specifier: `import {a}` to `import {a, b}` is a fault.
//   - A statement over several lines is one statement.
//   - Only an `import` or `export` that starts its line counts. An indented one, `import()` and
//     `vi.mock()` strings are text like any other, so a change in one is a fault.
//   - Import statements in a new order are a fault: sorting after a move is under no law yet.
//   - A changed quote mark is a fault.
//   - git reads a small file whose lines mostly changed as a delete and an add: two faults.
//   - A split counts a line as often as it stands, and tries every file an equal line may have gone
//     to. When too many are equal it says so and asks for a hand check.
//   - A split's new function has its header on one line and closes with `};`. Another shape is a
//     fault.
//   - A rename reads whole identifiers, in strings and comments too: `healthRow` is not `health`.
//   - A move may add one line kind besides specifiers: exactly `/** @internal */`, alone at the start
//     of its line, right above a line that starts with `export`, in a file under an `internal/`
//     folder (ticket 591). An indented tag, another comment, a tag above anything else, a tag
//     outside `internal/` and a removed tag are faults.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, FileSystem, Option, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { type Row, rowsAt } from "../../../../next/apps/fabrika/src/exam/rows.ts";

/** One file of a diff, with its text on each side it has one. */
const Change = Schema.TaggedUnion({
  renamed: {
    from: Schema.String,
    to: Schema.String,
    before: Schema.String,
    after: Schema.String,
  },
  modified: { path: Schema.String, before: Schema.String, after: Schema.String },
  added: { path: Schema.String, after: Schema.String },
  deleted: { path: Schema.String, before: Schema.String },
});
type Change = typeof Change.Type;
type Modified = typeof Change.cases.modified.Type;

/** One row of a table: a file's old and new path, or a name's old and new spelling. */
const Pair = Schema.Struct({ from: Schema.String, to: Schema.String });
type Pair = typeof Pair.Type;

/** Where a diff did more than it may: the file, and what is wrong in plain words. */
interface Fault {
  readonly path: string;
  readonly reason: string;
}

interface File {
  readonly path: string;
  readonly text: string;
}

const short = (line: string): string => {
  const trimmed = line.trim();

  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
};

// A move PR.

// The specifier of an `import ... from`, an `export ... from` or a bare `import`, at the start of a
// line. No `;` and no quote may stand between the keyword and `from`, so it never runs into the
// next statement's string.
const SPECIFIER = /^((?:import|export)\b[^;'"`]*?\bfrom\s*|import\s*)(["'])[^'"\n]*\2/gm;

/** The text with every specifier emptied, so two texts that differ only there are equal. */
const unspecified = (text: string): string => text.replace(SPECIFIER, "$1$2$2");

/** The first line where the new text leaves the old one. A specifier holds no line break. */
const firstChange = (before: string, after: string): string => {
  const was = before.split("\n");
  const is = after.split("\n");
  const at = is.findIndex((line, n) => line !== was[n]);

  return at < 0
    ? `${was.length - is.length} lines are gone after line ${is.length}`
    : `line ${at + 1}: ${short(is[at] ?? "")}`;
};

// The one line a move may add besides specifiers (ticket 591): exactly `/** @internal */` at the
// start of its line, right above a line that starts with `export`, in a file under an `internal/`
// folder, so `fabrika/rooms`' rule 3 holds for a file that moved there.
const TAG = /^\/\*\* @internal \*\/\n(?=export\b)/gm;

/** Whether a path is under an `internal/` folder, at any depth. */
const isInternal = (path: string): boolean => path.split("/").slice(0, -1).includes("internal");

/** The text with every allowed tag line taken out, in an `internal/` file only. */
const untagged = (path: string, text: string): string => (isInternal(path) ? text.replace(TAG, "") : text);

/** How many allowed tag lines a text holds. */
const tagCount = (text: string): number => text.match(TAG)?.length ?? 0;

const followed = (path: string, before: string, after: string): ReadonlyArray<Fault> => {
  const was = unspecified(untagged(path, before));
  const is = unspecified(untagged(path, after));

  if (was !== is) {
    return [{ path, reason: `more than import specifiers changed, ${firstChange(was, is)}` }];
  }

  return isInternal(path) && tagCount(after) < tagCount(before)
    ? [{ path, reason: "an @internal tag line was removed" }]
    : [];
};

/**
 * A move PR's faults. A rename must be a row of the table and differ only in specifiers; a modified
 * file must be named or differ only in specifiers; an added or deleted file must be named.
 */
export const moveFaults = (
  changes: ReadonlyArray<Change>,
  table: { readonly moves: ReadonlyArray<Pair>; readonly named: ReadonlyArray<string> },
): ReadonlyArray<Fault> => {
  const named = new Set(table.named);

  return changes.flatMap((change): ReadonlyArray<Fault> => {
    if (change._tag === "renamed") {
      return table.moves.some((move) => move.from === change.from && move.to === change.to)
        ? followed(change.to, change.before, change.after)
        : [{ path: change.to, reason: `renamed from ${change.from}, which is no row of the table` }];
    }

    if (named.has(change.path)) {
      return [];
    }

    if (change._tag === "modified") {
      return followed(change.path, change.before, change.after);
    }

    return [
      {
        path: change.path,
        reason: change._tag === "added" ? "a new file nobody named" : "deleted with no new path, and nobody named it",
      },
    ];
  });
};

const said = (rows: ReadonlyArray<string>): string => (rows.length === 0 ? "none" : rows.join(" and "));

/**
 * The moved files that did not keep their row of the rule file: clean when exactly one row claims
 * `from` on the base and the same single row claims `to` on the head. `except` lists old paths that
 * may change their row.
 */
export const partFaults = (
  moves: ReadonlyArray<Pair>,
  rules: { readonly base: ReadonlyArray<Row>; readonly head: ReadonlyArray<Row> },
  except: ReadonlyArray<string>,
): ReadonlyArray<Fault> =>
  moves
    .filter((move) => !except.includes(move.from))
    .flatMap((move) => {
      const was = rowsAt(rules.base, move.from);
      const is = rowsAt(rules.head, move.to);

      return was.length === 1 && is.length === 1 && was[0] === is[0]
        ? []
        : [{ path: move.to, reason: `its row of the rule file was ${said(was)} and is ${said(is)}` }];
    });

// A split PR.

interface Line {
  /** Its line number in the file, from 1. */
  readonly at: number;
  /** The line without its leading space: a cut-out line may sit deeper or shallower. */
  readonly text: string;
}

interface Placed extends Line {
  /** A line a clean cut may add: it need not come from the old file. */
  readonly wiring: boolean;
}

interface Part {
  readonly path: string;
  readonly lines: ReadonlyArray<Placed>;
}

const linesIn = (text: string): ReadonlyArray<Line> =>
  text.split("\n").flatMap((line, n) => {
    const trimmed = line.trimStart();

    return trimmed === "" ? [] : [{ at: n + 1, text: trimmed }];
  });

const IMPORT_LINE = /^import\s[^;()=]*["'];?$/;
const IMPORT_OPEN = /^import\s[^;()='"]*\{$/;
const IMPORT_NAME = /^(?:type\s)?[\w$]+(?:\sas\s[\w$]+)?,?$/;
const IMPORT_CLOSE = /^\}\sfrom\s(["'])[^'"]*\1;?$/;
const INTERNAL = "/** @internal */";
const CLOSING = "};";
const HEADER = /^export (?:const|function\*?) ([\w$]+)\b.*(?:=>|\)) \{$/;
const CALL = /^(?:yield\* )?([\w$]+)\([^;]*\);$/;

/** Which lines are part of an import statement, one over several lines included. */
const importMarks = (lines: ReadonlyArray<Line>): ReadonlyArray<boolean> => {
  let open = false;

  return lines.map(({ text }) => {
    if (open) {
      open = IMPORT_NAME.test(text);

      return open || IMPORT_CLOSE.test(text);
    }

    open = IMPORT_OPEN.test(text);

    return open || IMPORT_LINE.test(text);
  });
};

/** The new files with each line marked: an import, `@internal`, a header, a closing or a call. */
const partsIn = (old: ReadonlyArray<Line>, after: ReadonlyArray<File>): ReadonlyArray<Part> => {
  const known = new Set(old.map((line) => line.text));
  const files = after.map((file) => ({ path: file.path, lines: linesIn(file.text) }));
  // The functions cut out: a header that is new. A call counts only when it calls one of them.
  const cut = new Set(
    files.flatMap((file) =>
      file.lines.flatMap((line) => {
        const name = HEADER.exec(line.text)?.[1];

        return name === undefined || known.has(line.text) ? [] : [name];
      }),
    ),
  );

  return files.map((file) => {
    const imports = importMarks(file.lines);

    return {
      path: file.path,
      lines: file.lines.map((line, n) => ({
        ...line,
        wiring:
          imports[n] === true ||
          line.text === INTERNAL ||
          line.text === CLOSING ||
          HEADER.test(line.text) ||
          cut.has(CALL.exec(line.text)?.[1] ?? ""),
      })),
    };
  });
};

const tally = (texts: ReadonlyArray<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();

  for (const text of texts) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  return counts;
};

/** A line that is gone, and a line of logic that is new or stands more often than it did. */
const countFaults = (path: string, old: ReadonlyArray<Line>, parts: ReadonlyArray<Part>): ReadonlyArray<Fault> => {
  const was = tally(old.map((line) => line.text));
  const all = parts.flatMap((part) => part.lines);
  const total = tally(all.map((line) => line.text));
  const logic = tally(all.filter((line) => !line.wiring).map((line) => line.text));
  const gone = old
    .filter((line, n) => old.findIndex((other) => other.text === line.text) === n)
    .filter((line) => (total.get(line.text) ?? 0) < (was.get(line.text) ?? 0))
    .map((line) => ({ path, reason: `old line ${line.at} is gone: ${short(line.text)}` }));
  const extra = parts.flatMap((part) =>
    part.lines
      .filter((line) => !line.wiring && (logic.get(line.text) ?? 0) > (was.get(line.text) ?? 0))
      .map((line) => ({
        path: part.path,
        reason: `line ${line.at} is new, or stands more often than it did: ${short(line.text)}`,
      })),
  );

  return [...gone, ...extra];
};

/** Where the next old line ends in a file read from `from`: only wiring may be passed over. */
const landing = (lines: ReadonlyArray<Placed>, from: number, text: string): number | undefined => {
  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at];

    if (line === undefined || line.text === text) {
      return line === undefined ? undefined : at + 1;
    }

    if (!line.wiring) {
      return undefined;
    }
  }

  return undefined;
};

// The most ways to place equal lines that are followed at once. It is not a rule about code: past it
// the answer is a fault that asks for a hand check, never a pass.
const WAYS = 4096;

/**
 * Whether the old lines can be dealt out to the new files in the old order. A way is how far each
 * file has been read. An equal line may have gone to more than one file, so every way is followed.
 */
const orderFaults = (path: string, old: ReadonlyArray<Line>, parts: ReadonlyArray<Part>): ReadonlyArray<Fault> => {
  let ways: ReadonlyArray<ReadonlyArray<number>> = [parts.map(() => 0)];

  for (const line of old) {
    const next = new Map<string, ReadonlyArray<number>>();

    for (const way of ways) {
      for (const [n, part] of parts.entries()) {
        const end = landing(part.lines, way[n] ?? 0, line.text);

        if (end !== undefined) {
          const moved = way.with(n, end);
          next.set(moved.join(","), moved);
        }
      }
    }

    if (next.size === 0) {
      return [
        {
          path,
          reason: `old line ${line.at} lands out of its old order, or behind a new line: ${short(line.text)}`,
        },
      ];
    }

    if (next.size > WAYS) {
      return [
        {
          path,
          reason: `too many equal lines to place from old line ${line.at} on: check this split by hand`,
        },
      ];
    }

    ways = [...next.values()];
  }

  const clean = ways.some((way) =>
    parts.every((part, n) => part.lines.slice(way[n] ?? 0).every((line) => line.wiring)),
  );

  return clean ? [] : [{ path, reason: "a line of logic is left over once every old line is placed" }];
};

/**
 * A split PR's faults: every line of the old file stands in exactly one new file, in the old order
 * within it, and a new line is an import, `@internal`, a cut-out function's header, its closing `};`
 * or a call to it.
 */
export const splitFaults = (before: File, after: ReadonlyArray<File>): ReadonlyArray<Fault> => {
  const old = linesIn(before.text);
  const parts = partsIn(old, after);
  const counted = countFaults(before.path, old, parts);

  return counted.length > 0 ? counted : orderFaults(before.path, old, parts);
};

// A rename PR.

const NAME = /([A-Za-z_$][\w$]*)/;

/**
 * A rename PR's faults: a file's text may differ only where a whole identifier is a table row's
 * `from` on the base and that row's `to` on the head.
 */
export const renameFaults = (
  changes: ReadonlyArray<{ readonly path: string; readonly before: string; readonly after: string }>,
  table: ReadonlyArray<Pair>,
): ReadonlyArray<Fault> =>
  changes.flatMap(({ path, before, after }) => {
    // Split on a capture: the names are at the odd places, the text between them at the even.
    const was = before.split(NAME);
    const is = after.split(NAME);

    if (was.length !== is.length) {
      return [{ path, reason: `more than names changed, ${firstChange(before, after)}` }];
    }

    const faults: Array<Fault> = [];
    let line = 1;

    for (const [n, now] of is.entries()) {
      const then = was[n] ?? "";

      if (n % 2 === 0) {
        if (then !== now) {
          faults.push({ path, reason: `line ${line}: more than a name changed` });
        }

        line += now.split("\n").length - 1;
      } else if (then !== now && !table.some((row) => row.from === then && row.to === now)) {
        faults.push({
          path,
          reason: `line ${line}: ${then} became ${now}, which is no row of the table`,
        });
      }
    }

    return faults;
  });

// The three kinds of pull request, each from a diff that is already read.

const movePr = (
  changes: ReadonlyArray<Change>,
  moves: ReadonlyArray<Pair>,
  rules: { readonly base: ReadonlyArray<Row>; readonly head: ReadonlyArray<Row> },
  allowed: { readonly named: ReadonlyArray<string>; readonly except: ReadonlyArray<string> },
): ReadonlyArray<Fault> => [
  ...moveFaults(changes, { moves, named: allowed.named }),
  ...partFaults(moves, rules, allowed.except),
];

const pathIn = (change: Change): string => (change._tag === "renamed" ? change.to : change.path);

/** The old file is the one the flag names; every file the diff adds is one of its parts. */
const splitPr = (changes: ReadonlyArray<Change>, old: string, named: ReadonlyArray<string>): ReadonlyArray<Fault> => {
  const front = changes.find((change): change is Modified => change._tag === "modified" && change.path === old);

  if (front === undefined) {
    return [{ path: old, reason: "the diff does not change this file, so nothing was split" }];
  }

  const parts = changes.flatMap((change) =>
    change._tag === "added" && !named.includes(change.path) ? [{ path: change.path, text: change.after }] : [],
  );
  const rest = changes.filter((change) => change !== front && !parts.some((part) => part.path === pathIn(change)));

  return [
    ...splitFaults({ path: old, text: front.before }, [{ path: old, text: front.after }, ...parts]),
    ...moveFaults(rest, { moves: [], named }),
  ];
};

/** Every file that has a text on both sides is read for names; an added or deleted one is a fault. */
const renamePr = (
  changes: ReadonlyArray<Change>,
  names: ReadonlyArray<Pair>,
  named: ReadonlyArray<string>,
): ReadonlyArray<Fault> => {
  const texts = changes.flatMap((change) =>
    change._tag === "added" || change._tag === "deleted" || named.includes(pathIn(change))
      ? []
      : [{ path: pathIn(change), before: change.before, after: change.after }],
  );
  const rest = changes.filter((change) => change._tag === "added" || change._tag === "deleted");

  return [...renameFaults(texts, names), ...moveFaults(rest, { moves: [], named })];
};

// The edge: git through effect/process, the tables through FileSystem, the flags through effect/cli.

class Failed extends Schema.TaggedError<Failed>()("Failed", {
  reason: Schema.Literals(["usage", "git", "file", "table"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** The run found faults and printed them. */
class Found extends Schema.TaggedError<Found>()("Found", { total: Schema.Number }) {}

const MoveTable = Schema.fromJsonString(Schema.Struct({ moves: Schema.Array(Pair) }));
const NameTable = Schema.fromJsonString(Schema.Struct({ names: Schema.Array(Pair) }));

const RuleFile = Schema.fromJsonString(
  Schema.Struct({
    layers: Schema.Array(Schema.Struct({ name: Schema.String, paths: Schema.Array(Schema.String) })),
  }),
);

const text = Effect.fnUntraced(function* (bytes: Stream.Stream<Uint8Array, unknown>) {
  return yield* bytes.pipe(Stream.decodeText(), Stream.mkString);
});

/** One git command's output. Nothing it prints is run. */
const git = Effect.fn("movecheck.git")(function* (args: ReadonlyArray<string>) {
  const failed = (cause?: unknown) => new Failed({ reason: "git", message: `git ${args.join(" ")} failed`, cause });
  const { out, code } = yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* ChildProcess.make("git", [...args], { stdin: "ignore" });
      const [out, , code] = yield* Effect.all([text(proc.stdout), text(proc.stderr), proc.exitCode], {
        concurrency: 3,
      });

      return { out, code: Number(code) };
    }),
  ).pipe(Effect.mapError(failed));

  if (code !== 0) {
    return yield* failed();
  }

  return out;
});

const show = (rev: string, path: string) => git(["show", `${rev}:${path}`]);

/** `git diff --name-status -z`: a status, then one path, or two after a rename. */
const statusesIn = (out: string): ReadonlyArray<{ readonly status: string; readonly paths: ReadonlyArray<string> }> => {
  const fields = out.split("\0");
  const statuses: Array<{ readonly status: string; readonly paths: ReadonlyArray<string> }> = [];

  for (let at = 0; at < fields.length && fields[at] !== "";) {
    const status = (fields[at] ?? "").slice(0, 1);
    const count = status === "R" ? 2 : 1;
    statuses.push({ status, paths: fields.slice(at + 1, at + 1 + count) });
    at += 1 + count;
  }

  return statuses;
};

/** The diff from `base` to `head` as changes, each with its text on the sides it has one. */
const changesBetween = Effect.fn("movecheck.changesBetween")(function* (base: string, head: string) {
  const out = yield* git(["diff", "--name-status", "-M", "-z", base, head]);

  return yield* Effect.forEach(
    statusesIn(out),
    Effect.fnUntraced(function* ({ status, paths }) {
      const [first = "", second = ""] = paths;

      if (status === "R") {
        return Change.cases.renamed.make({
          from: first,
          to: second,
          before: yield* show(base, first),
          after: yield* show(head, second),
        });
      }

      if (status === "A") {
        return Change.cases.added.make({ path: first, after: yield* show(head, first) });
      }

      if (status === "D") {
        return Change.cases.deleted.make({ path: first, before: yield* show(base, first) });
      }

      return Change.cases.modified.make({
        path: first,
        before: yield* show(base, first),
        after: yield* show(head, first),
      });
    }),
    { concurrency: 4 },
  );
});

const readFile = Effect.fn("movecheck.readFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((cause) => new Failed({ reason: "file", message: `cannot read ${path}`, cause })));
});

const rowsIn = Effect.fn("movecheck.rowsIn")(function* (rev: string, path: string) {
  const file = yield* Schema.decodeUnknownEffect(RuleFile)(yield* show(rev, path)).pipe(
    Effect.mapError((cause) => new Failed({ reason: "table", message: `${path} at ${rev} is not a rule file`, cause })),
  );

  return file.layers;
});

const USAGE =
  "usage: movecheck <base> <head> (--moves <table> | --split <old file> | --renamed <table>) [--named <path>]... [--except <old path>]... [--rules <rule file>]";

const movecheck = Command.make(
  "movecheck",
  {
    base: Argument.String("base"),
    head: Argument.String("head"),
    moves: Flag.String("moves").pipe(Flag.withDescription("A move PR: the JSON table of its moves"), Flag.optional),
    split: Flag.String("split").pipe(
      Flag.withDescription("A split PR: the path of the file that was cut"),
      Flag.optional,
    ),
    renamed: Flag.String("renamed").pipe(
      Flag.withDescription("A rename PR: the JSON table of its names"),
      Flag.optional,
    ),
    named: Flag.String("named").pipe(
      Flag.withDescription("A file that may change in any way; repeat it"),
      Flag.atLeast(0),
    ),
    except: Flag.String("except").pipe(
      Flag.withDescription("A moved file's old path that may change its row; repeat it"),
      Flag.atLeast(0),
    ),
    rules: Flag.String("rules").pipe(
      Flag.withDescription("The rule file, read on the base and on the head"),
      Flag.withDefault("layer-rules.json"),
    ),
  },
  Effect.fn("movecheck")(function* (given) {
    if ([given.moves, given.split, given.renamed].filter(Option.isSome).length !== 1) {
      return yield* new Failed({ reason: "usage", message: USAGE });
    }

    const base = (yield* git(["merge-base", given.base, given.head])).trim();
    const changes = yield* changesBetween(base, given.head);
    let faults: ReadonlyArray<Fault>;

    if (Option.isSome(given.moves)) {
      const path = given.moves.value;
      const table = yield* Schema.decodeUnknownEffect(MoveTable)(yield* readFile(path)).pipe(
        Effect.mapError(
          (cause) =>
            new Failed({
              reason: "table",
              message: `${path} is not a moves table: {"moves": [{"from": "...", "to": "..."}]}`,
              cause,
            }),
        ),
      );
      const rules = {
        base: yield* rowsIn(base, given.rules),
        head: yield* rowsIn(given.head, given.rules),
      };
      faults = movePr(changes, table.moves, rules, { named: given.named, except: given.except });
    } else if (Option.isSome(given.renamed)) {
      const path = given.renamed.value;
      const table = yield* Schema.decodeUnknownEffect(NameTable)(yield* readFile(path)).pipe(
        Effect.mapError(
          (cause) =>
            new Failed({
              reason: "table",
              message: `${path} is not a names table: {"names": [{"from": "...", "to": "..."}]}`,
              cause,
            }),
        ),
      );
      faults = renamePr(changes, table.names, given.named);
    } else {
      faults = splitPr(
        changes,
        Option.getOrElse(given.split, () => ""),
        given.named,
      );
    }

    yield* Effect.forEach(faults, (fault) => Console.log(`movecheck: ${fault.path}: ${fault.reason}`), {
      concurrency: 1,
      discard: true,
    });

    if (faults.length > 0) {
      yield* Console.error(
        `movecheck: ${faults.length} faults in ${new Set(faults.map((fault) => fault.path)).size} files`,
      );

      return yield* new Found({ total: faults.length });
    }

    yield* Console.error(`movecheck: clean, ${changes.length} changed files read`);
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run({ version: "0.0.0" })(movecheck).pipe(
      Effect.as(0),
      Effect.catchTag("Found", () => Effect.succeed(1)),
      Effect.catchTag("Failed", (failed) => Console.error(`movecheck: ${failed.message}`).pipe(Effect.as(2))),
      // `--help` alone is a clean exit; a flag the command line got wrong is printed by effect/cli.
      Effect.catchTag("ShowHelp", (help) => Effect.succeed(help.errors.length === 0 ? 0 : 2)),
      Effect.catch(() => Effect.succeed(2)),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) ? exit.value : 2),
    },
  );
}
