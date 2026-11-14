/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
// The exam command and the build share one Compiler check in libfabrika.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { check, Row } from "@kampus/libfabrika/compiler";
import { Console, Effect, FileSystem, Path, Schema } from "effect";

export { check, compile, Row, type Finding } from "@kampus/libfabrika/compiler";

class Unread extends Schema.TaggedError<Unread>()("Unread", { path: Schema.String }) {}
class Refused extends Schema.TaggedError<Refused>()("Refused", { findings: Schema.Number }) {}

/** `pnpm lint:compiler`: every `.tsx` file in `next/`, tests left out, against the ledger. */
const lint = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const read = (file: string) =>
    fs.readFileString(path.join(root, file)).pipe(Effect.mapError(() => new Unread({ path: file })));
  const ledger = yield* read("compiler-ledger.json").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
  );
  const paths = (yield* fs.glob("next/**/*.tsx", { root, exclude: ["**/node_modules/**"] }))
    .map((p) => path.relative(root, path.join(root, p)))
    .filter((p) => !p.includes("node_modules") && !p.includes(".test."))
    .sort();
  const files = new Map<string, string>();

  for (const path of paths) {
    files.set(path, yield* read(path));
  }

  const findings = check(files, ledger);

  for (const f of findings) {
    yield* Console.error(`${f.file}:${f.line} ${f.fn}: ${f.reason}`);
  }

  yield* Console.log(`lint:compiler: ${files.size} files, ${findings.length} findings, ${ledger.length} ledger rows`);

  if (findings.length > 0) {
    return yield* new Refused({ findings: findings.length });
  }
});

if (import.meta.main) {
  NodeRuntime.runMain(lint.pipe(Effect.provide(NodeServices.layer)));
}
