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
// Lints planted files the way `pnpm lint` does, for the exam's rule tests. The files go into a
// fresh folder that holds the repo's own `.oxlintrc.json` and its plugin folder, at the paths they are
// given (`next/packages/tuval/src/window/use-model.ts`), so the rules' own edge paths and the config's
// `next/**` globs meet them as they would meet the real file. Nothing is written inside the repo.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** One fire: the rule's code, as oxlint prints it (`fabrika(no-of)`), and where. */
interface Fire {
  readonly code: string;
  readonly file: string;
  readonly line: number;
}

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const Report = Schema.Struct({
  number_of_files: Schema.Number,
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optional(Schema.String),
      filename: Schema.String,
      labels: Schema.optional(Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Number }) }))),
    }),
  ),
});

const readReport = Schema.decodeUnknownSync(Schema.fromJsonString(Report));

/**
 * Lints the planted files, keyed by path from the top of the repo, and answers the lines one rule
 * (`fabrika(no-of)`) fires on in one of them, in order.
 */
export const plant = (
  files: Readonly<Record<string, string>>,
): Promise<(code: string, file: string) => readonly number[]> => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits this test helper's Promise
  return Effect.runPromise(
    lint(files).pipe(
      Effect.map(
        (fires) => (code: string, file: string) =>
          fires
            .filter((f) => f.code === code && f.file === file)
            .map((f) => f.line)
            .sort((a, b) => a - b),
      ),
      Effect.provide(NodeServices.layer),
    ),
  );
};

const lint = Effect.fnUntraced(function* (files: Readonly<Record<string, string>>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ROOT = path.resolve(import.meta.dirname, "../../../../..");
  // The real path: on a Mac the temp folder is behind a link, and oxlint matches globs on the real one.
  const at = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "exam-" }));
  yield* fs.copyFile(path.join(ROOT, ".oxlintrc.json"), path.join(at, ".oxlintrc.json"));
  yield* fs.symlink(path.join(ROOT, "oxlint-plugins"), path.join(at, "oxlint-plugins"));

  for (const [file, text] of Object.entries(files)) {
    const full = path.join(at, file);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, text);
  }

  const ran = yield* ChildProcess.make(
    path.join(ROOT, "node_modules", ".bin", "oxlint"),
    [
      `--config=${path.join(at, ".oxlintrc.json")}`,
      "--disable-nested-config",
      "--no-ignore",
      "--format=json",
      ...Object.keys(files),
    ],
    { cwd: at },
  );
  const [out, err] = yield* Effect.all(
    [
      ran.stdout.pipe(Stream.decodeText(), Stream.mkString),
      ran.stderr.pipe(Stream.decodeText(), Stream.mkString),
      ran.exitCode,
    ],
    { concurrency: 3 },
  );
  const report = readReport(out);

  if (report.number_of_files !== Object.keys(files).length) {
    return yield* Effect.die(new Error(`oxlint read ${report.number_of_files} files: ${err}`));
  }

  return report.diagnostics.map((d): Fire => ({
    code: d.code ?? "",
    file: d.filename,
    line: d.labels?.[0]?.span.line ?? 0,
  }));
}, Effect.scoped);
