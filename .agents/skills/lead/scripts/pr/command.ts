// command: one child process run to its end, its output read whole. The process layers of this
// folder share it; each turns a failure into its own service's error.
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** What one run left: its stdout, its stderr and its exit code. */
export type Ran = { readonly out: string; readonly err: string; readonly code: number };

/** The last line a run wrote that is not empty, stderr first: the one a failure reason shows. */
export const lastLine = (ran: Ran): string =>
  [...`${ran.out}\n${ran.err}`.split("\n")].reverse().find((line) => line.trim() !== "") ?? "";

/** Runs `cmd` with `args` in `cwd`, stdin closed, and waits for it to end. */
export const run = Effect.fnUntraced(function* (cmd: string, args: ReadonlyArray<string>, cwd: string) {
  const handle = yield* ChildProcess.make(cmd, [...args], { cwd, stdin: "ignore" });
  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );
  return { out, err, code: Number(code) } satisfies Ran;
}, Effect.scoped);
