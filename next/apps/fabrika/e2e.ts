// The exam's thin end-to-end runner (docs/plan/tier-1-detail.md, the exam's item 10). Each landing adds
// its own file to `e2e/`. This runs them in one Vitest run with the repo's end-to-end config, one file at
// a time (vitest.e2e.config.ts). Its arguments go to Vitest as they are: a file name selects, `--shard
// k/n` keeps one leg. The runner is the exam's; a builder never edits it.
//
//   node next/apps/fabrika/e2e.ts [vitest arguments]
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class E2eFailed extends Schema.TaggedError<E2eFailed>()("E2eFailed", {
  exitCode: Schema.Number,
}) {}

const run = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = path.resolve(import.meta.dirname, "../../../vitest.e2e.config.ts");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("pnpm", ["exec", "vitest", "run", "--config", config, ...process.argv.slice(2)], {
      cwd: import.meta.dirname, // unchanged; no end-to-end file reads its cwd
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );

  if (exitCode !== 0) {
    return yield* new E2eFailed({ exitCode });
  }
});

NodeRuntime.runMain(run.pipe(Effect.provide(NodeServices.layer)));
