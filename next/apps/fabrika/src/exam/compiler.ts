/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
// The exam command and the build share one Compiler check in libfabrika.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { check, Row } from "@kampus/libfabrika/compiler";
import { Console, Effect, FileSystem, Path, Schema } from "effect";

export { check, compile, Row, type Finding } from "@kampus/libfabrika/compiler";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
class Unread extends Schema.TaggedError<Unread>()("Unread", { path: Schema.String }) {}
class Refused extends Schema.TaggedError<Refused>()("Refused", { findings: Schema.Number }) {}

/** `pnpm lint:compiler`: every `.tsx` file in `next/`, tests left out, against the ledger. */
const lint = Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
