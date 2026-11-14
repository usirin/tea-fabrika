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
// The exam's thin end-to-end runner (docs/plan/tier-1-detail.md, the exam's item 10). Each landing
// adds its own file to `e2e/`, as `e2e/<name>.test.ts`, and this runs them all through vitest, one
// file at a time, since they start a brain, Chromium or Electron. It passes while there are none.
// The runner is the exam's; a builder never edits it.
//
//   node next/apps/fabrika/e2e.ts
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
class E2eFailed extends Schema.TaggedError<E2eFailed>()("E2eFailed", {
  exitCode: Schema.Number,
}) {}

// A test that starts a brain waits on it, so the limits are vitest's own times 24: two minutes.
const LIMIT = "120000";

const run = Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(import.meta.dirname, "e2e");
  const names = (yield* fs.exists(folder)) ? yield* fs.readDirectory(folder) : [];
  const files = [
    ...names
      .filter((name) => name.endsWith(".test.ts"))
      .sort()
      .map((name) => path.join(folder, name)),
    path.resolve(import.meta.dirname, "../../packages/tuval/src/browser/key.laws.test.ts"),
  ];
  const selected = process.argv.slice(2);
  const targets = selected.length === 0 ? files : files.filter((file) => selected.includes(path.basename(file)));

  if (selected.length > 0 && targets.length !== selected.length) {
    return yield* new E2eFailed({ exitCode: 2 });
  }

  if (targets.length === 0) {
    yield* Console.log("e2e: no e2e/*.test.ts yet, nothing to run");
    return;
  }

  yield* Console.log(`e2e: ${targets.length} file(s): ${targets.map((file) => path.basename(file)).join(", ")}`);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  for (const file of targets) {
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--maxWorkers=1",
          "--root",
          path.dirname(file),
          path.basename(file),
          "--fileParallelism=false",
          `--testTimeout=${LIMIT}`,
          `--hookTimeout=${LIMIT}`,
        ],
        { cwd: import.meta.dirname, stdin: "ignore", stdout: "inherit", stderr: "inherit" },
      ),
    );

    if (exitCode !== 0) {
      return yield* new E2eFailed({ exitCode });
    }
  }
});

NodeRuntime.runMain(run.pipe(Effect.provide(NodeServices.layer)));
