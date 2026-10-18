import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import type {SpawnedProcess, SpawnOptions} from "@anthropic-ai/claude-agent-sdk";

// Where the Agent SDK would start `claude`, start the guard (./guard.ts), and
// let it start `claude`. The SDK talks to `claude` over its stdin and stdout
// as before: the guard hands both on untouched.
//
// fd 3 is the guard's lifeline. This process keeps its end open and never
// writes to it; when this process ends, however it ends, the guard reads the
// end of it and stops the builder.
//
// The guard runs in a session of its own (`detached`), so a signal sent to
// this process's group (a terminal's Ctrl-C, a `kill -9 -<group>`) does not
// take the guard down before it has stopped the builder.
//
// Node at the edge here: the SDK's `spawnClaudeCodeProcess` asks for a Node
// ChildProcess, synchronously, so this is `node:child_process` and nothing
// else.

const GUARD = fileURLToPath(new URL("./guard.ts", import.meta.url));

/** The lock file of a working copy: beside it, outside it, where the builder's sandbox cannot write. */
export const lockOf = (tree: string) => `${tree.replace(/\/+$/, "")}.lock`;

/** How long a new builder waits for an old one on the same copy to finish stopping. */
export const WAIT_SECONDS = 30;

export interface Guarded {
	/** For the SDK's `spawnClaudeCodeProcess`. */
	readonly spawn: (options: SpawnOptions) => SpawnedProcess;
	/** Why the guard refused to start the builder, in its words; `null` when it did not. */
	readonly refused: () => string | null;
}

/** A guard for one builder run in the copy whose lock file is `lock`. */
export const guarded = (lock: string, wait: number = WAIT_SECONDS): Guarded => {
	let said = "";
	return {
		spawn: (options) => {
			const child = spawn(
				process.execPath,
				[
					"--disable-warning=ExperimentalWarning",
					GUARD,
					lock,
					String(wait),
					"--",
					options.command,
					...options.args,
				],
				{
					...(options.cwd === undefined ? {} : {cwd: options.cwd}),
					env: options.env,
					stdio: ["pipe", "pipe", "pipe", "pipe"],
					detached: true,
					signal: options.signal,
				},
			);
			// Read to its end, or a full pipe would stop `claude`; the tail is kept for `refused`.
			child.stderr?.on("data", (chunk: Buffer) => {
				said = (said + chunk.toString("utf8")).slice(-4_000);
			});
			// The SDK reads `exit` and `error`; an error on the lifeline is the guard's to read.
			child.stdio[3]?.on("error", () => undefined);
			return child as SpawnedProcess;
		},
		refused: () =>
			said
				.split("\n")
				.reverse()
				.find((line) => line.startsWith("held:"))
				?.slice("held:".length)
				.trim() ?? null,
	};
};
