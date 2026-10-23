import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {Effect} from "effect";

// One command, its stdout: how the GitHub code host, the planner and the
// reviewer run `gh` and `git`. Lifted out of `wip/src/operator-live.ts` when
// the pipeline moved into `@kampus/fabrika` (experiment 103); the old
// operator's live Layers stay behind in `wip` and import it from here.
//
// Node at the edge: `child_process`, because this one call predates the move
// to Effect's `ChildProcess` (`child.ts` runs a command that way).

const run = promisify(execFile);

/** One command, its stdout. Any failure is "could not read or write at all". */
export const sh = (file: string, args: readonly string[], cwd?: string) =>
	Effect.tryPromise({
		try: () => run(file, [...args], {cwd, maxBuffer: 32 * 1024 * 1024}).then((r) => r.stdout),
		catch: () => ({_tag: "unknown" as const}),
	});
