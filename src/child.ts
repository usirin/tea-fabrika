import {Effect, Stream} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";

// One command, run to its end, on Effect's `ChildProcess`. Its process is
// handed the environment it is given and nothing of this one's: `extendEnv`
// is off, so a variable not named is not passed on (src/env.ts says which).
//
// It answers how the command ended and what it printed, and never fails: a
// command that could not start is exit code -1, with why in `err`. The caller
// reads the code; nothing here guesses what a non-zero one means.

/** How one command ended. */
export interface Exited {
	readonly code: number;
	readonly out: string;
	readonly err: string;
}

export interface ChildOptions {
	readonly cwd?: string;
	readonly env: Readonly<Record<string, string>>;
}

const text = (stream: Stream.Stream<Uint8Array, unknown>) =>
	stream.pipe(Stream.decodeText(), Stream.mkString);

/** Run `file` with `args` to its end. */
export const runChild = (
	file: string,
	args: readonly string[],
	options: ChildOptions,
): Effect.Effect<Exited, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(
			ChildProcess.make(file, [...args], {
				...(options.cwd === undefined ? {} : {cwd: options.cwd}),
				env: {...options.env},
				extendEnv: false,
			}),
		);
		const [out, err, code] = yield* Effect.all(
			[text(handle.stdout), text(handle.stderr), handle.exitCode],
			{
				concurrency: "unbounded",
			},
		);
		return {code: Number(code), out, err};
	}).pipe(
		Effect.scoped,
		Effect.catch((error) => Effect.succeed<Exited>({code: -1, out: "", err: String(error)})),
	);

/** `runChild` under `nice -n 19`: for a heavy command (an install, a clone), so the machine stays light. */
export const runLow = (file: string, args: readonly string[], options: ChildOptions) =>
	runChild("nice", ["-n", "19", file, ...args], options);
