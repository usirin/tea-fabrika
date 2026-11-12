// PullRequests: what the lead tooling asks GitHub about pull requests, and the few writes it makes
// (0134: a draft at a branch's first commit, marked ready when its steps passed). This file is the
// contract only (0095): `PullRequestsGh.layer` asks GitHub through `gh`, `PullRequestsTest.layer`
// answers from a list in memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/** GitHub could not be asked, refused, or answered in a shape we do not read. */
export class PullRequestsError extends Schema.TaggedError<PullRequestsError>()("PullRequestsError", {
  reason: Schema.String,
}) {}

/** One pull request as GitHub lists it: its branch, the head it holds, and how it stands. */
export const PullRequest = Schema.Struct({
  number: Schema.Number,
  head: Schema.String,
  /** The commit the branch pointed at when GitHub last read it; for a merged one, the merged head. */
  oid: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  draft: Schema.Boolean,
});
export type PullRequest = typeof PullRequest.Type;

/** What a new or edited pull request says: its title and its description. */
export type Text = { readonly title: string; readonly body: string };

export class PullRequests extends Context.Service<
  PullRequests,
  {
    /** The open pull request whose head is `branch`; none when the branch has none. */
    readonly openOn: (branch: string) => Effect.Effect<Option.Option<PullRequest>, PullRequestsError>;
    /** Every pull request of the repo, open, closed and merged. Fails when one read cannot hold all. */
    readonly all: Effect.Effect<ReadonlyArray<PullRequest>, PullRequestsError>;
    /** Opens a draft pull request from `branch` into main, and answers its number. */
    readonly draft: (branch: string, text: Text) => Effect.Effect<number, PullRequestsError>;
    /** Sets the title and description of pull request `number`. */
    readonly edit: (number: number, text: Text) => Effect.Effect<void, PullRequestsError>;
    /** Marks draft pull request `number` ready for review. */
    readonly ready: (number: number) => Effect.Effect<void, PullRequestsError>;
  }
>()("lead/pr/PullRequests") {}
