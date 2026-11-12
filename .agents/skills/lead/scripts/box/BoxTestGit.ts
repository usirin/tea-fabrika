// BoxTestGit.world: the rm suite's world on real git and the real keepruns.sh, in the case's own
// temp folder with its own HOME and no global or system Git config (0052). It keeps the memory
// world honest: the same plans, with real index flags, real changes and real retention.
import { Effect, FileSystem, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as BoxGitProcess from "./BoxGitProcess.ts";
import type { Plan, World } from "./BoxTest.ts";
import * as RunsProcess from "./RunsProcess.ts";

const KEEPRUNS = `${import.meta.dirname}/../keepruns.sh`;

export const world: World = {
  make: Effect.fnUntraced(function* (dir: string, plan: Plan) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const home = `${dir}/home`;
    const main = `${dir}/main`;
    const boxes = `${dir}/boxes`;
    const work = `${boxes}/${plan.name}`;
    const data = `${work}-gitdata`;
    const path = process.env.PATH ?? "/usr/bin:/bin";
    const env = {
      PATH: path,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    };

    const run = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
      const handle = yield* ChildProcess.make(command, args, { env, extendEnv: false, stdin: "ignore" });
      const [out, err, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );

      if (Number(code) !== 0) {
        return yield* Effect.fail(`${command} ${args.join(" ")}: ${err}`);
      }

      return out.trim();
    }, Effect.scoped);
    const git = (at: string, ...args: ReadonlyArray<string>) => run("git", ["-C", at, ...args]);

    for (const folder of [home, main, work]) {
      yield* fs.makeDirectory(folder, { recursive: true });
    }

    yield* git(main, "init", "-q", "--initial-branch=main");
    yield* fs.writeFileString(`${main}/tracked`, "base\n");
    yield* git(main, "add", ".");
    yield* git(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "base");
    yield* git(dir, "clone", "-q", "--bare", "--no-hardlinks", main, `${dir}/origin.git`);
    yield* git(work, "init", "-q", "--initial-branch=main", `--separate-git-dir=${data}`);
    yield* git(work, "remote", "add", "origin", `${dir}/origin.git`);
    yield* git(work, "fetch", "-q", "origin", "main");
    yield* git(work, "checkout", "-q", "-B", "main", "FETCH_HEAD");
    yield* git(work, "config", "user.name", "Fixture");
    yield* git(work, "config", "user.email", "fixture@example.test");

    if (!plan.retained) {
      yield* fs.writeFileString(`${work}/added`, "only in the box\n");
      yield* git(work, "add", "added");
      yield* git(work, "commit", "-qm", "only in the box");
    }

    const tip = yield* git(work, "rev-parse", "HEAD");
    const lost = yield* git(work, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "saved only by ORIG_HEAD");

    if (plan.index === "flagged") {
      yield* git(work, "update-index", "--assume-unchanged", "tracked");
    }

    if (plan.index === "submodule") {
      yield* git(work, "update-index", "--add", "--cacheinfo", `160000,${tip},sub`);
    }

    if (plan.dirty) {
      yield* fs.writeFileString(`${work}/tracked`, "changed\n");
    }

    // A planted git first on the inspection's PATH fails the one subcommand the plan names.
    let inspected = path;

    if (plan.failing !== "none") {
      const real = yield* run("sh", ["-c", "command -v git"]);
      yield* fs.makeDirectory(`${dir}/bin`);
      yield* fs.writeFileString(
        `${dir}/bin/git`,
        `#!/bin/sh\nfor arg do case "$arg" in ${plan.failing}) exit 1;; esac; done\nexec '${real}' "$@"\n`,
      );
      yield* fs.chmod(`${dir}/bin/git`, 0o755);
      inspected = `${dir}/bin:${path}`;
    }

    const layer = Layer.mergeAll(
      BoxGitProcess.layer(main, { PATH: inspected, HOME: home }),
      RunsProcess.layer(KEEPRUNS, {
        PATH: path,
        HOME: home,
        MAIN: main,
        BOXES: boxes,
        REMOTE: "unused",
        GH_REPO: "fixture/repo",
        FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
      }),
    ).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)));
    return { main, boxes, tip, lost, layer };
  }),
};
