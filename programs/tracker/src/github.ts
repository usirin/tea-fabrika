import {CodeHost} from "@kampus/pipeline/services";
import {Effect, Layer} from "effect";
import {nameOf, type Pull, Pulls, type PullsUnreachable} from "./pulls.ts";

// The tracker's GitHub integration, as Linear's is: the tracker stays its own thing, and GitHub
// comes in here. It reads each connected repository's open pull requests through the pipeline's
// `CodeHost`, so on the person's own `gh` login, as the pipeline does. The tracker holds no token,
// and nothing about the login reaches its window.
//
//   Layer.provide(gitHubPulls(GITHUB), gitHubCodeHost({own: [], reviewers: []}))
//   // Pulls.open: [{repo: "https://github.com/<owner>/<name>", number: 113, ...}, ...]
//
// Which repositories are connected is this integration's setting, one list, as Linear's "which
// repos" pick is. Linking a pull request to a ticket comes later.

/** The integration's settings: which repositories are connected, by URL. */
export interface GitHubSettings {
	readonly repos: readonly string[];
}

/** The connected repositories. Add one here and its open pull requests show in the list. */
export const GITHUB: GitHubSettings = {
	repos: ["https://github.com/usirin/tea-fabrika"],
};

/**
 * `Pulls` on `CodeHost`: every connected repository read, one after another, in the settings'
 * order. One that cannot be read fails the read: a list missing a repository would look as if it
 * had nothing open.
 */
export const gitHubPulls = (settings: GitHubSettings) =>
	Layer.effect(
		Pulls,
		Effect.gen(function* () {
			const host = yield* CodeHost;
			const open = Effect.forEach(
				settings.repos,
				(repo) =>
					host.openPulls(repo).pipe(
						Effect.map((list) => list.map((p): Pull => ({repo, ...p}))),
						Effect.mapError(
							(): PullsUnreachable => ({
								_tag: "unreachable",
								why: `could not read ${nameOf(repo)}'s pull requests`,
							}),
						),
					),
				{concurrency: 1},
			).pipe(Effect.map((lists) => lists.flat()));
			return {open};
		}),
	);
