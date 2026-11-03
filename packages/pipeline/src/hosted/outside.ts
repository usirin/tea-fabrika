// The writes a hosted stage makes outside the ledger, and the reads that tell whether one was made
// already (experiment 104, S6). `Outside` is the one service a hosted stage writes through, and
// every write on it takes a `Key` (./idempotency.ts), so a write with no key does not compile.
// Each implementation calls `useKey` before it sends: a forged key, or one whose send is over, is
// refused there, and nothing is sent.
//
// Two implementations: GitHub (below, gh and git on this machine, for the sandbox runs) and the
// experiment's fake code host (experiments/104-stages-on-tea-host/world.ts). Both push with git,
// so the push and the branch read are shared here: only the remote's url differs.
//
// Never a forced push. A push that is not a fast-forward is refused by the remote, and the push
// here checks first that the branch is still where the ledger says it was (a compare-and-set on
// the commit). A forced push, were one ever needed, would be `--force-with-lease` on the commit the
// ledger recorded: none is made in this experiment.
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {hostEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Context, Effect, Layer, Schema} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild, runLow} from "../child.ts";
import {codeHostWritesOn} from "../code-host-github-writes.ts";
import {answerOf, type Gh, prOf} from "../code-host-github.ts";
import type {Merged, Rerun} from "../stages/ship/facts.ts";
import type {OnMain, ReadyToMerge} from "../stages/ship/ready.ts";
import {type Key, type KeyRefused, markerOf, useKey} from "./idempotency.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** A repository, `owner/name`. */
export interface Repo {
	readonly owner: string;
	readonly name: string;
}
export const repoText = (r: Repo) => `${r.owner}/${r.name}`;

/** What an enqueue answers, as `CodeHostWrites` says it. */
export const EnqueueAnswer = Schema.Literals(["queued", "head_moved", "conflicts", "no_queue"]);
export type EnqueueAnswer = typeof EnqueueAnswer.Type;

/** Where a pull request stands, as a ship's write would leave it. */
export type Landing =
	| {readonly at: "none"}
	| {readonly at: "queued"}
	| {readonly at: "merged"; readonly commit: string};

export class Outside extends Context.Service<
	Outside,
	{
		// ------------------------------------------------ reads: is a write out there already?
		/** The branch's commit on the remote. `null`: there is no such branch. */
		readonly branchHead: (repo: Repo, branch: string) => Effect.Effect<string | null, Failed>;
		/** The open pull request from `branch`, as its url. `null`: none. */
		readonly prFrom: (repo: Repo, branch: string) => Effect.Effect<string | null, Failed>;
		/** A comment on `pr` carries this key's marker. */
		readonly hasComment: (pr: string, key: string) => Effect.Effect<boolean, Failed>;
		/** Where `pr` stands at `head`: in the queue, merged, or neither. */
		readonly landing: (pr: string, head: string) => Effect.Effect<Landing, Failed>;
		/** The url git pushes to and fetches from. */
		readonly remote: (repo: Repo) => string;

		// ------------------------------------------------ writes: each one takes a key
		/** Push `sha` from the working copy at `tree` to `branch`. Never forced. */
		readonly push: (
			key: Key,
			at: {
				readonly repo: Repo;
				readonly tree: string;
				readonly branch: string;
				readonly sha: string;
			},
		) => Effect.Effect<void, Failed | KeyRefused>;
		/** Open a pull request from `branch` to `main`. Its body carries the key's marker. Answers its url. */
		readonly open: (
			key: Key,
			at: {
				readonly repo: Repo;
				readonly branch: string;
				readonly title: string;
				readonly body: string;
			},
		) => Effect.Effect<string, Failed | KeyRefused>;
		/** One comment on `pr`. Its body carries the key's marker. */
		readonly comment: (
			key: Key,
			pr: string,
			body: string,
		) => Effect.Effect<void, Failed | KeyRefused>;
		readonly enqueue: (
			key: Key,
			ready: ReadyToMerge,
		) => Effect.Effect<EnqueueAnswer, Failed | KeyRefused>;
		readonly merge: (key: Key, ready: OnMain) => Effect.Effect<Merged, Failed | KeyRefused>;
		readonly rerunChecks: (
			key: Key,
			pr: string,
			head: string,
		) => Effect.Effect<readonly Rerun[], Failed | KeyRefused>;
	}
>()("@kampus/fabrika-old/pipeline/Outside") {}

/** A text with its key's marker on its last line. */
export const marked = (text: string, key: string) => `${text}\n\n${markerOf(key)}`;

// ---------------------------------------------------------------- git, shared

/** Every git call: no prompt, no hook of the repo's, no pager. */
export const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
const ok = (exited: Exited): Effect.Effect<string, Failed> =>
	exited.code === 0 ? Effect.succeed(exited.out) : failed;

/** git on Effect's `ChildProcess`, under `env`. `low`: at `nice -n 19`, for the heavy calls. */
export const gitOn = (env: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);
		const git = (args: readonly string[]) =>
			on(runChild("git", [...GIT_FIRST, ...args], {env})).pipe(
				Effect.mapError((): Failed => ({_tag: "unknown"})),
			);
		const gitLow = (args: readonly string[]) =>
			on(runLow("git", [...GIT_FIRST, ...args], {env})).pipe(
				Effect.mapError((): Failed => ({_tag: "unknown"})),
			);
		return {
			git,
			gitLow,
			ok: (args: readonly string[]) => git(args).pipe(Effect.flatMap(ok)),
			okLow: (args: readonly string[]) => gitLow(args).pipe(Effect.flatMap(ok)),
		};
	});
export type Git = Effect.Success<ReturnType<typeof gitOn>>;

/** The branch's commit at `remote`, by `git ls-remote`. */
export const branchHeadAt = (git: Git, remote: string, branch: string) =>
	git
		.okLow(["ls-remote", remote, `refs/heads/${branch}`])
		.pipe(Effect.map((out) => out.trim().split(/\s+/)[0] || null));

/**
 * The push, keyed: the branch is read first, and the push goes only from where the ledger said it
 * stood (`from`, the round's base; null for a new branch). Never forced.
 */
export const pushWith =
	(git: Git, remote: (repo: Repo) => string) =>
	(
		key: Key,
		at: {readonly repo: Repo; readonly tree: string; readonly branch: string; readonly sha: string},
	) =>
		Effect.gen(function* () {
			yield* useKey(key);
			yield* git.okLow([
				"-C",
				at.tree,
				"push",
				"--no-verify",
				remote(at.repo),
				`${at.sha}:refs/heads/${at.branch}`,
			]);
		});

// ---------------------------------------------------------------- GitHub

const PullRequest = Schema.Struct({html_url: Schema.String, number: Schema.Finite});
const PullRequests = Schema.Array(PullRequest);
const Comments = Schema.Array(Schema.Struct({body: Schema.String}));
const LandingAnswer = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.Struct({
				state: Schema.String,
				headRefOid: Schema.String,
				mergeQueueEntry: Schema.NullOr(Schema.Struct({state: Schema.String})),
				mergeCommit: Schema.NullOr(Schema.Struct({oid: Schema.String})),
			}),
		}),
	}),
});
const LANDING = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state headRefOid mergeQueueEntry { state } mergeCommit { oid } }
  }
}`;

/**
 * `Outside` on GitHub: gh and git on this machine, with the host's short environment. `repos`: the
 * only repositories it may write to; a write anywhere else is refused before anything is sent.
 */
export const gitHubOutside = (repos: readonly string[]): Layer.Layer<Outside> =>
	Layer.effect(
		Outside,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const env = {...hostEnv(), GIT_TERMINAL_PROMPT: "0"};
			const git = yield* gitOn(env);
			const gh: Gh = (args) =>
				runChild("gh", args, {env}).pipe(
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.mapError((): Failed => ({_tag: "unknown"})),
					Effect.flatMap(ok),
				);
			const writes = codeHostWritesOn(gh);
			const allowed = (repo: Repo) => repos.includes(repoText(repo));
			const prRepo = (pr: string) => {
				const at = prOf(pr);
				return at === null || !allowed(at) ? null : at;
			};
			const remote = (repo: Repo) => `https://github.com/${repoText(repo)}`;
			const push = pushWith(git, remote);
			return Outside.of({
				remote,
				branchHead: (repo, branch) => branchHeadAt(git, remote(repo), branch),
				prFrom: (repo, branch) =>
					answerOf(gh, PullRequests, [
						"api",
						`repos/${repoText(repo)}/pulls?head=${repo.owner}:${branch}&state=open&per_page=10`,
					]).pipe(Effect.map((found) => found[0]?.html_url ?? null)),
				hasComment: (pr, key) =>
					Effect.gen(function* () {
						const at = prOf(pr);
						if (at === null) return yield* failed;
						const there = yield* answerOf(gh, Comments, [
							"api",
							`repos/${at.owner}/${at.name}/issues/${at.number}/comments?per_page=100`,
						]);
						return there.some((c) => c.body.includes(markerOf(key)));
					}),
				landing: (pr, head) =>
					Effect.gen(function* () {
						const at = prOf(pr);
						if (at === null) return yield* failed;
						const answer = yield* answerOf(gh, LandingAnswer, [
							"api",
							"graphql",
							"-f",
							`query=${LANDING}`,
							"-f",
							`owner=${at.owner}`,
							"-f",
							`name=${at.name}`,
							"-F",
							`number=${at.number}`,
						]);
						const p = answer.data.repository.pullRequest;
						if (p.state === "MERGED" && p.mergeCommit !== null)
							return {at: "merged", commit: p.mergeCommit.oid} as const;
						if (p.mergeQueueEntry !== null && p.headRefOid === head) return {at: "queued"} as const;
						return {at: "none"} as const;
					}),
				push: (key, at) => (allowed(at.repo) ? push(key, at) : failed),
				open: (key, at) =>
					Effect.gen(function* () {
						const text = yield* useKey(key);
						if (!allowed(at.repo)) return yield* failed;
						const made = yield* answerOf(gh, PullRequest, [
							"api",
							"--method",
							"POST",
							`repos/${repoText(at.repo)}/pulls`,
							"-f",
							`title=${at.title}`,
							"-f",
							`head=${at.branch}`,
							"-f",
							"base=main",
							"-f",
							`body=${marked(at.body, text)}`,
						]);
						return made.html_url;
					}),
				comment: (key, pr, body) =>
					Effect.gen(function* () {
						const text = yield* useKey(key);
						const at = prRepo(pr);
						if (at === null) return yield* failed;
						yield* gh([
							"api",
							"--method",
							"POST",
							`repos/${at.owner}/${at.name}/issues/${at.number}/comments`,
							"-f",
							`body=${marked(body, text)}`,
						]);
					}),
				enqueue: (key, ready) =>
					useKey(key).pipe(
						Effect.andThen(prRepo(ready.pr) === null ? failed : writes.enqueue(ready)),
					),
				merge: (key, ready) =>
					useKey(key).pipe(
						Effect.andThen(prRepo(ready.pr) === null ? failed : writes.merge(ready)),
					),
				rerunChecks: (key, pr, head) =>
					useKey(key).pipe(
						Effect.andThen(prRepo(pr) === null ? failed : writes.rerunChecks(pr, head)),
					),
			});
		}),
	).pipe(Layer.provide(nodeServices));
