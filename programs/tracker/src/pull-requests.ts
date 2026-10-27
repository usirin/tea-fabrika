import {Context, Duration, Effect, Layer, Schema, Stream} from "effect";
import type {PullRequestsSub, pullRequests} from "./machine.ts";

// The open pull requests the tracker's list shows next to the tickets, and the door they come in
// through: the `PullRequests` service. The tracker is its own thing, tied to no repository, the way
// Linear is; GitHub is one integration behind this door (./github.ts).
//
//   PullRequests.open
//   // [{repo: "https://github.com/<owner>/<name>", number: 113, title: "...", url: ..., draft: false, at: ...}]
//
//   pullRequestsOf([...])      a fixed list, for a test; pullRequestsOf([]) for none
//
// A pull request's title is anyone's words: on a public repository a stranger can open one. The
// window draws it as text.

/** An open pull request, as the tracker's list shows it. `at`: when it last changed, in ms. */
export const PullRequest = Schema.Struct({
	/** The repository's URL, `https://github.com/<owner>/<name>`. */
	repo: Schema.String,
	number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	title: Schema.String,
	/** Its page. Only GitHub's own: the window hands it to the person's browser. */
	url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\//)),
	draft: Schema.Boolean,
	at: Schema.Finite,
});
export type PullRequest = typeof PullRequest.Type;

/** The pull requests could not be read, and why in words. */
export type PullRequestsUnreachable = {readonly _tag: "unreachable"; readonly why: string};

/** The door: the open pull requests of every connected repository. */
export class PullRequests extends Context.Service<
	PullRequests,
	{readonly open: Effect.Effect<readonly PullRequest[], PullRequestsUnreachable>}
>()("@tea-fabrika/tracker/PullRequests") {}

/** A fixed list, for a test or a host with no integration. */
export const pullRequestsOf = (list: readonly PullRequest[]) =>
	Layer.succeed(PullRequests, {open: Effect.succeed(list)});

/** A repository's short name, `<name>`, from its URL. */
export const nameOf = (repo: string) => repo.replace(/\/+$/, "").split("/").at(-1) ?? repo;

/** How long the list waits before it reads the pull requests again. */
export const PULL_REQUESTS_EVERY = Duration.minutes(2);

/** Read the open pull requests: the `pull_requests` Cmd's cell. */
export const pullRequestsCell = (_cmd: ReturnType<typeof pullRequests>) =>
	Effect.gen(function* () {
		return {pullRequests: yield* (yield* PullRequests).open};
	});

/** `refresh`, once `PULL_REQUESTS_EVERY` has gone by. */
export const pullRequestsWaitRunner = (_sub: PullRequestsSub) =>
	Stream.fromEffect(Effect.sleep(PULL_REQUESTS_EVERY)).pipe(
		Stream.map(() => ({type: "refresh" as const})),
	);
