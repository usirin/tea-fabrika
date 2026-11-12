// Publish: a commit leaves the laptop the moment it is made, and its branch has a pull request from
// its first commit (0134). Today's lead tooling, run on our own laptop; it is not product.
//
//   publish   leak grep on origin/main..head, fail closed -> push, never forced -> the branch's open
//             pull request, or a new draft when it has none
//   ready     publish, then the pull request's title and description from the lane brief, then
//             marked ready: a lane's steps have passed
//
// The commit step runs `publish` after each signed commit; a lane's host part runs it after each
// step's commit comes out of the box, and `ready` where the lane used to open its pull request.
// Read through its module: `Publish.publish(...)`.
import { Effect, Schema } from "effect";
import { PullRequests, type Text } from "./PullRequests.ts";
import { Pushes } from "./Pushes.ts";

/** What a draft says when a commit opens it; the lane's ready step gives it the brief's words. */
export const DRAFT_BODY =
  "Opened as a draft at this branch's first commit, so no code stays only on a branch (decision " +
  "0134). It is marked ready when its steps have passed.";

/** A branch no commit step pushes to: main, or none (a detached head). */
export class NoBranch extends Schema.TaggedError<NoBranch>()("NoBranch", { reason: Schema.String }) {}

/** What one publish did: the branch's pull request, whether this publish opened it, and if a draft. */
export type Published = { readonly pr: number; readonly opened: boolean; readonly draft: boolean };

export type Ask = {
  /** The checkout the commit is in. */
  readonly dir: string;
  readonly branch: string;
  /** The commit to push, a sha or a ref the checkout reads. */
  readonly head: string;
  /** What a new draft says. A pull request already open keeps its own words. */
  readonly text: Text;
};

const checked = (branch: string) =>
  branch === "" || branch === "HEAD"
    ? Effect.fail(new NoBranch({ reason: "HEAD is detached, so there is no branch to push" }))
    : branch === "main" || branch === "refs/heads/main"
      ? Effect.fail(new NoBranch({ reason: "a commit step never pushes to main" }))
      : Effect.succeed(branch);

export const publish = Effect.fn("Publish.publish")(function* (a: Ask) {
  const branch = yield* checked(a.branch);
  const pushes = yield* Pushes;
  const prs = yield* PullRequests;
  yield* pushes.leakGrep(a.dir, a.head);
  yield* pushes.push(a.dir, branch, a.head);
  const open = yield* prs.openOn(branch);

  if (open._tag === "Some") {
    return { pr: open.value.number, opened: false, draft: open.value.draft } satisfies Published;
  }

  const pr = yield* prs.draft(branch, a.text);
  return { pr, opened: true, draft: true } satisfies Published;
});

/** The lane's steps passed: push its head, give its pull request the brief's words, mark it ready. */
export const ready = Effect.fn("Publish.ready")(function* (a: Ask) {
  const published = yield* publish(a);
  const prs = yield* PullRequests;
  yield* prs.edit(published.pr, a.text);

  if (published.draft) {
    yield* prs.ready(published.pr);
  }

  return { ...published, draft: false } satisfies Published;
});

/** One line for a log: what the publish did, with the pull request's number. */
export const line = (branch: string, p: Published): string =>
  p.opened ? `pushed ${branch} and opened draft PR ${p.pr}` : `pushed ${branch}; PR ${p.pr} was already open`;
