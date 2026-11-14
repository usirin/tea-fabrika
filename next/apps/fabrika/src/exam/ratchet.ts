// The ratchet on the list files (0524, 0168): a list of old findings only shrinks until it is
// deleted. CI's `check` job runs it as `node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"`.
//
// For each list it reads the file at the base and at the committed `HEAD`, never the working tree,
// keys each row the way that list's own reader matches it, and counts: a row the head holds beyond
// the base is added. Shrinking, pruning, reordering, a new `reason` and deleting the file pass.
//
//   next-ledger.json, agents-ledger.json   file, rule and code (oxlint-plugins/ledger.ts), counted
//   unreachable-ledger.json                scope, kind and id (code-graph's findingKey)
//
// It prints one JSON line per list, and a GitHub annotation for each list that grew. Exit 1 when a
// list grew or no longer reads as a list, 0 when none did or there is no base, 2 when the base is
// not a sha, git fails, or the base's own file does not read (main is broken, so it fails closed).
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

const ZEROS = "0".repeat(40);
const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

const LintRows = Schema.fromJsonString(
  Schema.Struct({
    entries: Schema.Array(Schema.Struct({ file: Schema.String, rule: Schema.String, code: Schema.String })),
  }),
);

const DeadRows = Schema.fromJsonString(
  Schema.Struct({
    entries: Schema.Array(Schema.Struct({ scope: Schema.String, kind: Schema.String, id: Schema.String })),
  }),
);

const lintKeys = (text: string) =>
  Schema.decodeUnknownEffect(LintRows)(text).pipe(
    Effect.map(({ entries }) => entries.map((row) => JSON.stringify([row.file, row.rule, row.code]))),
  );

const deadKeys = (text: string) =>
  Schema.decodeUnknownEffect(DeadRows)(text).pipe(
    Effect.map(({ entries }) => entries.map((row) => JSON.stringify([row.scope, row.kind, row.id]))),
  );

/** One list file, and the key its own reader matches a row on. */
interface List {
  readonly file: string;
  readonly keys: typeof lintKeys;
}

/** Each list file the ratchet holds, by its path from the top of the repo. */
export const LISTS: ReadonlyArray<List> = [
  { file: "next-ledger.json", keys: lintKeys },
  { file: "agents-ledger.json", keys: lintKeys },
  { file: "unreachable-ledger.json", keys: deadKeys },
];

/** The keys `head` holds beyond `base`, counted, in head order: one more copy of a key is added. */
export const added = (base: ReadonlyArray<string>, head: ReadonlyArray<string>): ReadonlyArray<string> => {
  const left = new Map<string, number>();

  for (const key of base) {
    left.set(key, (left.get(key) ?? 0) + 1);
  }

  return head.filter((key) => {
    const n = left.get(key) ?? 0;
    left.set(key, n - 1);
    return n <= 0;
  });
};

const Answer = Schema.TaggedUnion({
  done: { file: Schema.String },
  stuck: {
    file: Schema.String,
    reason: Schema.Literals(["row_added", "not_a_list"]),
    rows: Schema.Array(Schema.String),
  },
});
type Answer = typeof Answer.Type;

class BaseUnreadable extends Schema.TaggedError<BaseUnreadable>()("BaseUnreadable", { file: Schema.String }) {}

/** One list's answer from its text at the base and at the head; `null` means the file is absent. */
export const judge = Effect.fnUntraced(function* (list: List, base: string | null, head: string | null) {
  if (head === null) {
    return Answer.cases.done.make({ file: list.file });
  }

  const before =
    base === null ? [] : yield* list.keys(base).pipe(Effect.mapError(() => new BaseUnreadable({ file: list.file })));
  const after = yield* list.keys(head).pipe(Effect.option);

  if (Option.isNone(after)) {
    return Answer.cases.stuck.make({ file: list.file, reason: "not_a_list", rows: [] });
  }

  const rows = added(before, after.value);
  return rows.length === 0
    ? Answer.cases.done.make({ file: list.file })
    : Answer.cases.stuck.make({ file: list.file, reason: "row_added", rows: [...rows] });
});

// The edge: the base from the flag, and git through effect/process.

class Failed extends Schema.TaggedError<Failed>()("Failed", { message: Schema.String }) {}

const text = (s: Stream.Stream<Uint8Array, unknown>) => s.pipe(Stream.decodeText(), Stream.mkString);

/** One git command's output and exit code. */
const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* ChildProcess.make("git", [...args], { stdin: "ignore" });
      const [out, err, code] = yield* Effect.all([text(proc.stdout), text(proc.stderr), proc.exitCode], {
        concurrency: 3,
      });
      return { out, err, code: Number(code) };
    }),
  ).pipe(Effect.mapError(() => new Failed({ message: "could not start git" })));
});

const must = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  const r = yield* git(args);

  if (r.code !== 0) {
    return yield* new Failed({ message: `git ${args.join(" ")}: ${r.err.trim()}` });
  }

  return r.out;
});

/** The base the flag names: none for "" and forty zeros, a first push; anything else must be a sha. */
const baseFrom = Effect.fnUntraced(function* (flag: string | undefined) {
  if (flag === "" || flag === ZEROS) {
    return Option.none<string>();
  }

  const sha = Schema.decodeUnknownOption(Sha)(flag);

  if (Option.isNone(sha)) {
    return yield* new Failed({ message: `--base must be a full sha, "" or forty zeros, not ${String(flag)}` });
  }

  return sha;
});

/** A GitHub workflow command's text, with its line breaks kept as `%0A`. */
const escape = (s: string) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const annotation = (answer: Answer, sha: string) => {
  if (answer._tag === "done") {
    return [];
  }

  const head =
    answer.reason === "not_a_list"
      ? `${answer.file} does not read as a list at HEAD.`
      : `${answer.rows.length} row(s) added against ${sha}. A list only shrinks (0524): fix the code, or, where the code is right and the rule does not fit, mark that one line with a disable comment and its reason.`;
  return [`::error file=${answer.file}::${escape([head, ...answer.rows].join("\n"))}`];
};

const main = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--base");
  const base = yield* baseFrom(flag < 0 ? undefined : args[flag + 1]);

  if (Option.isNone(base)) {
    yield* Console.log("ratchet: no base, nothing to compare");
    return 0;
  }

  const sha = base.value;
  const top = (yield* must(["rev-parse", "--show-toplevel"])).trim();
  const at = (more: ReadonlyArray<string>) => ["-C", top, ...more];

  // The `check` job's checkout is shallow, so the base may need fetching first.
  if ((yield* git(at(["cat-file", "-e", `${sha}^{commit}`]))).code !== 0) {
    yield* must(at(["fetch", "--no-tags", "-q", "--depth=1", "origin", sha]));
  }

  const fileAt = Effect.fnUntraced(function* (rev: string, file: string) {
    if ((yield* git(at(["cat-file", "-e", `${rev}:${file}`]))).code !== 0) {
      return null;
    }

    return yield* must(at(["show", `${rev}:${file}`]));
  });
  let grew = false;

  for (const list of LISTS) {
    const answer = yield* judge(list, yield* fileAt(sha, list.file), yield* fileAt("HEAD", list.file));
    grew = grew || answer._tag === "stuck";
    yield* Console.log(JSON.stringify(answer));

    for (const line of annotation(answer, sha)) {
      yield* Console.log(line);
    }
  }

  return grew ? 1 : 0;
});

if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(
      Effect.tapError((e) => Console.error(`ratchet: ${JSON.stringify(e)}`)),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && typeof exit.value === "number" ? exit.value : 2),
    },
  );
}
