// BranchesGit.layer: the Branches service on real git, in one checkout. The trial merge is
// `git merge-tree --write-tree` (git 2.38 and later): it merges in the object store and touches no
// work tree, index or ref, so the check changes nothing but origin's remote-tracking refs.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type Branch, Branches, BranchesError } from "./Branches.ts";
import { lastLine, run } from "./command.ts";

const LOCAL = "refs/heads/";
const ORIGIN = "refs/remotes/origin/";

/** One `for-each-ref` line, `<ref> <oid>`, as a branch; `null` for main, origin's HEAD or another ref. */
export const fromRefLine = (line: string): Branch | null => {
  const [ref = "", tip = ""] = line.split(" ");
  const [location, name] = ref.startsWith(LOCAL)
    ? (["local", ref.slice(LOCAL.length)] as const)
    : ref.startsWith(ORIGIN)
      ? (["origin", ref.slice(ORIGIN.length)] as const)
      : [null, ""];
  return location === null || name === "" || name === "main" || name === "HEAD" || tip === ""
    ? null
    : { name, location, tip };
};

export const layer = (dir: string): Layer.Layer<Branches, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Branches,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One git call; exit codes other than those `ok` names fail it. */
      const git = Effect.fn("BranchesGit.git")(
        function* (args: ReadonlyArray<string>, ok: ReadonlyArray<number> = [0]) {
          const ran = yield* run("git", ["-C", dir, ...args], dir);

          if (!ok.includes(ran.code)) {
            return yield* new BranchesError({ command: args[0] ?? "", reason: `exited ${ran.code}: ${lastLine(ran)}` });
          }

          return ran;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        (effect, args) =>
          Effect.catchTag(effect, "PlatformError", (e) =>
            Effect.fail(new BranchesError({ command: args[0] ?? "", reason: e.message })),
          ),
      );

      const list = Effect.map(git(["for-each-ref", "--format=%(refname) %(objectname)", LOCAL, ORIGIN]), (ran) =>
        ran.out.split("\n").flatMap((line) => fromRefLine(line) ?? []),
      );

      const ahead = (tip: string) =>
        Effect.map(git(["rev-list", "--count", `origin/main..${tip}`]), (ran) => Number(ran.out.trim()));

      // merge-tree exits 0 with the merged tree's oid on its first line, 1 on a conflict.
      const landsEmpty = Effect.fn("BranchesGit.landsEmpty")(function* (tip: string) {
        const merged = yield* git(["merge-tree", "--write-tree", "origin/main", tip], [0, 1]);
        const main = yield* git(["rev-parse", "origin/main^{tree}"]);
        return merged.code === 0 && merged.out.split("\n")[0]?.trim() === main.out.trim();
      });

      return Branches.of({
        refresh: Effect.asVoid(git(["fetch", "-q", "--prune", "origin"])),
        list,
        ahead,
        landsEmpty,
      });
    }),
  );
