// publish.ts: push the checkout's HEAD to its branch and give the branch a draft pull request when it
// has none (0134). Today's lead tooling, run on our own laptop; it is not product. stepcommit.sh runs
// it right after each commit it signs; a person runs it where a commit step could not push.
//
//   node publish.ts <branch>    run in the checkout; one line on stdout, exit 0 pushed, 1 refused
//
// pr/Publish.ts says what it does. GH_REPO (owner/name) names the repo, else the checkout's origin.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import { run } from "./pr/command.ts";
import * as Publish from "./pr/Publish.ts";
import * as PullRequestsGh from "./pr/PullRequestsGh.ts";
import * as PushesProcess from "./pr/PushesProcess.ts";

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const git = (dir: string, ...args: string[]) => Effect.map(run("git", ["-C", dir, ...args], dir), (r) => r.out.trim());

const main = Effect.fn("publish.main")(function* (branch: string) {
  const dir = process.cwd();
  const head = yield* git(dir, "rev-parse", "--verify", "HEAD");
  const repo = process.env.GH_REPO ?? PullRequestsGh.repoFromUrl(yield* git(dir, "remote", "get-url", "origin"));

  if (head === "" || repo === null) {
    yield* Console.log("publish: refused: no HEAD, or an origin that is not a GitHub repo");
    return yield* setExit(1);
  }

  const title = yield* git(dir, "log", "-1", "--format=%s", head);
  const services = Layer.mergeAll(PushesProcess.layer(import.meta.dirname), PullRequestsGh.layer(repo, dir));
  const text = { title, body: Publish.DRAFT_BODY };
  const published = yield* Publish.publish({ dir, branch, head, text }).pipe(
    Effect.provide(services),
    Effect.map((p) => ({ ok: true, line: Publish.line(branch, p) })),
    Effect.catch((e) => Effect.succeed({ ok: false, line: `refused: ${e.reason}` })),
  );
  yield* Console.log(`publish: ${published.line}`);
  yield* setExit(published.ok ? 0 : 1);
});

if (import.meta.main) {
  const args = process.argv.slice(2);
  const program =
    args.length === 1 ? main(args[0] ?? "") : Effect.andThen(Console.error("usage: publish.ts <branch>"), setExit(2));
  NodeRuntime.runMain(
    program.pipe(
      Effect.catchTag("PlatformError", (e) =>
        Effect.andThen(Console.log(`publish: refused: git could not run: ${e.message}`), setExit(1)),
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
