// PushesProcess.layer: the Pushes service on the repo's own scripts. The leak grep is leakgrep.sh,
// as it is; a push is botpush.mjs, the bot's one atomic push of the branch and the step notes. A
// branch outside `fabrikalfa/` is the person's own: the bot sends the notes alone, and git pushes
// the branch on the person's own login, never forced.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "./command.ts";
import { LeakGrepRefused, Pushes, PushRefused } from "./Pushes.ts";

/** Whether the bot pushes `branch` itself: it takes only `fabrikalfa/` branches. */
export const isBotBranch = (branch: string): boolean => branch.startsWith("fabrikalfa/");

/** `scripts` is the lead's scripts folder, where the leak grep and the bot's push sit. */
export const layer = (scripts: string): Layer.Layer<Pushes, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Pushes,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const ran = (cmd: string, args: ReadonlyArray<string>, cwd: string, stdin?: string) =>
        run(cmd, args, cwd, stdin === undefined ? {} : { stdin }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        );

      const leakGrep = Effect.fn("PushesProcess.leakGrep")(
        function* (dir: string, head: string) {
          const grep = yield* ran("sh", [`${scripts}/leakgrep.sh`, "--commits", `origin/main..${head}`], dir);

          if (grep.code !== 0) {
            return yield* new LeakGrepRefused({ reason: `leakgrep.sh exited ${grep.code}: ${lastLine(grep)}` });
          }
        },
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new LeakGrepRefused({ reason: `leakgrep.sh could not start: ${e.message}` })),
        ),
      );

      const leakChange = Effect.fn("PushesProcess.leakChange")(
        function* (dir: string, head: string) {
          const fetched = yield* ran("git", ["-C", dir, "fetch", "-q", "origin", "main", head], dir);

          if (fetched.code !== 0) {
            return yield* new LeakGrepRefused({
              reason: `main and ${head} could not be fetched: ${lastLine(fetched)}`,
            });
          }

          // The diff is read whole before the grep starts, so a diff that fails is never an empty pass.
          const range = `origin/main...${head}`;
          const diff = yield* ran(
            "git",
            ["-C", dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=0", range],
            dir,
          );

          if (diff.code !== 0) {
            return yield* new LeakGrepRefused({ reason: `the diff ${range} does not read: ${lastLine(diff)}` });
          }

          const grep = yield* ran("sh", [`${scripts}/leakgrep.sh`], dir, `${diff.out}\n`);

          if (grep.code !== 0) {
            return yield* new LeakGrepRefused({ reason: `leakgrep.sh exited ${grep.code}: ${lastLine(grep)}` });
          }
        },
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new LeakGrepRefused({ reason: `the leak grep could not start: ${e.message}` })),
        ),
      );

      const leakText = Effect.fn("PushesProcess.leakText")(
        function* (dir: string, text: string) {
          const grep = yield* ran("sh", [`${scripts}/leakgrep.sh`, "--text", "/dev/stdin"], dir, text);

          if (grep.code !== 0) {
            return yield* new LeakGrepRefused({
              reason: `leakgrep.sh --text exited ${grep.code}: ${lastLine(grep)}`,
            });
          }
        },
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new LeakGrepRefused({ reason: `the leak grep could not start: ${e.message}` })),
        ),
      );

      const step = Effect.fn("PushesProcess.step")(function* (cmd: string, args: ReadonlyArray<string>, dir: string) {
        const pushed = yield* ran(cmd, args, dir);

        if (pushed.code !== 0) {
          return yield* new PushRefused({ reason: `${cmd} exited ${pushed.code}: ${lastLine(pushed)}` });
        }
      });

      const push = Effect.fn("PushesProcess.push")(
        function* (dir: string, branch: string, head: string) {
          const botpush = `${scripts}/botpush.mjs`;

          if (isBotBranch(branch)) {
            return yield* step("node", [botpush, dir, branch, head], dir);
          }

          yield* step("node", [botpush, dir, "-"], dir);
          yield* step("git", ["-C", dir, "push", "-q", "origin", `${head}:refs/heads/${branch}`], dir);
        },
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new PushRefused({ reason: `the push could not start: ${e.message}` })),
        ),
      );

      return Pushes.of({ leakGrep, leakChange, leakText, push });
    }),
  );
