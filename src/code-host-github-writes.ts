import { Effect, Layer, Schema } from "effect";
import { answerOf, ask, type Gh, prOf } from "./code-host-github.ts";
import { sh } from "./operator-live.ts";
import { CodeHostWrites } from "./services.ts";
import type { Rerun } from "./stages/ship/facts.ts";

// `CodeHostWrites` on GitHub: the two things the ship machine changes on a
// pull request. Every call here that writes is listed, whole, in the two
// comments below. There is no other.
//
//   enqueue      gh api graphql -f pull=<id> -f head=<commit> -f query=<ENQUEUE_WRITE>
//   rerunChecks  gh api --method POST repos/<owner>/<name>/actions/runs/<run>/rerun-failed-jobs
//
// What is never done here: arming "merge when ready", merging a pull request
// directly, deleting a branch, an owner's bypass of the branch rules, a
// label, a comment.

const failed = Effect.fail({ _tag: "unknown" as const });

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
  data: Schema.Struct({ enqueuePullRequest: Schema.Struct({ mergeQueueEntry: Schema.Struct({ id: Schema.String }) }) }),
});

/** What a reading of the pull request already answers. `null`: nothing yet. */
const answered = (pr: Standing, head: string): "queued" | "head_moved" | "conflicts" | null =>
  // Merged, or in the queue already: an enqueue sent a second time finds its own first write.
  pr.state === "MERGED" ? "queued" : pr.headRefOid !== head ? "head_moved" : pr.isInMergeQueue ? "queued" : pr.mergeable === "CONFLICTING" ? "conflicts" : null;

/**
 * Put `head` in the merge queue of its pull request.
 *
 * It reads first, and writes only when the reading does not already answer.
 * On a repo with no merge queue it writes nothing and fails: this never
 * merges a pull request itself. When GitHub refuses the write, why is read
 * from the pull request again, never guessed from the refusal's words.
 */
export const enqueueOn =
  (gh: Gh) =>
  (url: string, head: string): Effect.Effect<"queued" | "head_moved" | "conflicts", { readonly _tag: "unknown" }> =>
    Effect.gen(function* () {
      const at = prOf(url);
      if (at === null) return yield* failed;
      const stands = ask(gh, Stands, ENQUEUE_READ, at).pipe(Effect.map((answer) => answer.data.repository.pullRequest));
      const before = yield* stands;
      const already = answered(before, head);
      if (already !== null) return already;
      if (before.state !== "OPEN" || !before.isMergeQueueEnabled) return yield* failed;
      const queued = yield* ask(gh, Enqueued, ENQUEUE_WRITE, { pull: before.id, head }).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
      if (queued) return "queued";
      return answered(yield* stands, head) ?? (yield* failed);
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
  (url: string, head: string): Effect.Effect<readonly Rerun[], { readonly _tag: "unknown" }> =>
    Effect.gen(function* () {
      const at = prOf(url);
      if (at === null) return yield* failed;
      const repo = `repos/${at.owner}/${at.name}`;
      // `head_sha` is matched as written, so `head` is the whole commit id.
      const runs = yield* answerOf(gh, Runs, ["api", `${repo}/actions/runs?head_sha=${head}&per_page=100`]);
      if (runs.total_count > runs.workflow_runs.length) return yield* failed;
      const red = runs.workflow_runs.filter((r) => r.head_sha === head && r.status === "completed" && (r.conclusion === "failure" || r.conclusion === "timed_out"));
      if (red.length === 0) return yield* failed;
      for (const run of red) yield* gh(["api", "--method", "POST", `${repo}/actions/runs/${run.id}/rerun-failed-jobs`]);
      return red.map((run) => ({ run: run.id, attempt: run.run_attempt }));
    });

/** The writes over one `gh`. */
export const codeHostWritesOn = (gh: Gh): CodeHostWrites["Service"] => ({ enqueue: enqueueOn(gh), rerunChecks: rerunChecksOn(gh) });

/** `CodeHostWrites` on GitHub. `gh`: the GitHub CLI to run, for a test that stands one in. */
export const gitHubCodeHostWrites = (config: { readonly gh?: string } = {}) =>
  Layer.succeed(
    CodeHostWrites,
    codeHostWritesOn((args) => sh(config.gh ?? "gh", args)),
  );
