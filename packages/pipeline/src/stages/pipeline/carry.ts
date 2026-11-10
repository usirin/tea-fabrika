import { Schema } from "effect";

// Whether a yes given at one head still stands at another (self-fix PR 10, Part 4;
// docs/direction/a-yes-binds-to-the-diff.md). Today's version.
//
//   A yes on a pull request is a review's verdict row, a person's `merge`, or the exam's row. It was
//   given on a diff, not on a commit. When the head moves, this one pure function says whether that
//   diff still stands:
//
//   kept     the same head; or the reviewed diff replays cleanly onto the base now (`git merge-tree`)
//            to exactly the new tree; or the base's formatter, run on the replayed tree's changed
//            paths, gives exactly the new tree
//   glance   only `git diff -U0 base head | git patch-id --verbatim` matches: the pull request's own
//            lines are the same and the lines around them moved, a question of meaning
//   stale    everything else
//
//   carry(given, now)
//   // {_tag: "kept", why: "formatted"}: a commit that only formats keeps the yes
//
// Nothing here runs git: one Gather in work.ts reads `Given` when a yes is given and `Now` at a later
// head. The checks still run at the final head, and the merge stays bound to the exact sha.

/** What a yes was given on: the head, the branch it goes onto, where it left that branch, and its diff's id. */
export const Given = Schema.Struct({
  head: Schema.String,
  onto: Schema.String,
  base: Schema.String,
  /** `git diff -U0 base head | git patch-id --verbatim`, its first word. */
  diff: Schema.String,
});
export type Given = typeof Given.Type;

/** What the pull request is now, read against a `Given`. */
export interface Now {
  readonly head: string;
  /** The head's tree. */
  readonly tree: string;
  /** The given diff, replayed onto the base now: its tree, or `conflict`. */
  readonly replayed: string;
  /** The base's formatter run on the replayed tree's changed paths: its tree. `null`: not run. */
  readonly formatted: string | null;
  /** The id of the diff now, as `Given.diff` is made. */
  readonly diff: string;
  /** `git range-diff` from the given commits to the ones now: what a glance reads. */
  readonly range: string;
}

/** Why a yes still stands. The same words the `carried` fact keeps, but a glance's. */
export const Kept = Schema.Literals(["same_head", "replayed", "formatted"]);
export type Kept = typeof Kept.Type;

/** What `carry` says: kept, and why; a glance, with what it would read; or stale. */
export const Carried = Schema.Union([
  Schema.TaggedStruct("kept", { why: Kept }),
  Schema.TaggedStruct("glance", { range: Schema.String }),
  Schema.TaggedStruct("stale", {}),
]);
export type Carried = typeof Carried.Type;

const kept = (why: Kept): Carried => ({ _tag: "kept", why });

/** Whether the yes given on `given` stands at `now`. Pure. */
export const carry = (given: Given, now: Now): Carried =>
  now.head === given.head
    ? kept("same_head")
    : now.replayed === now.tree
      ? kept("replayed")
      : now.formatted === now.tree
        ? kept("formatted")
        : now.diff === given.diff
          ? { _tag: "glance", range: now.range }
          : { _tag: "stale" };
