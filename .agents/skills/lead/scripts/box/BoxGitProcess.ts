// BoxGitProcess.layer: the BoxGit service on real git, run from MAIN. Git sees neither inherited
// settings nor the box's own config, hooks, fsmonitor or attributes: the caller passes an
// environment with every GIT_ variable gone, and each call turns the box's programs off.
import { Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { BoxGit, BoxGitError, type Inspection } from "./BoxGit.ts";

/** Settings no box config can turn back on, so inspection never runs a program from the box. */
const OFF = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "core.untrackedCache=false",
];

/** Git's own variables, set for every call; nothing the caller inherited reaches git. */
const PINNED = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_PAGER: "cat",
  LC_ALL: "C",
};

/** `inherited` without a single GIT_ variable, then git's pinned ones. */
const gitEnv = (inherited: Readonly<Record<string, string | undefined>>): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !key.startsWith("GIT_")) {
      env[key] = value;
    }
  }

  return { ...env, ...PINNED };
};

const text = new TextDecoder();

const lines = (out: string) => out.split("\n").filter((line) => line !== "");

export const layer = (
  main: string,
  inherited: Readonly<Record<string, string | undefined>>,
): Layer.Layer<BoxGit, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    BoxGit,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const env = gitEnv(inherited);

      /** One git call from MAIN, at `at` when given; any exit but 0, or any stderr, fails it. */
      const git = Effect.fn("BoxGitProcess.git")(
        function* (at: Inspection | null, args: ReadonlyArray<string>) {
          const into = at === null ? [] : [`--git-dir=${at.gitDir}`, `--work-tree=${at.work}`];
          const handle = yield* ChildProcess.make("git", ["-C", main, ...into, ...OFF, ...args], {
            env,
            extendEnv: false,
            stdin: "ignore",
          });
          const [out, err, code] = yield* Effect.all(
            [Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr), handle.exitCode],
            { concurrency: 3 },
          );

          if (Number(code) !== 0 || err.length > 0) {
            return yield* new BoxGitError({ command: args[0] ?? "" });
          }

          return text.decode(out);
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        (effect, _at, args) =>
          Effect.catchTag(effect, "PlatformError", (cause) => new BoxGitError({ command: args[0] ?? "", cause })),
      );

      return BoxGit.of({
        indexEntries: (at) => Effect.map(git(at, ["ls-files", "--stage", "-v", "-z"]), (out) => out.split("\0")),
        trackedChanges: (at) =>
          Effect.map(git(at, ["status", "--porcelain=v1", "-z", "--untracked-files=no"]), (out) => out !== ""),
        refs: (at) =>
          Effect.map(git(at, ["for-each-ref", "--format=%(refname) %(objectname)"]), (out) =>
            lines(out).map((line) => {
              const space = line.indexOf(" ");
              return { ref: line.slice(0, space), oid: line.slice(space + 1) };
            }),
          ),
        objectsAt: (at, ref) => Effect.map(git(at, ["rev-parse", "--verify", `${ref}^{object}`]), lines),
        retained: Effect.map(
          git(null, [
            "for-each-ref",
            "--format=%(objectname)",
            "refs/heads/",
            "refs/tags/",
            "refs/keep/",
            "refs/stash",
            "refs/notes/",
          ]),
          lines,
        ),
        reachable: (tips) =>
          tips.length === 0
            ? Effect.succeed(new Set<string>())
            : Effect.map(
                git(null, ["rev-list", "--objects", "--no-object-names", ...tips]),
                (out) => new Set(lines(out)),
              ),
      });
    }),
  );
