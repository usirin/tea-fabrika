import {Effect, Layer, Schema} from "effect";
import {answerOf, ask, type Gh, prOf} from "./code-host-github.ts";
import {CodeHostWrites} from "./services.ts";
import {sh} from "./sh.ts";
import type {Merged, Rerun} from "./stages/ship/facts.ts";

// `CodeHostWrites` on GitHub: the three things the ship machine changes on a
// pull request. Every call here that writes is listed, whole, below. There is
// no other.
//
//   enqueue      gh api graphql -f pull=<id> -f head=<commit> -f query=<ENQUEUE_WRITE>
//   merge        on a base branch GitHub holds no rule for, pinned to the main it was tested on:
//                  gh api --method POST repos/<owner>/<name>/git/commits      (a merge commit: parents tested, head)
//                  gh api --method PATCH repos/<owner>/<name>/git/refs/heads/<base> -F force=false
//                else:
//                  gh api graphql -f pull=<id> -f head=<commit> -f method=<method> -f query=<MERGE_WRITE>
//   rerunChecks  gh api --method POST repos/<owner>/<name>/actions/runs/<run>/rerun-failed-jobs
//
// `merge` is for a repository with no merge queue only: the ship machine asks
// for it after `enqueue` answers `no_queue`. What is never done here: arming
// "merge when ready", deleting a branch, an owner's bypass of the branch
// rules, a label, a comment.

const failed = Effect.fail({_tag: "unknown" as const});

// ---------------------------------------------------------------- enqueue

/** The read before the write: where the pull request stands. */
export const ENQUEUE_READ = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id state headRefOid mergeable isInMergeQueue isMergeQueueEnabled }
  }
}`;
const Stands = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.Struct({
				id: Schema.String,
				state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
				headRefOid: Schema.String,
				mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
				isInMergeQueue: Schema.Boolean,
				isMergeQueueEnabled: Schema.Boolean,
			}),
		}),
	}),
});
type Standing = (typeof Stands.Type)["data"]["repository"]["pullRequest"];

/**
 * The one write of an enqueue. `expectedHeadOid` makes GitHub itself refuse
 * when the head is no longer this commit: the check and the write are one
 * call, so no push can slip between them. It names no merge method (the
 * queue owns that) and it is not "merge when ready".
 */
export const ENQUEUE_WRITE = `
mutation($pull: ID!, $head: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $pull, expectedHeadOid: $head }) { mergeQueueEntry { id } }
}`;
const Enqueued = Schema.Struct({
	data: Schema.Struct({
		enqueuePullRequest: Schema.Struct({mergeQueueEntry: Schema.Struct({id: Schema.String})}),
	}),
});

/** What a reading of the pull request already answers. `null`: nothing yet. */
const answered = (pr: Standing, head: string): "queued" | "head_moved" | "conflicts" | null =>
	// Merged, or in the queue already: an enqueue sent a second time finds its own first write.
	pr.state === "MERGED"
		? "queued"
		: pr.headRefOid !== head
			? "head_moved"
			: pr.isInMergeQueue
				? "queued"
				: pr.mergeable === "CONFLICTING"
					? "conflicts"
					: null;

/**
 * Put `head` in the merge queue of its pull request.
 *
 * It reads first, and writes only when the reading does not already answer.
 * On a repo with no merge queue it writes nothing and answers `no_queue`.
 * When GitHub refuses the write, why is read from the pull request again,
 * never guessed from the refusal's words.
 */
export const enqueueOn =
	(gh: Gh) =>
	(
		url: string,
		head: string,
	): Effect.Effect<
		"queued" | "head_moved" | "conflicts" | "no_queue",
		{readonly _tag: "unknown"}
	> =>
		Effect.gen(function* () {
			const at = prOf(url);
			if (at === null) return yield* failed;
			const stands = ask(gh, Stands, ENQUEUE_READ, at).pipe(
				Effect.map((answer) => answer.data.repository.pullRequest),
			);
			const before = yield* stands;
			const already = answered(before, head);
			if (already !== null) return already;
			if (before.state !== "OPEN") return yield* failed;
			if (!before.isMergeQueueEnabled) return "no_queue";
			const queued = yield* ask(gh, Enqueued, ENQUEUE_WRITE, {pull: before.id, head}).pipe(
				Effect.match({onSuccess: () => true, onFailure: () => false}),
			);
			if (queued) return "queued";
			return answered(yield* stands, head) ?? (yield* failed);
		});

// ---------------------------------------------------------------- merge

/** The read before a merge: where the pull request stands, and how the repository lets it merge. */
export const MERGE_READ = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequest(number: $number) { id state baseRefName headRefOid mergeable mergeCommit { oid } }
  }
}`;
const MergeStands = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			squashMergeAllowed: Schema.Boolean,
			mergeCommitAllowed: Schema.Boolean,
			rebaseMergeAllowed: Schema.Boolean,
			pullRequest: Schema.Struct({
				id: Schema.String,
				baseRefName: Schema.String,
				state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
				headRefOid: Schema.String,
				mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
				mergeCommit: Schema.NullOr(Schema.Struct({oid: Schema.String})),
			}),
		}),
	}),
});
type MergeStanding = (typeof MergeStands.Type)["data"]["repository"];

/**
 * The one write of a merge. `expectedHeadOid` makes GitHub itself refuse when
 * the head is no longer this commit, as the enqueue does. The method is the
 * first the repository allows: squash, then a merge commit, then rebase.
 */
export const MERGE_WRITE = `
mutation($pull: ID!, $head: GitObjectID!, $method: PullRequestMergeMethod!) {
  mergePullRequest(input: { pullRequestId: $pull, expectedHeadOid: $head, mergeMethod: $method }) {
    pullRequest { mergeCommit { oid } }
  }
}`;
const MergedNow = Schema.Struct({
	data: Schema.Struct({
		mergePullRequest: Schema.Struct({
			pullRequest: Schema.Struct({mergeCommit: Schema.Struct({oid: Schema.String})}),
		}),
	}),
});

/** What a reading already answers. `null`: nothing yet. */
const mergeAnswered = ({pullRequest: pr}: MergeStanding, head: string): Merged | null =>
	// Merged already: a merge sent a second time finds its own first write.
	pr.state === "MERGED" && pr.mergeCommit !== null
		? {reading: "merged", commit: pr.mergeCommit.oid}
		: pr.state !== "OPEN"
			? null
			: pr.headRefOid !== head
				? {reading: "head_moved"}
				: pr.mergeable === "CONFLICTING"
					? {reading: "conflicts"}
					: null;

/** The first merge method the repository allows. `null`: it allows none. */
const methodOf = (repo: MergeStanding): "SQUASH" | "MERGE" | "REBASE" | null =>
	repo.squashMergeAllowed
		? "SQUASH"
		: repo.mergeCommitAllowed
			? "MERGE"
			: repo.rebaseMergeAllowed
				? "REBASE"
				: null;

const Branch = Schema.Struct({protected: Schema.Boolean});
/**
 * The rules GitHub holds for one branch: its rulesets' rules, the
 * organisation's too, and a classic protection rule. Read as GraphQL: the
 * REST read (`rules/branches/<base>`) is refused with 403 on a private
 * repository of a free plan, where GraphQL answers that there are none.
 */
const RULES_READ = `query($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) { branchProtectionRule { id } rules(first: 1) { totalCount } }
  }
}`;
const RefRules = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			ref: Schema.NullOr(
				Schema.Struct({
					branchProtectionRule: Schema.NullOr(Schema.Struct({id: Schema.String})),
					rules: Schema.Struct({totalCount: Schema.Number}),
				}),
			),
		}),
	}),
});
const GitCommit = Schema.Struct({sha: Schema.String, tree: Schema.Struct({sha: Schema.String})});
const MadeCommit = Schema.Struct({sha: Schema.String});
const GitRef = Schema.Struct({object: Schema.Struct({sha: Schema.String})});
const Compared = Schema.Struct({status: Schema.String});

/**
 * Merge `head` onto the base branch only while the base is still `tested`:
 * a merge commit of the two, made by hand (its tree is the head's, as the
 * head holds `tested`), and the branch moved to it with `force: false`.
 * GitHub moves the branch only when the new commit follows from where the
 * branch is, so a commit that lands on the base between the door's read and
 * this write makes it refuse: the merge is pinned to the main it was tested
 * on. GitHub marks the pull request merged when its head reaches the base.
 *
 * Only on a branch GitHub holds no rule for (unprotected, no ruleset) and a
 * repository that allows merge commits: a branch with rules is merged by
 * GitHub's own merge, which does not pin the base. `null`: not here.
 */
const pinnedMerge = (
	gh: Gh,
	at: {readonly owner: string; readonly name: string; readonly number: number},
	base: string,
	head: string,
	tested: string,
): Effect.Effect<Merged | null, {readonly _tag: "unknown"}> =>
	Effect.gen(function* () {
		const repo = `repos/${at.owner}/${at.name}`;
		const branch = yield* answerOf(gh, Branch, ["api", `${repo}/branches/${base}`]);
		const {ref} = (yield* answerOf(gh, RefRules, [
			"api",
			"graphql",
			"-f",
			`query=${RULES_READ}`,
			"-f",
			`owner=${at.owner}`,
			"-f",
			`name=${at.name}`,
			"-f",
			`ref=refs/heads/${base}`,
		])).data.repository;
		// No such branch, as GraphQL reads it: nothing to pin to.
		if (ref === null) return null;
		if (branch.protected || ref.branchProtectionRule !== null || ref.rules.totalCount > 0)
			return null;
		const {tree} = yield* answerOf(gh, GitCommit, ["api", `${repo}/git/commits/${head}`]);
		const made = yield* answerOf(gh, MadeCommit, [
			"api",
			"--method",
			"POST",
			`${repo}/git/commits`,
			"-f",
			`message=Merge pull request #${at.number}`,
			"-f",
			`tree=${tree.sha}`,
			"-f",
			`parents[]=${tested}`,
			"-f",
			`parents[]=${head}`,
		]);
		const moved = yield* gh([
			"api",
			"--method",
			"PATCH",
			`${repo}/git/refs/heads/${base}`,
			"-f",
			`sha=${made.sha}`,
			"-F",
			"force=false",
		]).pipe(Effect.match({onSuccess: () => true, onFailure: () => false}));
		if (moved) return {reading: "merged", commit: made.sha} as const;
		// Refused, or its answer lost: why is read from the branch, never from the refusal's words.
		const tip = (yield* answerOf(gh, GitRef, ["api", `${repo}/git/ref/heads/${base}`])).object.sha;
		if (tip === made.sha) return {reading: "merged", commit: made.sha} as const;
		// The head is in the base already: an earlier send of this merge landed.
		const held = yield* answerOf(gh, Compared, ["api", `${repo}/compare/${tip}...${head}`]);
		if (held.status === "behind" || held.status === "identical")
			return {reading: "merged", commit: tip} as const;
		return tip === tested ? yield* failed : ({reading: "behind"} as const);
	});

/**
 * Merge `head` of its pull request straight in, on a repository with no merge
 * queue. It reads first, and writes only when the reading does not already
 * answer. When GitHub refuses the write, why is read from the pull request
 * again, never guessed from the refusal's words.
 *
 * `tested`: the main the head was tested on, as the merge door read it just
 * before (`OnMain`). Given, the merge is pinned to it where GitHub lets it be
 * (`pinnedMerge`): a main that moved on since answers `behind`, and nothing
 * lands. Left out, or on a branch with rules, GitHub's own merge, which
 * checks the head and not the base.
 */
export const mergeOn =
	(gh: Gh) =>
	(url: string, head: string, tested?: string): Effect.Effect<Merged, {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = prOf(url);
			if (at === null) return yield* failed;
			const stands = ask(gh, MergeStands, MERGE_READ, at).pipe(
				Effect.map((answer) => answer.data.repository),
			);
			const before = yield* stands;
			const already = mergeAnswered(before, head);
			if (already !== null) return already;
			if (
				tested !== undefined &&
				before.pullRequest.state === "OPEN" &&
				before.mergeCommitAllowed
			) {
				const pinned = yield* pinnedMerge(gh, at, before.pullRequest.baseRefName, head, tested);
				if (pinned !== null) return pinned;
			}
			const method = methodOf(before);
			if (before.pullRequest.state !== "OPEN" || method === null) return yield* failed;
			const commit = yield* ask(gh, MergedNow, MERGE_WRITE, {
				pull: before.pullRequest.id,
				head,
				method,
			}).pipe(
				Effect.match({
					onSuccess: (answer) => answer.data.mergePullRequest.pullRequest.mergeCommit.oid,
					onFailure: () => null,
				}),
			);
			if (commit !== null) return {reading: "merged", commit} as const;
			return mergeAnswered(yield* stands, head) ?? (yield* failed);
		});

// ---------------------------------------------------------------- re-run

/** The runs of one commit, as GitHub's REST API answers. */
const Runs = Schema.Struct({
	total_count: Schema.Number,
	workflow_runs: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			head_sha: Schema.String,
			status: Schema.String,
			conclusion: Schema.NullOr(Schema.String),
			run_attempt: Schema.Number,
		}),
	),
});

/**
 * Start the failed jobs of `head`'s runs again, and only those: a run that
 * finished red or ran out of time. Green runs and runs still going are left
 * alone. It answers each run it started again with the try it was on, which
 * is how the wait after it tells the new try from the old one. No red run to
 * start again is a failure: red checks that are not a run of this commit
 * cannot be re-run from here.
 */
export const rerunChecksOn =
	(gh: Gh) =>
	(url: string, head: string): Effect.Effect<readonly Rerun[], {readonly _tag: "unknown"}> =>
		Effect.gen(function* () {
			const at = prOf(url);
			if (at === null) return yield* failed;
			const repo = `repos/${at.owner}/${at.name}`;
			// `head_sha` is matched as written, so `head` is the whole commit id.
			const runs = yield* answerOf(gh, Runs, [
				"api",
				`${repo}/actions/runs?head_sha=${head}&per_page=100`,
			]);
			if (runs.total_count > runs.workflow_runs.length) return yield* failed;
			const red = runs.workflow_runs.filter(
				(r) =>
					r.head_sha === head &&
					r.status === "completed" &&
					(r.conclusion === "failure" || r.conclusion === "timed_out"),
			);
			if (red.length === 0) return yield* failed;
			for (const run of red)
				yield* gh(["api", "--method", "POST", `${repo}/actions/runs/${run.id}/rerun-failed-jobs`]);
			return red.map((run) => ({run: run.id, attempt: run.run_attempt}));
		});

/** The writes over one `gh`. */
export const codeHostWritesOn = (gh: Gh): CodeHostWrites["Service"] => {
	const enqueue = enqueueOn(gh);
	const merge = mergeOn(gh);
	return {
		// The proof names the pull request and the head; nothing else reaches the write.
		enqueue: (ready) => enqueue(ready.pr, ready.head),
		// Only a proof tested on the main tip, read just before by the merge door (stages/ship/door.ts),
		// and pinned to that main where GitHub lets it be.
		merge: (onMain) => merge(onMain.pr, onMain.head, onMain.tested),
		rerunChecks: rerunChecksOn(gh),
	};
};

/** `CodeHostWrites` on GitHub. `gh`: the GitHub CLI to run, for a test that stands one in. */
export const gitHubCodeHostWrites = (config: {readonly gh?: string} = {}) =>
	Layer.succeed(
		CodeHostWrites,
		codeHostWritesOn((args) => sh(config.gh ?? "gh", args)),
	);
