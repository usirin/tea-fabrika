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
/**
 * A fixture for the local brain driver's tests: the memory sample's command, answered without
 * starting an OS process.
 *
 * @stability unstable
 */
import { Effect, Layer, Sink, Stream } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
      Effect.sync(() => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
