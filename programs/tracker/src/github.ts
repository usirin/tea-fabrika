import { CodeHost, CodeTree } from "@kampus/pipeline/services";
import { Effect, Layer } from "effect";
import { FoldersUnreachable, RepoTree } from "./folders.ts";
import { nameOf, type PullRequest, PullRequests, type PullRequestsUnreachable } from "./pull-requests.ts";

// The tracker's GitHub integration, as Linear's is: the tracker stays its own thing, and GitHub
// comes in here. It reads each connected repository's open pull requests through the pipeline's
// `CodeHost`, so on the person's own `gh` login, as the pipeline does. The tracker holds no token,
// and nothing about the login reaches its window.
//
//   Layer.provide(gitHubPullRequests(GITHUB), gitHubCodeHost({own: [], reviewers: []}))
//   // PullRequests.open: [{repo: "https://github.com/<owner>/<name>", number: 113, ...}, ...]
//
// Which repositories are connected is this integration's setting, one list, as Linear's "which
// repos" pick is. Linking a pull request to a ticket comes later.
//
// It also lists the connected repositories' top folders, through the pipeline's `CodeTree`, for
// the onboarding step's suggestions (./folders.ts):
//
//   Layer.provide(gitHubRepoTree(GITHUB), gitHubCodeTree({}))
//   // RepoTree.folders: ["programs/tracker", ..., "apps/fabrika"]

/**
 * The integration's settings: which repositories are connected, by URL, and the folders whose own
 * folders the onboarding step may suggest an area from.
 */
export interface GitHubSettings {
  readonly repos: readonly string[];
  readonly under: readonly string[];
}

/** The connected repositories. Add one here and its open pull requests show in the list. */
export const GITHUB: GitHubSettings = {
  repos: ["https://github.com/usirin/tea-fabrika"],
  under: ["programs", "packages", "apps"],
};

/**
 * `RepoTree` on `CodeTree`: the folders under `under` in every connected repository, in the
 * settings' order. Read once a session: a list that came back is kept, and a read that failed is
 * tried again by the next tracker that asks.
 */
export const gitHubRepoTree = (settings: GitHubSettings) =>
  Layer.effect(
    RepoTree,
    Effect.gen(function* () {
      const tree = yield* CodeTree;
      let kept: readonly string[] | null = null;
      const read = Effect.forEach(
        settings.repos,
        (repo) =>
          tree
            .folders(repo, settings.under)
            .pipe(Effect.mapError(() => new FoldersUnreachable({ why: `could not read ${nameOf(repo)}'s folders` }))),
        { concurrency: 1 },
      ).pipe(
        Effect.map((lists) => lists.flat()),
        Effect.tap((list) =>
          Effect.sync(() => {
            kept = list;
          }),
        ),
      );
      return { folders: Effect.suspend(() => (kept === null ? read : Effect.succeed(kept))) };
    }),
  );

/**
 * `PullRequests` on `CodeHost`: every connected repository read, one after another, in the
 * settings' order. One that cannot be read fails the read: a list missing a repository would look
 * as if it had nothing open.
 */
export const gitHubPullRequests = (settings: GitHubSettings) =>
  Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const host = yield* CodeHost;
      const open = Effect.forEach(
        settings.repos,
        (repo) =>
          host.pullRequests(repo).pipe(
            Effect.map((list) => list.map((pr): PullRequest => ({ repo, ...pr }))),
            Effect.mapError((): PullRequestsUnreachable => ({
              _tag: "unreachable",
              why: `could not read ${nameOf(repo)}'s pull requests`,
            })),
          ),
        { concurrency: 1 },
      ).pipe(Effect.map((lists) => lists.flat()));
      return { open };
    }),
  );
