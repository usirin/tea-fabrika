// P12, next/. Supply the RSS command's output without starting an OS process.
import {Effect, Layer, Sink, Stream} from "effect";
import {ChildProcessSpawner} from "effect/process";

export const rssLayer = (
	sample: () => number,
	onSpawn?: (command: string, args: ReadonlyArray<unknown>) => void,
) =>
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make((command) =>
			Effect.sync(() => {
				if (command._tag === "StandardCommand") {
					onSpawn?.(command.command, command.args);
				}

				const stdout = Stream.make(new TextEncoder().encode(String(sample())));
				return ChildProcessSpawner.makeHandle({
					pid: ChildProcessSpawner.ProcessId(27000),
					exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
					isRunning: Effect.succeed(false),
					kill: () => Effect.void,
					stdin: Sink.drain,
					stdout,
					stderr: Stream.empty,
					all: stdout,
					getInputFd: () => Sink.drain,
					getOutputFd: () => Stream.empty,
					unref: Effect.succeed(Effect.void),
				});
			}),
		),
	);
