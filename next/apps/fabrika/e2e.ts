// The exam's thin end-to-end runner (docs/plan/tier-1-detail.md, the exam's item 10). Each landing
// adds its own file to `e2e/`, as `e2e/<name>.test.ts`, and this runs them all through vitest, one
// file at a time, since they start a brain, Chromium or Electron. It passes while there are none.
// The runner is the exam's; a builder never edits it.
//
//   node next/apps/fabrika/e2e.ts
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Console, Effect, FileSystem, Path, Schema} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";

class E2eFailed extends Schema.TaggedError<E2eFailed>()("E2eFailed", {
	exitCode: Schema.Number,
}) {}

// A test that starts a brain waits on it, so the limits are vitest's own times 24: two minutes.
const LIMIT = "120000";

const run = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const folder = path.join(import.meta.dirname, "e2e");
	const names = (yield* fs.exists(folder)) ? yield* fs.readDirectory(folder) : [];
	const files = names.filter((name) => name.endsWith(".test.ts")).sort();
	if (files.length === 0) {
		yield* Console.log("e2e: no e2e/*.test.ts yet, nothing to run");
		return;
	}
	yield* Console.log(`e2e: ${files.length} file(s): ${files.join(", ")}`);
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const exitCode = yield* spawner.exitCode(
		ChildProcess.make(
			"pnpm",
			[
				"exec",
				"vitest",
				"run",
				"--maxWorkers=1",
				"--root",
				folder,
				"--fileParallelism=false",
				`--testTimeout=${LIMIT}`,
				`--hookTimeout=${LIMIT}`,
			],
			{cwd: import.meta.dirname, stdin: "ignore", stdout: "inherit", stderr: "inherit"},
		),
	);
	if (exitCode !== 0) return yield* new E2eFailed({exitCode});
});

NodeRuntime.runMain(run.pipe(Effect.provide(NodeServices.layer)));
