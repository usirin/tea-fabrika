/**
 * A fixture for the local brain driver's tests: the memory sample's command, answered without
 * starting an OS process.
 *
 * @stability unstable
 */
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";

/**
 * Layer that provides a `ChildProcessSpawner` whose every command exits with 0 at once and prints
 * `sample()` on stdout, so the driver's memory check reads a chosen number and no OS process
 * starts. `onSpawn`, when given, hears each standard command with its arguments.
 *
 * @stability unstable
 * @category layers
 */
export const rssLayer = (sample: () => number, onSpawn?: (command: string, args: ReadonlyArray<unknown>) => void) =>
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
