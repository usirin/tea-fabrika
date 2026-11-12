/**
 * Pinned code-host reads, updates and squash merges.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a positive change number.
 *
 * @stability unstable
 * @category models
 */
export const ChangeId = Schema.Int.check(Schema.isGreaterThan(0));

const Id = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/));

/**
 * Schema for a full lower-case SHA-1 or SHA-256 commit id.
 *
 * @stability unstable
 * @category models
 */
export const Commit = Id.pipe(Schema.brand("Commit"));

/**
 * Schema for a full git tree id, distinct from a commit id.
 *
 * @stability unstable
 * @category models
 */
export const Tree = Id.pipe(Schema.brand("Tree"));

/**
 * Schema for git path segments with no empty segment, dot, parent or NUL.
 *
 * @stability unstable
 * @category models
 */
export const Path = Schema.String.check(
  Schema.makeFilter(
    (p) =>
      (p !== "" && !p.includes("\u0000") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..")) ||
      "not a git path",
  ),
);

/**
 * Schema for a change or its absence; null paths mean the list is incomplete.
 *
 * @stability unstable
 * @category models
 */
export const Change = Schema.TaggedUnion({
  found: {
    change: ChangeId,
    head: Commit,
    state: Schema.Literals(["open", "draft", "closed", "merged"]),
    // null means the host could not list every path; a partial list cannot lighten a change.
    paths: Schema.NullOr(Schema.Array(Path)),
  },
  missing: { change: ChangeId },
});

/**
 * Schema for a pinned update result, including conflicts and changes no longer open.
 *
 * @stability unstable
 * @category models
 */
export const Updated = Schema.TaggedUnion({
  current: { head: Commit, tree: Tree, main: Commit },
  updated: { head: Commit, tree: Tree, main: Commit },
  conflict: { main: Commit, paths: Schema.Array(Path) },
  moved: { head: Commit },
  closed: { state: Schema.Literals(["draft", "closed", "merged"]) },
});

/**
 * Schema for a pinned squash result and its landed tree.
 *
 * @stability unstable
 * @category models
 */
export const Merged = Schema.TaggedUnion({
  merged: { commit: Commit, tree: Tree },
  moved: { head: Commit },
  conflict: { main: Commit, paths: Schema.Array(Path) },
  closed: { state: Schema.Literals(["draft", "closed"]) },
});

/**
 * The code host could not be reached.
 *
 * @stability unstable
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  cause: Schema.Defect(),
}) {}

/**
 * The code host's request limit was reached.
 *
 * @stability unstable
 * @category errors
 */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  cause: Schema.Defect(),
}) {}

/**
 * The code host refused the request.
 *
 * @stability unstable
 * @category errors
 */
export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  cause: Schema.Defect(),
}) {}

/**
 * Error for a host fault outside the change that permits another attempt.
 *
 * @stability unstable
 * @category errors
 */
export class CodeHostError extends Schema.TaggedError<CodeHostError>()("CodeHostError", {
  reason: Schema.Union([Unavailable, RateLimited, Refused]),
}) {}

/**
 * Service for pinned changes. Every id in an answer uses the asked head's hash length. A moved
 * head differs from the pin.
 *
 * @stability unstable
 * @category services
 */
export class CodeHost extends Context.Service<
  CodeHost,
  {
    readonly change: (change: typeof ChangeId.Type) => Effect.Effect<typeof Change.Type, CodeHostError>;
    /** Pinned to head. While its resulting head remains, repeating an update returns that same updated answer. */
    readonly update: (
      change: typeof ChangeId.Type,
      head: typeof Commit.Type,
    ) => Effect.Effect<typeof Updated.Type, CodeHostError>;
    /** Squash pinned to head. Repeating a successful merge returns that same merged answer. */
    readonly merge: (
      change: typeof ChangeId.Type,
      head: typeof Commit.Type,
    ) => Effect.Effect<typeof Merged.Type, CodeHostError>;
  }
>()("@kampus/libfabrika/CodeHost") {}
