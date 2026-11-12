// unlisted.ts: list every branch, on the laptop or pushed, that holds commits not on main and has no
// open pull request, and apart from them the ones whose work is on main already (0134). Today's lead
// tooling, run on our own laptop; it is not product. The lead runs it every round.
//
//   node unlisted.ts    run in the main checkout; one line per branch, then a count
//
// It fetches origin with --prune first and deletes nothing. Exit 0 whatever it finds, for now; 1
// when a read fails, since then it cannot tell. GH_REPO (owner/name) names the repo, else origin.
// pr/Unlisted.ts says how each branch is sorted.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import * as BranchesGit from "./pr/BranchesGit.ts";
import { run } from "./pr/command.ts";
import * as PullRequestsGh from "./pr/PullRequestsGh.ts";
import * as Unlisted from "./pr/Unlisted.ts";

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const main = Effect.gen(function* () {
  const dir = process.cwd();
  const origin = yield* run("git", ["-C", dir, "remote", "get-url", "origin"], dir);
  const repo = process.env.GH_REPO ?? PullRequestsGh.repoFromUrl(origin.out);

  if (repo === null) {
    yield* Console.log("unlisted: cannot tell: origin is not a GitHub repo");
    return yield* setExit(1);
  }

  const services = Layer.mergeAll(BranchesGit.layer(dir), PullRequestsGh.layer(repo, dir));
  const report = yield* Unlisted.check().pipe(
    Effect.provide(services),
    Effect.map((r) => ({ ok: true, lines: Unlisted.lines(r) })),
    Effect.catch((e) => Effect.succeed({ ok: false, lines: [`unlisted: cannot tell: ${e.reason}`] })),
  );

  for (const line of report.lines) {
    yield* Console.log(line);
  }

  yield* setExit(report.ok ? 0 : 1);
});

if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(
      Effect.catchTag("PlatformError", (e) =>
        Effect.andThen(Console.log(`unlisted: cannot tell: git could not run: ${e.message}`), setExit(1)),
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
