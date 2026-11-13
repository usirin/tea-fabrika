// P19 next/. Scoped real disk, controlled process edge. This never executes launchctl or plutil.
import { NodeServices } from "@effect/platform-node";
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Schema,
  Sink,
  Stream,
} from "effect";
import { Digest } from "effect/crypto";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";
import { BrainControl } from "../../desktop/BrainControl.ts";
import type * as BrainFilesTest from "../../desktop/BrainFilesTest.ts";
import * as ServiceTest from "../../desktop/BrainServiceTest.ts";
import { BrainSpec } from "../../desktop/BrainSpec.ts";
import * as Launchd from "./BrainControlLaunchd.ts";

type Response = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal?: string;
  // A process that ignores SIGTERM. `started` runs once it is alive; `gone` is its own exit.
  readonly stubborn?: { readonly started: Effect.Effect<void>; readonly gone: Effect.Effect<void> };
};

type Seen = {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ChildProcess.CommandOptions;
};

const failure = (method: string) =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
  PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method });

export const open = Effect.fn("LaunchdTest.open")(function* (
  fault: BrainFilesTest.Fault | "spawn" = "none",
  answer: Response | ((args: ReadonlyArray<string>, spec: BrainSpec) => Effect.Effect<Response>) = {
    code: 0,
    stdout: "",
    stderr: "",
  },
  input: Partial<BrainSpec> = {},
  directoryName = "",
  replacement?: BrainFilesTest.Replacement,
  flags: Record<string, string> = {},
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "p19-unit-" });
  const folder = directoryName === "" ? temporary : path.join(temporary, directoryName);
  yield* fs.makeDirectory(folder, { recursive: true });
  const home = yield* fs.realPath(folder);
  const plist = path.join(home, "brain.plist");
  const competing = yield* replacement === undefined
    ? Effect.succeed(null)
    : fs.makeTempFileScoped({ directory: home, prefix: ".competing-" });
  let failing = true;
  let directoryFault = fault === "directory-sync";
  const events: Array<string> = [],
    seen: Array<Seen> = [],
    jobs: Array<unknown> = [];
  const spec = yield* Schema.decodeUnknownEffect(BrainSpec)({
    home,
    executable: path.join(home, "Electron"),
    args: [path.join(home, "brain.mjs"), "spaces & <angles> 雪"],
    build: "p19-test-build",
    ...input,
    url: "http://127.0.0.1:18787",
  });
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") {
          return yield* failure("pipeline");
        }

        if (fault === "spawn") {
          return yield* failure("spawn");
        }

        const args = command.args.map((arg) => String(arg));
        seen.push({ executable: command.command, args, options: command.options });
        const supplied = typeof answer === "function" ? yield* answer(args, spec) : answer;
        let response: Response = {
          ...supplied,
          stderr: supplied.stderr.replace("test.p19.brain", (args.at(-1) ?? "").split("/").at(-1) ?? ""),
        };

        if (command.command.endsWith("launchctl") && !args.includes("print")) {
          response = { code: 0, stdout: "", stderr: "" };
        }

        if (command.command.endsWith("id")) {
          response = { code: 0, stdout: "501\n", stderr: "" };
        }

        if (command.command.endsWith("plutil")) {
          if (fault === "compile") {
            return yield* failure("compile");
          }

          const input = args.at(-1) ?? "";
          const data = yield* fs.readFileString(input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
            Effect.mapError(() => failure("compile")),
          );
          jobs.push(data);
          const body = JSON.stringify(data);
          const output = args[args.indexOf("-o") + 1];

          if (output !== undefined && output !== "-") {
            yield* fs.writeFileString(output, body);
          }

          response = { code: 0, stdout: output === "-" ? body : "", stderr: "" };
        }

        const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));
        const stubborn = supplied.stubborn;
        const killed = yield* Deferred.make<void>();
        const signaled = (signal: string) =>
          Effect.fail(
            PlatformError.systemError({
              // oxlint-disable-next-line fabrika/no-hand-tag -- edge: match NodeChildProcessSpawner's native signal failure
              _tag: "Unknown",
              module: "ChildProcess",
              method: "exitCode",
              pathOrDescriptor: `${command.command} ${args.join(" ")}`,
              // The installed platform-node 4.1.2 exposes termination signals only in this cause.
              cause: new Error(`Process interrupted due to receipt of signal: '${signal}'`),
            }),
          );
        return yield* Effect.acquireRelease(
          Effect.suspend(() => {
            events.push("spawn");
            return stubborn?.started ?? Effect.void;
          }).pipe(
            Effect.map(() =>
              ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(81),
                exitCode:
                  stubborn !== undefined
                    ? Deferred.await(killed).pipe(Effect.andThen(signaled("SIGKILL")))
                    : response.signal === undefined
                      ? Effect.succeed(ChildProcessSpawner.ExitCode(response.code))
                      : signaled(response.signal),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout: bytes(response.stdout),
                stderr: bytes(response.stderr),
                all: bytes(response.stdout + response.stderr),
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              }),
            ),
          ),
          () =>
            Effect.gen(function* () {
              if (stubborn !== undefined) {
                // As platform-node 4.1.2's terminateProcessGroup: SIGTERM, then SIGKILL only after
                // `forceKillAfter`. With no `forceKillAfter` it waits for the process's own exit.
                events.push("SIGTERM");
                const grace = command.options.forceKillAfter;

                if (grace === undefined) {
                  yield* stubborn.gone;
                } else {
                  // Its own exit ends the wait early, as the real spawner's exit listener does.
                  const exited = yield* stubborn.gone.pipe(Effect.timeoutOption(grace));

                  if (Option.isNone(exited)) {
                    events.push("SIGKILL");
                    yield* Deferred.succeed(killed, undefined);
                  }
                }
              }

              events.push("release");
            }),
        );
      }),
    ),
  );
  const replace = Effect.fnUntraced(function* (checkpoint: BrainFilesTest.Replacement["checkpoint"]) {
    if (replacement?.checkpoint !== checkpoint || competing === null) {
      return;
    }

    // Rename a distinct inode, so a captured copy still holds the old job's bytes.
    yield* fs.writeFileString(competing, replacement.bytes, { mode: 0o600 });
    yield* fs.chmod(competing, 0o600);
    yield* fs.rename(competing, plist);
    events.push(`replace:${checkpoint}`);
  });
  const disk = Layer.succeed(FileSystem.FileSystem, {
    ...fs,
    open: (file, options) =>
      fs.open(file, options).pipe(
        Effect.map(
          (handle) =>
            new Proxy(handle, {
              get(target, key, receiver) {
                if (key === "sync") {
                  return Effect.sync(() => {
                    if (file === home) {
                      events.push("directory-sync");
                    }

                    events.push("sync");
                    events.push(`sync:${file}`);
                  }).pipe(
                    Effect.andThen(
                      (failing && fault === "sync") || (directoryFault && file === home)
                        ? Effect.fail(failure("sync"))
                        : target.sync,
                    ),
                  );
                }

                return Reflect.get(target, key, receiver);
              },
            }),
        ),
      ),
    link: (from, to) =>
      Effect.sync(() => {
        events.push("publish");
        events.push(`publish:${from}`);
      }).pipe(Effect.andThen(fault === "publish" ? Effect.fail(failure("link")) : fs.link(from, to))),
    // Removal captures the plist by renaming it away. A competing writer can land on either side.
    rename: (from, to) =>
      Effect.sync(() => {
        events.push("replaced");
      }).pipe(
        Effect.andThen(from === plist ? replace("before-capture") : Effect.void),
        Effect.andThen(fs.rename(from, to)),
        Effect.andThen(from === plist ? replace("after-capture") : Effect.void),
      ),
  });
  const settings = yield* ServiceTest.timing(flags);
  const context = yield* Layer.build(
    Launchd.layer(spec, settings).pipe(Layer.provide(Layer.mergeAll(disk, spawner, Digest.layerWebCrypto))),
  );
  return {
    recover: Effect.sync(() => {
      failing = false;
      directoryFault = false;
    }),
    failDirectorySync: Effect.sync(() => {
      directoryFault = true;
    }),
    control: Context.get(context, BrainControl),
    spec,
    home,
    seen,
    jobs,
    events,
    settings,
    native: Layer.mergeAll(disk, spawner, Digest.layerWebCrypto),
    read: fs.exists(path.join(home, "brain.plist")).pipe(
      Effect.flatMap((exists) => (exists ? fs.readFileString(path.join(home, "brain.plist")) : Effect.succeed(null))),
      Effect.orDie,
    ),
    seed: (text: string) => fs.writeFileString(path.join(home, "brain.plist"), text).pipe(Effect.orDie),
    entries: fs.readDirectory(home).pipe(Effect.orDie),
  };
});

export const nodeFiles: BrainFilesTest.Open = (fault, replacement) =>
  open(fault, undefined, undefined, undefined, replacement).pipe(Effect.provide(NodeServices.layer));
