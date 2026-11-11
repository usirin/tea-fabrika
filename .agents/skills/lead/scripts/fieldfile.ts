// fieldfile.ts <log> <rows>: saves each JSON line of <rows> as its own row file,
// field/<log>/<id>.json, in the repo it is run from. Today's lead tooling, run on our own laptop; it
// is not product. Decision 0090: a new field row is its own file, and its id is its file name, the
// date plus a short kebab-case slug.
//
//   node fieldfile.ts runs "$BOXES/<lane>-rows.jsonl"            a lane's step rows
//   <a script that prints a row> | node fieldfile.ts runs /dev/stdin   one row a script printed
//   node fieldfile.ts findings report-rows.jsonl                  the rows a step handed over
//
// The name of each row's file:
//   notes                 its `id`, which must already be the date plus a slug
//   findings, a finding   its `id`, the same
//   findings, a rating    `<date>-rated-<finding>`: the rating's own date, then the finding it rates
//   runs                  its `run`. A lane's run id has no date (drive's `t562-tests1`), so the row's
//                         date goes in front, in the file name and in `run` alike:
//                         `2026-11-11-t562-tests1`. Not decided in 0090; the plain reading.
//
// Nothing is written unless every row has a name, no two rows share one, and no file of that name
// exists: a clash is a refusal on stderr and exit 1, never a row written over another. Each file
// is the row with two spaces of indent and a final newline; the CI `field` job checks its fields.
//
// Existing tools looked at first (decision 0040): changesets (https://github.com/changesets/changesets)
// and towncrier (https://towncrier.readthedocs.io/) each write one file per entry, the model 0090
// follows. Both write Markdown fragments named by their own rules (a random name, or an issue number
// and a type), so neither can save a JSON row under its own id.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import { Argument, Command } from "effect/cli";

export const Log = Schema.Literals(["notes", "runs", "findings"]);
export type Log = typeof Log.Type;

/** A row's id and file name: `YYYY-MM-DD-<slug>`, the slug lowercase words joined by `-`. */
const Dated = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/));
const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

const Row = Schema.Record(Schema.String, Schema.Unknown);
type Row = typeof Row.Type;

export class Refused extends Schema.TaggedError<Refused>()("Refused", { reason: Schema.String }) {}

/** One row's file: the name it is saved under, and the row as saved. */
export type Saved = { readonly name: string; readonly row: Row };

/** The file a row is saved in, by its log (the rules above). A row with no good name is refused. */
export const saved = (log: Log, row: Row): Result.Result<Saved, Refused> => {
  const refuse = (reason: string) => Result.fail(new Refused({ reason }));
  const named = (key: string) => {
    const id = row[key];
    return Schema.is(Dated)(id)
      ? Result.succeed({ name: id, row })
      : refuse(`a ${log} row's \`${key}\` must be <YYYY-MM-DD>-<slug>, got ${JSON.stringify(id)}`);
  };

  if (log === "notes") {
    return named("id");
  }

  if (log === "findings") {
    if (row["_tag"] === "finding") {
      return named("id");
    }

    if (row["_tag"] !== "rated") {
      return refuse("a findings row's `_tag` must be finding or rated");
    }

    const name = `${String(row["date"])}-rated-${String(row["finding"])}`;
    return Schema.is(Day)(row["date"]) && Schema.is(Dated)(name)
      ? Result.succeed({ name, row })
      : refuse(`a rating needs its date and the finding's id, got ${JSON.stringify(name)}`);
  }

  const run = row["run"];

  if (Schema.is(Dated)(run)) {
    return Result.succeed({ name: run, row });
  }

  const name = `${String(row["date"])}-${String(run)}`;
  return typeof run === "string" && Schema.is(Day)(row["date"]) && Schema.is(Dated)(name)
    ? Result.succeed({ name, row: { ...row, run: name } })
    : refuse(`a run row needs its date and a \`run\` of lowercase words, got ${JSON.stringify(run)}`);
};

const decodeRow = Schema.decodeUnknownResult(Schema.fromJsonString(Row));

/** Every row of a JSON-lines text, named, or the first refusal. Blank lines are skipped. */
export const plan = (log: Log, text: string): Result.Result<ReadonlyArray<Saved>, Refused> => {
  const files: Saved[] = [];
  const names = new Set<string>();

  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }

    const at = (reason: string) => Result.fail(new Refused({ reason: `line ${i + 1}: ${reason}` }));
    const row = decodeRow(line);

    if (Result.isFailure(row)) {
      return at("not one JSON object");
    }

    const file = saved(log, row.success);

    if (Result.isFailure(file)) {
      return at(file.failure.reason);
    }

    if (names.has(file.success.name)) {
      return at(`two rows are both named ${file.success.name}`);
    }

    names.add(file.success.name);
    files.push(file.success);
  }

  return Result.succeed(files);
};

const save = Effect.fn("fieldfile.save")(function* (log: Log, rows: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const unreadable = (reason: string) => Effect.mapError(() => new Refused({ reason }));

  if (!(yield* fs.exists("field").pipe(unreadable("the field folder could not be read")))) {
    return yield* new Refused({ reason: "no field/ folder here: run it from the top of the repo" });
  }

  const text = yield* fs.readFileString(rows).pipe(unreadable(`${rows} could not be read`));
  const files = yield* Effect.fromResult(plan(log, text));
  const folder = path.join("field", log);
  const at = (name: string) => path.join(folder, `${name}.json`);

  for (const file of files) {
    if (yield* fs.exists(at(file.name)).pipe(unreadable(`${at(file.name)} could not be read`))) {
      return yield* new Refused({ reason: `${at(file.name)} exists: pick another slug` });
    }
  }

  yield* fs.makeDirectory(folder, { recursive: true }).pipe(unreadable(`${folder} could not be made`));

  for (const file of files) {
    // `wx` fails on a file that appeared since the check above, so nothing is written over.
    yield* fs
      .writeFileString(at(file.name), `${JSON.stringify(file.row, null, 2)}\n`, { flag: "wx" })
      .pipe(unreadable(`${at(file.name)} could not be written`));
    yield* Console.log(at(file.name));
  }
});

const fieldfile = Command.make(
  "fieldfile",
  { log: Argument.Literals("log", Log.literals), rows: Argument.String("rows") },
  ({ log, rows }) => save(log, rows).pipe(Effect.tapError((refused) => Console.error(`fieldfile: ${refused.reason}`))),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(fieldfile, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
    { disableErrorReporting: true },
  );
}
